// Authoritative game simulation. Runs on the dedicated server for multiplayer and inside the
// browser for solo/career play. All transactions (money, stock, items, karen outcomes) happen here.
import type { Outfit } from './shop.ts';
import {
  BOSS_PHASES, BOX_SIZE, BURST_MAX, CHAOS_MAX, CLOSE_MINUTE, CLOSING_MAX_SECONDS, FOOD_INFO, DAILY_RENT, DAY_OPEN_SECONDS, KAREN_INFO,
  KarenKind, OPEN_MINUTE, PREP_SECONDS, PRODUCTS, ALL_PRODUCTS, type StockIn, PRODUCT_INFO, Product, RUN_SPEED, SERVER_INTERACT_RANGE,
  UPGRADES, UPGRADE_IDS, UpgradeId, brewTime, checkoutTime, heatTime, shelfCapacity, matSkip, selfcheckEvery, doorbellBoost, cameraCalm,
} from './constants.ts';
import {
  CHARGE_SPOT, COFFEE_MACHINE, COFFEE_PICKUP, COMPLAINT_SPOT, COUNTER, CRATES, DECOR, DOOR_X0, DOOR_X1, ENTRANCE, MICROWAVE, MOP_RACK,
  PLAYER_SPAWNS, QUEUE_SPOTS, REGISTERS, SHELVES, SPAWN_OUTSIDE, STORE_D, WANDER_SPOTS, CURRENT_MAP, TRYON_SPOTS, CAMP_SPOTS, clampToStore, distToAABB, findPath,
  resolveCollision, shelfBrowseSpots, applyMap,
} from './map.ts';
import { SIG_KARENS, SigKarenDef, SigNeed, isSig, sigDef, sigWaitReason } from './sigkarens.ts';
import type {
  ActKind, CustomerKind, DayStats, GameEvent, Held, Phase, Snapshot, StoreSave, Target,
} from './protocol.ts';
import { BASE_MODS, Food, Incident, ShiftConfig, ShiftResult } from './career.ts';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Busy { kind: ActKind; target: Target; start: number; dur: number; rid: string; reserved?: Product }
export interface PlayerState {
  id: string; name: string; color: number; x: number; z: number; yaw: number; pitch: number;
  held: Held | null; held2: Held | null; connected: boolean; away: boolean; ready: boolean; busy: Busy | null;
  lastInputAt: number; recent: Map<string, { ok: boolean; reason?: string }>;
  grabbing: number | null; spinReadyAt: number; hitReadyAt?: number;
  /** Friend-store raid: this player is the troublemaker. */
  raider?: boolean; litterAt?: number;
  /** Cosmetics others see (shared/shop.ts); purely visual. */
  outfit?: Outfit;
  /** 電腦店員補位: a server-run fill-in clerk (shared/bot.ts), never a real player. */
  bot?: boolean;
  stats: { served: number; karens: number; cleaned: number; restocked: number; ejected: number };
}

type CState =
  | 'enter' | 'toShelf' | 'browse' | 'toFood' | 'waitFood' | 'queue' | 'toRegister' | 'atRegister'
  | 'leaving' | 'toComplain' | 'complain' | 'wander' | 'flee' | 'toEat' | 'eat' | 'held' | 'flying' | 'toSummon' | 'summon' | 'toCharge' | 'charge' | 'toTry' | 'tryon'
  | 'toCamp' | 'camp';

export interface Flight { vx: number; vy: number; vz: number; y: number; t: number; thrown: boolean; by: string }

export interface Customer {
  id: number; kind: CustomerKind; x: number; z: number; yaw: number; state: CState;
  path: { x: number; z: number }[]; speed: number;
  shopping: Product[]; items: Product[]; want: Food | null; foodDone: boolean; foodFailed: boolean;
  patience: number; patienceMax: number; mood: number; timer: number; register: number; anger: number;
  resolved: boolean; hits: number; eaten: Product[]; eatShelf: Product | null; life: number; look: number;
  angry: boolean; moving: boolean; knockTimer: number; gone: boolean;
  heldBy: string | null; fly: Flight | null;
  phase: number; minions: number[];
  /** Thrown out: seconds left lying dazed on the pavement before getting up and walking off. */
  downT?: number; ejected?: boolean;
  /** Too heavy to pick up unless stunned. */
  heavy?: boolean;
  /** Has connections: hitting them always brings the police. */
  vip?: boolean;
  /** Seconds left dazed after being hit. */
  stunT?: number;
  /** Time this karen last shoved a worker (makes hitting back self-defence for a while). */
  shoveAt?: number;
  /** Store-signature karens: how long they keep it up in total (for the overhead bar). */
  lifeMax?: number;
}

export interface World {
  cfg: ShiftConfig;
  incidents: Incident[];
  /** Friend-store raid progress: score, how long the staff has been watching you, counts. */
  raid: { score: number; watched: number; caught: boolean; knocked: number; litter: number; heckled: number } | null;
  time: number; phase: Phase; phaseLeft: number; clock: number; day: number;
  money: number; rating: number; backstock: Record<Product, number>; shelves: Record<Product, number>;
  upgrades: Record<UpgradeId, number>; mopsOnRack: number;
  players: Map<string, PlayerState>; customers: Customer[]; queue: number[]; registers: (number | null)[];
  spills: { id: number; x: number; z: number; born: number }[];
  items: { id: number; x: number; z: number; held: Held }[];
  pings: { id: number; x: number; z: number; by: string; until: number }[];
  nextId: number; rng: () => number; spawnTimer: number; karenTimer: number; mopbotTimer: number;
  /** 自助結帳機: seconds until the kiosk serves the next small basket. */
  selfTimer: number;
  dayStats: DayStats; bonusPaidDay: number; totals: StoreSave['totals'];
  events: GameEvent[]; results: { playerId: string; rid: string; ok: boolean; reason?: string }[];
  emptyShelfToastAt: number; saveOut: StoreSave | null; difficultyPlayers: number;
  /** What `saveOut` is: the nightly settlement, or a purchase made between days (no settlement). */
  saveKind?: 'night' | 'purchase';
  chaos: number; chaosTimer: number; burst: number; combo: number; comboUntil: number;
  power: number; event: { kind: 'rush' | 'outage'; left: number; pulse: number } | null; nextEvent: number;
  guardTimer: number; hintQueue: { at: number; text: string }[]; result: ShiftResult | null;
  bossSpawned: boolean; bossDefeated: boolean; bossTimer: number; rampTimer: number; openTime: number;
  /** Kind of the last karen spawned this shift ('' = none yet). */
  lastKaren?: string;
  /** Karens handled today, by kind (goes into the shift result for the 奧客圖鑑). */
  handled: Record<string, number>;
}

/** Default multiplayer "business day" configuration: every mechanic enabled. */
export function dayConfig(): ShiftConfig {
  return {
    mode: 'day', id: 'day', title: '合作營業日', chapter: 0, length: DAY_OPEN_SECONDS, goal: 0, map: CURRENT_MAP.id,
    karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', ...(CURRENT_MAP.karens ?? [])], firstKaren: 22, karenEvery: 50, maxKarens: 1,
    spawnEvery: 9, maxCustomers: 6, foods: ['coffee', 'meal'], foodChance: CURRENT_MAP.foodChance, events: ['rush', 'outage'], firstEvent: 70,
    register2: false, abilities: ['grab', 'spin', 'ultimate'],
    start: { money: 200, rating: 3, backstock: { drinks: 24, snacks: 24, bento: 18, extra: 24 }, shelves: { drinks: 8, snacks: 8, bento: 6, extra: 8 } },
    mods: { ...BASE_MODS }, hints: [], boss: false, bossAt: 0, endless: false,
  };
}

export function defaultSave(): StoreSave {
  return {
    version: 1, day: 1, money: 200, rating: 3,
    backstock: { drinks: 24, snacks: 24, bento: 18, extra: 24 },
    shelves: { drinks: 8, snacks: 8, bento: 6, extra: 8 },
    upgrades: Object.fromEntries(UPGRADE_IDS.map(u => [u, 0])) as Record<UpgradeId, number>,
    totals: { served: 0, karens: 0, revenue: 0 },
  };
}

/** Validate and sanitize a save coming from a client (host). */
export function sanitizeSave(s: unknown): StoreSave {
  const d = defaultSave();
  if (!s || typeof s !== 'object') return d;
  const o = s as Partial<StoreSave>;
  const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  const out = defaultSave();
  out.day = Math.round(num(o.day, 1, 9999, d.day));
  out.money = Math.round(num(o.money, -99999, 999999, d.money));
  out.rating = num(o.rating, 0, 5, d.rating);
  // the optional fourth line ('extra') of older saves starts like the drinks line
  const def = (rec: Partial<Record<Product, unknown>> | undefined, p: Product) => (p === 'extra' && typeof rec?.extra !== 'number' ? rec?.drinks : rec?.[p]);
  for (const p of ALL_PRODUCTS) out.backstock[p] = Math.round(num(def(o.backstock, p), 0, 999, d.backstock[p]));
  for (const u of UPGRADE_IDS) out.upgrades[u] = Math.round(num(o.upgrades?.[u], 0, UPGRADES[u].costs.length, 0));
  for (const p of ALL_PRODUCTS) out.shelves[p] = Math.round(num(def(o.shelves, p), 0, shelfCapacity(out.upgrades.shelves), d.shelves[p]));
  out.totals.served = Math.round(num(o.totals?.served, 0, 1e9, 0));
  out.totals.karens = Math.round(num(o.totals?.karens, 0, 1e9, 0));
  out.totals.revenue = Math.round(num(o.totals?.revenue, 0, 1e12, 0));
  return out;
}

function emptyStats(rating: number): DayStats {
  return { revenue: 0, served: 0, angryLeft: 0, karensResolved: 0, karensFailed: 0, spillsCleaned: 0, tips: 0, expenses: 0, bonus: 0, ratingStart: rating, ejected: 0, maxCombo: 0 };
}

export function createWorld(save: StoreSave = defaultSave(), seed = Date.now(), cfg: ShiftConfig = dayConfig()): World {
  // the world is always built on its own map (career shifts: 便利商店)
  if ((cfg.map ?? 'convenience') !== CURRENT_MAP.id) applyMap(cfg.map);
  // only sell the prepared food this map has a station for (a clothes shop has none)
  cfg.foods = cfg.foods.filter(f => (f === 'coffee' ? CURRENT_MAP.coffee : CURRENT_MAP.meal) != null);
  const s = sanitizeSave(save);
  const shift = cfg.mode === 'shift';
  const upgrades = { ...s.upgrades };
  if (cfg.register2) upgrades.register2 = 1;
  const w: World = {
    cfg, time: 0, phase: 'prep', phaseLeft: shift ? 10 : PREP_SECONDS, clock: OPEN_MINUTE, day: s.day,
    money: shift ? cfg.start.money : s.money, rating: shift ? cfg.start.rating : s.rating,
    backstock: shift ? fullStock(cfg.start.backstock) : { ...s.backstock }, shelves: shift ? fullStock(cfg.start.shelves) : { ...s.shelves },
    upgrades, mopsOnRack: 2, players: new Map(), customers: [], queue: [], registers: [null, null], spills: [], items: [], pings: [],
    nextId: 1, rng: mulberry32(seed), spawnTimer: 3, karenTimer: cfg.firstKaren, mopbotTimer: 20, selfTimer: 8,
    dayStats: emptyStats(shift ? cfg.start.rating : s.rating), bonusPaidDay: 0, totals: { ...s.totals }, events: [], results: [],
    emptyShelfToastAt: -99, saveOut: null, difficultyPlayers: 1,
    incidents: [], raid: cfg.raid ? { score: 0, watched: 0, caught: false, knocked: 0, litter: 0, heckled: 0 } : null, chaos: 0, chaosTimer: 0, burst: 0, combo: 0, comboUntil: 0, power: 1, event: null, nextEvent: cfg.firstEvent,
    guardTimer: guardInterval(cfg.mods.guard), hintQueue: cfg.hints.map((text, i) => ({ at: 1 + i * 16, text })), result: null,
    bossSpawned: false, bossDefeated: false, bossTimer: 0, rampTimer: 0, openTime: 0, handled: {},
  };
  // shifts start with one visible spill so cleaning is discoverable (as in v0.4)
  if (shift && cfg.chapter === 1) w.spills.push({ id: w.nextId++, x: 11.4, z: 9.2, born: 0 });
  return w;
}
/** A shift's starting stock with the optional fourth line filled in (it starts like the drinks line). */
function fullStock(v: StockIn): Record<Product, number> { return { ...v, extra: v.extra ?? v.drinks }; }
function guardInterval(level: number) { return Math.max(12, 36 - level * 6); }

export function toSave(w: World): StoreSave {
  return {
    version: 1, day: w.day, money: w.money, rating: Math.round(w.rating * 100) / 100,
    backstock: { ...w.backstock }, shelves: { ...w.shelves }, upgrades: { ...w.upgrades }, totals: { ...w.totals },
  };
}

// ---------------- players ----------------
export function addPlayer(w: World, id: string, name: string, color: number): PlayerState {
  const spawn = PLAYER_SPAWNS[w.players.size % PLAYER_SPAWNS.length];
  const p: PlayerState = {
    id, name, color, x: spawn.x, z: spawn.z, yaw: Math.PI, pitch: 0, held: null, held2: null, connected: true, away: false,
    ready: false, busy: null, lastInputAt: w.time, recent: new Map(), grabbing: null, spinReadyAt: 0,
    stats: { served: 0, karens: 0, cleaned: 0, restocked: 0, ejected: 0 },
  };
  // the first one in a raid is the troublemaker; they come in through the front door
  if (w.raid && w.players.size === 0) { p.raider = true; p.x = ENTRANCE.x; p.z = ENTRANCE.z - 0.6; p.yaw = Math.PI; }
  w.players.set(id, p);
  return p;
}

/** Remove a player permanently; anything they carried goes back into the world (never duplicated). */
export function removePlayer(w: World, id: string) {
  const p = w.players.get(id);
  if (!p) return;
  releaseGrab(w, p);
  dropHeld(w, p);
  w.players.delete(id);
}

export function playerDisconnected(w: World, id: string) {
  const p = w.players.get(id);
  if (!p) return;
  p.connected = false; p.busy = null; p.ready = false;
  releaseGrab(w, p);
}

