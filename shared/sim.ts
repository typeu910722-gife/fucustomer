// Authoritative game simulation. Runs on the dedicated server for multiplayer and inside the
// browser for solo play. All transactions (money, stock, items, karen outcomes) happen here.
import {
  BOX_SIZE, CLOSE_MINUTE, CLOSING_MAX_SECONDS, COFFEE_PRICE, DAILY_RENT, DAY_OPEN_SECONDS, KAREN_INFO, KarenKind,
  OPEN_MINUTE, PREP_SECONDS, PRODUCTS, PRODUCT_INFO, Product, RUN_SPEED, SERVER_INTERACT_RANGE, UPGRADES, UPGRADE_IDS,
  UpgradeId, brewTime, checkoutTime, shelfCapacity,
} from './constants.ts';
import {
  COFFEE_MACHINE, COFFEE_PICKUP, COMPLAINT_SPOT, COUNTER, CRATES, MOP_RACK, PLAYER_SPAWNS, QUEUE_SPOTS, REGISTERS,
  SHELVES, SPAWN_OUTSIDE, clampToStore, distToAABB, findPath, resolveCollision, shelfBrowseSpots,
} from './map.ts';
import type {
  ActKind, CustomerKind, DayStats, GameEvent, Held, Phase, Snapshot, StoreSave, Target,
} from './protocol.ts';

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

export interface Busy { kind: ActKind; target: Target; start: number; dur: number; rid: string }
export interface PlayerState {
  id: string; name: string; color: number; x: number; z: number; yaw: number; pitch: number;
  held: Held | null; connected: boolean; away: boolean; ready: boolean; busy: Busy | null;
  lastInputAt: number; recent: Map<string, { ok: boolean; reason?: string }>;
  stats: { served: number; karens: number; cleaned: number; restocked: number };
}

type CState =
  | 'enter' | 'toShelf' | 'browse' | 'toCoffee' | 'waitCoffee' | 'queue' | 'toRegister' | 'atRegister'
  | 'leaving' | 'toComplain' | 'complain' | 'wander' | 'flee' | 'toEat' | 'eat';

export interface Customer {
  id: number; kind: CustomerKind; x: number; z: number; yaw: number; state: CState;
  path: { x: number; z: number }[]; speed: number;
  shopping: Product[]; items: Product[]; wantsCoffee: boolean; coffeeDone: boolean; coffeeFailed: boolean;
  patience: number; patienceMax: number; mood: number; timer: number; register: number; anger: number;
  resolved: boolean; hits: number; eaten: Product[]; eatShelf: Product | null; life: number; look: number;
  angry: boolean; moving: boolean; knockTimer: number; gone: boolean;
}

export interface World {
  time: number; phase: Phase; phaseLeft: number; clock: number; day: number;
  money: number; rating: number; backstock: Record<Product, number>; shelves: Record<Product, number>;
  upgrades: Record<UpgradeId, number>; mopsOnRack: number;
  players: Map<string, PlayerState>; customers: Customer[]; queue: number[]; registers: (number | null)[];
  spills: { id: number; x: number; z: number; born: number }[];
  items: { id: number; x: number; z: number; held: Held }[];
  pings: { id: number; x: number; z: number; by: string; until: number }[];
  nextId: number; rng: () => number; spawnTimer: number; karenTimer: number; mopbotTimer: number;
  dayStats: DayStats; bonusPaidDay: number; totals: StoreSave['totals'];
  events: GameEvent[]; results: { playerId: string; rid: string; ok: boolean; reason?: string }[];
  emptyShelfToastAt: number; saveOut: StoreSave | null; difficultyPlayers: number;
}

