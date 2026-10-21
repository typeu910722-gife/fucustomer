// 第六輪平衡 (docs/BALANCE.md「第六輪」): weekly / daily challenge tuning from 2026-W44 / 2026-10-22 on.
// (1) every week and date before the cut-off replays exactly as before (fingerprint of plan + config, taken from the
//     code before this round), (2) the generators never produce the excluded combos, (3) the new rules apply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, DAILY_TUNE, DAILY_TUNE_R22, ROUND6_DATE, buildDailyConfig, dailyPlan, newProfile, type CareerProfile } from '../shared/career.ts';
import {
  ROUND6_WEEK, SPECIAL_EXCLUDE, TWIST_TUNE, TWIST_TUNE_R22, WEEKLY_STORE, buildWeeklyConfig, isoWeek, weeklyPlan,
} from '../shared/weekly.ts';
import { NEWYEAR } from '../shared/genkarens.ts';

/** Players at the start of chapters 1, 2, 3, 5, 7 and 10 (progress decides the daily / weekly difficulty). */
function players(): CareerProfile[] {
  return [1, 2, 3, 5, 7, 10].map(n => {
    const p = newProfile();
    p.level = CHAPTERS[n - 1].minLevel;
    for (const c of CHAPTERS) if (c.n < n) for (const s of c.shifts) p.stars[s.id] = 1;
    return p;
  });
}
function fnv(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const days = (from: string, to: string) => { const out: string[] = []; for (let t = new Date(from + 'T12:00:00Z'); t.toISOString().slice(0, 10) <= to; t.setUTCDate(t.getUTCDate() + 1)) out.push(t.toISOString().slice(0, 10)); return out; };
const weeksOf = (dates: string[]) => [...new Set(dates.map(d => isoWeek(new Date(d + 'T12:00:00'))))];
/** Plan + full shift config of every past week (2025-W01 … 2026-W43) for each player, as one hash. */
function weeklyFingerprint() {
  const ps = players();
  return fnv(weeksOf(days('2025-01-01', '2026-10-25')).map(w => JSON.stringify([weeklyPlan(w), ...ps.map(p => buildWeeklyConfig(p, w))])).join('\n'));
}
/** Plan + config of every past daily (2025-01-01 … 2026-10-21) for each player, as one hash. */
function dailyFingerprint() {
  const ps = players();
  return fnv(days('2025-01-01', '2026-10-21').map(d => JSON.stringify(ps.map(p => [dailyPlan(p, d), buildDailyConfig(p, d)]))).join('\n'));
}

test('round 6: past weeks and dates replay exactly as before (hashes taken from the code before this round)', () => {
  assert.equal(weeksOf(days('2025-01-01', '2026-10-25')).at(-1), '2026-W43');
  assert.ok('2026-W43' < ROUND6_WEEK && '2026-10-21' < ROUND6_DATE);
  assert.equal(weeklyFingerprint(), '69c16f96');
  assert.equal(dailyFingerprint(), '3ccbecc');
  // the old numbers are kept next to the new ones
  assert.deepEqual(TWIST_TUNE_R22.anniversary, { spawnMul: 0.6, maxAdd: 8, firstEvent: 25, eventEvery: 32, goal: 1.12 });
  assert.deepEqual(DAILY_TUNE_R22.streamers, { extraKarens: 1, firstKaren: 15, karenEvery: 1, goal: 0.9 });
});

test('round 6: the weekly generator never puts a special day on a twist it is excluded from', () => {
  let typhoonNights = 0, specials = 0;
  for (const w of weeksOf(days('2026-10-26', '2031-12-31'))) {
    assert.ok(w >= ROUND6_WEEK);
    const plan = weeklyPlan(w);
    if (!plan.special) continue;
    specials++; if (plan.special === 'typhoon') typhoonNights++;
    assert.ok(!SPECIAL_EXCLUDE[plan.special].includes(plan.twist), `${w}: ${plan.special} on ${plan.twist}`);
  }
  // special days still come up about two weeks in seven, both kinds
  assert.ok(specials > 50 && typhoonNights > 10, `${specials} ${typhoonNights}`);
});

test('round 6: new weekly / daily rules apply from the cut-off on', () => {
  const ps = players();
  // 手搖飲店 weeks: both tills, at most half the customers want a made drink (also in a 寒流來襲 week), target ×0.9
  let boba = 0, cold = 0;
  for (const w of weeksOf(days('2026-10-26', '2031-12-31'))) {
    const plan = weeklyPlan(w);
    if (plan.map !== 'boba') continue;
    boba++; if (plan.twist === 'coldfront') cold++;
    for (const p of ps) {
      const cfg = buildWeeklyConfig(p, w);
      assert.equal(cfg.register2, true, w);
      assert.ok(cfg.foodChance <= WEEKLY_STORE.boba.foodChance!, w);
    }
  }
  assert.ok(boba > 5 && cold > 0, `${boba} ${cold}`);
  // 週年慶 / 網紅週 numbers come from TWIST_TUNE
  const anniv = weeksOf(days('2026-10-26', '2028-12-31')).find(w => weeklyPlan(w).twist === 'anniversary' && !weeklyPlan(w).special)!;
  const cfg = buildWeeklyConfig(ps[3], anniv);
  assert.equal(cfg.eventEvery, TWIST_TUNE.anniversary.eventEvery);
  // 全是直播主 days: streamers every 1.4 × the shift's karen interval, first at 25 s
  const sd = days(ROUND6_DATE, '2027-06-30').find(d => dailyPlan(ps[3], d).mods.includes('streamers'))!;
  const dc = buildDailyConfig(ps[3], sd);
  assert.deepEqual(dc.karens, ['streamer']); assert.equal(dc.firstKaren, DAILY_TUNE.streamers.firstKaren);
  // 跨年夜: rush and drunk-spill timing
  assert.deepEqual([NEWYEAR.rushEvery, NEWYEAR.firstSpill, NEWYEAR.spillEvery], [2.0, 12, 22]);
});
