// Round 30c: four more 常客奧客 (對獎阿公, 找零姐美玲, 袋子伯阿土, 網紅情侶) — data, where each one can turn up
// (only shifts that have their karen kind, chapter rules, the café couple only once chapter 8 is open), progression to
// the free cosmetic + achievement, the "all regulars" achievement, and old-save compatibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allShifts, buildShiftConfig, newProfile, sanitizeProfile, type CareerProfile, type ShiftConfig, type ShiftResult } from '../shared/career.ts';
import { ARCS, ARC_BY_ID, ARC_GAP, arcConfig, arcDone, arcState, finishArc, pickArc, takePreScene, type ArcDef } from '../shared/regulars.ts';
import { ACHIEVEMENTS, unlockedAchievements } from '../shared/achievements.ts';
import { GEN_KINDS, KAREN_INFO } from '../shared/constants.ts';
import { SIG_KINDS } from '../shared/sigkarens.ts';
import { buyCosmetic, getCosmetic, sanitizeShop } from '../shared/shop.ts';
import { buildSpecialConfig } from '../shared/specialdays.ts';
import { buildWeeklyConfig } from '../shared/weekly.ts';

const NEW = ['lotto', 'meiling', 'bags', 'couple'];
const result = (o: Partial<ShiftResult>): ShiftResult => ({
  shiftId: 'daily', won: true, failReason: '', revenue: 300, goal: 100, rating: 3.2, chaos: 10, served: 20, angryLeft: 0,
  karensResolved: 1, karensFailed: 0, ejected: 0, cleaned: 2, maxCombo: 0, ...o,
});
function progressed(chapters: number): CareerProfile {
  const p = newProfile(); p.level = 30;
  for (const s of allShifts()) if (s.chapter <= chapters) p.stars[s.id] = 1;
  return p;
}
/** All the other regulars' stories finished, so only `id` can be picked. */
function only(p: CareerProfile, id: string) {
  for (const a of ARCS) if (a.id !== id) p.arcs[a.id] = { stage: a.stages.length, seen: a.stages.length, at: 0 };
  return p;
}
/** A daily-style shift (chapter `ch`) in `map` with these karens. */
function dailyLike(p: CareerProfile, ch: number, karens: ShiftConfig['karens'], map = 'convenience'): ShiftConfig {
  const cfg = buildShiftConfig(p, `${ch}-3`);
  cfg.id = 'daily'; cfg.map = map; cfg.karens = karens; cfg.boss = false;
  return cfg;
}

test('eight regulars: four stages each, every one tied to a different karen kind, new rewards are free story cosmetics', () => {
  assert.equal(ARCS.length, 8);
  assert.deepEqual(ARCS.slice(4).map(a => a.id), NEW);
  assert.equal(new Set(ARCS.map(a => a.kind)).size, ARCS.length, 'one karen kind per regular');
  assert.ok(ARCS.some(a => (GEN_KINDS as string[]).includes(a.kind)), 'at least one general karen');
  assert.ok(ARCS.some(a => (SIG_KINDS as string[]).includes(a.kind)), 'at least one store signature karen');
  const slots = new Set<string>();
  for (const a of ARCS) {
    assert.ok(KAREN_INFO[a.kind], a.id);
    assert.equal(a.stages.length, 4, a.id);
    for (const st of a.stages) assert.ok(st.title && st.pre.length && st.post.length && st.bubbles.length >= 2 && st.handled, `${a.id} ${st.title}`);
    a.stages.reduce((prev, st) => { assert.ok(st.minChapter >= prev); return st.minChapter; }, 0);
    const c = getCosmetic(a.reward.cosmetic)!;
    assert.ok(c, a.id); assert.equal(c.reward, a.id); assert.equal(c.price, undefined); assert.equal(c.pack, undefined);
    assert.ok(ACHIEVEMENTS.some(x => x.id === a.reward.achievement), a.reward.achievement);
    if (NEW.includes(a.id)) slots.add(c.slot);
  }
  assert.deepEqual([...slots].sort(), ['hat', 'mascot', 'tag', 'uniform'], 'hat, apron, name tag and counter figure');
  assert.ok(ACHIEVEMENTS.some(x => x.id === 'ARC_ALL'));
});