function dropHeld(w: World, p: PlayerState) {
  for (const key of ['held2', 'held'] as const) {
    const h = p[key];
    if (!h) continue;
    p[key] = null;
    if (h.kind === 'coffee' || h.kind === 'meal') continue; // food is discarded
    w.items.push({ id: w.nextId++, x: p.x, z: p.z, held: h });
  }
}

function releaseGrab(w: World, p: PlayerState) {
  if (p.grabbing == null) return;
  const c = customer(w, p.grabbing);
  p.grabbing = null;
  if (c && c.heldBy === p.id) { c.heldBy = null; c.fly = { vx: 0, vy: 0, vz: 0, y: 0.4, t: 0.5, thrown: false, by: p.id }; c.state = 'flying'; }
}

export function applyInput(w: World, id: string, x: number, z: number, yaw: number, pitch: number) {
  const p = w.players.get(id);
  if (!p || ![x, z, yaw, pitch].every(Number.isFinite)) return;
  const dt = Math.max(0.05, Math.min(1, w.time - p.lastInputAt));
  p.lastInputAt = w.time;
  let dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  const max = RUN_SPEED * w.cfg.mods.speed * dt * 1.6 + 0.35;
  if (d > max) { dx *= max / d; dz *= max / d; }
  let pos = resolveCollision(p.x + dx, p.z + dz);
  pos = clampToStore(pos.x, pos.z);
  p.x = pos.x; p.z = pos.z;
  p.yaw = yaw; p.pitch = Math.max(-1.5, Math.min(1.5, pitch));
}

// ---------------- helpers ----------------
function ev(w: World, e: GameEvent) { w.events.push(e); }
function toast(w: World, text: string, tone: 'good' | 'bad' | 'info' = 'info') { ev(w, { e: 'toast', text, tone }); }
function adjRating(w: World, d: number) { w.rating = Math.max(0, Math.min(5, w.rating + d)); }
function adjChaos(w: World, d: number) { w.chaos = Math.max(0, Math.min(CHAOS_MAX, w.chaos + d)); }
function adjBurst(w: World, d: number) { if (w.cfg.abilities.includes('ultimate')) w.burst = Math.max(0, Math.min(BURST_MAX, w.burst + d)); }
/** Crew size for workload scaling. Fill-in bots (電腦店員) count as half a person each, rounded down. */
function activePlayers(w: World) {
  let n = 0, bots = 0;
  for (const p of w.players.values()) if (p.connected) { if (p.bot) bots++; else n++; }
  return Math.max(1, n + Math.floor(bots / 2));
}
function cap(w: World) { return shelfCapacity(w.upgrades.shelves); }
/** Career / gear mods plus what the store's upgrades add (監視器 Lv2: calming is faster). */
function effMods(w: World) { const k = cameraCalm(w.upgrades.camera ?? 0); return k === 1 ? w.cfg.mods : { ...w.cfg.mods, calm: w.cfg.mods.calm * k }; }
function customer(w: World, id: number) { return w.customers.find(c => c.id === id); }
function pick<T>(w: World, arr: T[]): T { return arr[Math.floor(w.rng() * arr.length)]; }
const isFood = (h: Held | null) => !!h && (h.kind === 'coffee' || h.kind === 'meal');
function handsFree(p: PlayerState) { return !p.held && !p.held2 && p.grabbing == null; }
/** A player can take one more food item if both hands hold only food and one slot is free. */
function canTakeFood(p: PlayerState) { return p.grabbing == null && (!p.held || (isFood(p.held) && !p.held2)); }
function giveFood(p: PlayerState, h: Held) { if (!p.held) p.held = h; else p.held2 = h; }

function setGoal(c: Customer, goal: { x: number; z: number }) { c.path = findPath(c, goal); }

function moveAlong(c: Customer, dt: number): boolean {
  if (!c.path.length) { c.moving = false; return true; }
  let step = c.speed * dt;
  while (step > 0 && c.path.length) {
    const t = c.path[0];
    const dx = t.x - c.x, dz = t.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { c.path.shift(); continue; }
    c.yaw = Math.atan2(dx, dz);
    if (d <= step) { c.x = t.x; c.z = t.z; step -= d; c.path.shift(); } else { c.x += (dx / d) * step; c.z += (dz / d) * step; step = 0; }
  }
  c.moving = c.path.length > 0;
  return c.path.length === 0;
}

function addSpill(w: World, x: number, z: number) {
  if (w.spills.length >= 14) return;
  // 防滑地墊: some spills never happen
  if ((w.upgrades.mat ?? 0) > 0 && w.rng() < matSkip(w.upgrades.mat)) return;
  const pos = resolveCollision(x + (w.rng() - 0.5) * 0.8, z + (w.rng() - 0.5) * 0.8, 0.35);
  const c = clampToStore(pos.x, pos.z, 0.4);
  if (w.spills.some(s => Math.hypot(s.x - c.x, s.z - c.z) < 0.6)) return;
  w.spills.push({ id: w.nextId++, x: c.x, z: c.z, born: w.time });
  ev(w, { e: 'sfx', name: 'splat', x: c.x, z: c.z });
}

/** Counts a karen as handled (day stats, store totals and the per-kind tally for the 奧客圖鑑). */
function countHandled(w: World, kind: string) {
  w.dayStats.karensResolved++; w.totals.karens++;
  w.handled[kind] = (w.handled[kind] ?? 0) + 1;
}
/** A toast that also says which karen was dealt with (clients show the after-story line for signature karens). */
function karenToast(w: World, c: Customer, text: string, ok: boolean, tone: 'good' | 'bad' | 'info' = ok ? 'good' : 'bad') {
  ev(w, { e: 'toast', text, tone, karen: c.kind, kid: c.id, ok });
}
function resolveKaren(w: World, c: Customer, p: PlayerState | null, rating: number, text: string) {
  c.resolved = true; adjRating(w, rating); adjChaos(w, -5);
  countHandled(w, c.kind);
  if (p) p.stats.karens++;
  karenToast(w, c, text, true);
}
function failKaren(w: World, c: Customer, rating: number, chaos: number, text: string) {
  c.resolved = true; adjRating(w, rating); adjChaos(w, chaos); w.dayStats.karensFailed++;
  karenToast(w, c, text, false);
}

// ---------------- customers ----------------
function spawnCustomer(w: World, kind: CustomerKind) {
  const n = activePlayers(w);
  const m = w.cfg.mods;
  const c: Customer = {
    id: w.nextId++, kind, x: SPAWN_OUTSIDE.x + (w.rng() - 0.5), z: SPAWN_OUTSIDE.z, yaw: Math.PI, state: 'enter', path: [],
    speed: 1.5 + w.rng() * 0.5, shopping: [], items: [], want: null, foodDone: false, foodFailed: false,
    patience: 1, patienceMax: 1, mood: 80, timer: 0, register: -1, anger: 0, resolved: false, hits: 0, eaten: [],
    eatShelf: null, life: 0, look: Math.floor(w.rng() * 1000), angry: false, moving: true, knockTimer: 7, gone: false,
    heldBy: null, fly: null, phase: 0, minions: [],
  };
  if (kind === 'normal') {
    const count = 1 + Math.floor(w.rng() * 3);
    // a map with a fourth line ('extra', e.g. the gas station's drinks fridge) sends a share of the shoppers there
    const extra = PRODUCTS.includes('extra');
    for (let i = 0; i < count; i++) c.shopping.push(extra && w.rng() < 0.25 ? 'extra' : w.rng() < 0.4 ? 'drinks' : w.rng() < 0.6 ? 'snacks' : 'bento');
    if (w.cfg.foods.length && w.rng() < w.cfg.foodChance) c.want = pick(w, w.cfg.foods);
    c.patienceMax = (55 + w.rating * 6) * m.patience;
    // 自動門鈴: greeted at the door, ordinary customers start happier and wait longer
    const bell = doorbellBoost(w.upgrades.doorbell ?? 0);
    c.patienceMax *= bell.patience; c.mood = Math.min(100, c.mood + bell.mood);
    // rainy days (weekly 颱風天): wet shoes leave puddles at the door
    if ((w.cfg.spillMul ?? 1) > 1 && w.rng() < 0.3 * ((w.cfg.spillMul ?? 1) - 1)) addSpill(w, ENTRANCE.x, ENTRANCE.z - 1);
  } else if (kind === 'cutter') {
    c.shopping.push(pick(w, PRODUCTS));
    c.patienceMax = 200; c.speed = 2.1;
  } else if (kind === 'rager') {
    c.anger = 35 + 4 * n; c.speed = 1.9;
  } else if (kind === 'streamer') {
    c.speed = 2.2; c.life = 85;
  } else if (kind === 'hog') {
    c.speed = 1.6; c.patienceMax = 200;
  } else if (kind === 'litterer') {
    c.speed = 1.8; c.life = 80; c.knockTimer = 4;
  } else if (kind === 'charger') {
    c.speed = 1.6; c.life = 75; c.knockTimer = 5;
  } else if (kind === 'custom') {
    // shops like everyone else, then holds up the register changing the order
    c.shopping.push(pick(w, PRODUCTS)); if (w.rng() < 0.5) c.shopping.push(pick(w, PRODUCTS));
    c.patienceMax = 400; c.life = 40;
  } else if (kind === 'fickle') {
    c.want = w.cfg.foods.includes('coffee') ? 'coffee' : w.cfg.foods[0] ?? null; c.patienceMax = 200; c.life = 999;
  } else if (kind === 'tryhard') {
    c.speed = 1.7; c.life = 70; c.knockTimer = 6;
  } else if (kind === 'boss') {
    c.speed = 1.9; c.phase = 1; c.patienceMax = 1e9; c.life = 1e9; c.anger = 0;
  } else if (isSig(kind)) sigSpawn(w, c, SIG_KARENS[kind]);
  c.patience = c.patienceMax;
  if (kind !== 'normal' && kind !== 'boss' && w.cfg.mode === 'shift') {
    if (w.cfg.chapter >= 3 && w.rng() < 0.2) { c.heavy = true; c.speed *= 0.85; }
    if (w.cfg.chapter >= 2 && w.rng() < 0.12) c.vip = true;
  }
  w.customers.push(c);
  if (kind !== 'normal') {
    ev(w, { e: 'karen', kind, id: c.id });
    if (kind === 'boss') toast(w, '👑 奧客之王駕到！第 1 階段「插隊霸王」：請他排隊或直接丟出門', 'bad');
    else if ((kind !== 'hog' && !sigDef(kind)?.hidden) || w.upgrades.camera > 0) toast(w, `⚠ ${KAREN_INFO[kind].name}：${KAREN_INFO[kind].hint}`, 'bad');
  }
  ev(w, { e: 'sfx', name: 'door', x: SPAWN_OUTSIDE.x, z: SPAWN_OUTSIDE.z });
  nextStep(w, c);
}

function nextStep(w: World, c: Customer) {
  if (c.kind === 'boss' && !c.resolved) {
    c.speed = c.phase === 5 ? 1.1 : 1.9;
    if (c.phase === 1) { detachFromLines(w, c); joinQueue(w, c, true); return; }
    if (c.phase === 2) { c.state = 'toComplain'; c.anger = 55; setGoal(c, COMPLAINT_SPOT); return; }
    if (c.phase === 4) { c.state = 'toSummon'; setGoal(c, { x: 12, z: 9.6 }); return; }
    c.state = 'wander'; c.knockTimer = c.phase === 3 ? 6 : 1e9; c.hits = 0; setGoal(c, randomWanderSpot(w)); return;
  }
  if (c.kind === 'rager' && !c.resolved) { c.state = 'toComplain'; setGoal(c, COMPLAINT_SPOT); return; }
  if ((c.kind === 'streamer' || c.kind === 'litterer') && !c.resolved) { c.state = 'wander'; c.speed = c.kind === 'streamer' ? 2.0 : 1.7; setGoal(c, randomWanderSpot(w)); return; }
  if (c.kind === 'hog' && !c.resolved) { goEat(w, c); return; }
  if (c.kind === 'charger' && !c.resolved) { c.state = 'toCharge'; setGoal(c, CHARGE_SPOT); return; }
  if (c.kind === 'tryhard' && !c.resolved) { c.state = 'toTry'; setGoal(c, pick(w, TRYON_SPOTS)); return; }
  if (isSig(c.kind) && !c.resolved && sigNextStep(w, c, SIG_KARENS[c.kind])) return;
  if (c.shopping.length) {
    c.state = 'toShelf';
    setGoal(c, pick(w, shelfBrowseSpots(c.shopping[0])));
    return;
  }
  if (c.want && !c.foodDone && !c.foodFailed) { c.state = 'toFood'; setGoal(c, COFFEE_PICKUP); return; }
  if (c.items.length || c.foodDone) { joinQueue(w, c, c.kind === 'cutter' && !c.resolved); return; }
  leave(w, c, false);
}

function goEat(w: World, c: Customer) {
  const choices = PRODUCTS.filter(p => w.shelves[p] > 0 && p !== c.eatShelf);
  const p = choices.length ? pick(w, choices) : pick(w, PRODUCTS);
  c.eatShelf = p; c.state = 'toEat';
  setGoal(c, pick(w, shelfBrowseSpots(p)));
}

function randomWanderSpot(w: World) {
  const all = [...PRODUCTS.flatMap(p => shelfBrowseSpots(p)), ...WANDER_SPOTS];
  return pick(w, all);
}

function joinQueue(w: World, c: Customer, front: boolean) {
  c.state = 'queue';
  if (front) w.queue.unshift(c.id); else w.queue.push(c.id);
  c.path = [];
}

function detachFromLines(w: World, c: Customer) {
  w.queue = w.queue.filter(id => id !== c.id);
  w.registers = w.registers.map(r => (r === c.id ? null : r));
}

function leave(w: World, c: Customer, angry: boolean) {
  detachFromLines(w, c);
  c.state = 'leaving'; c.angry = angry; c.speed = angry ? 2.3 : 1.8;
  setGoal(c, SPAWN_OUTSIDE);
}

function angryLeave(w: World, c: Customer) {
  w.dayStats.angryLeft++;
  adjRating(w, -0.15); adjChaos(w, 5);
  toast(w, '😠 一位顧客等太久生氣離開了（口碑下降）', 'bad');
  ev(w, { e: 'sfx', name: 'angry', x: c.x, z: c.z });
  leave(w, c, true);
}