export function defaultSave(): StoreSave {
  return {
    version: 1, day: 1, money: 200, rating: 3,
    backstock: { drinks: 24, snacks: 24, bento: 18 },
    shelves: { drinks: 8, snacks: 8, bento: 6 },
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
  for (const p of PRODUCTS) {
    out.backstock[p] = Math.round(num(o.backstock?.[p], 0, 999, d.backstock[p]));
  }
  for (const u of UPGRADE_IDS) out.upgrades[u] = Math.round(num(o.upgrades?.[u], 0, UPGRADES[u].costs.length, 0));
  for (const p of PRODUCTS) out.shelves[p] = Math.round(num(o.shelves?.[p], 0, shelfCapacity(out.upgrades.shelves), d.shelves[p]));
  out.totals.served = Math.round(num(o.totals?.served, 0, 1e9, 0));
  out.totals.karens = Math.round(num(o.totals?.karens, 0, 1e9, 0));
  out.totals.revenue = Math.round(num(o.totals?.revenue, 0, 1e12, 0));
  return out;
}

function emptyStats(rating: number): DayStats {
  return { revenue: 0, served: 0, angryLeft: 0, karensResolved: 0, karensFailed: 0, spillsCleaned: 0, tips: 0, expenses: 0, bonus: 0, ratingStart: rating };
}

export function createWorld(save: StoreSave = defaultSave(), seed = Date.now()): World {
  const s = sanitizeSave(save);
  return {
    time: 0, phase: 'prep', phaseLeft: PREP_SECONDS, clock: OPEN_MINUTE, day: s.day,
    money: s.money, rating: s.rating, backstock: { ...s.backstock }, shelves: { ...s.shelves }, upgrades: { ...s.upgrades },
    mopsOnRack: 2, players: new Map(), customers: [], queue: [], registers: [null, null], spills: [], items: [], pings: [],
    nextId: 1, rng: mulberry32(seed), spawnTimer: 3, karenTimer: 30, mopbotTimer: 20,
    dayStats: emptyStats(s.rating), bonusPaidDay: 0, totals: { ...s.totals }, events: [], results: [],
    emptyShelfToastAt: -99, saveOut: null, difficultyPlayers: 1,
  };
}

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
    id, name, color, x: spawn.x, z: spawn.z, yaw: Math.PI, pitch: 0, held: null, connected: true, away: false,
    ready: false, busy: null, lastInputAt: w.time, recent: new Map(), stats: { served: 0, karens: 0, cleaned: 0, restocked: 0 },
  };
  w.players.set(id, p);
  return p;
}

/** Remove a player permanently; anything they carried goes back into the world (never duplicated). */
export function removePlayer(w: World, id: string) {
  const p = w.players.get(id);
  if (!p) return;
  dropHeld(w, p);
  w.players.delete(id);
}

function dropHeld(w: World, p: PlayerState) {
  if (!p.held) return;
  if (p.held.kind === 'coffee') { p.held = null; return; }
  w.items.push({ id: w.nextId++, x: p.x, z: p.z, held: p.held });
  p.held = null;
}

export function applyInput(w: World, id: string, x: number, z: number, yaw: number, pitch: number) {
  const p = w.players.get(id);
  if (!p || ![x, z, yaw, pitch].every(Number.isFinite)) return;
  const dt = Math.max(0.05, Math.min(1, w.time - p.lastInputAt));
  p.lastInputAt = w.time;
  let dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  const max = RUN_SPEED * dt * 1.6 + 0.35;
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
function activePlayers(w: World) { let n = 0; for (const p of w.players.values()) if (p.connected) n++; return Math.max(1, n); }
function cap(w: World) { return shelfCapacity(w.upgrades.shelves); }
function customer(w: World, id: number) { return w.customers.find(c => c.id === id); }
function pick<T>(w: World, arr: T[]): T { return arr[Math.floor(w.rng() * arr.length)]; }

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
  const pos = resolveCollision(x + (w.rng() - 0.5) * 0.8, z + (w.rng() - 0.5) * 0.8, 0.35);
  const c = clampToStore(pos.x, pos.z, 0.4);
  w.spills.push({ id: w.nextId++, x: c.x, z: c.z, born: w.time });
  ev(w, { e: 'sfx', name: 'splat', x: c.x, z: c.z });
}