test('general-karen regulars never show up in the main story; they come on special days and daily/weekly days with their karen', () => {
  const p = progressed(10);
  for (const id of ['lotto', 'meiling', 'bags']) {
    const q = only(structuredClone(p), id);
    for (const s of allShifts()) assert.equal(pickArc(q, buildShiftConfig(q, s.id))?.arc.id === id, false, `${id} in ${s.id}`);
  }
  // 跨年夜 brings 對獎魔人 + 找零姐, 颱風夜 brings 袋子阿伯 (and no 對獎 / 找零)
  assert.equal(pickArc(only(progressed(3), 'lotto'), buildSpecialConfig(progressed(3), 'newyear'))?.arc.id, 'lotto');
  assert.equal(pickArc(only(progressed(3), 'meiling'), buildSpecialConfig(progressed(3), 'newyear'))?.arc.id, 'meiling');
  assert.equal(pickArc(only(progressed(3), 'bags'), buildSpecialConfig(progressed(3), 'typhoon'))?.arc.id, 'bags');
  assert.equal(pickArc(only(progressed(3), 'bags'), buildSpecialConfig(progressed(3), 'newyear')), null);
  assert.equal(pickArc(only(progressed(3), 'lotto'), buildSpecialConfig(progressed(3), 'typhoon')), null);
  const sp = buildSpecialConfig(progressed(3), 'typhoon');
  arcConfig(sp, pickArc(only(progressed(3), 'bags'), sp)!);
  assert.equal(sp.karens[0], 'bagman', 'on a special day the regular also comes first');
  // a daily with the karen: the regular is moved to the front so they are the first karen through the door
  const q = only(progressed(3), 'lotto');
  const cfg = dailyLike(q, 3, ['cutter', 'rager', 'lottery']);
  const pick = pickArc(q, cfg)!;
  assert.equal(pick.arc.id, 'lotto');
  arcConfig(cfg, pick);
  assert.equal(cfg.karens[0], 'lottery');
  assert.equal(pickArc(q, dailyLike(q, 3, ['cutter', 'rager'])), null, 'no 對獎魔人 that day: no 阿公');
  // chapter rule: 找零姐's first visit needs a chapter-3 day
  const m = only(progressed(3), 'meiling');
  assert.equal(pickArc(m, dailyLike(m, 2, ['change'])), null);
  assert.equal(pickArc(m, dailyLike(m, 3, ['change']))?.arc.id, 'meiling');
  // the weekly brings one general karen every week: if it is theirs, they can come
  const w = only(progressed(6), 'bags');
  for (const week of ['2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48', '2026-W49']) {
    const wc = buildWeeklyConfig(w, week);
    assert.equal(pickArc(w, wc)?.arc.id === 'bags', wc.karens.includes('bagman'), week);
  }
});

test('the café couple (一杯坐整天, chapter 8) only comes once chapter 8 is open', () => {
  const early = only(progressed(6), 'couple');
  const cafe = dailyLike(early, 3, ['cutter', 'squatter'], 'cafe');
  assert.equal(pickArc(early, cafe), null, 'a chapter-6 player meets them later');
  const p = only(progressed(7), 'couple');
  assert.equal(pickArc(p, dailyLike(p, 3, ['cutter', 'squatter'], 'cafe'))?.arc.id, 'couple');
  assert.equal(pickArc(p, dailyLike(p, 3, ['cutter'], 'cafe')), null);
  // main story: 8-6 筆電森林 is the café shift; other chapter-8 shifts have no 一杯坐整天
  p.stars = { ...progressed(8).stars };
  assert.equal(pickArc(p, buildShiftConfig(p, '8-6'))?.arc.id, 'couple');
  for (const id of ['8-1', '8-2', '8-3', '8-4', '8-5']) assert.equal(pickArc(p, buildShiftConfig(p, id)), null, id);
  // the last stage needs a chapter-6 day (8-6 is chapter 8, fine)
  p.arcs.couple = { stage: 3, seen: 3, at: 0 }; p.stats.shifts = 10;
  assert.equal(pickArc(p, dailyLike(p, 5, ['squatter'], 'cafe')), null);
  assert.equal(pickArc(p, buildShiftConfig(p, '8-6'))?.stage, 3);
});

