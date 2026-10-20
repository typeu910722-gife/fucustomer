// Round 25: co-op feel. Fill-in bots (電腦店員) split the work, give people room and react to callouts;
// emote wheel direction → slot. Simulated players (模擬玩家) in one process — not real people, not real devices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, type Conn } from '../shared/room.ts';
import { applyMap, REGISTERS } from '../shared/map.ts';
import { QUICK_ICONS, QUICK_MESSAGES } from '../shared/constants.ts';
import type { ServerMsg, Snapshot } from '../shared/protocol.ts';
import { exclusiveKey } from '../shared/bot.ts';
import { wheelSlot } from '../client/src/emote-wheel.ts';

class FakeConn implements Conn {
  snap: Snapshot | null = null; playerId = ''; events: ServerMsg[] = [];
  send(m: ServerMsg) { if (m.type === 'snap') this.snap = m.s; else this.events.push(m); if (m.type === 'welcome') this.playerId = m.playerId; }
  close() {}
}

/** Two people (one working register 0, one standing just inside the door) + two fill-in bots for `secs` of open hours. */
function coopRun(seed: number, secs: number) {
  applyMap('convenience');
  let t = 0;
  const room = new Room('COOP', null, { now: () => t, seed });
  const a = new FakeConn(), b = new FakeConn();
  room.join(a, 'A', undefined); room.join(b, 'B', undefined);
  room.handle(a.playerId, { type: 'lobbyCfg', bots: true });
  room.handle(b.playerId, { type: 'ready', ready: true });
  room.handle(a.playerId, { type: 'start' });
  const reg = REGISTERS[0];
  let snaps = 0, sameGoal = 0, nearPerson = 0, lastT = -1, openT = 0;
  const bots = (room as unknown as { bots: Map<string, { bot: { claimKeys(): string[]; currentGoal: string } }> }).bots;
  for (let i = 0; openT < secs && i < 20 * 900; i++) {
    t += 50; room.update(0.05);
    const s = a.snap; if (!s) continue;
    room.handle(a.playerId, { type: 'input', x: reg.cashier.x, z: reg.cashier.z, yaw: 0, pitch: 0, seq: i });
    if (i % 10 === 0) room.handle(a.playerId, { type: 'act', rid: 'a' + i, kind: 'checkout', target: { t: 'register', idx: 0 } });
    room.handle(b.playerId, { type: 'input', x: 12, z: 11.5, yaw: 0, pitch: 0, seq: i });
    if (s.phase !== 'open') { for (const c of [a, b]) room.handle(c.playerId, { type: 'ready', ready: true }); continue; }
    if (s.t === lastT) continue;
    lastT = s.t; snaps++; openT += 1 / 12;
    const goals = [...bots.values()].map(x => x.bot.currentGoal).filter(exclusiveKey);
    if (goals.length === 2 && goals[0] === goals[1]) sameGoal++;
    for (const p of s.players.filter(p => p.bot)) for (const h of s.players.filter(p => !p.bot)) if (Math.hypot(p.x - h.x, p.z - h.z) < 0.7) nearPerson++;
  }
  return { room, a, b, sameGoal: sameGoal / snaps, nearPerson: nearPerson / (snaps * 2) };
}

test('fill-in bots split the work: they rarely chase the same task and keep out of people\'s faces', () => {
  for (const seed of [1, 2, 3]) {
    const r = coopRun(seed, 150);
    console.log(`seed ${seed}: same task ${(r.sameGoal * 100).toFixed(1)}% of the time, within 0.7 m of a person ${(r.nearPerson * 100).toFixed(1)}%`);
    // before round 25 (same harness, seeds 1–3): 20–35 % same task, 2.6–8.1 % within 0.7 m of a person
    assert.ok(r.sameGoal < 0.12, `same task ${(r.sameGoal * 100).toFixed(1)}%`);
    assert.ok(r.nearPerson < 0.05, `near a person ${(r.nearPerson * 100).toFixed(1)}%`);
  }
});

test('callouts: a bot answers 「需要支援收銀」 with 👍; emotes carry sender + preset index; spam is limited per player', () => {
  const r = coopRun(4, 5);
  const before = r.b.events.length;
  r.room.handle(r.a.playerId, { type: 'quick', msg: 0 });
  r.room.handle(r.a.playerId, { type: 'quick', msg: 0 }); // too soon: dropped
  const quick = r.b.events.slice(before).flatMap(m => (m.type === 'events' ? m.list : [])).filter(e => e.e === 'quick');
  assert.equal(quick.length, 2, 'the callout + one bot reply');
  assert.equal(quick[0].e === 'quick' && quick[0].id, r.a.playerId);
  const reply = quick[1];
  assert.ok(reply.e === 'quick' && reply.msg === 5 && reply.id !== r.a.playerId);
  // a hint goes back to the spammer (not to everyone)
  assert.ok(r.a.events.some(m => m.type === 'events' && m.list.some(e => e.e === 'hint')));
  assert.ok(!r.b.events.some(m => m.type === 'events' && m.list.some(e => e.e === 'hint')));
});

test('emote wheel: 8 presets with icons; direction → slot (0 = up, clockwise), dead zone in the middle', () => {
  assert.equal(QUICK_MESSAGES.length, 8); assert.equal(QUICK_ICONS.length, 8);
  assert.equal(wheelSlot(0, 1), 0);
  assert.equal(wheelSlot(1, 0), 2);
  assert.equal(wheelSlot(0, -1), 4);
  assert.equal(wheelSlot(-1, 0), 6);
  assert.equal(wheelSlot(0.7, 0.7), 1);
  assert.equal(wheelSlot(-0.7, 0.7), 7);
  assert.equal(wheelSlot(0.1, 0.1), null);
});
