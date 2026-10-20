// Cloudflare Workers + Durable Objects version of the game server (cloudflare/), tested LOCALLY with `wrangler dev`
// (Miniflare/workerd on this machine — no Cloudflare account, nothing deployed).
// These are "multi-client on one machine" tests (模擬玩家/多開), not cross-device tests and not tests of the real
// Cloudflare network (its CPU / duration / request limits are not enforced locally).
//
// Run:  (cd cloudflare && npm install) && node --import tsx --test --test-concurrency=1 tests/cf.test.mjs   (from the repo root)
// Or against an already running `wrangler dev`:  CF_URL=http://127.0.0.1:8788 node --import tsx --test tests/cf.test.mjs
// The spawned wrangler runs the simulation 6x faster (BK_TIME_SCALE=6, test only) so a full business day fits in the test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CF_DIR = path.resolve(HERE, '..', 'cloudflare');
const PORT = 21000 + Math.floor(Math.random() * 2000);
const HTTP = process.env.CF_URL ?? `http://127.0.0.1:${PORT}`;
const WS = HTTP.replace(/^http/, 'ws') + '/ws';
const PERSIST = mkdtempSync(path.join(tmpdir(), 'bk-cf-'));
let proc = null;

// A local RSA key stands in for Google's sign-in keys (served as a JWKS by a tiny local HTTP server).
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims, kid = 'k1', key = privateKey) {
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(claims);
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
const CLIENT_ID = 'client-1';
const goodClaims = () => ({ sub: '1234567890', aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, name: '王小明', email: 'x@example.com' });
const jwksServer = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=60' }); res.end(JSON.stringify({ keys: [jwk] })); });
let JWKS_URL = '';

async function startWrangler() {
  if (process.env.CF_URL) return;
  const bin = path.join(CF_DIR, 'node_modules', '.bin', 'wrangler');
  if (!existsSync(bin)) throw new Error('wrangler not installed: run `cd cloudflare && npm install` first');
  proc = spawn(bin, ['dev', '--local', '--ip', '127.0.0.1', '--port', String(PORT), '--persist-to', PERSIST, '--log-level', 'warn', '--var', 'BK_TIME_SCALE:6', '--var', `GOOGLE_CLIENT_ID:${CLIENT_ID}`, '--var', `GOOGLE_CERTS_URL:${JWKS_URL}`], {
    cwd: CF_DIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try { const r = await fetch(HTTP + '/health'); if (r.ok) return; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error('wrangler exited:\n' + out);
    await sleep(300);
  }
  throw new Error('wrangler dev start timeout:\n' + out);
}
async function stopWrangler() {
  if (!proc || proc.exitCode !== null) return;
  const done = new Promise(r => proc.once('exit', r));
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
  await Promise.race([done, sleep(8000)]);
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ }
  // wait until the port is free again
  for (let i = 0; i < 40; i++) { try { await fetch(HTTP + '/health'); await sleep(250); } catch { return; } }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name, query = '') { this.name = name; this.query = query; this.msgs = []; this.snap = null; this.lobby = null; this.playerId = ''; this.token = ''; this.code = ''; this.errors = []; this.waiters = []; this.closeInfo = null; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(WS + this.query);
      this.ws.on('open', () => { this.send({ type: 'hello', v: 1, platform: 'test' }); res(); });
      this.ws.on('error', rej);
      this.ws.on('close', (code, reason) => { this.closeInfo = { code, reason: String(reason) }; this.wake(); });
      this.ws.on('message', d => {
        const m = JSON.parse(String(d));
        this.msgs.push(m); if (this.msgs.length > 300) this.msgs.splice(0, 150);
        if (m.type === 'snap') this.snap = m.s;
        if (m.type === 'lobby') this.lobby = m.lobby;
        if (m.type === 'welcome') { this.playerId = m.playerId; this.token = m.token; this.code = m.code; }
        if (m.type === 'error') this.errors.push(m);
        if (m.type === 'save') this.gotSave = true;
        this.wake();
      });
    });
  }
  wake() { this.waiters.splice(0).forEach(f => f()); }
  send(m) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  async until(pred, ms = 8000, what = 'condition') {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`${this.name}: timeout waiting for ${what}`);
      await new Promise(r => { this.waiters.push(r); setTimeout(r, 100); });
    }
  }
  me() { return this.snap?.players.find(p => p.id === this.playerId); }
  kill() { this.ws.terminate(); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function room(n, opts = {}) {
  const host = new Client('host', opts.direct ? '?create=1' : ''); await host.connect();
  host.send({ type: 'create', name: 'Host', ...(opts.map ? { map: opts.map } : {}), ...(opts.difficulty ? { difficulty: opts.difficulty } : {}) });
  await host.until(() => !!host.code, 8000, 'room code');
  const clients = [host];
  for (let i = 1; i < n; i++) {
    const c = new Client('c' + i, opts.direct ? `?room=${host.code}` : ''); await c.connect();
    c.send({ type: 'join', code: host.code, name: 'P' + i });
    await c.until(() => !!c.playerId, 8000, 'welcome');
    clients.push(c);
  }
  return clients;
}
async function start(cs) {
  cs.slice(1).forEach(c => c.send({ type: 'ready', ready: true }));
  await cs[0].until(() => cs[0].lobby?.players.length === cs.length && cs[0].lobby.players.filter(p => p.ready).length === cs.length - 1, 8000, 'ready');
  cs[0].send({ type: 'start' });
  for (const c of cs) await c.until(() => !!c.me(), 8000, 'first snapshot');
}
async function api(method, p, body, token, session) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-owner-token'] = token;
  if (session) headers['x-session'] = session;
  const r = await fetch(HTTP + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), data: await r.json().catch(() => ({})) };
}

