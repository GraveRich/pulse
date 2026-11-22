// Pulse accounts.
// Keeps an online copy of a user's liked songs, playlists and saved SoundCloud pages, so they survive a new PC or a
// reinstall. Cloudflare Worker + D1 (binding DB, tables in ../schema.sql).
//
// What is stored: a username, a password hash, a recovery-code hash, session-token hashes and the library (song
// links and titles). No email, no IP addresses, no listening history. Deleting the account deletes all of it.
//
//   POST   /v1/signup    {name, password}                 -> {name, token, recovery}
//   POST   /v1/login     {name, password}                 -> {name, token}
//   POST   /v1/recover   {name, recovery, password}       -> {name, token}        (new password with the recovery code)
//   POST   /v1/logout                                     (Bearer token)
//   GET    /v1/library                                    -> {rev, updated, data}
//   PUT    /v1/library   {rev, data}                      -> {rev}   or 409 {rev, updated, data} when someone else saved first
//   POST   /v1/password  {old, password}                  -> {ok}
//   DELETE /v1/account   {password}                       -> {ok}

const ROUNDS = 100000; // PBKDF2-SHA256, the most Workers allows
const MAX_DATA = 400 * 1024; // one library, as JSON text
const MAX_SESSIONS = 10; // devices signed in per account
const enc = new TextEncoder();

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
	'Access-Control-Max-Age': '86400'
};
const HEAD = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, CORS);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEAD });
const fail = (status, error) => json({ error }, status);
const now = () => Math.floor(Date.now() / 1000);

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = n => crypto.getRandomValues(new Uint8Array(n));
async function sha256(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))); }

