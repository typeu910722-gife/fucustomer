// 特殊營業日 (round 27): 颱風夜 and 跨年夜 as a free-play option. The rules themselves live in genkarens.ts
// (applySpecialDay) and sim.ts (cfg.special); daily and weekly challenges roll them in as rotating modifiers
// (career.ts dailyPlan, weekly.ts weeklyPlan). Here: the free-play shift config and its reward.
// Pure data + functions (unit-tested); progress is the profile's `special` record (career.ts).
import {
  CHAPTERS, type CareerProfile, type Reward, type ShiftConfig, type ShiftResult, addExp, buildShiftConfig, chapterUnlocked, dailyUnlocked, starsFor,
} from './career.ts';
import { addHandled } from './karendex.ts';
import { SPECIAL_DAYS, type SpecialId, applySpecialDay, isSpecialId } from './genkarens.ts';

export const SPECIAL_SHIFT_PREFIX = 'sp-';
export const SPECIAL_LENGTH = 180;
/** Shift id of a special day, e.g. "sp-typhoon". */
export const specialShiftId = (id: SpecialId) => SPECIAL_SHIFT_PREFIX + id;
/** The special day of a shift id, or null. */
export function specialOfShift(shiftId: string): SpecialId | null {
  const id = shiftId.startsWith(SPECIAL_SHIFT_PREFIX) ? shiftId.slice(SPECIAL_SHIFT_PREFIX.length) : '';
  return isSpecialId(id) ? id : null;
}
/** Opens together with the daily challenge (after chapter 1). */
export const specialUnlocked = (p: CareerProfile) => dailyUnlocked(p);
/** Reward on the first win of each special day every (local) day: points + EXP; the very first win of each pays a bonus. */
export const SPECIAL_FIRST_BONUS = 200;

function openChapter(p: CareerProfile) { let open = 1; for (const c of CHAPTERS) if (chapterUnlocked(p, c.n).ok) open = c.n; return open; }

/** A 180-second shift in the convenience store, difficulty following the player's progress (like the daily). */
export function buildSpecialConfig(p: CareerProfile, id: SpecialId): ShiftConfig {
  const open = openChapter(p);
  const ch = CHAPTERS[Math.min(open, 6) - 1];
  const base = ch.shifts[Math.min(2, ch.shifts.length - 1)];
  const cfg = buildShiftConfig(p, base.id);
  const d = SPECIAL_DAYS[id];
  cfg.boss = false; cfg.map = 'convenience';
  cfg.id = specialShiftId(id); cfg.title = `特殊營業日・${d.icon}${d.name}`; cfg.length = SPECIAL_LENGTH;
  if (!cfg.karens.length) cfg.karens = ['cutter'];
  cfg.maxKarens = Math.max(2, cfg.maxKarens);
  const mul = applySpecialDay(cfg, id);
  // early on (chapters 1–2: no grabbing yet, fewer upgrades) the special day's extra karens weigh more: a gentler target
  cfg.goal = Math.round(base.goal * (SPECIAL_LENGTH / base.length) * mul * (open <= 2 ? 0.85 : 1) / 5) * 5;
  cfg.hints = [d.rules, '每天第一次達標可領獎勵；第一次通關另有獎金。'];
  return cfg;
}

/** Pays a finished special-day shift (`date` = local date of the run). */
export function applySpecialResult(p: CareerProfile, r: ShiftResult, date: string): Reward {
  addHandled(p.dex, r.handled);
  const id = specialOfShift(r.shiftId);
  const stars = starsFor(r);
  p.stats.shifts++; if (r.won) p.stats.wins++;
  p.stats.served += r.served; p.stats.ejected += r.ejected; p.stats.karens += r.karensResolved; p.stats.revenue += r.revenue;
  if (!id) return { stars, exp: 0, wallet: 0, levels: [], firstClear: false, newBest: false };
  const prev = p.special[id];
  const st = prev && prev.date === date ? prev : { date, best: 0, rewarded: false, wins: prev?.wins ?? 0 };
  const newBest = r.revenue > st.best;
  st.best = Math.max(st.best, r.revenue);
  const already = st.rewarded;
  let exp = 0, wallet = 0, firstClear = false;
  if (r.won) {
    firstClear = st.wins === 0;
    st.wins++;
    if (!already) {
      st.rewarded = true;
      exp = Math.round(CHAPTERS[openChapter(p) - 1].baseExp * (0.9 + 0.15 * stars));
      wallet = Math.round(r.revenue * 0.2 + 90 + stars * 30);
    }
    if (firstClear) wallet += SPECIAL_FIRST_BONUS;
  }
  p.special[id] = st;
  p.wallet += wallet;
  const levels = addExp(p, exp);
  return { stars, exp, wallet, levels, firstClear, newBest, daily: { already, streak: 0 } };
}
