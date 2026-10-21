// 通用新奧客 (round 27) and 特殊營業日 helpers shared by the simulation, the bot and the client.
// Pure data + functions (no DOM, no sim state) so tests and every side compute exactly the same thing.
import { ENTRANCE, STORE_D } from './map.ts';

/** 免費袋子阿伯 can only be stopped once he is heading out and close to the door (sim, bot and client agree). */
export function bagmanAtDoor(c: { kind: string; state: string; x: number; z: number; resolved: boolean }) {
  return c.kind === 'bagman' && !c.resolved && c.state === 'toExit' && c.z > STORE_D - 3.4 && Math.abs(c.x - ENTRANCE.x) < 3.4;
}

// ---------------- tuning numbers (balance harness: docs/BALANCE.md「第五輪」) ----------------
/**
 * Timers and penalties of the four general karens (read by shared/sim.ts). `life` = seconds before the karen gets
 * away with it (at the till for 對獎／找零, wandering for the 阿伯, in the restroom for the 廁所大隊).
 */
export const GEN_TUNE = {
  lottery: { life: 45 },
  /** wrongCost / wrongRating = seconds she takes off and the rating lost when handed the wrong change (or too slowly). */
  change: { life: 32, wrongCost: 10, wrongRating: 0.03 },
  /** knock = seconds between fistfuls of free bags (and one item off a shelf); exits after `life` s or `bagMax` items. */
  bagman: { life: 28, knock: 3.5, bagMax: 5 },
  /** flush = seconds between restroom puddles (sped up by the number of members inside). */
  toilet: { life: 60, flush: 5 },
};
/**
 * Karens the 保全 (guard gear) leaves alone: 發票對獎魔人 and 找零計較姐 are paying customers holding up the till, not
 * troublemakers — and the registers stand inside the guard's 5.5 m round by the door, so otherwise he would show nearly
 * every one of them out before anyone got to escort him / count her change (docs/BALANCE.md「第五輪」).
 */
export const GUARD_SKIP: readonly string[] = ['lottery', 'change'];
/** 颱風夜 numbers (read by shared/sim.ts): noodle hoarders, roof leaks, how much puddles weigh on the mood. */
export const TYPHOON = {
  /** Share of ordinary customers who stock up on the snack line, and how many they take (min + 0…spread−1). */
  hoardShare: 0.45, hoardMin: 3, hoardSpread: 2,
  /** Seconds between roof leaks (every + 0…spread). */
  leakEvery: 24, leakSpread: 8,
  /** Puddle effect on chaos / rating (everyone expects a wet floor tonight). */
  wet: 0.55,
  /** Fewer customers: spawn interval ×spawnMul, max customers −maxDrop (at least 6); spills ×spillMul; an outage every outageEvery s. */
  spawnMul: 1.5, maxDrop: 2, spillMul: 1.8, outageEvery: 24,
  /**
   * Instant noodles piled on the snack shelf before opening (may exceed the shelf's capacity: a stack in front of it).
   * The hoarders empty a 6-item box every few customers; without this pile the line stood empty ~110 s of 180.
   */
  prestock: 18,
};

// ---------------- 找零計較姐: the exact-change quick-time prompt ----------------
/** Coins a till hands out, largest first. */
export const COINS = [50, 10, 5, 1] as const;
/** How much change she is owed (stable per customer: from her look number), $13–$98. */
export function changeDue(look: number) { return 13 + (Math.abs(Math.floor(look)) * 37) % 86; }
/** The fewest coins making `n` (count per coin, same order as COINS). */
export function coinsFor(n: number): number[] {
  let left = Math.max(0, Math.floor(n));
  return COINS.map(c => { const k = Math.floor(left / c); left -= k * c; return k; });
}
export const coinTotal = (counts: number[]) => counts.reduce((s, k, i) => s + k * COINS[i], 0);
/** "50×1＋10×2＋1×3" (zero counts left out). */
export function coinText(counts: number[]) { return counts.map((k, i) => (k ? `${COINS[i]}×${k}` : '')).filter(Boolean).join('＋') || '0'; }

/**
 * The three choices shown in the prompt: the right handful and two that are a little off (one short, one over).
 * Their order depends on the look number, so the right answer is not always in the same place.
 */
