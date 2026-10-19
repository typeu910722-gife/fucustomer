// Round 9: hitting (self-defence vs not), heavy and "connected" karens, pay slip, court, story scenes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShiftResult, applyResult, buildShiftConfig, newProfile, payTotal, sanitizeProfile, shiftPay, Incident } from '../shared/career.ts';
import { addPlayer, createWorld, defaultSave, isViolent, requestAct, requestHit, requestSpin, tick, World, Customer } from '../shared/sim.ts';
import { allJustified, baseFine, dinoVerdict, fairVerdict, minFine, needsCourt, payFine, protest, questions } from '../shared/court.ts';
import { SCENES, sceneAfter, sceneBefore } from '../shared/story.ts';

function world(level = 20, id = '4-1') {
  const p = newProfile(); p.level = level;
  const w = createWorld(defaultSave(), 7, buildShiftConfig(p, id));
  w.phase = 'open'; w.phaseLeft = 999;
  return w;
}
function karen(w: World, kind: Customer['kind'], x: number, z: number, extra: Partial<Customer> = {}): Customer {
  const c: Customer = {
    id: w.nextId++, kind, x, z, yaw: 0, state: 'wander', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false,
    foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 40, resolved: false, hits: 0,
    eaten: [], eatShelf: null, life: 999, look: 1, angry: false, moving: false, knockTimer: 999, gone: false, heldBy: null, fly: null, phase: 0, minions: [], ...extra,
  };
  w.customers.push(c);
  return c;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) tick(w, 0.05); };

test('出手: unlocked at Lv6; hitting a calm karen is not self-defence and is recorded', () => {
  const w5 = world(5, '1-2'); addPlayer(w5, 'a', 'A', 1);
  const k5 = karen(w5, 'cutter', 12.5, 9);
  requestHit(w5, 'a', 'h', k5.id);
  assert.equal(w5.results.at(-1)?.ok, false);

  const w = world(); const p = addPlayer(w, 'a', 'A', 1); p.x = 12; p.z = 8;
  const k = karen(w, 'rager', 12, 9, { state: 'complain', anger: 40 });
  assert.equal(isViolent(w, k), false);
  requestHit(w, 'a', 'h1', k.id);
  assert.equal(w.incidents.length, 1); assert.equal(w.incidents[0].legal, false);
  assert.ok((k.stunT ?? 0) > 0, 'dazed');
  assert.ok(needsCourt(w.incidents));
});

test('self-defence: a karen who lost it can be hit; two hits subdue them; no police unless they have connections', () => {
  const w = world(); const p = addPlayer(w, 'a', 'A', 1); p.x = 12; p.z = 8;
  const k = karen(w, 'rager', 12, 9, { state: 'complain', anger: 80 });
  assert.equal(isViolent(w, k), true);
  requestHit(w, 'a', 'h1', k.id);
  assert.equal(w.incidents.length, 0); assert.equal(k.resolved, false);
  k.anger = 80; // still raging
  requestHit(w, 'a', 'h2', k.id); // rate-limited: same tick
  run(w, 0.8);
  requestHit(w, 'a', 'h3', k.id);
  assert.equal(k.resolved, true, 'subdued'); assert.equal(k.state, 'leaving');
  assert.equal(needsCourt(w.incidents), false);

  const w2 = world(); const p2 = addPlayer(w2, 'a', 'A', 1); p2.x = 12; p2.z = 8;
  const vip = karen(w2, 'rager', 12, 9, { state: 'complain', anger: 90, vip: true });
  requestHit(w2, 'a', 'v', vip.id);
  assert.equal(w2.incidents.length, 1); assert.equal(w2.incidents[0].legal, true); assert.equal(w2.incidents[0].vip, true);
  assert.ok(needsCourt(w2.incidents)); assert.ok(allJustified(w2.incidents));
});

test('a raging karen shoves a worker, which makes hitting back self-defence for a few seconds', () => {
  const w = world(); const p = addPlayer(w, 'a', 'A', 1); p.x = 12.5; p.z = 12.5;
  const k = karen(w, 'litterer', 12, 9);
  assert.equal(isViolent(w, k), false);
  const r = karen(w, 'rager', 13.2, 13.2, { state: 'complain', anger: 90 });
  run(w, 0.2);
  assert.ok(r.shoveAt !== undefined, 'shoved');
  assert.equal(isViolent(w, r), true);
});

test('hitting an ordinary customer: big rating drop, they leave, always a court case', () => {
  const w = world(); const p = addPlayer(w, 'a', 'A', 1); p.x = 12; p.z = 8;
  const c = karen(w, 'normal', 12, 9, { state: 'browse' });
  const rating = w.rating;
  requestHit(w, 'a', 'n', c.id);
  assert.ok(w.rating < rating - 0.25); assert.equal(c.state, 'leaving');
  assert.equal(w.incidents[0].normal, true);
  assert.ok(baseFine(w.incidents, 4) > baseFine([{ who: 'x', legal: false, vip: false, normal: false, why: '' }], 4));
});

