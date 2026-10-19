// Career progression + v0.4 mechanics (grab/throw/spin/ultimate, meals, shift results).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTERS, MAX_LEVEL, addExp, applyResult, buildShiftConfig, buyGear, chapterUnlocked, expToNext, newProfile, rankOf,
  sanitizeProfile, shiftUnlocked, spendSkill, starsFor, ShiftResult,
} from '../shared/career.ts';
import {
  addPlayer, createWorld, defaultSave, requestAct, requestDrop, requestSpin, requestThrow, requestUltimate, tick, World, Customer,
} from '../shared/sim.ts';
import { DOOR_X0, DOOR_X1, STORE_D } from '../shared/map.ts';

function profileAt(level: number) { const p = newProfile(); p.level = level; return p; }
function shiftWorld(level = 30, id = '3-1') {
  const w = createWorld(defaultSave(), 42, buildShiftConfig(profileAt(level), id));
  w.phase = 'open'; w.phaseLeft = 999;
  return w;
}
function karen(w: World, kind: Customer['kind'], x: number, z: number): Customer {
  const c: Customer = {
    id: w.nextId++, kind, x, z, yaw: 0, state: 'wander', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false,
    foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 40, resolved: false, hits: 0,
    eaten: [], eatShelf: null, life: 999, look: 1, angry: false, moving: false, knockTimer: 999, gone: false, heldBy: null, fly: null, phase: kind === 'boss' ? 1 : 0, minions: [],
  };
  w.customers.push(c);
  return c;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) tick(w, 0.05); };

test('rank ladder and EXP curve reach 終極打工人 at Lv.30', () => {
  assert.equal(rankOf(1), '試用期工讀生'); assert.equal(rankOf(6), '正職店員'); assert.equal(rankOf(26), '區域督導'); assert.equal(rankOf(30), '終極打工人');
  const p = newProfile();
  let total = 0; for (let l = 1; l < MAX_LEVEL; l++) total += expToNext(l);
  const gained = addExp(p, total);
  assert.equal(p.level, 30); assert.equal(gained.length, 29); assert.equal(p.skillPoints, 29); assert.equal(p.title, '終極打工人');
});

test('skills and gear spend currency correctly; sanitize rejects tampering', () => {
  const p = newProfile(); addExp(p, 500);
  const pts = p.skillPoints;
  assert.ok(spendSkill(p, 'service')); assert.equal(p.skillPoints, pts - 1);
  p.wallet = 100; assert.ok(buyGear(p, 'shoes')); assert.equal(p.wallet, 0); assert.equal(buyGear(p, 'shoes'), false);
  const bad = sanitizeProfile({ level: 99, skills: { service: 50 }, skillPoints: 999, wallet: -5 });
  assert.equal(bad.level, 30); assert.equal(bad.skills.service, 10); assert.ok(bad.skillPoints <= 29 - 10); assert.equal(bad.wallet, 0);
});

test('chapters unlock by previous clear and level; shifts in order', () => {
  const p = newProfile();
  assert.equal(chapterUnlocked(p, 1).ok, true);
  assert.equal(shiftUnlocked(p, '1-2').ok, false);
  p.stars['1-1'] = 1; assert.equal(shiftUnlocked(p, '1-2').ok, true);
  for (const s of CHAPTERS[0].shifts) p.stars[s.id] = 2;
  assert.equal(chapterUnlocked(p, 2).ok, false); // level 1 < 6
  p.level = 6; assert.equal(chapterUnlocked(p, 2).ok, true);
  assert.equal(chapterUnlocked(p, 6).ok, false);
});