before(async () => {
  await new Promise(r => jwksServer.listen(0, '127.0.0.1', r));
  JWKS_URL = `http://127.0.0.1:${jwksServer.address().port}/certs`;
  await startWrangler();
});
after(async () => { await stopWrangler(); jwksServer.close(); });

test('health + CORS', async () => {
  const h = await api('GET', '/health');
  assert.equal(h.status, 200); assert.equal(h.data.ok, true); assert.equal(h.data.protocol, 1);
  const pre = await fetch(HTTP + '/api/stores', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /x-owner-token/);
});

test('relay mode (unchanged client): create/join, shared world, movement replicates', async () => {
  const [a, b] = await room(2);
  assert.match(a.code, /^[A-Z0-9]{5}$/);
  await start([a, b]);
  assert.equal(a.snap.players.length, 2);
  for (let i = 0; i < 20; i++) { a.send({ type: 'input', x: 12 - i * 0.1, z: 9.5, yaw: 0, pitch: 0, seq: i }); await sleep(70); }
  await b.until(() => { const pa = b.snap.players.find(p => p.id === a.playerId); return Math.abs(pa.x - 10.1) < 0.4; }, 5000, 'A position at B');
  a.close(); b.close();
});

test('direct mode (?create=1 / ?room=CODE): same protocol without the relay', async () => {
  const [a, b] = await room(2, { direct: true });
  await start([a, b]);
  for (let i = 0; i < 20; i++) { b.send({ type: 'input', x: 6 + i * 0.1, z: 5, yaw: 0, pitch: 0, seq: i }); await sleep(70); }
  await a.until(() => { const pb = a.snap.players.find(p => p.id === b.playerId); return Math.abs(pb.x - 7.9) < 0.4; }, 5000, 'B position at A');
  // a relay client can join a room created in direct mode (same Durable Object)
  const c = new Client('c'); await c.connect();
  c.send({ type: 'join', code: a.code, name: 'C' });
  await c.until(() => !!c.me(), 8000, 'relay joiner snapshot');
  assert.equal(c.snap.players.length, 3);
  a.close(); b.close(); c.close();
});

test('unknown room: no_room error, and the same socket can still create a room', async () => {
  const c = new Client('lost'); await c.connect();
  c.send({ type: 'join', code: 'ZZZZZ', name: 'X' });
  await c.until(() => c.errors.length > 0, 8000, 'error');
  assert.equal(c.errors[0].code, 'no_room');
  c.send({ type: 'join', code: 'bad!', name: 'X' });
  await c.until(() => c.errors.length > 1, 8000, 'error 2');
  assert.equal(c.errors[1].code, 'no_room');
  c.send({ type: 'create', name: 'Retry' });
  await c.until(() => !!c.code, 8000, 'room after retry');
  c.close();
});

