// Network integration tests: real server process + real WebSocket clients on localhost.
// These are "multi-client on one machine" tests (模擬玩家/多開), NOT cross-device or cross-network tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg, Snapshot, LobbyState } from '../shared/protocol.ts';
import { Bot } from '../shared/bot.ts';

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

before(async () => { await startServer(); });
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
      c.send({ type: 'input', x: o.x, z: o.z, yaw: o.yaw, pitch: 0, seq: rid++ });
      if (o.act) c.send({ type: 'act', rid: 'n' + rid++, kind: o.act.kind, target: o.act.target });
      if (o.drop) c.send({ type: 'drop', rid: 'd' + rid++ });
      if (o.buy) c.send({ type: 'buy', rid: 'y' + rid++, item: o.buy });
      if (o.ready && !me.ready) c.send({ type: 'ready', ready: true });
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

test('server restart: room restored from checkpoint, player rejoins with token', { timeout: 40_000 }, async () => {
  const [a, b] = await room(2);
  await start([a, b]);
  const code = a.code, token = a.token, id = a.playerId, day = a.snap!.day;
  await stopServer();
  await startServer();
  const a2 = new Client('a2'); await a2.connect();
  a2.send({ type: 'join', code, name: '', token });
  await a2.until(() => !!a2.me(), 8000, 'restored snapshot');
  assert.equal(a2.playerId, id);
  assert.equal(a2.snap!.day, day);
  assert.equal(a2.snap!.phase, 'prep');
  a2.close();
});
