// 店面等級・連鎖分店・個人紀錄 (shared/progression.ts): XP curve, unlocks, records/streak, events, branch income caps,
// sanitize + backward compatibility of old saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCH_COST, BRANCH_LEVEL_REQ, BRANCH_MAX, BRANCH_SHIFTS_PER_DAY, DAILY_EVENTS, DAY_XP, EVENT_CHANCE, LEVEL_COSMETICS, LEVEL_TITLES, LEVEL_UNLOCKS, LEVEL_XP,
  STORE_MAX_LEVEL, XP_CAP, applyReportToSave, branchIncome, canOpenBranch, dayXp, grantLevelCosmetics, levelInfo, levelOf, newProg, openBranch,
  payBranches, pickDailyEvent, recordDay, sanitizeBranches, sanitizeProg, sellBranches, maxStoreLevel, allStoreProgs,
} from '../shared/progression.ts';
import { newProfile, sanitizeProfile } from '../shared/career.ts';
import { closeStore, openStore, settleStoreDay } from '../shared/ownstore.ts';
import { defaultSave } from '../shared/sim.ts';
import { getCosmetic } from '../shared/shop.ts';
import { unlockedAchievements } from '../shared/achievements.ts';

const goodDay = { revenue: 480, karens: 5, rating: 4.1 };

test('level curve: 10 levels, strictly increasing, titles for each, Lv5 ≈ a week+ and Lv10 ≈ 50 good days', () => {
  assert.equal(LEVEL_XP.length, STORE_MAX_LEVEL); assert.equal(LEVEL_TITLES.length, STORE_MAX_LEVEL);
  for (let i = 1; i < LEVEL_XP.length; i++) assert.ok(LEVEL_XP[i] > LEVEL_XP[i - 1]);
  assert.equal(LEVEL_TITLES[0], '巷口小店'); assert.equal(LEVEL_TITLES[4], '區域名店'); assert.equal(LEVEL_TITLES[9], '傳說名店');
  assert.equal(levelOf(0), 1); assert.equal(levelOf(LEVEL_XP[1] - 1), 1); assert.equal(levelOf(LEVEL_XP[1]), 2);
  assert.equal(levelOf(LEVEL_XP[9]), 10); assert.equal(levelOf(XP_CAP), 10);
  const per = dayXp(goodDay);
  assert.equal(per, 40 + 120 + 50 + 25);
  const daysTo = (lv: number) => Math.ceil(LEVEL_XP[lv - 1] / per);
  assert.ok(daysTo(5) >= 7 && daysTo(5) <= 12, `Lv5 after ${daysTo(5)} days`);
  assert.ok(daysTo(10) >= 40 && daysTo(10) <= 60, `Lv10 after ${daysTo(10)} days`);
  // a perfect day can't skip the curve: the per-day XP is capped
  assert.equal(dayXp({ revenue: 1e9, karens: 1e6, rating: 5 }), DAY_XP.base + DAY_XP.revenueCap + DAY_XP.karenCap + 40);
  assert.equal(dayXp({ revenue: -50, karens: -3, rating: 0 }), DAY_XP.base);
  const li = levelInfo(LEVEL_XP[2] + 10);
  assert.equal(li.level, 3); assert.equal(li.into, 10); assert.equal(li.need, LEVEL_XP[3] - LEVEL_XP[2]); assert.equal(li.nextTitle, LEVEL_TITLES[3]);
  assert.equal(levelInfo(XP_CAP).pct, 100); assert.equal(levelInfo(XP_CAP).nextTitle, null);
});

test('unlocks: every level 2–10 gives something; cosmetics are free story-style rewards; branch only for the own store', () => {
  for (let l = 2; l <= 10; l++) assert.ok(LEVEL_UNLOCKS.some(u => u.level === l), `Lv${l}`);
  for (const c of LEVEL_COSMETICS) {
    const cos = getCosmetic(c.id)!;
    assert.ok(cos, c.id); assert.equal(cos.price, undefined); assert.equal(cos.pack, undefined); assert.equal(cos.reward, `store:${c.level}`);
  }
  assert.ok(LEVEL_UNLOCKS.find(u => u.kind === 'branch')!.ownOnly);
  for (const e of DAILY_EVENTS) { assert.ok(e.money <= 80 && e.rating <= 0.15, e.id); assert.ok(LEVEL_UNLOCKS.some(u => u.kind === 'event' && u.id === e.id && u.level === e.level)); }
  const p = newProfile();
  assert.deepEqual(grantLevelCosmetics(p, 2), []);
  assert.deepEqual(grantLevelCosmetics(p, 6), ['sign_local', 'mat_carpet']);
  assert.deepEqual(grantLevelCosmetics(p, 6), []);
  // the shop sanitizer keeps level rewards (they are not bought)
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(p))).shop.owned, ['sign_local', 'mat_carpet']);
});