test('five players OK, sixth rejected with room_full', async () => {
  const cs = await room(5);
  await cs[0].until(() => cs[0].lobby.players.length === 5, 5000, 'lobby of 5');
  const sixth = new Client('sixth'); await sixth.connect();
  sixth.send({ type: 'join', code: cs[0].code, name: 'Six' });
  await sixth.until(() => sixth.errors.length > 0, 5000, 'error');
  assert.equal(sixth.errors[0].code, 'room_full');
  assert.equal(sixth.playerId, '');
  cs.forEach(c => c.close()); sixth.close();
});

test('disconnect + reconnect with token: same character, no duplicate, state intact', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  for (let k = 0; k < 25; k++) { b.send({ type: 'input', x: 3.2, z: 2.2, yaw: 0, pitch: 0, seq: k }); await sleep(100); }
  b.send({ type: 'act', rid: 'bx', kind: 'takeBox', target: { t: 'crate', product: 'snacks' } });
  await b.until(() => b.me()?.held?.kind === 'box', 5000, 'box');
  const token = b.token, id = b.playerId;
  b.kill(); // abrupt, like a phone losing signal
  await a.until(() => a.snap.players.find(p => p.id === id)?.connected === false, 15000, 'B marked disconnected');
  const b2 = new Client('b2'); await b2.connect();
  b2.send({ type: 'join', code: a.code, name: '', token });
  await b2.until(() => !!b2.me(), 8000, 'resync');
  assert.equal(b2.playerId, id);
  assert.equal(b2.snap.players.length, 2);
  assert.equal(b2.me().held?.kind, 'box');
  assert.equal(b2.snap.players.filter(p => p.id === id).length, 1);
  a.close(); b2.close();
});

test('duplicate buy over the network charges once', async () => {
  const [a] = await room(1);
  await start([a]);
  const m0 = a.snap.money;
  a.send({ type: 'buy', rid: 'dup', item: 'stock_snacks' });
  a.send({ type: 'buy', rid: 'dup', item: 'stock_snacks' });
  await sleep(800);
  assert.equal(a.snap.money, m0 - 18);
  a.close();
});

test('/api/room/:code reports the store type; rooms on different maps side by side', async () => {
  const boba = await room(2, { map: 'boba', difficulty: 'hell' }), cloth = await room(2, { map: 'clothing', difficulty: 'nonsense' });
  const bi = await api('GET', `/api/room/${boba[0].code}`);
  assert.equal(bi.data.map, 'boba'); assert.equal(bi.data.difficulty, 'hell');
  const ci = await api('GET', `/api/room/${cloth[0].code}`);
  assert.equal(ci.data.map, 'clothing'); assert.equal(ci.data.difficulty, 'normal'); assert.equal(ci.data.players, 2); assert.equal(ci.cors, '*');
  assert.equal((await api('GET', '/api/room/ZZZZZ')).status, 404);
  await start(boba); await start(cloth);
  await sleep(1500);
  assert.deepEqual(cloth[0].snap.shift.foods, []);
  assert.ok(boba[0].snap.shift.foods.length > 0);
  for (const c of [...boba, ...cloth]) c.close();
});