function cutterActive(w: World) {
  return w.customers.some(c => (c.kind === 'cutter' || (c.kind === 'boss' && c.phase === 1)) && !c.resolved && (c.state === 'queue' || c.state === 'toRegister' || c.state === 'atRegister'));
}

function updateQueue(w: World) {
  w.queue = w.queue.filter(id => { const c = customer(w, id); return c && c.state === 'queue'; });
  const regCount = w.upgrades.register2 > 0 ? 2 : 1;
  for (let r = 0; r < regCount; r++) {
    const cur = w.registers[r];
    if (cur !== null) { const cc = customer(w, cur); if (cc && (cc.state === 'toRegister' || cc.state === 'atRegister')) continue; w.registers[r] = null; }
    const id = w.queue.shift();
    if (id === undefined) break;
    const c = customer(w, id)!;
    w.registers[r] = id; c.register = r; c.state = 'toRegister';
    setGoal(c, REGISTERS[r].customer);
  }
  w.queue.forEach((id, i) => {
    const c = customer(w, id)!;
    const spot = QUEUE_SPOTS[Math.min(i, QUEUE_SPOTS.length - 1)];
    const last = c.path[c.path.length - 1];
    const tgt = last ?? { x: c.x, z: c.z };
    if (Math.hypot(tgt.x - spot.x, tgt.z - spot.z) > 0.2) setGoal(c, spot);
  });
}

/** The boss moves to its next phase (handled by talking, throwing or the ultimate). */
function bossAdvance(w: World, c: Customer, p: PlayerState | null, how: string) {
  if (c.phase >= 5) return;
  c.phase++; c.hits = 0; c.anger = 0;
  detachFromLines(w, c);
  adjRating(w, 0.05); adjChaos(w, -5); adjBurst(w, 15);
  if (p) p.stats.karens++;
  toast(w, `👑 ${how}！奧客之王進入第 ${c.phase} 階段「${BOSS_PHASES[c.phase]}」`, 'good');
  ev(w, { e: 'fx', name: 'eject', x: c.x, z: c.z, combo: 0, by: p?.name });
  if (!c.fly && c.state !== 'held') nextStep(w, c);
}

function bossDefeat(w: World, c: Customer, by: PlayerState | null) {
  w.bossDefeated = true; c.resolved = true;
  adjRating(w, 0.5); adjChaos(w, -30);
  countHandled(w, 'boss');
  toast(w, `🏆 ${by?.name ?? '你'} 讓奧客之王退散了！你就是終極打工人！`, 'good');
  for (const id of c.minions) { const m = customer(w, id); if (m && !m.resolved) { m.resolved = true; leave(w, m, false); } }
}

/** Eject a customer through the front door (thrown, guard or ultimate). */
function eject(w: World, c: Customer, by: PlayerState | null, how: 'throw' | 'guard' | 'ultimate') {
  if (c.gone || c.ejected) return;
  if (c.kind === 'boss' && c.phase < 5) {
    // the boss can't be thrown out before the final phase: he storms back in
    c.heldBy = null; c.fly = null; c.x = 12; c.z = STORE_D - 0.6;
    if (by && by.grabbing === c.id) by.grabbing = null;
    toast(w, '👑 奧客之王硬闖回來了！', 'bad');
    if (c.phase <= 3 || how === 'ultimate') bossAdvance(w, c, by, how === 'ultimate' ? '全店退散' : '丟出門');
    else { c.state = 'enter'; nextStep(w, c); }
    return;
  }
  c.heldBy = null; c.fly = null;
  detachFromLines(w, c);
  if (by && by.grabbing === c.id) by.grabbing = null;
  const x = Math.min(DOOR_X1, Math.max(DOOR_X0, c.x)), z = STORE_D;
  // lands on the pavement, lies there dazed, then gets up and walks off down the street
  c.ejected = true; c.state = 'leaving'; c.angry = true; c.speed = 1.5; c.moving = false;
  c.x = Math.min(DOOR_X1 - 0.3, Math.max(DOOR_X0 + 0.3, x + (w.rng() - 0.5) * 1.6)); c.z = STORE_D + 0.9 + w.rng() * 0.4;
  c.downT = 2.2; c.yaw = Math.PI; // facing the store: lying on the back, head toward the street
  c.path = [{ x: c.x, z: STORE_D + 1.6 }, { x: c.x < 12 ? -3 : 27, z: STORE_D + 1.7 }];
  if (c.kind === 'boss') { w.dayStats.ejected++; if (by) by.stats.ejected++; bossDefeat(w, c, by); ev(w, { e: 'fx', name: 'ultimate', x, z, by: by?.name }); }
  const wasResolved = c.resolved;
  if (c.kind !== 'normal' && c.kind !== 'boss') {
    const was = wasResolved;
    w.dayStats.ejected++; if (by) by.stats.ejected++;
    if (!was) { countHandled(w, c.kind); if (by) by.stats.karens++; }
    c.resolved = true;
    adjChaos(w, -7); adjRating(w, 0.05);
    if (how !== 'ultimate') adjBurst(w, 25);
    w.combo = w.time < w.comboUntil ? w.combo + 1 : 1; w.comboUntil = w.time + 5;
    w.dayStats.maxCombo = Math.max(w.dayStats.maxCombo, w.combo);
    ev(w, { e: 'fx', name: 'eject', x, z, combo: w.combo, by: by?.name });
    ev(w, { e: 'sfx', name: 'eject', x, z });
  }
  if (c.kind !== 'normal') {
    if (c.kind === 'boss') { /* announced by bossDefeat */ }
    else if (how === 'guard') { const t = `🛡 保全請走了${KAREN_INFO[c.kind as KarenKind].name}`; if (wasResolved) toast(w, t, 'good'); else karenToast(w, c, t, true); }
    else if (how === 'throw') { const t = w.combo > 1 ? `🚪 ${w.combo} 連送！奧客退散！` : `🚪 ${by?.name ?? ''} 把${KAREN_INFO[c.kind as KarenKind].name}請出門了！`; if (wasResolved) toast(w, t, 'good'); else karenToast(w, c, t, true); }
  } else {
    w.dayStats.angryLeft++;
    adjChaos(w, 20); adjRating(w, -0.6);
    ev(w, { e: 'fx', name: 'mistake', x, z, by: by?.name });
    toast(w, '😱 誤丟一般顧客！混亂 +20、口碑大跌', 'bad');
  }
}

function updateFlight(w: World, c: Customer, dt: number) {
  const f = c.fly!;
  f.t -= dt; f.vy -= 7.8 * dt; f.y += f.vy * dt;
  const ox = c.x, oz = c.z;
  const nx = c.x + f.vx * dt, nz = c.z + f.vz * dt;
  // door crossing (only thrown/knocked bodies leaving the store count)
  if (f.vz > 0 && oz <= STORE_D && nz >= STORE_D) {
    const cx = ox + (nx - ox) * (STORE_D - oz) / (nz - oz);
    if (cx > DOOR_X0 + 0.15 && cx < DOOR_X1 - 0.15) {
      c.x = cx; c.z = STORE_D;
      eject(w, c, w.players.get(f.by) ?? null, 'throw');
      return;
    }
  }
  const r = resolveCollision(nx, nz, 0.25);
  const hitX = Math.abs(r.x - nx) > 1e-4, hitZ = Math.abs(r.z - nz) > 1e-4;
  if (hitX) f.vx *= -0.42;
  if (hitZ) f.vz *= -0.42;
  if ((hitX || hitZ) && Math.hypot(f.vx, f.vz) > 1.2) ev(w, { e: 'fx', name: 'impact', x: r.x, z: r.z });
  const cl = clampToStore(r.x, r.z, 0.25);
  c.x = cl.x; c.z = cl.z;
  const drag = Math.pow(0.62, dt); f.vx *= drag; f.vz *= drag;
  if (f.y < 0) { f.y = 0; f.vy *= -0.26; f.vx *= 0.7; f.vz *= 0.7; }
  if (f.t <= 0 || (f.y === 0 && Math.hypot(f.vx, f.vz) < 0.7)) {
    c.fly = null;
    if (c.kind === 'normal') c.mood -= 30;
    else if (c.kind === 'rager') c.anger = Math.min(99, c.anger + 12);
    if (c.kind === 'boss' && c.phase <= 3 && f.thrown) { c.state = 'enter'; bossAdvance(w, c, w.players.get(f.by) ?? null, '摔了個四腳朝天'); return; }
    if (c.state === 'flying') { c.state = 'enter'; nextStep(w, c); }
  }
}

function updateCustomer(w: World, c: Customer, dt: number) {
  if (c.state === 'held') {
    const p = c.heldBy ? w.players.get(c.heldBy) : undefined;
    if (!p) { c.heldBy = null; c.state = 'enter'; nextStep(w, c); return; }
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const pos = resolveCollision(p.x + fx * 0.9, p.z + fz * 0.9, 0.2);
    c.x = pos.x; c.z = pos.z; c.yaw = p.yaw + Math.PI; c.moving = false;
    return;
  }
  if (c.fly) { updateFlight(w, c, dt); return; }
  const n = activePlayers(w);
  const m = w.cfg.mods;
  if (c.downT && c.downT > 0) { c.downT = Math.max(0, c.downT - dt); c.moving = false; return; }
  if (c.stunT && c.stunT > 0) { c.stunT = Math.max(0, c.stunT - dt); c.moving = false; return; }
  const arrived = moveAlong(c, dt);
  const drain = (cutterActive(w) && c.kind !== 'cutter' ? 2.2 : 1) * (w.power < 1 ? 1.3 : 1)
    * (w.customers.some(s => s.kind === 'streamer' && !s.resolved && Math.hypot(s.x - c.x, s.z - c.z) < 3) ? 1.35 : 1)
    * (c.kind === 'normal' ? sigDrain(w, c) : 1);
  if (isSig(c.kind) && !c.resolved && sigUpdate(w, c, dt, arrived)) return;
  switch (c.state) {
    case 'enter': if (arrived) nextStep(w, c); break;
    case 'toShelf': if (arrived) { c.state = 'browse'; c.timer = 1.4 + w.rng() * 1.2; c.yaw = faceShelf(c); } break;
    case 'browse':
      c.timer -= dt;
      if (c.timer <= 0) {
        const p = c.shopping.shift()!;
        if (w.shelves[p] > 0) { w.shelves[p]--; c.items.push(p); }
        else {
          c.mood -= 30; adjRating(w, -0.02); adjChaos(w, 1);
          if (w.time - w.emptyShelfToastAt > 8) { toast(w, `📦 ${PRODUCT_INFO[p].name}貨架空了！快去倉庫補貨`, 'bad'); w.emptyShelfToastAt = w.time; }
        }
        if (w.rng() < (0.025 + 0.01 * n) * (w.cfg.spillMul ?? 1)) addSpill(w, c.x, c.z);
        nextStep(w, c);
      }
      break;
    case 'toFood': if (arrived) { c.state = 'waitFood'; c.timer = 50 * m.patience; c.patienceMax = c.timer; c.yaw = Math.PI / 2; } break;
    case 'waitFood':
      c.timer -= dt * (w.power < 1 ? 1.3 : 1) * (c.kind === 'normal' ? sigDrain(w, c) : 1);
      if (c.timer <= 0 && isSig(c.kind) && !c.resolved) { sigFail(w, c, SIG_KARENS[c.kind]); break; }
      if (c.timer <= 0 && c.kind === 'fickle' && !c.resolved) { failKaren(w, c, -0.2, 6, '🧋 改單達人等不到他要的那杯，罵罵咧咧走了'); leave(w, c, true); break; }
      if (c.timer <= 0) { c.foodFailed = true; c.mood -= 35; adjRating(w, -0.06); adjChaos(w, 3); toast(w, `${FOOD_INFO[c.want!].icon} ${FOOD_INFO[c.want!].name}等太久，顧客放棄了`, 'bad'); c.patienceMax = (55 + w.rating * 6) * m.patience; c.patience = c.patienceMax; nextStep(w, c); }
      break;
    case 'queue': case 'toRegister': case 'atRegister':
      if (c.state === 'toRegister' && arrived) { c.state = 'atRegister'; c.yaw = Math.PI; }
      if (c.state === 'atRegister') c.yaw = Math.PI;
      if (c.kind === 'custom' && !c.resolved && c.state === 'atRegister') {
        c.life -= dt;
        if (c.life <= 0) { failKaren(w, c, -0.25, 8, '🍳 客製魔人改到最後說「那我不要了」，整排客人等了個寂寞'); leave(w, c, true); break; }
      }
      c.patience -= dt * drain;
      if (c.patience <= 0) angryLeave(w, c);
      break;
    case 'leaving':
      if (arrived) c.gone = true;
      break;
    case 'toSummon':
      if (arrived) {
        c.state = 'summon'; c.yaw = Math.PI;
        if (c.minions.length) break; // already summoned (e.g. thrown back in)
        const kinds = (['cutter', 'rager', 'streamer', 'hog', 'litterer'] as KarenKind[]);
        for (let i = 0; i < 3; i++) { spawnCustomer(w, kinds[(c.look + i * 2) % kinds.length]); c.minions.push(w.customers[w.customers.length - 1].id); }
        toast(w, '👑 奧客之王叫來三個小弟！先把小弟處理掉', 'bad');
      }
      break;
    case 'summon':
      if (c.minions.every(id => { const m = customer(w, id); return !m || m.resolved || m.gone; })) bossAdvance(w, c, null, '小弟全滅');
      break;
    case 'toComplain': if (arrived) { c.state = 'complain'; c.yaw = 0; } // fallthrough to anger
    // eslint-disable-next-line no-fallthrough
    case 'complain': {
      if (c.kind === 'rager' && !c.resolved && c.anger >= 85 && w.time - (c.shoveAt ?? -99) > 5) {
        const near = nearestPlayer(w, c);
        if (near && near.d < 1.7) {
          c.shoveAt = w.time;
          ev(w, { e: 'fx', name: 'shove', x: near.p.x, z: near.p.z, by: near.p.name });
          toast(w, `🤬 退貨奧客推了 ${near.p.name} 一把！現在出手算正當防衛`, 'bad');
        }
      }
      const rate = (1.4 + 0.45 * n) * (w.upgrades.camera > 0 ? 0.7 : 1) * m.angerRate * (w.power < 1 ? 1.25 : 1);
      c.anger += rate * dt * (c.kind === 'boss' ? 1.4 : 1);
      if (c.anger >= 100 && c.kind === 'boss') {
        c.anger = 45; addSpill(w, c.x, c.z); addSpill(w, c.x, c.z); adjChaos(w, 10); adjRating(w, -0.15);
        toast(w, '👑 奧客之王暴怒砸店！混亂 +10', 'bad'); ev(w, { e: 'sfx', name: 'crash', x: c.x, z: c.z });
        break;
      }
      if (c.anger >= 100) {
        c.anger = 100;
        addSpill(w, c.x, c.z); addSpill(w, c.x, c.z);
        w.money -= 25;
        failKaren(w, c, -0.4, 12, '💥 退貨奧客大鬧砸店！口碑 -0.4、損失 $25');
        ev(w, { e: 'sfx', name: 'crash', x: c.x, z: c.z });
        leave(w, c, true);
      }
      break;
    }
    case 'wander': case 'flee': {
      c.life -= dt; c.knockTimer -= dt;
      if (c.knockTimer <= 0) {
        if (c.kind === 'litterer') { c.knockTimer = 6; addSpill(w, c.x, c.z); adjChaos(w, 1); }
        else {
          c.knockTimer = 7;
          const stocked = PRODUCTS.filter(p => w.shelves[p] > 0);
          if (stocked.length) { const p = pick(w, stocked); w.shelves[p]--; }
          addSpill(w, c.x, c.z);
          ev(w, { e: 'sfx', name: 'knock', x: c.x, z: c.z });
        }
      }
      if (c.life <= 0) {
        if (c.kind === 'litterer') failKaren(w, c, -0.25, 8, '🗑 亂丟客逛完就走，留下一地垃圾');
        else failKaren(w, c, -0.3, 10, '📱 直播客拍完就走，店家形象受損（口碑 -0.3）');
        leave(w, c, false); break;
      }
      if (c.kind === 'streamer' || (c.kind === 'boss' && c.phase === 3)) {
        const near = nearestPlayer(w, c);
        if (near && near.d < 3.2 && c.state !== 'flee') {
          c.state = 'flee'; c.speed = 3.0;
          setGoal(c, fleeSpot(w, c, near.p));
          break;
        }
      }
      if (arrived) { c.state = 'wander'; c.speed = c.kind === 'boss' ? (c.phase === 5 ? 1.1 : 2.0) : c.kind === 'streamer' ? 2.0 : 1.7; setGoal(c, randomWanderSpot(w)); }
      break;
    }
    case 'toCharge': if (arrived) { c.state = 'charge'; c.yaw = 0; } break;
    case 'toTry': if (arrived) { c.state = 'tryon'; c.yaw = -Math.PI / 2; } break;
    case 'tryon':
      c.life -= dt; c.knockTimer -= dt;
      if (c.knockTimer <= 0) {
        // grabs more clothes off the racks and leaves the last pile on the floor
        c.knockTimer = 6;
        const stocked = PRODUCTS.filter(p => w.shelves[p] > 0);
        if (stocked.length) w.shelves[pick(w, stocked)]--;
        addSpill(w, c.x + (w.rng() - 0.5), c.z + (w.rng() - 0.5)); adjChaos(w, 1);
      }
      if (c.life <= 0) { failKaren(w, c, -0.25, 8, '👕 試穿狂試了一整輪，什麼都沒買，衣服丟滿地就走了'); leave(w, c, false); }
      break;
    case 'charge': {
      // squats at the socket: every few seconds the electricity bill ticks up and the store gets messier
      if (w.power < 1) {
        c.resolved = true; countHandled(w, c.kind);
        karenToast(w, c, '🔌 停電了，充電霸王摸摸鼻子走人', true, 'info');
        leave(w, c, false); break;
      }
      c.life -= dt; c.knockTimer -= dt;
      if (c.knockTimer <= 0) { c.knockTimer = 5; w.money -= 2; adjChaos(w, 1); }
      if (c.life <= 0) {
        failKaren(w, c, -0.2, 5, '🔌 充電霸王充飽就走，電費算店裡的（口碑 -0.2）');
        leave(w, c, false);
      }
      break;
    }
    case 'toEat': if (arrived) { c.state = 'eat'; c.timer = 3.5; c.yaw = faceShelf(c); } break;
    case 'eat':
      c.timer -= dt;
      if (c.timer <= 0) {
        const p = c.eatShelf!;
        if (w.shelves[p] > 0) { w.shelves[p]--; c.eaten.push(p); }
        if (c.eaten.length >= 6) {
          failKaren(w, c, -0.2, 8, '🍙 偷吃奧客吃飽就跑了！商品損失');
          leave(w, c, false); break;
        }
        if (c.eaten.length % 3 === 0 || w.shelves[p] === 0) goEat(w, c); else c.timer = 3.5;
      }
      break;
  }
}

