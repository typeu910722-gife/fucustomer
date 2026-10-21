// Network integration tests: real server process + real WebSocket clients on localhost.
// These are "multi-client on one machine" tests (模擬玩家/多開), NOT cross-device or cross-network tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { ClientMsg, GameEvent, ServerMsg, Snapshot, LobbyState } from '../shared/protocol.ts';
import { Bot, botMessages } from '../shared/bot.ts';
import { K, exportSaveCode, parseSaveCode } from '../shared/savecode.ts';
import { newProfile } from '../shared/career.ts';

const PORT = 18000 + Math.floor(Math.random() * 2000);
const URL = `ws://127.0.0.1:${PORT}/ws`;
const DATA = mkdtempSync(path.join(tmpdir(), 'bk-'));
let server: ChildProcess;

async function startServer(env: Record<string, string> = {}) {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, BK_TIME_SCALE: '6', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('server start timeout')), 15000);
    server.stdout!.on('data', d => { if (String(d).includes('server on')) { clearTimeout(t); res(); } });
    server.stderr!.on('data', d => process.stderr.write(d));
  });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise(r => server.once('exit', r));
  server.kill('SIGTERM');
  await done;
}

class Client {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  snap: Snapshot | null = null;
  lobby: LobbyState | null = null;
  playerId = ''; token = ''; code = '';
  errors: { code: string }[] = [];
  results = new Map<string, boolean>();
  private waiters: (() => void)[] = [];
  constructor(public name: string) {}
  connect() {
    return new Promise<void>((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => { this.send({ type: 'hello', v: 1, platform: 'test' }); res(); });
      this.ws.on('error', rej);
      this.ws.on('message', d => {
        const m = JSON.parse(String(d)) as ServerMsg;
        this.msgs.push(m); if (this.msgs.length > 300) this.msgs.splice(0, 150);
        if (m.type === 'snap') this.snap = m.s;
        if (m.type === 'lobby') this.lobby = m.lobby;
        if (m.type === 'welcome') { this.playerId = m.playerId; this.token = m.token; this.code = m.code; }
        if (m.type === 'error') this.errors.push(m);
        if (m.type === 'actResult') this.results.set(m.rid, m.ok);
        this.waiters.splice(0).forEach(f => f());
      });
    });
  }
  send(m: ClientMsg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  async until(pred: () => boolean, ms = 8000, what = 'condition') {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`${this.name}: timeout waiting for ${what}`);
      await new Promise<void>(r => { this.waiters.push(r); setTimeout(r, 100); });
    }
  }
  me() { return this.snap?.players.find(p => p.id === this.playerId); }
  kill() { this.ws.terminate(); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function room(n: number) {
  const host = new Client('host'); await host.connect();
  host.send({ type: 'create', name: 'Host' });
  await host.until(() => !!host.code, 5000, 'room code');
  const clients = [host];
  for (let i = 1; i < n; i++) {
    const c = new Client('c' + i); await c.connect();
    c.send({ type: 'join', code: host.code, name: 'P' + i });
    await c.until(() => !!c.playerId, 5000, 'welcome');
    clients.push(c);
  }
  return clients;
}
async function start(cs: Client[]) {
  cs.slice(1).forEach(c => c.send({ type: 'ready', ready: true }));
  await cs[0].until(() => cs[0].lobby?.players.length === cs.length && cs[0].lobby.players.filter(p => p.ready).length === cs.length - 1, 5000, 'ready');
  cs[0].send({ type: 'start' });
  for (const c of cs) await c.until(() => !!c.me(), 5000, 'first snapshot');
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// host-AFK threshold shortened to 4 s for the vote test (the real game uses HOST_AFK_S = 90)
// 雲端備份: a signed-in licence is seeded on disk (Google sign-in itself needs Google's keys; auth.test.ts covers it)
const LIC_DIR = mkdtempSync(path.join(tmpdir(), 'bk-lic-')), CLOUD_DIR = mkdtempSync(path.join(tmpdir(), 'bk-cloud-'));
const CLOUD_SESSION = 'net-test-session-' + PORT;
const CLOUD_OWNER = createHash('sha256').update('google:net-test').digest('hex');
writeFileSync(path.join(LIC_DIR, CLOUD_OWNER + '.json'), JSON.stringify({ owner: CLOUD_OWNER, no: '1234-5678', sessions: [createHash('sha256').update(CLOUD_SESSION).digest('hex')], createdAt: 1, updatedAt: 1, name: '雲端', level: 1, rank: '', title: '', avatar: '🧑', stars: 0, achievements: 0, storeName: '', quote: '' }));
const TEST_ENV = { BK_HOST_AFK_S: '4', LICENSES_DIR: LIC_DIR, CLOUDSAVES_DIR: CLOUD_DIR, BK_CLOUDSAVE_MIN_S: '0' };
before(async () => { await startServer(TEST_ENV); });
after(async () => { await stopServer(); });

test('two real clients: shared world, movement replicates', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  assert.equal(a.snap!.players.length, 2);
  a.send({ type: 'input', x: 12, z: 9.5, yaw: 0, pitch: 0, seq: 1 });
  for (let i = 0; i < 20; i++) { a.send({ type: 'input', x: 12 - i * 0.1, z: 9.5, yaw: 0, pitch: 0, seq: i }); await sleep(70); }
  await b.until(() => { const pa = b.snap!.players.find(p => p.id === a.playerId)!; return Math.abs(pa.x - 10.1) < 0.4; }, 4000, 'A position at B');
  a.close(); b.close();
});

test('five players OK, sixth rejected with room_full', async () => {
  const cs = await room(5);
  await cs[0].until(() => cs[0].lobby!.players.length === 5, 4000, 'lobby of 5');
  const sixth = new Client('sixth'); await sixth.connect();
  sixth.send({ type: 'join', code: cs[0].code, name: 'Six' });
  await sixth.until(() => sixth.errors.length > 0, 4000, 'error');
  assert.equal(sixth.errors[0].code, 'room_full');
  assert.equal(sixth.playerId, '');
  cs.forEach(c => c.close()); sixth.close();
});

test('simultaneous pickup of the same item: exactly one client wins', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  // both walk to the drinks crate
  for (const c of [a, b]) for (let i = 0; i < 40; i++) { c.send({ type: 'input', x: 1.2 + (c === a ? 0 : 0.4), z: 2.2, yaw: Math.PI, pitch: 0, seq: i }); }
  await sleep(1500);
  for (let k = 0; k < 30 && Math.hypot(a.me()!.x - 1.2, a.me()!.z - 2.2) > 0.3; k++) { a.send({ type: 'input', x: 1.2, z: 2.2, yaw: 0, pitch: 0, seq: 99 + k }); b.send({ type: 'input', x: 1.6, z: 2.2, yaw: 0, pitch: 0, seq: 99 + k }); await sleep(120); }
  a.send({ type: 'act', rid: 'a1', kind: 'takeBox', target: { t: 'crate', product: 'drinks' } });
  await a.until(() => a.me()?.held?.kind === 'box', 4000, 'box');
  a.send({ type: 'drop', rid: 'a2' });
  await a.until(() => (a.snap?.items.length ?? 0) === 1, 4000, 'dropped item');
  const id = a.snap!.items[0].id;
  const before = a.snap!.backstock.drinks;
  a.send({ type: 'act', rid: 'race-a', kind: 'pickup', target: { t: 'item', id } });
  b.send({ type: 'act', rid: 'race-b', kind: 'pickup', target: { t: 'item', id } });
  await a.until(() => a.results.has('race-a'), 4000, 'result a');
  await b.until(() => b.results.has('race-b'), 4000, 'result b');
  assert.equal(Number(a.results.get('race-a')) + Number(b.results.get('race-b')), 1);
  await a.until(() => a.snap!.items.length === 0, 3000, 'item gone');
  const holders = a.snap!.players.filter(p => p.held?.kind === 'box').length;
  assert.equal(holders, 1);
  assert.equal(a.snap!.backstock.drinks, before);
  a.close(); b.close();
});

