// 每週挑戰: one challenge per ISO week, the same for everyone (seeded from the week, computed on the device — no server).
// Each week has a twist (停電週、網紅週、颱風天、週年慶、寒流來襲), a store and three goals; each goal pays 薪資點數 once per
// week, and clearing all three earns that week's badge on the 高級社畜證照. Pure data + functions (unit-tested).
import {
  CHAPTERS, type CareerProfile, type Food, type Reward, type ShiftConfig, type ShiftEvent, type ShiftResult,
  STORE_RULES, type StoreRule, WEEK_RE, addExp, buildShiftConfig, chapterUnlocked, dailyUnlocked, starsFor,
} from './career.ts';
import { addHandled } from './karendex.ts';
import { GEN_KINDS, type GenKind } from './constants.ts';
import { SPECIAL_DAYS, SPECIAL_IDS, applySpecialDay, type SpecialId } from './genkarens.ts';
import { MAPS } from './maps/index.ts';

export const WEEKLY_ID = 'weekly';
export const WEEKLY_LENGTH = 180;

export type TwistId = 'blackout' | 'influencer' | 'typhoon' | 'anniversary' | 'coldfront';
// desc follows TWIST_TUNE (2026-W44 on; 2026-W43 is a 颱風天 week, whose numbers did not change)
export const WEEKLY_TWISTS: Record<TwistId, { name: string; icon: string; desc: string; badge: string }> = {
  blackout: { name: '停電週', icon: '🔦', desc: '台電說是「區域性短暫供電異常」。每 20 秒就可能停電一次，目標 -12%', badge: '黑暗中的收銀員' },
  influencer: { name: '網紅週', icon: '🤳', desc: '網紅打卡熱潮：直播客特別多、同時多一位，目標 -5%', badge: '不上鏡的店員' },
  typhoon: { name: '颱風天', icon: '🌀', desc: '停班不停課……也不停店。客人少，但每個人都滴著水進門，髒污 ×2.2，目標 -28%', badge: '颱風天照常營業' },
  anniversary: { name: '週年慶', icon: '🎉', desc: '全館週年慶：人潮不斷、尖峰一波接一波，目標不變', badge: '週年慶倖存者' },
  coldfront: { name: '寒流來襲', icon: '🥶', desc: '冷到大家只想喝熱的：八成客人要現做餐點，目標 +10%', badge: '寒流中的熱飲' },
};
export const TWIST_IDS = Object.keys(WEEKLY_TWISTS) as TwistId[];
/** The descriptions weeks before 2026-W44 were shown with (their in-shift hint stays word for word the same). */
const TWIST_DESC_R22: Partial<Record<TwistId, string>> = {
  influencer: '網紅打卡熱潮：直播客特別多、奧客來得更快、同時多一位，目標 -5%',
  anniversary: '全館週年慶：人潮不斷、尖峰一波接一波，目標 +12%',
};
/** A week's twist description (the old wording for weeks before ROUND6_WEEK). */
export function twistDesc(twist: TwistId, week: string) { return (week < ROUND6_WEEK ? TWIST_DESC_R22[twist] : undefined) ?? WEEKLY_TWISTS[twist].desc; }

export interface WeeklyGoal { id: string; text: string; points: number; check: (r: ShiftResult) => boolean }
/** The second goal follows the twist. */
const TWIST_GOAL: Record<TwistId, Omit<WeeklyGoal, 'points'>> = {
  blackout: { id: 'calm', text: '停電也不能亂：混亂度低於 50%', check: r => r.chaos < 50 },
  influencer: { id: 'film', text: '制止 2 位以上直播客', check: r => (r.handled?.streamer ?? 0) >= 2 },
  typhoon: { id: 'mop', text: '清掉 5 灘以上髒污', check: r => r.cleaned >= 5 },
  anniversary: { id: 'serve', text: '服務 26 位以上客人', check: r => r.served >= 26 },
  coldfront: { id: 'warm', text: '生氣離開的客人不超過 2 位', check: r => r.angryLeft <= 2 },
};
/** The third goal is drawn from this pool (never the same check as the twist goal). */
const EXTRA_GOALS: Omit<WeeklyGoal, 'points'>[] = [
  { id: 'clean', text: '奧客零失誤', check: r => r.karensFailed === 0 },
  { id: 'rating', text: '口碑維持 ★3.0 以上', check: r => r.rating >= 3 },
  { id: 'combo', text: '一班內連送 2 位奧客', check: r => r.maxCombo >= 2 },
  { id: 'happy', text: '生氣離開的客人不超過 1 位', check: r => r.angryLeft <= 1 },
];
export const GOAL_POINTS = [60, 80, 100];
export const BADGE_POINTS = 150;

