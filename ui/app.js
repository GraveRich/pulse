// Pulse UI. Vanilla JS, no framework, no trackers. Two sources:
//   - local files served by the native host (/media, /art)
//   - SoundCloud through its official embedded player (Widget API) kept off-screen
(() => {
'use strict';

// ------------------------------------------------------------------ basics
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const qs = new URLSearchParams(location.search);
const TOKEN = qs.get('k') || '';
const FORCE_MUTE = qs.get('mute') === '1';
const SELFTEST = qs.get('selftest') === '1';
const HDR = { 'X-Pulse-Token': TOKEN };
const ROW = 56;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const api = {
  async get(p) {
    const r = await fetch(p, { headers: HDR });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  },
  async post(p, body) {
    const r = await fetch(p, {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, HDR),
      body: typeof body === 'string' ? body : JSON.stringify(body || {})
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmt = ms => {
  let s = Math.max(0, Math.floor((ms || 0) / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); s %= 60;
  return hh ? hh + ':' + String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0') : mm + ':' + String(s).padStart(2, '0');
};
const fmtTotal = ms => {
  const m = Math.round(ms / 60000);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
};
const hue = s => { let x = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x % 360; };
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const clean = o => JSON.parse(JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v)));
function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const IC = {
  home: 'M12 3 3 10.5V21h6v-6h6v6h6V10.5z',
  search: 'M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25 1.42-1.42-4.25-4.24A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  hearto: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  folder: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  x: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeat1: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  music: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
  video: 'M10 16.5l6-4.5-6-4.5v9zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z',
  cloud: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  user: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  playnext: 'M4 6h12v2H4zm0 4h12v2H4zm0 4h8v2H4zm10 0v6l5-3z',
  refresh: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'
};
const svg = n => '<svg viewBox="0 0 24 24"><path d="' + (IC[n] || '') + '"/></svg>';
const ic = n => '<i data-ic="' + n + '">' + svg(n) + '</i>';
const setIc = (el, n) => { const i = el.matches('i[data-ic]') ? el : $('i[data-ic]', el); if (i && i.dataset.icNow !== n) { i.dataset.ic = n; i.dataset.icNow = n; i.innerHTML = svg(n); } };

function toast(msg, err) {
  const t = h('<div class="toast' + (err ? ' err' : '') + '"></div>');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, err ? 4200 : 2200);
}

// ------------------------------------------------------------------ state
const S = { v: 1, volume: 0.8, muted: false, mediaKeys: true, hideLocked: true, xfade: 4, remote: false, account: { name: '', token: '', rev: 0, sig: '' }, hotkeys: { on: true, keys: null }, shuffle: false, repeat: 'off', liked: [], playlists: [], saved: [], recent: [], searches: [], queue: [], qpos: -1 };
const L = { tracks: [], byId: new Map(), folders: [], scanning: false, done: 0, total: 0, loaded: false };
let saveTimer = 0, stateLoaded = false;
function save() { if (!stateLoaded) return; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 500); }
function flushSave() {
  clearTimeout(saveTimer);
  if (!stateLoaded) return;
  S.queue = P.queue.slice(0, 400);
  S.qpos = P.pos < 400 ? P.pos : -1;
  api.post('/api/state', JSON.stringify(S, (k, v) => (k[0] === '_' ? undefined : v))).catch(() => {});
  ACCT.touch();
}

// ------------------------------------------------------------------ phone remote
// The native host runs a small server on the home network (only when this is switched on in Settings).
// This side reports what is playing ("rcs:<json>") and carries out the commands a paired phone sends ("rc:<json>").
const RC = {
  on: false, info: null, pushT: 0, beat: 0,
  post(m) { const b = window.chrome && window.chrome.webview; if (b) { try { b.postMessage(m); } catch (e) {} } },
  enable(on) {
    this.on = !!on;
    this.post(on ? 'remote:on' : 'remote:off');
    clearInterval(this.beat); this.beat = 0;
    if (on) { this.push(); this.beat = setInterval(() => { if (P.playing) this.push(); }, 5000); }
  },
  push() {
    if (!this.on || this.pushT) return;
    this.pushT = setTimeout(() => { this.pushT = 0; this.post('rcs:' + JSON.stringify(this.state())); }, 60);
  },
  tr(t) { return { k: t.k, title: t.title || '', artist: subOf(t), dur: Math.round(t.dur || 0), art: t.k === 'l' ? (t.art ? 'art/' + t.id : '') : artSrc(t, true) }; },
  state() {
    const c = P.cur;
    return {
      cur: c ? Object.assign(this.tr(c), { liked: isLiked(c) }) : null,
      playing: P.playing, loading: P.loading && !P.playing, t: Math.round(P.t), dur: Math.round(P.dur || 0),
      vol: S.muted ? 0 : S.volume, shuffle: S.shuffle, repeat: S.repeat, pos: P.pos,
      queue: P.queue.slice(P.pos + 1, P.pos + 41).filter(t => !t.drm).map(t => Object.assign(this.tr(t), { i: P.queue.indexOf(t) }))
    };
  },
  run(c) {
    if (!this.on || !c || typeof c !== 'object') return;
    const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
    const yt = x => ((x && typeof x === 'object' && /^[A-Za-z0-9_-]{11}$/.test(String(x.id || '')))
      ? { k: 'yt', id: String(x.id), title: String(x.title || '').slice(0, 200), artist: String(x.artist || '').slice(0, 120), dur: Math.max(0, Math.round(num(x.dur, 0))) } : null);
    switch (c.cmd) {
      case 'toggle': toggle(); break;
      case 'resume': if (P.cur && !P.playing && !P.loading) toggle(); break;
      case 'pause': if (P.playing || P.loading) toggle(); break;
      case 'next': next(false); break;
      case 'prev': prev(); break;
      case 'vol': setVolume(num(c.v, S.volume)); break;
      case 'seek': seek(num(c.ms, 0)); break;
      case 'like': if (P.cur) toggleLike(P.cur); break;
      case 'shuffle': setShuffle(!S.shuffle); break;
      case 'repeat': S.repeat = S.repeat === 'off' ? 'all' : (S.repeat === 'all' ? 'one' : 'off'); updateModes(); save(); break;
      case 'jump': { const i = Math.round(num(c.i, -1)); if (i >= 0 && P.queue[i]) playAt(i); break; }
      case 'play': {
        const list = (Array.isArray(c.tracks) ? c.tracks : []).slice(0, 40).map(yt).filter(Boolean);
        if (list.length) playList(list, Math.max(0, Math.min(list.length - 1, Math.round(num(c.i, 0)))));
        break;
      }
      case 'queue': { const t = yt(c.track); if (t) enqueue([t]); break; }
    }
    this.push();
  }
};

// QR code for the pairing address: version 4, error correction L, byte mode (up to 78 characters), mask 0.
function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > 78) return null;
  const N = 33, DATA = 80, EC = 20;
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, DATA * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xEC; data.length < DATA; pad ^= 0xEC ^ 0x11) data.push(pad);
  // Reed-Solomon over GF(256), polynomial 0x11D
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const div = new Array(EC).fill(0); div[EC - 1] = 1;
  for (let i = 0, rootv = 1; i < EC; i++) {
    for (let j = 0; j < EC; j++) { div[j] = mul(div[j], rootv); if (j + 1 < EC) div[j] ^= div[j + 1]; }
    rootv = mul(rootv, 2);
  }
  const ec = new Array(EC).fill(0);
  for (const b of data) { const f = b ^ ec.shift(); ec.push(0); div.forEach((c, i) => { ec[i] ^= mul(c, f); }); }
  const code = data.concat(ec);
  const m = [], fn = [];
  for (let y = 0; y < N; y++) { m.push(new Array(N).fill(false)); fn.push(new Array(N).fill(false)); }
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < N; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < N && y >= 0 && y < N) set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(N - 4, 3); finder(3, N - 4);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(26 + dx, 26 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // format bits: level L (01) + mask 0, BCH protected
  const fd = 1 << 3;
  let rem = fd;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fb = ((fd << 10) | rem) ^ 0x5412, bit = i => ((fb >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(N - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, N - 15 + i, bit(i));
  set(8, N - 8, true);
  // data, zigzag from the bottom right, then mask 0
  let k = 0;
  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < N; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? N - 1 - vert : vert;
      if (!fn[y][x]) { if (k < code.length * 8) m[y][x] = ((code[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0; k++; }
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!fn[y][x] && (x + y) % 2 === 0) m[y][x] = !m[y][x];
  return m;
}
function qrSvg(text) {
  const m = qrMatrix(text);
  if (!m) return '';
  const n = m.length, q = 4;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
  return '<svg class="qr" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}

// ------------------------------------------------------------------ tracks
// local: {k:'l', id, title, artist, album, dur(ms), art:bool, no, year}
// soundcloud: {k:'sc', url?, sid?, title?, artist?, art?, dur?(ms), snip?}
// youtube: {k:'yt', id, title?, artist?, dur?(ms)}   (drm = YouTube refuses to play it outside youtube.com)
const same = (a, b) => !!a && !!b && a.k === b.k && (a.k !== 'sc' ? a.id === b.id : ((a.sid && b.sid) ? a.sid == b.sid : (!!a.url && a.url === b.url)));
const scUrl = t => (t.url && !/^https:\/\/api\./.test(t.url)) ? t.url : (t.sid ? 'https://api.soundcloud.com/tracks/' + t.sid : t.url);
const isPermalink = u => /^https:\/\/soundcloud\.com\/[^/]+\/.+/.test(u || '');
const artistUrl = t => { const m = /^https:\/\/soundcloud\.com\/([^/?#]+)/.exec(t.url || ''); return m ? 'https://soundcloud.com/' + m[1] : null; };
const subOf = t => t.artist || (t.k === 'sc' ? ((/^https:\/\/soundcloud\.com\/([^/?#]+)/.exec(t.url || '') || [])[1] || 'SoundCloud') : (t.k === 'yt' ? 'YouTube' : 'Unknown artist'));
const ytUrl = t => 'https://www.youtube.com/watch?v=' + t.id;
const srcName = t => (t.k === 'sc' ? 'SoundCloud' : (t.k === 'yt' ? 'YouTube' : ''));
const lockSite = t => (t.k === 'yt' ? 'youtube.com' : 'soundcloud.com');
function artSrc(t, big) {
  if (!t) return '';
  if (t.k === 'l') return t.art ? '/art/' + t.id + '?k=' + TOKEN : '';
  if (t.k === 'yt') return 'https://i.ytimg.com/vi/' + t.id + '/mqdefault.jpg';
  if (!t.art) return '';
  return String(t.art).replace(/-(large|t\d+x\d+|crop|original|badge|small|tiny|mini)\.(jpg|png)/, big ? '-t500x500.$2' : '-large.$2');
}
function artHtml(t, cls, big) {
  const src = artSrc(t, big);
  return '<div class="art ph ' + (cls || '') + '" style="--h:' + hue(t && (t.title || t.url || t.sid)) + '">' + ic('music') +
    (src ? '<img loading="lazy" draggable="false" src="' + esc(src) + '" onerror="this.remove()">' : '') + '</div>';
}
function imgArt(url, icon, cls, seed) {
  return '<div class="art ph ' + (cls || '') + '" style="--h:' + hue(seed) + '">' + ic(icon || 'music') +
    (url ? '<img loading="lazy" draggable="false" src="' + esc(url) + '" onerror="this.remove()">' : '') + '</div>';
}
function applySound(t, s) {
  t.sid = s.id;
  if (s.permalink_url) t.url = s.permalink_url;
  if (s.title) t.title = s.title;
  if (s.user && s.user.username) t.artist = s.user.username;
  t.art = s.artwork_url || (s.user && s.user.avatar_url) || t.art || '';
  if (s.duration) t.dur = s.duration;
  if (s.policy === 'SNIP') t.snip = true; else delete t.snip;
  // label releases that SoundCloud only serves DRM-encrypted: its licence server refuses embedded players, so they can't play here
  const tr = s.media && s.media.transcodings;
  if (tr && tr.length && tr.every(x => /encrypted/.test((x.format && x.format.protocol) || ''))) t.drm = true; else delete t.drm;
  t.chk = 1;
  return t;
}
function propagate(t) {
  const pools = [S.liked, S.recent].concat(S.playlists.map(p => p.tracks), [P.queue]);
  for (const pool of pools) for (const x of pool) {
    if (x !== t && same(x, t)) for (const k of ['sid', 'url', 'title', 'artist', 'art', 'dur', 'snip', 'drm', 'chk']) if (t[k] != null && t[k] !== '') x[k] = t[k];
  }
}

// oEmbed lookups (official endpoint, proxied + cached by the host), newest request first
const OE = {
  cache: new Map(), q: [], active: 0,
  get(url) {
    let p = this.cache.get(url);
    if (!p) { p = new Promise(res => this.q.push({ url, res })); this.cache.set(url, p); this.pump(); }
    return p;
  },
  pump() {
    while (this.active < 4 && this.q.length) {
      const j = this.q.pop();
      this.active++;
      api.get('/api/sc/oembed?url=' + encodeURIComponent(j.url)).then(m => j.res(m), () => j.res(null)).finally(() => { this.active--; this.pump(); });
    }
  }
};
function ensureMeta(t) {
  if (t.k !== 'sc' || t._m || (t.title && t.artist && t.art)) return;
  const url = scUrl(t);
  if (!url) return;
  t._m = 1;
  OE.get(url).then(m => {
    if (!m) return;
    if (!t.title && m.title) t.title = m.title;
    if (!t.artist && m.author) t.artist = m.author;
    if (!t.art && m.thumb) t.art = m.thumb;
    if (!t.sid && m.kind === 'track' && m.id) t.sid = m.id;
    for (const l of lists) l.update(t);
    if (t === P.cur) updateBar();
    if (!$('#queue').hidden && P.queue.includes(t)) { clearTimeout(ensureMeta.qT); ensureMeta.qT = setTimeout(renderQueue, 150); }
  });
}

// ------------------------------------------------------------------ player
const audio = $('#audio');
const P = { queue: [], orig: null, pos: -1, cur: null, playing: false, loading: false, pending: false, t: 0, dur: 0, gen: 0, errs: 0, watch: 0 };
const outVol = () => (FORCE_MUTE || S.muted) ? 0 : S.volume * S.volume;
function applyVolume() {
  audio.volume = outVol();
  if (SCW.w && SCW.isReady) SCW.w.setVolume(Math.round(outVol() * 100));
  YTP.volume();
}

const LOADOPTS = { auto_play: false, buying: false, sharing: false, download: false, show_comments: false, show_playcount: false, show_teaser: false, hide_related: true, visual: false, single_active: false };
const SCW = {
  w: null, isReady: false, onReady: null, loadedGen: -1, libP: null, userPaused: false, stallT: 0,
  lib() {
    return this.libP || (this.libP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://w.soundcloud.com/player/api.js';
      s.onload = res;
      s.onerror = () => { this.libP = null; s.remove(); rej(new Error('offline')); };
      document.head.appendChild(s);
    }));
  },
  make(id, url) {
    const f = document.createElement('iframe');
    f.id = id; f.allow = 'autoplay; encrypted-media';
    const q = Object.keys(LOADOPTS).map(k => k + '=' + LOADOPTS[k]).join('&');
    f.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) + '&' + q;
    $('#sc-holder').appendChild(f);
    return f;
  },
  async load(t, autoplay, gen) {
    const url = scUrl(t);
    try { await this.lib(); }
    catch (e) { if (gen === P.gen) trackError("Can't reach SoundCloud. Check your connection.", true); return; }
    if (gen !== P.gen) return;
    const done = () => {
      if (gen !== P.gen) return;
      this.loadedGen = gen;
      this.userPaused = false;
      applyVolume();
      this.w.getCurrentSound(s => {
        if (gen !== P.gen) return;
        if (!s) { trackError("SoundCloud can't play this track in the embedded player."); return; }
        applySound(t, s); propagate(t);
        P.dur = s.duration || P.dur;
        updateBar(); updateMediaSession(); renderQueue(); save();
        for (const l of lists) l.update(t);
        if (t.drm) { dropLocked(t); lockedSkip(); return; }
        if (autoplay) this.w.play();
      });
    };
    if (!this.w) {
      const w = this.w = SC.Widget(this.make('sc-player', url));
      const E = SC.Widget.Events;
      w.bind(E.READY, () => { this.isReady = true; const cb = this.onReady; this.onReady = null; if (cb) cb(); });
      w.bind(E.PLAY, () => {
        if (!P.cur || P.cur.k !== 'sc') { w.pause(); return; }
        if (this.loadedGen !== P.gen) return;
        P.playing = true; P.loading = false; P.errs = 0; P.lockedRun = 0; clearTimeout(P.watch);
        applyVolume(); onPlayState();
      });
      w.bind(E.PAUSE, () => {
        if (!(P.cur && P.cur.k === 'sc' && this.loadedGen === P.gen)) return;
        P.playing = false; onPlayState();
        if (!this.userPaused && P.t < 400) {
          // the player gave up right at the start: SoundCloud won't stream this one here
          const gen = P.gen;
          clearTimeout(this.stallT);
          this.stallT = setTimeout(() => {
            if (gen === P.gen && !P.playing && P.t < 400 && !this.userPaused) trackError("SoundCloud won't stream “" + (P.cur.title || 'this track') + "” in its embedded player.");
          }, 1800);
        }
      });
      w.bind(E.PLAY_PROGRESS, e => {
        if (!P.cur || P.cur.k !== 'sc' || this.loadedGen !== P.gen) return;
        if (P.cur.sid && e.soundId && e.soundId != P.cur.sid) return;
        P.t = e.currentPosition; onProgress();
      });
      w.bind(E.FINISH, () => { if (P.cur && P.cur.k === 'sc' && this.loadedGen === P.gen) next(true); });
      w.bind(E.ERROR, () => { if (P.cur && P.cur.k === 'sc') trackError("SoundCloud can't play this track in the embedded player."); });
      this.onReady = done;
    } else if (!this.isReady) {
      this.onReady = () => this.w.load(url, Object.assign({ callback: done }, LOADOPTS));
    } else {
      this.w.load(url, Object.assign({ callback: done }, LOADOPTS));
    }
  }
};

// YouTube plays in two official players. One is heard; the other loads the following song in advance
// (silent, held at the start), so a song change is a swap instead of a load, and the two can crossfade.
const YTP = {
  pl: [0, 1].map(i => ({ i, p: null, ready: false, id: '', t: null, mode: 'idle' })), // mode: idle | play | pre | preok | fade
  act: 0, gain: [1, 1], libP: null, tick: 0, fadeIv: 0, fadeNext: 0,
  get a() { return this.pl[this.act]; },
  get b() { return this.pl[1 - this.act]; },
  get p() { return this.a.p; },
  get ready() { return this.a.ready; },
  lib() {
    return this.libP || (this.libP = new Promise((res, rej) => {
      window.onYouTubeIframeAPIReady = () => res();
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { this.libP = null; s.remove(); rej(new Error('offline')); };
      document.head.appendChild(s);
    }));
  },
  show() {
    $('#yt-box').hidden = !(P.cur && P.cur.k === 'yt' && !P.pending && !!this.a.p);
    for (const x of this.pl) { const f = document.getElementById('yt-player-' + x.i); if (f) f.classList.toggle('on', x.i === this.act); }
  },
  vidOf(x) { try { return (x.p.getVideoData() || {}).video_id || ''; } catch (e) { return ''; } },
  vol(x) {
    if (!x.p || !x.ready) return;
    try { x.p.setVolume(Math.round(outVol() * 100 * this.gain[x.i])); if (x.p.isMuted()) x.p.unMute(); } catch (e) {}
  },
  volume() { for (const x of this.pl) if (x.mode === 'play' || x.mode === 'fade') this.vol(x); },
  quiet(x) { if (x.p && x.ready) { try { x.p.pauseVideo(); } catch (e) {} } },
  make(x, id, autoplay) {
    x.id = id; x.ready = false;
    x.p = new YT.Player('yt-player-' + x.i, {
      width: '100%', height: '100%', videoId: id,
      playerVars: { autoplay: autoplay ? 1 : 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, origin: location.origin },
      events: { onReady: () => this.onReady(x), onStateChange: e => this.state(x, e.data), onError: e => this.error(x, e.data) }
    });
  },
  onReady(x) {
    x.ready = true;
    if (x.mode === 'play') {
      this.vol(x);
      const c = P.cur;
      if (c && c.k === 'yt' && !P.pending) { if (this.vidOf(x) !== c.id) { x.id = c.id; x.p.loadVideoById(c.id); } else x.p.playVideo(); }
      else x.p.pauseVideo();
    } else if (x.mode === 'pre') { try { x.p.setVolume(0); x.p.loadVideoById(x.id); } catch (e) {} }
    this.show();
  },
  stop() {
    clearInterval(this.tick); this.tick = 0;
    this.endFade();
    this.quiet(this.a);
  },
  endFade() {
    if (!this.fadeIv) return;
    clearInterval(this.fadeIv); this.fadeIv = 0;
    const o = this.b;
    if (o.mode === 'fade') { o.mode = 'idle'; o.id = ''; this.quiet(o); }
    this.gain[0] = 1; this.gain[1] = 1;
    this.vol(this.a);
  },
  // the song that will follow the current one, when it is a YouTube song that can be loaded in advance
  nextUp() {
    if (S.repeat === 'one' || !P.queue.length) return null;
    let i = P.pos + 1;
    while (i < P.queue.length && P.queue[i].k !== 'l' && P.queue[i].drm) i++;
    let direct = i === P.pos + 1;
    if (i >= P.queue.length) { if (S.repeat !== 'all' || P.queue.length < 2) return null; i = 0; direct = P.pos + 1 >= P.queue.length; }
    const t = P.queue[i];
    return (t && t.k === 'yt' && !t.drm && t !== P.cur) ? { t, direct } : null;
  },
  preload(x, t) {
    x.mode = 'pre'; x.id = t.id; x.t = t;
    if (!x.p) this.make(x, t.id, false);
    else if (x.ready) { try { x.p.setVolume(0); x.p.loadVideoById(t.id); } catch (e) {} }
  },
  async load(t, gen) {
    try { await this.lib(); }
    catch (e) { if (gen === P.gen) trackError("Can't reach YouTube. Check your connection.", true); return; }
    if (gen !== P.gen) return;
    const fadeMs = this.fadeNext; this.fadeNext = 0;
    this.endFade();
    const a = this.a, b = this.b;
    if (b.p && b.id === t.id && (b.mode === 'preok' || b.mode === 'pre')) {
      // already loaded in the other player: swap the two
      this.act = b.i; b.mode = 'play';
      if (fadeMs > 0 && a.ready && b.ready) {
        a.mode = 'fade'; this.gain[b.i] = 0; this.gain[a.i] = 1;
        const t0 = performance.now();
        this.fadeIv = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / fadeMs);
          this.gain[b.i] = k; this.gain[a.i] = 1 - k;
          this.vol(a); this.vol(b);
          if (k >= 1) this.endFade();
        }, 60);
      } else { a.mode = 'idle'; a.id = ''; this.quiet(a); this.gain[b.i] = 1; }
      if (b.ready) { this.vol(b); try { b.p.playVideo(); } catch (e) {} }
    } else {
      a.mode = 'play'; a.id = t.id; this.gain[a.i] = 1;
      if (!a.p) { $('#yt-box').hidden = false; this.make(a, t.id, true); }
      else if (a.ready) { this.vol(a); a.p.loadVideoById(t.id); }
      // not ready yet: onReady loads whatever is current by then
    }
    this.show();
  },
  state(x, s) {
    if (x.mode === 'pre' || x.mode === 'preok') {
      // standby player: once the next song really starts, hold it silent at the beginning
      if (s === 1) { try { x.p.pauseVideo(); x.p.seekTo(0, true); } catch (e) {} x.mode = 'preok'; }
      return;
    }
    if (x.mode === 'fade') { if (s === 0) this.endFade(); return; }
    if (x.mode !== 'play' || x.i !== this.act) { if (s === 1) this.quiet(x); return; }
    const c = P.cur;
    if (!c || c.k !== 'yt' || P.pending) { if (s === 1) this.quiet(x); return; }
    const v = this.vidOf(x);
    if (v && v !== c.id) return;
    if (s === 1) {
      P.playing = true; P.loading = false; P.errs = 0; P.lockedRun = 0; clearTimeout(P.watch);
      const d = x.p.getDuration();
      if (d > 0) { P.dur = d * 1000; if (!c.dur) { c.dur = Math.round(P.dur); propagate(c); for (const l of lists) l.update(c); } }
      this.volume(); onPlayState(); onProgress(true);
      if (!this.tick) this.tick = setInterval(() => this.onTick(), 250);
    } else if (s === 2) { P.playing = false; onPlayState(); }
    else if (s === 3) { if (!P.playing) { P.loading = true; onPlayState(); } }
    else if (s === 0) { P.playing = false; next(true); }
  },
  onTick() {
    const c = P.cur, a = this.a, b = this.b;
    if (!c || c.k !== 'yt' || !a.ready || !P.playing) return;
    if (!seekDrag) { try { P.t = a.p.getCurrentTime() * 1000; } catch (e) { return; } onProgress(); }
    const n = this.nextUp();
    if (!n) return;
    // a moment after a song has started, load the one after it into the other player
    if (P.t > 1500 && b.mode !== 'fade' && b.id !== n.t.id) this.preload(b, n.t);
    // crossfade: hand over early when the end is near and the next song is ready
    const X = (S.xfade || 0) * 1000;
    if (X > 0 && n.direct && !this.fadeIv && b.mode === 'preok' && b.id === n.t.id && P.dur > 30000) {
      const rem = P.dur - P.t;
      if (rem > 300 && rem <= X) { this.fadeNext = rem; next(true); }
    }
  },
  error(x, code) {
    const dead = code === 100 || code === 101 || code === 150; // removed, private, or only allowed on youtube.com
    if (x.mode === 'pre' || x.mode === 'preok') {
      const t = x.t;
      x.mode = 'idle'; // x.id is kept, so the same song is not tried again and again
      if (dead && t && t.id === x.id) { t.drm = true; t.chk = 1; propagate(t); for (const l of lists) l.update(t); dropLocked(t); }
      return;
    }
    if (x.i !== this.act || x.mode !== 'play') return;
    const c = P.cur;
    if (!c || c.k !== 'yt' || P.pending) return;
    if (dead) {
      c.drm = true; c.chk = 1; propagate(c);
      for (const l of lists) l.update(c);
      dropLocked(c); lockedSkip();
    } else trackError("YouTube can't play “" + (c.title || 'this video') + "” here.");
  }
};

function playAt(pos, autoplay) {
  const t = P.queue[pos];
  if (!t) return;
  if (autoplay === undefined) autoplay = true;
  P.pos = pos; P.cur = t; P.t = 0; P.dur = t.dur || 0; P.loading = autoplay; P.playing = false; P.pending = !autoplay;
  const gen = ++P.gen;
  clearTimeout(P.watch);
  if (autoplay && t.k !== 'l' && t.drm) { onTrackChange(); lockedSkip(); return; }
  if (autoplay) {
    if (t.k !== 'yt') YTP.stop();
    if (t.k === 'yt') {
      if (!audio.paused) audio.pause();
      if (SCW.w && SCW.isReady) SCW.w.pause();
      YTP.load(t, gen);
      P.watch = setTimeout(() => { if (gen === P.gen && P.loading) trackError('YouTube took too long to answer.', true); }, 25000);
    } else if (t.k === 'l') {
      if (SCW.w && SCW.isReady) SCW.w.pause();
      audio.src = '/media/' + t.id + '?k=' + TOKEN;
      applyVolume();
      audio.play().catch(e => { if (gen === P.gen && e && e.name !== 'AbortError') trackError("This file can't be played."); });
    } else {
      if (!audio.paused) audio.pause();
      SCW.load(t, true, gen);
      P.watch = setTimeout(() => { if (gen === P.gen && P.loading) trackError('SoundCloud took too long to answer.', true); }, 20000);
    }
    pushRecent(t);
  }
  onTrackChange();
}
function ytDo(fn) { if (YTP.p && YTP.ready) { try { fn(YTP.p); } catch (e) {} } }

function toggle() {
  if (!P.cur) return;
  if (P.pending) { playAt(P.pos, true); return; }
  if (P.cur.k === 'l') { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
  else if (P.cur.k === 'yt') { YTP.endFade(); ytDo(p => { if (P.playing) p.pauseVideo(); else p.playVideo(); }); }
  else if (SCW.w && SCW.isReady) {
    if (P.playing) { SCW.userPaused = true; SCW.w.pause(); }
    else { SCW.userPaused = false; SCW.w.play(); }
  }
}
function seek(ms) {
  if (!P.cur || P.pending) return;
  RC.push();
  ms = Math.max(0, Math.min(ms, Math.max(0, (P.dur || 0) - 500)));
  if (P.cur.k === 'l') { try { audio.currentTime = ms / 1000; } catch (e) {} }
  else if (P.cur.k === 'yt') ytDo(p => p.seekTo(ms / 1000, true));
  else if (SCW.w && SCW.isReady) SCW.w.seekTo(ms);
  P.t = ms; onProgress(true);
}
function next(auto) {
  if (!P.queue.length) return;
  if (auto && S.repeat === 'one') {
    if (P.cur.k === 'l') { audio.currentTime = 0; audio.play().catch(() => {}); }
    else if (P.cur.k === 'yt') ytDo(p => { p.seekTo(0, true); p.playVideo(); });
    else { SCW.w.seekTo(0); SCW.w.play(); }
    return;
  }
  let n = P.pos + 1;
  if (n >= P.queue.length) {
    if (S.repeat === 'all' || !auto) n = 0;
    else { P.playing = false; P.loading = false; P.pending = true; P.t = 0; onPlayState(); onProgress(true); return; }
  }
  playAt(n);
}
function prev() {
  if (!P.queue.length) return;
  if (P.t > 3000 || P.pos <= 0) { if (P.pending) playAt(P.pos); else seek(0); return; }
  playAt(P.pos - 1);
}
function trackError(msg, fatal) {
  const gen = P.gen;
  P.loading = false; P.playing = false; clearTimeout(P.watch);
  toast(msg, true);
  onPlayState();
  if (fatal) { P.pending = true; return; }
  P.errs++;
  if (P.errs < 5 && P.pos + 1 < P.queue.length) setTimeout(() => { if (gen === P.gen) playAt(P.pos + 1); }, 700);
  else P.pending = true;
}

// skips a label-protected SoundCloud track (and any known ones right after it) without counting it as a failure
function lockedSkip() {
  const gen = P.gen;
  P.loading = false; P.playing = false; clearTimeout(P.watch); onPlayState();
  P.lockedRun = (P.lockedRun || 0) + 1;
  if (P.lockedRun === 1) toast('“' + (P.cur.title || 'This track') + '” ' + (P.cur.k === 'yt' ? 'only plays on youtube.com' : 'is label-protected and only plays on soundcloud.com') + '. Skipping.', true);
  let n = P.pos + 1;
  while (n < P.queue.length && P.queue[n].k !== 'l' && P.queue[n].drm) n++;
  if (n < P.queue.length && P.lockedRun < 60) setTimeout(() => { if (gen === P.gen) playAt(n); }, 350);
  else P.pending = true;
}

function playList(tracks, idx, forceShuffle) {
  if (!tracks || !tracks.length) return;
  let list = tracks.slice();
  P.orig = list.slice();
  if (forceShuffle) { S.shuffle = true; idx = Math.floor(Math.random() * list.length); }
  idx = Math.max(0, Math.min(idx || 0, list.length - 1));
  if (S.shuffle) {
    const first = list[idx];
    list.splice(idx, 1);
    shuffleInPlace(list);
    list.unshift(first);
    idx = 0;
  }
  P.queue = list; P.errs = 0;
  playAt(idx);
  updateModes();
}
function playNext(tracks) {
  if (!P.queue.length) return playList(tracks, 0);
  P.queue.splice(P.pos + 1, 0, ...tracks);
  if (P.orig) P.orig.push(...tracks);
  renderQueue(); save();
  toast(tracks.length === 1 ? 'Playing next' : plural(tracks.length, 'track') + ' playing next');
}
function enqueue(tracks) {
  if (!P.queue.length) return playList(tracks, 0);
  P.queue.push(...tracks);
  if (P.orig) P.orig.push(...tracks);
  renderQueue(); save();
  toast(tracks.length === 1 ? 'Added to queue' : plural(tracks.length, 'track') + ' added to queue');
}
function setShuffle(on) {
  S.shuffle = on;
  if (P.queue.length && P.cur) {
    if (on) {
      P.orig = P.queue.slice();
      const rest = shuffleInPlace(P.queue.slice(P.pos + 1));
      P.queue = P.queue.slice(0, P.pos + 1).concat(rest);
    } else if (P.orig) {
      const i = P.orig.indexOf(P.cur);
      if (i >= 0) { P.queue = P.orig.slice(); P.pos = i; }
    }
  }
  updateModes(); renderQueue(); save();
}
function pushRecent(t) {
  S.recent = S.recent.filter(x => !same(x, t));
  S.recent.unshift(t);
  if (S.recent.length > 40) S.recent.length = 40;
  save();
}

// local <audio> events
audio.addEventListener('playing', () => { if (P.cur && P.cur.k === 'l') { P.playing = true; P.loading = false; P.errs = 0; P.lockedRun = 0; onPlayState(); } });
audio.addEventListener('pause', () => { if (P.cur && P.cur.k === 'l' && !audio.ended) { P.playing = false; onPlayState(); } });
audio.addEventListener('waiting', () => { if (P.cur && P.cur.k === 'l') { P.loading = true; onPlayState(); } });
audio.addEventListener('timeupdate', () => {
  if (!P.cur || P.cur.k !== 'l' || P.pending) return;
  P.t = audio.currentTime * 1000;
  if (isFinite(audio.duration) && audio.duration > 0) P.dur = audio.duration * 1000;
  onProgress();
});
audio.addEventListener('ended', () => { if (P.cur && P.cur.k === 'l') next(true); });
audio.addEventListener('error', () => { if (P.cur && P.cur.k === 'l' && audio.getAttribute('src')) trackError("This file can't be played (missing or unsupported format)."); });

// keyboard media keys come from the native host (Windows doesn't route them to embedded web views).
// Pulse only asks for them while it is playing, and gives them back 10 minutes after it stops.
const hostBridge = window.chrome && window.chrome.webview;
const hostMsg = m => { if (hostBridge) { try { hostBridge.postMessage(m); } catch (e) {} } };
let keysOn = false, keysOffT = 0;
function updateKeys() {
  const want = S.mediaKeys !== false && !!P.cur && (P.playing || P.loading);
  if (want) {
    clearTimeout(keysOffT); keysOffT = 0;
    if (!keysOn) { keysOn = true; hostMsg('keys:on'); }
  } else if (keysOn && (S.mediaKeys === false || !keysOffT)) {
    clearTimeout(keysOffT);
    keysOffT = setTimeout(() => { keysOffT = 0; if (S.mediaKeys === false || !(P.playing || P.loading)) { keysOn = false; hostMsg('keys:off'); } }, S.mediaKeys === false ? 0 : 600000);
  }
}
if (hostBridge) hostBridge.addEventListener('message', e => {
  const m = e.data;
  if (m === 'media:toggle' || m === 'hk:toggle') toggle();
  else if (m === 'media:next' || m === 'hk:next') next(false);
  else if (m === 'media:prev' || m === 'hk:prev') prev();
  else if (m === 'media:stop' && P.playing) toggle();
  else if (m === 'hk:volup') setVolume(S.volume + 0.05);
  else if (m === 'hk:voldown') setVolume(S.volume - 0.05);
  else if (m === 'hk:like') { if (P.cur) toggleLike(P.cur); }
  else if (typeof m === 'string' && m.indexOf('rc:') === 0) { try { RC.run(JSON.parse(m.slice(3))); } catch (e) {} }
  else if (typeof m === 'string' && m.indexOf('remote:info:') === 0) {
    try { RC.info = JSON.parse(m.slice(12)); } catch (e) {}
    if (route().name === 'settings' && !HK.cap) render();
  }
  else if (typeof m === 'string' && m.indexOf('hk:result:') === 0) {
    HK.failed = new Set(m.slice(10).split(',').filter(Boolean)); HK.answered = true;
    if (route().name === 'settings' && !HK.cap) render();
  }
});

// global hotkeys (registered by the native host, so they work while a game has the focus)
const HK = {
  cap: null, failed: new Set(), answered: false,
  actions: [['toggle', 'Play / pause'], ['next', 'Next song'], ['prev', 'Previous song'], ['volup', 'Volume up'], ['voldown', 'Volume down'], ['like', 'Like the current song']],
  defaults: {
    toggle: { m: 3, vk: 80, label: 'Ctrl + Alt + P' }, next: { m: 3, vk: 39, label: 'Ctrl + Alt + →' }, prev: { m: 3, vk: 37, label: 'Ctrl + Alt + ←' },
    volup: { m: 3, vk: 38, label: 'Ctrl + Alt + ↑' }, voldown: { m: 3, vk: 40, label: 'Ctrl + Alt + ↓' }
  },
  keys() { return (S.hotkeys && S.hotkeys.keys) || this.defaults; },
  on() { return !!S.hotkeys && S.hotkeys.on !== false; },
  // sends the whole list to the host; off = release everything (used while a new key is being picked)
  apply(off) {
    const k = this.keys(), parts = [];
    if (!off && this.on()) for (const a of this.actions) {
      const b = k[a[0]];
      if (b && b.vk) parts.push(a[0] + '=' + (b.m & 15) + ':' + b.vk + (a[0] === 'volup' || a[0] === 'voldown' ? 'r' : ''));
    }
    hostMsg('hk:' + parts.join(','));
  },
  label(e) {
    const c = e.keyCode;
    let k;
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) k = String.fromCharCode(c);
    else if (c >= 112 && c <= 135) k = 'F' + (c - 111);
    else if (c >= 96 && c <= 105) k = 'Num ' + (c - 96);
    else k = ({ 32: 'Space', 37: '←', 38: '↑', 39: '→', 40: '↓', 106: 'Num *', 107: 'Num +', 109: 'Num -', 110: 'Num .', 111: 'Num /', 19: 'Pause', 45: 'Insert', 46: 'Delete', 145: 'Scroll Lock', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 13: 'Enter', 9: 'Tab', 8: 'Backspace' })[c]
      || ((e.key && e.key !== 'Dead' && e.key !== 'Unidentified') ? (e.key.length === 1 ? e.key.toUpperCase() : e.key) : e.code);
    return (e.ctrlKey ? 'Ctrl + ' : '') + (e.altKey ? 'Alt + ' : '') + (e.shiftKey ? 'Shift + ' : '') + k;
  },
  start(id) { this.cap = id; this.apply(true); render(); },
  stop() { this.cap = null; this.apply(); render(); },
  set(id, b) {
    const k = Object.assign({}, this.keys());
    if (b) for (const a of this.actions) if (a[0] !== id && k[a[0]] && k[a[0]].vk === b.vk && k[a[0]].m === b.m) k[a[0]] = null;
    k[id] = b;
    S.hotkeys = { on: this.on(), keys: k };
    save();
  }
};
window.addEventListener('keydown', e => {
  if (!HK.cap) return;
  e.preventDefault(); e.stopPropagation();
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return;
  if (e.key === 'Escape') { HK.stop(); return; }
  const c = e.keyCode, m = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
  if (!c || c > 254) return;
  const alone = (c >= 112 && c <= 135) || (c >= 96 && c <= 111) || c === 19 || c === 45 || c === 145;
  if (!alone && !(m & 3)) { toast('Add Ctrl or Alt to that key, or pick an F key or a numpad key. A plain key would stop working everywhere else.', true); return; }
  HK.set(HK.cap, { m, vk: c, label: HK.label(e) });
  HK.stop();
}, true);
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !P.cur) return;
  const t = P.cur, art = artSrc(t, true);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || 'Pulse', artist: subOf(t), album: t.album || srcName(t),
      artwork: art ? [{ src: new URL(art, location.href).href, sizes: '500x500' }] : []
    });
  } catch (e) {}
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
  set('play', () => { if (!P.playing) toggle(); });
  set('pause', () => { if (P.playing || P.loading) toggle(); });
  set('previoustrack', () => prev());
  set('nexttrack', () => next(false));
  set('seekto', d => { if (d && d.seekTime != null) seek(d.seekTime * 1000); });
  set('stop', () => { if (P.playing) toggle(); });
}

// ------------------------------------------------------------------ player bar UI
let progRaf = 0, seekDrag = false;
function onProgress(force) {
  if (progRaf && !force) return;
  progRaf = requestAnimationFrame(() => {
    progRaf = 0;
    if (seekDrag) return;
    const r = P.dur ? Math.min(1, P.t / P.dur) : 0;
    setSlider($('#b-seek'), r);
    $('#b-cur').textContent = fmt(P.t);
    $('#b-dur').textContent = P.dur ? fmt(P.dur) : '0:00';
  });
}
function setSlider(el, r) {
  el.firstElementChild.style.width = (r * 100) + '%';
  el.lastElementChild.style.left = (r * 100) + '%';
}
function slider(el, o) {
  const ratio = e => { const b = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (o.enabled && !o.enabled())) return;
    el.setPointerCapture(e.pointerId); el.classList.add('drag');
    if (o.start) o.start();
    let r = ratio(e);
    setSlider(el, r); if (o.live) o.live(r);
    const move = ev => { r = ratio(ev); setSlider(el, r); if (o.live) o.live(r); };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.classList.remove('drag');
      if (o.end) o.end(r);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  if (o.wheel) el.addEventListener('wheel', e => { e.preventDefault(); o.wheel(e.deltaY < 0 ? 1 : -1); }, { passive: false });
}
function onPlayState() {
  RC.push();
  const b = $('#b-play');
  setIc(b, P.playing ? 'pause' : 'play');
  b.classList.toggle('loading', P.loading && !P.playing);
  document.body.classList.toggle('is-playing', P.playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = P.playing ? 'playing' : (P.cur ? 'paused' : 'none');
  updateKeys();
  const q = $('#q-body .cur .icon-btn');
  if (q) setIc(q, P.playing ? 'pause' : 'play');
}
function updateBar() {
  RC.push();
  const t = P.cur;
  const like = $('#b-like'), src = $('#b-src'), art = $('#b-art'), a = $('#b-artist');
  if (!t) {
    $('#b-title').textContent = 'Nothing playing'; a.textContent = 'Pick something to start';
    a.classList.remove('link'); art.className = 'art'; art.innerHTML = ''; like.hidden = true; src.hidden = true;
    document.title = 'Pulse';
    return;
  }
  $('#b-title').textContent = t.title || 'Loading…';
  a.textContent = (t.snip ? 'Preview only · ' : '') + subOf(t);
  a.classList.toggle('link', t.k === 'sc' && !!artistUrl(t));
  const s = artSrc(t, true);
  art.className = 'art ph'; art.style.setProperty('--h', hue(t.title || t.url || t.sid));
  const key = s + '|' + (t.title || '');
  if (art.dataset.key !== key) { art.dataset.key = key; art.innerHTML = ic('music') + (s ? '<img draggable="false" src="' + esc(s) + '" onerror="this.remove()">' : ''); }
  like.hidden = false;
  const lk = isLiked(t);
  like.classList.toggle('on', lk); setIc(like, lk ? 'heart' : 'hearto');
  like.title = lk ? 'Remove from Liked songs' : 'Save to Liked songs';
  src.hidden = t.k === 'l';
  if (t.k !== 'l' && src.dataset.ready !== t.k) { src.dataset.ready = t.k; src.innerHTML = ic(t.k === 'yt' ? 'video' : 'cloud') + '<span>' + srcName(t) + '</span>'; src.title = 'Open this track on ' + srcName(t); }
  document.title = (t.title ? t.title + ' · ' + subOf(t) + ' — ' : '') + 'Pulse';
}
function updateModes() {
  RC.push();
  $('#b-shuffle').classList.toggle('on', S.shuffle);
  const r = $('#b-repeat');
  r.classList.toggle('on', S.repeat !== 'off');
  setIc(r, S.repeat === 'one' ? 'repeat1' : 'repeat');
  r.title = S.repeat === 'off' ? 'Repeat' : (S.repeat === 'all' ? 'Repeating all' : 'Repeating this track');
  const m = $('#b-mute');
  setIc(m, (S.muted || S.volume === 0) ? 'mute' : 'vol');
  setSlider($('#b-vol'), S.muted ? 0 : S.volume);
}
function onTrackChange() {
  YTP.show();
  updateBar(); onPlayState(); onProgress(true); updateMediaSession(); renderQueue();
  for (const l of lists) l.sync();
  save();
}

// ------------------------------------------------------------------ likes / playlists / saved
const isLiked = t => S.liked.some(x => same(x, t));
function toggleLike(t) {
  if (isLiked(t)) { S.liked = S.liked.filter(x => !same(x, t)); toast('Removed from Liked songs'); }
  else { S.liked.unshift(clean(t)); toast('Saved to Liked songs'); }
  save(); renderSide();
  if (same(t, P.cur)) updateBar();
  if (route().name === 'liked') render(); else for (const l of lists) l.sync();
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
async function createPlaylist(tracks) {
  const name = await ask({ title: 'New playlist', text: 'Give your playlist a name.', value: 'My playlist #' + (S.playlists.length + 1), ok: 'Create' });
  if (!name) return null;
  const pl = { id: newId(), name, tracks: (tracks || []).map(clean) };
  S.playlists.push(pl);
  save(); renderSide();
  toast(tracks && tracks.length ? 'Added to ' + name : 'Playlist created');
  return pl;
}
function addToPlaylist(pl, tracks) {
  let added = 0;
  for (const t of tracks) if (!pl.tracks.some(x => same(x, t))) { pl.tracks.push(clean(t)); added++; }
  save(); renderSide();
  toast(added ? 'Added to ' + pl.name : 'Already in ' + pl.name);
  if (route().name === 'playlist' && route().arg === pl.id) render();
}
const savedIndex = url => S.saved.findIndex(x => x.url === url);

// ------------------------------------------------------------------ track list (virtualised)
const lists = new Set();
const hideOn = () => S.hideLocked !== false;
function dropLocked(t) { for (const l of Array.from(lists)) l.drop(t); }
function rowHtml(t, i, Lst) {
  ensureMeta(t);
  if (Lst.o.hide && hideOn()) Check.want(t);
  const liked = isLiked(t);
  const title = t.title ? esc(t.title) : '<span class="skel" style="width:' + (120 + (i * 37) % 90) + 'px"></span>';
  const sub = (t.title || t.artist || t.url) ? esc(subOf(t)) : '<span class="skel" style="width:80px"></span>';
  return '<div class="tr' + (same(t, P.cur) ? ' playing' : '') + (i === Lst.sel ? ' sel' : '') + (t.drm ? ' locked' : '') + '"' + (t.drm ? ' title="This only plays on ' + lockSite(t) + '"' : '') + ' data-i="' + i + '" style="top:' + (i * ROW) + 'px">' +
    '<div class="c-n"><span class="num">' + (i + 1) + '</span><div class="eq"><b></b><b></b><b></b></div><button class="go" data-act="play" tabindex="-1">' + ic(same(t, P.cur) && P.playing ? 'pause' : 'play') + '</button></div>' +
    '<div class="c-main">' + artHtml(t) + '<div class="tt"><div class="t">' + title + '</div><div class="a">' + (t.drm ? '<span class="tag">LOCKED</span>' : (t.snip ? '<span class="tag">PREVIEW</span>' : '')) + sub + '</div></div></div>' +
    '<div class="c-album">' + esc(t.album || srcName(t)) + '</div>' +
    '<div class="c-like"><button class="icon-btn' + (liked ? ' on' : '') + '" data-act="like" tabindex="-1" title="' + (liked ? 'Remove from Liked songs' : 'Save to Liked songs') + '">' + ic(liked ? 'heart' : 'hearto') + '</button></div>' +
    '<div class="c-dur">' + (t.dur ? fmt(t.dur) : '') + '</div>' +
    '<div class="c-more"><button class="icon-btn" data-act="more" tabindex="-1" title="More">' + ic('more') + '</button></div></div>';
}
function TrackList(tracks, o) {
  o = o || {};
  const el = h('<div class="tl' + (o.album ? '' : ' no-album') + '"><div class="tl-head"><div class="c-n">#</div><div>Title</div><div class="c-album">' + (o.albumLabel || 'Album') + '</div><div></div><div class="c-dur">Time</div><div></div></div><div class="tl-rows"></div></div>');
  const rows = $('.tl-rows', el);
  const view = $('#view');
  let hidden0 = 0;
  if (o.hide && hideOn()) for (let i = tracks.length - 1; i >= 0; i--) if (tracks[i].k !== 'l' && tracks[i].drm) { tracks.splice(i, 1); hidden0++; }
  const self = {
    el, tracks, o, sel: -1, from: -1, to: -1, hidden: hidden0,
    // removes a track that turned out to be label-locked (only in lists opened with o.hide)
    drop(t) {
      if (!o.hide || !hideOn()) return;
      let n = 0;
      for (let i = tracks.length - 1; i >= 0; i--) if (tracks[i] === t || same(tracks[i], t)) {
        tracks.splice(i, 1); n++;
        if (self.sel === i) self.sel = -1; else if (self.sel > i) self.sel--;
      }
      if (!n) return;
      self.hidden += n;
      self.layout();
      if (o.onHide) o.onHide(self.hidden, tracks.length);
    },
    draw(force) {
      if (!el.isConnected) return;
      const top = rows.getBoundingClientRect().top - view.getBoundingClientRect().top;
      let a = Math.max(0, Math.floor(-top / ROW) - 8), b = Math.min(tracks.length, Math.ceil((view.clientHeight - top) / ROW) + 8);
      if (b < a) b = a;
      if (!force && a === self.from && b === self.to) return;
      self.from = a; self.to = b;
      let html = '';
      for (let i = a; i < b; i++) html += rowHtml(tracks[i], i, self);
      rows.innerHTML = html;
    },
    layout() { rows.style.height = (tracks.length * ROW) + 'px'; self.draw(true); },
    update(t) {
      for (const r of Array.from(rows.children)) { const i = +r.dataset.i; if (tracks[i] === t) r.outerHTML = rowHtml(t, i, self); }
    },
    sync() {
      for (const r of rows.children) {
        const i = +r.dataset.i, t = tracks[i];
        if (!t) continue;
        const pl = same(t, P.cur);
        r.classList.toggle('playing', pl);
        r.classList.toggle('sel', i === self.sel);
        const lk = isLiked(t), lb = $('[data-act=like]', r);
        if (lb.classList.contains('on') !== lk) { lb.classList.toggle('on', lk); setIc(lb, lk ? 'heart' : 'hearto'); }
        setIc($('[data-act=play]', r), pl && P.playing ? 'pause' : 'play');
      }
    },
    playFrom(i) { playList(tracks, i); }
  };
  const rowOf = e => { const r = e.target.closest('.tr'); return r ? +r.dataset.i : -1; };
  el.addEventListener('click', e => {
    const i = rowOf(e); if (i < 0) return;
    const t = tracks[i], act = (e.target.closest('[data-act]') || {}).dataset;
    if (act && act.act === 'play') { if (same(t, P.cur) && !P.pending) toggle(); else self.playFrom(i); }
    else if (act && act.act === 'like') toggleLike(t);
    else if (act && act.act === 'more') { const b = e.target.closest('button').getBoundingClientRect(); trackMenu(t, self, i, b.left, b.bottom + 4); }
    else { self.sel = i; self.sync(); }
  });
  el.addEventListener('dblclick', e => { const i = rowOf(e); if (i >= 0 && !e.target.closest('button')) self.playFrom(i); });
  el.addEventListener('contextmenu', e => { const i = rowOf(e); if (i < 0) return; e.preventDefault(); self.sel = i; self.sync(); trackMenu(tracks[i], self, i, e.clientX, e.clientY); });
  lists.add(self);
  // lay out as soon as the caller has attached us (microtask), with a frame-based retry as backup
  Promise.resolve().then(() => { self.layout(); if (self.hidden && o.onHide) o.onHide(self.hidden, tracks.length); });
  requestAnimationFrame(() => { if (self.from < 0) self.layout(); });
  return self;
}
$('#view').addEventListener('scroll', () => { for (const l of lists) l.draw(); }, { passive: true });
window.addEventListener('resize', () => { for (const l of lists) l.draw(); });

// ------------------------------------------------------------------ menus / dialogs
function showMenu(items, x, y) {
  const m = $('#menu');
  m.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.appendChild(h('<div class="sep"></div>')); continue; }
    if (it.lbl) { const d = h('<div class="lbl"></div>'); d.textContent = it.lbl; m.appendChild(d); continue; }
    const b = h('<button' + (it.danger ? ' class="danger"' : '') + '>' + ic(it.ic || 'check') + '<span></span></button>');
    b.lastChild.textContent = it.label;
    b.addEventListener('click', () => { hideMenu(); it.fn(); });
    m.appendChild(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function hideMenu() { $('#menu').hidden = true; }
document.addEventListener('pointerdown', e => { if (!$('#menu').hidden && !e.target.closest('#menu')) hideMenu(); }, true);
window.addEventListener('blur', hideMenu);
$('#view').addEventListener('scroll', hideMenu, { passive: true });

function copyText(s) {
  const done = () => toast('Link copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, legacy); else legacy();
  function legacy() {
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.cssText = 'position:fixed;left:-999px;user-select:text'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast("Couldn't copy the link", true); }
    ta.remove();
  }
}
function trackMenu(t, Lst, i, x, y) {
  const liked = isLiked(t);
  const items = [
    { ic: 'playnext', label: 'Play next', fn: () => playNext([t]) },
    { ic: 'queue', label: 'Add to queue', fn: () => enqueue([t]) },
    { sep: 1 },
    { ic: liked ? 'heart' : 'hearto', label: liked ? 'Remove from Liked songs' : 'Save to Liked songs', fn: () => toggleLike(t) },
    { lbl: 'Add to playlist' },
    { ic: 'plus', label: 'New playlist…', fn: () => createPlaylist([t]) }
  ];
  for (const pl of S.playlists) items.push({ ic: 'list', label: pl.name, fn: () => addToPlaylist(pl, [t]) });
  const pl = Lst && Lst.o.playlist;
  if (pl) {
    items.push({ sep: 1 });
    if (i > 0) items.push({ ic: 'up', label: 'Move up', fn: () => { pl.tracks.splice(i - 1, 0, pl.tracks.splice(i, 1)[0]); save(); render(); } });
    if (i < pl.tracks.length - 1) items.push({ ic: 'down', label: 'Move down', fn: () => { pl.tracks.splice(i + 1, 0, pl.tracks.splice(i, 1)[0]); save(); render(); } });
    items.push({ ic: 'trash', label: 'Remove from this playlist', danger: 1, fn: () => { pl.tracks.splice(i, 1); save(); renderSide(); render(); } });
  }
  items.push({ sep: 1 });
  if (t.k === 'yt') {
    items.push({ ic: 'video', label: 'Open on YouTube', fn: () => api.post('/api/open', { url: ytUrl(t) }).catch(() => {}) });
    items.push({ ic: 'link', label: 'Copy link', fn: () => copyText(ytUrl(t)) });
  } else if (t.k === 'sc') {
    const au = artistUrl(t);
    if (au && isPermalink(t.url)) items.push({ ic: 'user', label: 'Go to artist', fn: () => go('set', { url: au, kind: 'artist' }) });
    if (isPermalink(t.url)) {
      items.push({ ic: 'cloud', label: 'Open on SoundCloud', fn: () => api.post('/api/open', { url: t.url }).catch(() => {}) });
      items.push({ ic: 'link', label: 'Copy link', fn: () => copyText(t.url) });
    }
  } else {
    if (t.album) items.push({ ic: 'list', label: 'Go to album', fn: () => go('album', t.album) });
    items.push({ ic: 'folder', label: 'Show in folder', fn: () => api.post('/api/reveal', { id: t.id }).catch(() => {}) });
  }
  if (items[items.length - 1].sep) items.pop();
  showMenu(items, x, y);
}
function modal(html) {
  const m = $('#modal');
  m.innerHTML = '<div class="box">' + html + '</div>';
  m.hidden = false;
  return m;
}
function ask(o) {
  return new Promise(res => {
    const m = modal('<h3></h3><p></p><input type="text" maxlength="80" spellcheck="false"><div class="row"><button class="btn" data-x="no">Cancel</button><button class="btn primary" data-x="ok"></button></div>');
    $('h3', m).textContent = o.title; $('p', m).textContent = o.text || ''; $('[data-x=ok]', m).textContent = o.ok || 'OK';
    const inp = $('input', m); inp.value = o.value || ''; inp.focus(); inp.select();
    const close = v => { m.hidden = true; m.innerHTML = ''; m.onclick = m.onkeydown = null; res(v); };
    m.onclick = e => { const x = e.target.dataset.x; if (x === 'ok') close(inp.value.trim() || null); else if (x === 'no' || e.target === m) close(null); };
    m.onkeydown = e => { if (e.key === 'Enter') close(inp.value.trim() || null); else if (e.key === 'Escape') close(null); e.stopPropagation(); };
  });
}
function confirmBox(o) {
  return new Promise(res => {
    const m = modal('<h3></h3><p></p><div class="row"><button class="btn" data-x="no">Cancel</button><button class="btn primary" data-x="ok"></button></div>');
    $('h3', m).textContent = o.title; $('p', m).textContent = o.text || ''; $('[data-x=ok]', m).textContent = o.ok || 'OK';
    $('[data-x=ok]', m).focus();
    const close = v => { m.hidden = true; m.innerHTML = ''; m.onclick = m.onkeydown = null; res(v); };
    m.onclick = e => { const x = e.target.dataset.x; if (x === 'ok') close(true); else if (x === 'no' || e.target === m) close(false); };
    m.onkeydown = e => { if (e.key === 'Escape') close(false); e.stopPropagation(); };
  });
}

// ------------------------------------------------------------------ new version notice
// Looks at the newest release on GitHub once per start and offers the download page when it is newer.
const UPDATE = {
  api: 'https://api.github.com/repos/GraveRich/pulse/releases/latest', page: 'https://github.com/GraveRich/pulse/releases/latest', latest: '',
  newer(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; },
  async check() {
    try {
      const r = await fetch(this.api, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const v = String((await r.json()).tag_name || '').replace(/^v/, '');
      if (/^\d+\.\d+\.\d+$/.test(v) && this.newer(v, INFO.version || '0.0.0')) {
        this.latest = v;
        if ($('#modal').hidden && !HK.cap && ['home', 'settings'].includes(route().name)) render();
      }
    } catch (e) {}
  },
  banner() { return this.latest ? '<div class="set-row upd"><i data-ic="refresh">' + svg('refresh') + '</i><div class="p">Pulse ' + esc(this.latest) + ' is out<small>You have ' + esc(INFO.version || '') + '. Updates keep YouTube playing when it changes.</small></div><button class="btn primary" data-update="1">Download</button></div>' : ''; }
};
document.addEventListener('click', e => { if (e.target.closest('[data-update]')) api.post('/api/open', { url: UPDATE.page }).catch(() => {}); });

// ------------------------------------------------------------------ account
// Optional Pulse account: an online copy of liked songs, playlists and saved SoundCloud pages (server/ in the
// repo), so a new PC or a reinstall does not lose them. Songs from the user's own files never leave the PC.
const ACCT = {
  api: (qs.get('debug') === '1' && qs.get('acctapi')) || 'https://pulse-accounts.dgt-license-server.workers.dev',
  busy: false, timer: 0, at: 0, error: '',
  get me() { return (S.account && S.account.token) ? S.account : null; },
  async call(method, path, body, token) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let r;
    try { r = await fetch(this.api + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { return { status: 0, data: { error: "Can't reach the account server. Check your connection." } }; }
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { status: r.status, data: data || {} };
  },
  sig(text) { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return text.length + ':' + (h >>> 0).toString(36); },
  // one song in the shape that is stored online (also the filter for anything coming back from the server)
  track(x) {
    if (!x || typeof x !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : '');
    const o = { k: x.k };
    if (x.k === 'yt') { if (!/^[A-Za-z0-9_-]{11}$/.test(String(x.id || ''))) return null; o.id = String(x.id); }
    else if (x.k === 'sc') {
      const u = str(x.url, 300);
      if (/^https:\/\/(api\.)?soundcloud\.com\//.test(u)) o.url = u;
      if (typeof x.sid === 'number' && isFinite(x.sid)) o.sid = x.sid;
      if (!o.url && !o.sid) return null;
    } else return null;
    const title = str(x.title, 300), artist = str(x.artist, 200), art = str(x.art, 400);
    if (title) o.title = title;
    if (artist) o.artist = artist;
    if (/^https:\/\//.test(art)) o.art = art;
    if (typeof x.dur === 'number' && isFinite(x.dur) && x.dur > 0) o.dur = Math.round(x.dur);
    if (x.snip === true) o.snip = true;
    if (x.drm === true) o.drm = true;
    return o;
  },
  norm(d) {
    d = (d && typeof d === 'object') ? d : {};
    const tracks = a => (Array.isArray(a) ? a.map(x => this.track(x)).filter(Boolean) : []);
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return {
      v: 1,
      liked: tracks(d.liked),
      playlists: (Array.isArray(d.playlists) ? d.playlists : []).filter(p => p && /^[A-Za-z0-9]{1,40}$/.test(String(p.id || ''))).map(p => ({ id: String(p.id), name: str(p.name, 100) || 'Playlist', tracks: tracks(p.tracks) })),
      saved: (Array.isArray(d.saved) ? d.saved : []).filter(x => x && /^https:\/\/soundcloud\.com\//.test(str(x.url, 300)) && (x.kind === 'set' || x.kind === 'artist'))
        .map(x => ({ url: str(x.url, 300), kind: x.kind, title: str(x.title, 200), author: str(x.author, 200), art: /^https:\/\//.test(str(x.art, 400)) ? str(x.art, 400) : '' }))
    };
  },
  payload() { return this.norm({ liked: S.liked, playlists: S.playlists, saved: S.saved }); },
  // another device changed things and this one has changes too: keep everything from both
  merge(d) {
    const n = this.norm(d);
    const add = (list, extra) => { for (const x of extra) if (!list.some(y => same(y, x))) list.push(x); };
    add(S.liked, n.liked);
    for (const rp of n.playlists) {
      const lp = S.playlists.find(p => p.id === rp.id);
      if (lp) add(lp.tracks, rp.tracks); else S.playlists.push(rp);
    }
    for (const x of n.saved) if (!S.saved.some(y => y.url === x.url)) S.saved.push(x);
  },
  // this device had nothing new: take the online copy as it is (songs from local files stay where they are)
  apply(d) {
    const n = this.norm(d), loc = t => t.k === 'l';
    const keep = (old, fresh) => fresh.map(x => old.find(y => !loc(y) && same(y, x)) || x).concat(old.filter(loc));
    S.liked = keep(S.liked, n.liked);
    const byId = new Map(S.playlists.map(p => [p.id, p]));
    S.playlists = n.playlists.map(rp => ({ id: rp.id, name: rp.name, tracks: keep(byId.has(rp.id) ? byId.get(rp.id).tracks : [], rp.tracks) }));
    S.saved = n.saved;
  },
  refresh() {
    renderSide();
    if (!$('#modal').hidden || HK.cap) return;
    if (['liked', 'playlist', 'home', 'settings'].includes(route().name)) render();
  },
  // called after every save of the app state: if the library changed, push it a few seconds later
  touch() {
    const me = this.me;
    if (!me || !stateLoaded || this.busy) return;
    if (this.sig(JSON.stringify(this.payload())) === me.sig) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), Math.max(5000, 8000 - (Date.now() - this.at)));
  },
  async sync() {
    const me = this.me;
    if (!me || this.busy) return false;
    this.busy = true; clearTimeout(this.timer);
    let done = false, changed = false;
    try {
      for (let tries = 0; tries < 4 && !done; tries++) {
        const r = await this.call('GET', '/v1/library', undefined, me.token);
        if (this.me !== me) return false; // signed out meanwhile
        if (r.status === 401) { this.dropped(); return false; }
        if (r.status !== 200) { this.error = r.data.error || 'The account server did not answer.'; return false; }
        let rev = r.data.rev || 0;
        const remote = r.data.data ? JSON.stringify(this.norm(r.data.data)) : '';
        const before = JSON.stringify(this.payload());
        if (remote && remote !== before && rev !== me.rev) {
          // the online copy moved on since this PC last saved
          if (this.sig(before) !== me.sig || !me.rev) this.merge(r.data.data); else this.apply(r.data.data);
          changed = true;
        }
        const out = JSON.stringify(this.payload());
        if (out !== remote) {
          const w = await this.call('PUT', '/v1/library', { rev, data: JSON.parse(out) }, me.token);
          if (this.me !== me) return false;
          if (w.status === 409) continue; // another device saved in between: look again
          if (w.status === 401) { this.dropped(); return false; }
          if (w.status !== 200) { this.error = w.data.error || 'Could not save online.'; return false; }
          rev = w.data.rev;
        }
        me.rev = rev; me.sig = this.sig(out); this.at = Date.now(); this.error = '';
        done = true;
      }
      if (!done) this.error = 'Could not save online. It will try again.';
      return done;
    } finally {
      this.busy = false;
      if (this.me === me) save();
      if (changed) this.refresh();
      else if (route().name === 'settings' && $('#modal').hidden && !HK.cap) render();
    }
  },
  signedIn(name, token) { S.account = { name, token, rev: 0, sig: '' }; this.error = ''; save(); return this.sync(); },
  clear() { clearTimeout(this.timer); S.account = { name: '', token: '', rev: 0, sig: '' }; this.error = ''; save(); },
  dropped() { this.clear(); toast('You were signed out of your Pulse account. Log in again in Settings.', true); },
  async logout() { const me = this.me; if (!me) return; this.clear(); await this.call('POST', '/v1/logout', {}, me.token); },
  start() {
    if (this.me) setTimeout(() => this.sync(), 1500);
    setInterval(() => { if (this.me) this.sync(); }, 300000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.me && Date.now() - this.at > 60000) this.sync(); });
  }
};

// a small form in the modal box; `submit` gets the values and returns an error text, or nothing when it worked
function formBox(o) {
  return new Promise(res => {
    const m = modal('<h3></h3><p></p>' + o.fields.map(f => '<label class="fl"><span></span><input name="' + f.key + '" type="' + (f.type || 'text') + '" maxlength="' + (f.max || 100) + '" spellcheck="false" autocomplete="off"></label>').join('') +
      '<div class="err"></div><div class="row"><button class="btn" data-x="no">Cancel</button><button class="btn primary' + (o.danger ? ' danger' : '') + '" data-x="ok"></button></div>');
    $('h3', m).textContent = o.title; $('p', m).textContent = o.text || ''; $('[data-x=ok]', m).textContent = o.ok || 'OK';
    const inputs = $$('input', m);
    o.fields.forEach((f, i) => { m.querySelectorAll('.fl span')[i].textContent = f.label; inputs[i].value = f.value || ''; });
    inputs[0].focus();
    let busy = false;
    const close = v => { m.hidden = true; m.innerHTML = ''; m.onclick = m.onkeydown = null; res(v); };
    const go = async () => {
      if (busy) return;
      const vals = {};
      inputs.forEach(i => { vals[i.name] = i.type === 'password' ? i.value : i.value.trim(); });
      busy = true; $('[data-x=ok]', m).classList.add('loading'); $('.err', m).textContent = '';
      let err;
      try { err = await o.submit(vals); } catch (e) { err = 'Something went wrong. Try again.'; }
      busy = false;
      if (m.hidden) return;
      $('[data-x=ok]', m).classList.remove('loading');
      if (err) $('.err', m).textContent = err; else close(true);
    };
    m.onclick = e => { const x = e.target.dataset.x; if (x === 'ok') go(); else if ((x === 'no' || e.target === m) && !busy) close(false); };
    m.onkeydown = e => { if (e.key === 'Enter') go(); else if (e.key === 'Escape' && !busy) close(false); e.stopPropagation(); };
  });
}
function showRecovery(code) {
  return new Promise(res => {
    const m = modal('<h3>Write this code down</h3><p>It is the only way back into your account if you forget your password. Pulse cannot show it again.</p><div class="recovery"></div><div class="row"><button class="btn" data-x="copy">Copy</button><button class="btn primary" data-x="ok">I saved it</button></div>');
    $('.recovery', m).textContent = code;
    m.onclick = e => { const x = e.target.dataset.x; if (x === 'copy') copyText(code); else if (x === 'ok') { m.hidden = true; m.innerHTML = ''; m.onclick = m.onkeydown = null; res(); } };
    m.onkeydown = e => e.stopPropagation();
  });
}
async function accountDialog(mode) {
  const U = { key: 'name', label: 'Username', max: 20 }, PW = { key: 'password', label: mode === 'login' ? 'Password' : (mode === 'recover' ? 'New password' : 'Password (8 characters or more)'), type: 'password' };
  let recovery = '';
  const ok = await formBox({
    title: mode === 'signup' ? 'Create your Pulse account' : (mode === 'login' ? 'Log in' : 'Forgot your password'),
    text: mode === 'signup' ? 'Free, no email. Your liked songs and playlists get saved online.' : (mode === 'login' ? 'Your liked songs and playlists are added to this PC.' : 'Type your username, the recovery code you got when you created the account, and a new password.'),
    fields: mode === 'recover' ? [U, { key: 'recovery', label: 'Recovery code', max: 20 }, PW] : [U, PW],
    ok: mode === 'signup' ? 'Create account' : (mode === 'login' ? 'Log in' : 'Set new password'),
    submit: async v => {
      if (!/^[A-Za-z0-9_.-]{3,20}$/.test(v.name)) return 'The username is 3 to 20 letters, numbers, dots, dashes or underscores.';
      if ((v.password || '').length < 8) return 'The password needs at least 8 characters.';
      const r = await ACCT.call('POST', '/v1/' + mode, v);
      if (r.status !== 200 || !r.data.token) return r.data.error || 'That did not work. Try again.';
      recovery = r.data.recovery || '';
      await ACCT.signedIn(r.data.name, r.data.token);
      return '';
    }
  });
  if (!ok) return;
  if (recovery) await showRecovery(recovery);
  toast(mode === 'signup' ? 'Account created. Your music is saved online.' : 'Logged in as ' + S.account.name);
  ACCT.refresh();
}
async function accountDelete() {
  const me = ACCT.me;
  if (!me) return;
  const ok = await formBox({
    title: 'Delete your account?', danger: 1, ok: 'Delete account',
    text: 'The online copy of your music is deleted for good. What is on this PC stays.',
    fields: [{ key: 'password', label: 'Password', type: 'password' }],
    submit: async v => {
      const r = await ACCT.call('DELETE', '/v1/account', { password: v.password }, me.token);
      if (r.status !== 200) return r.data.error || 'That did not work. Try again.';
      ACCT.clear();
      return '';
    }
  });
  if (ok) { toast('Account deleted'); ACCT.refresh(); }
}

// ------------------------------------------------------------------ SoundCloud browsing (second, silent widget used only to list playlists / artists)
const fromSound = s => applySound({ k: 'sc' }, s);
function makeLister(frameId) {
  return {
    w: null, ready: false, chain: Promise.resolve(), cache: new Map(), busy: 0, idleT: 0,
    // raw sound objects for a SoundCloud url (one widget, one url at a time)
    sounds(url, timeout) {
      this.busy++;
      const p = this.chain.then(() => this._sounds(url, timeout || 20000));
      this.chain = p.catch(() => {}).then(() => {
        // drop the widget again after a while: it is only needed while opening playlists or checking results
        this.busy--;
        clearTimeout(this.idleT);
        this.idleT = setTimeout(() => {
          if (this.busy || !this.w) return;
          const f = document.getElementById(frameId); if (f) f.remove();
          this.w = null; this.ready = false;
        }, 45000);
      });
      return p;
    },
    list(url) {
      if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
      return this.sounds(url).then(sounds => {
        const tracks = sounds.map(s => (s.title ? fromSound(s) : { k: 'sc', sid: s.id }));
        if (tracks.length) this.cache.set(url, tracks);
        return tracks;
      });
    },
    async _sounds(url, timeout) {
      await SCW.lib();
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('timeout')), timeout);
        const ok = () => { clearTimeout(to); res(); };
        if (!this.w) {
          this.w = SC.Widget(SCW.make(frameId, url));
          this.w.bind(SC.Widget.Events.READY, () => { this.ready = true; this.w.setVolume(0); ok(); });
        } else {
          const start = () => this.w.load(url, Object.assign({ callback: ok }, LOADOPTS));
          if (this.ready) start();
          else { const iv = setInterval(() => { if (this.ready) { clearInterval(iv); start(); } }, 200); setTimeout(() => clearInterval(iv), timeout); }
        }
      });
      let sounds = [], full = -1;
      for (let k = 0; k < 12; k++) {
        sounds = await new Promise(r => this.w.getSounds(r)) || [];
        const f = sounds.filter(s => s.title).length;
        if (sounds.length && (f >= Math.min(20, sounds.length) || (k >= 4 && f === full && f > 0))) break;
        if (!sounds.length && k >= 6) break;
        full = f;
        await sleep(500);
      }
      return sounds;
    }
  };
}
const Browse = makeLister('sc-browse');

// Playability check: search results and long playlists only give a link or an id, so three silent widgets
// look each visible track up and the label-locked ones are taken out of the list (newest request first).
const Check = {
  pool: [0, 1, 2].map(i => makeLister('sc-check-' + i)), q: [],
  want(t) {
    if (t.k !== 'sc' || t.chk || t.drm || t._c) return;
    if (!scUrl(t)) return;
    t._c = 1;
    this.q.push(t);
    while (this.q.length > 40) delete this.q.shift()._c;
    this.pump();
  },
  pump() {
    while (this.q.length) {
      const l = this.pool.find(x => !x.busy);
      if (!l) return;
      const t = this.q.pop();
      l.sounds(scUrl(t), 9000).then(sounds => {
        const s = sounds && sounds[0];
        if (!s || !s.title || sounds.length !== 1 || (t.sid && s.id != t.sid)) return;
        applySound(t, s); propagate(t);
        for (const x of lists) x.update(t);
        if (t === P.cur) updateBar();
        if (t.drm) dropLocked(t);
      }, () => {}).then(() => setTimeout(() => this.pump(), 0));
    }
  }
};
const SC_RE = /^https?:\/\/(?:www\.|m\.|on\.)?soundcloud\.com\/\S+/i;
const YT_RE = /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
function normScUrl(u) {
  try {
    const x = new URL(u.trim());
    if (x.hostname === 'on.soundcloud.com') return 'https://on.soundcloud.com' + x.pathname;
    return 'https://soundcloud.com' + x.pathname.replace(/\/+$/, '');
  } catch (e) { return null; }
}
function scKind(u) {
  const seg = new URL(u).pathname.split('/').filter(Boolean);
  if (seg.length <= 1) return 'artist';
  if (seg[1] === 'sets') return seg.length >= 3 ? 'set' : 'artist';
  if (seg.length === 2 && ['tracks', 'albums', 'popular-tracks', 'reposts', 'likes', 'toptracks'].includes(seg[1])) return 'set';
  return 'track';
}

// ------------------------------------------------------------------ router
const R = { stack: [], idx: -1 };
let renderTok = 0;
const route = () => R.stack[R.idx] || { name: '' };
function go(name, arg, replace) {
  const view = $('#view');
  if (R.idx >= 0) R.stack[R.idx].scroll = view.scrollTop;
  if (replace && R.idx >= 0) R.stack[R.idx] = { name, arg, scroll: 0 };
  else {
    R.stack = R.stack.slice(0, R.idx + 1);
    R.stack.push({ name, arg, scroll: 0 });
    if (R.stack.length > 80) R.stack.shift();
    R.idx = R.stack.length - 1;
  }
  render();
}
function hist(d) {
  const n = R.idx + d;
  if (n < 0 || n >= R.stack.length) return;
  R.stack[R.idx].scroll = $('#view').scrollTop;
  R.idx = n;
  render(true);
}
function render(restore) {
  if (HK.cap && route().name !== 'settings') { HK.cap = null; HK.apply(); }
  const r = route(), view = $('#view');
  const keep = restore ? (r.scroll || 0) : (render.same === r ? view.scrollTop : 0);
  render.same = r;
  lists.clear(); hideMenu();
  view.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'page';
  view.appendChild(page);
  const tok = ++renderTok;
  (VIEWS[r.name] || VIEWS.home)(page, r.arg, () => tok === renderTok, () => { if (tok === renderTok && keep) view.scrollTop = keep; });
  view.scrollTop = keep;
  $('#go-back').disabled = R.idx <= 0;
  $('#go-fwd').disabled = R.idx >= R.stack.length - 1;
  if (document.activeElement !== $('#q')) {
    $('#q').value = r.name === 'search' ? ((r.arg && r.arg.q) || '') : '';
    $('#q-clear').hidden = !$('#q').value;
  }
  renderSide();
}
function renderSide() {
  const r = route();
  $('#n-liked').textContent = S.liked.length || '';
  $('#n-local').textContent = L.tracks.length || '';
  let html = '';
  for (const pl of S.playlists) html += '<button class="nav" data-pl="' + esc(pl.id) + '">' + ic('list') + '<span>' + esc(pl.name) + '</span><em>' + (pl.tracks.length || '') + '</em></button>';
  S.saved.forEach((s, i) => { html += '<button class="nav" data-saved="' + i + '">' + ic(s.kind === 'artist' ? 'user' : 'cloud') + '<span>' + esc(s.title || s.url) + '</span></button>'; });
  $('#side-lists').innerHTML = html || '<div class="none">Nothing here yet. Create a playlist or save one from SoundCloud.</div>';
  for (const b of $$('#side .nav')) {
    let on = false;
    if (b.dataset.nav) on = b.dataset.nav === r.name || (b.dataset.nav === 'local' && r.name === 'album');
    else if (b.dataset.pl) on = r.name === 'playlist' && r.arg === b.dataset.pl;
    else if (b.dataset.saved) on = r.name === 'set' && r.arg && S.saved[+b.dataset.saved] && r.arg.url === S.saved[+b.dataset.saved].url;
    b.classList.toggle('on', on);
  }
}

// ------------------------------------------------------------------ views
const GENRES = ['Lo-fi', 'Phonk', 'Rap FR', 'Drill', 'House', 'Techno', 'Hardstyle', 'Drum & bass', 'Chill', 'Gaming music', 'Workout', 'Nightcore', 'Synthwave', 'Jazz'];
const VIEWS = {};
const headBtns = (extra) => '<div class="actions"><button class="btn primary" data-do="play">' + ic('play') + 'Play</button><button class="btn" data-do="shuffle">' + ic('shuffle') + 'Shuffle</button>' + (extra || '') + '</div>';
function wireHead(root, tracks) {
  root.addEventListener('click', e => {
    const d = (e.target.closest('[data-do]') || {}).dataset;
    if (!d) return;
    if (d.do === 'play') playList(tracks(), 0, false);
    else if (d.do === 'shuffle') playList(tracks(), 0, true);
  });
}
const totalOf = tracks => { if (!tracks.length || tracks.some(t => !t.dur)) return ''; return ' · ' + fmtTotal(tracks.reduce((a, t) => a + t.dur, 0)); };

VIEWS.home = (view) => {
  const hr = new Date().getHours();
  const hello = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const fresh = !S.recent.length && !S.liked.length && !S.playlists.length && !S.saved.length && !L.tracks.length;
  let html = '<div class="hero"><h1>' + hello + '</h1></div>' + UPDATE.banner();
  if (fresh) {
    html += '<div class="steps">' +
      '<button class="step" data-step="search">' + ic('search') + '<b>Search any song</b><span>Type a song or artist in the bar at the top. Results come from YouTube and SoundCloud.</span></button>' +
      '<button class="step" data-step="paste">' + ic('link') + '<b>Paste a link</b><span>Any YouTube video link, or a SoundCloud track, playlist or profile link.</span></button>' +
      '<button class="step" data-step="folder">' + ic('folder') + '<b>Add your music folder</b><span>MP3, FLAC, M4A, OGG and WAV files on this PC. Never any ads.</span></button></div>';
  } else {
    html += '<div class="tiles">' +
      '<button class="tile" data-nav="liked"><div class="art liked ph">' + ic('heart') + '</div><span>Liked songs</span></button>' +
      '<button class="tile" data-nav="local">' + imgArt('', 'folder', '', 'local') + '<span>Local files</span></button>';
    for (const pl of S.playlists.slice(0, 6)) html += '<button class="tile" data-pl="' + esc(pl.id) + '">' + (pl.tracks[0] ? artHtml(pl.tracks[0]) : imgArt('', 'list', '', pl.name)) + '<span>' + esc(pl.name) + '</span></button>';
    html += '</div>';
    if (S.recent.length) {
      html += '<h2>Recently played</h2><div class="grid" id="recent">';
      S.recent.slice(0, 12).forEach((t, i) => {
        html += '<button class="card" data-recent="' + i + '">' + artHtml(t, '', true) + '<div class="t">' + esc(t.title || 'Track') + '</div><div class="a">' + esc(subOf(t)) + '</div><div class="fab">' + ic('play') + '</div></button>';
      });
      html += '</div>';
    }
    if (S.saved.length) {
      html += '<h2>Saved from SoundCloud</h2><div class="grid">';
      S.saved.forEach((s, i) => {
        html += '<button class="card' + (s.kind === 'artist' ? ' round' : '') + '" data-saved="' + i + '">' + imgArt(s.art, s.kind === 'artist' ? 'user' : 'list', '', s.title) + '<div class="t">' + esc(s.title || '') + '</div><div class="a">' + esc(s.kind === 'artist' ? 'Artist' : (s.author || 'Playlist')) + '</div></button>';
      });
      html += '</div>';
    }
  }
  html += '<h2>Browse</h2><div class="chips">' + GENRES.map(g => '<button class="chip" data-q="' + esc(g) + '">' + esc(g) + '</button>').join('') + '</div>';
  view.innerHTML = html;
  const root = view;
  root.querySelectorAll('[data-recent]').forEach(b => b.addEventListener('click', () => playList(S.recent.slice(0, 12), +b.dataset.recent)));
  root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.step === 'folder') addFolder(); else { go('search', { q: '', tab: 'yt' }); $('#q').focus(); }
  }));
};

// small line under a SoundCloud list saying how many label-locked tracks were taken out
function hideNote(onEmpty, onChange, site) {
  const el = h('<p class="note hid" hidden></p>');
  return {
    el,
    on(n, left) {
      if (!left && onEmpty) { onEmpty(); return; }
      el.hidden = !n;
      el.textContent = (n === 1 ? '1 track hidden. It only plays' : n + ' tracks hidden. They only play') + ' on ' + (site || 'soundcloud.com') + '.';
      if (onChange) onChange();
    }
  };
}
function searchChips() {
  let html = '';
  if (S.searches.length) html += '<h2>Recent searches</h2><div class="chips">' + S.searches.map(g => '<button class="chip" data-q="' + esc(g) + '">' + esc(g) + '</button>').join('') + '</div>';
  html += '<h2>Browse</h2><div class="chips">' + GENRES.map(g => '<button class="chip" data-q="' + esc(g) + '">' + esc(g) + '</button>').join('') + '</div>';
  return html;
}
VIEWS.search = (view, arg, alive) => {
  arg = arg || {};
  const q = (arg.q || '').trim(), tab = arg.tab || 'yt';
  if (!q) { view.innerHTML = '<h1 class="plain">Search</h1><p class="note">Search for any song, or paste a YouTube or SoundCloud link in the bar above.</p>' + searchChips(); return; }
  if (SC_RE.test(q)) { openLink(q, view, alive); return; }
  const ym = YT_RE.exec(q);
  if (ym) { openYt(ym[1], view, alive); return; }
  const tabs = [['yt', 'YouTube'], ['tracks', 'SoundCloud'], ['sets', 'SoundCloud playlists'], ['people', 'SoundCloud artists'], ['local', 'On this PC']];
  view.innerHTML = '<h1 class="plain">Results for “' + esc(q) + '”</h1><div class="tabs">' + tabs.map(t => '<button class="tab' + (t[0] === tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div><div id="res"><div class="spinner"></div></div>';
  view.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go('search', { q, tab: b.dataset.tab }, true)));
  const res = $('#res', view);
  if (tab === 'local') {
    const n = q.toLowerCase();
    const found = L.tracks.filter(t => (t.title + ' ' + (t.artist || '') + ' ' + (t.album || '')).toLowerCase().includes(n));
    res.innerHTML = '';
    if (!found.length) res.innerHTML = '<div class="empty"><b>Nothing on this PC matches</b>Try the SoundCloud tabs, or add a music folder in Local files.</div>';
    else res.appendChild(TrackList(found, { album: true }).el);
    return;
  }
  if (tab === 'yt') {
    api.get('/api/yt/search?q=' + encodeURIComponent(q)).then(r => {
      if (!alive()) return;
      S.searches = [q].concat(S.searches.filter(x => x.toLowerCase() !== q.toLowerCase())).slice(0, 8); save();
      res.innerHTML = '';
      if (!r.results.length) { res.innerHTML = '<div class="empty"><b>No results</b>YouTube found nothing for that. Check the spelling or try fewer words.</div>'; return; }
      YTP.lib().catch(() => {});
      const hn = hideNote(() => { res.innerHTML = '<div class="empty"><b>Nothing playable for that search</b>YouTube only plays these on its own site. Try another title.</div>'; }, null, 'youtube.com');
      res.appendChild(TrackList(r.results.map(x => ({ k: 'yt', id: x.id, title: x.title, artist: x.artist, dur: x.dur })), { hide: true, onHide: hn.on, album: true, albumLabel: 'Source' }).el);
      res.appendChild(hn.el);
    }).catch(() => { if (alive()) res.innerHTML = '<div class="empty"><b>Search is unavailable</b>Couldn\'t reach YouTube. Check your connection and try again.</div>'; });
    return;
  }
  api.get('/api/sc/search?type=' + (tab === 'tracks' ? 'sounds' : tab) + '&q=' + encodeURIComponent(q)).then(r => {
    if (!alive()) return;
    S.searches = [q].concat(S.searches.filter(x => x.toLowerCase() !== q.toLowerCase())).slice(0, 8); save();
    res.innerHTML = '';
    if (!r.results.length) { res.innerHTML = '<div class="empty"><b>No results</b>SoundCloud found nothing for that. Check the spelling or try fewer words.</div>'; return; }
    if (tab === 'tracks') {
      const hn = hideNote(() => { res.innerHTML = '<div class="empty"><b>Nothing playable for that search</b>Every result is a label release that SoundCloud keeps on its own site. Try a remix, a live version or another title.</div>'; });
      res.appendChild(TrackList(r.results.map(x => ({ k: 'sc', url: x.url, title: x.title })), { hide: true, onHide: hn.on }).el);
      res.appendChild(hn.el);
    } else {
      const kind = tab === 'people' ? 'artist' : 'set';
      const g = h('<div class="grid"></div>');
      for (const x of r.results) {
        const c = h('<button class="card' + (kind === 'artist' ? ' round' : '') + '">' + imgArt('', kind === 'artist' ? 'user' : 'list', '', x.title) + '<div class="t"></div><div class="a">' + (kind === 'artist' ? 'Artist' : 'Playlist') + '</div></button>');
        $('.t', c).textContent = x.title;
        c.addEventListener('click', () => go('set', { url: x.url, kind, title: x.title, art: c._art, author: c._author }));
        OE.get(x.url).then(m => {
          if (!m || !c.isConnected) return;
          c._art = m.thumb; c._author = m.author;
          if (m.thumb) $('.art', c).insertAdjacentHTML('beforeend', '<img loading="lazy" draggable="false" src="' + esc(m.thumb) + '" onerror="this.remove()">');
          if (kind === 'set' && m.author) $('.a', c).textContent = 'Playlist · ' + m.author;
        });
        g.appendChild(c);
      }
      res.appendChild(g);
    }
  }).catch(() => { if (alive()) res.innerHTML = '<div class="empty"><b>Search is unavailable</b>Couldn\'t reach SoundCloud. Check your connection and try again.</div>'; });
};
async function openYt(id, view, alive) {
  view.innerHTML = '<h1 class="plain">Opening link…</h1><div class="spinner"></div>';
  let m = null;
  try { m = await api.get('/api/yt/info?id=' + encodeURIComponent(id)); } catch (e) {}
  if (!alive()) return;
  if (!m) { view.innerHTML = '<h1 class="plain">Link not found</h1><div class="empty"><b>YouTube doesn\'t know that video</b>It may be private or deleted.</div>'; return; }
  view.innerHTML = '<h1 class="plain">Video from link</h1>';
  view.appendChild(TrackList([{ k: 'yt', id: m.id, title: m.title, artist: m.artist }], { album: true, albumLabel: 'Source' }).el);
}
async function openLink(raw, view, alive) {
  view.innerHTML = '<h1 class="plain">Opening link…</h1><div class="spinner"></div>';
  let url = normScUrl(raw);
  const fail = () => { if (alive()) view.innerHTML = '<h1 class="plain">Link not found</h1><div class="empty"><b>SoundCloud doesn\'t know that link</b>It may be private, deleted, or not a SoundCloud address.</div>'; };
  if (!url) return fail();
  try {
    if (url.startsWith('https://on.soundcloud.com')) url = normScUrl((await api.get('/api/sc/resolve?url=' + encodeURIComponent(url))).url);
    const kind = scKind(url);
    if (!alive()) return;
    if (kind !== 'track') { go('set', { url, kind }, true); return; }
    const m = await OE.get(url);
    if (!alive()) return;
    if (!m) return fail();
    const t = { k: 'sc', url, title: m.title, artist: m.author, art: m.thumb, sid: m.kind === 'track' ? m.id : undefined };
    view.innerHTML = '<h1 class="plain">Track from link</h1>';
    view.appendChild(TrackList([t], {}).el);
    Check.want(t);
  } catch (e) { fail(); }
}

VIEWS.set = (view, arg, alive, restore) => {
  const isArtist = arg.kind === 'artist';
  const st = { title: arg.title || '', author: arg.author || '', art: arg.art || '', tracks: [] };
  const sv = savedIndex(arg.url);
  if (sv >= 0) { st.title = st.title || S.saved[sv].title; st.art = st.art || S.saved[sv].art; st.author = st.author || S.saved[sv].author; }
  view.innerHTML = '<div class="page-head"><div id="cov"></div><div class="info"><div class="kind">' + (isArtist ? 'Artist on SoundCloud' : 'SoundCloud playlist') + '</div><h1></h1><div class="sub"></div></div></div>' +
    headBtns('<button class="btn" data-do="save"></button><button class="btn" data-do="open">' + ic('cloud') + 'Open on SoundCloud</button>') + '<div id="res"><div class="spinner"></div></div>';
  const paint = () => {
    $('h1', view).textContent = st.title || 'Loading…';
    $('#cov', view).innerHTML = imgArt(st.art ? st.art.replace(/-(large|t\d+x\d+)\./, '-t500x500.') : '', isArtist ? 'user' : 'list', 'cover', st.title);
    if (isArtist) $('#cov .art', view).style.borderRadius = '50%';
    $('.sub', view).textContent = (isArtist ? 'Latest tracks' : (st.author ? 'By ' + st.author : '')) + (st.tracks.length ? (isArtist || st.author ? ' · ' : '') + plural(st.tracks.length, 'track') + totalOf(st.tracks) : '');
    const on = savedIndex(arg.url) >= 0, b = $('[data-do=save]', view);
    b.classList.toggle('on', on);
    b.innerHTML = ic(on ? 'check' : 'plus') + (on ? 'Saved' : 'Save to library');
  };
  paint();
  wireHead(view, () => st.tracks);
  view.addEventListener('click', e => {
    const d = (e.target.closest('[data-do]') || {}).dataset;
    if (!d) return;
    if (d.do === 'open') api.post('/api/open', { url: arg.url }).catch(() => {});
    if (d.do === 'save') {
      const i = savedIndex(arg.url);
      if (i >= 0) { S.saved.splice(i, 1); toast('Removed from your library'); }
      else { S.saved.push({ url: arg.url, kind: arg.kind, title: st.title, author: st.author, art: st.art }); toast('Saved to your library'); }
      save(); paint(); renderSide();
    }
  });
  OE.get(arg.url).then(m => {
    if (!alive() || !m) return;
    st.title = m.title || st.title; st.author = isArtist ? '' : (m.author || st.author); st.art = m.thumb || st.art;
    const i = savedIndex(arg.url);
    if (i >= 0) { Object.assign(S.saved[i], { title: st.title, author: st.author, art: st.art }); save(); renderSide(); }
    paint();
  });
  Browse.list(arg.url).then(tracks => {
    if (!alive()) return;
    st.tracks = tracks.slice();
    tracks = st.tracks;
    const res = $('#res', view);
    res.innerHTML = '';
    if (!tracks.length) { res.innerHTML = '<div class="empty"><b>Nothing to play here</b>This page is empty, private, or SoundCloud doesn\'t allow it in the embedded player.</div>'; return; }
    if (!st.art && tracks[0].art) st.art = tracks[0].art;
    if (!st.title && isArtist && tracks[0].artist) st.title = tracks[0].artist;
    paint();
    const hn = hideNote(() => { paint(); res.innerHTML = '<div class="empty"><b>Nothing playable here</b>Every track on this page is a label release that SoundCloud keeps on its own site.</div>'; }, paint);
    res.appendChild(TrackList(tracks, { hide: true, onHide: hn.on }).el);
    res.appendChild(hn.el);
    restore();
  }).catch(() => { if (alive()) $('#res', view).innerHTML = '<div class="empty"><b>Couldn\'t load this page</b>Check your connection and try again.</div>'; });
};

VIEWS.liked = (view) => {
  const tracks = S.liked;
  view.innerHTML = '<div class="page-head"><div class="art liked ph cover">' + ic('heart') + '</div><div class="info"><div class="kind">Playlist</div><h1>Liked songs</h1><div class="sub">' + plural(tracks.length, 'song') + totalOf(tracks) + '</div></div></div>' +
    (tracks.length ? headBtns() : '') + '<div id="res"></div>';
  wireHead(view, () => tracks);
  if (!tracks.length) $('#res', view).innerHTML = '<div class="empty"><b>Songs you like show up here</b>Press the heart next to any track to save it.</div>';
  else $('#res', view).appendChild(TrackList(tracks, { album: true }).el);
};

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
VIEWS.local = (view, arg) => {
  arg = arg || {};
  const tab = arg.tab || 'songs';
  let html = '<h1 class="plain">Local files</h1><div class="actions"><button class="btn primary" data-do="add">' + ic('plus') + 'Add folder</button>';
  if (L.tracks.length) html += '<button class="btn" data-do="playall">' + ic('play') + 'Play all</button><button class="btn" data-do="shuf">' + ic('shuffle') + 'Shuffle</button>';
  html += '<button class="btn" data-do="rescan">' + ic('refresh') + 'Rescan</button><span class="note" id="scan-note"></span></div>';
  if (L.tracks.length) html += '<div class="tabs"><button class="tab' + (tab === 'songs' ? ' on' : '') + '" data-tab="songs">Songs</button><button class="tab' + (tab === 'albums' ? ' on' : '') + '" data-tab="albums">Albums</button><span class="grow"></span><input class="filter" id="lf" placeholder="Filter" spellcheck="false"></div>';
  html += '<div id="res"></div>';
  view.innerHTML = html;
  const res = $('#res', view);
  const note = () => { const n = $('#scan-note'); if (n) n.textContent = L.scanning ? 'Scanning… ' + L.done + ' / ' + L.total : (L.tracks.length ? plural(L.tracks.length, 'song') + ' in ' + plural(L.folders.length, 'folder') : ''); };
  note(); VIEWS.local.note = note;
  let shown = [];
  const fill = () => {
    lists.clear(); res.innerHTML = '';
    const f = ((arg.filter) || '').toLowerCase();
    const src = f ? L.tracks.filter(t => (t.title + ' ' + (t.artist || '') + ' ' + (t.album || '')).toLowerCase().includes(f)) : L.tracks;
    if (!L.tracks.length) {
      res.innerHTML = L.scanning ? '<div class="spinner"></div>' : '<div class="empty"><b>No music found yet</b>' +
        (L.folders.length ? 'Pulse looked in ' + esc(L.folders.join(', ')) + ' and found no audio files.' : 'Add a folder that contains your music.') +
        '<br><button class="btn primary" data-do="add">' + ic('plus') + 'Add a music folder</button></div>';
      return;
    }
    if (tab === 'albums') {
      const albums = new Map();
      for (const t of src) { const k = t.album || 'Unknown album'; if (!albums.has(k)) albums.set(k, []); albums.get(k).push(t); }
      const g = h('<div class="grid"></div>');
      for (const [name, ts] of Array.from(albums).sort((a, b) => cmp(a[0], b[0]))) {
        const withArt = ts.find(t => t.art) || ts[0];
        const c = h('<button class="card">' + artHtml(withArt, '', true) + '<div class="t"></div><div class="a"></div></button>');
        $('.t', c).textContent = name; $('.a', c).textContent = (ts[0].artist || 'Unknown artist') + ' · ' + plural(ts.length, 'song');
        c.addEventListener('click', () => go('album', name));
        g.appendChild(c);
      }
      res.appendChild(g);
      shown = src;
    } else {
      shown = src.slice().sort((a, b) => (!a.artist - !b.artist) || cmp(a.artist, b.artist) || cmp(a.album, b.album) || (a.no - b.no) || cmp(a.title, b.title));
      if (!shown.length) res.innerHTML = '<div class="empty"><b>No song matches that filter</b></div>';
      else res.appendChild(TrackList(shown, { album: true }).el);
    }
  };
  fill();
  const lf = $('#lf', view);
  if (lf) { lf.value = arg.filter || ''; lf.addEventListener('input', () => { arg.filter = lf.value; fill(); }); }
  view.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go('local', { tab: b.dataset.tab, filter: arg.filter }, true)));
  view.addEventListener('click', e => {
    const d = (e.target.closest('[data-do]') || {}).dataset;
    if (!d) return;
    if (d.do === 'add') addFolder();
    else if (d.do === 'rescan') { api.post('/api/library/rescan').then(() => { L.scanning = true; pollLibrary(); toast('Rescanning your folders'); }).catch(() => {}); }
    else if (d.do === 'playall') playList(shown, 0, false);
    else if (d.do === 'shuf') playList(shown, 0, true);
  });
};
VIEWS.album = (view, name) => {
  const tracks = L.tracks.filter(t => (t.album || 'Unknown album') === name).sort((a, b) => (a.no - b.no) || cmp(a.title, b.title));
  const first = tracks.find(t => t.art) || tracks[0];
  view.innerHTML = '<div class="page-head">' + (first ? artHtml(first, 'cover', true) : imgArt('', 'list', 'cover', name)) + '<div class="info"><div class="kind">Album</div><h1></h1><div class="sub"></div></div></div>' + headBtns() + '<div id="res"></div>';
  $('h1', view).textContent = name;
  $('.sub', view).textContent = (first && first.artist ? first.artist + ' · ' : '') + (first && first.year ? first.year + ' · ' : '') + plural(tracks.length, 'song') + totalOf(tracks);
  wireHead(view, () => tracks);
  if (tracks.length) $('#res', view).appendChild(TrackList(tracks, {}).el);
  else $('#res', view).innerHTML = '<div class="empty"><b>This album is no longer in your folders</b></div>';
};