function faceShelf(c: Customer) {
  let best = 0, bd = Infinity;
  for (const s of SHELVES) {
    const d = distToAABB(c.x, c.z, s.box);
    if (d < bd) { bd = d; const cx = Math.min(Math.max(c.x, s.box.x0), s.box.x1), cz = Math.min(Math.max(c.z, s.box.z0), s.box.z1); best = Math.atan2(cx - c.x, cz - c.z); }
  }
  return best;
}

function nearestPlayer(w: World, c: { x: number; z: number }) {
  let best: { p: PlayerState; d: number } | null = null;
  for (const p of w.players.values()) {
    if (!p.connected) continue;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (!best || d < best.d) best = { p, d };
  }
  return best;
}

function fleeSpot(w: World, c: Customer, p: PlayerState) {
  const cands = [...PRODUCTS.flatMap(p => shelfBrowseSpots(p)), ...WANDER_SPOTS];
  let best = cands[0], bs = -Infinity;
  for (const s of cands) {
    const dc = Math.hypot(s.x - c.x, s.z - c.z);
    if (dc > 7) continue;
    const score = Math.hypot(s.x - p.x, s.z - p.z) - dc * 0.3 + w.rng();
    if (score > bs) { bs = score; best = s; }
  }
  return best;
}

// ---------------- store-signature karens (data in sigkarens.ts) ----------------
function holds(p: PlayerState, need: SigNeed) {
  if (need === 'box' || need === 'mop') return p.held?.kind === need;
  return p.held?.kind === need || p.held2?.kind === need;
}
function needName(need: SigNeed) {
  return need === 'coffee' ? FOOD_INFO.coffee.name || '飲料' : need === 'meal' ? FOOD_INFO.meal.name || '熱食' : need === 'mop' ? '拖把（西側牆邊）' : '一箱貨（倉庫）';
}
function takeFood(p: PlayerState, kind: 'coffee' | 'meal') { if (p.held?.kind === kind) { p.held = p.held2; p.held2 = null; } else p.held2 = null; }

function sigSpawn(w: World, c: Customer, d: SigKarenDef) {
  c.life = d.life ?? 70; c.lifeMax = c.life; c.knockTimer = d.every ?? 5;
  if (d.tpl === 'till' || d.tpl === 'haggle') {
    c.shopping.push(pick(w, PRODUCTS)); if (w.rng() < 0.5) c.shopping.push(pick(w, PRODUCTS));
    c.patienceMax = 400;
    if (d.tpl === 'haggle') { c.anger = d.heat ?? 30; c.lifeMax = undefined; }
  } else if (d.tpl === 'redo') {
    c.want = d.food && w.cfg.foods.includes(d.food) ? d.food : w.cfg.foods[0] ?? null;
    c.patienceMax = 200; c.lifeMax = undefined;
    if (!c.want) { c.resolved = true; c.shopping.push(pick(w, PRODUCTS)); } // this store makes nothing: he is just a customer
  } else c.speed = d.tpl === 'roam' ? 1.8 : 1.6;
}

/** Where he goes next; false = shop and queue like everyone else (till / haggle / redo). */
function sigNextStep(w: World, c: Customer, d: SigKarenDef): boolean {
  if (d.tpl === 'camp' || d.tpl === 'sneak') { c.state = 'toCamp'; setGoal(c, sigSpot(w, c, d)); return true; }
  if (d.tpl === 'roam') { c.state = 'wander'; c.speed = 1.7; setGoal(c, randomWanderSpot(w)); return true; }
  if (d.tpl === 'refund') { c.state = 'toComplain'; setGoal(c, COMPLAINT_SPOT); return true; }
  return false;
}

function sigSpot(w: World, c: Customer, d: SigKarenDef) {
  if (d.spot === 'shelf') {
    const stocked = PRODUCTS.filter(p => w.shelves[p] > 0 && p !== c.eatShelf);
    const p = stocked.length ? pick(w, stocked) : pick(w, PRODUCTS);
    c.eatShelf = p;
    return pick(w, shelfBrowseSpots(p));
  }
  const taken = w.customers.filter(o => o !== c && (o.state === 'camp' || o.state === 'toCamp')).map(o => o.path[o.path.length - 1] ?? o);
  const free = CAMP_SPOTS.filter(s => Math.hypot(s.x - c.x, s.z - c.z) > 0.8 && !taken.some(t => Math.hypot(t.x - s.x, t.z - s.z) < 0.6));
  return pick(w, free.length ? free : CAMP_SPOTS);
}

/** Customers near a loud karen, or anyone in line while the 器材霸主 hogs the machine, lose patience faster. */
function sigDrain(w: World, c: Customer) {
  let f = 1;
  for (const k of w.customers) {
    if (k.resolved || k.state !== 'camp' || !isSig(k.kind)) continue;
    const d = SIG_KARENS[k.kind];
    if (d.effects?.includes('queue') && (c.state === 'queue' || c.state === 'toRegister' || c.state === 'atRegister' || c.state === 'waitFood')) f *= 1.5;
    if (d.effects?.includes('aura') && Math.hypot(k.x - c.x, k.z - c.z) < (d.aura ?? 3)) f *= 1.8;
  }
  return f;
}

/** Periodic effects while he is at it; runs out of time = the store loses. */
function sigTick(w: World, c: Customer, d: SigKarenDef, dt: number) {
  c.life -= dt; c.knockTimer -= dt;
  if (c.knockTimer <= 0) {
    c.knockTimer = d.every ?? 5;
    adjChaos(w, 1);
    for (const e of d.effects ?? []) {
      if (e === 'stock') {
        const own = c.eatShelf && d.spot === 'shelf' ? c.eatShelf : null;
        const stocked = PRODUCTS.filter(p => w.shelves[p] > 0);
        const p = own && w.shelves[own] > 0 ? own : own ? null : stocked.length ? pick(w, stocked) : null;
        if (p) { w.shelves[p]--; if (d.tpl === 'sneak') c.eaten.push(p); ev(w, { e: 'sfx', name: 'knock', x: c.x, z: c.z }); }
        else if (own && c.state === 'camp') { c.state = 'toCamp'; setGoal(c, sigSpot(w, c, d)); } // shelf is empty: move on to the next one
      }
      if (e === 'mess') addSpill(w, c.x, c.z);
      if (e === 'money') w.money -= d.drain ?? 2;
    }
  }
  if (c.life <= 0) sigFail(w, c, d);
}

function sigFail(w: World, c: Customer, d: SigKarenDef) {
  let lost = d.failMoney ?? 0;
  if (d.tpl === 'sneak') lost += c.eaten.reduce((s, p) => s + PRODUCT_INFO[p].price, 0);
  if (lost) w.money -= lost;
  if (d.tpl === 'haggle') { addSpill(w, c.x, c.z); addSpill(w, c.x, c.z); ev(w, { e: 'sfx', name: 'crash', x: c.x, z: c.z }); }
  failKaren(w, c, -0.25, 8, `${d.fail}${lost ? `（損失 $${lost}）` : ''}`);
  leave(w, c, true);
}

/** Template behaviour; returns true when it took care of this tick. */
function sigUpdate(w: World, c: Customer, dt: number, arrived: boolean): boolean {
  const d = SIG_KARENS[c.kind as keyof typeof SIG_KARENS];
  switch (c.state) {
    case 'toCamp':
      if (arrived) { c.state = 'camp'; c.yaw = d.spot === 'shelf' ? faceShelf(c) : faceDecor(c); }
      return true;
    case 'camp': sigTick(w, c, d, dt); return true;
    case 'wander': case 'flee': {
      if (d.tpl !== 'roam') return false;
      sigTick(w, c, d, dt);
      if (c.resolved) return true;
      if (d.flee && c.state === 'wander') {
        const near = nearestPlayer(w, c);
        if (near && near.d < 2.4) { c.state = 'flee'; c.speed = 2.3; setGoal(c, fleeSpot(w, c, near.p)); return true; }
      }
      if (arrived) { c.state = 'wander'; c.speed = 1.7; setGoal(c, randomWanderSpot(w)); }
      return true;
    }
    case 'toComplain': if (arrived) { c.state = 'complain'; c.yaw = 0; } return true;
    case 'complain': c.life -= dt; if (c.life <= 0) sigFail(w, c, d); return true;
    case 'atRegister':
      if (d.tpl === 'haggle') {
        c.anger += (d.heatRate ?? 3) * dt * w.cfg.mods.angerRate;
        if (c.anger >= 100) { c.anger = 100; sigFail(w, c, d); return true; }
      } else if (d.tpl === 'till') {
        c.life -= dt;
        if (c.life <= 0) { sigFail(w, c, d); return true; }
      }
      return false;
  }
  return false;
}

/** The main action (alt = the second choice). Validated by check(). */
function sigAct(w: World, p: PlayerState, c: Customer, alt: boolean) {
  const d = SIG_KARENS[c.kind as keyof typeof SIG_KARENS];
  ev(w, { e: 'sfx', name: 'calm', x: c.x, z: c.z });
  if (alt) {
    if (d.altCost) w.money -= d.altCost;
    if (d.altNeed) { takeFood(p, d.altNeed); c.want = d.altNeed; c.foodDone = true; }
    sigResolve(w, p, c, d, 0.05, `${d.icon} ${p.name}「${d.alt}」——${d.ok}（口碑 +0.05）`);
    return;
  }
  c.hits++;
  if (d.need === 'coffee' || d.need === 'meal') { takeFood(p, d.need); c.want = d.need; c.foodDone = true; }
  if (d.need === 'box' && p.held?.kind === 'box') {
    const n = Math.min(2, p.held.qty);
    for (let i = 0; i < n; i++) c.items.push(p.held.product);
    p.held.qty -= n; if (p.held.qty <= 0) p.held = null;
  }
  if (d.tpl === 'haggle') c.anger = Math.max(0, c.anger - (d.heatDrop ?? 30));
  const need = d.presses ?? 1;
  if (c.hits < need) {
    toast(w, `${d.icon} ${(d.step ?? '還要再 {n} 次').replace('{n}', String(need - c.hits))}`, 'info');
    if (d.relocate && (d.tpl === 'camp' || d.tpl === 'sneak')) { c.state = 'toCamp'; setGoal(c, sigSpot(w, c, d)); }
    else if (d.tpl === 'roam') { c.state = 'wander'; setGoal(c, randomWanderSpot(w)); }
    return;
  }
  const rating = d.need ? 0.15 : 0.1;
  sigResolve(w, p, c, d, rating, `${d.icon} ${p.name}：${d.ok}（口碑 +${rating}）`);
}