test('stars and rewards: first clear full EXP, replay 60%, fail 35%', () => {
  const base: ShiftResult = { shiftId: '1-1', won: true, failReason: '', revenue: 100, goal: 60, rating: 4, chaos: 10, served: 8, angryLeft: 0, karensResolved: 0, karensFailed: 0, ejected: 0, cleaned: 1, maxCombo: 0 };
  assert.equal(starsFor(base), 3);
  assert.equal(starsFor({ ...base, revenue: 61, rating: 3 }), 1);
  const p = newProfile();
  const r1 = applyResult(p, base);
  assert.equal(r1.firstClear, true); assert.equal(r1.exp, Math.round(120 * 1.15));
  const r2 = applyResult(p, base);
  assert.equal(r2.exp, Math.round(120 * 1.15 * 0.6));
  const r3 = applyResult(p, { ...base, won: false, revenue: 10 });
  assert.equal(r3.exp, Math.round(120 * 0.35)); assert.equal(r3.stars, 0); assert.equal(p.stars['1-1'], 3);
});

test('two players grab the same karen at once: only one succeeds', () => {
  const w = shiftWorld();
  const a = addPlayer(w, 'a', 'A', 1), b = addPlayer(w, 'b', 'B', 2);
  const k = karen(w, 'streamer', 12, 10);
  a.x = 12; a.z = 9; b.x = 12; b.z = 11;
  requestAct(w, 'a', 'g1', 'grab', { t: 'customer', id: k.id });
  requestAct(w, 'b', 'g2', 'grab', { t: 'customer', id: k.id });
  const res = w.results.filter(r => r.rid === 'g1' || r.rid === 'g2').map(r => r.ok);
  assert.deepEqual(res, [true, false]);
  assert.equal(k.heldBy, 'a'); assert.equal(a.grabbing, k.id); assert.equal(b.grabbing, null);
});

test('throwing a karen through the door ejects her once (burst, combo, resolved)', () => {
  const w = shiftWorld();
  const p = addPlayer(w, 'a', 'A', 1);
  const k = karen(w, 'rager', 12, 13.5);
  p.x = 12; p.z = 12.4; p.yaw = 0; // facing +z (the door)
  requestAct(w, 'a', 'g', 'grab', { t: 'customer', id: k.id });
  tick(w, 0.05);
  requestThrow(w, 'a', 't', 0, 0.1);
  requestThrow(w, 'a', 't', 0, 0.1); // duplicate ignored
  run(w, 1.5);
  assert.equal(w.customers.includes(k), false);
  assert.equal(w.dayStats.ejected, 1); assert.equal(w.dayStats.karensResolved, 1);
  assert.equal(w.burst, 29); // throw +4, eject +25
  assert.ok(k.x >= DOOR_X0 && k.x <= DOOR_X1 && k.z >= STORE_D - 0.01);
});

test('throwing a normal customer out is punished; spin knocks back with cooldown', () => {
  const w = shiftWorld();
  const p = addPlayer(w, 'a', 'A', 1);
  const c = karen(w, 'normal', 12, 13.5); c.state = 'enter';
  p.x = 12; p.z = 12.4; p.yaw = 0;
  requestAct(w, 'a', 'g', 'grab', { t: 'customer', id: c.id });
  requestThrow(w, 'a', 't', 0, 0.1);
  run(w, 1.5);
  assert.equal(w.chaos >= 20, true);
  const k = karen(w, 'litterer', 10, 9); p.x = 9; p.z = 9;
  requestSpin(w, 'a', 's1');
  assert.ok(k.fly);
  requestSpin(w, 'a', 's2');
  assert.ok(w.results.some(r => r.rid === 's2' && !r.ok));
});

test('ultimate needs full burst and clears every unresolved karen', () => {
  const w = shiftWorld();
  addPlayer(w, 'a', 'A', 1);
  karen(w, 'rager', 13, 13); karen(w, 'hog', 10, 5); karen(w, 'normal', 8, 8).state = 'enter';
  requestUltimate(w, 'a', 'u1');
  assert.equal(w.results.find(r => r.rid === 'u1')?.ok, false);
  w.burst = 100;
  requestUltimate(w, 'a', 'u2');
  assert.equal(w.dayStats.ejected, 2); assert.equal(w.burst, 0);
  assert.equal(w.customers.filter(c => !c.gone).length, 1);
});