VIEWS.playlist = (view, id) => {
  const pl = S.playlists.find(p => p.id === id);
  if (!pl) { view.innerHTML = '<div class="empty"><b>This playlist was deleted</b></div>'; return; }
  const first = pl.tracks.find(t => artSrc(t)) || pl.tracks[0];
  view.innerHTML = '<div class="page-head">' + (first ? artHtml(first, 'cover', true) : imgArt('', 'list', 'cover', pl.name)) + '<div class="info"><div class="kind">Playlist</div><h1></h1><div class="sub">' + plural(pl.tracks.length, 'song') + totalOf(pl.tracks) + '</div></div></div>' +
    '<div class="actions">' + (pl.tracks.length ? '<button class="btn primary" data-do="play">' + ic('play') + 'Play</button><button class="btn" data-do="shuffle">' + ic('shuffle') + 'Shuffle</button>' : '') +
    '<button class="btn" data-do="rename">' + ic('edit') + 'Rename</button><button class="btn danger" data-do="delete">' + ic('trash') + 'Delete</button></div><div id="res"></div>';
  $('h1', view).textContent = pl.name;
  wireHead(view, () => pl.tracks);
  view.addEventListener('click', async e => {
    const d = (e.target.closest('[data-do]') || {}).dataset;
    if (!d) return;
    if (d.do === 'rename') {
      const name = await ask({ title: 'Rename playlist', value: pl.name, ok: 'Save' });
      if (name) { pl.name = name; save(); render(); }
    } else if (d.do === 'delete') {
      if (await confirmBox({ title: 'Delete “' + pl.name + '”?', text: 'The playlist is removed from Pulse. Your music files are not touched.', ok: 'Delete' })) {
        S.playlists = S.playlists.filter(p => p !== pl); save(); toast('Playlist deleted'); go('home', null, true);
      }
    }
  });
  if (!pl.tracks.length) $('#res', view).innerHTML = '<div class="empty"><b>This playlist is empty</b>Use the ··· menu on any track and choose this playlist.</div>';
  else $('#res', view).appendChild(TrackList(pl.tracks, { album: true, playlist: pl }).el);
};