test('duplicate buy over the network charges once', async () => {
  const [a] = await room(1);
  await start([a]);
  const m0 = a.snap!.money;
  a.send({ type: 'buy', rid: 'dup', item: 'stock_snacks' });
  a.send({ type: 'buy', rid: 'dup', item: 'stock_snacks' });
  await sleep(600);
  assert.equal(a.snap!.money, m0 - 18);
  a.close();
});

test('disconnect + reconnect with token: same character, no duplicate, state intact', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  for (let k = 0; k < 25; k++) { b.send({ type: 'input', x: 3.2, z: 2.2, yaw: 0, pitch: 0, seq: k }); await sleep(100); }
  b.send({ type: 'act', rid: 'bx', kind: 'takeBox', target: { t: 'crate', product: 'snacks' } });
  await b.until(() => b.me()?.held?.kind === 'box', 4000, 'box');
  const token = b.token, id = b.playerId;
  b.kill(); // abrupt: like a phone losing signal
  await a.until(() => a.snap!.players.find(p => p.id === id)?.connected === false, 15000, 'B marked disconnected');
  const b2 = new Client('b2'); await b2.connect();
  b2.send({ type: 'join', code: a.code, name: '', token });
  await b2.until(() => !!b2.me(), 5000, 'resync');
  assert.equal(b2.playerId, id);
  assert.equal(b2.snap!.players.length, 2);
  assert.equal(b2.me()!.held?.kind, 'box');
  assert.equal(b2.snap!.players.filter(p => p.id === id).length, 1);
  a.close(); b2.close();
});

