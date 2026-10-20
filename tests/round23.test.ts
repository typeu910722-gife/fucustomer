// Round 23: lively opening (express first customer + delivery box by the door) and the empty-shelf grace period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createWorld, defaultSave, dayConfig, inShelfGrace, requestAct, setReady, tick, type World } from '../shared/sim.ts';
import { buildShiftConfig, newProfile } from '../shared/career.ts';
import { EMPTY_SHELF_GRACE, PRODUCTS } from '../shared/constants.ts';
import { ENTRANCE, applyMap, shelfBrowseSpots } from '../shared/map.ts';

function profileAt(level: number) { const p = newProfile(); p.level = level; return p; }
const total = (w: World) => PRODUCTS.reduce((a, p) => a + w.shelves[p] + w.backstock[p], 0)
  + w.items.reduce((a, it) => a + (it.held.kind === 'box' ? it.held.qty : 0), 0)
  + w.customers.reduce((a, c) => a + c.items.length, 0);

/** Run the prep phase out (everyone presses ready) and stop right after the store opens. */
function open(w: World) {
  addPlayer(w, 'p1', 'P1', 0xff0000);
  setReady(w, 'p1', true);
  for (let i = 0; i < 400 && w.phase === 'prep'; i++) tick(w, 0.05);
  assert.equal(w.phase, 'open');
}

for (const [label, make] of [
  ['career shift 4-3', () => createWorld(defaultSave(), 7, buildShiftConfig(profileAt(14), '4-3'))],
  ['multiplayer business day', () => createWorld(defaultSave(), 7, dayConfig())],
] as const) {
  test(`opening (${label}): express customer heads to the till and a delivery box waits by the door`, () => {
    const w = make();
    const before = total(w);
    open(w);
    // the delivery is part of the store's own stock, nothing is added or lost
    assert.equal(total(w), before);
    const box = w.items.find(i => i.held.kind === 'box');
    assert.ok(box, 'delivery box on the floor');
    assert.ok(box.held.kind === 'box' && box.held.qty > 0);
    assert.ok(Math.hypot(box.x - ENTRANCE.x, box.z - ENTRANCE.z) < 2, 'box is by the door');
    const first = w.customers[0];
    assert.equal(first.kind, 'normal');
    assert.ok(first.items.length >= 1, 'already holding something');
    assert.equal(first.shopping.length, 0);
    assert.equal(first.want, null);
    assert.ok(['queue', 'toRegister'].includes(first.state), first.state);
    // reaches the register within a few seconds of opening
    let t = 0;
    while (first.state !== 'atRegister' && t < 15) { tick(w, 0.05); t += 0.05; }
    assert.equal(first.state, 'atRegister');
    assert.ok(t < 8, `reached the till after ${t.toFixed(1)} s`);
    // the next regular customer only arrives on the usual schedule (the express one replaces the first arrival)
    assert.ok(w.customers.length <= 2);
    applyMap();
  });
}

test('opening: the delivery box can be carried to its shelf (pickup + stock)', () => {
  const w = createWorld(defaultSave(), 3, buildShiftConfig(profileAt(5), '2-1'));
  open(w);
  const box = w.items.find(i => i.held.kind === 'box')!;
  const prod = box.held.kind === 'box' ? box.held.product : 'drinks';
  const p = w.players.get('p1')!;
  p.x = box.x; p.z = box.z;
  requestAct(w, 'p1', 'r1', 'pickup', { t: 'item', id: box.id });
  tick(w, 0.05);
  assert.equal(p.held?.kind, 'box');
  const shelfBefore = w.shelves[prod];
  // stand at the shelf and put it up
  const spot = shelfBrowseSpots(prod)[0];
  p.x = spot.x; p.z = spot.z;
  requestAct(w, 'p1', 'r2', 'stock', { t: 'shelf', product: prod });
  for (let i = 0; i < 60; i++) tick(w, 0.05);
  assert.ok(w.shelves[prod] > shelfBefore, 'shelf filled from the delivery box');
  applyMap();
});