VIEWS.settings = (view) => {
  const me = ACCT.me;
  let html = '<h1 class="plain">Settings</h1>' + UPDATE.banner() + '<h2>Account</h2>' + (me
    ? '<div class="set-row"><i data-ic="user">' + svg('user') + '</i><div class="p">Signed in as <b>' + esc(me.name) + '</b><small' + (ACCT.error ? ' class="warn"' : '') + '>' +
      esc(ACCT.error || (ACCT.busy ? 'Saving…' : (ACCT.at ? 'Your liked songs and playlists are saved online. Songs from your own files stay on this PC.' : 'Checking your online copy…'))) + '</small></div>' +
      '<button class="btn" data-do="ac-sync">' + ic('refresh') + 'Save now</button><button class="btn" data-do="ac-out">Log out</button><button class="btn danger" data-do="ac-del">Delete account</button></div>'
    : '<div class="set-row"><i data-ic="user">' + svg('user') + '</i><div class="p">Save your music to an account<small>Free, no email. Your liked songs and playlists are kept online, so a new PC or a reinstall does not lose them.</small></div>' +
      '<button class="btn primary" data-do="ac-up">Create account</button><button class="btn" data-do="ac-in">Log in</button><button class="btn" data-do="ac-rec">Forgot password</button></div>') +
    '<h2>Music folders</h2>';
  if (!L.folders.length) html += '<p class="note">No folder yet.</p>';
  for (const f of L.folders) html += '<div class="set-row"><i data-ic="folder">' + svg('folder') + '</i><div class="p">' + esc(f) + '</div><button class="btn danger" data-rm="' + esc(f) + '">Remove</button></div>';
  html += '<div class="actions"><button class="btn primary" data-do="add">' + ic('plus') + 'Add folder</button><button class="btn" data-do="rescan">' + ic('refresh') + 'Rescan</button></div>' +
    '<h2>Your data</h2><div class="set-row"><i data-ic="list">' + svg('list') + '</i><div class="p">' + esc(INFO.dataDir || '') + '<small>Likes, playlists and settings are stored here, on this PC only.</small></div><button class="btn" data-do="data">Open folder</button></div>' +
    '<h2>Keyboard media keys</h2><div class="set-row"><i data-ic="next">' + svg('next') + '</i><div class="p">Play / pause, next and previous keys control Pulse<small>Only while Pulse is playing, so other apps keep them the rest of the time.</small></div><button class="btn' + (S.mediaKeys !== false ? ' on' : '') + '" data-do="keys">' + (S.mediaKeys !== false ? 'On' : 'Off') + '</button></div>' +
    '<h2>Global hotkeys</h2><div class="set-row"><i data-ic="next">' + svg('next') + '</i><div class="p">Control Pulse from any game or app<small>These keys work while Minecraft or anything else has the focus. A key used here stops reaching other apps while Pulse is open.</small></div><button class="btn' + (HK.on() ? ' on' : '') + '" data-do="hk-on">' + (HK.on() ? 'On' : 'Off') + '</button></div>' +
    (HK.on() ? HK.actions.map(a => {
      const b = HK.keys()[a[0]], cap = HK.cap === a[0], bad = b && HK.failed.has(a[0]);
      return '<div class="set-row hk"><div class="p">' + a[1] + (bad ? '<small class="warn">Another app already uses this key. Pick a different one.</small>' : '') + '</div>' +
        '<button class="btn key' + (cap ? ' cap' : '') + '" data-hk="' + a[0] + '">' + (cap ? 'Press the keys… (Esc cancels)' : (b ? esc(b.label) : 'Not set')) + '</button>' +
        '<button class="icon-btn" data-hkx="' + a[0] + '" title="Remove this hotkey"' + (b ? '' : ' disabled') + '>' + ic('x') + '</button></div>';
    }).join('') + '<div class="actions"><button class="btn" data-do="hk-reset">' + ic('refresh') + 'Reset hotkeys</button></div>' : '') +
    '<h2>Phone remote</h2><div class="set-row"><i data-ic="link">' + svg('link') + '</i><div class="p">Control Pulse from your phone<small>Your phone opens a small page served by this PC. Both must be on the same Wi-Fi. If Windows asks, allow Pulse on your network.</small></div><button class="btn' + (S.remote ? ' on' : '') + '" data-do="rc-on">' + (S.remote ? 'On' : 'Off') + '</button></div>' +
    (S.remote ? (() => {
      const i = RC.info;
      if (!i) return '<p class="note">Starting…</p>';
      if (i.error || !i.on) return '<p class="note">The remote could not start. ' + esc(i.error || '') + '</p>';
      if (!i.ips.length) return '<p class="note">This PC is not connected to a network.</p>';
      const url = 'http://' + i.ips[0] + ':' + i.port;
      return '<div class="rc-box">' + qrSvg(url + '/#' + i.code) + '<div class="rc-info"><div class="rc-step"><b>1</b><span>Scan this with your phone camera, or open <em>' + esc(url) + '</em> in its browser.</span></div>' +
        '<div class="rc-step"><b>2</b><span>If it asks for a code: <em class="code">' + esc(i.code) + '</em></span></div>' +
        (i.ips.length > 1 ? '<small>Not loading? This PC has other addresses: ' + i.ips.slice(1).map(x => esc(x + ':' + i.port)).join(', ') + '</small>' : '') +
        '<div class="actions"><span class="note">' + (i.phones ? plural(i.phones, 'phone') + ' paired' : 'No phone paired yet') + '</span><button class="btn" data-do="rc-forget">Forget phones</button></div></div></div>';
    })() : '') +
    '<h2>Song changes</h2><div class="set-row"><i data-ic="shuffle">' + svg('shuffle') + '</i><div class="p">Crossfade between YouTube songs<small>The next song is loaded in advance and comes in while the current one fades out. Off starts it the moment the song ends.</small></div>' +
    '<div class="seg">' + [0, 2, 4, 6, 10].map(v => '<button class="btn' + ((S.xfade || 0) === v ? ' on' : '') + '" data-xf="' + v + '">' + (v ? v + ' s' : 'Off') + '</button>').join('') + '</div></div>' +
    '<h2>SoundCloud</h2><div class="set-row"><i data-ic="cloud">' + svg('cloud') + '</i><div class="p">Hide tracks that can\'t play<small>Label releases that SoundCloud only plays on its own site are left out of search results, playlists and artist pages.</small></div><button class="btn' + (hideOn() ? ' on' : '') + '" data-do="hide">' + (hideOn() ? 'On' : 'Off') + '</button></div>' +
    '<h2>Shortcuts</h2><p class="para"><b>Space</b> play / pause · <b>Ctrl + Right / Left</b> next / previous · <b>Ctrl + Up / Down</b> volume · <b>Ctrl + K</b> search · <b>Alt + Left / Right</b> back / forward. These work inside the Pulse window; the global hotkeys above and the media keys on your keyboard work everywhere.</p>' +
    '<h2>About</h2><p class="para"><b>Pulse ' + esc(INFO.version || '') + '</b>. No ads of its own, no tracking, and the account is optional. Local files play straight from your disk. YouTube videos play in YouTube\'s own embedded player (the small picture in the sidebar), with ad requests blocked inside Pulse. SoundCloud tracks play through SoundCloud\'s official embedded player, so what is available (and whether a track is a 30 second preview) is decided by SoundCloud and the artist. Tracks always link back to their SoundCloud page.</p>';
  view.innerHTML = html;
  view.addEventListener('click', e => {
    const xf = e.target.closest('[data-xf]');
    if (xf) { S.xfade = +xf.dataset.xf; save(); render(); return; }
    const hk = e.target.closest('[data-hk]'), hkx = e.target.closest('[data-hkx]');
    if (hk) { if (HK.cap === hk.dataset.hk) HK.stop(); else HK.start(hk.dataset.hk); return; }
    if (hkx) { HK.cap = null; HK.set(hkx.dataset.hkx, null); HK.apply(); render(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { api.post('/api/folders/remove', { path: rm.dataset.rm }).then(() => { L.scanning = true; return loadLibrary(); }).then(() => render()).catch(() => {}); return; }
    const d = (e.target.closest('[data-do]') || {}).dataset;
    if (!d) return;
    if (d.do === 'add') addFolder();
    else if (d.do === 'rescan') api.post('/api/library/rescan').then(() => { L.scanning = true; pollLibrary(); toast('Rescanning your folders'); }).catch(() => {});
    else if (d.do === 'data') api.post('/api/reveal', { what: 'data' }).catch(() => {});
    else if (d.do === 'keys') { S.mediaKeys = S.mediaKeys === false; save(); updateKeys(); render(); }
    else if (d.do === 'hide') { S.hideLocked = !hideOn(); save(); render(); }
    else if (d.do === 'ac-up') accountDialog('signup');
    else if (d.do === 'ac-in') accountDialog('login');
    else if (d.do === 'ac-rec') accountDialog('recover');
    else if (d.do === 'ac-sync') { ACCT.sync().then(ok => toast(ok ? 'Saved online' : (ACCT.error || 'Could not save online'), !ok)); render(); }
    else if (d.do === 'ac-out') { ACCT.logout(); toast('Logged out. Your music stays on this PC.'); render(); }
    else if (d.do === 'ac-del') accountDelete();
    else if (d.do === 'rc-on') { S.remote = !S.remote; save(); RC.info = null; RC.enable(S.remote); render(); }
    else if (d.do === 'rc-forget') { RC.post('remote:forget'); toast('Phones forgotten. The code changed.'); }
    else if (d.do === 'hk-on') { HK.cap = null; S.hotkeys = { on: !HK.on(), keys: (S.hotkeys && S.hotkeys.keys) || null }; save(); HK.apply(); render(); }
    else if (d.do === 'hk-reset') { HK.cap = null; S.hotkeys = { on: true, keys: null }; save(); HK.apply(); render(); }
  });
};

// ------------------------------------------------------------------ queue panel
function renderQueue() {
  RC.push();
  const q = $('#queue');
  if (q.hidden) return;
  const body = $('#q-body');
  const item = (t, i, cur) => '<div class="q-item' + (cur ? ' cur' : '') + '" data-i="' + i + '">' + artHtml(t) + '<div class="tt"><div class="t">' + esc(t.title || 'Loading…') + '</div><div class="a">' + esc(subOf(t)) + '</div></div>' +
    '<button class="icon-btn" data-x="' + (cur ? 'toggle' : 'rm') + '" title="' + (cur ? 'Play / pause' : 'Remove from queue') + '">' + ic(cur ? (P.playing ? 'pause' : 'play') : 'x') + '</button></div>';
  if (!P.cur) { body.innerHTML = '<div class="empty"><b>Your queue is empty</b>Play something and what comes next shows up here.</div>'; return; }
  let html = '<div class="q-sec">Now playing</div>' + item(P.cur, P.pos, true);
  const rest = P.queue.slice(P.pos + 1, P.pos + 101);
  if (rest.length) {
    html += '<div class="q-sec">Next up</div>';
    rest.forEach((t, k) => { ensureMeta(t); html += item(t, P.pos + 1 + k, false); });
    const more = P.queue.length - P.pos - 1 - rest.length;
    if (more > 0) html += '<div class="q-sec">and ' + more + ' more</div>';
  }
  body.innerHTML = html;
}
$('#q-body').addEventListener('click', e => {
  const it = e.target.closest('.q-item'); if (!it) return;
  const i = +it.dataset.i, x = (e.target.closest('[data-x]') || {}).dataset;
  if (x && x.x === 'toggle') toggle();
  else if (x && x.x === 'rm') { const t = P.queue[i]; P.queue.splice(i, 1); if (P.orig) { const k = P.orig.indexOf(t); if (k >= 0) P.orig.splice(k, 1); } renderQueue(); save(); }
  else if (i !== P.pos) playAt(i);
});
function setQueueOpen(on) {
  $('#queue').hidden = !on;
  $('#app').classList.toggle('with-queue', on);
  $('#b-queue').classList.toggle('on', on);
  renderQueue();
  for (const l of lists) l.draw(true);
}

// ------------------------------------------------------------------ library
let INFO = {};
async function loadLibrary() {
  const r = await api.get('/api/library');
  L.scanning = r.scanning; L.done = r.done; L.total = r.total; L.folders = r.folders;
  const old = L.byId;
  L.byId = new Map();
  L.tracks = r.tracks.map(x => {
    const t = old.get(x.id) || { k: 'l', id: x.id };
    t.title = x.title || 'Unknown title'; t.artist = x.artist || ''; t.album = x.album || ''; t.dur = (x.dur || 0) * 1000; t.art = !!x.art; t.no = x.track || 0; t.year = x.year || 0;
    L.byId.set(t.id, t);
    return t;
  });
  L.loaded = true;
  renderSide();
  if (VIEWS.local.note) VIEWS.local.note();
  return r;
}
let pollT = 0, lastCount = -1;
function pollLibrary() {
  clearTimeout(pollT);
  pollT = setTimeout(async () => {
    try {
      const was = L.scanning;
      await loadLibrary();
      const n = route().name, changed = L.tracks.length !== lastCount, finished = was && !L.scanning;
      if (!$('#lf:focus')) {
        if (changed && (n === 'local' || n === 'album' || n === 'settings')) render();
        else if (finished && (n === 'local' || n === 'home' || n === 'settings')) render();
      }
      lastCount = L.tracks.length;
    } catch (e) {}
    if (L.scanning) pollLibrary();
  }, 900);
}
async function addFolder() {
  try {
    const r = await api.post('/api/folders/add', {});
    if (r.cancelled) return;
    if (!r.ok) { toast("That folder couldn't be added", true); return; }
    toast('Folder added. Scanning…');
    L.scanning = true; lastCount = -1;
    pollLibrary();
  } catch (e) { toast("Couldn't open the folder picker", true); }
}

// ------------------------------------------------------------------ wiring
function hydrateIcons() { for (const i of $$('i[data-ic]')) if (!i.firstChild) i.innerHTML = svg(i.dataset.ic); }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-nav],[data-pl],[data-saved],[data-q]');
  if (!b || b.closest('#menu')) return;
  if (b.dataset.nav) {
    if (b.dataset.nav === 'search') { go('search', { q: '', tab: 'yt' }); $('#q').focus(); }
    else go(b.dataset.nav);
  } else if (b.dataset.pl) go('playlist', b.dataset.pl);
  else if (b.dataset.saved) { const s = S.saved[+b.dataset.saved]; if (s) go('set', { url: s.url, kind: s.kind, title: s.title, art: s.art, author: s.author }); }
  else if (b.dataset.q) { $('#q').value = b.dataset.q; $('#q-clear').hidden = false; go('search', { q: b.dataset.q, tab: 'yt' }, route().name === 'search'); }
});
$('#side-lists').addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-pl],[data-saved]'); if (!b) return;
  e.preventDefault();
  if (b.dataset.pl) {
    const pl = S.playlists.find(p => p.id === b.dataset.pl); if (!pl) return;
    showMenu([
      { ic: 'play', label: 'Play', fn: () => playList(pl.tracks, 0) },
      { ic: 'queue', label: 'Add to queue', fn: () => pl.tracks.length && enqueue(pl.tracks) },
      { sep: 1 },
      { ic: 'trash', label: 'Delete playlist', danger: 1, fn: async () => { if (await confirmBox({ title: 'Delete “' + pl.name + '”?', text: 'The playlist is removed from Pulse. Your music files are not touched.', ok: 'Delete' })) { S.playlists = S.playlists.filter(p => p !== pl); save(); if (route().name === 'playlist' && route().arg === pl.id) go('home', null, true); else renderSide(); } } }
    ], e.clientX, e.clientY);
  } else {
    const i = +b.dataset.saved;
    showMenu([{ ic: 'trash', label: 'Remove from library', danger: 1, fn: () => { S.saved.splice(i, 1); save(); render(); } }], e.clientX, e.clientY);
  }
});
$('#new-pl').addEventListener('click', async () => { const pl = await createPlaylist([]); if (pl) go('playlist', pl.id); });
$('#go-back').addEventListener('click', () => hist(-1));
$('#go-fwd').addEventListener('click', () => hist(1));