test('host leaves mid-game: room host transfers, simulation continues', async () => {
  const [a, b, c] = await room(3);
  await start([a, b, c]);
  a.send({ type: 'leave' });
  await b.until(() => b.lobby!.hostId !== a.playerId && b.lobby!.players.length === 2, 5000, 'host transfer');
  assert.equal(b.lobby!.hostId, b.playerId);
  const t0 = b.snap!.t;
  await sleep(800);
  assert.ok(b.snap!.t > t0);
  b.close(); c.close();
});

test('five simulated players over the network run a full co-op day (time x6)', { timeout: 150_000 }, async () => {
  const cs = await room(5);
  await start(cs);
  const roles = ['cashier', 'stocker', 'any', 'cleaner', 'any'] as const;
  const bots = cs.map((_, i) => new Bot(roles[i], i / 5));
  let rid = 0;
  const end = Date.now() + 120_000;
  let sawOpen = false;
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
  const s = cs[0].snap!;
  assert.equal(s.phase, 'summary', `phase ${s.phase}`);
  assert.ok(s.dayStats.served > 5, `served ${s.dayStats.served}`);
  // every client agrees on the authoritative economy
  await sleep(300);
  const monies = new Set(cs.map(c => c.snap!.money));
  assert.equal(monies.size, 1);
  console.log('co-op day stats', JSON.stringify(s.dayStats), 'rating', s.rating, 'money', s.money);
  cs.forEach(c => c.close());
});

const HTTP = `http://127.0.0.1:${PORT}`;
async function api(method: string, p: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-owner-token'] = token;
  const r = await fetch(HTTP + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) as Record<string, unknown> };
}

test('rooms on different store types run side by side on one server', async () => {
  const mk = async (map: string) => {
    const h = new Client('h-' + map); await h.connect();
    h.send({ type: 'create', name: 'Host', map } as ClientMsg);
    await h.until(() => !!h.code, 5000, 'room code');
    const j = new Client('j-' + map); await j.connect();
    j.send({ type: 'join', code: h.code, name: 'P' });
    await j.until(() => !!j.playerId, 5000, 'welcome');
    return [h, j];
  };
  const boba = await mk('boba'), cloth = await mk('clothing');
  assert.equal((await api('GET', `/api/room/${boba[0].code}`)).data.map, 'boba');
  assert.equal((await api('GET', `/api/room/${cloth[0].code}`)).data.map, 'clothing');
  assert.equal((await api('GET', '/api/room/ZZZZZ')).status, 404);
  await start(boba); await start(cloth);
  await sleep(3000);
  // the clothing store sells no food; the boba shop does
  assert.deepEqual(cloth[0].snap!.shift.foods, []);
  assert.ok(boba[0].snap!.shift.foods.length > 0);
  for (const c of [...boba, ...cloth]) c.close();
});