/** ISO-8601 week of a local calendar date, e.g. "2026-W43" (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

export function weeklySeed(week: string) { let h = 2166136261; for (const ch of 'fucustomer-weekly-' + week) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function seededRng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** From this ISO week on, a week may also be a 特殊營業日 and always brings one 通用新奧客 (earlier weeks keep their plans). */
export const ROUND27_WEEK = '2026-W44';
/** From this ISO week on (round 6, docs/BALANCE.md「第六輪」) twists use TWIST_TUNE and WEEKLY_STORE / SPECIAL_EXCLUDE; earlier weeks keep TWIST_TUNE_R22. */
export const ROUND6_WEEK = '2026-W44';

/**
 * Twists a 特殊營業日 is never combined with (weeks from ROUND6_WEEK on; docs/BALANCE.md「第六輪」). 颱風夜 has few
 * customers, so it contradicts 週年慶's crowds; on a 網紅週 the streamer chase leaves the leaking floor unmopped (一般
 * 75–92%); 颱風天 is already a rainy week. Such a week gets 跨年夜 instead.
 */
export const SPECIAL_EXCLUDE: Record<SpecialId, readonly TwistId[]> = { typhoon: ['typhoon', 'anniversary', 'influencer'], newyear: [] };

/** Twist, store and goals for a week — the same for every player. */
export function weeklyPlan(week: string): { week: string; twist: TwistId; map: string; goals: WeeklyGoal[]; special?: SpecialId; gen?: GenKind } {
  const rng = seededRng(weeklySeed(week));
  const twist = TWIST_IDS[Math.floor(rng() * TWIST_IDS.length)];
  // 寒流來襲 needs a store that makes something hot
  const maps = twist === 'coldfront' ? MAPS.filter(m => m.coffee || m.meal) : MAPS;
  const map = maps[Math.floor(rng() * maps.length)].id;
  const tg = TWIST_GOAL[twist];
  const pool = EXTRA_GOALS.filter(g => !(tg.id === 'warm' && g.id === 'happy'));
  const extra = pool[Math.floor(rng() * pool.length)];
  const goals: WeeklyGoal[] = [
    { id: 'goal', text: '達成營業額目標', check: (r: ShiftResult) => r.won },
    tg, extra,
  ].map((g, i) => ({ ...g, points: GOAL_POINTS[i], check: (r: ShiftResult) => r.won && g.check(r) })); // every goal needs a finished (won) shift
  // round 27: a separate seeded roll (twist, store and goals above are unchanged): about two weeks in seven also run
  // as a 特殊營業日, and every week brings one of the general karens
  if (WEEK_RE.test(week) && week >= ROUND27_WEEK) {
    const r2 = seededRng(weeklySeed(week + '#r27'));
    let special: SpecialId | undefined;
    if (r2() < 2 / 7) {
      special = SPECIAL_IDS[Math.floor(r2() * SPECIAL_IDS.length)];
      if (special === 'typhoon' && twist === 'typhoon') special = 'newyear'; // already a rainy week
      // round 6: a 特殊營業日 never lands on a twist it does not go with (SPECIAL_EXCLUDE)
      if (special && week >= ROUND6_WEEK && SPECIAL_EXCLUDE[special].includes(twist)) special = special === 'typhoon' && !SPECIAL_EXCLUDE.newyear.includes(twist) ? 'newyear' : undefined;
    }
    const gen = GEN_KINDS[Math.floor(r2() * GEN_KINDS.length)];
    return { week, twist, map, goals, ...(special ? { special } : {}), gen };
  }
  return { week, twist, map, goals };
}

/** Which of the week's goals this result met. */
export function weeklyGoalsMet(week: string, r: ShiftResult): boolean[] { return weeklyPlan(week).goals.map(g => g.check(r)); }

/** Opens with the daily challenge (after chapter 1). */
export const weeklyUnlocked = (p: CareerProfile) => dailyUnlocked(p);

