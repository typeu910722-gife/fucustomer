// 長期目標: 店面等級（名聲）、連鎖分店、個人紀錄。
// - Every free-play store (one per map) and your own store earn 店面 XP from each business day they survive
//   (revenue, karens handled, closing rating). Levels 1–10 have titles and each one unlocks something small and free.
// - Your own store at Lv5+ can open up to 3 分店 on other store types, paid from savings. Branches pay a capped
//   passive income for real shifts you play elsewhere, with a (silly) daily report from the branch manager.
// - 個人紀錄: best day revenue, most karens in a day and the longest 好評 streak, per store.
// Everything is free (no paid items, nothing for sale) and local: it lives in the career profile, so save codes carry it.
// Pure functions, no imports of career.ts/sim.ts at runtime (career.ts imports this module for sanitizing).
import { ALL_PRODUCTS, UPGRADE_IDS, UPGRADES, type Product, type UpgradeId } from './constants.ts';
import type { StoreSave } from './protocol.ts';
import type { CareerProfile } from './career.ts';
import { MAPS } from './maps/index.ts';

// ---------------- store level ----------------
export const STORE_MAX_LEVEL = 10;
/** Total XP needed to reach level i+1 (index 0 = Lv1). Lv5 ≈ 9 good days, Lv10 ≈ 50 days. */
export const LEVEL_XP = [0, 200, 550, 1100, 1900, 3000, 4400, 6200, 8400, 11000];
export const LEVEL_TITLES = ['巷口小店', '街坊熟面孔', '鄰里推薦', '打卡小熱點', '區域名店', '排隊名店', '部落客愛店', '城市地標', '電視採訪名店', '傳說名店'];
/** XP is capped so a save can't hold absurd numbers (a little above Lv10). */
export const XP_CAP = 99_999;

/** XP for one business day (max 40 + 160 + 100 + 40 = 340). */
export const DAY_XP = { base: 40, revenueDiv: 4, revenueCap: 160, perKaren: 10, karenCap: 100, rating: [[4.5, 40], [4, 25], [3.5, 10]] as [number, number][] };
/** A day counts toward the 好評 streak when the store closes with at least this rating. */
export const STREAK_RATING = 3;

export interface DayInput { revenue: number; karens: number; rating: number }
export function dayXp(d: DayInput): number {
  const rev = Math.min(DAY_XP.revenueCap, Math.floor(Math.max(0, d.revenue) / DAY_XP.revenueDiv));
  const kar = Math.min(DAY_XP.karenCap, Math.max(0, Math.floor(d.karens)) * DAY_XP.perKaren);
  const rat = DAY_XP.rating.find(([r]) => d.rating >= r)?.[1] ?? 0;
  return DAY_XP.base + rev + kar + rat;
}

export function levelOf(xp: number): number {
  let lv = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lv = i + 1;
  return lv;
}
export interface LevelInfo { level: number; title: string; xp: number; into: number; need: number; pct: number; nextTitle: string | null }
export function levelInfo(xp: number): LevelInfo {
  const level = levelOf(xp);
  const max = level >= STORE_MAX_LEVEL;
  const into = max ? 0 : xp - LEVEL_XP[level - 1], need = max ? 0 : LEVEL_XP[level] - LEVEL_XP[level - 1];
  return { level, title: LEVEL_TITLES[level - 1], xp, into, need, pct: max ? 100 : Math.floor((into / need) * 100), nextTitle: max ? null : LEVEL_TITLES[level] };
}

