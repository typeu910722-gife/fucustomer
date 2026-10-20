// Every registered map must be playable: nothing important is blocked, everything is reachable, a bot can run a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps/index.ts';
import {
  CELL, CHARGE_SPOT, COFFEE_MACHINE, COFFEE_PICKUP, COMPLAINT_SPOT, CRATES, CURRENT_MAP, ENTRANCE, GD, GW, MICROWAVE, PLAYER_SPAWNS,
  QUEUE_SPOTS, REGISTERS, SHELVES, SOLIDS, WANDER_SPOTS, applyMap, distToAABB, isBlockedCell, shelfBrowseSpots,
} from '../shared/map.ts';
import { FOOD_INFO, PRODUCT_INFO, PRODUCTS } from '../shared/constants.ts';
import { Room } from '../shared/room.ts';
import { Bot, botMessages } from '../shared/bot.ts';

function reachableFrom(p: { x: number; z: number }) {
  const seen = new Uint8Array(GW * GD);
  const start = Math.floor(p.z / CELL) * GW + Math.floor(p.x / CELL);
  const q = [start]; seen[start] = 1;
  while (q.length) {
    const c = q.pop()!; const cx = c % GW, cz = (c / GW) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (isBlockedCell(nx, nz)) continue;
      const i = nz * GW + nx; if (!seen[i]) { seen[i] = 1; q.push(i); }
    }
  }
  // a spot counts as reachable if it or a neighbouring cell is (NPCs stop next to it)
  return (pt: { x: number; z: number }) => {
    const gx = Math.floor(pt.x / CELL), gz = Math.floor(pt.z / CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, z = gz + dz; if (x >= 0 && z >= 0 && x < GW && z < GD && seen[z * GW + x]) return true; }
    return false;
  };
}

for (const m of MAPS) {
  test(`map ${m.icon} ${m.name}: spots are free and everything is reachable`, () => {
    applyMap(m.id);
    assert.equal(CURRENT_MAP.id, m.id);
    const free = (pt: { x: number; z: number }, what: string, r = 0.25) => {
      for (const s of SOLIDS) assert.ok(distToAABB(pt.x, pt.z, s) >= r, `${what} (${pt.x},${pt.z}) is inside ${s.kind} ${JSON.stringify(s)}`);
    };
    for (const [i, q] of QUEUE_SPOTS.entries()) free(q, `queue ${i}`);
    for (const r of REGISTERS) { free(r.cashier, `cashier ${r.idx}`); free(r.customer, `register customer ${r.idx}`); }
    free(COFFEE_PICKUP, 'pickup'); free(COMPLAINT_SPOT, 'complaint'); free(CHARGE_SPOT, 'charge spot');
    for (const p of PLAYER_SPAWNS) free(p, 'player spawn');
    for (const w of WANDER_SPOTS) free(w, 'wander spot');
    for (const sh of SHELVES) for (const s of shelfBrowseSpots(sh.product)) free(s, `${sh.product} browse`, 0.2);
    // customers walk in from the door; workers move between stockroom, shelves, stations and registers
    const fromDoor = reachableFrom(ENTRANCE);
    for (const sh of SHELVES) assert.ok(shelfBrowseSpots(sh.product).some(fromDoor), `${sh.product} shelf unreachable`);
    for (const r of REGISTERS) { assert.ok(fromDoor(r.customer), `register ${r.idx} unreachable for customers`); assert.ok(fromDoor(r.cashier), `register ${r.idx} unreachable for staff`); }
    for (const q of QUEUE_SPOTS) assert.ok(fromDoor(q), 'queue unreachable');
    assert.ok(fromDoor(COFFEE_PICKUP) && fromDoor(COMPLAINT_SPOT) && fromDoor(CHARGE_SPOT));
    for (const c of CRATES) assert.ok(fromDoor({ x: (c.box.x0 + c.box.x1) / 2, z: c.box.z1 + 0.7 }), 'crate unreachable');
    if (m.coffee) assert.ok(fromDoor({ x: (COFFEE_MACHINE.x0 + COFFEE_MACHINE.x1) / 2, z: COFFEE_MACHINE.z1 + 0.6 }), 'coffee station unreachable');
    if (m.meal) assert.ok(fromDoor({ x: (MICROWAVE.x0 + MICROWAVE.x1) / 2, z: MICROWAVE.z1 + 0.6 }), 'meal station unreachable');
    // names and prices follow the map
    for (const p of PRODUCTS) assert.equal(PRODUCT_INFO[p].name, m.products[p].name);
    assert.equal(FOOD_INFO.coffee.name, m.coffee?.food ?? '');
  });

  test(`map ${m.icon} ${m.name}: a simulated worker runs a whole business day`, () => {
    applyMap(m.id);
    let t = 0;
    const room = new Room('S', null, { solo: true, now: () => t, seed: 3, map: m.id });
    const c: { snap: any; pid: string; send(msg: any): void; close(): void } = { snap: null, pid: '', send(msg) { if (msg.type === 'snap') c.snap = msg.s; if (msg.type === 'welcome') c.pid = msg.playerId; }, close() {} };
    room.join(c, 'bot', undefined); room.startGame();
    const bot = new Bot('any', 0.3); let rid = 0;
    for (let s = 0; s < 400 && room.world!.phase !== 'summary'; s += 0.05) {
      t += 50; room.update(0.05);
      if (room.world!.phase === 'prep') room.world!.phaseLeft = Math.min(room.world!.phaseLeft, 3);
      const sn = c.snap; if (!sn) continue;
      for (const msg of botMessages(bot.update(sn, sn.players[0], 0.05), () => 'r' + rid++)) room.handle(c.pid, msg);
    }
    const d = room.world!.dayStats;
    assert.equal(room.world!.phase, 'summary', 'the day ended');
    assert.ok(d.served >= 5 && d.revenue > 0, `served ${d.served}, revenue ${d.revenue}`);
    if (!m.coffee && !m.meal) assert.deepEqual(room.world!.cfg.foods, []);
  });
}

test('switching back restores the original store', () => {
  applyMap('clothing'); applyMap('convenience');
  assert.equal(PRODUCT_INFO.drinks.name, '飲料'); assert.equal(FOOD_INFO.coffee.station, '咖啡機');
});