let qTimer = 0;
const qInput = $('#q');
function runQuery(now) {
  clearTimeout(qTimer);
  const fire = () => {
    const q = qInput.value.trim(), r = route();
    if (r.name === 'search') { if ((r.arg && r.arg.q) !== q) go('search', { q, tab: (r.arg && r.arg.tab) || 'yt' }, true); }
    else if (q) go('search', { q, tab: 'yt' });
  };
  if (now) fire(); else qTimer = setTimeout(fire, 380);
}
qInput.addEventListener('input', () => { $('#q-clear').hidden = !qInput.value; runQuery(SC_RE.test(qInput.value.trim()) || YT_RE.test(qInput.value.trim())); });
qInput.addEventListener('keydown', e => { if (e.key === 'Enter') runQuery(true); else if (e.key === 'Escape') { qInput.blur(); } });
$('#q-clear').addEventListener('click', () => { qInput.value = ''; $('#q-clear').hidden = true; qInput.focus(); runQuery(true); });

$('#b-play').addEventListener('click', toggle);
$('#b-next').addEventListener('click', () => next(false));
$('#b-prev').addEventListener('click', prev);
$('#b-shuffle').addEventListener('click', () => { setShuffle(!S.shuffle); toast(S.shuffle ? 'Shuffle on' : 'Shuffle off'); });
$('#b-repeat').addEventListener('click', () => { S.repeat = S.repeat === 'off' ? 'all' : (S.repeat === 'all' ? 'one' : 'off'); updateModes(); save(); });
$('#b-like').addEventListener('click', () => { if (P.cur) toggleLike(P.cur); });
$('#b-queue').addEventListener('click', () => setQueueOpen($('#queue').hidden));
$('#q-close').addEventListener('click', () => setQueueOpen(false));
$('#q-clear-all').addEventListener('click', () => { if (P.cur) { P.queue = [P.cur]; P.orig = [P.cur]; P.pos = 0; renderQueue(); save(); } });
$('#b-mute').addEventListener('click', () => { S.muted = !S.muted; if (!S.muted && S.volume === 0) S.volume = 0.5; applyVolume(); updateModes(); save(); });
$('#b-src').addEventListener('click', () => {
  if (P.cur && P.cur.k === 'yt') api.post('/api/open', { url: ytUrl(P.cur) }).catch(() => {});
  else if (P.cur && isPermalink(P.cur.url)) api.post('/api/open', { url: P.cur.url }).catch(() => {});
});
$('#b-artist').addEventListener('click', () => { const u = P.cur && P.cur.k === 'sc' && artistUrl(P.cur); if (u) go('set', { url: u, kind: 'artist', title: P.cur.artist }); });
function setVolume(v) { S.volume = Math.max(0, Math.min(1, v)); S.muted = false; applyVolume(); updateModes(); save(); }
slider($('#b-vol'), { live: setVolume, wheel: d => setVolume(S.volume + d * 0.05) });
slider($('#b-seek'), {
  enabled: () => !!P.cur && P.dur > 0 && !P.pending,
  start: () => { seekDrag = true; },
  live: r => { $('#b-cur').textContent = fmt(r * P.dur); },
  end: r => { seekDrag = false; seek(r * P.dur); }
});

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test((e.target.tagName || ''));
  if (!$('#modal').hidden) return;
  if (e.key === 'Escape') { hideMenu(); return; }
  if ((e.ctrlKey && (e.key === 'k' || e.key === 'l' || e.key === 'f')) || (e.key === '/' && !typing)) { e.preventDefault(); qInput.focus(); qInput.select(); return; }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); hist(-1); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); hist(1); return; }
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); next(false); }
  else if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  else if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); setVolume(S.volume + 0.05); }
  else if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); setVolume(S.volume - 0.05); }
  else if (!e.ctrlKey && !e.altKey && e.key === 'ArrowRight' && P.cur) seek(P.t + 5000);
  else if (!e.ctrlKey && !e.altKey && e.key === 'ArrowLeft' && P.cur) seek(P.t - 5000);
});
document.addEventListener('mouseup', e => { if (e.button === 3) hist(-1); else if (e.button === 4) hist(1); });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });
window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