// ---------------- unlocks ----------------
export type UnlockKind = 'event' | 'cosmetic' | 'perk' | 'branch';
export interface LevelUnlock { level: number; kind: UnlockKind; icon: string; name: string; desc: string; id: string; ownOnly?: boolean }
export const LEVEL_UNLOCKS: LevelUnlock[] = [
  { level: 2, kind: 'event', id: 'chief', icon: '🧓', name: '每日事件：里長來巡店', desc: '打烊時偶爾會有里長來關心，順手買一箱水（+$30）' },
  { level: 3, kind: 'cosmetic', id: 'sign_local', icon: '🪧', name: '「在地推薦」燈牌', desc: '免費店面裝飾（商城 → 燈牌 裝上）' },
  { level: 4, kind: 'event', id: 'influencer', icon: '📸', name: '每日事件：網美來拍照', desc: '網美在門口拍了 87 張，限動標你的店（+$20、口碑 +0.1）' },
  { level: 5, kind: 'perk', id: 'supplier', icon: '📦', name: '廠商熟客', desc: '每天打烊後，廠商多送 1 箱倉庫最少的商品（6 個）' },
  { level: 5, kind: 'branch', id: 'branch', icon: '🏬', name: '開放連鎖分店', desc: '自己開的店到 Lv5，可以用存款開第一間分店', ownOnly: true },
  { level: 6, kind: 'cosmetic', id: 'mat_carpet', icon: '🟥', name: '排隊名店紅地毯', desc: '免費店面裝飾（商城 → 地墊 裝上）' },
  { level: 7, kind: 'event', id: 'blogger', icon: '🍜', name: '每日事件：美食部落客', desc: '部落客寫了一篇「巷口隱藏版」（+$50、口碑 +0.1）' },
  { level: 8, kind: 'cosmetic', id: 'mascot_trophy', icon: '🏆', name: '金獎盃公仔', desc: '免費櫃台公仔（商城 → 櫃台公仔 擺上）' },
  { level: 9, kind: 'event', id: 'tv', icon: '📺', name: '每日事件：電視台採訪', desc: '記者來做排隊名店專題（+$80、口碑 +0.15）' },
  { level: 10, kind: 'cosmetic', id: 'sign_legend', icon: '🌟', name: '「傳說名店」金色燈牌', desc: '免費店面裝飾，傳說的證明' },
];
/** Cosmetics given away by store levels (any store reaching the level counts). */
export const LEVEL_COSMETICS = LEVEL_UNLOCKS.filter(u => u.kind === 'cosmetic').map(u => ({ id: u.id, level: u.level }));
export const unlocksAt = (level: number, own = false) => LEVEL_UNLOCKS.filter(u => u.level === level && (own || !u.ownOnly));
export const nextUnlock = (level: number, own = false) => LEVEL_UNLOCKS.find(u => u.level > level && (own || !u.ownOnly)) ?? null;

// ---------------- daily events (a chance at each night) ----------------
export interface DailyEvent { id: string; level: number; icon: string; name: string; text: string; money: number; rating: number }
export const DAILY_EVENTS: DailyEvent[] = [
  { id: 'chief', level: 2, icon: '🧓', name: '里長來巡店', text: '里長逛了一圈，說要在里民大會上幫你宣傳，順手買了一箱礦泉水。', money: 30, rating: 0 },
  { id: 'influencer', level: 4, icon: '📸', name: '網美來拍照', text: '網美在門口拍了 87 張照片，限動標了你的店，還叫你幫忙拿反光板。', money: 20, rating: 0.1 },
  { id: 'blogger', level: 7, icon: '🍜', name: '美食部落客', text: '部落客寫了一篇「巷口隱藏版名店」，雖然他只買了一瓶水。', money: 50, rating: 0.1 },
  { id: 'tv', level: 9, icon: '📺', name: '電視台採訪', text: '記者來做「排隊名店」專題，你在鏡頭前講話卡了三次，播出來還是很帥。', money: 80, rating: 0.15 },
];
/** Chance that one of the unlocked events happens on a given night. At most one per night. */
export const EVENT_CHANCE = 0.3;
/** 廠商熟客 perk: one box of this many units. */
export const SUPPLIER_BOX = 6;

