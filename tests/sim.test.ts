// Simulation + room rule tests (in-process, simulated players — no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, Conn } from '../shared/room.ts';
import { Bot } from '../shared/bot.ts';
import { createWorld, addPlayer, requestAct, requestBuy, tick, snapshot, defaultSave, requestDrop } from '../shared/sim.ts';
import type { ServerMsg, Snapshot } from '../shared/protocol.ts';
import { MAX_PLAYERS } from '../shared/constants.ts';

class FakeConn implements Conn {
  msgs: ServerMsg[] = []; closed = '';
  snap: Snapshot | null = null; playerId = ''; token = '';
  send(m: ServerMsg) {
    this.msgs.push(m);
    if (m.type === 'snap') this.snap = m.s;
    if (m.type === 'welcome') { this.playerId = m.playerId; this.token = m.token; }
    if (this.msgs.length > 500) this.msgs.splice(0, 250);
  }
  close(r: string) { this.closed = r; }
}

function clockRoom(solo = false) {
  let t = 1_000_000;
  const room = new Room('TEST1', defaultSave(), { solo, now: () => t });
  return { room, advance: (ms: number) => { t += ms; } };
}

test('sixth player is rejected; reconnect reuses the same slot', () => {
  const { room } = clockRoom();
  const conns = Array.from({ length: MAX_PLAYERS }, () => new FakeConn());
  conns.forEach((c, i) => assert.equal(room.join(c, 'P' + i, undefined).ok, true));
  const sixth = room.join(new FakeConn(), 'P6', undefined);
  assert.equal(sixth.ok, false);
  assert.equal(!sixth.ok && sixth.code, 'room_full');
  // disconnected players keep their slot during grace
  room.disconnect(conns[2]);
  assert.equal(room.join(new FakeConn(), 'late', undefined).ok, false);
  const back = new FakeConn();
  const r = room.join(back, 'ignored', conns[2].token);
  assert.equal(r.ok, true);
  assert.equal(back.playerId, conns[2].playerId);
  assert.equal(room.members.size, MAX_PLAYERS);
});

test('host transfer when host leaves; game keeps running', () => {
  const { room } = clockRoom();
  const a = new FakeConn(), b = new FakeConn();
  room.join(a, 'A', undefined); room.join(b, 'B', undefined);
  room.handle(b.playerId, { type: 'ready', ready: true });
  room.handle(a.playerId, { type: 'start' });
  assert.equal(room.started, true);
  room.handle(a.playerId, { type: 'leave' });
  assert.equal(room.hostId, b.playerId);
  for (let i = 0; i < 40; i++) room.update(0.05);
  assert.ok(b.snap);
  assert.equal(b.snap!.players.length, 1);
});

test('reconnect during game does not duplicate the character or items', () => {
  const { room, advance } = clockRoom();
  const a = new FakeConn(), b = new FakeConn();
  room.join(a, 'A', undefined); room.join(b, 'B', undefined);
  room.handle(b.playerId, { type: 'ready', ready: true });
  room.handle(a.playerId, { type: 'start' });
  const w = room.world!;
  const pb = w.players.get(b.playerId)!;
  pb.x = 1.2; pb.z = 2.4;
  const before = w.backstock.drinks;
  room.handle(b.playerId, { type: 'act', rid: 'r1', kind: 'takeBox', target: { t: 'crate', product: 'drinks' } });
  assert.equal(pb.held?.kind, 'box');
  room.disconnect(b);
  advance(30_000); room.update(0.05);
  const b2 = new FakeConn();
  assert.equal(room.join(b2, 'B', b.token).ok, true);
  assert.equal(w.players.size, 2);
  assert.equal(w.players.get(b.playerId)!.held?.kind, 'box');
  assert.equal(w.backstock.drinks, before - 6);
  // resent request id after reconnect is not applied twice
  room.handle(b.playerId, { type: 'act', rid: 'r1', kind: 'takeBox', target: { t: 'crate', product: 'drinks' } });
  assert.equal(w.backstock.drinks, before - 6);
});

test('player removed after grace drops their box back into the world exactly once', () => {
  const { room, advance } = clockRoom();
  const a = new FakeConn(), b = new FakeConn();
  room.join(a, 'A', undefined); room.join(b, 'B', undefined);
  room.handle(b.playerId, { type: 'ready', ready: true });
  room.handle(a.playerId, { type: 'start' });
  const w = room.world!;
  const pb = w.players.get(b.playerId)!; pb.x = 1.2; pb.z = 2.4;
  room.handle(b.playerId, { type: 'act', rid: 'x', kind: 'takeBox', target: { t: 'crate', product: 'drinks' } });
  room.disconnect(b);
  advance(121_000); room.update(0.05);
  assert.equal(w.players.size, 1);
  assert.equal(w.items.length, 1);
  assert.equal(room.join(new FakeConn(), 'B', b.token).ok, true); // token expired → joins as a new member
  assert.equal(w.items.length, 1);
});

