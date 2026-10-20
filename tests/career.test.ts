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
  // balance pass (docs/BALANCE.md): ★2 needs rating ≥ 2.8 (was 3.5), ★3 needs 115% of the goal (was 130%)
  assert.equal(starsFor({ ...base, revenue: 61, rating: 2.7 }), 1);
  assert.equal(starsFor({ ...base, revenue: 61, rating: 2.8 }), 2);
  assert.equal(starsFor({ ...base, revenue: 69, rating: 2.7 }), 2);
  assert.equal(starsFor({ ...base, revenue: 68, rating: 2.7 }), 1);
  assert.equal(starsFor({ ...base, rating: 2.8, chaos: 60 }), 2);
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
  assert.equal(k.ejected, true); assert.equal(k.state, 'leaving'); // lying outside, about to walk off
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
  // thrown-out karens lie on the pavement outside, then walk away
  const out = w.customers.filter(c => c.ejected);
  assert.equal(out.length, 2); assert.ok(out.every(c => c.state === 'leaving' && c.z > 16 && (c.downT ?? 0) > 0));
  run(w, 16);
  assert.equal(w.customers.filter(c => c.ejected).length, 0, 'gone after walking off');
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

test('充電霸王: walks to the socket, drains money; two unplugs or a coffee resolve him; outage sends him away', () => {
  // natural spawn path: goes to the socket and starts charging
  const w = shiftWorld(20, '4-3');
  const p = addPlayer(w, 'a', 'A', 1);
  const c = karen(w, 'charger', 3.2, 13); c.life = 75; c.knockTimer = 5; c.speed = 1.6; c.state = 'enter';
  run(w, 4);
  assert.equal(c.state, 'charge');
  const money = w.money; run(w, 5.1); assert.ok(w.money < money, 'electricity bill ticks up');
  p.x = c.x; p.z = c.z - 0.8;
  requestAct(w, 'a', 'u1', 'unplug', { t: 'customer', id: c.id }); run(w, 1.2);
  assert.equal(c.resolved, false); assert.equal(c.hits, 1);
  requestAct(w, 'a', 'u2', 'unplug', { t: 'customer', id: c.id }); run(w, 1.2);
  assert.equal(c.resolved, true); assert.equal(c.state, 'leaving');

  // a coffee resolves him at once
  const w2 = shiftWorld(20, '4-3'); const p2 = addPlayer(w2, 'a', 'A', 1);
  const c2 = karen(w2, 'charger', 3.2, 15.2); c2.state = 'charge'; c2.life = 75; c2.knockTimer = 5;
  p2.x = 3.2; p2.z = 14.4; p2.held = { kind: 'coffee' };
  requestAct(w2, 'a', 't', 'treat', { t: 'customer', id: c2.id }); run(w2, 0.5);
  assert.equal(c2.resolved, true); assert.equal(p2.held, null);
  assert.ok(w2.rating > 3);

  // power outage: he gives up on his own
  const w3 = shiftWorld(20, '4-3');
  const c3 = karen(w3, 'charger', 3.2, 15.2); c3.state = 'charge'; c3.life = 75; c3.knockTimer = 5;
  w3.power = 0.35; run(w3, 0.2);
  assert.equal(c3.resolved, true);

  // ignored until fully charged: counts as a failure
  const w4 = shiftWorld(20, '4-3');
  const c4 = karen(w4, 'charger', 3.2, 15.2); c4.state = 'charge'; c4.life = 2; c4.knockTimer = 5;
  run(w4, 2.5);
  assert.equal(c4.resolved, true); assert.equal(w4.dayStats.karensFailed, 1);
});

test('daily challenge: same plan for the same date, modifiers applied, reward once per day, streak', async () => {
  const { DAILY_ID, buildDailyConfig, dailyPlan, dailyUnlocked } = await import('../shared/career.ts');
  const p = profileAt(12);
  assert.equal(dailyUnlocked(p), false);
  for (let i = 1; i <= 5; i++) p.stars[`1-${i}`] = 1;
  for (let i = 1; i <= 5; i++) p.stars[`2-${i}`] = 1;
  assert.equal(dailyUnlocked(p), true);
  assert.deepEqual(dailyPlan(p, '2026-10-19'), dailyPlan(p, '2026-10-19'));
  const plans = new Set(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map(d => JSON.stringify(dailyPlan(p, d).mods)));
  assert.ok(plans.size > 1, 'modifiers change from day to day');
  // no two karen-type modifiers at once; difficulty never above what the player has unlocked
  for (let d = 1; d <= 28; d++) {
    const plan = dailyPlan(p, `2026-11-${String(d).padStart(2, '0')}`);
    assert.ok(!(plan.mods.includes('streamers') && plan.mods.includes('chargers')));
    assert.ok(plan.difficulty <= 3);
    const cfg = buildDailyConfig(p, `2026-11-${String(d).padStart(2, '0')}`);
    assert.equal(cfg.id, DAILY_ID); assert.ok(cfg.goal > 0 && cfg.karens.length > 0);
    if (plan.mods.includes('chargers')) assert.deepEqual(cfg.karens, ['charger']);
    if (plan.mods.includes('outages')) assert.equal(cfg.eventEvery, 24);
  }
  const res = (won: boolean, date: string): ShiftResult => ({ shiftId: DAILY_ID, date, won, failReason: '', revenue: won ? 400 : 100, goal: 300, rating: 3, chaos: 10, served: 20, angryLeft: 0, karensResolved: 2, karensFailed: 0, ejected: 0, cleaned: 0, maxCombo: 0 });
  const r1 = applyResult(p, res(true, '2026-10-19'));
  assert.ok(r1.exp > 0 && r1.wallet > 0); assert.equal(p.daily.streak, 1);
  const r2 = applyResult(p, res(true, '2026-10-19'));
  assert.equal(r2.exp, 0); assert.equal(r2.wallet, 0); assert.equal(r2.daily?.already, true);
  applyResult(p, res(true, '2026-10-20')); applyResult(p, res(true, '2026-10-21'));
  assert.equal(p.daily.streak, 3);
  applyResult(p, res(true, '2026-10-23'));
  assert.equal(p.daily.streak, 1, 'a missed day restarts the streak');
  // the profile survives a save/load round trip, junk is dropped
  const back = sanitizeProfile(JSON.parse(JSON.stringify({ ...p, achievements: ['BOSS', 'BOSS', '<script>', 5], daily: { ...p.daily, date: 'nope' } })));
  assert.deepEqual(back.achievements, ['BOSS']); assert.equal(back.daily.date, ''); assert.equal(back.daily.streak, 1);
});

test('achievements are stored once and reported as new only the first time', async () => {
  const { updateAchievements } = await import('../shared/achievements.ts');
  const p = newProfile(); p.stats.wins = 1;
  assert.deepEqual(updateAchievements(p).map(a => a.id), ['FIRST_SHIFT']);
  assert.deepEqual(updateAchievements(p), []);
  assert.deepEqual(p.achievements, ['FIRST_SHIFT']);
});