function sigResolve(w: World, p: PlayerState, c: Customer, d: SigKarenDef, rating: number, text: string) {
  resolveKaren(w, c, p, rating, text);
  c.anger = 0;
  c.patienceMax = (55 + w.rating * 6) * w.cfg.mods.patience; c.patience = c.patienceMax;
  if (d.tpl === 'till' || d.tpl === 'haggle' || d.tpl === 'redo') return; // stays in line / keeps waiting, now an ordinary customer
  if (d.tpl === 'refund') { leave(w, c, false); return; }
  if (d.tpl === 'sneak') { c.items.push(...c.eaten); c.eaten = []; if (!c.items.length) c.items.push(c.eatShelf ?? pick(w, PRODUCTS)); }
  else if (d.buys && !c.items.length && !c.foodDone) c.items.push(c.eatShelf ?? pick(w, PRODUCTS));
  if (c.items.length || c.foodDone) joinQueue(w, c, false); else leave(w, c, false);
}

function faceDecor(c: Customer) {
  let best = c.yaw, bd = Infinity;
  for (const b of [...DECOR, ...SHELVES.map(s => s.box)]) {
    const d = distToAABB(c.x, c.z, b);
    if (d < bd) { bd = d; const cx = Math.min(Math.max(c.x, b.x0), b.x1), cz = Math.min(Math.max(c.z, b.z0), b.z1); best = Math.atan2(cx - c.x, cz - c.z); }
  }
  return best;
}

/** For the overhead bar: states in which his countdown is running. */
function sigBarState(c: Customer) { return c.state === 'camp' || c.state === 'wander' || c.state === 'flee' || c.state === 'complain' || c.state === 'atRegister'; }

// ---------------- actions ----------------
function targetDist(w: World, p: PlayerState, t: Target): number {
  switch (t.t) {
    case 'register': return Math.hypot(p.x - REGISTERS[t.idx]?.x, p.z - REGISTERS[t.idx]?.z);
    case 'coffee': return distToAABB(p.x, p.z, COFFEE_MACHINE);
    case 'microwave': return distToAABB(p.x, p.z, MICROWAVE);
    case 'crate': { const c = CRATES.find(c => c.product === t.product); return c ? distToAABB(p.x, p.z, c.box) : Infinity; }
    case 'shelf': { const s = SHELVES.find(s => s.product === t.product); return s ? distToAABB(p.x, p.z, s.box) : Infinity; }
    case 'mop': return distToAABB(p.x, p.z, MOP_RACK);
    case 'customer': { const c = customer(w, t.id); return c ? Math.hypot(p.x - c.x, p.z - c.z) : Infinity; }
    case 'spill': { const s = w.spills.find(s => s.id === t.id); return s ? Math.hypot(p.x - s.x, p.z - s.z) : Infinity; }
    case 'item': { const s = w.items.find(s => s.id === t.id); return s ? Math.hypot(p.x - s.x, p.z - s.z) : Infinity; }
  }
  return Infinity;
}

type Check = { ok: true; dur: number } | { ok: false; reason: string };

/** Validates an action; returns its channel duration. Called at start and again at completion. */
function check(w: World, p: PlayerState, kind: ActKind, t: Target, completing = false): Check {
  if (w.phase === 'summary') return { ok: false, reason: '已經結算' };
  if (!!p.raider !== (kind === 'knock' || kind === 'heckle')) return { ok: false, reason: p.raider ? '你是來搗亂的，不是來上班的' : '店員不能搗亂' };
  if (targetDist(w, p, t) > SERVER_INTERACT_RANGE) return { ok: false, reason: '距離太遠' };
  if (p.grabbing != null && kind !== 'grab') return { ok: false, reason: '先把抓著的人丟出去或放下' };
  const m = effMods(w);
  const c = t.t === 'customer' ? customer(w, t.id) : undefined;
  const busyCust = c && (c.state === 'held' || c.state === 'flying' || c.gone);
  if (busyCust && kind !== 'grab') return { ok: false, reason: '對方正在飛…' };
  switch (kind) {
    case 'checkout': {
      if (t.t !== 'register') return { ok: false, reason: '目標錯誤' };
      if (t.idx === 1 && w.upgrades.register2 === 0) return { ok: false, reason: '第二收銀台未開放' };
      if (p.z > COUNTER.z0 + 0.2) return { ok: false, reason: '請到櫃台內側' };
      const id = w.registers[t.idx];
      const cc = id != null ? customer(w, id) : undefined;
      if (!cc || cc.state !== 'atRegister') return { ok: false, reason: '沒有顧客等待結帳' };
      if (cc.kind === 'custom' && !cc.resolved) return { ok: false, reason: '他還在改單！先對他「複誦點單」' };
      if (isSig(cc.kind) && !cc.resolved && (SIG_KARENS[cc.kind].tpl === 'till' || SIG_KARENS[cc.kind].tpl === 'haggle')) return { ok: false, reason: `${SIG_KARENS[cc.kind].name}還卡著！先對他「${SIG_KARENS[cc.kind].act}」` };
      if (p.held && !isFood(p.held)) return { ok: false, reason: '手上有東西' };
      return { ok: true, dur: checkoutTime(w.upgrades.scanner) * m.checkout };
    }
    case 'brew':
      if (t.t !== 'coffee') return { ok: false, reason: '目標錯誤' };
      if (!w.cfg.foods.includes('coffee')) return { ok: false, reason: `這間店還沒賣${FOOD_INFO.coffee.name || '飲料'}` };
      if (!completing && !canTakeFood(p)) return { ok: false, reason: '雙手已滿（最多兩份餐點）' };
      return { ok: true, dur: brewTime(w.upgrades.coffee) * m.brew };
    case 'heat':
      if (t.t !== 'microwave') return { ok: false, reason: '目標錯誤' };
      if (!w.cfg.foods.includes('meal')) return { ok: false, reason: `這間店還沒賣${FOOD_INFO.meal.name || '熱食'}` };
      if (!completing && !canTakeFood(p)) return { ok: false, reason: '雙手已滿（最多兩份餐點）' };
      if (!completing && w.backstock.bento <= 0) return { ok: false, reason: `${FOOD_INFO.meal.uses}缺貨，請採購` };
      return { ok: true, dur: heatTime(w.upgrades.coffee) * m.brew };
    case 'deliver': {
      if (!c || c.state !== 'waitFood' || !c.want) return { ok: false, reason: '這位顧客沒有在等餐' };
      if (p.held?.kind !== c.want && p.held2?.kind !== c.want) return { ok: false, reason: `他要的是${FOOD_INFO[c.want].name}` };
      return { ok: true, dur: 0 };
    }
    case 'takeBox':
      if (t.t !== 'crate') return { ok: false, reason: '目標錯誤' };
      if (!handsFree(p)) return { ok: false, reason: '手上有東西' };
      if (w.backstock[t.product] <= 0) return { ok: false, reason: '倉庫沒貨了，請採購' };
      return { ok: true, dur: 0 };
    case 'returnBox':
      if (t.t !== 'crate' || p.held?.kind !== 'box' || p.held.product !== t.product) return { ok: false, reason: '箱子種類不符' };
      return { ok: true, dur: 0 };
    case 'stock':
      if (t.t !== 'shelf' || p.held?.kind !== 'box') return { ok: false, reason: '需要拿著貨箱' };
      if (p.held.product !== t.product) return { ok: false, reason: '商品種類不符' };
      if (w.shelves[t.product] >= cap(w)) return { ok: false, reason: '貨架已滿' };
      return { ok: true, dur: 0.6 };
    case 'takeMop':
      if (t.t !== 'mop' || !handsFree(p)) return { ok: false, reason: '手上有東西' };
      if (w.mopsOnRack <= 0) return { ok: false, reason: '拖把都被拿走了' };
      return { ok: true, dur: 0 };
    case 'returnMop':
      if (t.t !== 'mop' || p.held?.kind !== 'mop') return { ok: false, reason: '沒有拿拖把' };
      return { ok: true, dur: 0 };
    case 'clean':
      if (t.t !== 'spill' || !w.spills.some(s => s.id === t.id)) return { ok: false, reason: '已經清乾淨了' };
      if (p.held?.kind !== 'mop') return { ok: false, reason: '需要拖把（在西側牆邊）' };
      return { ok: true, dur: 1.5 * m.clean };
    case 'calm':
      if (c?.kind === 'boss' && c.phase === 2 && c.state === 'complain') return { ok: true, dur: 1.2 };
      if (!c || c.kind !== 'rager' || c.resolved) return { ok: false, reason: '不需要安撫' };
      return { ok: true, dur: 1.2 };
    case 'coupon':
      if (c?.kind === 'boss') return { ok: false, reason: '奧客之王不吃這套' };
      if (!c || c.kind !== 'rager' || c.resolved) return { ok: false, reason: '不需要' };
      if (w.money < 30) return { ok: false, reason: '錢不夠' };
      return { ok: true, dur: 0.3 };
    case 'askQueue':
      if (c?.kind === 'boss' && c.phase === 1 && ['queue', 'toRegister', 'atRegister'].includes(c.state)) return { ok: true, dur: 1.2 };
      if (!c || c.kind !== 'cutter' || c.resolved) return { ok: false, reason: '不需要' };
      if (!['queue', 'toRegister', 'atRegister'].includes(c.state)) return { ok: false, reason: '還沒插隊' };
      return { ok: true, dur: 0.8 };
    case 'stopFilm':
      if (c?.kind === 'boss' && c.phase === 3) return { ok: true, dur: 0.6 };
      if (!c || c.kind !== 'streamer' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 0.6 };
    case 'stopLitter':
      if (!c || c.kind !== 'litterer' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 0.9 };
    case 'checkBag':
      if (!c || c.kind !== 'hog' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 1.0 };
    case 'knock':
      if (t.t !== 'shelf') return { ok: false, reason: '目標錯誤' };
      if (w.shelves[t.product] <= 0) return { ok: false, reason: '架上已經空了' };
      return { ok: true, dur: 0.6 };
    case 'heckle':
      if (!c || c.kind !== 'normal' || c.state === 'leaving') return { ok: false, reason: '沒人可以嗆' };
      return { ok: true, dur: 0.8 };
    case 'repeatOrder':
      if (!c || c.kind !== 'custom' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 1.5 / m.calm };
    case 'recommend':
      if (!c || c.kind !== 'fickle' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 1.2 / m.calm };
    case 'limitTry':
      if (!c || c.kind !== 'tryhard' || c.resolved) return { ok: false, reason: '不需要' };
      if (c.state !== 'tryon') return { ok: false, reason: '他還沒進試衣間' };
      return { ok: true, dur: 1.0 / m.calm };
    case 'unplug':
      if (!c || c.kind !== 'charger' || c.resolved) return { ok: false, reason: '不需要' };
      if (c.state !== 'charge') return { ok: false, reason: '他還沒插上插座' };
      return { ok: true, dur: 1.0 / m.calm };
    case 'treat':
      if (!c || c.kind !== 'charger' || c.resolved) return { ok: false, reason: '不需要' };
      if (p.held?.kind !== 'coffee' && p.held2?.kind !== 'coffee') return { ok: false, reason: CURRENT_MAP.coffee ? `先去${FOOD_INFO.coffee.verb}` : '這間店沒有飲料可以請他' };
      return { ok: true, dur: 0.3 };
    case 'sigAct': case 'sigAlt': {
      if (!c || c.resolved) return { ok: false, reason: '不需要' };
      const d = sigDef(c.kind);
      if (!d) return { ok: false, reason: '不需要' };
      const wait = sigWaitReason(c.kind, c.state);
      if (wait) return { ok: false, reason: wait };
      if (kind === 'sigAct') {
        if (d.need && !holds(p, d.need)) return { ok: false, reason: `先拿${needName(d.need)}過來` };
        return { ok: true, dur: (d.dur ?? 1.2) / m.calm };
      }
      if (!d.alt) return { ok: false, reason: '沒有別的辦法' };
      if (d.altNeed && !holds(p, d.altNeed)) return { ok: false, reason: `先拿${needName(d.altNeed)}過來` };
      if (d.altCost && w.money < d.altCost) return { ok: false, reason: '錢不夠' };
      return { ok: true, dur: 0.3 };
    }
    case 'pickup': {
      if (t.t !== 'item') return { ok: false, reason: '目標錯誤' };
      const it = w.items.find(i => i.id === t.id);
      if (!it) return { ok: false, reason: '已被拿走' };
      if (isFood(it.held) ? !canTakeFood(p) : !handsFree(p)) return { ok: false, reason: '手上有東西' };
      return { ok: true, dur: 0 };
    }
    case 'grab': {
      if (!w.cfg.abilities.includes('grab')) return { ok: false, reason: '還沒學會（資深店員 Lv.11 解鎖）' };
      if (!c || c.gone) return { ok: false, reason: '目標不見了' };
      if (p.grabbing != null) return { ok: false, reason: '已經抓著人了' };
      if (p.held || p.held2) return { ok: false, reason: '先放下手上的東西' };
      if (c.heldBy) return { ok: false, reason: '已經被隊友抓住了' };
      if (c.state === 'leaving' || c.fly) return { ok: false, reason: '抓不到' };
      if (c.heavy && !(c.stunT && c.stunT > 0)) return { ok: false, reason: '太重了抓不動！先出手揍暈他，或用拖把旋風' };
      return { ok: true, dur: 0 };
    }
  }
  return { ok: false, reason: '未知動作' };
}