test('friend store API: upload, lock, raid, cooldown, reports (owner token required)', async () => {
  const up = await api('POST', '/api/stores', { name: '測試店', map: 'boba', money: 2000, rating: 3.5, shelves: { drinks: 4, snacks: 4, bento: 4 } });
  assert.equal(up.status, 200);
  const code = up.data.code, token = up.data.token;
  assert.match(code, /^[A-Z0-9]{6}$/);
  const view = await api('GET', `/api/stores/${code}`);
  assert.equal(view.data.name, '測試店'); assert.equal(view.data.money, undefined); assert.equal(view.data.ownerHash, undefined);
  assert.equal((await api('PUT', `/api/stores/${code}`, { locked: true }, 'wrong')).status, 403);
  assert.equal((await api('PUT', `/api/stores/${code}`, { locked: true }, token)).status, 200);
  assert.equal((await api('POST', `/api/stores/${code}/raid`, { raider: 'x', score: 300 })).status, 423);
  const trash = await api('POST', `/api/stores/${code}/raid`, { raider: '小華', score: 999, outside: true });
  assert.equal(trash.status, 200); assert.equal(trash.data.outside, true); assert.equal(trash.data.score, 30); // capped
  assert.equal((await api('POST', `/api/stores/${code}/raid`, { raider: '小華', score: 20, outside: true })).status, 429);
  assert.equal((await api('GET', `/api/stores/${code}/reports`)).status, 403);
  const reps = await api('GET', `/api/stores/${code}/reports`, undefined, token);
  assert.equal(reps.status, 200); assert.equal(reps.data.length, 1);
  assert.equal((await api('GET', `/api/stores/${code}/reports`, undefined, token)).data.length, 0); // cleared
  assert.equal((await api('GET', '/api/stores/NOPE00')).status, 404);
  assert.equal((await api('GET', '/api/stores/ABCDEF')).status, 404);
});

test('電腦店員補位 in the RoomDO: bots fill free slots, play on the server, are not counted as players', { timeout: 60_000 }, async () => {
  const [h, j] = await room(2);
  h.send({ type: 'lobbyCfg', bots: true });
  await j.until(() => j.lobby?.bots === true && j.lobby.players.filter(p => p.bot).length === 2, 8000, 'bots in lobby');
  assert.equal((await api('GET', `/api/room/${h.code}`)).data.players, 2);
  j.send({ type: 'ready', ready: true });
  await h.until(() => !!h.lobby?.players.find(p => p.id === j.playerId)?.ready, 8000, 'guest ready');
  h.send({ type: 'start' });
  await h.until(() => !!h.me(), 8000, 'first snapshot');
  const at = new Map(h.snap.players.filter(p => p.bot).map(p => [p.id, { x: p.x, z: p.z }]));
  assert.equal(at.size, 2);
  await h.until(() => h.snap.players.filter(p => p.bot).some(p => Math.hypot(p.x - at.get(p.id).x, p.z - at.get(p.id).z) > 1), 20000, 'a bot walking');
  h.close(); j.close();
});

test('friend store keeps the fourth product line (gas station drinks fridge)', async () => {
  const up = await api('POST', '/api/stores', { name: '油速', map: 'gas', shelves: { drinks: 3, snacks: 4, bento: 5, extra: 7 } });
  assert.equal(up.status, 200);
  assert.deepEqual((await api('GET', `/api/stores/${up.data.code}`)).data.shelves, { drinks: 3, snacks: 4, bento: 5, extra: 7 });
});

test('five simulated players run a full co-op day; day-end save reaches every client (time x6)', { timeout: 150_000 }, async () => {
  const { Bot, botMessages } = await import('../shared/bot.ts');
  const cs = await room(5);
  await start(cs);
  const roles = ['cashier', 'stocker', 'any', 'cleaner', 'any'];
  const bots = cs.map((_, i) => new Bot(roles[i], i / 5));
  let rid = 0, sawOpen = false;
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]; const s = c.snap; const me = c.me(); if (!s || !me) continue;
      if (s.phase === 'open') sawOpen = true;
      const o = bots[i].update(s, me, 0.1 * 6);
      if (me.ready) o.ready = false;
      for (const m of botMessages(o, () => 'n' + rid++)) c.send(m);
    }
    if (sawOpen && cs[0].snap?.phase === 'summary') break;
    await sleep(100);
  }
  const s = cs[0].snap;
  assert.equal(s.phase, 'summary', `phase ${s.phase}`);
  assert.ok(s.dayStats.served > 5, `served ${s.dayStats.served}`);
  await sleep(300);
  assert.equal(new Set(cs.map(c => c.snap.money)).size, 1);
  for (const c of cs) assert.ok(c.gotSave, `${c.name} got the day-end save`);
  console.log('cf co-op day stats', JSON.stringify(s.dayStats), 'rating', s.rating, 'money', s.money);
  cs.forEach(c => c.close());
});

