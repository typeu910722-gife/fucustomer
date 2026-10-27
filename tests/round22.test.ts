// Round 22: 常客奧客 story arcs, 店面升級 (new upgrade lines, sim-level effects), 每週挑戰, and old-save compatibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShiftConfig, newProfile, sanitizeProfile, type CareerProfile, type ShiftResult } from '../shared/career.ts';
import { ARCS, ARC_BY_ID, ARC_GAP, arcConfig, arcDone, arcState, finishArc, pickArc, takePreScene } from '../shared/regulars.ts';
import { unlockedAchievements } from '../shared/achievements.ts';
import { UPGRADES, UPGRADE_IDS, cameraCalm, doorbellBoost, loungePace, matSkip, selfcheckEvery } from '../shared/constants.ts';
import { addPlayer, createWorld, dayConfig, defaultSave, requestBuy, sanitizeSave, tick, toSave } from '../shared/sim.ts';
import { getCosmetic, buyCosmetic, sanitizeShop } from '../shared/shop.ts';
import { openStore, settleStoreDay, STORE_FUND, loungeMood } from '../shared/ownstore.ts';
import { TWIST_IDS, WEEKLY_ID, applyWeekly, buildWeeklyConfig, isoWeek, weeklyGoalsMet, weeklyPlan, weeklySeed, BADGE_POINTS, GOAL_POINTS } from '../shared/weekly.ts';

const result = (o: Partial<ShiftResult>): ShiftResult => ({
  shiftId: '1-2', won: true, failReason: '', revenue: 200, goal: 100, rating: 3.2, chaos: 10, served: 20, angryLeft: 0,
  karensResolved: 1, karensFailed: 0, ejected: 0, cleaned: 2, maxCombo: 0, ...o,
});
function progressed(chapters: number): CareerProfile {
  const p = newProfile(); p.level = 30;
  for (let c = 1; c <= chapters; c++) for (const s of buildIds(c)) p.stars[s] = 1;
  return p;
}
function buildIds(c: number) { return [1, 2, 3, 4, 5, 6].map(i => `${c}-${i}`); }

// ---------------- 常客奧客 arcs ----------------
test('arc data: four regulars, four stages each, rewards are real story cosmetics with achievements', () => {
  assert.ok(ARCS.length >= 3 && ARCS.length <= 8);
  for (const a of ARCS) {
    assert.equal(a.stages.length, 4);
    const c = getCosmetic(a.reward.cosmetic)!;
    assert.ok(c, a.id); assert.equal(c.reward, a.id); assert.equal(c.price, undefined); assert.equal(c.pack, undefined);
    for (const st of a.stages) { assert.ok(st.pre.length && st.post.length && st.bubbles.length && st.handled); }
    // stages never ask for an earlier chapter than the one before
    a.stages.reduce((prev, st) => { assert.ok(st.minChapter >= prev); return st.minChapter; }, 0);
  }
});

test('arc progression: pre-card once, stage clears only on a won shift where the regular was handled, gap between visits', () => {
  const p = progressed(1);
  const cfg = buildShiftConfig(p, '1-2'); // cutter shift
  const pick = pickArc(p, cfg)!;
  assert.equal(pick.arc.id, 'auntie'); assert.equal(pick.stage, 0);
  assert.equal(pickArc(p, buildShiftConfig(p, '1-1')), null, 'never in the very first shift');
  assert.ok(takePreScene(p, pick)?.length);
  assert.equal(takePreScene(p, pick), null, 'the card is shown once per stage');
  // lost, or won without dealing with her: nothing happens
  assert.equal(finishArc(p, pick, result({ won: false, handled: { cutter: 1 } })).advanced, false);
  assert.equal(finishArc(p, pick, result({ handled: { rager: 2 } })).advanced, false);
  p.stats.shifts = 5;
  const out = finishArc(p, pick, result({ handled: { cutter: 1 } }));
  assert.ok(out.advanced && !out.completed && out.post.length);
  assert.deepEqual(arcState(p, 'auntie'), { stage: 1, seen: 1, at: 5 });
  // she does not come straight back, and stage 2 needs chapter 2
  assert.equal(pickArc(p, buildShiftConfig(p, '1-3')), null);
  p.stats.shifts = 5 + ARC_GAP;
  assert.equal(pickArc(p, buildShiftConfig(p, '1-3')), null, 'stage 2 needs chapter 2');
  const p2 = progressed(2); p2.arcs = { ...p.arcs }; p2.stats.shifts = p.stats.shifts;
  assert.equal(pickArc(p2, buildShiftConfig(p2, '2-1'))?.stage, 1);
});