function complete(w: World, p: PlayerState, kind: ActKind, t: Target) {
  const n = activePlayers(w);
  const m = effMods(w);
  const c = t.t === 'customer' ? customer(w, t.id) : undefined;
  switch (kind) {
    case 'checkout': {
      if (t.t !== 'register') return;
      const cc = customer(w, w.registers[t.idx]!)!;
      let total = cc.items.reduce((s, it) => s + PRODUCT_INFO[it].price, 0) + (cc.foodDone ? (cc.want === 'meal' ? FOOD_INFO.meal.price : FOOD_INFO.coffee.price) : 0);
      const tip = cc.kind === 'normal' ? Math.round(total * 0.18 * m.tips * Math.max(0, cc.mood) / 100 * (w.rating / 5) * (cc.patience / cc.patienceMax + 0.3)) : 0;
      total += tip;
      w.money += total; w.dayStats.revenue += total; w.dayStats.tips += tip; w.dayStats.served++; w.totals.revenue += total; w.totals.served++;
      p.stats.served++;
      adjChaos(w, -2);
      if (cc.kind === 'boss') {
        adjChaos(w, 8); toast(w, '👑 奧客之王結完帳還不滿意！', 'bad'); bossAdvance(w, cc, p, '插隊得逞');
        ev(w, { e: 'money', amount: total, x: cc.x, z: cc.z });
        break;
      }
      if (cc.kind === 'cutter' && !cc.resolved) {
        for (const id of w.queue) { const o = customer(w, id); if (o) o.mood -= 20; }
        failKaren(w, cc, -Math.min(0.4, 0.08 * w.queue.length), 6, '😤 插隊奧客先結帳了，排隊的客人很不滿');
      } else {
        adjRating(w, 0.025 * Math.max(0.2, cc.mood / 100));
      }
      ev(w, { e: 'money', amount: total, x: cc.x, z: cc.z });
      ev(w, { e: 'sfx', name: 'cash', x: cc.x, z: cc.z });
      leave(w, cc, false);
      break;
    }
    case 'brew': giveFood(p, { kind: 'coffee' }); ev(w, { e: 'sfx', name: 'brew', x: p.x, z: p.z }); break;
    case 'heat': giveFood(p, { kind: 'meal' }); ev(w, { e: 'sfx', name: 'brew', x: p.x, z: p.z }); break;
    case 'deliver': {
      if (p.held?.kind === c!.want) { p.held = p.held2; p.held2 = null; } else p.held2 = null;
      if (c!.kind === 'fickle' && !c!.resolved) {
        c!.hits++;
        if (c!.hits < 2) {
          c!.timer = c!.patienceMax; // wants it again, differently
          toast(w, `🧋 「啊我要改${['半糖少冰', '微糖去冰', '無糖常溫', '三分糖多冰'][c!.look % 4]}」……再做一杯吧`, 'info');
          ev(w, { e: 'sfx', name: 'deliver', x: c!.x, z: c!.z });
          break;
        }
        resolveKaren(w, c!, p, 0.12, `🧋 第二杯終於對了！改單達人滿意地去結帳（口碑 +0.12）`);
      }
      if (isSig(c!.kind) && !c!.resolved) {
        const d = SIG_KARENS[c!.kind];
        c!.hits++;
        if (c!.hits <= (d.rejects ?? 0)) {
          c!.timer = c!.patienceMax; // wants it redone
          toast(w, `${d.icon} ${(d.step ?? '').replace('{n}', String((d.rejects ?? 0) + 1 - c!.hits))}`, 'info');
          ev(w, { e: 'sfx', name: 'deliver', x: c!.x, z: c!.z });
          break;
        }
        resolveKaren(w, c!, p, 0.12, `${d.icon} ${d.ok}（口碑 +0.12）`);
      }
      c!.foodDone = true; c!.mood = Math.min(100, c!.mood + 10);
      ev(w, { e: 'sfx', name: 'deliver', x: c!.x, z: c!.z });
      nextStep(w, c!);
      break;
    }
    case 'takeBox': {
      if (t.t !== 'crate') return;
      const qty = Math.min(BOX_SIZE, w.backstock[t.product]);
      w.backstock[t.product] -= qty;
      p.held = { kind: 'box', product: t.product, qty };
      ev(w, { e: 'sfx', name: 'pickup', x: p.x, z: p.z });
      break;
    }
    case 'returnBox':
      if (p.held?.kind === 'box') { w.backstock[p.held.product] += p.held.qty; p.held = null; }
      break;
    case 'stock': {
      if (t.t !== 'shelf' || p.held?.kind !== 'box') return;
      const put = Math.min(p.held.qty, cap(w) - w.shelves[t.product]);
      w.shelves[t.product] += put; p.held.qty -= put; p.stats.restocked += put;
      if (p.held.qty <= 0) p.held = null;
      ev(w, { e: 'sfx', name: 'stock', x: p.x, z: p.z });
      break;
    }
    case 'takeMop': w.mopsOnRack--; p.held = { kind: 'mop' }; break;
    case 'returnMop': w.mopsOnRack++; p.held = null; break;
    case 'clean':
      if (t.t !== 'spill') return;
      w.spills = w.spills.filter(s => s.id !== t.id);
      w.dayStats.spillsCleaned++; p.stats.cleaned++; adjRating(w, 0.01); adjChaos(w, -4);
      ev(w, { e: 'sfx', name: 'clean', x: p.x, z: p.z });
      break;
    case 'calm':
      if (c!.kind === 'boss') { c!.anger -= 18 * m.calm; ev(w, { e: 'sfx', name: 'calm', x: c!.x, z: c!.z }); if (c!.anger <= 0) bossAdvance(w, c!, p, `${p.name} 安撫成功`); break; }
      c!.anger -= 26 * m.calm;
      ev(w, { e: 'sfx', name: 'calm', x: c!.x, z: c!.z });
      if (c!.anger <= 0) {
        c!.anger = 0;
        resolveKaren(w, c!, p, 0.15, `😌 ${p.name} 成功安撫退貨奧客（口碑 +0.15）`);
        leave(w, c!, false);
      }
      break;
    case 'coupon':
      w.money -= 30; c!.anger = 0;
      resolveKaren(w, c!, p, 0.05, `🎟 ${p.name} 發了折價券打發奧客（-$30）`);
      leave(w, c!, false);
      break;
    case 'askQueue': {
      if (c!.kind === 'boss') { bossAdvance(w, c!, p, `${p.name} 請他排隊`); break; }
      resolveKaren(w, c!, p, 0.1, `👉 ${p.name} 請插隊奧客到隊伍最後面（口碑 +0.1）`);
      detachFromLines(w, c!);
      joinQueue(w, c!, false);
      break;
    }
    case 'stopFilm': {
      if (c!.kind === 'boss') { c!.hits++; if (c!.hits >= 2) bossAdvance(w, c!, p, `${p.name} 制止直播`); else { toast(w, '👑 還要再制止 1 次！', 'info'); c!.state = 'flee'; c!.speed = 3.0; setGoal(c!, fleeSpot(w, c!, p)); } break; }
      c!.hits++;
      const need = 1 + Math.floor((n - 1) / 2);
      if (c!.hits >= need) {
        resolveKaren(w, c!, p, 0.12, `📵 ${p.name} 制止了直播客（口碑 +0.12）`);
        leave(w, c!, false);
      } else {
        toast(w, `📵 直播客不聽勸，還要再 ${need - c!.hits} 次`, 'info');
        c!.state = 'flee'; c!.speed = 3.0; setGoal(c!, fleeSpot(w, c!, p));
      }
      break;
    }
    case 'stopLitter':
      resolveKaren(w, c!, p, 0.1, `🗑 ${p.name} 請亂丟客把垃圾帶走（口碑 +0.1）`);
      leave(w, c!, false);
      break;
    case 'knock': {
      if (t.t !== 'shelf' || !w.raid) return;
      const n = Math.min(2, w.shelves[t.product]);
      w.shelves[t.product] -= n; addSpill(w, p.x + Math.sin(p.yaw) * 0.8, p.z + Math.cos(p.yaw) * 0.8); adjChaos(w, 3);
      w.raid.score += 12; w.raid.knocked++;
      ev(w, { e: 'sfx', name: 'crash', x: p.x, z: p.z });
      break;
    }
    case 'heckle':
      if (!w.raid) return;
      w.raid.score += 15; w.raid.heckled++;
      toast(w, '😈 你嗆走了一位客人', 'info');
      angryLeave(w, c!);
      break;
    case 'repeatOrder':
      resolveKaren(w, c!, p, 0.1, `🍳 ${p.name} 複誦了一遍點單，客製魔人終於點頭了（口碑 +0.1）`);
      break;
    case 'recommend':
      resolveKaren(w, c!, p, 0.05, `🧋 ${p.name} 推薦招牌，改單達人說「好啦就這個」（口碑 +0.05）`);
      break;
    case 'limitTry':
      c!.shopping = [pick(w, PRODUCTS)];
      resolveKaren(w, c!, p, 0.1, `👕 ${p.name} 請試穿狂限穿 3 件，他挑了一件去結帳（口碑 +0.1）`);
      nextStep(w, c!);
      break;
    case 'unplug':
      c!.hits++;
      ev(w, { e: 'sfx', name: 'unplug', x: c!.x, z: c!.z });
      if (c!.hits >= 2) { resolveKaren(w, c!, p, 0.08, `🔌 ${p.name} 拔掉插頭，充電霸王悻悻然離開（口碑 +0.08）`); leave(w, c!, false); }
      else toast(w, CURRENT_MAP.coffee ? `🔌 他又插回去了！再拔一次，或請他喝杯${FOOD_INFO.coffee.name}` : '🔌 他又插回去了！再拔一次', 'info');
      break;
    case 'treat':
      if (p.held?.kind === 'coffee') { p.held = p.held2; p.held2 = null; } else p.held2 = null;
      resolveKaren(w, c!, p, 0.15, `${FOOD_INFO.coffee.icon} ${p.name} 請充電霸王喝${FOOD_INFO.coffee.name}，他開心地讓出插座（口碑 +0.15）`);
      ev(w, { e: 'sfx', name: 'deliver', x: c!.x, z: c!.z });
      leave(w, c!, false);
      break;
    case 'sigAct': sigAct(w, p, c!, false); break;
    case 'sigAlt': sigAct(w, p, c!, true); break;
    case 'checkBag':
      c!.items = c!.eaten.length ? [...c!.eaten] : [pick(w, PRODUCTS)]; c!.eaten = [];
      resolveKaren(w, c!, p, 0.1, `🧾 ${p.name} 抓到偷吃奧客，他要去結帳了`);
      joinQueue(w, c!, false);
      break;
    case 'pickup': {
      if (t.t !== 'item') return;
      const it = w.items.find(i => i.id === t.id)!;
      w.items = w.items.filter(i => i.id !== t.id);
      if (isFood(it.held)) giveFood(p, it.held); else p.held = it.held;
      ev(w, { e: 'sfx', name: 'pickup', x: p.x, z: p.z });
      break;
    }
    case 'grab': {
      detachFromLines(w, c!);
      c!.heldBy = p.id; c!.state = 'held'; c!.path = []; c!.fly = null;
      p.grabbing = c!.id;
      if (c!.kind === 'normal') toast(w, '⚠ 這是一般顧客！丟出去會被扣分，按「放下」放開他', 'bad');
      ev(w, { e: 'sfx', name: 'grab', x: c!.x, z: c!.z });
      break;
    }
  }
}

/** Request an action. Duplicate request ids return the original result (no double effects). */
export function requestAct(w: World, playerId: string, rid: string, kind: ActKind, target: Target) {
  const p = w.players.get(playerId);
  if (!p) return;
  const prev = p.recent.get(rid);
  if (prev) { w.results.push({ playerId, rid, ...prev }); return; }
  const remember = (ok: boolean, reason?: string) => {
    p.recent.set(rid, { ok, reason });
    if (p.recent.size > 64) p.recent.delete(p.recent.keys().next().value!);
    w.results.push({ playerId, rid, ok, reason });
  };
  if (p.busy) return remember(false, '正在忙');
  const r = check(w, p, kind, target);
  if (!r.ok) return remember(false, r.reason);
  if (r.dur <= 0) { complete(w, p, kind, target); return remember(true); }
  let reserved: Product | undefined;
  if (kind === 'heat') { w.backstock.bento--; reserved = 'bento'; } // reserve the ingredient, refunded on cancel
  p.busy = { kind, target, start: w.time, dur: r.dur, rid, reserved };
  remember(true);
}

function cancelBusy(w: World, p: PlayerState) {
  if (p.busy?.reserved) w.backstock[p.busy.reserved]++;
  p.busy = null;
}

function once(p: PlayerState, rid: string) {
  if (p.recent.has(rid)) return false;
  p.recent.set(rid, { ok: true });
  if (p.recent.size > 64) p.recent.delete(p.recent.keys().next().value!);
  return true;
}

export function requestDrop(w: World, playerId: string, rid: string) {
  const p = w.players.get(playerId);
  if (!p || !once(p, rid)) return;
  if (p.busy) { cancelBusy(w, p); return; }
  if (p.grabbing != null) { releaseGrab(w, p); return; }
  if (p.raider && w.raid && w.phase === 'open') {
    // the troublemaker's drop key throws trash on the floor (short cooldown)
    if (w.time - (p.litterAt ?? -9) < 1.5) return;
    p.litterAt = w.time; addSpill(w, p.x, p.z); adjChaos(w, 1); w.raid.score += 5; w.raid.litter++;
    ev(w, { e: 'sfx', name: 'splat', x: p.x, z: p.z });
    return;
  }
  if (!p.held && !p.held2) return;
  if (p.held2) { p.held2 = null; ev(w, { e: 'sfx', name: 'drop', x: p.x, z: p.z }); return; }
  if (isFood(p.held)) { p.held = null; adjChaos(w, 1); addSpill(w, p.x + Math.sin(p.yaw) * 0.6, p.z + Math.cos(p.yaw) * 0.6); ev(w, { e: 'sfx', name: 'drop', x: p.x, z: p.z }); return; }
  dropHeld(w, p);
  ev(w, { e: 'sfx', name: 'drop', x: p.x, z: p.z });
}

