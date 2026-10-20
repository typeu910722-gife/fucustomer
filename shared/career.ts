// Single-player career: ranks, EXP, skill trees, gear, chapters/shifts and rewards.
// Pure data + functions so it can be unit-tested and used by the client and the simulation.
import { KarenKind, Product, type StockIn } from './constants.ts';
import type { OwnStore, StoreHistory, WageMode } from './ownstore.ts';
import type { StoreSave } from './protocol.ts';
import { MAPS } from './maps/index.ts';
import { ShopState, newShop, sanitizeShop } from './shop.ts';
import { addHandled, sanitizeDex } from './karendex.ts';
import { ARCS, type ArcState } from './regulars.ts';
import { type StoreProg, sanitizeBranches, sanitizeFreeProg, sanitizeProg } from './progression.ts';

export type Ability = 'hit' | 'grab' | 'spin' | 'ultimate';

/** One time you hit someone during a shift. legal = self-defence; vip = the person had connections. */
/** A hit that may bring the police. `cam`: the store's 監視器 upgrade level when it happened (omitted = 0, see court.ts). */
export interface Incident { who: string; legal: boolean; vip: boolean; normal: boolean; why: string; cam?: number }
export type Food = 'coffee' | 'meal';
export type ShiftEvent = 'rush' | 'outage';

/** Numeric modifiers applied by skills and gear (1 = no change). */
export interface ShiftMods {
  checkout: number; tips: number; patience: number; angerRate: number; calm: number;
  brew: number; clean: number; speed: number; staminaMax: number; staminaRegen: number;
  spinRange: number; spinCooldown: number; guard: number; throwPower: number;
}
export const BASE_MODS: ShiftMods = {
  checkout: 1, tips: 1, patience: 1, angerRate: 1, calm: 1, brew: 1, clean: 1, speed: 1, staminaMax: 100, staminaRegen: 1,
  spinRange: 3.2, spinCooldown: 5, guard: 0, throwPower: 1,
};

export interface ShiftConfig {
  mode: 'day' | 'shift';
  id: string; title: string; chapter: number;
  length: number; goal: number;
  karens: KarenKind[]; firstKaren: number; karenEvery: number; maxKarens: number;
  spawnEvery: number; maxCustomers: number;
  foods: Food[]; foodChance: number;
  events: ShiftEvent[]; firstEvent: number;
  register2: boolean; abilities: Ability[];
  start: { money: number; rating: number; backstock: StockIn; shelves: StockIn };
  mods: ShiftMods; hints: string[];
  boss: boolean; bossAt: number; endless: boolean;
  /** Seconds between random events (default 42). */
  eventEvery?: number;
  /** Set for the daily challenge. */
  daily?: { date: string; mods: DailyModId[]; scene: number };
  /** Own store: employee wage charged at each nightly settlement. */
  staffWage?: number;
  /** Map id (shared/maps). Omitted = 便利商店. */
  map?: string;
  /** Raiding a friend's store: you play the troublemaker for a short timed round. */
  raid?: { store: string; owner?: string };
  /** Multiplier on how often customers spill things (weekly 颱風天 > 1). Omitted = 1. */
  spillMul?: number;
  /** Set for the weekly challenge (shared/weekly.ts). */
  weekly?: { week: string; twist: string };
}

// ---------------- ranks & levels ----------------
export const MAX_LEVEL = 30;
export const RANKS = [
  { name: '試用期工讀生', from: 1 }, { name: '正職店員', from: 6 }, { name: '資深店員', from: 11 }, { name: '副店長', from: 16 },
  { name: '店長', from: 21 }, { name: '區域督導', from: 26 }, { name: '終極打工人', from: 30 },
];
export function rankOf(level: number) { let r = RANKS[0]; for (const k of RANKS) if (level >= k.from) r = k; return r.name; }
/** EXP needed to go from `level` to `level + 1`. */
export function expToNext(level: number) { return level >= MAX_LEVEL ? Infinity : 60 + 25 * (level - 1); }

export const ABILITY_LEVEL: Record<Ability, number> = { hit: 6, grab: 11, spin: 16, ultimate: 26 };
export const ABILITY_INFO: Record<Ability, { name: string; desc: string }> = {
  hit: { name: '出手', desc: '把失控的奧客揍暈。對方先失控就是正當防衛；不佔理或打到有背景的人會被警察帶走' },
  grab: { name: '抓起／投擲', desc: '抓起奧客，對準發光出口丟出店外' },
  spin: { name: '拖把旋風', desc: '擊退身邊所有人（小心一般顧客）' },
  ultimate: { name: '全店退散', desc: '爆發值滿 100，店內奧客一次送走' },
};
export function abilitiesAt(level: number): Ability[] { return (Object.keys(ABILITY_LEVEL) as Ability[]).filter(a => level >= ABILITY_LEVEL[a]); }

// ---------------- skills ----------------
export type SkillTree = 'service' | 'body' | 'crisis';
export const SKILL_MAX = 10;
export const SKILLS: Record<SkillTree, { name: string; icon: string; perPoint: string }> = {
  service: { name: '服務', icon: '💳', perPoint: '結帳 -5%、小費 +6%、顧客耐心 +3%' },
  body: { name: '體能', icon: '🏃', perPoint: '移動 +2.5%、體力上限 +6、回復 +6%' },
  crisis: { name: '危機處理', icon: '🧯', perPoint: '奧客怒氣上升 -5%、安撫效果 +8%、投擲力道 +3%' },
};

// ---------------- gear (from v0.4) ----------------
export type GearId = 'shoes' | 'mop' | 'machine' | 'cleaner' | 'guard';
export const GEAR: Record<GearId, { name: string; icon: string; base: number; detail: string }> = {
  shoes: { name: '輕量工作鞋', icon: '👟', base: 100, detail: '每級移動速度 +8%' },
  mop: { name: '旋風拖把', icon: '🌀', base: 100, detail: '每級旋風範圍 +0.35m、冷卻 -0.5 秒' },
  machine: { name: '極速餐飲設備', icon: '☕', base: 120, detail: '每級咖啡／熱便當製作時間 -14%' },
  cleaner: { name: '強效清潔組', icon: '🧽', base: 80, detail: '每級清潔時間 -18%' },
  guard: { name: '夜班保全', icon: '🛡', base: 150, detail: '定期請走靠近出口的奧客；升級縮短巡邏間隔' },
};
export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export const GEAR_MAX = 3;
export function gearPrice(id: GearId, level: number) { return level >= GEAR_MAX ? null : Math.ceil(GEAR[id].base * [1, 1.7, 2.7][level]); }

