// Round 20: the employee bot keeps every shelf stocked (incl. a fourth 'extra' line), 電腦店員補位 in multiplayer rooms,
// hiring 小陳 in free play, and friend stores with a fourth product line.
// These are simulated players (模擬玩家) in one process, not real people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, type Conn } from '../shared/room.ts';
import { Bot, botMessages } from '../shared/bot.ts';
import { applyMap } from '../shared/map.ts';
import { MAX_PLAYERS, PRODUCTS } from '../shared/constants.ts';
import type { ServerMsg, Snapshot } from '../shared/protocol.ts';
import { StoreRegistry } from '../server/stores.ts';
import { buildRaidConfig } from '../shared/raid.ts';
import { FREEPLAY_STAFF_WAGE } from '../shared/ownstore.ts';

class FakeConn implements Conn {
  snap: Snapshot | null = null; playerId = ''; token = ''; closed = '';
  send(m: ServerMsg) { if (m.type === 'snap') this.snap = m.s; if (m.type === 'welcome') { this.playerId = m.playerId; this.token = m.token; } }
  close(r: string) { this.closed = r; }
}

/** One business day: the 'any' employee plus a cashier bot standing in for the player. Returns how long shelves sat empty. */
function staffDay(map: string, seed: number) {
  applyMap(map);
  let t = 0;
  const room = new Room('S', null, { solo: true, now: () => t, seed, map });
  const me = new FakeConn(), st = new FakeConn();
  room.join(me, 'me', undefined, 'solo'); room.join(st, '小陳', undefined, 'staff');
  room.startGame();
  const staff = new Bot('any', 0.5), cashier = new Bot('cashier', 0.2);
  let rid = 0, open = 0;
  const empty: Record<string, number> = {};
  const restockedBy: Record<string, number> = {};
  for (let s = 0; s < 600 && room.world!.phase !== 'summary'; s += 0.05) {
    t += 50; room.update(0.05);
    const w = room.world!;
    if (w.phase === 'open') { open += 0.05; for (const p of PRODUCTS) if (w.shelves[p] === 0) empty[p] = (empty[p] ?? 0) + 0.05; }
    for (const [c, bot] of [[st, staff], [me, cashier]] as const) {
      const p = c.snap?.players.find(x => x.id === c.playerId); if (!p) continue;
      const out = bot.update(c.snap!, p, 0.05);
      if (c === st && out.act?.kind === 'stock' && out.act.target.t === 'shelf') restockedBy[out.act.target.product] = (restockedBy[out.act.target.product] ?? 0) + 1;
      for (const m of botMessages(out, () => 'r' + rid++)) room.handle(c.playerId, m);
    }
  }
  return { room, open, emptyPct: Object.fromEntries(PRODUCTS.map(p => [p, (empty[p] ?? 0) / Math.max(1, open)])), restockedBy, products: [...PRODUCTS] };
}

test('employee bot restocks every product line of the gas station, including the fourth (drinks fridge)', () => {
  const r = staffDay('gas', 2);
  assert.ok(r.products.includes('extra'));
  assert.equal(r.room.world!.phase, 'summary');
  for (const p of r.products) {
    assert.ok((r.restockedBy[p] ?? 0) > 0, `staff stocked ${p}`);
    assert.ok(r.emptyPct[p] < 0.35, `${p} empty ${(r.emptyPct[p] * 100).toFixed(0)}% of the day`);
  }
  assert.ok(r.room.world!.dayStats.served >= 30, `served ${r.room.world!.dayStats.served}`);
});

test('employee bot keeps the convenience store stocked while the player works the till', () => {
  const r = staffDay('convenience', 3);
  for (const p of r.products) assert.ok(r.emptyPct[p] < 0.35, `${p} empty ${(r.emptyPct[p] * 100).toFixed(0)}%`);
  assert.ok(r.room.world!.dayStats.served >= 30);
});

test('employee bot restocks the emptiest shelf first, whichever product line it is', () => {
  applyMap('gas');
  let t = 0;
  const room = new Room('S', null, { solo: true, now: () => t, seed: 1, map: 'gas' });
  const a = new FakeConn(), b = new FakeConn();
  room.join(a, 'me', undefined, 'solo'); room.join(b, '小陳', undefined, 'staff');
  room.startGame();
  const w = room.world!;
  for (const p of PRODUCTS) { w.shelves[p] = 10; w.backstock[p] = 20; }
  w.shelves.extra = 1; w.shelves.drinks = 3;
  room.update(0.1); room.update(0.1);
  // walk the bot until it grabs its first box: it must be the fourth product line (fewest on the shelf)
  const bot = new Bot('any', 0.5);
  let acted: string | undefined;
  for (let i = 0; i < 400 && !acted; i++) {
    t += 50; room.update(0.05);
    const s = { ...b.snap!, phase: 'open' as const };
    const p = s.players.find(x => x.id === b.playerId)!;
    const o = bot.update(s, p, 0.05);
    if (o.act?.kind === 'takeBox') acted = o.act.target.t === 'crate' ? o.act.target.product : '';
    for (const m of botMessages(o, () => 'x' + i)) room.handle(b.playerId, m);
  }
  assert.equal(acted, 'extra', 'the emptiest shelf is the fourth product line');
});

