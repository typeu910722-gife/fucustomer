// Round 11: store-specific karens (早餐店 客製魔人, 手搖飲 改單達人, 服飾店 試穿狂) and chapter 7 in the new stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, buildShiftConfig, chapterUnlocked, newProfile, shiftUnlocked } from '../shared/career.ts';
import { addPlayer, createWorld, defaultSave, requestAct, tick, World, Customer } from '../shared/sim.ts';
import { CURRENT_MAP, REGISTERS, TRYON_SPOTS, COFFEE_PICKUP, applyMap } from '../shared/map.ts';
import { MAPS } from '../shared/maps/index.ts';
import { KAREN_INFO } from '../shared/constants.ts';

function world(id: string) {
  const p = newProfile(); p.level = 28;
  const w = createWorld(defaultSave(), 5, buildShiftConfig(p, id));
  w.phase = 'open'; w.phaseLeft = 999;
  return w;
}
function cust(w: World, kind: Customer['kind'], x: number, z: number, extra: Partial<Customer> = {}): Customer {
  const c: Customer = {
    id: w.nextId++, kind, x, z, yaw: 0, state: 'wander', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false,
    foodFailed: false, patience: 400, patienceMax: 400, mood: 80, timer: 0, register: -1, anger: 0, resolved: false, hits: 0,
    eaten: [], eatShelf: null, life: 40, look: 1, angry: false, moving: false, knockTimer: 6, gone: false, heldBy: null, fly: null, phase: 0, minions: [], ...extra,
  };
  w.customers.push(c); return c;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) tick(w, 0.05); };

test('chapter 7 opens after the King of Karens and every shift runs in its own store', () => {
  const p = newProfile(); p.level = 28;
  for (const c of CHAPTERS.filter(c => c.n <= 5)) for (const s of c.shifts) p.stars[s.id] = 1;
  assert.equal(chapterUnlocked(p, 7).ok, false);
  for (const s of CHAPTERS[5].shifts) p.stars[s.id] = 1;
  assert.equal(chapterUnlocked(p, 7).ok, true); assert.equal(shiftUnlocked(p, '7-1').ok, true);
  const ch7 = CHAPTERS.find(c => c.n === 7)!;
  assert.deepEqual([...new Set(ch7.shifts.map(s => s.map))].sort(), ['boba', 'breakfast', 'chicken', 'clothing']);
  for (const s of ch7.shifts) { const w = createWorld(defaultSave(), 1, buildShiftConfig(p, s.id)); assert.equal(CURRENT_MAP.id, s.map); assert.ok(w.cfg.goal > 0); }
  // every map-specific karen exists and is described
  for (const m of MAPS) for (const k of m.karens ?? []) assert.ok(KAREN_INFO[k].how.length > 0);
  applyMap();
});

test('客製魔人 blocks the register until his order is read back', () => {
  const w = world('7-1');
  const p = addPlayer(w, 'a', 'A', 1); const reg = REGISTERS[0];
  p.x = reg.cashier.x; p.z = reg.cashier.z;
  const c = cust(w, 'custom', reg.customer.x, reg.customer.z, { state: 'atRegister', items: ['drinks'] });
  w.registers[0] = c.id;
  requestAct(w, 'a', 'c1', 'checkout', { t: 'register', idx: 0 });
  assert.match(w.results.find(r => r.rid === 'c1')?.reason ?? '', /改單/);
  p.x = c.x; p.z = c.z - 0.9;
  requestAct(w, 'a', 'r', 'repeatOrder', { t: 'customer', id: c.id }); run(w, 1.8);
  assert.equal(c.resolved, true);
  p.x = reg.cashier.x; p.z = reg.cashier.z;
  requestAct(w, 'a', 'c2', 'checkout', { t: 'register', idx: 0 }); run(w, 3);
  assert.ok(w.dayStats.served >= 1, 'served after reading back the order');
  // ignored for too long: fails
  const w2 = world('7-1'); const c2 = cust(w2, 'custom', reg.customer.x, reg.customer.z, { state: 'atRegister', life: 1 });
  run(w2, 1.5);
  assert.equal(w2.dayStats.karensFailed, 1); assert.equal(c2.state, 'leaving');
});

test('改單達人 changes the first drink; the second one (or a recommendation) settles it', () => {
  const w = world('7-3');
  const p = addPlayer(w, 'a', 'A', 1);
  const c = cust(w, 'fickle', COFFEE_PICKUP.x, COFFEE_PICKUP.z, { state: 'waitFood', want: 'coffee', timer: 50, patienceMax: 50 });
  p.x = c.x; p.z = c.z - 0.8;
  p.held = { kind: 'coffee' };
  requestAct(w, 'a', 'd1', 'deliver', { t: 'customer', id: c.id }); tick(w, 0.05);
  assert.equal(c.resolved, false); assert.equal(c.hits, 1); assert.equal(c.state, 'waitFood'); assert.equal(p.held, null);
  p.held = { kind: 'coffee' };
  requestAct(w, 'a', 'd2', 'deliver', { t: 'customer', id: c.id }); tick(w, 0.05);
  assert.equal(c.resolved, true); assert.equal(c.foodDone, true);
  const c2 = cust(w, 'fickle', COFFEE_PICKUP.x + 0.5, COFFEE_PICKUP.z, { state: 'waitFood', want: 'coffee', timer: 50, patienceMax: 50 });
  p.x = c2.x; p.z = c2.z - 0.8;
  requestAct(w, 'a', 'rec', 'recommend', { t: 'customer', id: c2.id }); run(w, 1.4);
  assert.equal(c2.resolved, true); assert.equal(c2.state, 'waitFood', 'still wants his drink, but only one now');
});

test('試穿狂 hogs the fitting room, makes a mess, and buys one item after being limited', () => {
  const w = world('7-5');
  const p = addPlayer(w, 'a', 'A', 1);
  const spot = TRYON_SPOTS[0];
  const c = cust(w, 'tryhard', spot.x, spot.z + 0.2, { state: 'toTry', life: 70 });
  c.path = [spot]; c.speed = 1.7;
  run(w, 0.5); assert.equal(c.state, 'tryon');
  const spills = w.spills.length; run(w, 6.2); assert.ok(w.spills.length > spills, 'clothes pile on the floor');
  p.x = c.x + 0.8; p.z = c.z;
  requestAct(w, 'a', 'l', 'limitTry', { t: 'customer', id: c.id }); run(w, 1.2);
  assert.equal(c.resolved, true); assert.equal(c.shopping.length + c.items.length >= 1, true);
});