// ---------------- profile ----------------
export interface CareerProfile {
  version: 1; level: number; exp: number; wallet: number; skillPoints: number;
  skills: Record<SkillTree, number>; gear: Record<GearId, number>;
  stars: Record<string, number>; clears: Record<string, number>;
  stats: { shifts: number; wins: number; served: number; ejected: number; karens: number; revenue: number };
  endlessBest: number; title: string;
  /** Unlocked achievement IDs (see achievements.ts). */
  achievements: string[];
  /** Daily challenge: today's best and whether today's reward was paid; streak counts consecutive days won. */
  daily: { date: string; best: number; rewarded: boolean; streak: number; lastWin: string; wins: number };
  /** Court record. */
  court: { trials: number; fines: number; acquittals: number };
  /** Story scenes already watched (ids from story.ts). */
  story: string[];
  /** Your own store (after the main story), or null. */
  store: OwnStore | null;
  storeHistory: StoreHistory;
  /** 全台奧客圖鑑: how many of each karen kind you have handled (karendex.ts). */
  dex: Record<string, number>;
  /** 商城: cosmetics bought with 薪資點數, what is equipped, and paid packs (shared/shop.ts). */
  shop: ShopState;
  /** 每週挑戰 (weekly.ts): this week's paid goals and every badge earned. Old saves: empty. */
  weekly: WeeklyState;
  /** 常客奧客 story arcs (regulars.ts): progress per arc id. Old saves: none started. */
  arcs: Record<string, ArcState>;
  /** 店面等級 + 個人紀錄 of each free-play store, by map id (progression.ts). Old saves: none. */
  freeProg: Record<string, StoreProg>;
}
export function newProfile(): CareerProfile {
  return {
    version: 1, level: 1, exp: 0, wallet: 120, skillPoints: 0,
    skills: { service: 0, body: 0, crisis: 0 }, gear: { shoes: 0, mop: 0, machine: 0, cleaner: 0, guard: 0 },
    stars: {}, clears: {}, stats: { shifts: 0, wins: 0, served: 0, ejected: 0, karens: 0, revenue: 0 }, endlessBest: 0, title: '',
    achievements: [], daily: { date: '', best: 0, rewarded: false, streak: 0, lastWin: '', wins: 0 },
    court: { trials: 0, fines: 0, acquittals: 0 }, story: [],
    store: null, storeHistory: { opened: 0, closed: 0, lost: 0, lastReason: '' }, shop: newShop(), dex: {}, weekly: newWeekly(), arcs: {}, freeProg: {},
  };
}
export function sanitizeProfile(v: unknown): CareerProfile {
  const p = newProfile();
  if (!v || typeof v !== 'object') return p;
  const o = v as Partial<CareerProfile>;
  const int = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.floor(x))) : d);
  p.level = int(o.level, 1, MAX_LEVEL, 1);
  p.exp = int(o.exp, 0, 1e7, 0);
  p.wallet = int(o.wallet, 0, 1e8, 120);
  for (const s of Object.keys(p.skills) as SkillTree[]) p.skills[s] = int(o.skills?.[s], 0, SKILL_MAX, 0);
  const spent = p.skills.service + p.skills.body + p.skills.crisis;
  p.skillPoints = Math.max(0, Math.min(int(o.skillPoints, 0, 99, 0), p.level - 1 - spent));
  for (const g of GEAR_IDS) p.gear[g] = int(o.gear?.[g], 0, GEAR_MAX, 0);
  for (const sh of allShifts()) {
    const st = int(o.stars?.[sh.id], 0, 3, 0); if (st) p.stars[sh.id] = st;
    const cl = int(o.clears?.[sh.id], 0, 1e6, 0); if (cl) p.clears[sh.id] = cl;
  }
  for (const k of Object.keys(p.stats) as (keyof CareerProfile['stats'])[]) p.stats[k] = int(o.stats?.[k], 0, 1e12, 0);
  p.endlessBest = int(o.endlessBest, 0, 1e12, 0);
  p.title = typeof o.title === 'string' ? o.title.slice(0, 20) : '';
  const ct = o.court;
  if (ct && typeof ct === 'object') p.court = { trials: int(ct.trials, 0, 1e6, 0), fines: int(ct.fines, 0, 1e9, 0), acquittals: int(ct.acquittals, 0, 1e6, 0) };
  if (Array.isArray(o.story)) p.story = [...new Set(o.story.filter((a): a is string => typeof a === 'string' && /^[a-z0-9-]{1,24}$/.test(a)))].slice(0, 64);
  const sh = o.storeHistory;
  if (sh && typeof sh === 'object') p.storeHistory = { opened: int(sh.opened, 0, 1e5, 0), closed: int(sh.closed, 0, 1e5, 0), lost: int(sh.lost, 0, 1e9, 0), lastReason: typeof sh.lastReason === 'string' ? sh.lastReason.slice(0, 40) : '' };
  p.store = sanitizeStore(o.store, int);
  p.dex = sanitizeDex(o.dex); // saves from before the 圖鑑 existed start empty
  p.shop = sanitizeShop(o.shop); // saves from before the shop existed get an empty shop
  p.weekly = sanitizeWeekly(o.weekly); // saves from before the weekly challenge: nothing played yet
  p.arcs = sanitizeArcs(o.arcs); // saves from before the 常客奧客 arcs: none started
  p.freeProg = sanitizeFreeProg(o.freeProg); // saves from before store levels: every store at Lv1
  if (Array.isArray(o.achievements)) p.achievements = [...new Set(o.achievements.filter((a): a is string => typeof a === 'string' && /^[A-Z0-9_]{1,24}$/.test(a)))].slice(0, 64);
  const d = o.daily, isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (d && typeof d === 'object') {
    p.daily = {
      date: isDate(d.date) ? d.date : '', best: int(d.best, 0, 1e7, 0), rewarded: d.rewarded === true,
      streak: int(d.streak, 0, 1e5, 0), lastWin: isDate(d.lastWin) ? d.lastWin : '', wins: int(d.wins, 0, 1e6, 0),
    };
  }
  return p;
}

/** Adds EXP; returns the levels gained. Each level grants one skill point. */
export function addExp(p: CareerProfile, amount: number): number[] {
  const gained: number[] = [];
  p.exp += Math.max(0, Math.floor(amount));
  while (p.level < MAX_LEVEL && p.exp >= expToNext(p.level)) {
    p.exp -= expToNext(p.level); p.level++; p.skillPoints++; gained.push(p.level);
  }
  if (p.level >= MAX_LEVEL) { p.exp = 0; p.title = '終極打工人'; }
  return gained;
}

export function spendSkill(p: CareerProfile, tree: SkillTree): boolean {
  if (p.skillPoints <= 0 || p.skills[tree] >= SKILL_MAX) return false;
  p.skillPoints--; p.skills[tree]++; return true;
}
export function buyGear(p: CareerProfile, id: GearId): boolean {
  const price = gearPrice(id, p.gear[id]);
  if (price === null || p.wallet < price) return false;
  p.wallet -= price; p.gear[id]++; return true;
}