// ------------------------------------------------------------------ start
async function init() {
  hydrateIcons();
  try { INFO = await api.get('/api/info'); } catch (e) {}
  try {
    const st = await api.get('/api/state');
    for (const k of Object.keys(S)) if (st[k] !== undefined && typeof st[k] === typeof S[k] && Array.isArray(st[k]) === Array.isArray(S[k])) S[k] = st[k];
    S.playlists = S.playlists.filter(p => p && p.id && Array.isArray(p.tracks));
  } catch (e) {}
  try { await loadLibrary(); } catch (e) {}
  lastCount = L.tracks.length;
  // re-link saved local tracks to the live library (drops files that are gone from every list except playlists, where they stay visible)
  const relink = arr => arr.map(t => (t && t.k === 'l') ? (L.byId.get(t.id) || t) : t).filter(Boolean);
  S.liked = relink(S.liked); S.recent = relink(S.recent);
  for (const p of S.playlists) p.tracks = relink(p.tracks);
  const q = relink(S.queue).filter(t => t.k !== 'l' || L.byId.has(t.id));
  stateLoaded = true;
  if (!S.hotkeys || typeof S.hotkeys !== 'object') S.hotkeys = { on: true, keys: null };
  HK.apply();
  if (S.remote) RC.enable(true);
  if (!S.account || typeof S.account !== 'object' || typeof S.account.token !== 'string') S.account = { name: '', token: '', rev: 0, sig: '' };
  ACCT.start();
  updateModes(); applyVolume();
  if (q.length && S.qpos >= 0 && S.qpos < q.length) { P.queue = q; P.orig = q.slice(); playAt(S.qpos, false); P.loading = false; onPlayState(); }
  else { updateBar(); onPlayState(); }
  go('home');
  if (L.scanning) pollLibrary();
  if (SELFTEST) selfTest(); else setTimeout(() => UPDATE.check(), 4000);
}