test('two players grabbing the same dropped item: only one gets it', () => {
  const w = createWorld(defaultSave(), 1);
  const a = addPlayer(w, 'a', 'A', 1), b = addPlayer(w, 'b', 'B', 2);
  a.x = b.x = 1.2; a.z = b.z = 2.4;
  requestAct(w, 'a', '1', 'takeBox', { t: 'crate', product: 'snacks' });
  requestDrop(w, 'a', 'd1');
  const id = w.items[0].id;
  requestAct(w, 'a', '2', 'pickup', { t: 'item', id });
  requestAct(w, 'b', '3', 'pickup', { t: 'item', id });
  const res = w.results.filter(r => r.rid === '2' || r.rid === '3');
  assert.deepEqual(res.map(r => r.ok), [true, false]);
  assert.equal(b.held, null);
  assert.equal(w.items.length, 0);
});

test('duplicate purchase request charges once; stale upgrade level rejected', () => {
  const w = createWorld({ ...defaultSave(), money: 1000 }, 2);
  addPlayer(w, 'a', 'A', 1); addPlayer(w, 'b', 'B', 2);
  requestBuy(w, 'a', 'buy1', 'stock_bento');
  requestBuy(w, 'a', 'buy1', 'stock_bento');
  assert.equal(w.money, 1000 - 42);
  requestBuy(w, 'a', 'u1', 'upg_scanner', 0);
  requestBuy(w, 'b', 'u2', 'upg_scanner', 0); // teammate clicked at the same time
  assert.equal(w.upgrades.scanner, 1);
  assert.equal(w.money, 1000 - 42 - 180);
});

test('checkout requires a waiting customer and pays once', () => {
  const w = createWorld(defaultSave(), 3);
  const a = addPlayer(w, 'a', 'A', 1);
  w.phase = 'open'; w.phaseLeft = 300;
  // put a customer straight at register 0
  w.customers.push({ id: 99, kind: 'normal', x: 16.5, z: 12.5, yaw: 0, state: 'atRegister', path: [], speed: 1, shopping: [], items: ['bento', 'drinks'], wantsCoffee: false, coffeeDone: false, coffeeFailed: false, patience: 50, patienceMax: 50, mood: 80, timer: 0, register: 0, anger: 0, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 0, look: 0, angry: false, moving: false, knockTimer: 9, gone: false });
  w.registers[0] = 99;
  a.x = 16.5; a.z = 10.3;
  const m0 = w.money;
  requestAct(w, 'a', 'c1', 'checkout', { t: 'register', idx: 0 });
  for (let i = 0; i < 40; i++) tick(w, 0.05);
  assert.ok(w.money >= m0 + 22, `money ${w.money}`);
  const m1 = w.money;
  requestAct(w, 'a', 'c2', 'checkout', { t: 'register', idx: 0 });
  for (let i = 0; i < 40; i++) tick(w, 0.05);
  assert.equal(w.money, m1);
});

function runBots(n: number, seconds: number, seed = 7) {
  const { room } = clockRoom();
  const conns = Array.from({ length: n }, () => new FakeConn());
  conns.forEach((c, i) => room.join(c, 'Bot' + i, undefined));
  conns.slice(1).forEach(c => room.handle(c.playerId, { type: 'ready', ready: true }));
  room.handle(conns[0].playerId, { type: 'start' });
  const roles = ['cashier', 'stocker', 'any', 'cleaner', 'any'] as const;
  const bots = conns.map((_, i) => new Bot(n === 1 ? 'any' : roles[i], (seed * (i + 1) % 10) / 10));
  const dt = 0.05;
  let rid = 0;
  let phases = new Set<string>();
  for (let t = 0; t < seconds; t += dt) {
    room.update(dt);
    conns.forEach((c, i) => {
      const s = c.snap; if (!s) return;
      phases.add(s.phase);
      const me = s.players.find(p => p.id === c.playerId); if (!me) return;
      const o = bots[i].update(s, me, dt);
      room.handle(c.playerId, { type: 'input', x: o.x, z: o.z, yaw: o.yaw, pitch: 0, seq: 0 });
      if (o.act) room.handle(c.playerId, { type: 'act', rid: 'b' + rid++, kind: o.act.kind, target: o.act.target });
      if (o.drop) room.handle(c.playerId, { type: 'drop', rid: 'd' + rid++ });
      if (o.buy) room.handle(c.playerId, { type: 'buy', rid: 'y' + rid++, item: o.buy });
      if (o.ready) room.handle(c.playerId, { type: 'ready', ready: true });
    });
  }
  return { room, phases, conns };
}

test('solo bot completes a full business day (prep → open → closing → summary → day 2)', () => {
  const { room, phases } = runBots(1, 520);
  const w = room.world!;
  assert.ok(phases.has('open') && phases.has('summary'), [...phases].join(','));
  assert.equal(w.day, 2);
  assert.ok(room.save.totals.served > 5, `served ${room.save.totals.served}`);
  assert.equal(room.save.day, 2);
});

test('five bots: workload scales and the day completes', () => {
  const { room } = runBots(5, 470, 3);
  const st = room.save.totals;
  assert.ok(st.served > 15, `served ${st.served}`);
  assert.ok(room.world!.day >= 2);
});