test('recordDay: XP, level-ups with unlocks, personal records and the 好評 streak', () => {
  const pr = newProg();
  pr.xp = LEVEL_XP[1] - 10;
  const r = recordDay(pr, goodDay, { own: true });
  assert.equal(r.before, 1); assert.deepEqual(r.levels, [2]); assert.equal(r.unlocked[0].id, 'chief');
  assert.deepEqual(r.records, []); // the first day sets the bests without fanfare
  assert.equal(pr.bestRevenue, 480); assert.equal(pr.bestKarens, 5); assert.equal(pr.days, 1); assert.equal(pr.streak, 1);
  recordDay(pr, { revenue: 500, karens: 2, rating: 3.2 });
  const r3 = recordDay(pr, { revenue: 300, karens: 9, rating: 3.6 });
  assert.deepEqual(r3.records, ['karens', 'streak']); assert.equal(pr.bestStreak, 3);
  const r4 = recordDay(pr, { revenue: 100, karens: 0, rating: 2.5 });
  assert.equal(r4.streak, 0); assert.equal(pr.streak, 0); assert.equal(pr.bestStreak, 3); assert.equal(pr.bestRevenue, 500);
  // free play never unlocks the branch line
  const fp = newProg(); fp.xp = LEVEL_XP[4] - 1;
  assert.ok(!recordDay(fp, goodDay).unlocked.some(u => u.kind === 'branch'));
  const own = newProg(); own.xp = LEVEL_XP[4] - 1;
  assert.ok(recordDay(own, goodDay, { own: true }).unlocked.some(u => u.kind === 'branch'));
  // XP never passes the cap
  const top = newProg(); top.xp = XP_CAP - 1; recordDay(top, goodDay); assert.equal(top.xp, XP_CAP);
});

test('daily events: only unlocked ones, about EVENT_CHANCE of nights, deterministic per key; rewards stay in range', () => {
  assert.equal(pickDailyEvent(1, 'x'), null);
  let hits = 0;
  for (let d = 0; d < 2000; d++) {
    const e = pickDailyEvent(4, `convenience|free|${d}|0`);
    if (e) { hits++; assert.ok(e.level <= 4, e.id); }
    assert.equal(pickDailyEvent(4, `convenience|free|${d}|0`)?.id, e?.id);
  }
  assert.ok(Math.abs(hits / 2000 - EVENT_CHANCE) < 0.05, `rate ${hits / 2000}`);
  const tv = DAILY_EVENTS.find(e => e.id === 'tv')!;
  const save = { ...defaultSave(), rating: 4.95 };
  const out = applyReportToSave(save, { xp: 0, level: 9, before: 9, levels: [], unlocked: [], records: [], streak: 0, event: tv, supplier: 'snacks' });
  assert.equal(out.money, save.money + 80); assert.equal(out.rating, 5); assert.equal(out.backstock.snacks, save.backstock.snacks + 6);
  assert.equal(save.backstock.snacks, defaultSave().backstock.snacks); // input not mutated
  // 廠商熟客 picks the emptiest line the map sells (Lv5+ only)
  const lv5 = newProg(); lv5.xp = LEVEL_XP[4];
  assert.equal(recordDay(lv5, goodDay, { backstock: { drinks: 30, snacks: 2, bento: 9, extra: 0 }, products: ['drinks', 'snacks', 'bento'] }).supplier, 'snacks');
  assert.equal(recordDay(newProg(), goodDay, { backstock: { drinks: 0, snacks: 0, bento: 0 } }).supplier, null);
});

function richOwner() {
  const p = newProfile();
  p.stars['6-3'] = 1; p.wallet = 50_000;
  openStore(p, '阿明商店', 2500, defaultSave(), 'convenience');
  return p;
}