export interface TwistTune {
  /** Revenue target multiplier. */
  goal: number;
  /** blackout / anniversary: first event (s) and seconds between events. */
  firstEvent?: number; eventEvery?: number;
  /** influencer: extra karens at once, karen interval ×, first karen at most (s). */
  extraKarens?: number; karenEvery?: number; firstKaren?: number;
  /** typhoon / anniversary: customer interval ×, max customers − / +, spills ×. */
  spawnMul?: number; maxDrop?: number; maxAdd?: number; spillMul?: number;
  /** coldfront: share of customers who want made-to-order food. */
  foodChance?: number;
}
/** The twists as they were up to 2026-W43 (round 22). Kept as-is so past weeks replay exactly the same. */
export const TWIST_TUNE_R22: Readonly<Record<TwistId, Readonly<TwistTune>>> = {
  blackout: { firstEvent: 12, eventEvery: 20, goal: 0.88 },
  influencer: { extraKarens: 1, karenEvery: 0.75, firstKaren: 15, goal: 0.95 },
  typhoon: { spawnMul: 1.45, maxDrop: 2, spillMul: 2.2, goal: 0.72 },
  anniversary: { spawnMul: 0.6, maxAdd: 8, firstEvent: 25, eventEvery: 32, goal: 1.12 },
  coldfront: { foodChance: 0.8, goal: 1.1 },
};
/** The twists from ROUND6_WEEK on (calibrated with `scripts/balance.ts --scan weekly`, docs/BALANCE.md「第六輪」). */
export const TWIST_TUNE: Record<TwistId, TwistTune> = {
  blackout: { firstEvent: 12, eventEvery: 20, goal: 0.88 },
  // handled properly a streamer is chased round the store: karens no longer come faster (×0.75 → ×1), the first at 25 s
  influencer: { extraKarens: 1, karenEvery: 1, firstKaren: 25, goal: 0.95 },
  typhoon: { spawnMul: 1.45, maxDrop: 2, spillMul: 2.2, goal: 0.72 },
  // 一般 67% at chapter 5 (chaos): a little less crowded, rushes every 45 s from 40 s, target unchanged (was +12%)
  anniversary: { spawnMul: 0.75, maxAdd: 5, firstEvent: 40, eventEvery: 45, goal: 1.0 },
  coldfront: { foodChance: 0.8, goal: 1.1 },
};

/** Store rules for the weeks from ROUND6_WEEK on (shared with the daily challenge; see STORE_RULES in career.ts). */
export type WeeklyStoreRule = StoreRule;
export const WEEKLY_STORE: Record<string, WeeklyStoreRule> = STORE_RULES;

/** The twist applied to a shift config (exported so tests can check each one). `tune` = which week's numbers. */
export function applyTwist(cfg: ShiftConfig, twist: TwistId, tune: Readonly<Record<TwistId, Readonly<TwistTune>>> = TWIST_TUNE_R22): number {
  const t = tune[twist];
  if (twist === 'blackout') { cfg.events = [...new Set([...cfg.events, 'outage' as ShiftEvent])]; cfg.firstEvent = t.firstEvent!; cfg.eventEvery = t.eventEvery!; }
  if (twist === 'influencer') { cfg.karens = ['streamer', ...cfg.karens.filter(k => k !== 'streamer'), 'streamer']; cfg.maxKarens += t.extraKarens!; cfg.karenEvery *= t.karenEvery!; cfg.firstKaren = Math.min(cfg.firstKaren, t.firstKaren!); }
  if (twist === 'typhoon') { cfg.spawnEvery *= t.spawnMul!; cfg.maxCustomers = Math.max(6, cfg.maxCustomers - t.maxDrop!); cfg.spillMul = t.spillMul!; }
  if (twist === 'anniversary') { cfg.spawnEvery *= t.spawnMul!; cfg.maxCustomers += t.maxAdd!; cfg.events = [...new Set([...cfg.events, 'rush' as ShiftEvent])]; cfg.firstEvent = t.firstEvent!; cfg.eventEvery = t.eventEvery!; }
  if (twist === 'coldfront') { cfg.foods = [...new Set<Food>([...cfg.foods, 'coffee', 'meal'])]; cfg.foodChance = t.foodChance!; }
  return t.goal;
}