test('the host can change store type and difficulty in the lobby; others must re-ready', async () => {
  const [h, j] = await room(2);
  j.send({ type: 'ready', ready: true });
  await h.until(() => !!h.lobby?.players.find(p => p.id === j.playerId)?.ready, 5000, 'guest ready');
  j.send({ type: 'lobbyCfg', map: 'clothing', difficulty: 'hell' } as ClientMsg); // not the host: ignored
  await sleep(300);
  assert.equal(h.lobby!.map, 'convenience');
  h.send({ type: 'lobbyCfg', map: 'clothing', difficulty: 'hell' } as ClientMsg);
  await j.until(() => j.lobby?.map === 'clothing' && j.lobby?.difficulty === 'hell', 5000, 'lobby config');
  assert.equal(j.lobby!.players.find(p => p.id === j.playerId)!.ready, false, 'guest has to ready again');
  h.send({ type: 'lobbyCfg', map: 'not-a-map', difficulty: 'impossible' } as ClientMsg);
  await sleep(300);
  assert.equal(h.lobby!.map, 'clothing'); assert.equal(h.lobby!.difficulty, 'hell');
  assert.equal((await api('GET', `/api/room/${h.code}`)).data.difficulty, 'hell');
  await start([h, j]);
  assert.deepEqual(h.snap!.shift.foods, [], 'clothing store sells no food');
  h.send({ type: 'lobbyCfg', map: 'boba' } as ClientMsg); // too late once started
  await sleep(300);
  assert.equal((await api('GET', `/api/room/${h.code}`)).data.map, 'clothing');
  h.close(); j.close();
});

test('電腦店員補位 over WebSocket: host toggles bots, they play on the server, a person takes a bot\'s slot', { timeout: 60_000 }, async () => {
  const [h, j] = await room(2);
  h.send({ type: 'lobbyCfg', bots: true } as ClientMsg);
  await j.until(() => j.lobby?.bots === true && j.lobby.players.filter(p => p.bot).length === 2, 5000, 'bots in lobby');
  assert.equal(j.lobby!.players.length, 4);
  assert.equal((await api('GET', `/api/room/${h.code}`)).data.players, 2, 'bots are not counted as players');
  j.send({ type: 'ready', ready: true });
  await h.until(() => !!h.lobby?.players.find(p => p.id === j.playerId)?.ready, 5000, 'guest ready');
  h.send({ type: 'start' });
  for (const c of [h, j]) await c.until(() => !!c.me(), 5000, 'first snapshot');
  const botIds = h.snap!.players.filter(p => p.bot).map(p => p.id);
  assert.equal(botIds.length, 2);
  const startPos = new Map(h.snap!.players.filter(p => p.bot).map(p => [p.id, { x: p.x, z: p.z }]));
  await h.until(() => h.snap!.players.filter(p => p.bot).some(p => Math.hypot(p.x - startPos.get(p.id)!.x, p.z - startPos.get(p.id)!.z) > 1), 20000, 'a bot walking');
  // two more people: the room is full (4 people + 1 bot); a fifth person still gets in and the last bot gives way
  const extra: Client[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new Client('x' + i); await c.connect();
    c.send({ type: 'join', code: h.code, name: 'X' + i });
    await c.until(() => !!c.playerId, 5000, 'welcome'); extra.push(c);
  }
  await h.until(() => h.lobby?.players.filter(p => p.bot).length === 0 && h.lobby.players.length === 5, 5000, 'bots gave way');
  extra[2].send({ type: 'leave' });
  await h.until(() => h.lobby?.players.filter(p => p.bot).length === 1, 5000, 'a bot fills the free slot again');
  for (const c of [h, j, ...extra]) c.close();
});