test('branches: level gates, costs, different store types, max 3', () => {
  const p = richOwner();
  const st = p.store!;
  assert.match(canOpenBranch(st, p.wallet, 'cafe').why!, /Lv5/);
  st.prog = newProg(); st.prog.xp = LEVEL_XP[BRANCH_LEVEL_REQ[0] - 1];
  assert.match(canOpenBranch(st, p.wallet, 'convenience').why!, /已經有了/);
  assert.match(canOpenBranch(st, p.wallet, 'cafe', true).why!, /擴充包/);
  assert.match(canOpenBranch(st, 100, 'cafe').why!, /存款不足/);
  const w0 = p.wallet;
  assert.ok(openBranch(p, 'cafe', '', defaultSave()));
  assert.equal(p.wallet, w0 - BRANCH_COST[0]);
  assert.equal(st.branches!.length, 1); assert.match(st.branches![0].name, /分店/);
  assert.equal(openBranch(p, 'bakery', '', defaultSave()), null, '2nd branch needs Lv7');
  st.prog.xp = LEVEL_XP[9];
  assert.ok(openBranch(p, 'bakery', '麵包二店', defaultSave()));
  assert.equal(openBranch(p, 'bakery', '', defaultSave()), null, 'same type twice');
  assert.ok(openBranch(p, 'boba', '', defaultSave()));
  assert.equal(st.branches!.length, BRANCH_MAX);
  assert.match(canOpenBranch(st, p.wallet, 'chicken').why!, /最多/);
  assert.equal(w0 - p.wallet, BRANCH_COST.reduce((a, b) => a + b, 0));
  const ach = unlockedAchievements(p);
  assert.ok(ach.includes('BRANCH_1') && ach.includes('BRANCH_3') && ach.includes('STORE_LV10'));
});

test('branch income: per shift elsewhere, capped per branch per day, resets the next day, skips the branch being played', () => {
  const p = richOwner();
  p.store!.prog = newProg(); p.store!.prog.xp = LEVEL_XP[9];
  for (const m of ['cafe', 'bakery', 'boba']) openBranch(p, m, '', defaultSave());
  const w0 = p.wallet;
  let paid = 0;
  for (let i = 0; i < 10; i++) paid += payBranches(p, '2026-10-20', `k${i}`).reduce((n, x) => n + x.amount, 0);
  assert.equal(paid, 3 * BRANCH_SHIFTS_PER_DAY * branchIncome(1));
  assert.equal(p.wallet - w0, paid);
  assert.ok(p.store!.branches![0].log.length > 0 && p.store!.branches![0].log.length <= 6);
  // worst case for a whole day of a maxed-out chain: documented $540
  assert.equal(BRANCH_MAX * BRANCH_SHIFTS_PER_DAY * branchIncome(10), 540);
  assert.equal(branchIncome(99), branchIncome(10));
  // next day pays again; the branch you are playing doesn't pay itself
  const pays = payBranches(p, '2026-10-21', 'x', 'cafe');
  assert.deepEqual(pays.map(x => x.map), ['bakery', 'boba']);
  assert.deepEqual(payBranches(p, 'not-a-date', 'x'), []);
  assert.deepEqual(payBranches(newProfile(), '2026-10-21', 'x'), []);
});

test('closing or bankruptcy sells the branches for half their cost', () => {
  const p = richOwner();
  p.store!.prog = newProg(); p.store!.prog.xp = LEVEL_XP[9];
  openBranch(p, 'cafe', '', defaultSave()); openBranch(p, 'bakery', '', defaultSave());
  const till = p.store!.save.money, w = p.wallet;
  assert.equal(closeStore(p), till + (BRANCH_COST[0] + BRANCH_COST[1]) / 2);
  assert.equal(p.wallet, w + till + (BRANCH_COST[0] + BRANCH_COST[1]) / 2);
  const q = richOwner();
  q.store!.prog = newProg(); q.store!.prog.xp = LEVEL_XP[9];
  openBranch(q, 'cafe', '', defaultSave());
  const w2 = q.wallet;
  q.store!.negDays = 2;
  const out = settleStoreDay(q, { ...q.store!.save, money: -50 });
  assert.ok(out.bankrupt); assert.equal(q.store, null); assert.equal(q.wallet, w2 + BRANCH_COST[0] / 2);
  assert.equal(sellBranches({ map: 'x' }), 0);
});