test('finishing an arc grants the cosmetic for free (kept by sanitizeShop, never sold) and its achievement', () => {
  const p = progressed(6);
  const arc = ARC_BY_ID.zhang;
  for (let s = 0; s < 4; s++) {
    p.stats.shifts += ARC_GAP;
    const cfg = buildShiftConfig(p, '6-1');
    const pick = pickArc(p, cfg);
    assert.ok(pick, `stage ${s}`);
    // more than one regular can fit 6-1; finish the one we are testing
    const mine = { arc, stage: arcState(p, 'zhang').stage };
    finishArc(p, mine, result({ shiftId: '6-1', handled: { rager: 1 } }));
  }
  assert.ok(arcDone(p, 'zhang'));
  assert.ok(p.shop.owned.includes('uni_qc'));
  assert.ok(unlockedAchievements(p).includes('ARC_ZHANG'));
  assert.ok(!unlockedAchievements(p).includes('ARC_AUNTIE'));
  assert.deepEqual(sanitizeShop(JSON.parse(JSON.stringify(p.shop))).owned, ['uni_qc']);
  const q = newProfile(); q.wallet = 99999;
  assert.deepEqual(buyCosmetic(q, 'uni_qc'), { ok: false, why: 'story' });
  // a finished arc is never picked again
  p.stats.shifts += 10;
  const again = pickArc(p, buildShiftConfig(p, '2-3'));
  assert.notEqual(again?.arc.id, 'zhang');
});

test('daily / weekly put the regular first; boss and endless shifts never have one', () => {
  const p = progressed(6);
  const w = buildWeeklyConfig(p, '2026-W43');
  if (!w.karens.includes('charger')) w.karens.push('charger');
  const pick = pickArc(p, w);
  assert.ok(pick);
  arcConfig(w, pick!);
  assert.equal(w.karens[0], pick!.arc.kind);
  assert.equal(pickArc(p, buildShiftConfig(p, '6-3')), null);
  assert.equal(pickArc(p, buildShiftConfig(p, 'endless')), null);
});

// ---------------- 店面升級 ----------------
test('upgrade lines: 4 new ones, sensible costs and capped effects', () => {
  for (const u of ['selfcheck', 'mat', 'doorbell', 'lounge', 'camera'] as const) {
    const d = UPGRADES[u];
    assert.ok(d.costs.length >= 1 && d.costs.length <= 3 && d.icon && d.levels?.length === d.costs.length, u);
    for (let i = 1; i < d.costs.length; i++) assert.ok(d.costs[i] > d.costs[i - 1]);
  }
  assert.equal(matSkip(0), 0); assert.equal(matSkip(2), 0.4); assert.equal(matSkip(99), 0.4);
  assert.equal(selfcheckEvery(0), 0); assert.equal(selfcheckEvery(1), 22); assert.equal(selfcheckEvery(2), 14);
  assert.deepEqual(doorbellBoost(2), { patience: 1.16, mood: 16 }); assert.deepEqual(doorbellBoost(9), doorbellBoost(2));
  assert.equal(loungePace(2), 1.16); assert.equal(cameraCalm(1), 1); assert.equal(cameraCalm(2), 1.25);
  // saves clamp to each line's max level
  const s = sanitizeSave({ ...defaultSave(), upgrades: { mat: 99, selfcheck: -3, doorbell: 1.4, lounge: 2, camera: 7 } });
  assert.deepEqual([s.upgrades.mat, s.upgrades.selfcheck, s.upgrades.doorbell, s.upgrades.lounge, s.upgrades.camera], [2, 0, 1, 2, 2]);
});

test('buying an upgrade between days takes the store money; past the max it is refused', () => {
  const w = createWorld(defaultSave(), 3, dayConfig());
  addPlayer(w, 'a', 'A', 0);
  w.money = 1000;
  requestBuy(w, 'a', 'r1', 'upg_mat', 0);
  assert.equal(w.upgrades.mat, 1); assert.equal(w.money, 1000 - UPGRADES.mat.costs[0]);
  requestBuy(w, 'a', 'r2', 'upg_mat', 1);
  assert.equal(w.upgrades.mat, 2);
  requestBuy(w, 'a', 'r3', 'upg_mat', 2);
  assert.equal(w.upgrades.mat, 2);
  assert.equal(w.results.at(-1)?.ok, false);
  w.phase = 'open';
  requestBuy(w, 'a', 'r4', 'upg_doorbell', 0);
  assert.equal(w.upgrades.doorbell, 0, 'no building work while open');
  assert.equal(toSave(w).upgrades.mat, 2, 'the level goes into the store save');
});