// ---------------- customers ----------------
function spawnCustomer(w: World, kind: CustomerKind) {
  const n = activePlayers(w);
  const c: Customer = {
    id: w.nextId++, kind, x: SPAWN_OUTSIDE.x + (w.rng() - 0.5), z: SPAWN_OUTSIDE.z, yaw: Math.PI, state: 'enter', path: [],
    speed: 1.5 + w.rng() * 0.5, shopping: [], items: [], wantsCoffee: false, coffeeDone: false, coffeeFailed: false,
    patience: 1, patienceMax: 1, mood: 80, timer: 0, register: -1, anger: 0, resolved: false, hits: 0, eaten: [],
    eatShelf: null, life: 0, look: Math.floor(w.rng() * 1000), angry: false, moving: true, knockTimer: 7, gone: false,
  };
  if (kind === 'normal') {
    const count = 1 + Math.floor(w.rng() * 3);
    for (let i = 0; i < count; i++) c.shopping.push(w.rng() < 0.4 ? 'drinks' : w.rng() < 0.6 ? 'snacks' : 'bento');
    c.wantsCoffee = w.rng() < 0.35;
    c.patienceMax = 55 + w.rating * 6;
  } else if (kind === 'cutter') {
    c.shopping.push(pick(w, PRODUCTS));
    c.patienceMax = 200; c.speed = 2.1;
  } else if (kind === 'rager') {
    c.anger = 35 + 4 * n; c.speed = 1.9;
  } else if (kind === 'streamer') {
    c.speed = 2.2; c.life = 85;
  } else if (kind === 'hog') {
    c.speed = 1.6; c.patienceMax = 200;
  }
  c.patience = c.patienceMax;
  w.customers.push(c);
  if (kind !== 'normal') {
    ev(w, { e: 'karen', kind, id: c.id });
    if (kind !== 'hog' || w.upgrades.camera > 0) toast(w, `⚠ ${KAREN_INFO[kind].name}：${KAREN_INFO[kind].hint}`, 'bad');
  }
  ev(w, { e: 'sfx', name: 'door', x: SPAWN_OUTSIDE.x, z: SPAWN_OUTSIDE.z });
  nextStep(w, c);
}

function nextStep(w: World, c: Customer) {
  if (c.kind === 'rager' && !c.resolved) { c.state = 'toComplain'; setGoal(c, COMPLAINT_SPOT); return; }
  if (c.kind === 'streamer' && !c.resolved) { c.state = 'wander'; setGoal(c, randomWanderSpot(w)); return; }
  if (c.kind === 'hog' && !c.resolved) { goEat(w, c); return; }
  if (c.shopping.length) {
    c.state = 'toShelf';
    setGoal(c, pick(w, shelfBrowseSpots(c.shopping[0])));
    return;
  }
  if (c.wantsCoffee && !c.coffeeDone && !c.coffeeFailed) { c.state = 'toCoffee'; setGoal(c, COFFEE_PICKUP); return; }
  if (c.items.length || c.coffeeDone) { joinQueue(w, c, c.kind === 'cutter' && !c.resolved); return; }
  leave(w, c, false);
}

function goEat(w: World, c: Customer) {
  const choices = PRODUCTS.filter(p => w.shelves[p] > 0 && p !== c.eatShelf);
  const p = choices.length ? pick(w, choices) : pick(w, PRODUCTS);
  c.eatShelf = p; c.state = 'toEat';
  setGoal(c, pick(w, shelfBrowseSpots(p)));
}

function randomWanderSpot(w: World) {
  const all = [...shelfBrowseSpots('drinks'), ...shelfBrowseSpots('snacks'), ...shelfBrowseSpots('bento'), { x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 9 }];
  return pick(w, all);
}

function joinQueue(w: World, c: Customer, front: boolean) {
  c.state = 'queue';
  if (front) w.queue.unshift(c.id); else w.queue.push(c.id);
  c.path = [];
}

function leave(w: World, c: Customer, angry: boolean) {
  w.queue = w.queue.filter(id => id !== c.id);
  w.registers = w.registers.map(r => (r === c.id ? null : r));
  c.state = 'leaving'; c.angry = angry; c.speed = angry ? 2.3 : 1.8;
  setGoal(c, SPAWN_OUTSIDE);
}

function angryLeave(w: World, c: Customer) {
  w.dayStats.angryLeft++;
  adjRating(w, -0.15);
  toast(w, '😠 一位顧客等太久生氣離開了（評價下降）', 'bad');
  ev(w, { e: 'sfx', name: 'angry', x: c.x, z: c.z });
  leave(w, c, true);
}

function cutterActive(w: World) {
  return w.customers.some(c => c.kind === 'cutter' && !c.resolved && (c.state === 'queue' || c.state === 'toRegister' || c.state === 'atRegister'));
}

