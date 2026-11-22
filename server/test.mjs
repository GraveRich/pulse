// End-to-end check of the accounts API.  node test.mjs [base url]   (default: local `wrangler dev` on 8797)
// Creates throwaway accounts named t<random> and deletes them again.
const BASE = (process.argv[2] || 'http://127.0.0.1:8797').replace(/\/+$/, '');
let pass = 0, failed = 0;
const ok = (cond, what, extra) => { if (cond) pass++; else { failed++; console.log('FAIL', what, extra === undefined ? '' : JSON.stringify(extra)); } };
async function call(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data, cors: r.headers.get('access-control-allow-origin') };
}
const name = 't' + Math.random().toString(36).slice(2, 12);
const lib = n => ({ v: 1, liked: Array.from({ length: n }, (_, i) => ({ k: 'yt', id: 'abcdefghi' + String(i).padStart(2, '0'), title: 'Song ' + i })), playlists: [{ id: 'p1', name: 'Mix', tracks: [] }], saved: [] });

let r = await call('GET', '/');
ok(r.status === 200 && r.data.ok && r.cors === '*', 'root', r);
r = await call('OPTIONS', '/v1/library');
ok(r.status === 204 && r.cors === '*', 'preflight', r);

r = await call('POST', '/v1/signup', { name: 'ab', password: 'longenough1' }); ok(r.status === 400, 'short name refused', r);
r = await call('POST', '/v1/signup', { name: 'bad name!', password: 'longenough1' }); ok(r.status === 400, 'bad characters refused', r);
r = await call('POST', '/v1/signup', { name, password: 'short' }); ok(r.status === 400, 'short password refused', r);
r = await call('POST', '/v1/signup', 'not json'); ok(r.status === 400, 'garbage refused', r);
r = await call('POST', '/v1/signup', { name, password: 'correct horse 1' });
ok(r.status === 200 && /^[0-9a-f]{64}$/.test(r.data.token) && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.recovery), 'signup', r);
const token = r.data.token, recovery = r.data.recovery;
r = await call('POST', '/v1/signup', { name: name.toUpperCase(), password: 'correct horse 1' }); ok(r.status === 409, 'same name in capitals is taken', r);

r = await call('GET', '/v1/library'); ok(r.status === 401, 'library needs a token', r);
r = await call('GET', '/v1/library', undefined, 'f'.repeat(64)); ok(r.status === 401, 'made-up token refused', r);
r = await call('GET', '/v1/library', undefined, token); ok(r.status === 200 && r.data.rev === 0 && r.data.data === null, 'empty library', r);
r = await call('PUT', '/v1/library', { rev: 0, data: lib(3) }, token); ok(r.status === 200 && r.data.rev === 1, 'first save', r);
r = await call('GET', '/v1/library', undefined, token); ok(r.status === 200 && r.data.rev === 1 && r.data.data.liked.length === 3 && r.data.data.liked[2].title === 'Song 2', 'read back', r);
r = await call('PUT', '/v1/library', { rev: 1, data: lib(4) }, token); ok(r.status === 200 && r.data.rev === 2, 'second save', r);
r = await call('PUT', '/v1/library', { rev: 1, data: lib(9) }, token); ok(r.status === 409 && r.data.rev === 2 && r.data.data.liked.length === 4, 'stale save gets the newer copy back', r);
r = await call('PUT', '/v1/library', { rev: 0, data: lib(9) }, token); ok(r.status === 409 && r.data.rev === 2, 'cannot start over on top of existing data', r);
r = await call('PUT', '/v1/library', { rev: 2, data: [1, 2] }, token); ok(r.status === 400, 'data must be an object', r);
r = await call('PUT', '/v1/library', { rev: 2, data: { v: 1, blob: 'x'.repeat(420 * 1024) } }, token); ok(r.status === 413, 'oversized library refused', r);

r = await call('POST', '/v1/login', { name, password: 'wrong password' }); ok(r.status === 403, 'wrong password', r);
r = await call('POST', '/v1/login', { name: name + 'x', password: 'correct horse 1' }); ok(r.status === 403, 'unknown name', r);
r = await call('POST', '/v1/login', { name: name.toUpperCase(), password: 'correct horse 1' }); ok(r.status === 200 && r.data.name === name && r.data.token !== token, 'login (name in capitals)', r);
const token2 = r.data.token;
r = await call('GET', '/v1/library', undefined, token2); ok(r.status === 200 && r.data.rev === 2, 'second device sees the library', r);

r = await call('POST', '/v1/password', { old: 'nope', password: 'another pass 2' }, token2); ok(r.status === 403, 'password change needs the old one', r);
r = await call('POST', '/v1/password', { old: 'correct horse 1', password: 'another pass 2' }, token2); ok(r.status === 200, 'password change', r);
r = await call('GET', '/v1/library', undefined, token); ok(r.status === 401, 'other devices are signed out after a password change', r);
r = await call('GET', '/v1/library', undefined, token2); ok(r.status === 200, 'this device stays signed in', r);

r = await call('POST', '/v1/recover', { name, recovery: 'AAAA-BBBB-CCCC', password: 'recovered pw 3' }); ok(r.status === 403, 'wrong recovery code', r);
r = await call('POST', '/v1/recover', { name, recovery: recovery.toLowerCase().replace(/-/g, ' '), password: 'recovered pw 3' }); ok(r.status === 200 && r.data.token, 'recovery code sets a new password', r);
const token3 = r.data.token;
r = await call('GET', '/v1/library', undefined, token2); ok(r.status === 401, 'old sessions end after recovery', r);
r = await call('POST', '/v1/login', { name, password: 'recovered pw 3' }); ok(r.status === 200, 'login with the recovered password', r);
const token4 = r.data.token;
r = await call('POST', '/v1/logout', {}, token4); ok(r.status === 200, 'logout', r);
r = await call('GET', '/v1/library', undefined, token4); ok(r.status === 401, 'logged-out token is dead', r);

r = await call('DELETE', '/v1/account', { password: 'wrong' }, token3); ok(r.status === 403, 'delete needs the password', r);
r = await call('DELETE', '/v1/account', { password: 'recovered pw 3' }, token3); ok(r.status === 200, 'delete account', r);
r = await call('GET', '/v1/library', undefined, token3); ok(r.status === 401, 'token dead after delete', r);
r = await call('POST', '/v1/login', { name, password: 'recovered pw 3' }); ok(r.status === 403, 'deleted account cannot log in', r);
r = await call('GET', '/v1/nothing', undefined, token3); ok(r.status === 401 || r.status === 404, 'unknown path', r);

console.log(pass + ' passed, ' + failed + ' failed  (' + BASE + ')');
process.exit(failed ? 1 : 0);