export function buildWeeklyConfig(p: CareerProfile, week: string): ShiftConfig {
  const plan = weeklyPlan(week);
  let open = 1; for (const c of CHAPTERS) if (chapterUnlocked(p, c.n).ok) open = c.n;
  // the store chapters (7+) have their own goals; difficulty follows the convenience-store chapters, capped at 6
  const ch = CHAPTERS[Math.min(open, 6) - 1];
  const base = ch.shifts[Math.min(2, ch.shifts.length - 1)];
  const cfg = buildShiftConfig(p, base.id);
  const mapDef = MAPS.find(m => m.id === plan.map)!;
  const tw = WEEKLY_TWISTS[plan.twist];
  cfg.boss = false; // chapter 6's base shift is the 奧客之王 fight; the weekly is a normal (twisted) day
  cfg.id = WEEKLY_ID; cfg.title = `每週挑戰・${tw.icon}${tw.name}・${mapDef.icon}${mapDef.name}`; cfg.map = plan.map; cfg.length = WEEKLY_LENGTH;
  if (!cfg.karens.length) cfg.karens = ['cutter'];
  // store-specific karens only appear in their own store; the store's own karen joins in
  const specific = new Set(MAPS.flatMap(m => m.karens ?? []));
  cfg.karens = [...new Set([...cfg.karens.filter(k => !specific.has(k)), ...(mapDef.karens ?? [])])];
  cfg.maxKarens = Math.max(1, cfg.maxKarens);
  const r6 = WEEK_RE.test(week) && week >= ROUND6_WEEK;
  let mul = applyTwist(cfg, plan.twist, r6 ? TWIST_TUNE : TWIST_TUNE_R22);
  if (plan.special) mul *= applySpecialDay(cfg, plan.special);
  if (plan.gen) cfg.karens = [...new Set([...cfg.karens, plan.gen])];
  const rule = r6 ? WEEKLY_STORE[plan.map] : undefined;
  if (rule?.register2) cfg.register2 = true;
  if (rule?.foodChance !== undefined) cfg.foodChance = Math.min(cfg.foodChance, rule.foodChance);
  cfg.goal = Math.round(base.goal * (WEEKLY_LENGTH / base.length) * mul * (mapDef.goalScale ?? 1) * (rule?.goal ?? 1) / 5) * 5;
  cfg.hints = [`${tw.icon} ${tw.name}：${twistDesc(plan.twist, week)}`, ...(plan.special ? [SPECIAL_DAYS[plan.special].rules] : []), `本週目標：${plan.goals.map(g => g.text).join('／')}`];
  if (plan.special) cfg.title += `・${SPECIAL_DAYS[plan.special].icon}${SPECIAL_DAYS[plan.special].name}`;
  cfg.weekly = { week, twist: plan.twist };
  return cfg;
}

/** Badge shown for a week (icon + name come from that week's twist). */
export function weekBadge(week: string) { const t = WEEKLY_TWISTS[weeklyPlan(week).twist]; return { week, icon: t.icon, name: t.badge }; }

/** Pays a finished weekly run: each goal met for the first time this week pays 薪資點數; all three → badge + bonus. */
export function applyWeekly(p: CareerProfile, r: ShiftResult): Reward {
  addHandled(p.dex, r.handled);
  const week = r.week && WEEK_RE.test(r.week) ? r.week : '';
  if (p.weekly.week !== week) p.weekly = { ...p.weekly, week, done: 0, best: 0 };
  const stars = starsFor(r);
  const newBest = r.revenue > p.weekly.best;
  p.weekly.best = Math.max(p.weekly.best, r.revenue); p.weekly.plays++;
  p.stats.shifts++; if (r.won) p.stats.wins++;
  p.stats.served += r.served; p.stats.ejected += r.ejected; p.stats.karens += r.karensResolved; p.stats.revenue += r.revenue;
  const plan = weeklyPlan(week);
  const met = plan.goals.map(g => g.check(r));
  const newly: number[] = [];
  let wallet = 0;
  met.forEach((ok, i) => { if (ok && !(p.weekly.done & (1 << i))) { p.weekly.done |= 1 << i; newly.push(i); wallet += plan.goals[i].points; } });
  const badge = p.weekly.done === 7 && !!week && !p.weekly.badges.includes(week);
  if (badge) { p.weekly.badges = [...p.weekly.badges, week].sort().slice(-520); wallet += BADGE_POINTS; }
  // EXP: about one shift of the player's newest chapter the first time the target is reached this week
  let open = 1; for (const c of CHAPTERS) if (chapterUnlocked(p, c.n).ok) open = c.n;
  const exp = newly.includes(0) ? Math.round(CHAPTERS[open - 1].baseExp * (1 + 0.15 * stars)) : 0;
  p.wallet += wallet;
  const levels = addExp(p, exp);
  return { stars, exp, wallet, levels, firstClear: false, newBest, weekly: { week, met, newly, badge } };
}