/** Small deterministic hash → [0,1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Tonight's event for a store at `level` (deterministic per store + day, so reloading can't reroll it). */
export function pickDailyEvent(level: number, key: string): DailyEvent | null {
  const pool = DAILY_EVENTS.filter(e => e.level <= level);
  if (!pool.length || hash01('ev|' + key) >= EVENT_CHANCE) return null;
  return pool[Math.floor(hash01('pick|' + key) * pool.length) % pool.length];
}

// ---------------- per-store progress & records ----------------
export interface StoreProg {
  xp: number;
  /** Business days closed. */
  days: number;
  /** Current and best run of days closed with rating ≥ STREAK_RATING. */
  streak: number; bestStreak: number;
  /** 個人紀錄: best day revenue and most karens handled in one day. */
  bestRevenue: number; bestKarens: number;
}
export function newProg(): StoreProg { return { xp: 0, days: 0, streak: 0, bestStreak: 0, bestRevenue: 0, bestKarens: 0 }; }
const int = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.floor(x))) : lo);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function sanitizeProg(v: unknown): StoreProg {
  const p = newProg();
  if (!isObj(v)) return p;
  p.xp = int(v.xp, 0, XP_CAP); p.days = int(v.days, 0, 1e6);
  p.bestStreak = int(v.bestStreak, 0, 1e6); p.streak = Math.min(int(v.streak, 0, 1e6), p.bestStreak);
  p.bestRevenue = int(v.bestRevenue, 0, 1e7); p.bestKarens = int(v.bestKarens, 0, 1e5);
  return p;
}
const MAP_IDS = new Set(MAPS.map(m => m.id));
/** Free-play progress per map id (unknown maps dropped). */
export function sanitizeFreeProg(v: unknown): Record<string, StoreProg> {
  const out: Record<string, StoreProg> = {};
  if (!isObj(v)) return out;
  for (const [k, s] of Object.entries(v)) if (MAP_IDS.has(k) && isObj(s)) out[k] = sanitizeProg(s);
  return out;
}

export interface DayReport {
  xp: number; level: number; before: number; levels: number[];
  /** Unlocks reached today (for the summary / toast). */
  unlocked: LevelUnlock[];
  records: ('revenue' | 'karens' | 'streak')[];
  streak: number;
  event: DailyEvent | null;
  /** 廠商熟客: the product that got a free box. */
  supplier: Product | null;
}
/** Records one closed business day: XP, level-ups, records and the streak. Event/perk are decided by the caller's key. */
export function recordDay(prog: StoreProg, d: DayInput, opts: { own?: boolean; key?: string; backstock?: Partial<Record<Product, number>>; products?: Product[] } = {}): DayReport {
  const before = levelOf(prog.xp);
  const xp = dayXp(d);
  prog.xp = Math.min(XP_CAP, prog.xp + xp);
  prog.days = Math.min(1e6, prog.days + 1);
  const records: DayReport['records'] = [];
  const rev = Math.max(0, Math.floor(d.revenue)), kar = Math.max(0, Math.floor(d.karens));
  if (rev > prog.bestRevenue) { if (prog.bestRevenue > 0) records.push('revenue'); prog.bestRevenue = Math.min(1e7, rev); }
  if (kar > prog.bestKarens) { if (prog.bestKarens > 0) records.push('karens'); prog.bestKarens = kar; }
  prog.streak = d.rating >= STREAK_RATING ? prog.streak + 1 : 0;
  if (prog.streak > prog.bestStreak) { if (prog.bestStreak >= 2) records.push('streak'); prog.bestStreak = prog.streak; }
  const level = levelOf(prog.xp);
  const levels: number[] = []; for (let l = before + 1; l <= level; l++) levels.push(l);
  const unlocked = levels.flatMap(l => unlocksAt(l, opts.own));
  // tonight's event (unlocked events only) and the 廠商熟客 box
  const event = opts.key ? pickDailyEvent(level, opts.key) : null;
  let supplier: Product | null = null;
  if (level >= 5 && opts.backstock) {
    const lines = (opts.products ?? ALL_PRODUCTS.filter(p => p !== 'extra'));
    supplier = lines.reduce<Product | null>((best, p) => (best === null || (opts.backstock![p] ?? 0) < (opts.backstock![best] ?? 0) ? p : best), null);
  }
  return { xp, level, before, levels, unlocked, records, streak: prog.streak, event, supplier };
}