export function changeOptions(look: number): { counts: number[]; total: number; text: string; ok: boolean }[] {
  const due = changeDue(look);
  const right = coinsFor(due);
  const L = Math.abs(Math.floor(look));
  const short = coinsFor(due - [1, 5][L % 2]), over = coinsFor(due + [5, 1, 2][L % 3]);
  const opts = [right, short, over].map((counts, i) => ({ counts, total: coinTotal(counts), text: coinText(counts), ok: i === 0 }));
  const ans = changeAnswer(look);
  const out = [opts[1], opts[2]];
  out.splice(ans, 0, opts[0]);
  return out;
}
/** Index (0–2) of the right handful in changeOptions(look). */
export function changeAnswer(look: number) { return Math.abs(Math.floor(look) * 7 + 3) % 3; }

// ---------------- 特殊營業日: shift clock of the 跨年夜 ----------------
/** 跨年夜 runs 21:00 → 00:30 (minutes, can pass 24:00); the big rush starts 23:50 and the countdown ends at midnight. */
export const SPECIAL_CLOCK = { from: 21 * 60, to: 24 * 60 + 30, rush: 23 * 60 + 50, midnight: 24 * 60, rushEnd: 24 * 60 + 6 };

// ---------------- 特殊營業日: what each special day changes ----------------
export type SpecialId = 'typhoon' | 'newyear';
export interface SpecialDayDef {
  name: string; icon: string;
  /** One line for menus / the daily & weekly cards; `rules` = the longer in-shift hint. */
  desc: string; rules: string;
  /** Karens that come with the day (on top of the shift's own, unless it is a one-karen-type day). */
  karens: ('lottery' | 'change' | 'bagman' | 'toilet')[];
  /** Revenue target multiplier (calibrated with the balance harness, see docs/BALANCE.md「第四輪」). */
  goal: number;
}
export const SPECIAL_DAYS: Record<SpecialId, SpecialDayDef> = {
  typhoon: {
    name: '颱風夜', icon: '🌀',
    desc: '店裡變成避難所：客人少、地上一直濕、屋頂漏水、電燈常閃，大家都在囤泡麵',
    rules: '颱風夜：客人比較少，但將近一半的人一次掃 3–4 包零食架上的東西（囤泡麵）。開店前零食架先多堆了一批泡麵，賣完就得一直補；屋頂會漏水、停電次數多但很短（大家知道外面在下雨，地上濕比較不會被嫌）。借廁所大隊也來避難了。',
    karens: ['toilet', 'bagman'], goal: 0.85,
  },
  newyear: {
    name: '跨年夜', icon: '🎆',
    desc: '21:00 開到 00:30：23:50 湧進倒數人潮、午夜放煙火，奧客都喝了一點',
    rules: '跨年夜：時鐘從 21:00 走到 00:30。23:50 開始倒數人潮（收銀台頂住！），午夜煙火讓客人心情大好。奧客都醉了：走路搖晃、要講久一點才聽得進去、還會打翻飲料。',
    karens: ['lottery', 'change'], goal: 1.0,
  },
};
export const SPECIAL_IDS = Object.keys(SPECIAL_DAYS) as SpecialId[];
export const isSpecialId = (v: unknown): v is SpecialId => typeof v === 'string' && (SPECIAL_IDS as string[]).includes(v);

/** Minimal shape of a shift config this needs (avoids importing career.ts here). */
interface CfgLike {
  karens: string[]; events: string[]; firstEvent: number; eventEvery?: number; spawnEvery: number; maxCustomers: number;
  spillMul?: number; special?: SpecialId; hints: string[];
  start?: { shelves: Record<string, number> };
}
/**
 * Turns a shift config into the special day (mutates it). `oneKind` = the day is a one-karen-type day (daily
 * 全是直播主 / 插座保衛戰): the special day's own karens stay out. Returns the revenue-target multiplier.
 */
export function applySpecialDay(cfg: CfgLike, id: SpecialId, oneKind = false): number {
  const d = SPECIAL_DAYS[id];
  cfg.special = id;
  if (id === 'typhoon') {
    cfg.spawnEvery *= TYPHOON.spawnMul; cfg.maxCustomers = Math.max(6, cfg.maxCustomers - TYPHOON.maxDrop);
    cfg.spillMul = Math.max(cfg.spillMul ?? 1, TYPHOON.spillMul);
    cfg.events = [...new Set([...cfg.events, 'outage'])]; cfg.firstEvent = Math.min(cfg.firstEvent, 20); cfg.eventEvery = TYPHOON.outageEvery;
    if (cfg.start) cfg.start.shelves.snacks = (cfg.start.shelves.snacks ?? 0) + TYPHOON.prestock;
  } else {
    // the countdown rush is its own event: no random rushes on top of it
    cfg.events = cfg.events.filter(e => e !== 'rush');
  }
  if (!oneKind) cfg.karens = [...new Set([...cfg.karens, ...d.karens])];
  return d.goal;
}