// ---------------- 電腦店員補位 ----------------
function lobbyRoom() {
  let t = 1_000_000;
  const room = new Room('BOTS1', null, { now: () => t, seed: 5 });
  return { room, advance: (ms: number) => { t += ms; } };
}

test('bot fill: host toggles it in the lobby; bots fill free slots, give way to people, leave with the last person', () => {
  const { room } = lobbyRoom();
  const host = new FakeConn(); room.join(host, 'Host', undefined);
  const guest = new FakeConn(); room.join(guest, 'Guest', undefined);
  room.handle(guest.playerId, { type: 'lobbyCfg', bots: true }); // not the host: ignored
  assert.equal(room.botCount, 0);
  room.handle(host.playerId, { type: 'lobbyCfg', bots: true });
  assert.equal(room.botCount, 2);
  const lobby = room.lobbyState();
  assert.equal(lobby.bots, true);
  assert.equal(lobby.players.filter(p => p.bot).length, 2);
  assert.ok(lobby.players.filter(p => p.bot).every(p => p.ready && p.name.startsWith('🤖') && p.platform === 'bot'));
  assert.equal(room.connectedCount, 2, 'bots are not counted as connected players');
  assert.equal(room.checkpoint().members.length, 2, 'bots are never checkpointed');
  assert.equal(room.checkpoint().bots, true);
  // people take the bots' slots
  const more = [new FakeConn(), new FakeConn()];
  more.forEach((c, i) => assert.ok(room.join(c, 'P' + i, undefined).ok));
  assert.equal(room.humanCount, 4); assert.equal(room.botCount, 1); assert.equal(room.members.size, MAX_PLAYERS);
  const fifth = new FakeConn();
  assert.ok(room.join(fifth, 'P5', undefined).ok, 'a person always gets in when only bots fill the room');
  assert.equal(room.botCount, 0);
  assert.equal(room.join(new FakeConn(), 'P6', undefined).ok, false, 'six people: full');
  room.handle(fifth.playerId, { type: 'leave' });
  assert.equal(room.botCount, 1, 'the free slot is filled again');
  // the host leaving never hands the crown to a bot
  room.handle(host.playerId, { type: 'leave' });
  assert.ok(!room.members.get(room.hostId)?.bot);
  for (const c of [guest, ...more]) room.handle(c.playerId, { type: 'leave' });
  assert.equal(room.members.size, 0, 'the last person leaving takes the bots along (room can close)');
  // switching it off removes them
  const h2 = new FakeConn(); room.join(h2, 'H2', undefined);
  room.handle(h2.playerId, { type: 'lobbyCfg', bots: true }); assert.equal(room.botCount, 2);
  room.handle(h2.playerId, { type: 'lobbyCfg', bots: false }); assert.equal(room.botCount, 0);
});

test('bot fill: bots work a whole business day; they are marked in snapshots and count as half a person for workload', () => {
  const { room, advance } = lobbyRoom();
  const host = new FakeConn(); room.join(host, 'Host', undefined);
  room.handle(host.playerId, { type: 'lobbyCfg', bots: true });
  room.handle(host.playerId, { type: 'start' });
  assert.ok(room.started);
  const dt = 0.05;
  let rid = 0, sawOpen = false;
  const hostBot = new Bot('cashier', 0.1);
  for (let s = 0; s < 560; s += dt) {
    advance(dt * 1000); room.update(dt);
    const snap = host.snap; if (!snap) continue;
    if (snap.phase === 'open') sawOpen = true;
    const me = snap.players.find(p => p.id === host.playerId)!;
    for (const m of botMessages(hostBot.update(snap, me, dt), () => 'h' + rid++)) room.handle(host.playerId, m);
    if (room.world!.day >= 2) break;
  }
  const snap = host.snap!;
  assert.ok(sawOpen);
  assert.equal(room.world!.day, 2, 'the day ends with bots readying up at the summary');
  assert.equal(snap.players.filter(p => p.bot).length, 2);
  assert.equal(snap.playerCount, 2, '1 person + 2 bots → workload of 2');
  const bots = [...room.world!.players.values()].filter(p => p.bot);
  const work = bots.reduce((a, p) => a + p.stats.served + p.stats.restocked + p.stats.cleaned + p.stats.karens, 0);
  assert.ok(work > 20, `bots did work (${work})`);
  assert.ok(room.save.totals.served > 10, `served ${room.save.totals.served}`);
});