test('friend store API: upload, lock, raid, reports (owner token required)', async () => {
  const up = await api('POST', '/api/stores', { name: '測試店', map: 'boba', money: 2000, rating: 3.5, shelves: { drinks: 4, snacks: 4, bento: 4 } });
  assert.equal(up.status, 200);
  const code = up.data.code as string, token = up.data.token as string;
  assert.match(code, /^[A-Z0-9]{6}$/);
  const view = await api('GET', `/api/stores/${code}`);
  assert.equal(view.data.name, '測試店'); assert.equal(view.data.money, undefined);
  assert.equal((await api('PUT', `/api/stores/${code}`, { locked: true }, 'wrong')).status, 403);
  assert.equal((await api('PUT', `/api/stores/${code}`, { locked: true }, token)).status, 200);
  assert.equal((await api('POST', `/api/stores/${code}/raid`, { raider: 'x', score: 300 })).status, 423);
  const trash = await api('POST', `/api/stores/${code}/raid`, { raider: '小華', score: 20, outside: true });
  assert.equal(trash.status, 200); assert.equal(trash.data.outside, true);
  assert.equal((await api('POST', `/api/stores/${code}/raid`, { raider: '小華', score: 20, outside: true })).status, 429);
  assert.equal((await api('GET', `/api/stores/${code}/reports`)).status, 403);
  const reps = await api('GET', `/api/stores/${code}/reports`, undefined, token);
  assert.equal(reps.status, 200); assert.equal((reps.data as unknown as unknown[]).length, 1);
  assert.equal((await api('GET', '/api/stores/NOPE00')).status, 404);
});

test('link via browser (app sign-in) HTTP API: start, pending poll, complete needs a session, wrong token rejected', async () => {
  const s = await api('POST', '/api/auth/link/start', {});
  assert.equal(s.status, 200);
  assert.match(String(s.data.code), /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  assert.match(String(s.data.pollToken), /^[0-9a-f]{64}$/);
  const p = await api('POST', '/api/auth/link/poll', { pollToken: s.data.pollToken });
  assert.equal(p.status, 200); assert.equal(p.data.pending, true);
  assert.equal((await api('POST', '/api/auth/link/poll', { pollToken: '0'.repeat(64) })).status, 404);
  assert.equal((await api('POST', '/api/auth/link/poll', { pollToken: s.data.code })).status, 404);
  assert.equal((await api('POST', '/api/auth/link/complete', { code: s.data.code })).status, 401);
});

// ---- round 25: co-op feel (reconnect state, emote wheel limit, kick / host transfer, lobby ping) ----
const events = (c: Client) => c.msgs.flatMap(m => (m.type === 'events' ? m.list : []));

test('reconnect mid-shift with an outfit: back as connected (was stuck "disconnected"), same spot, box still in hand', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  for (let k = 0; k < 25; k++) { b.send({ type: 'input', x: 3.2, z: 2.2, yaw: 0, pitch: 0, seq: k }); await sleep(100); }
  b.send({ type: 'act', rid: 'bx', kind: 'takeBox', target: { t: 'crate', product: 'snacks' } });
  await b.until(() => b.me()?.held?.kind === 'box', 4000, 'box');
  const pos = { x: b.me()!.x, z: b.me()!.z };
  const token = b.token, id = b.playerId;
  b.kill();
  await a.until(() => a.snap!.players.find(p => p.id === id)?.connected === false, 15000, 'B marked disconnected');
  const t0 = Date.now();
  const b2 = new Client('b2'); await b2.connect();
  b2.send({ type: 'join', code: a.code, name: 'P1', token, outfit: { hat: 'hat_cap' } });
  await b2.until(() => !!b2.me(), 5000, 'resync');
  const ms = Date.now() - t0;
  assert.equal(b2.playerId, id);
  assert.equal(b2.me()!.connected, true, 'the world player is connected again');
  assert.equal(b2.me()!.held?.kind, 'box');
  assert.ok(Math.hypot(b2.me()!.x - pos.x, b2.me()!.z - pos.z) < 0.6, 'same spot');
  assert.equal(b2.me()!.outfit?.hat, 'hat_cap');
  await a.until(() => a.snap!.players.find(p => p.id === id)?.connected === true, 3000, 'A sees B connected');
  await a.until(() => events(a).some(e => e.e === 'toast' && /回到店裡/.test(e.text)), 3000, 'back-in-store toast');
  console.log(`rejoin with token took ${ms} ms (same machine, localhost)`);
  a.close(); b2.close();
});