test('a new arc from first card to payoff: gap between visits, cosmetic + achievement, then all eight → 常客全員到齊', () => {
  const p = progressed(6);
  const arc: ArcDef = ARC_BY_ID.lotto;
  // the others are not finished yet: the least-progressed regular goes first, so pin 阿公 by finishing the rest later
  only(p, 'lotto');
  for (let s = 0; s < 4; s++) {
    const cfg = buildSpecialConfig(p, 'newyear');
    const pick = pickArc(p, cfg);
    assert.equal(pick?.arc.id, 'lotto', `stage ${s}`); assert.equal(pick!.stage, s);
    assert.ok(takePreScene(p, pick!)?.length);
    assert.equal(takePreScene(p, pick!), null);
    // a lost shift, or one where he was never dealt with, does not count
    assert.equal(finishArc(p, pick!, result({ won: false, handled: { lottery: 1 } })).advanced, false);
    assert.equal(finishArc(p, pick!, result({ handled: { change: 1 } })).advanced, false);
    const out = finishArc(p, pick!, result({ handled: { lottery: 1 } }));
    assert.ok(out.advanced); assert.deepEqual(out.post, arc.stages[s].post);
    assert.equal(out.completed, s === 3);
    if (s < 3) {
      assert.equal(pickArc(p, buildSpecialConfig(p, 'newyear')), null, 'he does not come straight back');
      p.stats.shifts += ARC_GAP;
    } else assert.equal(out.cosmetic, 'hat_lotto');
  }
  assert.ok(arcDone(p, 'lotto'));
  assert.ok(p.shop.owned.includes('hat_lotto'));
  const ach = unlockedAchievements(p);
  assert.ok(ach.includes('ARC_LOTTO'));
  // `only` marked the other seven finished in arcs, so all eight are done
  assert.ok(ach.includes('ARC_ALL'));
  const q = progressed(6); q.arcs = { lotto: p.arcs.lotto };
  assert.ok(!unlockedAchievements(q).includes('ARC_ALL'), 'one finished story is not all of them');
  assert.ok(!unlockedAchievements(q).includes('ARC_BAGS'));
  // never sold, kept by the shop sanitizer
  const r = newProfile(); r.wallet = 99999;
  for (const id of ['hat_lotto', 'tag_coin', 'mascot_dragon', 'uni_love']) assert.deepEqual(buyCosmetic(r, id), { ok: false, why: 'story' });
  assert.deepEqual(sanitizeShop({ owned: ['hat_lotto', 'tag_coin', 'mascot_dragon', 'uni_love', 'nope'], equipped: { hat: 'hat_lotto', mascot: 'mascot_dragon' } }).owned, ['hat_lotto', 'tag_coin', 'mascot_dragon', 'uni_love']);
});

test('old saves: arcs from before round 30 keep their progress, the new regulars start fresh, junk is cleaned', () => {
  const raw = JSON.parse(JSON.stringify({ ...progressed(5), arcs: { auntie: { stage: 2, seen: 3, at: 7 }, kai: { stage: 4, seen: 4, at: 9 } } }));
  const p = sanitizeProfile(raw);
  assert.deepEqual(p.arcs.auntie, { stage: 2, seen: 3, at: 7 });
  assert.deepEqual(p.arcs.kai, { stage: 4, seen: 4, at: 9 });
  for (const id of NEW) { assert.equal(p.arcs[id], undefined); assert.deepEqual(arcState(p, id), { stage: 0, seen: 0, at: 0 }); }
  // garbage for the new ids is clamped; unknown ids are dropped
  const q = sanitizeProfile({ ...raw, arcs: { lotto: { stage: 99, seen: -4, at: 'x' }, couple: { stage: 1.7, seen: 9 }, ghost: { stage: 2 } } });
  assert.deepEqual(q.arcs.lotto, { stage: 4, seen: 4, at: 0 });
  assert.deepEqual(q.arcs.couple, { stage: 1, seen: 2, at: 0 });
  assert.equal(q.arcs.ghost, undefined);
  // a save with no arcs at all (before round 22)
  const { arcs: _drop, ...older } = raw;
  assert.deepEqual(sanitizeProfile(older).arcs, {});
});