test('empty shelf: no rating loss during the grace period, the normal penalty after it', () => {
  const w = createWorld(defaultSave(), 11, buildShiftConfig(profileAt(14), '4-3'));
  open(w);
  w.shelves.drinks = 0;
  tick(w, 0.05);
  assert.equal(inShelfGrace(w, 'drinks'), true);
  assert.ok(w.events.some(e => e.e === 'toast' && /飲料貨架空了/.test(e.text) && new RegExp(`${EMPTY_SHELF_GRACE} 秒內`).test(e.text)), 'warning toast names the product and the grace');
  const c = w.customers[0];
  const browse = () => { c.state = 'browse'; c.shopping = ['drinks']; c.timer = 0; c.path = []; };
  // inside the grace period: the customer grumbles (mood) but rating and chaos stay
  browse();
  let r0 = w.rating, ch0 = w.chaos, m0 = c.mood;
  tick(w, 0.01);
  assert.ok(Math.abs(w.rating - r0) < 0.001, `rating unchanged (${r0} → ${w.rating})`);
  assert.equal(w.chaos, ch0);
  assert.equal(c.mood, m0 - 15);
  // after the grace period: the old −0.02 rating / +1 chaos penalty
  for (let t = 0; t < EMPTY_SHELF_GRACE + 0.5; t += 0.5) { w.shelves.drinks = 0; tick(w, 0.5); }
  assert.equal(inShelfGrace(w, 'drinks'), false);
  w.shelves.drinks = 0;
  browse();
  r0 = w.rating; ch0 = w.chaos;
  tick(w, 0.01);
  assert.ok(r0 - w.rating > 0.019, `rating dropped (${r0} → ${w.rating})`);
  assert.ok(w.chaos >= ch0 + 1 - 1e-9);
  // restocking clears the timer: the next run-out gets a fresh grace period
  w.shelves.drinks = 3; tick(w, 0.05);
  assert.equal(w.emptySince.drinks, undefined);
  w.shelves.drinks = 0; tick(w, 0.05);
  assert.equal(inShelfGrace(w, 'drinks'), true);
  applyMap();
});

test('friend-store raid: no delivery box and no express customer', () => {
  const cfg = buildShiftConfig(profileAt(14), '2-1');
  cfg.raid = { store: 'TEST' };
  const w = createWorld(defaultSave(), 5, cfg);
  open(w);
  assert.equal(w.items.length, 0);
  assert.equal(w.customers.length, 0);
  applyMap();
});

test('HUD shelf watch: announces a low / empty shelf once per run-out, grace countdown, guide to the crate', async () => {
  const { ShelfWatch } = await import('../client/src/shelfwatch.ts');
  const { CRATES } = await import('../shared/map.ts');
  applyMap();
  const shelves = { drinks: 8, snacks: 8, bento: 6, extra: 8 };
  const snap = (sh: Partial<typeof shelves>, extra: Record<string, unknown> = {}) => ({ phase: 'open', shelves: { ...shelves, ...sh }, backstock: { drinks: 20, snacks: 20, bento: 20, extra: 20 }, items: [], ...extra }) as never;
  const me = { held: null, grabbing: null } as never;
  const sw = new ShelfWatch();
  assert.deepEqual(sw.update(snap({}), 0), { empty: [], low: [] });
  assert.deepEqual(sw.update(snap({ drinks: 2 }), 100), { empty: [], low: ['drinks'] });
  assert.deepEqual(sw.update(snap({ drinks: 1 }), 200), { empty: [], low: [] }, 'low is announced once');
  assert.deepEqual(sw.update(snap({ drinks: 0 }), 1000), { empty: ['drinks'], low: [] });
  assert.deepEqual(sw.update(snap({ drinks: 0 }), 2000), { empty: [], low: [] }, 'empty is announced once');
  assert.equal(sw.graceLeft('drinks', 4000), EMPTY_SHELF_GRACE - 3);
  assert.equal(sw.graceLeft('drinks', 1000 + EMPTY_SHELF_GRACE * 1000 + 1), 0);
  const crate = CRATES.find(c => c.product === 'drinks')!.box;
  assert.deepEqual(sw.guide(snap({ drinks: 0 }), me, 3000), { x: (crate.x0 + crate.x1) / 2, z: (crate.z0 + crate.z1) / 2 });
  assert.equal(sw.guide(snap({ drinks: 0 }), me, 20000), null, 'the arrow only shows for a few seconds');
  // restocked: cleared, and the next run-out is announced again
  sw.update(snap({ drinks: 8 }), 21000);
  assert.equal(sw.isEmpty('drinks'), false);
  assert.deepEqual(sw.update(snap({ drinks: 0 }), 22000).empty, ['drinks']);
  // outside business hours nothing is tracked
  assert.deepEqual(sw.update(snap({ drinks: 0 }, { phase: 'summary' }), 23000), { empty: [], low: [] });
  assert.equal(sw.isEmpty('drinks'), false);
});