test('sanitize: old saves load (no progress fields), junk is clamped, branches are validated', () => {
  // a profile + own store from before this round
  const old = {
    version: 1, level: 20, exp: 0, wallet: 900, stars: { '6-3': 2 }, clears: {}, stats: {},
    store: { name: '老店', invested: 2500, save: { ...defaultSave(), money: 1200 }, days: 30, negDays: 0, staff: { name: '小陳', mood: 70, quit: false }, wage: 'fair', bestDay: 300, withdrawn: 0, map: 'cafe' },
  };
  const p = sanitizeProfile(old);
  assert.deepEqual(p.freeProg, {});
  assert.deepEqual(p.store!.prog, newProg()); assert.deepEqual(p.store!.branches, []);
  assert.equal(maxStoreLevel(p), 1); assert.equal(allStoreProgs(p).length, 1);
  // junk
  assert.deepEqual(sanitizeProg('lol'), newProg());
  const pr = sanitizeProg({ xp: 1e12, days: -4, streak: 99, bestStreak: 5, bestRevenue: NaN, bestKarens: '7' });
  assert.equal(pr.xp, XP_CAP); assert.equal(pr.days, 0); assert.equal(pr.streak, 5); assert.equal(pr.bestRevenue, 0); assert.equal(pr.bestKarens, 0);
  const q = sanitizeProfile({ ...old, freeProg: { convenience: { xp: 500, days: 3 }, nowhere: { xp: 1 }, cafe: 'x' } });
  assert.deepEqual(Object.keys(q.freeProg), ['convenience']); assert.equal(q.freeProg.convenience.xp, 500);
  const b = (map: string, extra: object = {}) => ({ map, name: 'B', manager: '阿德', cost: 2000, save: { ...defaultSave(), money: 400 }, prog: { xp: 10 }, payDate: '2026-10-20', payCount: 2, earned: 50, log: ['hi'], ...extra });
  const br = sanitizeBranches([b('cafe'), b('cafe'), b('bakery', { payCount: 99, manager: 'Mallory', payDate: 'zzz' }), b('nowhere'), b('boba', { save: null }), b('boba'), b('chicken'), 'junk'], 'convenience');
  assert.deepEqual(br.map(x => x.map), ['cafe', 'bakery', 'boba']);
  assert.equal(br[1].payCount, BRANCH_SHIFTS_PER_DAY); assert.equal(br[1].manager, '阿德'); assert.equal(br[1].payDate, '');
  assert.deepEqual(sanitizeBranches([b('convenience')], 'convenience'), [], 'a branch of the flagship type is dropped');
  const bad = sanitizeBranches([b('cafe', { save: { money: 5, upgrades: { scanner: 99, bogus: 3 }, backstock: { drinks: 'x' }, rating: 77 } })], 'convenience')[0];
  assert.equal(bad.save.upgrades.scanner, 2); assert.equal((bad.save.upgrades as Record<string, number>).bogus, undefined);
  assert.equal(bad.save.rating, 5); assert.equal(bad.save.backstock.drinks, 18);
  // round trip through JSON keeps everything
  const r = richOwner();
  r.store!.prog = newProg(); r.store!.prog.xp = LEVEL_XP[4];
  openBranch(r, 'cafe', '貓咪分店', defaultSave());
  r.freeProg.bakery = { ...newProg(), xp: 777, days: 4, bestRevenue: 600, bestKarens: 8, streak: 2, bestStreak: 3 };
  const back = sanitizeProfile(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(back.store!.branches, r.store!.branches); assert.deepEqual(back.freeProg, r.freeProg); assert.deepEqual(back.store!.prog, r.store!.prog);
});

test('achievements: store level 5/10 and streaks from any store', () => {
  const p = newProfile();
  assert.ok(!unlockedAchievements(p).includes('STORE_LV5'));
  p.freeProg.cafe = { ...newProg(), xp: LEVEL_XP[4], days: 9, bestStreak: 7 };
  const a = unlockedAchievements(p);
  assert.ok(a.includes('STORE_LV5') && a.includes('STREAK_7') && !a.includes('STORE_LV10') && !a.includes('STREAK_30') && !a.includes('BRANCH_1'));
});