export function modsFor(p: CareerProfile): ShiftMods {
  const s = p.skills, g = p.gear;
  return {
    checkout: Math.max(0.4, 1 - 0.05 * s.service), tips: 1 + 0.06 * s.service, patience: 1 + 0.03 * s.service,
    angerRate: Math.max(0.3, 1 - 0.05 * s.crisis), calm: 1 + 0.08 * s.crisis, throwPower: 1 + 0.03 * s.crisis,
    speed: (1 + 0.08 * g.shoes) * (1 + 0.025 * s.body), staminaMax: 100 + 6 * s.body, staminaRegen: 1 + 0.06 * s.body,
    brew: 1 - 0.14 * g.machine, clean: 1 - 0.18 * g.cleaner, spinRange: 3.2 + 0.35 * g.mop, spinCooldown: 5 - 0.5 * g.mop, guard: g.guard,
  };
}

// ---------------- chapters ----------------
export interface ShiftDef {
  id: string; title: string; length: number; goal: number; karens: KarenKind[]; maxKarens?: number; karenEvery?: number; firstKaren?: number;
  foods?: Food[]; events?: ShiftEvent[]; spawnEvery?: number; hints?: string[]; boss?: boolean; expMul?: number;
  /** Seconds between random events (default 42); first event at `firstEvent` (default 40). */
  eventEvery?: number; firstEvent?: number;
  /** Store type (shared/maps); omitted = 便利商店. */
  map?: string;
}
export interface ChapterDef {
  n: number; title: string; place: string; minLevel: number; baseExp: number; story: string; coming?: boolean;
  register2?: boolean; shifts: ShiftDef[];
}