test('Google ID token check (WebCrypto port): signature, audience, issuer, expiry', async () => {
  const { verifyGoogleIdToken } = await import('../cloudflare/src/auth.ts');
  const keys = async () => [jwk];
  const now = Date.now(), good = goodClaims();
  assert.equal((await verifyGoogleIdToken(idToken(good), CLIENT_ID, keys, now))?.sub, '1234567890');
  assert.equal(await verifyGoogleIdToken(idToken(good), 'other-client', keys, now), null, 'wrong audience');
  assert.equal(await verifyGoogleIdToken(idToken({ ...good, iss: 'evil.com' }), CLIENT_ID, keys, now), null, 'wrong issuer');
  assert.equal(await verifyGoogleIdToken(idToken({ ...good, exp: Math.floor(now / 1000) - 10 }), CLIENT_ID, keys, now), null, 'expired');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await verifyGoogleIdToken(idToken(good, 'k1', other), CLIENT_ID, keys, now), null, 'signed by someone else');
  assert.equal(await verifyGoogleIdToken(idToken(good, 'nope'), CLIENT_ID, keys, now), null, 'unknown key id');
  const [h, , sig] = idToken(good).split('.');
  assert.equal(await verifyGoogleIdToken(`${h}.${b64({ ...good, sub: 'hacker' })}.${sig}`, CLIENT_ID, keys, now), null, 'tampered payload');
  assert.equal(await verifyGoogleIdToken('garbage', CLIENT_ID, keys, now), null);
  assert.equal(await verifyGoogleIdToken(idToken(good), '', keys, now), null, 'sign-in off without a client id');
});

test('Google sign-in + licence cards over HTTP (worker + LicenseDO)', { skip: !!process.env.CF_URL }, async () => {
  assert.equal((await api('GET', '/api/auth/config')).data.googleClientId, CLIENT_ID);
  assert.equal((await api('POST', '/api/auth/google', { credential: 'garbage' })).status, 401);
  assert.equal((await api('POST', '/api/auth/google', { credential: idToken({ ...goodClaims(), aud: 'x' }) })).status, 401);
  const a = await api('POST', '/api/auth/google', { credential: idToken(goodClaims()) });
  assert.equal(a.status, 200);
  assert.match(a.data.no, /^\d{4}-\d{4}$/);
  const again = await api('POST', '/api/auth/google', { credential: idToken(goodClaims()) });
  assert.equal(again.data.no, a.data.no, 'same account, same licence');
  assert.notEqual(again.data.session, a.data.session);
  assert.equal((await api('PUT', '/api/license', { level: 9 }, undefined, 'bad')).status, 401);
  const u = await api('PUT', '/api/license', { name: '社畜<b>', level: 28, rank: '區域督導', stars: 40, quote: '上班好累' }, undefined, a.data.session);
  assert.equal(u.status, 200); assert.equal(u.data.name, '社畜b'); assert.equal(u.data.level, 28);
  const pub = await api('GET', `/api/license/${a.data.no}`);
  assert.equal(pub.status, 200); assert.equal(pub.data.level, 28);
  const text = JSON.stringify(pub.data);
  assert.ok(!text.includes('1234567890') && !text.includes('session') && !text.includes('owner') && !text.includes('example.com'), 'public card has no private data');
  assert.equal((await api('GET', '/api/license/0000-0000')).status, 404);
  assert.equal((await api('GET', '/api/license/junk')).status, 404);
  assert.equal((await api('POST', '/api/auth/logout', {}, undefined, a.data.session)).status, 200);
  assert.equal((await api('PUT', '/api/license', { level: 1 }, undefined, a.data.session)).status, 401, 'logged-out session no longer works');
  assert.equal((await api('PUT', '/api/license', { level: 30 }, undefined, again.data.session)).status, 200, 'other device still signed in');
  // up to 5 devices: after 5 more sign-ins the oldest remaining session is dropped
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/google', { credential: idToken(goodClaims()) });
  assert.equal((await api('PUT', '/api/license', { level: 31 }, undefined, again.data.session)).status, 401, 'oldest of >5 sessions dropped');
  const b = await api('POST', '/api/auth/google', { credential: idToken({ ...goodClaims(), sub: '999', name: '別人' }) });
  assert.notEqual(b.data.no, a.data.no);
  assert.equal(b.data.card.name, '別人');
});