test('heavy karens cannot be grabbed until dazed by a hit or the mop spin', () => {
  const w = world(20, '4-1'); const p = addPlayer(w, 'a', 'A', 1); p.x = 12; p.z = 8; p.yaw = 0;
  const k = karen(w, 'hog', 12, 9, { heavy: true });
  requestAct(w, 'a', 'g1', 'grab', { t: 'customer', id: k.id });
  assert.equal(w.results.find(r => r.rid === 'g1')?.ok, false);
  requestHit(w, 'a', 'h', k.id);
  requestAct(w, 'a', 'g2', 'grab', { t: 'customer', id: k.id }); tick(w, 0.05);
  assert.equal(p.grabbing, k.id);

  const w2 = world(20, '4-1'); const p2 = addPlayer(w2, 'a', 'A', 1); p2.x = 12; p2.z = 8;
  const k2 = karen(w2, 'hog', 12, 9, { heavy: true });
  requestSpin(w2, 'a', 's');
  assert.ok((k2.stunT ?? 0) > 0);
});

test('pay slip: wage + bonus, boss skims 15-45% with an excuse, tips are kept in full', () => {
  const r: ShiftResult = { shiftId: '3-2', won: true, failReason: '', revenue: 400, goal: 260, rating: 3.6, chaos: 20, served: 30, angryLeft: 0, karensResolved: 3, karensFailed: 0, ejected: 2, cleaned: 3, maxCombo: 1, tips: 60 };
  const pay = shiftPay(3, r, 2);
  assert.equal(pay.tips, 60); assert.equal(pay.wage, 100); assert.equal(pay.bonus, Math.round(340 * 0.12));
  const pct = pay.cut / (pay.wage + pay.bonus);
  assert.ok(pct >= 0.14 && pct <= 0.46, `cut ${pct}`);
  assert.ok(pay.cutReason.length > 0);
  assert.deepEqual(shiftPay(3, r, 2), pay, 'same shift, same slip');
  assert.ok(shiftPay(3, r, 3).cut <= shiftPay(3, r, 0).cut, 'a 3-star shift puts the boss in a better mood');
  const p = newProfile(); p.level = 12; for (const s of ['1-1', '1-2', '1-3', '1-4', '1-5', '2-1', '2-2', '2-3', '2-4', '2-5', '3-1']) p.stars[s] = 1;
  const before = p.wallet;
  const rw = applyResult(p, r);
  assert.equal(p.wallet - before, payTotal(rw.pay!));
});

test('court: verdicts, protests against the dinosaur judge, fines never push savings below zero', () => {
  const illegal: Incident[] = [{ who: '插隊奧客', legal: false, vip: false, normal: false, why: '' }];
  const justified: Incident[] = [{ who: '退貨大鬧', legal: true, vip: true, normal: false, why: '' }];
  assert.equal(needsCourt([{ who: 'x', legal: true, vip: false, normal: false, why: '' }]), false);
  const base = baseFine(illegal, 2);
  // fair judge: honest answers reach the minimum; self-defence is acquitted
  const honest = questions(illegal).map(q => Math.min(...q.answers.map(a => a.mod)));
  assert.equal(fairVerdict(illegal, 2, honest).fine, minFine(base));
  assert.ok(fairVerdict(illegal, 2, [0.1, 0.25, 0.05]).fine > base);
  assert.equal(fairVerdict(justified, 2, []).fine, 0);
  // dinosaur judge always fines, even in self-defence…
  const lo = () => 0.01, hi = () => 0.99;
  const v = dinoVerdict(justified, 2, lo);
  assert.ok(v.fine > 0);
  // …but the CCTV footage clears you when every incident was justified
  assert.equal(protest('cctv', v, justified, 2, lo).fine, 0);
  assert.ok(protest('cctv', dinoVerdict(illegal, 2, lo), illegal, 2, lo).fine > 0);
  assert.equal(protest('stream', v, illegal, 2, lo).fine, minFine(base));
  assert.ok(protest('stream', v, illegal, 2, hi).fine > v.fine);
  assert.equal(protest('appeal', v, illegal, 2, lo).appeal, true);
  const p = newProfile(); p.wallet = 50;
  assert.equal(payFine(p, 400, 80), 50); assert.equal(p.wallet, 0); assert.equal(p.court.trials, 1);
  payFine(p, 0); assert.equal(p.court.acquittals, 1);
});

test('story: chapter intro/outro scenes exist, profile keeps story and court records safely', () => {
  assert.equal(sceneBefore('3-1'), 'ch3-intro'); assert.equal(sceneBefore('3-2'), null);
  assert.equal(sceneAfter('6-3', { 6: '6-3' }), 'ch6-outro');
  for (let n = 1; n <= 6; n++) { assert.ok(SCENES[`ch${n}-intro`]); assert.ok(SCENES[`ch${n}-outro`]); }
  const back = sanitizeProfile({ story: ['ch1-intro', 'ch1-intro', '<b>'], court: { trials: 2, fines: -5, acquittals: 'x' } });
  assert.deepEqual(back.story, ['ch1-intro']); assert.deepEqual(back.court, { trials: 2, fines: 0, acquittals: 0 });
});