/** Applies tonight's event money/rating and the supplier box to a save (rating stays within 0–5, stock within 999). */
export function applyReportToSave(save: StoreSave, r: DayReport): StoreSave {
  const out: StoreSave = { ...save, backstock: { ...save.backstock } };
  if (r.event) { out.money += r.event.money; out.rating = Math.min(5, Math.round((out.rating + r.event.rating) * 100) / 100); }
  if (r.supplier) out.backstock[r.supplier] = Math.min(999, (out.backstock[r.supplier] ?? 0) + SUPPLIER_BOX);
  return out;
}

/** Gives the free level cosmetics for `level` (and below). Returns the ids newly added. */
export function grantLevelCosmetics(p: CareerProfile, level: number): string[] {
  const fresh: string[] = [];
  for (const c of LEVEL_COSMETICS) if (level >= c.level && !p.shop.owned.includes(c.id)) { p.shop.owned.push(c.id); fresh.push(c.id); }
  return fresh;
}

// ---------------- 連鎖分店 ----------------
export const BRANCH_MAX = 3;
/** Cost from savings and the own-store level needed for the 1st / 2nd / 3rd branch. */
export const BRANCH_COST = [2000, 3500, 5000];
export const BRANCH_LEVEL_REQ = [5, 7, 9];
/** Cash a new branch starts with in its own till (part of the cost). */
export const BRANCH_TILL = 400;
/** Passive income per branch per counted shift: 20 + 4 × branch level (Lv1 $24 … Lv10 $60). */
export const branchIncome = (level: number) => 20 + 4 * Math.max(1, Math.min(STORE_MAX_LEVEL, level));
/** Shifts per branch per local day that pay (so the most a full chain pays is 3 × 3 × $60 = $540 a day). */
export const BRANCH_SHIFTS_PER_DAY = 3;
/** Branches sold when the flagship closes or goes bankrupt: this share of what they cost comes back. */
export const BRANCH_RESALE = 0.5;
export const MANAGERS = ['阿德', '小芬', '阿豪', '佩佩', '老王', '阿珠'];
export const BRANCH_LOG_MAX = 6;