test('an upgrade bought between days is saved at once (a purchase save, not a second settlement)', () => {
  const w = createWorld(defaultSave(), 3, dayConfig());
  addPlayer(w, 'a', 'A', 0);
  w.phase = 'closing'; w.phaseLeft = 0.01; w.customers = [];
  tick(w, 0.05);
  assert.equal(w.phase, 'summary'); assert.equal(w.saveKind, 'night');
  w.money = 900;
  requestBuy(w, 'a', 'x1', 'upg_doorbell', 0);
  assert.equal(w.saveKind, 'night', 'settlement not sent yet: it stays a settlement (with the purchase in it)');
  assert.equal(w.saveOut?.upgrades.doorbell, 1);
  (w as { saveOut: unknown }).saveOut = null; // the room sent it
  requestBuy(w, 'a', 'x2', 'upg_lounge', 0);
  assert.equal(w.saveKind, 'purchase'); assert.equal(w.saveOut?.upgrades.lounge, 1); assert.equal(w.saveOut?.day, w.day + 1);
  assert.equal(w.saveOut?.money, 900 - UPGRADES.doorbell.costs[0] - UPGRADES.lounge.costs[0]);
  // career shifts never write store saves
  const sh = createWorld(defaultSave(), 3, buildShiftConfig(newProfile(), '1-2'));
  addPlayer(sh, 'a', 'A', 0); sh.money = 500;
  requestBuy(sh, 'a', 'y', 'stock_drinks');
  assert.equal(sh.saveOut, null);
});

/** Runs an open business day with no clerk and returns the world. */
function runDay(upg: Partial<Record<string, number>>, seconds: number, seed = 7, cfgPatch: Record<string, unknown> = {}) {
  const save = defaultSave(); Object.assign(save.upgrades, upg);
  const cfg = { ...dayConfig(), karens: [], ...cfgPatch };
  const w = createWorld(save, seed, cfg as ReturnType<typeof dayConfig>);
  w.phase = 'prep'; w.phaseLeft = 0.01;
  let splats = 0;
  for (let t = 0; t < seconds; t += 0.05) {
    tick(w, 0.05);
    for (const e of w.events) if (e.e === 'sfx' && e.name === 'splat') splats++;
    w.events = [];
    w.spills = []; // never hit the spill cap
  }
  return { w, splats };
}

test('防滑地墊: clearly fewer spills', () => {
  let base = 0, mat = 0;
  for (const seed of [1, 2, 3]) { base += runDay({}, 200, seed, { spillMul: 8 }).splats; mat += runDay({ mat: 2 }, 200, seed, { spillMul: 8 }).splats; }
  assert.ok(base > 20, `enough samples (${base})`);
  assert.ok(mat < base * 0.8, `mat ${mat} vs ${base}`);
});

test('自動門鈴: ordinary customers arrive with more patience and a better mood', () => {
  const a = runDay({}, 6).w, b = runDay({ doorbell: 2 }, 6).w;
  const ca = a.customers.find(c => c.kind === 'normal')!, cb = b.customers.find(c => c.kind === 'normal')!;
  assert.ok(ca && cb);
  assert.ok(Math.abs(cb.patienceMax / ca.patienceMax - 1.16) < 1e-9);
  assert.equal(cb.mood, Math.min(100, ca.mood + 16));
});

test('自助結帳機: with nobody at the till, the kiosk still serves small baskets (no tips)', () => {
  const none = runDay({}, 150).w, kiosk = runDay({ selfcheck: 2 }, 150).w;
  assert.equal(none.dayStats.served, 0);
  assert.ok(kiosk.dayStats.served >= 3, `served ${kiosk.dayStats.served}`);
  assert.ok(kiosk.dayStats.revenue > 0); assert.equal(kiosk.dayStats.tips, 0);
  const lv1 = runDay({ selfcheck: 1 }, 150).w;
  assert.ok(lv1.dayStats.served <= kiosk.dayStats.served);
});