test('emote wheel: presets only, bubble data (sender id + index), server rate limit with a hint', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  a.send({ type: 'quick', msg: 99 }); a.send({ type: 'quick', msg: 1.5 }); a.send({ type: 'quick', msg: 'hi' } as unknown as ClientMsg);
  a.send({ type: 'quick', msg: 5 });
  await b.until(() => events(b).some(e => e.e === 'quick'), 3000, 'first emote');
  const first = events(b).filter(e => e.e === 'quick');
  assert.equal(first.length, 1, 'invalid indexes are dropped');
  const q = first[0] as Extract<GameEvent, { e: 'quick' }>;
  assert.equal(q.id, a.playerId); assert.equal(q.msg, 5); assert.equal(q.text, '讚！');
  // spam: 10 more within ~2 s → at most 2 more (3 per 6 s window), and the sender gets a hint
  for (let i = 0; i < 10; i++) { a.send({ type: 'quick', msg: i % 8 }); await sleep(200); }
  await sleep(400);
  const n = events(b).filter(e => e.e === 'quick').length;
  assert.ok(n <= 3, `rate limited (${n} delivered)`);
  assert.ok(n >= 2, `but not muted (${n})`);
  assert.ok(events(a).some(e => e.e === 'hint' && /太快/.test(e.text)), 'sender told to slow down');
  a.close(); b.close();
});

test('lobby: pings shown per player; host kick (people only) and host transfer', async () => {
  const [h, j, k] = await room(3);
  j.send({ type: 'hb', t: Date.now(), rtt: 42 });
  await h.until(() => h.lobby?.players.find(p => p.id === j.playerId)?.ping === 42, 5000, 'ping in lobby');
  // only the host can kick / transfer
  j.send({ type: 'kick', id: k.playerId }); j.send({ type: 'host', id: j.playerId });
  await sleep(300);
  assert.equal(h.lobby!.players.length, 3); assert.equal(h.lobby!.hostId, h.playerId);
  h.send({ type: 'kick', id: h.playerId }); // not yourself
  await sleep(200);
  assert.equal(h.lobby!.players.length, 3);
  h.send({ type: 'kick', id: k.playerId });
  await k.until(() => k.errors.some(e => e.code === 'kicked'), 3000, 'kicked notice');
  await h.until(() => h.lobby!.players.length === 2, 3000, 'kicked player gone');
  // transfer: j becomes host and can start; h can't any more
  h.send({ type: 'host', id: j.playerId });
  await j.until(() => j.lobby?.hostId === j.playerId, 3000, 'host transferred');
  h.send({ type: 'ready', ready: true });
  await j.until(() => !!j.lobby?.players.find(p => p.id === h.playerId)?.ready, 3000, 'old host readies');
  h.send({ type: 'start' }); await sleep(300);
  assert.equal(j.snap, null, 'old host cannot start');
  j.send({ type: 'start' });
  await j.until(() => !!j.me(), 4000, 'new host started');
  h.close(); j.close(); k.close();
});

test('host drops mid-game: the next person takes over with a clear message; game keeps running', async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  a.kill();
  await b.until(() => b.lobby?.hostId === b.playerId, 15000, 'host migrated');
  await b.until(() => events(b).some(e => e.e === 'toast' && /接任房主/.test(e.text)), 3000, 'host message');
  const t0 = b.snap!.t; await sleep(600); assert.ok(b.snap!.t > t0);
  b.close();
});

test('fill-in bots split the work and answer a 「需要支援收銀」 callout', { timeout: 60_000 }, async () => {
  const [h, j] = await room(2);
  h.send({ type: 'lobbyCfg', bots: true } as ClientMsg);
  await j.until(() => j.lobby?.players.filter(p => p.bot).length === 2, 5000, 'bots');
  h.send({ type: 'kick', id: j.lobby!.players.find(p => p.bot)!.id }); // bots can't be kicked (the 補位 switch handles them)
  await sleep(300);
  assert.equal(h.lobby!.players.filter(p => p.bot).length, 2);
  j.send({ type: 'ready', ready: true });
  await h.until(() => !!h.lobby?.players.find(p => p.id === j.playerId)?.ready, 5000, 'ready');
  h.send({ type: 'start' });
  await h.until(() => !!h.me(), 5000, 'snap');
  h.send({ type: 'quick', msg: 0 });
  await h.until(() => events(h).some(e => e.e === 'quick' && e.msg === 5 && h.snap!.players.find(p => p.id === e.id)?.bot === true), 5000, 'a bot answers 👍');
  h.close(); j.close();
});