function updateQueue(w: World) {
  w.queue = w.queue.filter(id => { const c = customer(w, id); return c && c.state === 'queue'; });
  const regCount = w.upgrades.register2 > 0 ? 2 : 1;
  for (let r = 0; r < regCount; r++) {
    if (w.registers[r] !== null) continue;
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

function updateCustomer(w: World, c: Customer, dt: number) {
  const n = activePlayers(w);
  const arrived = moveAlong(c, dt);
  const drain = cutterActive(w) && c.kind !== 'cutter' ? 2.2 : 1;
  switch (c.state) {
    case 'enter': if (arrived) nextStep(w, c); break;
    case 'toShelf': if (arrived) { c.state = 'browse'; c.timer = 1.4 + w.rng() * 1.2; c.yaw = faceShelf(c); } break;
    case 'browse':
      c.timer -= dt;
      if (c.timer <= 0) {
        const p = c.shopping.shift()!;
        if (w.shelves[p] > 0) { w.shelves[p]--; c.items.push(p); }
        else {
          c.mood -= 30; adjRating(w, -0.02);
          if (w.time - w.emptyShelfToastAt > 8) { toast(w, `📦 ${PRODUCT_INFO[p].name}貨架空了！快去倉庫補貨`, 'bad'); w.emptyShelfToastAt = w.time; }
        }
        if (w.rng() < 0.025 + 0.01 * activePlayers(w)) addSpill(w, c.x, c.z);
        nextStep(w, c);
      }
      break;
    case 'toCoffee': if (arrived) { c.state = 'waitCoffee'; c.timer = 50; c.yaw = Math.PI / 2; } break;
    case 'waitCoffee':
      c.timer -= dt;
      if (c.timer <= 0) { c.coffeeFailed = true; c.mood -= 35; adjRating(w, -0.06); toast(w, '☕ 咖啡等太久，顧客放棄了', 'bad'); nextStep(w, c); }
      break;
    case 'queue': case 'toRegister': case 'atRegister':
      if (c.state === 'toRegister' && arrived) { c.state = 'atRegister'; c.yaw = Math.PI; }
      if (c.state === 'atRegister') c.yaw = Math.PI;
      c.patience -= dt * drain;
      if (c.patience <= 0) angryLeave(w, c);
      break;
    case 'leaving':
      if (arrived) c.gone = true;
      break;
    case 'toComplain': if (arrived) { c.state = 'complain'; c.yaw = 0; } // fallthrough to anger
    // eslint-disable-next-line no-fallthrough
    case 'complain': {
      const rate = (1.4 + 0.45 * n) * (w.upgrades.camera > 0 ? 0.7 : 1);
      c.anger += rate * dt;
      if (c.anger >= 100) {
        c.anger = 100;
        addSpill(w, c.x, c.z); addSpill(w, c.x, c.z);
        adjRating(w, -0.4); w.money -= 25; w.dayStats.karensFailed++;
        toast(w, '💥 退貨奧客大鬧砸店！評價 -0.4、損失 $25', 'bad');
        ev(w, { e: 'sfx', name: 'crash', x: c.x, z: c.z });
        c.resolved = true; leave(w, c, true);
      }
      break;
    }
    case 'wander': case 'flee': {
      c.life -= dt; c.knockTimer -= dt;
      if (c.knockTimer <= 0) {
        c.knockTimer = 7;
        const stocked = PRODUCTS.filter(p => w.shelves[p] > 0);
        if (stocked.length) { const p = pick(w, stocked); w.shelves[p]--; }
        addSpill(w, c.x, c.z);
        ev(w, { e: 'sfx', name: 'knock', x: c.x, z: c.z });
      }
      if (c.life <= 0) {
        adjRating(w, -0.3); w.dayStats.karensFailed++;
        toast(w, '📱 直播客拍完就走，店家形象受損（評價 -0.3）', 'bad');
        c.resolved = true; leave(w, c, false); break;
      }
      const near = nearestPlayer(w, c);
      if (near && near.d < 3.2 && c.state !== 'flee') {
        c.state = 'flee'; c.speed = 3.0;
        setGoal(c, fleeSpot(w, c, near.p));
      } else if (arrived) {
        c.state = 'wander'; c.speed = 2.0;
        setGoal(c, randomWanderSpot(w));
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
          adjRating(w, -0.2); w.dayStats.karensFailed++;
          toast(w, '🍙 偷吃奧客吃飽就跑了！商品損失', 'bad');
          c.resolved = true; leave(w, c, false); break;
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
  const cands = [...shelfBrowseSpots('drinks'), ...shelfBrowseSpots('snacks'), ...shelfBrowseSpots('bento'), { x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 9 }, { x: 12, z: 12 }];
  let best = cands[0], bs = -Infinity;
  for (const s of cands) {
    const dc = Math.hypot(s.x - c.x, s.z - c.z);
    if (dc > 7) continue;
    const score = Math.hypot(s.x - p.x, s.z - p.z) - dc * 0.3 + w.rng();
    if (score > bs) { bs = score; best = s; }
  }
  return best;
}

// ---------------- actions ----------------
function targetDist(w: World, p: PlayerState, t: Target): number {
  switch (t.t) {
    case 'register': return Math.hypot(p.x - REGISTERS[t.idx]?.x, p.z - REGISTERS[t.idx]?.z);
    case 'coffee': return distToAABB(p.x, p.z, COFFEE_MACHINE);
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
function check(w: World, p: PlayerState, kind: ActKind, t: Target): Check {
  if (w.phase === 'summary') return { ok: false, reason: '日結中' };
  if (targetDist(w, p, t) > SERVER_INTERACT_RANGE) return { ok: false, reason: '距離太遠' };
  const needTarget = (tt: Target['t']) => t.t === tt;
  const c = t.t === 'customer' ? customer(w, t.id) : undefined;
  switch (kind) {
    case 'checkout': {
      if (!needTarget('register') || t.t !== 'register') return { ok: false, reason: '目標錯誤' };
      if (t.idx === 1 && w.upgrades.register2 === 0) return { ok: false, reason: '第二收銀台未開放' };
      if (p.z > COUNTER.z0 + 0.2) return { ok: false, reason: '請到櫃台內側' };
      const id = w.registers[t.idx];
      const cc = id != null ? customer(w, id) : undefined;
      if (!cc || cc.state !== 'atRegister') return { ok: false, reason: '沒有顧客等待結帳' };
      if (p.held && p.held.kind !== 'coffee') return { ok: false, reason: '手上有東西' };
      return { ok: true, dur: checkoutTime(w.upgrades.scanner) };
    }
    case 'brew':
      if (t.t !== 'coffee') return { ok: false, reason: '目標錯誤' };
      if (p.held) return { ok: false, reason: '手上有東西' };
      return { ok: true, dur: brewTime(w.upgrades.coffee) };
    case 'deliver':
      if (!c || p.held?.kind !== 'coffee') return { ok: false, reason: '需要拿著咖啡' };
      if (c.state !== 'waitCoffee') return { ok: false, reason: '這位顧客沒有在等咖啡' };
      return { ok: true, dur: 0 };
    case 'takeBox':
      if (t.t !== 'crate') return { ok: false, reason: '目標錯誤' };
      if (p.held) return { ok: false, reason: '手上有東西' };
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
      if (t.t !== 'mop' || p.held) return { ok: false, reason: '手上有東西' };
      if (w.mopsOnRack <= 0) return { ok: false, reason: '拖把都被拿走了' };
      return { ok: true, dur: 0 };
    case 'returnMop':
      if (t.t !== 'mop' || p.held?.kind !== 'mop') return { ok: false, reason: '沒有拿拖把' };
      return { ok: true, dur: 0 };
    case 'clean':
      if (t.t !== 'spill' || !w.spills.some(s => s.id === t.id)) return { ok: false, reason: '已經清乾淨了' };
      if (p.held?.kind !== 'mop') return { ok: false, reason: '需要拖把（在西側牆邊）' };
      return { ok: true, dur: 1.5 };
    case 'calm':
      if (!c || c.kind !== 'rager' || c.resolved) return { ok: false, reason: '不需要安撫' };
      return { ok: true, dur: 1.2 };
    case 'coupon':
      if (!c || c.kind !== 'rager' || c.resolved) return { ok: false, reason: '不需要' };
      if (w.money < 30) return { ok: false, reason: '錢不夠' };
      return { ok: true, dur: 0.3 };
    case 'askQueue':
      if (!c || c.kind !== 'cutter' || c.resolved) return { ok: false, reason: '不需要' };
      if (!['queue', 'toRegister', 'atRegister'].includes(c.state)) return { ok: false, reason: '還沒插隊' };
      return { ok: true, dur: 0.8 };
    case 'stopFilm':
      if (!c || c.kind !== 'streamer' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 0.6 };
    case 'checkBag':
      if (!c || c.kind !== 'hog' || c.resolved) return { ok: false, reason: '不需要' };
      return { ok: true, dur: 1.0 };
    case 'pickup': {
      if (t.t !== 'item' || p.held) return { ok: false, reason: '手上有東西' };
      if (!w.items.some(i => i.id === t.id)) return { ok: false, reason: '已被拿走' };
      return { ok: true, dur: 0 };
    }
  }
  return { ok: false, reason: '未知動作' };
}

function complete(w: World, p: PlayerState, kind: ActKind, t: Target) {
  const n = activePlayers(w);
  const c = t.t === 'customer' ? customer(w, t.id) : undefined;
  switch (kind) {
    case 'checkout': {
      if (t.t !== 'register') return;
      const cc = customer(w, w.registers[t.idx]!)!;
      let total = cc.items.reduce((s, it) => s + PRODUCT_INFO[it].price, 0) + (cc.coffeeDone ? COFFEE_PRICE : 0);
      const tip = cc.kind === 'normal' ? Math.round(total * 0.18 * Math.max(0, cc.mood) / 100 * (w.rating / 5) * (cc.patience / cc.patienceMax + 0.3)) : 0;
      total += tip;
      w.money += total; w.dayStats.revenue += total; w.dayStats.tips += tip; w.dayStats.served++; w.totals.revenue += total; w.totals.served++;
      p.stats.served++;
      if (cc.kind === 'cutter' && !cc.resolved) {
        const others = w.queue.length;
        adjRating(w, -Math.min(0.4, 0.08 * others));
        w.dayStats.karensFailed++;
        for (const id of w.queue) { const o = customer(w, id); if (o) o.mood -= 20; }
        toast(w, '😤 插隊奧客先結帳了，排隊的客人很不滿', 'bad');
        cc.resolved = true;
      } else {
        adjRating(w, 0.025 * Math.max(0.2, cc.mood / 100));
      }
      ev(w, { e: 'money', amount: total, x: cc.x, z: cc.z });
      ev(w, { e: 'sfx', name: 'cash', x: cc.x, z: cc.z });
      leave(w, cc, false);
      break;
    }
    case 'brew': p.held = { kind: 'coffee' }; ev(w, { e: 'sfx', name: 'brew', x: p.x, z: p.z }); break;
    case 'deliver':
      p.held = null; c!.coffeeDone = true; c!.mood = Math.min(100, c!.mood + 10);
      ev(w, { e: 'sfx', name: 'deliver', x: c!.x, z: c!.z });
      nextStep(w, c!);
      break;
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
      w.dayStats.spillsCleaned++; p.stats.cleaned++; adjRating(w, 0.01);
      ev(w, { e: 'sfx', name: 'clean', x: p.x, z: p.z });
      break;
    case 'calm':
      c!.anger -= 26;
      ev(w, { e: 'sfx', name: 'calm', x: c!.x, z: c!.z });
      if (c!.anger <= 0) {
        c!.anger = 0; c!.resolved = true; adjRating(w, 0.15); w.dayStats.karensResolved++; w.totals.karens++; p.stats.karens++;
        toast(w, `😌 ${p.name} 成功安撫退貨奧客（評價 +0.15）`, 'good');
        leave(w, c!, false);
      }
      break;
    case 'coupon':
      w.money -= 30; c!.resolved = true; c!.anger = 0; adjRating(w, 0.05); w.dayStats.karensResolved++; w.totals.karens++; p.stats.karens++;
      toast(w, `🎟 ${p.name} 發了折價券打發奧客（-$30）`, 'info');
      leave(w, c!, false);
      break;
    case 'askQueue': {
      c!.resolved = true; adjRating(w, 0.1); w.dayStats.karensResolved++; w.totals.karens++; p.stats.karens++;
      w.queue = w.queue.filter(id => id !== c!.id);
      w.registers = w.registers.map(r => (r === c!.id ? null : r));
      joinQueue(w, c!, false);
      toast(w, `👉 ${p.name} 請插隊奧客到隊伍最後面（評價 +0.1）`, 'good');
      break;
    }
    case 'stopFilm': {
      c!.hits++;
      const need = 1 + Math.floor((n - 1) / 2);
      if (c!.hits >= need) {
        c!.resolved = true; adjRating(w, 0.12); w.dayStats.karensResolved++; w.totals.karens++; p.stats.karens++;
        toast(w, `📵 ${p.name} 制止了直播客（評價 +0.12）`, 'good');
        leave(w, c!, false);
      } else {
        toast(w, `📵 直播客不聽勸，還要再 ${need - c!.hits} 次`, 'info');
        c!.state = 'flee'; c!.speed = 3.0; setGoal(c!, fleeSpot(w, c!, p));
      }
      break;
    }
    case 'checkBag':
      c!.resolved = true; c!.items = c!.eaten.length ? [...c!.eaten] : [pick(w, PRODUCTS)]; c!.eaten = [];
      adjRating(w, 0.1); w.dayStats.karensResolved++; w.totals.karens++; p.stats.karens++;
      toast(w, `🧾 ${p.name} 抓到偷吃奧客，他要去結帳了`, 'good');
      joinQueue(w, c!, false);
      break;
    case 'pickup': {
      if (t.t !== 'item') return;
      const it = w.items.find(i => i.id === t.id)!;
      w.items = w.items.filter(i => i.id !== t.id);
      p.held = it.held;
      ev(w, { e: 'sfx', name: 'pickup', x: p.x, z: p.z });
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
  p.busy = { kind, target, start: w.time, dur: r.dur, rid };
  remember(true);
}

export function requestDrop(w: World, playerId: string, rid: string) {
  const p = w.players.get(playerId);
  if (!p || !p.held) return;
  if (p.recent.has(rid)) return;
  p.recent.set(rid, { ok: true });
  p.busy = null;
  dropHeld(w, p);
  ev(w, { e: 'sfx', name: 'drop', x: p.x, z: p.z });
}

/** Purchases. Upgrades carry the level the buyer saw, so a resent/duplicate request can't buy twice. */
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
    return done(true);
  }
  if (item.startsWith('upg_')) {
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

function settleDay(w: World) {
  // Return carried/dropped goods to the stockroom, clear the floor.
  for (const p of w.players.values()) {
    p.busy = null;
    if (p.held?.kind === 'box') w.backstock[p.held.product] += p.held.qty;
    if (p.held?.kind === 'mop') w.mopsOnRack++;
    p.held = null;
  }
  for (const it of w.items) {
    if (it.held.kind === 'box') w.backstock[it.held.product] += it.held.qty;
    if (it.held.kind === 'mop') w.mopsOnRack++;
  }
  w.items = []; w.spills = []; w.customers = []; w.queue = []; w.registers = [null, null]; w.pings = [];
  w.mopsOnRack = 2;
  if (w.bonusPaidDay !== w.day) { // pay the daily bonus exactly once per day
    w.bonusPaidDay = w.day;
    const bonus = Math.round(w.rating * 12 + w.dayStats.karensResolved * 10);
    w.dayStats.bonus = bonus;
    w.dayStats.expenses += DAILY_RENT;
    w.money += bonus - DAILY_RENT;
  }
  w.saveOut = { ...toSave(w), day: w.day + 1 };
}

export function tick(w: World, dt: number) {
  w.time += dt;
  w.difficultyPlayers = activePlayers(w);
  const n = w.difficultyPlayers;
  // player channel actions
  for (const p of w.players.values()) {
    if (!p.busy) continue;
    const b = p.busy;
    if (w.time >= b.start + b.dur) {
      p.busy = null;
      const r = check(w, p, b.kind, b.target);
      if (r.ok) complete(w, p, b.kind, b.target);
      else toast(w, `${p.name}：動作中斷（${r.reason}）`, 'info');
    } else if (targetDist(w, p, b.target) > SERVER_INTERACT_RANGE + 0.4) {
      p.busy = null;
    }
  }
  w.pings = w.pings.filter(pg => pg.until > w.time);

  switch (w.phase) {
    case 'prep':
      w.phaseLeft -= dt;
      if (w.phaseLeft <= 0 || allReady(w)) {
        setPhase(w, 'open'); w.clock = OPEN_MINUTE; w.phaseLeft = DAY_OPEN_SECONDS;
        w.dayStats = emptyStats(w.rating); w.spawnTimer = 2; w.karenTimer = 22; w.saveOut = null;
        toast(w, `🏪 第 ${w.day} 天開始營業！`, 'good');
        ev(w, { e: 'sfx', name: 'open' });
      }
      break;
    case 'open': {
      w.phaseLeft -= dt;
      w.clock = OPEN_MINUTE + (1 - Math.max(0, w.phaseLeft) / DAY_OPEN_SECONDS) * (CLOSE_MINUTE - OPEN_MINUTE);
      const playerScale = 0.7 + 0.3 * n;
      const ratingScale = 0.6 + w.rating * 0.16;
      const adsScale = 1 + 0.2 * w.upgrades.ads;
      w.spawnTimer -= dt * playerScale * ratingScale * adsScale;
      const maxCustomers = 6 + 3 * n;
      if (w.spawnTimer <= 0) {
        w.spawnTimer = 7 + w.rng() * 4;
        if (w.customers.length < maxCustomers) spawnCustomer(w, 'normal');
      }
      w.karenTimer -= dt * (0.8 + 0.2 * n);
      if (w.karenTimer <= 0) {
        w.karenTimer = 40 + w.rng() * 25;
        const active = w.customers.filter(c => c.kind !== 'normal' && !c.resolved);
        if (active.length < 1 + Math.floor(n / 2)) {
          const kinds: KarenKind[] = ['cutter', 'rager', 'streamer', 'hog'];
          const avail = kinds.filter(k => !active.some(a => a.kind === k));
          spawnCustomer(w, pick(w, avail.length ? avail : kinds));
        }
      }
      if (w.phaseLeft <= 0) {
        setPhase(w, 'closing'); w.phaseLeft = CLOSING_MAX_SECONDS; w.clock = CLOSE_MINUTE;
        toast(w, '🌙 打烊時間到！服務完店內顧客', 'info');
      }
      break;
    }
    case 'closing':
      w.phaseLeft -= dt;
      for (const c of w.customers) {
        if (c.kind !== 'normal' && !c.resolved && c.state !== 'leaving' && c.kind !== 'cutter') { c.resolved = true; leave(w, c, false); }
      }
      if (w.customers.length === 0 || w.phaseLeft <= 0) {
        settleDay(w);
        setPhase(w, 'summary'); w.phaseLeft = 0;
      }
      break;
    case 'summary':
      if (allReady(w)) {
        w.day++; setPhase(w, 'prep'); w.phaseLeft = PREP_SECONDS; w.clock = OPEN_MINUTE;
        w.dayStats = emptyStats(w.rating);
      }
      break;
  }

  if (w.phase === 'open' || w.phase === 'closing') {
    adjRating(w, -0.0008 * Math.min(6, w.spills.length) * dt);
    if (w.upgrades.mopbot > 0 && w.spills.length) {
      w.mopbotTimer -= dt;
      if (w.mopbotTimer <= 0) { w.mopbotTimer = 20; const s = w.spills.shift()!; ev(w, { e: 'sfx', name: 'clean', x: s.x, z: s.z }); }
    }
  }

  updateQueue(w);
  for (const c of w.customers) updateCustomer(w, c, dt);
  w.customers = w.customers.filter(c => !c.gone);
}

export function snapshot(w: World, now: number): Snapshot {
  const reveal = (c: Customer) => {
    if (c.kind !== 'hog' || c.resolved) return true;
    if (w.upgrades.camera > 0) return true;
    for (const p of w.players.values()) if (Math.hypot(p.x - c.x, p.z - c.z) < 4) return true;
    return false;
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    t: now, phase: w.phase, phaseLeft: Math.max(0, w.phaseLeft), clock: w.clock, day: w.day,
    money: w.money, rating: r2(w.rating), backstock: { ...w.backstock }, shelves: { ...w.shelves }, upgrades: { ...w.upgrades },
    mopsOnRack: w.mopsOnRack, playerCount: activePlayers(w),
    players: [...w.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, x: r2(p.x), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), held: p.held,
      connected: p.connected, away: p.away, ready: p.ready,
      busy: p.busy ? { kind: p.busy.kind, p: Math.min(1, (w.time - p.busy.start) / p.busy.dur) } : null,
    })),
    customers: w.customers.map(c => ({
      id: c.id, kind: c.kind, x: r2(c.x), z: r2(c.z), yaw: r2(c.yaw), state: c.state,
      patience: Math.max(0, c.state === 'waitCoffee' ? c.timer / 50 : c.patience / c.patienceMax),
      anger: Math.round(c.anger), resolved: c.resolved, revealed: reveal(c), items: c.items.length,
      wantsCoffee: c.wantsCoffee && !c.coffeeDone && !c.coffeeFailed, look: c.look, moving: c.moving,
    })),
    spills: w.spills.map(s => ({ id: s.id, x: r2(s.x), z: r2(s.z) })),
    items: w.items.map(i => ({ id: i.id, x: r2(i.x), z: r2(i.z), held: i.held })),
    pings: w.pings.map(pg => ({ id: pg.id, x: pg.x, z: pg.z, by: pg.by, ttl: pg.until - w.time })),
    dayStats: { ...w.dayStats },
  };
}