test('員工休息室: own-store staff mood +3 per level each night (on top of the wage)', () => {
  const mk = (lounge: number) => {
    const p = newProfile(); p.level = 30; p.stars['6-3'] = 2; p.wallet = 5000;
    openStore(p, 'x', STORE_FUND, defaultSave());
    p.store!.staff.mood = 50;
    const save = { ...p.store!.save, upgrades: { ...p.store!.save.upgrades, lounge } };
    settleStoreDay(p, save);
    return p.store!.staff.mood;
  };
  assert.equal(mk(2) - mk(0), loungeMood(2));
  assert.equal(loungeMood(2), 6);
});

// ---------------- 每週挑戰 ----------------
test('ISO weeks', () => {
  assert.equal(isoWeek(new Date(2026, 9, 20)), '2026-W43');
  assert.equal(isoWeek(new Date(2026, 9, 19)), '2026-W43'); // Monday
  assert.equal(isoWeek(new Date(2026, 9, 25)), '2026-W43'); // Sunday
  assert.equal(isoWeek(new Date(2026, 9, 26)), '2026-W44');
  assert.equal(isoWeek(new Date(2021, 0, 3)), '2020-W53');
  assert.equal(isoWeek(new Date(2024, 11, 30)), '2025-W01');
});

test('weekly plan is deterministic, varies by week, and every twist shows up', () => {
  assert.deepEqual(JSON.stringify(weeklyPlan('2026-W43')), JSON.stringify(weeklyPlan('2026-W43')));
  assert.equal(weeklySeed('2026-W43'), weeklySeed('2026-W43'));
  const seen = new Set<string>();
  for (let w = 1; w <= 52; w++) {
    const plan = weeklyPlan(`2026-W${String(w).padStart(2, '0')}`);
    seen.add(plan.twist);
    assert.equal(plan.goals.length, 3);
    assert.equal(new Set(plan.goals.map(g => g.id)).size, 3);
  }
  assert.deepEqual([...seen].sort(), [...TWIST_IDS].sort());
});

test('weekly twists change the shift config', () => {
  const p = progressed(6);
  const weekOf = (t: string) => { for (let w = 1; w <= 53; w++) { const k = `2026-W${String(w).padStart(2, '0')}`; if (weeklyPlan(k).twist === t) return k; } throw new Error(t); };
  const base = buildShiftConfig(p, '6-3');
  const c = (t: string) => buildWeeklyConfig(p, weekOf(t));
  for (const t of TWIST_IDS) { const cfg = c(t); assert.equal(cfg.id, WEEKLY_ID); assert.equal(cfg.weekly?.twist, t); assert.ok(cfg.goal > 0); }
  const bo = c('blackout'); assert.ok(bo.events.includes('outage')); assert.equal(bo.eventEvery, 20);
  const inf = c('influencer'); assert.equal(inf.karens[0], 'streamer'); assert.ok(inf.karens.filter(k => k === 'streamer').length >= 2);
  const ty = c('typhoon'); assert.equal(ty.spillMul, 2.2); assert.ok(ty.spawnEvery > base.spawnEvery);
  const an = c('anniversary'); assert.ok(an.spawnEvery < base.spawnEvery); assert.ok(an.events.includes('rush'));
  const cf = c('coldfront'); assert.equal(cf.foodChance, 0.8);
  // and the sim runs every one of them
  for (const t of TWIST_IDS) { const w = createWorld(defaultSave(), 1, c(t)); addPlayer(w, 'a', 'A', 0); for (let i = 0; i < 400; i++) tick(w, 0.05); }
});

test('weekly rewards: each goal pays once per week, all three → badge + bonus, a new week starts fresh', () => {
  const p = progressed(2);
  const week = '2026-W43';
  const plan = weeklyPlan(week);
  const all = result({ shiftId: WEEKLY_ID, week, won: true, chaos: 0, cleaned: 20, served: 40, angryLeft: 0, karensFailed: 0, rating: 4, maxCombo: 3, handled: { streamer: 3 } });
  assert.deepEqual(weeklyGoalsMet(week, all), [true, true, true]);
  assert.deepEqual(weeklyGoalsMet(week, { ...all, won: false }), [false, false, false], 'a lost run meets nothing');
  const only1 = { ...all, chaos: 99, cleaned: 0, served: 0, angryLeft: 9, karensFailed: 3, rating: 1, maxCombo: 0, handled: {} };
  const r1 = applyWeekly(p, only1);
  assert.deepEqual(r1.weekly?.newly, [0]); assert.equal(r1.wallet, GOAL_POINTS[0]); assert.ok(r1.exp > 0);
  const again = applyWeekly(p, only1);
  assert.equal(again.wallet, 0); assert.equal(again.exp, 0);
  const r2 = applyWeekly(p, all);
  assert.deepEqual(r2.weekly?.newly, [1, 2]); assert.ok(r2.weekly?.badge);
  assert.equal(r2.wallet, plan.goals[1].points + plan.goals[2].points + BADGE_POINTS);
  assert.deepEqual(p.weekly.badges, [week]);
  assert.ok(unlockedAchievements(p).includes('WEEKLY_BADGE'));
  assert.equal(applyWeekly(p, all).wallet, 0);
  const next = applyWeekly(p, { ...all, week: '2026-W44' });
  assert.ok(next.wallet > 0); assert.equal(p.weekly.week, '2026-W44'); assert.deepEqual(p.weekly.badges, [week, '2026-W44']);
});