test('mid-shift: pings reach the team list, host kicks / hands over / adds and removes bots (validated + rate limited)', { timeout: 40_000 }, async () => {
  const [h, j, k] = await room(3);
  await start([h, j, k]);
  // pings keep flowing during the shift (lobby updates at most every 2 s)
  j.send({ type: 'hb', t: Date.now(), rtt: 55 });
  await h.until(() => h.lobby?.started === true && h.lobby.players.find(p => p.id === j.playerId)?.ping === 55, 5000, 'in-shift ping');
  j.send({ type: 'hb', t: Date.now(), rtt: 120 });
  await h.until(() => h.lobby?.players.find(p => p.id === j.playerId)?.ping === 120, 5000, 'in-shift ping update');
  // only the host; never yourself; bots via the bot message only
  j.send({ type: 'kick', id: k.playerId }); j.send({ type: 'bot', op: 'add' });
  await sleep(700);
  h.send({ type: 'kick', id: h.playerId });
  await sleep(700);
  assert.equal(h.snap!.players.length, 3, 'nobody removed / added');
  // burst of 6 adds: rate limited to 3 host actions per 2 s → 2 bots (cap) + 1 「最多」 hint, the other 3 dropped
  for (let i = 0; i < 6; i++) h.send({ type: 'bot', op: 'add' });
  await h.until(() => h.snap!.players.filter(p => p.bot).length === 2, 4000, 'two bots added');
  await h.until(() => events(h).some(e => e.e === 'hint' && /最多/.test(e.text)), 3000, 'cap hint');
  await sleep(500);
  assert.equal(events(h).filter(e => e.e === 'hint' && /最多/.test(e.text)).length, 1, 'only 3 of the 6 requests were handled');
  assert.equal(h.snap!.players.length, 5);
  assert.equal(h.lobby!.players.filter(p => p.bot).length, 2);
  await sleep(2100); // let the rate-limit window pass
  // remove one bot
  const bot = h.lobby!.players.find(p => p.bot)!;
  h.send({ type: 'bot', op: 'remove', id: bot.id });
  await h.until(() => !h.snap!.players.some(p => p.id === bot.id), 4000, 'bot removed');
  // kick k mid-shift: k is told, leaves the world; the others keep playing
  h.send({ type: 'kick', id: k.playerId });
  await k.until(() => k.errors.some(e => e.code === 'kicked'), 4000, 'kicked notice');
  await h.until(() => !h.snap!.players.some(p => p.id === k.playerId), 4000, 'kicked player left the world');
  assert.ok(events(j).some(e => e.e === 'toast' && /請 P2 離開/.test(e.text)), 'others told');
  // the freed slot does not silently refill beyond what the host asked for (1 bot)
  await sleep(500);
  assert.equal(h.snap!.players.filter(p => p.bot).length, 1);
  // hand over the host role mid-shift; the old host loses the tools
  h.send({ type: 'host', id: j.playerId });
  await j.until(() => j.lobby?.hostId === j.playerId, 4000, 'host handed over');
  await sleep(2100);
  h.send({ type: 'bot', op: 'add' }); await sleep(500);
  assert.equal(h.snap!.players.filter(p => p.bot).length, 1, 'ex-host cannot add bots');
  const t0 = j.snap!.t; await sleep(500); assert.ok(j.snap!.t > t0, 'shift keeps running');
  h.close(); j.close(); k.close();
});