export interface Branch {
  map: string; name: string; manager: string; cost: number;
  /** The branch's own store (it can be visited and played). */
  save: StoreSave; prog: StoreProg;
  /** Local date of the last paid shift and how many paid that day. */
  payDate: string; payCount: number;
  /** Total passive income paid to savings. */
  earned: number;
  /** Manager reports, newest first. */
  log: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Light save check without sim.ts (createWorld sanitizes fully when the branch is played). */
export function sanitizeBranchSave(v: unknown): StoreSave | null {
  if (!isObj(v) || typeof v.money !== 'number' || !Number.isFinite(v.money)) return null;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  const bs = isObj(v.backstock) ? v.backstock : {}, sh = isObj(v.shelves) ? v.shelves : {}, up = isObj(v.upgrades) ? v.upgrades : {}, t = isObj(v.totals) ? v.totals : {};
  const rec = (o: Record<string, unknown>, d: number) => Object.fromEntries(ALL_PRODUCTS.map(p => [p, num(o[p], 0, 999, d)])) as Record<Product, number>;
  return {
    version: 1, day: num(v.day, 1, 1e6, 1), money: num(v.money, -1e6, 1e9, 0),
    rating: typeof v.rating === 'number' && Number.isFinite(v.rating) ? Math.max(0, Math.min(5, v.rating)) : 3,
    backstock: rec(bs, 18), shelves: rec(sh, 6),
    upgrades: Object.fromEntries(UPGRADE_IDS.map(u => [u, num(up[u], 0, UPGRADES[u].costs.length, 0)])) as Record<UpgradeId, number>,
    totals: { served: num(t.served, 0, 1e9, 0), karens: num(t.karens, 0, 1e9, 0), revenue: num(t.revenue, 0, 1e12, 0) },
  };
}
export function sanitizeBranches(v: unknown, mainMap: string): Branch[] {
  if (!Array.isArray(v)) return [];
  const out: Branch[] = [];
  const seen = new Set([mainMap]);
  for (const b of v) {
    if (out.length >= BRANCH_MAX || !isObj(b) || typeof b.map !== 'string' || !MAP_IDS.has(b.map) || seen.has(b.map)) continue;
    const save = sanitizeBranchSave(b.save); if (!save) continue;
    seen.add(b.map);
    out.push({
      map: b.map, name: typeof b.name === 'string' && b.name.trim() ? b.name.slice(0, 16) : '分店',
      manager: typeof b.manager === 'string' && MANAGERS.includes(b.manager) ? b.manager : MANAGERS[0],
      cost: int(b.cost, 0, 1e6), save, prog: sanitizeProg(b.prog),
      payDate: typeof b.payDate === 'string' && DATE_RE.test(b.payDate) ? b.payDate : '', payCount: int(b.payCount, 0, BRANCH_SHIFTS_PER_DAY),
      earned: int(b.earned, 0, 1e9),
      log: Array.isArray(b.log) ? b.log.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 80)).slice(0, BRANCH_LOG_MAX) : [],
    });
  }
  return out;
}

/** What the chain needs from the own store (structural so ownstore.ts / career.ts types fit). */
interface ChainStore { map: string; prog?: StoreProg; branches?: Branch[] }

export function canOpenBranch(st: ChainStore | null, wallet: number, map: string, locked = false): { ok: boolean; why?: string } {
  if (!st) return { ok: false, why: '要先有自己的店' };
  const n = st.branches?.length ?? 0;
  if (n >= BRANCH_MAX) return { ok: false, why: `最多 ${BRANCH_MAX} 間分店` };
  const lv = levelOf(st.prog?.xp ?? 0);
  if (lv < BRANCH_LEVEL_REQ[n]) return { ok: false, why: `總店要到 Lv${BRANCH_LEVEL_REQ[n]}（目前 Lv${lv}）` };
  if (!MAP_IDS.has(map)) return { ok: false, why: '沒有這種店' };
  if (map === st.map || st.branches?.some(b => b.map === map)) return { ok: false, why: '這種店你已經有了，換一種吧' };
  if (locked) return { ok: false, why: '這種店需要擴充包' };
  if (wallet < BRANCH_COST[n]) return { ok: false, why: `存款不足：還差 $${BRANCH_COST[n] - wallet}` };
  return { ok: true };
}

/** Opens a branch with savings. `base` is a fresh store save (sim.defaultSave()). */
export function openBranch(p: CareerProfile, map: string, name: string, base: StoreSave, locked = false): Branch | null {
  const st = p.store;
  if (!st || !canOpenBranch(st, p.wallet, map, locked).ok) return null;
  const n = st.branches?.length ?? 0, cost = BRANCH_COST[n];
  p.wallet -= cost;
  const mapName = MAPS.find(m => m.id === map)?.name ?? '';
  const b: Branch = {
    map, name: (name.trim() || `${st.name.slice(0, 8)} ${mapName}分店`).slice(0, 16), manager: MANAGERS[(n + st.name.length) % MANAGERS.length], cost,
    save: { ...base, day: 1, money: BRANCH_TILL, rating: 3 }, prog: newProg(), payDate: '', payCount: 0, earned: 0,
    log: [`開幕第一天：店長${MANAGERS[(n + st.name.length) % MANAGERS.length]}剪綵時剪到自己的領帶，不過人潮不錯。`],
  };
  st.branches = [...(st.branches ?? []), b];
  return b;
}