// ---------------- old saves ----------------
test('old profile JSON (before weekly / arcs / story cosmetics) loads; junk is cleaned', () => {
  const old = { version: 1, level: 7, exp: 3, wallet: 999, skills: { service: 1 }, gear: {}, stars: { '1-5': 2 }, clears: {}, stats: { shifts: 12 }, daily: { date: '2026-10-19', best: 300, rewarded: true, streak: 2, lastWin: '2026-10-19', wins: 4 }, shop: { owned: ['hat_cap'], equipped: { hat: 'hat_cap' }, entitlements: [] } };
  const p = sanitizeProfile(JSON.parse(JSON.stringify(old)));
  assert.equal(p.level, 7); assert.equal(p.wallet, 999); assert.equal(p.daily.wins, 4);
  assert.deepEqual(p.weekly, { week: '', done: 0, best: 0, plays: 0, badges: [] });
  assert.deepEqual(p.arcs, {});
  assert.deepEqual(p.shop.owned, ['hat_cap']);
  // weekly / arcs junk
  const junk = sanitizeProfile({ ...old, weekly: { week: 'nope', done: 99, best: -5, plays: 'x', badges: ['2026-W40', 'bad', 3, '2026-W40'] }, arcs: { auntie: { stage: 99, seen: -1, at: 'x' }, ghost: { stage: 2 }, kai: 'x' } });
  assert.deepEqual(junk.weekly, { week: '', done: 0, best: 0, plays: 0, badges: ['2026-W40'] });
  assert.deepEqual(junk.arcs, { auntie: { stage: 4, seen: 4, at: 0 } });
  // round trip keeps everything
  const full = sanitizeProfile({ ...old, weekly: { week: '2026-W43', done: 5, best: 500, plays: 3, badges: ['2026-W41'] }, arcs: { kai: { stage: 2, seen: 3, at: 40 } } });
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(full))), full);
  assert.deepEqual(full.arcs.kai, { stage: 2, seen: 3, at: 40 });
});

test('old store saves (no new upgrade fields) load in free play and in your own store', () => {
  const oldSave = { version: 1, day: 9, money: 777, rating: 3.4, backstock: { drinks: 10, snacks: 10, bento: 10 }, shelves: { drinks: 5, snacks: 5, bento: 5 },
    upgrades: { register2: 1, scanner: 2, coffee: 0, shelves: 1, camera: 1, mopbot: 0, ads: 1 }, totals: { served: 5, karens: 1, revenue: 300 } };
  const s = sanitizeSave(JSON.parse(JSON.stringify(oldSave)));
  assert.equal(s.day, 9); assert.equal(s.upgrades.scanner, 2); assert.equal(s.upgrades.camera, 1);
  for (const u of ['selfcheck', 'mat', 'doorbell', 'lounge'] as const) assert.equal(s.upgrades[u], 0);
  for (const u of UPGRADE_IDS) assert.equal(typeof s.upgrades[u], 'number');
  const w = createWorld(oldSave as never, 1, dayConfig());
  assert.equal(w.money, 777); assert.equal(w.upgrades.mat, 0);
  for (let i = 0; i < 200; i++) tick(w, 0.05);
  // own store inside an old profile
  const prof = sanitizeProfile({ version: 1, level: 30, stars: { '6-3': 2 }, store: { name: '老店', invested: 2500, save: oldSave, days: 8, negDays: 0, staff: { name: '小陳', mood: 70, quit: false }, wage: 'fair', bestDay: 10, withdrawn: 0, map: 'convenience' } });
  assert.equal(prof.store?.save.money, 777);
  assert.equal(sanitizeSave(prof.store!.save).upgrades.lounge, 0);
});