/** Throw the grabbed customer in the look direction. */
export function requestThrow(w: World, playerId: string, rid: string, yaw: number, pitch: number) {
  const p = w.players.get(playerId);
  if (!p || !once(p, rid) || p.grabbing == null || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
  const c = customer(w, p.grabbing);
  p.grabbing = null;
  if (!c || c.heldBy !== p.id) return;
  c.heldBy = null; c.state = 'flying';
  const lift = Math.max(-0.25, Math.min(0.55, pitch));
  const power = 11.5 * w.cfg.mods.throwPower;
  c.fly = { vx: Math.sin(yaw) * power, vz: Math.cos(yaw) * power, vy: 3.6 + lift * 5, y: 0.62, t: 2.8, thrown: true, by: p.id };
  adjBurst(w, 4);
  ev(w, { e: 'fx', name: 'throw', x: c.x, z: c.z, by: p.name });
  ev(w, { e: 'sfx', name: 'throw', x: c.x, z: c.z });
}

/** Mop whirlwind: knock back everyone nearby. */
export function requestSpin(w: World, playerId: string, rid: string) {
  const p = w.players.get(playerId);
  if (!p || !once(p, rid)) return;
  if (!w.cfg.abilities.includes('spin')) { w.results.push({ playerId, rid, ok: false, reason: '還沒學會（副店長 Lv.16 解鎖）' }); return; }
  if (w.time < p.spinReadyAt) { w.results.push({ playerId, rid, ok: false, reason: `旋風冷卻中（${Math.ceil(p.spinReadyAt - w.time)} 秒）` }); return; }
  if (p.grabbing != null) { w.results.push({ playerId, rid, ok: false, reason: '先丟出抓著的人' }); return; }
  const m = w.cfg.mods;
  p.spinReadyAt = w.time + m.spinCooldown;
  adjBurst(w, 12);
  let hitNormal = 0, hits = 0;
  for (const c of w.customers) {
    if (c.gone || c.heldBy || c.fly) continue;
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d > m.spinRange) continue;
    const k = Math.max(0.1, d);
    detachFromLines(w, c);
    const push = c.heavy ? 2.5 : 7;
    if (c.heavy) c.stunT = 2.2;
    c.fly = { vx: (c.x - p.x) / k * push, vz: (c.z - p.z) / k * push, vy: c.heavy ? 1.6 : 3.8, y: 0.3, t: c.heavy ? 0.8 : 1.8, thrown: false, by: p.id };
    c.state = 'flying'; c.path = []; hits++;
    if (c.kind === 'normal') { hitNormal++; c.mood -= 30; }
  }
  if (hitNormal) { adjChaos(w, 4 * hitNormal); adjRating(w, -0.05 * hitNormal); }
  ev(w, { e: 'fx', name: 'spin', x: p.x, z: p.z, by: p.name });
  ev(w, { e: 'sfx', name: 'spin', x: p.x, z: p.z });
  if (hitNormal) toast(w, `🌀 旋風也掃到 ${hitNormal} 位一般顧客（混亂 +${4 * hitNormal}）`, 'bad');
  else if (hits) toast(w, `🌀 拖把旋風！擊退 ${hits} 人`, 'good');
}

/** Is hitting this customer self-defence right now? */
export function isViolent(w: World, c: Customer) {
  if (c.kind === 'boss') return true;
  if (c.kind === 'rager' && !c.resolved && c.state === 'complain' && c.anger >= 70) return true;
  return w.time - (c.shoveAt ?? -99) < 6;
}

/** 出手: a cartoon smack that dazes the target. Whether it was justified decides if the police come. */
export function requestHit(w: World, playerId: string, rid: string, id: number) {
  const p = w.players.get(playerId);
  if (!p || !once(p, rid)) return;
  const fail = (reason: string) => w.results.push({ playerId, rid, ok: false, reason });
  if (!w.cfg.abilities.includes('hit')) return fail('還不能出手（正職店員 Lv.6 解鎖）');
  if (w.phase === 'summary') return fail('已經結算');
  if (w.time < (p.hitReadyAt ?? 0)) return;
  if (p.grabbing != null) return fail('先把抓著的人丟出去');
  const c = customer(w, id);
  if (!c || c.gone || c.fly || c.heldBy || c.state === 'leaving') return fail('打不到');
  if (Math.hypot(c.x - p.x, c.z - p.z) > 2.0) return fail('距離太遠');
  p.hitReadyAt = w.time + 0.7;
  w.results.push({ playerId, rid, ok: true });
  const legal = c.kind !== 'normal' && isViolent(w, c);
  const name = c.kind === 'normal' ? '一般顧客' : KAREN_INFO[c.kind as KarenKind].name;
  // small knock-back away from the worker, then dazed
  const d = Math.max(0.1, Math.hypot(c.x - p.x, c.z - p.z));
  const pos = resolveCollision(c.x + (c.x - p.x) / d * 0.5, c.z + (c.z - p.z) / d * 0.5, 0.25);
  c.x = pos.x; c.z = pos.z;
  const wasStunned = (c.stunT ?? 0) > 0;
  c.stunT = c.kind === 'boss' ? 1.5 : 2.5;
  ev(w, { e: 'fx', name: 'hit', x: c.x, z: c.z, by: p.name });
  ev(w, { e: 'sfx', name: 'hit', x: c.x, z: c.z });
  if (c.kind === 'normal') {
    adjRating(w, -0.3); adjChaos(w, 8);
    w.incidents.push({ who: name, legal: false, vip: !!c.vip, normal: true, why: '打了一般顧客' });
    toast(w, '😱 你打了一般顧客！口碑大跌，他要去報警了', 'bad');
    angryLeave(w, c);
    return;
  }
  adjBurst(w, legal ? 10 : 5);
  if (legal) {
    if (c.kind === 'rager') c.anger = Math.max(0, c.anger - 45);
    if (c.vip) w.incidents.push({ who: name, legal: true, vip: true, normal: false, why: '對方先失控（正當防衛），但他有背景' });
    if (wasStunned && c.kind !== 'boss' && !c.resolved) {
      resolveKaren(w, c, p, 0, `🥊 ${p.name} 制伏了失控的${name}，他摸摸鼻子走了`);
      leave(w, c, false);
    } else toast(w, c.vip ? `💼 正當防衛……但${name}好像有背景，可能會有人報警` : `🥊 正當防衛！${name}被打暈了`, c.vip ? 'bad' : 'good');
  } else {
    adjRating(w, -0.1);
    if (c.kind === 'rager') c.anger = Math.min(99, c.anger + 15);
    w.incidents.push({ who: name, legal: false, vip: !!c.vip, normal: false, why: c.vip ? '先動手打了有背景的奧客' : '對方沒有失控，你先動手' });
    toast(w, c.vip ? `💼 糟了！你先動手打了有背景的${name}，下班警察一定會來` : `⚠ 你先動手了！${name}沒有失控，這可能會惹上麻煩`, 'bad');
  }
}

export function requestUltimate(w: World, playerId: string, rid: string) {
  const p = w.players.get(playerId);
  if (!p || !once(p, rid)) return;
  if (!w.cfg.abilities.includes('ultimate')) { w.results.push({ playerId, rid, ok: false, reason: '還沒學會（區域督導 Lv.26 解鎖）' }); return; }
  if (w.burst < BURST_MAX) { w.results.push({ playerId, rid, ok: false, reason: `爆發值 ${Math.floor(w.burst)}/100` }); return; }
  const targets = w.customers.filter(c => c.kind !== 'normal' && !c.resolved && !c.gone && c.state !== 'leaving');
  if (!targets.length) { w.results.push({ playerId, rid, ok: false, reason: '店內沒有奧客，先存著' }); return; }
  w.burst = 0;
  for (const c of targets) { if (c.heldBy) { const h = w.players.get(c.heldBy); if (h) h.grabbing = null; } eject(w, c, p, 'ultimate'); }
  adjChaos(w, -15);
  ev(w, { e: 'fx', name: 'ultimate', x: p.x, z: p.z, by: p.name });
  ev(w, { e: 'sfx', name: 'ultimate' });
  toast(w, `✴ ${p.name}：全 店 奧 客 退 散 ！`, 'good');
}

/** Purchases. Upgrades carry the level the buyer saw, so a resent/duplicate request can't buy twice. */
/** A purchase between days (prep / summary of a business day) is saved right away, so quitting never loses it. */
function saveBetweenDays(w: World) {
  if (w.cfg.mode !== 'day' || (w.phase !== 'prep' && w.phase !== 'summary')) return;
  const night = w.saveOut !== null && w.saveKind === 'night'; // tonight's settlement not sent yet: keep it a settlement
  w.saveOut = { ...toSave(w), day: w.phase === 'summary' ? w.day + 1 : w.day };
  w.saveKind = night ? 'night' : 'purchase';
}

export function requestBuy(w: World, playerId: string, rid: string, item: string, level?: number) {
  const p = w.players.get(playerId);
  if (!p) return;
  const prev = p.recent.get(rid);
  if (prev) { w.results.push({ playerId, rid, ...prev }); return; }
  const done = (ok: boolean, reason?: string) => { p.recent.set(rid, { ok, reason }); w.results.push({ playerId, rid, ok, reason }); };
  if (item.startsWith('stock_')) {
    const prod = item.slice(6) as Product;
    if (!PRODUCTS.includes(prod)) return done(false, '未知商品');
    const cost = PRODUCT_INFO[prod].boxCost;
    if (w.money < cost) return done(false, '錢不夠');
    w.money -= cost; w.backstock[prod] += BOX_SIZE; w.dayStats.expenses += cost;
    ev(w, { e: 'sfx', name: 'buy' });
    saveBetweenDays(w);
    return done(true);
  }
  if (item.startsWith('upg_')) {
    if (w.cfg.mode === 'shift') return done(false, '班次模式請在職涯畫面升級裝備');
    const id = item.slice(4) as UpgradeId;
    const def = UPGRADES[id];
    if (!def) return done(false, '未知升級');
    if (w.phase !== 'prep' && w.phase !== 'summary') return done(false, '營業中不能施工升級');
    const cur = w.upgrades[id];
    if (level !== cur) return done(false, '已被隊友升級');
    if (cur >= def.costs.length) return done(false, '已達最高等級');
    const cost = def.costs[cur];
    if (w.money < cost) return done(false, '錢不夠');
    w.money -= cost; w.upgrades[id] = cur + 1;
    toast(w, `🔧 ${p.name} 購買升級：${def.name} Lv${cur + 1}`, 'good');
    ev(w, { e: 'sfx', name: 'upgrade' });
    saveBetweenDays(w);
    return done(true);
  }
  done(false, '未知項目');
}

export function addPing(w: World, playerId: string, x: number, z: number) {
  const p = w.players.get(playerId);
  if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return;
  w.pings = w.pings.filter(pg => pg.by !== playerId);
  const c = clampToStore(x, z, 0);
  w.pings.push({ id: w.nextId++, x: c.x, z: c.z, by: playerId, until: w.time + 8 });
  ev(w, { e: 'sfx', name: 'ping', x: c.x, z: c.z });
}

export function setReady(w: World, playerId: string, ready: boolean) {
  const p = w.players.get(playerId);
  if (p) p.ready = ready;
}

// ---------------- phases ----------------
function allReady(w: World) {
  const ps = [...w.players.values()].filter(p => p.connected);
  return ps.length > 0 && ps.every(p => p.ready);
}

function setPhase(w: World, phase: Phase) {
  w.phase = phase;
  for (const p of w.players.values()) p.ready = false;
  ev(w, { e: 'phase', phase, day: w.day });
}

function clearFloor(w: World) {
  for (const p of w.players.values()) {
    cancelBusy(w, p);
    if (p.held?.kind === 'box') w.backstock[p.held.product] += p.held.qty;
    p.held = null; p.held2 = null; p.grabbing = null;
  }
  for (const it of w.items) if (it.held.kind === 'box') w.backstock[it.held.product] += it.held.qty;
  w.items = []; w.spills = []; w.customers = []; w.queue = []; w.registers = [null, null]; w.pings = [];
  w.mopsOnRack = 2; w.event = null; w.power = 1;
}

function settleDay(w: World) {
  clearFloor(w);
  if (w.bonusPaidDay !== w.day) { // pay the daily bonus exactly once per day
    w.bonusPaidDay = w.day;
    const bonus = Math.round(w.rating * 12 + w.dayStats.karensResolved * 10);
    w.dayStats.bonus = bonus;
    const staff = w.cfg.staffWage ?? 0; // own store: your employee's day wage
    w.dayStats.expenses += DAILY_RENT + staff;
    if (staff) w.dayStats.wage = staff;
    w.money += bonus - DAILY_RENT - staff;
  }
  w.saveOut = { ...toSave(w), day: w.day + 1 }; w.saveKind = 'night';
}

export function finishShift(w: World, failReason: string) {
  if (w.result) return;
  const d = w.dayStats;
  if (!failReason && w.cfg.boss && !w.bossDefeated) failReason = '奧客之王還在店裡，沒能讓他退散';
  const survived = Math.round(w.time - w.openTime);
  const score = d.revenue + d.ejected * 10 + d.karensResolved * 15 + survived;
  const won = w.cfg.endless || w.raid ? true : !failReason && d.revenue >= w.cfg.goal;
  w.result = {
    shiftId: w.cfg.id, won, failReason: failReason || (won ? '' : `營業額未達目標 $${w.cfg.goal}`),
    revenue: d.revenue, goal: w.cfg.goal, rating: Math.round(w.rating * 100) / 100, chaos: Math.round(w.chaos),
    served: d.served, angryLeft: d.angryLeft, karensResolved: d.karensResolved, karensFailed: d.karensFailed,
    ejected: d.ejected, cleaned: d.spillsCleaned, maxCombo: d.maxCombo,
    score: w.cfg.endless ? score : w.raid ? w.raid.score : undefined, survived, bossDefeated: w.cfg.boss ? w.bossDefeated : undefined,
    date: w.cfg.daily?.date, week: w.cfg.weekly?.week, tips: d.tips, incidents: w.incidents.length ? [...w.incidents] : undefined,
    handled: Object.keys(w.handled).length ? { ...w.handled } : undefined,
  };
  if (w.cfg.endless) w.result.failReason = failReason ? `${failReason}・撐了 ${survived} 秒` : `主動下班・撐了 ${survived} 秒`;
  clearFloor(w);
  setPhase(w, 'summary'); w.phaseLeft = 0;
  ev(w, { e: 'sfx', name: won ? 'open' : 'angry' });
}