const REPORTS = [
  '有阿伯拿 2019 年的折價券來凹，我請他去總店找你。',
  '工讀生把咖啡機當飲水機，整台洗了一遍。',
  '有網紅說要用「曝光」抵帳，我說我們只收現金跟悠遊卡。',
  '冷氣壞了半天，客人說很有古早味。',
  '有人問能不能只買半顆茶葉蛋。我說可以，另外半顆要預購。',
  '今天很平靜，平靜到我有點害怕。',
  '奧客說要打給總公司，我把你的電話給他了，祝你好運。',
  '我把 Excel 欄寬調寬了，數字看起來比較多。',
  '隔壁新開了一家，我去買了一杯，還是我們的好喝。',
  '有客人在店裡求婚，成功了，買了兩瓶養樂多慶祝。',
  '收銀機卡紙三次，我用意念把它修好了。',
  '有人把購物籃帶回家了，說明天還。我們等著看。',
];
export interface BranchPay { name: string; map: string; manager: string; amount: number; line: string }
/**
 * A real shift was played somewhere else (career shift, free-play day, own-store day or another branch): each branch
 * pays its income into savings, up to BRANCH_SHIFTS_PER_DAY times per local day. `skipMap` = the branch being played.
 */
export function payBranches(p: CareerProfile, date: string, key: string, skipMap?: string): BranchPay[] {
  const st = p.store; if (!st?.branches?.length || !DATE_RE.test(date)) return [];
  const out: BranchPay[] = [];
  st.branches.forEach((b, i) => {
    if (b.map === skipMap) return;
    if (b.payDate !== date) { b.payDate = date; b.payCount = 0; }
    if (b.payCount >= BRANCH_SHIFTS_PER_DAY) return;
    b.payCount++;
    const amount = branchIncome(levelOf(b.prog.xp));
    b.earned = Math.min(1e9, b.earned + amount); p.wallet = Math.min(1e8, p.wallet + amount);
    const line = REPORTS[Math.floor(hash01(`rep|${key}|${i}|${b.payCount}`) * REPORTS.length) % REPORTS.length];
    b.log = [`${date.slice(5)} +$${amount}：${line}`, ...b.log].slice(0, BRANCH_LOG_MAX);
    out.push({ name: b.name, map: b.map, manager: b.manager, amount, line });
  });
  return out;
}

/** The flagship closes: branches are sold for half of what they cost. Returns the cash back to savings. */
export function sellBranches(st: ChainStore): number {
  const back = (st.branches ?? []).reduce((n, b) => n + Math.floor(b.cost * BRANCH_RESALE), 0);
  st.branches = [];
  return back;
}

// ---------------- summaries for achievements / records ----------------
export interface StoreRow { kind: 'free' | 'own' | 'branch'; map: string; name: string; prog: StoreProg }
export function allStoreProgs(p: CareerProfile): StoreRow[] {
  const rows: StoreRow[] = [];
  const nameOf = (m: string) => MAPS.find(x => x.id === m)?.name ?? m;
  for (const m of MAPS) { const pr = p.freeProg?.[m.id]; if (pr && pr.days > 0) rows.push({ kind: 'free', map: m.id, name: nameOf(m.id), prog: pr }); }
  if (p.store) {
    rows.push({ kind: 'own', map: p.store.map, name: p.store.name, prog: p.store.prog ?? newProg() });
    for (const b of p.store.branches ?? []) rows.push({ kind: 'branch', map: b.map, name: b.name, prog: b.prog });
  }
  return rows;
}
export const maxStoreLevel = (p: CareerProfile) => allStoreProgs(p).reduce((n, r) => Math.max(n, levelOf(r.prog.xp)), 0);
export const bestStreakAll = (p: CareerProfile) => allStoreProgs(p).reduce((n, r) => Math.max(n, r.prog.bestStreak), 0);
export const branchCount = (p: CareerProfile) => p.store?.branches?.length ?? 0;