const S = (d: ShiftDef) => d;
export const CHAPTERS: ChapterDef[] = [
  {
    n: 1, title: '巷口小店', place: '社區便利商店・白天班', minLevel: 1, baseExp: 120,
    story: '你錄取了巷口的便利商店。老店長說：「顧客至上，但奧客……你遲早會懂。」',
    shifts: [
      S({ id: '1-1', title: '第一天上班', length: 100, goal: 85, karens: [], spawnEvery: 9, hints: ['走到櫃台內側，對收銀機按互動幫顧客結帳。', '貨架快空了就去左上角倉庫拿貨箱，對同類貨架互動上架。'] }),
      S({ id: '1-2', title: '插隊阿伯', length: 110, goal: 125, karens: ['cutter'], firstKaren: 35, maxKarens: 1, hints: ['有人插隊！靠近他按互動「請排隊」，不然其他客人會很不爽。'] }),
      S({ id: '1-3', title: '打翻了！', length: 120, goal: 150, karens: ['cutter'], firstKaren: 45, hints: ['地上的髒污會拉高混亂度。去西側牆邊拿拖把，對髒污互動清乾淨。'] }),
      S({ id: '1-4', title: '放學人潮', length: 130, goal: 185, karens: ['cutter'], spawnEvery: 7.5 }),
      S({ id: '1-5', title: '店長來巡店', length: 140, goal: 205, karens: ['cutter'], maxKarens: 2, karenEvery: 40, spawnEvery: 7.5, hints: ['店長考核：達成營業額並保持口碑，就能轉為正職！'] }),
    ],
  },
  {
    n: 2, title: '深夜班', place: '24 小時便利商店・大夜班', minLevel: 6, baseExp: 235,
    story: '升上正職，排到了大夜班。咖啡機、微波爐，還有半夜來退貨的大嬸。',
    shifts: [
      S({ id: '2-1', title: '咖啡香', length: 130, goal: 220, karens: ['cutter'], foods: ['coffee'], hints: ['客人站在取餐區等咖啡：到咖啡機煮好後拿給他。'] }),
      S({ id: '2-2', title: '微波便當', length: 140, goal: 240, karens: ['cutter'], foods: ['coffee', 'meal'], hints: ['熱便當要在微波爐加熱。手上最多可以拿兩份餐點。'] }),
      S({ id: '2-3', title: '退貨大嬸', length: 150, goal: 280, karens: ['rager', 'cutter'], foods: ['coffee', 'meal'], firstKaren: 30, hints: ['退貨大鬧：怒氣滿了會砸店。持續按互動安撫，或按次要鍵發折價券。'] }),
      S({ id: '2-4', title: '突然停電', length: 150, goal: 285, karens: ['rager', 'cutter'], foods: ['coffee', 'meal'], events: ['outage'], hints: ['停電時燈光變暗、顧客比較不耐煩，撐到恢復供電！'] }),
      S({ id: '2-5', title: '午夜考驗', length: 170, goal: 330, karens: ['rager', 'cutter'], maxKarens: 2, foods: ['coffee', 'meal'], events: ['outage'], spawnEvery: 7 }),
    ],
  },
  {
    n: 3, title: '車站店', place: '車站前門市・通勤尖峰', minLevel: 11, baseExp: 360,
    story: '調到車站店，人潮一波接一波，還有拿著自拍棒的直播主。你學會了一招：直接請出門。',
    shifts: [
      S({ id: '3-1', title: '請出門的藝術', length: 140, goal: 280, karens: ['cutter', 'rager'], foods: ['coffee'], hints: ['新能力：抓起奧客（空白鍵／抓丟），轉向發光出口再按一次丟出去！誤丟一般顧客會被扣分。'] }),
      S({ id: '3-2', title: '直播主來了', length: 150, goal: 250, karens: ['streamer', 'cutter'], maxKarens: 1, firstKaren: 32, foods: ['coffee', 'meal'], hints: ['直播客會躲人又撞翻商品，追上去勸阻或直接請出門。'] }),
      S({ id: '3-3', title: '早高峰', length: 150, goal: 240, karens: ['streamer', 'rager'], foods: ['coffee', 'meal'], events: ['rush'], hints: ['尖峰時段客人暴增，先顧收銀！'] }),
      S({ id: '3-4', title: '誤點的列車', length: 160, goal: 270, karens: ['streamer', 'rager', 'cutter'], foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 6.8 }),
      S({ id: '3-5', title: '末班車', length: 180, goal: 310, karens: ['streamer', 'rager', 'cutter'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 6.5 }),
    ],
  },
  {
    n: 4, title: '觀光旗艦店', place: '老街旗艦店・觀光客滿', minLevel: 16, baseExp: 485, register2: true,
    story: '升上副店長，負責觀光旗艦店。兩台收銀機、偷吃的、亂丟的，全部都要顧。',
    shifts: [
      S({ id: '4-1', title: '雙收銀', length: 150, goal: 350, karens: ['hog', 'cutter'], foods: ['coffee', 'meal'], spawnEvery: 6.5, hints: ['旗艦店有兩台收銀機。新能力：拖把旋風（Q）擊退身邊的人。'] }),
      S({ id: '4-2', title: '試吃不是吃到飽', length: 160, goal: 350, karens: ['litterer', 'hog'], foods: ['coffee', 'meal'], spawnEvery: 6.5, hints: ['亂丟客會一路製造髒污；偷吃客要靠近才看得到。'] }),
      S({ id: '4-3', title: '旅遊團', length: 160, goal: 365, karens: ['charger', 'litterer'], firstKaren: 30, foods: ['coffee', 'meal'], events: ['rush'], spawnEvery: 6, hints: ['新奧客「充電霸王」會霸佔門口插座：拔兩次插頭，或煮杯咖啡請他喝，他就會走。'] }),
      S({ id: '4-4', title: '颱風夜', length: 170, goal: 405, karens: ['rager', 'litterer', 'hog'], foods: ['coffee', 'meal'], events: ['outage', 'rush'], spawnEvery: 6 }),
      S({ id: '4-5', title: '旗艦店評鑑', length: 180, goal: 400, karens: ['rager', 'litterer', 'hog', 'streamer', 'charger'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['outage', 'rush'], spawnEvery: 5.8 }),
    ],
  },
  {
    n: 5, title: '跨年夜美食街', place: '百貨美食街・跨年夜', minLevel: 21, baseExp: 760, register2: true,
    story: '店長的升職考核：跨年夜的美食街，所有奧客一次到齊。',
    shifts: [
      S({ id: '5-1', title: '倒數 6 小時', length: 170, goal: 400, karens: ['streamer', 'hog', 'litterer', 'charger'], foods: ['coffee', 'meal'], events: ['rush'], spawnEvery: 5.8, hints: ['跨年夜：奧客會同時出現好幾個。先處理最會鬧的（亂丟、直播），收銀不要停。'] }),
      S({ id: '5-2', title: '煙火前', length: 180, goal: 420, karens: ['rager', 'charger', 'cutter', 'streamer'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 5.5 }),
      S({ id: '5-3', title: '人擠人', length: 180, goal: 430, karens: ['cutter', 'hog', 'litterer', 'streamer'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 5.2 }),
      S({ id: '5-4', title: '跨年倒數', length: 200, goal: 490, karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], maxKarens: 4, karenEvery: 30, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 5 }),
    ],
  },
  {
    n: 6, title: '奧客之王', place: '總公司旗艦店・最終班', minLevel: 26, baseExp: 750, register2: true,
    story: '傳說中的「奧客之王」要來了。只有終極打工人能讓他退散。',
    shifts: [
      S({ id: '6-1', title: '前哨戰', length: 180, goal: 500, karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 5, expMul: 2, hints: ['新能力：全店退散（R）。請出門、旋風、投擲都會累積爆發值，滿 100 一次清場！'] }),
      S({ id: '6-2', title: '總部視察', length: 190, goal: 540, karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 4.8, expMul: 2 }),
      S({ id: '6-3', title: '奧客之王', length: 240, goal: 555, karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], maxKarens: 1, foods: ['coffee', 'meal'], events: ['rush', 'outage'], spawnEvery: 5.2, boss: true, expMul: 2, hints: ['奧客之王會分五個階段鬧事，看畫面下方的提示一關一關破！最後把他丟出門或全店退散。'] }),
    ],
  },
  {
    n: 7, title: '轉職之路', place: '早餐店・手搖飲・服飾店・雞排店', minLevel: 26, baseExp: 800, register2: true,
    story: '辭職之後，阿芬姐建議你：開店前，先去不同的店見習。每種店都有它自己的奧客。',
    shifts: [
      S({ id: '7-1', title: '晨光早餐', map: 'breakfast', length: 150, goal: 305, karens: ['custom', 'cutter'], foods: ['coffee', 'meal'], spawnEvery: 5.6, hints: ['早餐店的「客製魔人」會在收銀台一直改單：先對他「複誦點單」才能結帳。'] }),
      S({ id: '7-2', title: '週末早午餐', map: 'breakfast', length: 170, goal: 385, karens: ['custom', 'rager', 'litterer'], maxKarens: 2, foods: ['coffee', 'meal'], events: ['rush'], eventEvery: 60, spawnEvery: 5.8 }),
      S({ id: '7-3', title: '午後一杯', map: 'boba', length: 150, goal: 320, karens: ['fickle', 'cutter'], foods: ['coffee', 'meal'], spawnEvery: 5.8, hints: ['手搖飲的「改單達人」第一杯一定要改：再做一杯給他，或「推薦招牌」讓他決定。'] }),
      S({ id: '7-4', title: '下班尖峰', map: 'boba', length: 170, goal: 360, karens: ['fickle', 'cutter'], maxKarens: 2, karenEvery: 50, foods: ['coffee', 'meal'], events: ['rush'], firstEvent: 50, eventEvery: 60, spawnEvery: 6.5, hints: ['下班尖峰會一波一波湧進來：人潮之間的空檔先把貨架補滿，尖峰時專心顧收銀。'] }),
      S({ id: '7-5', title: '週年慶', map: 'clothing', length: 170, goal: 1120, karens: ['tryhard', 'hog', 'rager'], maxKarens: 3, events: ['rush'], spawnEvery: 5.2, hints: ['服飾店的「試穿狂」會霸佔試衣間把衣服丟滿地：請他「限試穿 3 件」。'] }),
      S({ id: '7-6', title: '宵夜大雞排', map: 'chicken', length: 180, goal: 410, karens: ['custom', 'streamer', 'litterer', 'charger'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['outage'], spawnEvery: 5.2 }),
    ],
  },
  // 第 8–10 章：每一班換一種店，主角是那種店的「招牌奧客」(shared/sigkarens.ts)
  {
    n: 8, title: '商圈見習週', place: '藥妝店・書店・麵包店・超市・寵物店・咖啡廳', minLevel: 27, baseExp: 820, register2: true,
    story: '小林的專題「全台奧客圖鑑」要出續集，阿芬姐幫你排了一週的商圈見習：一天一種店，一種店一種奧客。',
    shifts: [
      S({ id: '8-1', title: '試用品風暴', map: 'drugstore', length: 150, goal: 485, karens: ['sampler', 'cutter'], maxKarens: 2, spawnEvery: 5.6, hints: ['藥妝店的「試用品掃貨客」會一排一排狂用試用品：追上去「收走試用品」，他換一排還要再收一次。'] }),
      S({ id: '8-2', title: '打烊前的書店', map: 'bookstore', length: 160, goal: 415, karens: ['reader', 'litterer'], maxKarens: 2, foods: ['coffee'], spawnEvery: 5.6, hints: ['「白看書魔人」坐在書架前一直翻：對他「請他到櫃台結帳」要講久一點，他會買走那本。'] }),
      S({ id: '8-3', title: '出爐時間', map: 'bakery', length: 160, goal: 340, karens: ['toucher', 'hog'], maxKarens: 2, foods: ['coffee'], events: ['rush'], spawnEvery: 5.4, hints: ['「徒手摸麵包」一靠近就閃人：追上去「遞夾子托盤」，他就乖乖夾一個去結帳。'] }),
      S({ id: '8-4', title: '週末試吃大會', map: 'supermarket', length: 170, goal: 455, karens: ['taster', 'cutter', 'litterer'], maxKarens: 2, foods: ['meal'], events: ['rush'], eventEvery: 60, spawnEvery: 6, hints: ['「試吃狂」站在試吃台吃個不停，每幾秒就燒掉試吃成本：「一人一份喔」說兩次（他會換一個試吃台）。'] }),
      S({ id: '8-5', title: '毛孩日', map: 'petshop', length: 170, goal: 380, karens: ['dogfeed', 'litterer', 'streamer'], maxKarens: 3, spawnEvery: 5.2, hints: ['「狗狗試吃團」拆零食給狗吃還尿在地上：去倉庫拿一箱貨，拿著貨箱對他「遞一包試吃包」，他就會買。'] }),
      S({ id: '8-6', title: '筆電森林', map: 'cafe', length: 180, goal: 420, karens: ['squatter', 'cutter', 'rager'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['outage'], spawnEvery: 5.2, hints: ['「一杯坐整天」霸佔座位燒翻桌率：提醒兩次，或沖一杯咖啡「幫他續杯」直接解決（還多賺一杯）。'] }),
    ],
  },
  {
    n: 9, title: '夜生活', place: '電影院・火鍋吃到飽・加油站・健身房・牛排館・雞排店', minLevel: 28, baseExp: 840, register2: true,
    story: '見習週結束，小林說晚上的奧客才精彩。電影院、吃到飽、加油站、健身房……一路做到宵夜場。',
    shifts: [
      S({ id: '9-1', title: '午夜場', map: 'cinema', length: 160, goal: 345, karens: ['kicker', 'streamer'], maxKarens: 2, foods: ['coffee', 'meal'], spawnEvery: 5.4, hints: ['「踢椅背大叔」坐在等候區吵鬧，他附近的客人耐心掉超快：去「請他坐好小聲」兩次。'] }),
      S({ id: '9-2', title: '吃到飽之夜', map: 'hotpot', length: 170, goal: 420, karens: ['packer', 'hog', 'litterer'], maxKarens: 3, foods: ['coffee', 'meal'], spawnEvery: 5.2, hints: ['「偷打包客」要靠近才看得到，他會把肉盤塞進保鮮盒：「檢查打包盒」逼他結帳，放他走店裡要賠。'] }),
      S({ id: '9-3', title: '深夜加油', map: 'gas', length: 160, goal: 515, karens: ['wiper', 'cutter', 'litterer'], maxKarens: 3, foods: ['coffee'], events: ['outage'], spawnEvery: 5.4, hints: ['「免費擦車哥」在收銀台不擦車不付錢：去西側牆邊拿拖把，拿著拖把對他「幫他擦車窗」。'] }),
      S({ id: '9-4', title: '下班後的健身房', map: 'gym', length: 170, goal: 470, karens: ['benchhog', 'streamer', 'litterer'], maxKarens: 2, foods: ['coffee'], events: ['rush'], eventEvery: 60, spawnEvery: 5.6, hints: ['「器材霸主」霸佔器材時，全店排隊的人耐心都掉得快：「請他讓出器材」要說三次。'] }),
      S({ id: '9-5', title: '情人節牛排', map: 'steak', length: 180, goal: 520, karens: ['doneness', 'custom', 'rager'], maxKarens: 2, foods: ['coffee', 'meal'], events: ['rush'], eventEvery: 60, spawnEvery: 5.6, hints: ['「熟度魔人」坐著大罵不是五分熟：到鐵板重煎一份，拿著它對他「送上重煎的」，他會付錢。'] }),
      S({ id: '9-6', title: '回鍋宵夜', map: 'chicken', length: 180, goal: 420, karens: ['refry', 'custom', 'cutter'], maxKarens: 3, foods: ['coffee', 'meal'], events: ['outage'], spawnEvery: 5.2, hints: ['雞排店的「回鍋魔人」在收銀台嫌不夠酥：炸一塊現炸的，拿著它對他「換一塊現炸的」。'] }),
    ],
  },
  {
    n: 10, title: '全台奧客圖鑑', place: '3C 賣場・美髮院・郵局・藥局・飯店・便利商店', minLevel: 29, baseExp: 880, register2: true,
    story: '圖鑑只差最後幾頁：退貨、剪髮、寄包裹、買藥、住飯店。最後，圖鑑裡的奧客一起回到了錢董的便利商店。',
    shifts: [
      S({ id: '10-1', title: '開箱退貨潮', map: 'electronics', length: 160, goal: 1000, karens: ['unboxer', 'cutter', 'hog'], maxKarens: 2, spawnEvery: 5.4, hints: ['「拆封退貨王」在服務台要退自己摔壞的耳機：「檢查拆封痕跡」兩次，或直接退款 $40；放著不管會被迫退 $80。'] }),
      S({ id: '10-2', title: '婚禮前一天', map: 'salon', length: 170, goal: 590, karens: ['photo', 'rager', 'cutter'], maxKarens: 3, foods: ['coffee', 'meal'], spawnEvery: 5.2, hints: ['「照片魔人」剪好兩次都說不像：可以一直重剪，或「拿照片比對」好好說明。'] }),
      S({ id: '10-3', title: '月初領年金', map: 'post', length: 170, goal: 355, karens: ['coins', 'cutter', 'rager'], maxKarens: 3, events: ['rush'], spawnEvery: 5.2, hints: ['「一袋零錢阿伯」在櫃台倒出一整袋硬幣：要「幫他數零錢」三次才結得了帳，第二台收銀機先顧著。'] }),
      S({ id: '10-4', title: '流感季', map: 'pharmacy', length: 170, goal: 530, karens: ['rx', 'cutter', 'charger'], maxKarens: 3, events: ['rush'], eventEvery: 60, spawnEvery: 5.4, hints: ['「無處方硬要藥」在櫃台越講越大聲：「堅持要處方箋」讓他降火，或「推薦成藥」；火氣滿了會大鬧。'] }),
      S({ id: '10-5', title: '連假客滿', map: 'hotel', length: 180, goal: 500, karens: ['upgrader', 'rager', 'charger'], maxKarens: 2, foods: ['coffee'], events: ['rush'], firstEvent: 60, eventEvery: 70, spawnEvery: 5.6, hints: ['「硬要升等」堅持自己是 VIP：「說明今天客滿」三次，或花 $25「送早餐券」。'] }),
      S({ id: '10-6', title: '圖鑑大集合', length: 200, goal: 545, karens: ['coins', 'unboxer', 'toucher', 'kicker', 'upgrader', 'taster', 'wiper'], maxKarens: 3, karenEvery: 38, foods: ['coffee', 'meal'], events: ['rush', 'outage'], eventEvery: 55, spawnEvery: 5, expMul: 1.5, hints: ['圖鑑裡的奧客全部來到錢董的便利商店！每一種都用它自己的方法處理，記得看畫面上方的提示。'] }),
    ],
  },
];
export function allShifts() { return CHAPTERS.flatMap(c => c.shifts.map(s => ({ ...s, chapter: c.n }))); }
export function findShift(id: string) {
  for (const c of CHAPTERS) { const s = c.shifts.find(x => x.id === id); if (s) return { chapter: c, shift: s }; }
  return null;
}

/** A chapter is open when its level requirement is met and the previous chapter's last shift is cleared. */
export function chapterUnlocked(p: CareerProfile, n: number): { ok: boolean; why?: string } {
  const c = CHAPTERS.find(x => x.n === n);
  if (!c) return { ok: false, why: '不存在' };
  if (c.coming) return { ok: false, why: '製作中，敬請期待' };
  if (n > 1) {
    const prev = CHAPTERS.find(x => x.n === n - 1)!;
    const last = prev.shifts[prev.shifts.length - 1];
    if (!p.stars[last.id]) return { ok: false, why: `先通過第 ${n - 1} 章「${last.title}」` };
  }
  if (p.level < c.minLevel) return { ok: false, why: `需要 Lv.${c.minLevel}（${rankOf(c.minLevel)}）` };
  return { ok: true };
}
export function shiftUnlocked(p: CareerProfile, id: string): { ok: boolean; why?: string } {
  const f = findShift(id);
  if (!f) return { ok: false, why: '不存在' };
  const ch = chapterUnlocked(p, f.chapter.n);
  if (!ch.ok) return ch;
  const i = f.chapter.shifts.findIndex(s => s.id === id);
  if (i > 0 && !p.stars[f.chapter.shifts[i - 1].id]) return { ok: false, why: '先通過前一個班次' };
  return { ok: true };
}

export const ENDLESS_ID = 'endless';
export function endlessUnlocked(p: CareerProfile) { return (p.stars['6-3'] ?? 0) > 0; }

export function buildShiftConfig(p: CareerProfile, id: string): ShiftConfig {
  if (id === ENDLESS_ID) {
    return {
      mode: 'shift', id, title: '無限夜班', chapter: 7, length: 1e6, goal: 0,
      karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], firstKaren: 25, karenEvery: 40, maxKarens: 2,
      spawnEvery: 6.5, maxCustomers: 20, foods: ['coffee', 'meal'], foodChance: 0.35, events: ['rush', 'outage'], firstEvent: 50,
      register2: true, abilities: abilitiesAt(p.level),
      start: { money: 120, rating: 3, backstock: { drinks: 40, snacks: 40, bento: 30 }, shelves: { drinks: 10, snacks: 10, bento: 8 } },
      mods: modsFor(p), hints: ['無限夜班：撐越久分數越高，客人和奧客會越來越多。混亂爆表或口碑歸零就下班。'], boss: false, bossAt: 0, endless: true,
    };
  }
  const f = findShift(id);
  if (!f) throw new Error('unknown shift ' + id);
  const { chapter: c, shift: s } = f;
  const stockScale = 1 + (c.n - 1) * 0.35;
  return {
    mode: 'shift', id: s.id, title: s.title, chapter: c.n, length: s.length, goal: s.goal,
    karens: s.karens, firstKaren: s.firstKaren ?? 28, karenEvery: s.karenEvery ?? 45, maxKarens: s.maxKarens ?? 1 + Math.floor(c.n / 2),
    spawnEvery: s.spawnEvery ?? 8, maxCustomers: 8 + c.n * 2,
    foods: s.foods ?? [], foodChance: 0.35, events: s.events ?? [], firstEvent: s.firstEvent ?? 40,
    ...(s.eventEvery ? { eventEvery: s.eventEvery } : {}),
    register2: !!c.register2, abilities: abilitiesAt(p.level),
    start: {
      money: 80, rating: 3,
      backstock: { drinks: Math.round(24 * stockScale), snacks: Math.round(24 * stockScale), bento: Math.round(18 * stockScale) },
      shelves: { drinks: 8, snacks: 8, bento: 6 },
    },
    mods: modsFor(p), hints: s.hints ?? [], boss: !!s.boss, bossAt: 40, endless: false, map: s.map,
  };
}

// ---------------- daily challenge ----------------
export const DAILY_ID = 'daily';
export type DailyModId = 'outages' | 'streamers' | 'chargers' | 'rush' | 'coffee' | 'lowstock' | 'tips';
export const DAILY_MODS: Record<DailyModId, { name: string; desc: string }> = {
  outages: { name: '停電頻繁', desc: '每 24 秒就可能停電一次' },
  streamers: { name: '全是直播主', desc: '奧客只剩直播客，而且多一個' },
  chargers: { name: '插座保衛戰', desc: '奧客只剩充電霸王，而且多一個' },
  rush: { name: '雙倍人潮', desc: '客人來得快很多，目標 +15%' },
  coffee: { name: '咖啡狂熱', desc: '大部分客人都要咖啡，目標 +25%' },
  lowstock: { name: '缺貨危機', desc: '倉庫庫存只有一半' },
  tips: { name: '小費日', desc: '小費 +60%，目標 +12%' },
};
const DAILY_MOD_IDS = Object.keys(DAILY_MODS) as DailyModId[];

/** Daily challenge opens after the first chapter. */
export function dailyUnlocked(p: CareerProfile) { return (p.stars['1-5'] ?? 0) > 0; }
/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function prevDate(date: string) { const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }
export function dailySeed(date: string) { let h = 2166136261; for (const ch of 'fucustomer-daily-' + date) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function seededRng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Same scene and modifiers for everyone on a given date; difficulty follows the player's progress. */
export function dailyPlan(p: CareerProfile, date: string) {
  const rng = seededRng(dailySeed(date));
  // scenes (and difficulty) come from the convenience-store chapters 1–7; chapters 8+ are other stores' own goals
  const scene = 1 + Math.floor(rng() * 7);
  // a different kind of store each day
  const map = MAPS[Math.floor(rng() * MAPS.length)].id;
  const md = MAPS.find(m => m.id === map);
  // a 'coffee rush' day only makes sense where drinks are made but are not already most of the orders
  const coffeeDay = !!md?.coffee && (md?.foodChance ?? 0) < 0.6;
  const pool = DAILY_MOD_IDS.filter(m => m !== 'coffee' || coffeeDay);
  const first = pool[Math.floor(rng() * pool.length)];
  const mods: DailyModId[] = [first];
  if (rng() < 0.6) {
    const karenMod = (m: DailyModId) => m === 'streamers' || m === 'chargers';
    const rest = pool.filter(m => m !== first && !(karenMod(m) && karenMod(first)));
    mods.push(rest[Math.floor(rng() * rest.length)]);
  }
  let open = 1; for (const c of CHAPTERS) if (chapterUnlocked(p, c.n).ok) open = c.n;
  return { date, scene, difficulty: Math.min(scene, open), mods, map };
}

export function buildDailyConfig(p: CareerProfile, date: string): ShiftConfig {
  const plan = dailyPlan(p, date);
  const ch = CHAPTERS[plan.difficulty - 1];
  const base = ch.shifts[Math.min(2, ch.shifts.length - 1)];
  const cfg = buildShiftConfig(p, base.id);
  const mapDef = MAPS.find(m => m.id === plan.map)!;
  cfg.id = DAILY_ID; cfg.title = `每日挑戰・${mapDef.icon}${mapDef.name}`; cfg.map = plan.map;
  cfg.length = 150;
  let goal = base.goal * (150 / base.length);
  for (const m of plan.mods) {
    if (m === 'outages') { cfg.events = [...new Set([...cfg.events, 'outage' as ShiftEvent])]; cfg.firstEvent = 20; cfg.eventEvery = 24; goal *= 0.95; }
    if (m === 'streamers') { cfg.karens = ['streamer']; cfg.maxKarens += 1; cfg.firstKaren = 15; goal *= 0.9; }
    if (m === 'chargers') { cfg.karens = ['charger']; cfg.maxKarens += 1; cfg.firstKaren = 15; }
    if (m === 'rush') { cfg.spawnEvery *= 0.6; cfg.maxCustomers += 6; goal *= 1.15; }
    if (m === 'coffee') { cfg.foods = [...new Set([...cfg.foods, 'coffee' as Food])]; cfg.foodChance = 0.75; goal *= 1.25; }
    if (m === 'lowstock') { const st = cfg.start.backstock as Record<string, number>; for (const k of Object.keys(st)) st[k] = Math.ceil(st[k] / 2); }
    if (m === 'tips') { cfg.mods = { ...cfg.mods, tips: cfg.mods.tips * 1.6 }; goal *= 1.12; }
  }
  // store-specific karens only appear in their own store
  const specific = new Set(MAPS.flatMap(m => m.karens ?? []));
  cfg.karens = cfg.karens.filter(k => !specific.has(k) || (mapDef.karens ?? []).includes(k));
  // the store's own karen joins in (unless today is a one-karen-type day)
  if (!plan.mods.includes('streamers') && !plan.mods.includes('chargers')) cfg.karens = [...new Set([...cfg.karens, ...(mapDef.karens ?? [])])];
  if (!cfg.karens.length) { cfg.karens = ['cutter']; cfg.maxKarens = Math.max(1, cfg.maxKarens); }
  cfg.goal = Math.round(goal * (mapDef.goalScale ?? 1) / 5) * 5;
  cfg.hints = [`今日修飾：${plan.mods.map(m => DAILY_MODS[m].name).join('＋')}。每天第一次達標可領獎勵。`];
  cfg.daily = { date, mods: plan.mods, scene: plan.scene };
  return cfg;
}

// ---------------- results & rewards ----------------
export interface ShiftResult {
  shiftId: string; won: boolean; failReason: string; revenue: number; goal: number; rating: number; chaos: number;
  served: number; angryLeft: number; karensResolved: number; karensFailed: number; ejected: number; cleaned: number; maxCombo: number;
  score?: number; survived?: number; bossDefeated?: boolean;
  /** Tips from customers (already included in revenue) — the worker keeps these. */
  tips?: number;
  /** Everyone you hit this shift; any illegal hit or VIP hit means the police come. */
  incidents?: Incident[];
  /** Daily challenge date (YYYY-MM-DD). */
  date?: string;
  /** Weekly challenge ISO week (YYYY-Www). */
  week?: string;
  /** Karens handled this shift, by kind (for the 奧客圖鑑). */
  handled?: Record<string, number>;
}
/** Star thresholds (career-only; saved stars are just numbers, so changing these never breaks a save). */
export const STAR_RATING = 2.8, STAR_CHAOS = 60, STAR_REVENUE = 1.15;
export function starsFor(r: ShiftResult) {
  if (r.shiftId === ENDLESS_ID) { const sc = r.score ?? 0; return sc >= 3000 ? 3 : sc >= 1600 ? 2 : sc >= 800 ? 1 : 0; }
  if (!r.won) return 0;
  let s = 1;
  // ★2: the store kept its reputation (shifts start at 3.0; empty shelves and spills wear it down) and stayed tidy.
  // ★3: 115% of the target with no karen mishandled. (Before the balance pass: 3.5 / 130%, which a solo player
  // practically never reached — see docs/BALANCE.md.)
  if (r.rating >= STAR_RATING && r.chaos < STAR_CHAOS) s++;
  if (r.revenue >= r.goal * STAR_REVENUE && r.karensFailed === 0 && r.angryLeft <= 1) s++;
  return s;
}

export interface Reward {
  stars: number; exp: number; wallet: number; levels: number[]; firstClear: boolean; newBest: boolean;
  /** Daily challenge: reward already taken today (this run paid nothing), current win streak. */
  daily?: { already: boolean; streak: number };
  /** Career shifts: how the pay was worked out (wallet already includes it). */
  pay?: Pay;
  /** Set after an interrogation: what was paid (fine + lawyer) and the final verdict. */
  court?: { fine: number; text: string };
  /** Weekly challenge: which goals this run met, which were paid for the first time, whether the badge was earned. */
  weekly?: { week: string; met: boolean[]; newly: number[]; badge: boolean };
  /** 常客奧客 (filled in by the client): the stage's ending lines, and the arc's free reward when it was the last stage. */
  arc?: { title: string; lines: { icon: string; name: string; text: string }[]; gift?: string };
}
export interface Pay { wage: number; bonus: number; cut: number; cutReason: string; tips: number; extra: number }

/** 錢董's excuses for docking your pay. */
export const BOSS_EXCUSES = [
  '制服清潔費', '收銀機短少（明明是他自己拿的）', '打卡晚了 1 分鐘', '空調電費分攤', '員工旅遊預繳（從來沒去過）',
  '「公司今年很辛苦」', '試吃品損耗', '拖把折舊費', '「年輕人要學習，不要計較」', '招牌燈泡錢', '「你笑得不夠親切」',
];
function hashStr(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Shift pay: hourly wage + sales bonus, then the boss skims 15–45% (less when you earn 3 stars); tips are yours. */
export function shiftPay(chapter: number, r: ShiftResult, stars: number): Pay {
  const tips = Math.max(0, Math.round(r.tips ?? 0));
  const wage = Math.round((40 + 20 * chapter) * (r.won ? 1 : 0.6));
  const bonus = Math.round(Math.max(0, r.revenue - tips) * 0.12);
  const h = hashStr(`${r.shiftId}:${r.revenue}:${r.served}:${r.ejected}`);
  const pct = Math.min(0.45, Math.max(0.15, 0.36 - 0.06 * stars + ((h % 100) / 100) * 0.12));
  const cut = Math.round((wage + bonus) * pct);
  const extra = r.ejected * 4 + r.cleaned * 2;
  return { wage, bonus, cut, cutReason: BOSS_EXCUSES[(h >>> 8) % BOSS_EXCUSES.length], tips, extra };
}
export const payTotal = (p: Pay) => p.wage + p.bonus - p.cut + p.tips + p.extra;
/** Applies a finished shift to the profile. EXP: full on first clear, 60% on replays, 35% on a failed attempt. */
export function applyResult(p: CareerProfile, r: ShiftResult): Reward {
  addHandled(p.dex, r.handled);
  if (r.shiftId === ENDLESS_ID) {
    const score = r.score ?? 0;
    const prevBest = p.endlessBest;
    const exp = Math.round(Math.min(2500, score * 0.4));
    const wallet = Math.round(score * 0.15 + r.ejected * 4);
    p.wallet += wallet; p.stats.shifts++; p.stats.served += r.served; p.stats.ejected += r.ejected; p.stats.karens += r.karensResolved; p.stats.revenue += r.revenue;
    p.endlessBest = Math.max(prevBest, score);
    const levels = addExp(p, exp);
    return { stars: starsFor(r), exp, wallet, levels, firstClear: false, newBest: score > prevBest };
  }
  if (r.shiftId === DAILY_ID) return applyDaily(p, r);
  const f = findShift(r.shiftId);
  const base = f?.chapter.baseExp ?? 100;
  const stars = starsFor(r);
  const prevStars = p.stars[r.shiftId] ?? 0;
  const firstClear = stars > 0 && prevStars === 0;
  const mul = f?.shift.expMul ?? 1;
  let exp = (r.won ? base * (0.7 + 0.15 * stars) * (firstClear || stars > prevStars ? 1 : 0.6) : base * 0.35) * mul;
  exp = Math.round(exp);
  const pay = shiftPay(f?.chapter.n ?? 1, r, stars);
  const wallet = payTotal(pay);
  p.wallet += wallet;
  p.stats.shifts++; if (r.won) p.stats.wins++;
  p.stats.served += r.served; p.stats.ejected += r.ejected; p.stats.karens += r.karensResolved; p.stats.revenue += r.revenue;
  if (stars > prevStars) p.stars[r.shiftId] = stars;
  if (r.won) p.clears[r.shiftId] = (p.clears[r.shiftId] ?? 0) + 1;
  if (r.shiftId === '6-3' && r.won && p.title !== '終極打工人') p.title = '奧客剋星';
  const levels = addExp(p, exp);
  return { stars, exp, wallet, levels, firstClear, newBest: stars > prevStars, pay };
}

function applyDaily(p: CareerProfile, r: ShiftResult): Reward {
  const date = r.date ?? '';
  if (p.daily.date !== date) p.daily = { ...p.daily, date, best: 0, rewarded: false };
  const stars = starsFor(r);
  const newBest = r.revenue > p.daily.best;
  p.daily.best = Math.max(p.daily.best, r.revenue);
  p.stats.shifts++; if (r.won) p.stats.wins++;
  p.stats.served += r.served; p.stats.ejected += r.ejected; p.stats.karens += r.karensResolved; p.stats.revenue += r.revenue;
  const already = p.daily.rewarded;
  let exp = 0, wallet = 0;
  if (!already) {
    // difficulty follows progress, so the reward does too: about one shift of the player's newest chapter
    let open = 1; for (const c of CHAPTERS) if (chapterUnlocked(p, c.n).ok) open = c.n;
    const base = CHAPTERS[open - 1].baseExp;
    if (r.won) {
      exp = Math.round(base * (1 + 0.15 * stars)); wallet = Math.round(r.revenue * 0.25 + 100 + stars * 30);
      p.daily.rewarded = true; p.daily.wins++;
      p.daily.streak = p.daily.lastWin === prevDate(date) ? p.daily.streak + 1 : 1;
      p.daily.lastWin = date;
    } else { exp = Math.round(base * 0.25); wallet = 15; }
  }
  p.wallet += wallet;
  const levels = addExp(p, exp);
  return { stars, exp, wallet, levels, firstClear: false, newBest, daily: { already, streak: p.daily.streak } };
}

function sanitizeStore(v: unknown, int: (x: unknown, lo: number, hi: number, d: number) => number): OwnStore | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<OwnStore>;
  const sv = o.save as Partial<StoreSave> | undefined;
  if (!sv || typeof sv !== 'object' || typeof sv.money !== 'number' || !sv.backstock || !sv.shelves || !sv.upgrades) return null;
  const wage: WageMode = o.wage === 'kind' || o.wage === 'stingy' ? o.wage : 'fair';
  const staff = o.staff && typeof o.staff === 'object' ? o.staff : { name: '小陳', mood: 70, quit: false };
  const st: OwnStore = {
    name: typeof o.name === 'string' ? o.name.slice(0, 16) : '我的便利商店',
    invested: int(o.invested, 0, 1e9, 0), save: { ...(sv as StoreSave), money: int(sv.money, -1e6, 1e9, 0), day: int(sv.day, 1, 1e6, 1), rating: Math.max(0, Math.min(5, Number(sv.rating) || 0)) },
    days: int(o.days, 0, 1e6, 0), negDays: int(o.negDays, 0, 3, 0), wage, bestDay: int(o.bestDay, -1e6, 1e9, 0), withdrawn: int(o.withdrawn, 0, 1e9, 0),
    staff: { name: typeof staff.name === 'string' ? staff.name.slice(0, 8) : '小陳', mood: int(staff.mood, 0, 100, 70), quit: staff.quit === true },
    map: typeof o.map === 'string' && /^[a-z0-9-]{1,24}$/.test(o.map) ? o.map : 'convenience',
    online: o.online && typeof o.online === 'object' && typeof o.online.code === 'string' && /^[A-Z0-9]{6}$/.test(o.online.code) && typeof o.online.token === 'string' && o.online.token.length <= 64
      ? { code: o.online.code, token: o.online.token, locked: o.online.locked === true } : undefined,
  };
  // 店面等級 and 連鎖分店 (progression.ts); stores from before them start at Lv1 with no branches
  st.prog = sanitizeProg(o.prog);
  st.branches = sanitizeBranches(o.branches, st.map);
  return st;
}

// ---------------- weekly challenge & 常客奧客 arcs: profile state ----------------
export const WEEK_RE = /^\d{4}-W\d{2}$/;
/** Profile state: this week's goals already paid (bitmask), best revenue, play count, and every week's badge earned. */
export interface WeeklyState { week: string; done: number; best: number; plays: number; badges: string[] }
export function newWeekly(): WeeklyState { return { week: '', done: 0, best: 0, plays: 0, badges: [] }; }
export function sanitizeWeekly(v: unknown): WeeklyState {
  const w = newWeekly();
  if (!v || typeof v !== 'object') return w;
  const o = v as Partial<WeeklyState>;
  const int = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.floor(x))) : lo);
  w.week = typeof o.week === 'string' && WEEK_RE.test(o.week) ? o.week : '';
  w.done = w.week ? int(o.done, 0, 7) : 0;
  w.best = w.week ? int(o.best, 0, 1e7) : 0;
  w.plays = int(o.plays, 0, 1e6);
  if (Array.isArray(o.badges)) w.badges = [...new Set(o.badges.filter((b): b is string => typeof b === 'string' && WEEK_RE.test(b)))].sort().slice(-520);
  return w;
}


/** Arc progress: stages cleared, pre-shift scenes already shown, and the shift count when the last stage was cleared. */
export function sanitizeArcs(v: unknown): Record<string, ArcState> {
  const out: Record<string, ArcState> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const int = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.floor(x))) : lo);
  for (const a of ARCS) {
    const o = (v as Record<string, unknown>)[a.id] as Partial<ArcState> | undefined;
    if (!o || typeof o !== 'object') continue;
    const stage = int(o.stage, 0, a.stages.length);
    out[a.id] = { stage, seen: Math.max(stage, int(o.seen, 0, Math.min(a.stages.length, stage + 1))), at: int(o.at, 0, 1e9) };
  }
  return out;
}