async function selfTest() {
  const out = { ok: false, steps: [], ua: navigator.userAgent };
  const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(100); } };
  try {
    await waitFor(() => !L.scanning, 30000, 'library scan');
    await loadLibrary();
    out.steps.push({ step: 'library', tracks: L.tracks.length });
    if (L.tracks.length) {
      const t = L.tracks[0];
      playList([t], 0);
      await waitFor(() => P.playing && P.t > 500, 15000, 'local playback');
      const a = P.t; seek(P.dur * 0.6); await sleep(900);
      out.steps.push({ step: 'local', title: t.title, artist: t.artist, art: t.art, durMs: Math.round(P.dur), posBeforeSeek: Math.round(a), posAfterSeek: Math.round(P.t) });
      toggle(); await waitFor(() => !P.playing, 4000, 'local pause');
    }
    const r = await api.get('/api/sc/search?type=sounds&q=lofi');
    out.steps.push({ step: 'search', results: r.results.length });
    const t = { k: 'sc', url: r.results[0].url, title: r.results[0].title };
    playList([t, { k: 'sc', url: r.results[1].url, title: r.results[1].title }], 0);
    await waitFor(() => P.playing && P.t > 500 && !!t.sid, 30000, 'soundcloud playback');
    const a = P.t; seek(60000); await sleep(1500);
    out.steps.push({ step: 'soundcloud', title: t.title, artist: t.artist, durMs: P.dur, posBeforeSeek: Math.round(a), posAfterSeek: Math.round(P.t), outVol: outVol(), mediaKeys: (await api.get('/api/info')).mediaKeys, mediaTitle: navigator.mediaSession.metadata && navigator.mediaSession.metadata.title });
    next(false);
    await waitFor(() => P.pos === 1 && P.playing && P.t > 300, 30000, 'soundcloud next track');
    out.steps.push({ step: 'next', title: P.cur.title, pos: Math.round(P.t) });
    const tracks = await Browse.list('https://soundcloud.com/lofi_girl');
    out.steps.push({ step: 'artist', tracks: tracks.length, first: tracks[0] && tracks[0].title, stillPlaying: P.playing });
    // playability check + hiding in the search view
    const c1 = { k: 'sc', url: 'https://soundcloud.com/julian76995/by-the-river' }, c2 = { k: 'sc', url: r.results[3].url };
    const tc = Date.now();
    Check.want(c1); Check.want(c2);
    await waitFor(() => (c1.drm || c1.chk) && (c2.drm || c2.chk), 30000, 'playability check');
    out.steps.push({ step: 'check', ms: Date.now() - tc, lockedFlagged: !!c1.drm, otherLocked: !!c2.drm, otherTitle: c2.title, otherDur: c2.dur });
    for (const q of ['lofi', 'drake']) {
      go('search', { q, tab: 'tracks' });
      const ts = Date.now();
      await waitFor(() => { const l = Array.from(lists)[0]; return (l && l.tracks.length && l.tracks.every(x => x.chk)) || !!$('#res .empty') || Date.now() - ts > 20000; }, 25000, 'search view check');
      const l = Array.from(lists)[0];
      out.steps.push({ step: 'searchview', q, ms: Date.now() - ts, shown: l ? l.tracks.length : 0, hidden: l ? l.hidden : 0, unchecked: l ? l.tracks.filter(x => !x.chk).length : 0, rows: $$('#res .tr').length, lockedRows: $$('#res .tr.locked').length, note: ($('#res .hid') || {}).textContent, empty: ($('#res .empty b') || {}).textContent });
    }
    // a track that SoundCloud only serves as encrypted (DRM) HLS: plays only where the browser engine has a DRM module
    const eme = {};
    for (const ks of ['com.widevine.alpha', 'com.microsoft.playready.recommendation']) {
      try { await navigator.requestMediaKeySystemAccess(ks, [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }]); eme[ks] = true; }
      catch (e) { eme[ks] = false; }
    }
    const d = { k: 'sc', url: 'https://soundcloud.com/julian76995/by-the-river' };
    const ok2 = { k: 'sc', url: r.results[2].url, title: r.results[2].title };
    playList([d, ok2], 0);
    await waitFor(() => P.pos === 1 && P.playing && P.t > 400, 30000, 'skip past label-protected track');
    out.steps.push({ step: 'locked', eme, flagged: !!d.drm, title: d.title, skippedTo: P.cur.title, toast: ($('.toast') || {}).textContent });
    toggle(); await waitFor(() => !P.playing, 5000, 'soundcloud pause');
    // YouTube: search, play, seek, next, then back to a local file
    const y = await api.get('/api/yt/search?q=' + encodeURIComponent('daft punk get lucky'));
    out.steps.push({ step: 'ytsearch', results: y.results.length, first: y.results[0] });
    const yl = y.results.slice(0, 8).map(x => ({ k: 'yt', id: x.id, title: x.title, artist: x.artist, dur: x.dur }));
    playList(yl, 0);
    await waitFor(() => P.cur.k === 'yt' && P.playing && P.t > 1500, 45000, 'youtube playback');
    const yi = P.pos, ya = P.t; seek(60000); await sleep(2500);
    out.steps.push({ step: 'youtube', pos: yi, title: P.cur.title, artist: P.cur.artist, durMs: Math.round(P.dur), posBeforeSeek: Math.round(ya), posAfterSeek: Math.round(P.t), refused: yl.filter(x => x.drm).length, box: !$('#yt-box').hidden, outVol: outVol() });
    next(false);
    await waitFor(() => P.pos > yi && P.playing && P.t > 800, 45000, 'youtube next track');
    out.steps.push({ step: 'ytnext', title: P.cur.title, pos: P.pos, refused: yl.filter(x => x.drm).length });
    await waitFor(() => YTP.b.mode === 'preok' || Date.now() - tc > 600000, 20000, 'next youtube song loaded in advance').catch(() => {});
    const want = YTP.nextUp(), pi = P.pos, t1 = performance.now();
    next(false);
    await waitFor(() => P.pos > pi && P.playing && YTP.p.getCurrentTime() > 0.05, 20000, 'youtube swap');
    out.steps.push({ step: 'ytswap', preloaded: !!want && want.t === P.cur, ms: Math.round(performance.now() - t1 - YTP.p.getCurrentTime() * 1000), xfade: S.xfade });
    toggle(); await waitFor(() => !P.playing, 5000, 'youtube pause');
    toggle(); await waitFor(() => P.playing, 8000, 'youtube resume');
    if (L.tracks.length) {
      playList([L.tracks[0]], 0);
      await waitFor(() => P.cur.k === 'l' && P.playing && P.t > 400, 15000, 'local after youtube');
      await sleep(700);
      let ytState = -9; try { ytState = YTP.p.getPlayerState(); } catch (e) {}
      out.steps.push({ step: 'yt-to-local', ytPlayerState: ytState, box: !$('#yt-box').hidden });
      toggle();
    } else { toggle(); }
    out.steps.push({ step: 'ads', blockedRequests: (await api.get('/api/info')).adsBlocked });
    {
      const m = qrMatrix('http://192.168.1.23:4587/#123456');
      out.steps.push({ step: 'remote', setting: S.remote, qr: m ? m.length : 0, qrDark: m ? m.reduce((a, r) => a + r.filter(Boolean).length, 0) : 0 });
    }
    out.steps.push({ step: 'hotkeys', on: HK.on(), answered: HK.answered, taken: Array.from(HK.failed), keys: HK.actions.map(a => a[0] + '=' + ((HK.keys()[a[0]] || {}).label || '-')) });
    out.ok = true;
  } catch (e) { out.error = String((e && e.message) || e); }
  try { await api.post('/api/selftest', out); } catch (e) {}
}

if (qs.get('debug') === '1') window.__pulse = { P, S, L, SCW, YTP, HK, RC, ACCT, UPDATE, toggleLike, accountDialog, qrMatrix, render, save, Browse, Check, OE, lists, api, playList, go, toggle, next, seek };
init();
})();