test('abilities are locked below their level', () => {
  const w = shiftWorld(5, '1-1');
  const p = addPlayer(w, 'a', 'A', 1);
  const k = karen(w, 'cutter', 12, 10); p.x = 12; p.z = 9;
  requestAct(w, 'a', 'g', 'grab', { t: 'customer', id: k.id });
  assert.equal(w.results[0].ok, false);
  assert.match(w.results[0].reason!, /Lv\.11/);
});

test('microwave reserves a bento and refunds it when cancelled; two food slots', () => {
  const w = shiftWorld(30, '2-2');
  const p = addPlayer(w, 'a', 'A', 1);
  p.x = 18.1; p.z = 10.1;
  const b0 = w.backstock.bento;
  requestAct(w, 'a', 'h1', 'heat', { t: 'microwave' });
  assert.equal(w.backstock.bento, b0 - 1);
  requestDrop(w, 'a', 'cancel');
  assert.equal(w.backstock.bento, b0); assert.equal(p.busy, null);
  requestAct(w, 'a', 'h2', 'heat', { t: 'microwave' }); run(w, 5);
  p.x = 15.6; p.z = 10.1;
  requestAct(w, 'a', 'c1', 'brew', { t: 'coffee' }); run(w, 4);
  assert.equal(p.held?.kind, 'meal'); assert.equal(p.held2?.kind, 'coffee');
  requestAct(w, 'a', 'c2', 'brew', { t: 'coffee' });
  assert.equal(w.results.at(-1)?.ok, false);
});

test('shift ends with a result: chaos 100 fails immediately', () => {
  const w = shiftWorld(1, '1-1');
  addPlayer(w, 'a', 'A', 1);
  w.chaos = 100; tick(w, 0.05);
  assert.equal(w.phase, 'summary'); assert.equal(w.result?.won, false); assert.match(w.result!.failReason, /混亂/);
});

test('boss 奧客之王: five phases, cannot be ejected early, defeat required to win 6-3', () => {
  const w = createWorld(defaultSave(), 9, buildShiftConfig(profileAt(30), '6-3'));
  w.phase = 'open'; w.phaseLeft = 999;
  const p = addPlayer(w, 'a', 'A', 1);
  const b = karen(w, 'boss', 12, 13); b.state = 'queue'; w.queue.push(b.id);
  p.x = 12; p.z = 12;
  // phase 1 → askQueue
  requestAct(w, 'a', 'q', 'askQueue', { t: 'customer', id: b.id }); run(w, 1.4);
  assert.equal(b.phase, 2);
  // throwing him out before the final phase only bounces him back (and advances phases 1-3)
  b.x = 12; b.z = 14.5; b.fly = null; b.state = 'complain'; p.x = 12; p.z = 13.6; p.yaw = 0;
  requestAct(w, 'a', 'g', 'grab', { t: 'customer', id: b.id }); requestThrow(w, 'a', 't', 0, 0.1); run(w, 2);
  assert.equal(w.customers.includes(b), true); assert.equal(b.phase, 3); assert.equal(w.bossDefeated, false);
  // phase 3 → stop filming twice
  for (let i = 0; i < 2; i++) { p.x = b.x; p.z = b.z; requestAct(w, 'a', 'f' + i, 'stopFilm', { t: 'customer', id: b.id }); run(w, 0.8); }
  assert.equal(b.phase, 4);
  // phase 4 → summons three minions; clearing them moves to phase 5
  b.x = 12; b.z = 9.6; b.path = []; run(w, 0.2);
  assert.equal(b.minions.length, 3);
  for (const id of b.minions) { const m = w.customers.find(c => c.id === id); if (m) { m.resolved = true; m.gone = true; } }
  run(w, 0.2);
  assert.equal(b.phase, 5);
  // final: ultimate ends it
  w.burst = 100; requestUltimate(w, 'a', 'u');
  assert.equal(w.bossDefeated, true);
});