test('link via browser (app sign-in) over HTTP: start → complete → poll once (worker + LicenseDO)', { skip: !!process.env.CF_URL }, async () => {
  const web = await api('POST', '/api/auth/google', { credential: idToken({ ...goodClaims(), sub: 'link-1', name: '連結' }) });
  assert.equal(web.status, 200);
  const s = await api('POST', '/api/auth/link/start', {});
  assert.equal(s.status, 200); assert.equal(s.cors, '*');
  assert.match(s.data.code, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  assert.match(s.data.pollToken, /^[0-9a-f]{64}$/);
  assert.equal(s.data.expiresIn, 600);
  const p0 = await api('POST', '/api/auth/link/poll', { pollToken: s.data.pollToken });
  assert.equal(p0.status, 200); assert.equal(p0.data.pending, true);
  assert.equal((await api('POST', '/api/auth/link/poll', { pollToken: '0'.repeat(64) })).status, 404, 'wrong token');
  assert.equal((await api('POST', '/api/auth/link/poll', { pollToken: s.data.code })).status, 404, 'the code is not a token');
  assert.equal((await api('POST', '/api/auth/link/complete', { code: s.data.code })).status, 401, 'needs a signed-in browser');
  assert.equal((await api('POST', '/api/auth/link/complete', { code: 'ZZZ-ZZZ' }, undefined, web.data.session)).status, 404);
  const c = await api('POST', '/api/auth/link/complete', { code: s.data.code.toLowerCase() }, undefined, web.data.session);
  assert.equal(c.status, 200); assert.equal(c.data.no, web.data.no);
  assert.equal((await api('POST', '/api/auth/link/complete', { code: s.data.code }, undefined, web.data.session)).status, 409, 'single use');
  const p1 = await api('POST', '/api/auth/link/poll', { pollToken: s.data.pollToken });
  assert.equal(p1.status, 200); assert.equal(p1.data.no, web.data.no); assert.equal(p1.data.card.name, '連結');
  assert.notEqual(p1.data.session, web.data.session, 'app gets its own session');
  assert.equal((await api('PUT', '/api/license', { level: 7 }, undefined, p1.data.session)).status, 200, 'app session works');
  assert.equal((await api('PUT', '/api/license', { level: 8 }, undefined, web.data.session)).status, 200, 'browser session still works');
  assert.equal((await api('POST', '/api/auth/link/poll', { pollToken: s.data.pollToken })).status, 404, 'handed out once');
  // per-IP start limit (10 per 10 minutes; this test already used one)
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await api('POST', '/api/auth/link/start', {})).status);
  assert.ok(codes.includes(429), `start limited: ${codes}`);
});

test('restart: room restored from the SQLite checkpoint, player rejoins with token', { timeout: 120_000, skip: !!process.env.CF_URL }, async () => {
  const up = await api('POST', '/api/stores', { name: '持久店', money: 100 });
  const lic = await api('POST', '/api/auth/google', { credential: idToken({ ...goodClaims(), sub: 'persist-1' }) });
  const [a, b] = await room(2, { difficulty: 'hard' });
  await start([a, b]);
  const code = a.code, token = a.token, id = a.playerId, day = a.snap.day;
  a.close(); b.close();
  await stopWrangler();
  await startWrangler();
  // friend store survived
  assert.equal((await api('GET', `/api/stores/${up.data.code}`)).data.name, '持久店');
  // licence card and its session survived
  assert.equal((await api('GET', `/api/license/${lic.data.no}`)).status, 200);
  assert.equal((await api('PUT', '/api/license', { level: 5 }, undefined, lic.data.session)).data.level, 5);
  const a2 = new Client('a2'); await a2.connect();
  a2.send({ type: 'join', code, name: '', token });
  await a2.until(() => !!a2.me(), 10000, 'restored snapshot');
  assert.equal(a2.playerId, id);
  assert.equal(a2.snap.day, day);
  assert.equal(a2.snap.phase, 'prep');
  assert.equal((await api('GET', `/api/room/${code}`)).data.difficulty, 'hard');
  a2.close();
});