test('idle host: the others vote (majority) to hand the host role on; the host moving cancels it', { timeout: 40_000 }, async () => {
  const [h, a, b] = await room(3);
  await start([h, a, b]);
  // too early: the host was active a moment ago
  a.send({ type: 'voteHost', yes: true });
  await a.until(() => events(a).some(e => e.e === 'hint' && /不能投票/.test(e.text)), 3000, 'too-early hint');
  // the host idles (no input) past the threshold (4 s in this test)
  await h.until(() => h.lobby?.hostAfk === true, 9000, 'host marked idle');
  assert.equal(h.lobby!.afkNeed, 2, 'majority of the two others');
  a.send({ type: 'voteHost', yes: true });
  await h.until(() => h.lobby?.afkVotes === 1, 3000, 'one vote');
  assert.equal(h.lobby!.hostId, h.playerId, 'one vote is not enough');
  // the host comes back (moves): votes are cleared
  h.send({ type: 'input', x: 0, z: 0, yaw: 0, pitch: 0, seq: 1 });
  h.send({ type: 'input', x: 0, z: 0, yaw: 1, pitch: 0, seq: 2 });
  await h.until(() => !h.lobby?.hostAfk, 3000, 'idle flag cleared');
  // idle again → two votes → the earliest-joined voter takes over
  await h.until(() => h.lobby?.hostAfk === true, 9000, 'idle again');
  await sleep(1100); // per-voter vote rate limit (1 s)
  b.send({ type: 'voteHost', yes: true });
  await h.until(() => h.lobby?.afkVotes === 1, 3000, 'b votes');
  a.send({ type: 'voteHost', yes: true });
  await b.until(() => b.lobby?.hostId === a.playerId, 4000, 'host voted over to a');
  await b.until(() => events(b).some(e => e.e === 'toast' && /投票由 P1 接任房主/.test(e.text)), 3000, 'vote result announced');
  assert.ok(!b.lobby!.hostAfk, 'new host starts fresh');
  // the old host cannot vote for themself back while a is active, and has no host tools
  h.send({ type: 'kick', id: b.playerId }); await sleep(500);
  assert.ok(b.snap!.players.some(p => p.id === b.playerId));
  h.close(); a.close(); b.close();
});

test('server restart: room restored from checkpoint, player rejoins with token', { timeout: 40_000 }, async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  const code = a.code, token = a.token, id = a.playerId, day = a.snap!.day;
  await stopServer();
  await startServer(TEST_ENV);
  const a2 = new Client('a2'); await a2.connect();
  a2.send({ type: 'join', code, name: '', token });
  await a2.until(() => !!a2.me(), 8000, 'restored snapshot');
  assert.equal(a2.playerId, id);
  assert.equal(a2.snap!.day, day);
  assert.equal(a2.snap!.phase, 'prep');
  a2.close();
});

test('cloud save HTTP API: CORS, sign-in required, size cap, upload/download, survives a restart, delete', async () => {
  const call = async (method: string, body?: unknown, session?: string, raw?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (session) headers['x-session'] = session;
    const r = await fetch(HTTP + '/api/cloudsave', { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    return { status: r.status, methods: r.headers.get('access-control-allow-methods'), data: await r.json().catch(() => ({})) as Record<string, any> };
  };
  assert.match(String((await call('OPTIONS')).methods), /DELETE/);
  const code = exportSaveCode({ [K.career]: JSON.stringify({ ...newProfile(), level: 7 }) });
  assert.equal((await call('PUT', { code })).status, 401);
  assert.equal((await call('GET', undefined, 'nope')).status, 401);
  assert.equal((await call('DELETE')).status, 401);
  assert.equal((await call('GET', undefined, CLOUD_SESSION)).status, 404);
  assert.equal((await call('PUT', { code: 'FUC1-xx' }, CLOUD_SESSION)).status, 400);
  assert.equal((await call('PUT', undefined, CLOUD_SESSION, JSON.stringify({ code: 'x'.repeat(80_000) }))).status, 413);
  const up = await call('PUT', { code }, CLOUD_SESSION);
  assert.equal(up.status, 200); assert.equal(up.data.summary.level, 7);
  await stopServer();
  await startServer(TEST_ENV);
  const g = await call('GET', undefined, CLOUD_SESSION);
  assert.equal(g.status, 200, 'kept across a restart'); assert.equal(g.data.latest.summary.level, 7); assert.equal(g.data.prev, null);
  assert.ok(parseSaveCode(g.data.latest.code).ok);
  assert.equal((await call('DELETE', undefined, CLOUD_SESSION)).data.deleted, true);
  assert.equal((await call('GET', undefined, CLOUD_SESSION)).status, 404);
});