function updateEvents(w: World, dt: number) {
  if (!w.cfg.events.length) return;
  if (w.event) {
    w.event.left -= dt;
    if (w.event.kind === 'rush') {
      w.event.pulse -= dt;
      if (w.event.pulse <= 0) { w.event.pulse = 2.8; if (w.customers.length < w.cfg.maxCustomers + 3 * activePlayers(w) + 4) spawnCustomer(w, 'normal'); }
    }
    if (w.event.left <= 0) { w.event = null; w.power = 1; toast(w, '突發狀況結束，繼續營業', 'info'); }
    return;
  }
  w.nextEvent -= dt;
  if (w.nextEvent <= 0) {
    w.nextEvent = w.cfg.eventEvery ?? 42;
    const kind = pick(w, w.cfg.events);
    w.event = { kind, left: kind === 'rush' ? 14 : 11, pulse: 0 };
    if (kind === 'outage') { w.power = 0.35; toast(w, '⚡ 突然停電！備用照明啟動，顧客比較不耐煩', 'bad'); ev(w, { e: 'sfx', name: 'outage' }); }
    else toast(w, '🚶 尖峰人潮！接下來客人暴增', 'bad');
  }
}

export function tick(w: World, dt: number) {
  w.time += dt;
  w.difficultyPlayers = activePlayers(w);
  const n = w.difficultyPlayers;
  const shift = w.cfg.mode === 'shift';
  // player channel actions
  for (const p of w.players.values()) {
    if (!p.busy) continue;
    const b = p.busy;
    if (w.time >= b.start + b.dur) {
      p.busy = null;
      const r = check(w, p, b.kind, b.target, true);
      if (r.ok) complete(w, p, b.kind, b.target);
      else { if (b.reserved) w.backstock[b.reserved]++; toast(w, `${p.name}：動作中斷（${r.reason}）`, 'info'); }
    } else if (targetDist(w, p, b.target) > SERVER_INTERACT_RANGE + 0.4) {
      cancelBusy(w, p);
    }
  }
  w.pings = w.pings.filter(pg => pg.until > w.time);
  while (w.hintQueue.length && w.hintQueue[0].at <= w.time) ev(w, { e: 'hint', text: w.hintQueue.shift()!.text });

  switch (w.phase) {
    case 'prep':
      w.phaseLeft -= dt;
      if (w.phaseLeft <= 0 || allReady(w)) {
        setPhase(w, 'open'); w.clock = OPEN_MINUTE; w.phaseLeft = w.cfg.length;
        w.dayStats = emptyStats(w.rating); w.handled = {}; w.spawnTimer = 2; w.karenTimer = w.cfg.firstKaren; w.lastKaren = ''; w.saveOut = null; w.nextEvent = w.cfg.firstEvent;
        w.openTime = w.time; w.bossTimer = w.cfg.bossAt; w.rampTimer = 0;
        toast(w, shift ? `🏪 ${w.cfg.title}：開始上班！目標營業額 $${w.cfg.goal}` : `🏪 第 ${w.day} 天開始營業！`, 'good');
        ev(w, { e: 'sfx', name: 'open' });
      }
      break;
    case 'open': {
      w.phaseLeft -= dt;
      w.clock = OPEN_MINUTE + (1 - Math.max(0, w.phaseLeft) / w.cfg.length) * (CLOSE_MINUTE - OPEN_MINUTE);
      const playerScale = 0.7 + 0.3 * n;
      const ratingScale = 0.6 + w.rating * 0.16;
      const adsScale = 1 + 0.2 * w.upgrades.ads;
      w.spawnTimer -= dt * playerScale * ratingScale * adsScale;
      const maxCustomers = w.cfg.maxCustomers + 3 * n;
      if (w.spawnTimer <= 0) {
        w.spawnTimer = w.cfg.spawnEvery * (0.8 + w.rng() * 0.45);
        if (w.customers.length < maxCustomers) spawnCustomer(w, 'normal');
      }
      if (w.cfg.karens.length) {
        w.karenTimer -= dt * (0.8 + 0.2 * n);
        if (w.karenTimer <= 0) {
          w.karenTimer = w.cfg.karenEvery * (0.85 + w.rng() * 0.4);
          const active = w.customers.filter(c => c.kind !== 'normal' && c.kind !== 'boss' && !c.resolved && !c.gone);
          if (active.length < Math.floor(w.cfg.maxKarens) + Math.floor((n - 1) / 2)) {
            const avail = w.cfg.karens.filter(k => !active.some(a => a.kind === k));
            // the shift's featured karen (listed first, the one its hint explains) comes first; after that avoid
            // the same kind twice in a row when there is another choice
            const fresh = avail.filter(k => k !== w.lastKaren);
            const kind = shift && !w.lastKaren && avail.includes(w.cfg.karens[0]) ? w.cfg.karens[0] : pick(w, fresh.length ? fresh : avail.length ? avail : w.cfg.karens);
            w.lastKaren = kind;
            spawnCustomer(w, kind);
          }
        }
      }
      updateEvents(w, dt);
      if (w.cfg.boss && !w.bossSpawned) { w.bossTimer -= dt; if (w.bossTimer <= 0) { w.bossSpawned = true; spawnCustomer(w, 'boss'); } }
      if (w.cfg.endless) {
        w.rampTimer += dt;
        if (w.rampTimer >= 45) {
          w.rampTimer = 0;
          w.cfg = { ...w.cfg, spawnEvery: Math.max(3.2, w.cfg.spawnEvery * 0.9), maxKarens: Math.min(5, w.cfg.maxKarens + 0.5), karenEvery: Math.max(18, w.cfg.karenEvery * 0.9) };
          toast(w, '🌙 夜更深了，客人越來越多……', 'info');
        }
      }
      if (w.raid) {
        // staff who stand next to you for a while ask you to leave
        const r = [...w.players.values()].find(p => p.raider);
        const near = r && [...w.players.values()].some(p => !p.raider && Math.hypot(p.x - r.x, p.z - r.z) < 1.6);
        w.raid.watched = Math.max(0, Math.min(2.5, w.raid.watched + (near ? dt : -dt * 0.5)));
        if (w.raid.watched >= 2.5 && !w.raid.caught) { w.raid.caught = true; toast(w, '🧹 店員：「先生，請你出去。」你被請出店了', 'bad'); finishShift(w, '被店員請出去了'); break; }
        if (w.phaseLeft <= 0) { finishShift(w, ''); break; }
      }
      if (w.phaseLeft <= 0) {
        setPhase(w, 'closing'); w.phaseLeft = shift ? 10 : CLOSING_MAX_SECONDS; w.clock = CLOSE_MINUTE;
        w.event = null; w.power = 1;
        toast(w, shift ? '🔔 下班時間到！把手上的結帳做完' : '🌙 打烊時間到！服務完店內顧客', 'info');
      }
      break;
    }
    case 'closing':
      w.phaseLeft -= dt;
      for (const c of w.customers) {
        if (c.kind !== 'normal' && c.kind !== 'boss' && !c.resolved && c.state !== 'leaving' && c.kind !== 'cutter' && !c.heldBy && !c.fly) { c.resolved = true; leave(w, c, false); }
      }
      if (w.customers.filter(c => !(c.kind === 'boss' && !c.resolved)).length === 0 || w.phaseLeft <= 0) {
        if (shift) finishShift(w, '');
        else { settleDay(w); setPhase(w, 'summary'); w.phaseLeft = 0; }
      }
      break;
    case 'summary':
      if (!shift && allReady(w)) {
        w.day++; setPhase(w, 'prep'); w.phaseLeft = PREP_SECONDS; w.clock = OPEN_MINUTE;
        w.dayStats = emptyStats(w.rating); w.handled = {};
      }
      break;
  }

  if (w.phase === 'open' || w.phase === 'closing') {
    adjRating(w, -0.0008 * Math.min(6, w.spills.length) * dt);
    w.chaosTimer += dt;
    if (w.chaosTimer >= 8) {
      w.chaosTimer = 0; adjChaos(w, w.spills.length * 0.8);
      if (w.customers.some(c => c.kind === 'boss' && !c.resolved)) adjChaos(w, 2);
    }
    if ((w.upgrades.selfcheck ?? 0) > 0) selfCheckout(w, dt);
    if (w.upgrades.mopbot > 0 && w.spills.length) {
      w.mopbotTimer -= dt;
      if (w.mopbotTimer <= 0) { w.mopbotTimer = 20; const s = w.spills.shift()!; ev(w, { e: 'sfx', name: 'clean', x: s.x, z: s.z }); }
    }
    if (w.cfg.mods.guard > 0) {
      w.guardTimer -= dt;
      if (w.guardTimer <= 0) {
        w.guardTimer = guardInterval(w.cfg.mods.guard);
        const k = w.customers.filter(c => c.kind !== 'normal' && c.kind !== 'boss' && !c.resolved && !c.gone && !c.heldBy && !c.fly && Math.hypot(c.x - ENTRANCE.x, c.z - ENTRANCE.z) < 5.5)[0];
        if (k) eject(w, k, null, 'guard');
      }
    }
    if (shift && (w.chaos >= CHAOS_MAX || w.rating <= 0)) finishShift(w, w.chaos >= CHAOS_MAX ? '店面混亂度爆表' : '口碑歸零');
  }

  if (w.phase !== 'summary') {
    updateQueue(w);
    for (const c of [...w.customers]) if (!c.gone) updateCustomer(w, c, dt);
    w.customers = w.customers.filter(c => !c.gone);
  }
}

/** 自助結帳機: every few seconds one ordinary customer in line with a small basket pays at the kiosk (no tip). */
function selfCheckout(w: World, dt: number) {
  w.selfTimer -= dt;
  if (w.selfTimer > 0) return;
  const c = w.queue.map(id => customer(w, id)).find(c => !!c && c.kind === 'normal' && c.state === 'queue' && c.items.length > 0 && c.items.length <= 2 && (!c.want || c.foodDone || c.foodFailed));
  if (!c) { w.selfTimer = 2; return; }
  w.selfTimer = selfcheckEvery(w.upgrades.selfcheck);
  const total = c.items.reduce((s, it) => s + PRODUCT_INFO[it].price, 0) + (c.foodDone ? (c.want === 'meal' ? FOOD_INFO.meal.price : FOOD_INFO.coffee.price) : 0);
  w.money += total; w.dayStats.revenue += total; w.dayStats.served++; w.totals.revenue += total; w.totals.served++;
  adjRating(w, 0.01);
  ev(w, { e: 'money', amount: total, x: c.x, z: c.z });
  ev(w, { e: 'sfx', name: 'cash', x: c.x, z: c.z });
  leave(w, c, false);
}

export function snapshot(w: World, now: number): Snapshot {
  const reveal = (c: Customer) => {
    if ((c.kind !== 'hog' && !sigDef(c.kind)?.hidden) || c.resolved) return true;
    if (w.upgrades.camera > 0) return true;
    for (const p of w.players.values()) if (Math.hypot(p.x - c.x, p.z - c.z) < 4) return true;
    return false;
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // 有背景 shows only up close (a gold watch, a bodyguard's phone call…)
  const near4 = (c: Customer) => { for (const p of w.players.values()) if (Math.hypot(p.x - c.x, p.z - c.z) < 4) return true; return false; };
  return {
    t: now, raid: w.raid ? { score: w.raid.score, watched: r2(w.raid.watched / 2.5) } : undefined,
    phase: w.phase, phaseLeft: Math.max(0, w.phaseLeft), clock: w.clock, day: w.day,
    money: w.money, rating: r2(w.rating), backstock: { ...w.backstock }, shelves: { ...w.shelves }, upgrades: { ...w.upgrades },
    mopsOnRack: w.mopsOnRack, playerCount: activePlayers(w),
    players: [...w.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, x: r2(p.x), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), held: p.held, held2: p.held2,
      connected: p.connected, away: p.away, ready: p.ready, grabbing: p.grabbing, spinCd: r2(Math.max(0, p.spinReadyAt - w.time)), raider: p.raider || undefined, outfit: p.outfit, bot: p.bot || undefined,
      busy: p.busy ? { kind: p.busy.kind, p: Math.min(1, (w.time - p.busy.start) / p.busy.dur) } : null,
    })),
    customers: w.customers.map(c => ({
      id: c.id, kind: c.kind, x: r2(c.x), z: r2(c.z), yaw: r2(c.yaw), state: c.state === 'camp' && sigDef(c.kind)?.sit ? 'charge' : c.state,
      patience: Math.max(0, Math.min(1, c.state === 'waitFood' ? c.timer / c.patienceMax : c.kind === 'charger' ? c.life / 75
        : c.lifeMax && !c.resolved && sigBarState(c) ? c.life / c.lifeMax : c.patience / c.patienceMax)),
      anger: Math.round(c.anger), resolved: c.resolved, revealed: reveal(c), items: c.items.length,
      want: c.want && !c.foodDone && !c.foodFailed ? c.want : null, look: c.look, moving: c.moving,
      y: c.fly ? r2(c.fly.y) : c.state === 'held' ? 0.25 : 0, held: c.state === 'held', flying: !!c.fly, down: c.downT ? r2(c.downT) : 0,
      heavy: !!c.heavy, vip: !!c.vip && near4(c), stun: c.stunT ? r2(c.stunT) : 0, violent: c.kind !== 'normal' && !c.resolved && isViolent(w, c), phase: c.kind === 'charger' || c.kind === 'fickle' || isSig(c.kind) ? c.hits : c.phase,
    })),
    spills: w.spills.map(s => ({ id: s.id, x: r2(s.x), z: r2(s.z) })),
    items: w.items.map(i => ({ id: i.id, x: r2(i.x), z: r2(i.z), held: i.held })),
    pings: w.pings.map(pg => ({ id: pg.id, x: pg.x, z: pg.z, by: pg.by, ttl: pg.until - w.time })),
    dayStats: { ...w.dayStats },
    chaos: Math.round(w.chaos), burst: Math.floor(w.burst), combo: w.time < w.comboUntil ? w.combo : 0, power: w.power,
    event: w.event ? { kind: w.event.kind, left: r2(w.event.left) } : null,
    shift: {
      mode: w.cfg.mode, id: w.cfg.id, title: w.cfg.title, chapter: w.cfg.chapter, goal: w.cfg.goal, length: w.cfg.length, abilities: w.cfg.abilities, foods: w.cfg.foods, endless: w.cfg.endless, boss: w.cfg.boss,
      staminaMax: w.cfg.mods.staminaMax, staminaRegen: w.cfg.mods.staminaRegen, speed: w.cfg.mods.speed,
    },
    result: w.result,
  };
}