test('bot fill: restored rooms keep the setting and re-create bots; solo rooms ignore it', () => {
  const { room } = lobbyRoom();
  const host = new FakeConn(); room.join(host, 'Host', undefined);
  room.handle(host.playerId, { type: 'lobbyCfg', bots: true });
  room.handle(host.playerId, { type: 'start' });
  const back = Room.restore(room.checkpoint(), { now: () => 2_000_000 });
  assert.equal(back.botFill, true); assert.equal(back.botCount, 2);
  assert.equal(back.connectedCount, 0);
  assert.equal([...back.world!.players.values()].filter(p => p.bot).length, 2);
  const solo = new Room('SOLO', null, { solo: true });
  const me = new FakeConn(); solo.join(me, 'me', undefined);
  solo.handle(me.playerId, { type: 'lobbyCfg', bots: true });
  assert.equal(solo.botCount, 0);
});

// ---------------- 自由營業: hire 小陳 ----------------
test('free play: a hired clerk works the day and the wage comes out of the nightly settlement', () => {
  applyMap('convenience');
  const runDay = (wage?: number) => {
    let t = 0;
    const room = new Room('SOLO', null, { solo: true, now: () => t, seed: 9, map: 'convenience', staffWage: wage });
    const me = new FakeConn(), st = new FakeConn();
    room.join(me, 'me', undefined, 'solo'); if (wage) room.join(st, '小陳', undefined, 'staff');
    room.startGame();
    const bot = new Bot('any', 0.5); let rid = 0;
    for (let s = 0; s < 600 && room.world!.phase !== 'summary'; s += 0.05) {
      t += 50; room.update(0.05);
      if (room.world!.phase === 'prep') room.world!.phaseLeft = Math.min(room.world!.phaseLeft, 2);
      const c = wage ? st : me; const p = c.snap?.players.find(x => x.id === c.playerId); if (!p) continue;
      for (const m of botMessages(bot.update(c.snap!, p, 0.05), () => 'r' + rid++)) room.handle(c.playerId, m);
    }
    return room.world!.dayStats;
  };
  const hired = runDay(FREEPLAY_STAFF_WAGE);
  assert.equal(hired.wage, FREEPLAY_STAFF_WAGE);
  assert.ok(hired.expenses >= 60 + FREEPLAY_STAFF_WAGE, `expenses ${hired.expenses} include rent + wage`);
  assert.ok(hired.served > 5, 'the clerk served customers');
  assert.equal(runDay().wage, undefined, 'no clerk, no wage');
});

// ---------------- friend stores: the optional fourth product ----------------
test('friend stores keep the fourth product line; raiding a friend\'s gas station uses their drinks-fridge level', () => {
  const reg = new StoreRegistry();
  const gas = reg.create({ name: '油速', map: 'gas', money: 900, rating: 4, shelves: { drinks: 3, snacks: 4, bento: 5, extra: 7, junk: 9 } });
  assert.ok(gas.ok);
  const view = reg.get(gas.value.code); assert.ok(view.ok);
  assert.deepEqual(view.value.shelves, { drinks: 3, snacks: 4, bento: 5, extra: 7 });
  const plain = reg.create({ name: '小7', map: 'convenience', shelves: { drinks: 1, snacks: 2, bento: 3 } }); assert.ok(plain.ok);
  const pv = reg.get(plain.value.code); assert.ok(pv.ok);
  assert.equal('extra' in pv.value.shelves, false, 'no fourth line unless the store has one');
  const up = reg.update(gas.value.code, gas.value.token, { shelves: { drinks: 1, snacks: 1, bento: 1, extra: 250 } }); assert.ok(up.ok);
  assert.equal(up.value.shelves.extra, 99, 'clamped');
  // the raid round copies the friend's shelves, including the fridge
  const cfg = buildRaidConfig({ ...view.value });
  assert.equal(cfg.start.shelves.extra, 7); assert.equal(cfg.start.backstock.extra, 30);
  assert.equal(buildRaidConfig({ ...view.value, shelves: { drinks: 3, snacks: 4, bento: 5 } }).start.shelves.extra, 8, 'older uploads: normal stock');
  assert.equal(buildRaidConfig({ ...pv.value }).start.shelves.extra, undefined);
  applyMap('gas');
  const room = new Room('R', null, { solo: true, shift: cfg, seed: 1 });
  room.join(new FakeConn(), 'raider', undefined); room.startGame();
  assert.equal(room.world!.shelves.extra, 7);
  assert.equal(room.world!.shelves.drinks, 3);
});