async function pbkdf2(password, salt, rounds) {
	const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, 256));
}
async function hashPassword(password) {
	const salt = random(16);
	return `pbkdf2$${ROUNDS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ROUNDS))}`;
}
async function checkPassword(password, stored) {
	const [alg, rounds, salt, want] = String(stored).split('$');
	if (alg !== 'pbkdf2' || typeof password !== 'string' || !password) return false;
	const got = b64url(await pbkdf2(password, fromB64url(salt), Number(rounds)));
	if (got.length !== want.length) return false;
	let diff = 0;
	for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
	return diff === 0;
}
// compared against when the username does not exist, so a wrong name takes as long as a wrong password
const DUMMY_HASH = `pbkdf2$${ROUNDS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

// recovery code: 12 characters without look-alikes, shown once at signup, e.g. K7QF-2MXD-9RTA
function newRecovery() {
	const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const r = random(12);
	let s = '';
	for (let i = 0; i < 12; i++) s += abc[r[i] % 32] + (i % 4 === 3 && i < 11 ? '-' : '');
	return s;
}
const normRecovery = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const validName = s => typeof s === 'string' && /^[A-Za-z0-9_.-]{3,20}$/.test(s);
const validPassword = s => typeof s === 'string' && s.length >= 8 && s.length <= 100;

// counts one use of `key` and says whether it went over `max` within `seconds`
async function limited(env, key, max, seconds) {
	const t = now();
	const row = await env.DB.prepare(
		'INSERT INTO rl (k, n, reset) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN reset <= ?3 THEN 1 ELSE n + 1 END, reset = CASE WHEN reset <= ?3 THEN ?2 ELSE reset END RETURNING n'
	).bind(key, t + seconds, t).first();
	return !!row && row.n > max;
}

async function body(request, max) {
	const text = await request.text();
	if (text.length > max) return undefined;
	try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

async function newSession(env, userId) {
	const token = hex(random(32));
	const t = now();
	await env.DB.prepare('INSERT INTO sessions (token, user_id, created, used) VALUES (?1, ?2, ?3, ?3)').bind(await sha256(token), userId, t).run();
	// the oldest sign-ins drop off when one account is signed in on too many devices
	await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token NOT IN (SELECT token FROM sessions WHERE user_id = ?1 ORDER BY used DESC, created DESC LIMIT ?2)').bind(userId, MAX_SESSIONS).run();
	return token;
}

async function auth(request, env) {
	const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
	if (!m) return null;
	const th = await sha256(m[1]);
	const row = await env.DB.prepare('SELECT u.id AS id, u.name AS name, u.pass AS pass, s.used AS used FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1').bind(th).first();
	if (!row) return null;
	const t = now();
	if (t - row.used > 3600) {
		await env.DB.batch([
			env.DB.prepare('UPDATE sessions SET used = ?1 WHERE token = ?2').bind(t, th),
			env.DB.prepare('UPDATE users SET seen = ?1 WHERE id = ?2').bind(t, row.id)
		]);
	}
	return { id: row.id, name: row.name, pass: row.pass, token: th };
}

function libraryJson(row) {
	return new Response('{"rev":' + (row ? row.rev : 0) + ',"updated":' + (row ? row.updated : 0) + ',"data":' + (row ? row.data : 'null') + '}', { status: 200, headers: HEAD });
}

async function handle(request, env) {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, '') || '/';
	const method = request.method;
	if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
	if (path === '/' && method === 'GET') return json({ service: 'pulse-accounts', ok: true });

	const ip = await sha256('ip:' + (request.headers.get('CF-Connecting-IP') || 'local'));
	const ipKey = ip.slice(0, 20);
	if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM rl WHERE reset < ?1').bind(now()).run();

	if (path === '/v1/signup' && method === 'POST') {
		const b = await body(request, 2000);
		if (!b) return fail(400, 'Bad request');
		if (!validName(b.name)) return fail(400, 'Pick a name of 3 to 20 letters, numbers, dots, dashes or underscores.');
		if (!validPassword(b.password)) return fail(400, 'The password needs at least 8 characters.');
		if (await limited(env, 'signup:' + ipKey, 5, 3600)) return fail(429, 'Too many new accounts from this network. Try again in an hour.');
		if (await limited(env, 'signup:all', 3000, 86400)) return fail(429, 'Sign-ups are paused for today. Try again tomorrow.');
		const recovery = newRecovery();
		const t = now();
		let id;
		try {
			const r = await env.DB.prepare('INSERT INTO users (name, pass, recovery, created, seen) VALUES (?1, ?2, ?3, ?4, ?4)')
				.bind(b.name, await hashPassword(b.password), await sha256('rc:' + normRecovery(recovery)), t).run();
			id = r.meta.last_row_id;
		} catch (e) {
			if (/UNIQUE/i.test(String(e && e.message))) return fail(409, 'That name is taken. Pick another one.');
			throw e;
		}
		return json({ name: b.name, token: await newSession(env, id), recovery });
	}

	if (path === '/v1/login' && method === 'POST') {
		const b = await body(request, 2000);
		if (!b || typeof b.name !== 'string' || typeof b.password !== 'string') return fail(400, 'Bad request');
		const nameKey = (await sha256('name:' + b.name.toLowerCase())).slice(0, 20);
		if (await limited(env, 'login:' + ipKey, 30, 900) || await limited(env, 'loginn:' + nameKey, 15, 900)) return fail(429, 'Too many tries. Wait 15 minutes.');
		const u = validName(b.name) ? await env.DB.prepare('SELECT id, name, pass FROM users WHERE name = ?1').bind(b.name).first() : null;
		const ok = await checkPassword(b.password, u ? u.pass : DUMMY_HASH);
		if (!u || !ok) return fail(403, 'Wrong name or password.');
		return json({ name: u.name, token: await newSession(env, u.id) });
	}

	if (path === '/v1/recover' && method === 'POST') {
		const b = await body(request, 2000);
		if (!b || typeof b.name !== 'string') return fail(400, 'Bad request');
		if (!validPassword(b.password)) return fail(400, 'The new password needs at least 8 characters.');
		if (await limited(env, 'recover:' + ipKey, 10, 3600)) return fail(429, 'Too many tries. Wait an hour.');
		const u = validName(b.name) ? await env.DB.prepare('SELECT id, name, recovery FROM users WHERE name = ?1').bind(b.name).first() : null;
		const given = await sha256('rc:' + normRecovery(b.recovery));
		if (!u || given !== u.recovery || normRecovery(b.recovery).length !== 12) return fail(403, 'Wrong name or recovery code.');
		await env.DB.batch([
			env.DB.prepare('UPDATE users SET pass = ?1 WHERE id = ?2').bind(await hashPassword(b.password), u.id),
			env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(u.id)
		]);
		return json({ name: u.name, token: await newSession(env, u.id) });
	}

	// ---- everything below needs a signed-in session
	if (!path.startsWith('/v1/')) return fail(404, 'Not found');
	const me = await auth(request, env);
	if (!me) return fail(401, 'Not signed in');

	if (path === '/v1/logout' && method === 'POST') {
		await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(me.token).run();
		return json({ ok: true });
	}

	if (path === '/v1/library' && method === 'GET') {
		return libraryJson(await env.DB.prepare('SELECT rev, updated, data FROM libraries WHERE user_id = ?1').bind(me.id).first());
	}

	if (path === '/v1/library' && method === 'PUT') {
		const b = await body(request, MAX_DATA + 200);
		if (b === undefined) return fail(413, 'Your library is too big to save online.');
		if (!b || !b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return fail(400, 'Bad request');
		const text = JSON.stringify(b.data);
		if (text.length > MAX_DATA) return fail(413, 'Your library is too big to save online.');
		if (await limited(env, 'put:' + me.id, 240, 3600)) return fail(429, 'Saving too often. It will be saved a bit later.');
		const base = Number.isInteger(b.rev) ? b.rev : -1;
		const t = now();
		let changed = 0;
		if (base === 0) changed = (await env.DB.prepare('INSERT INTO libraries (user_id, rev, updated, data) VALUES (?1, 1, ?2, ?3) ON CONFLICT(user_id) DO NOTHING').bind(me.id, t, text).run()).meta.changes;
		else if (base > 0) changed = (await env.DB.prepare('UPDATE libraries SET rev = rev + 1, updated = ?1, data = ?2 WHERE user_id = ?3 AND rev = ?4').bind(t, text, me.id, base).run()).meta.changes;
		if (changed) return json({ rev: base + 1, updated: t });
		// someone else saved first (another PC): hand back what is there so the app can merge and try again
		const cur = await env.DB.prepare('SELECT rev, updated, data FROM libraries WHERE user_id = ?1').bind(me.id).first();
		const res = libraryJson(cur);
		return new Response(res.body, { status: 409, headers: HEAD });
	}

	if (path === '/v1/password' && method === 'POST') {
		const b = await body(request, 2000);
		if (!b) return fail(400, 'Bad request');
		if (!validPassword(b.password)) return fail(400, 'The new password needs at least 8 characters.');
		if (await limited(env, 'pw:' + me.id, 10, 3600)) return fail(429, 'Too many tries. Wait an hour.');
		if (!(await checkPassword(b.old, me.pass))) return fail(403, 'The current password is wrong.');
		await env.DB.batch([
			env.DB.prepare('UPDATE users SET pass = ?1 WHERE id = ?2').bind(await hashPassword(b.password), me.id),
			env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token <> ?2').bind(me.id, me.token)
		]);
		return json({ ok: true });
	}

	if (path === '/v1/account' && method === 'DELETE') {
		const b = await body(request, 2000);
		if (!b) return fail(400, 'Bad request');
		if (await limited(env, 'del:' + me.id, 10, 3600)) return fail(429, 'Too many tries. Wait an hour.');
		if (!(await checkPassword(b.password, me.pass))) return fail(403, 'The password is wrong.');
		await env.DB.batch([
			env.DB.prepare('DELETE FROM libraries WHERE user_id = ?1').bind(me.id),
			env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(me.id),
			env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(me.id)
		]);
		return json({ ok: true });
	}

	return fail(404, 'Not found');
}

export default {
	async fetch(request, env) {
		try { return await handle(request, env); }
		catch (e) {
			console.error('pulse-accounts', e && e.stack ? e.stack : e);
			return fail(500, 'Something went wrong on the server.');
		}
	}
};
