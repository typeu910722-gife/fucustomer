// Store layout, collision and grid pathfinding. Units are metres, x → east, z → south.
// The fixed shell (walls, door, stockroom, crates, mop rack) is shared; everything else comes from the active map
// (shared/maps/). Call applyMap() before creating a world or a view; the exported bindings below update in place.
import { FOOD_INFO, PLAYER_RADIUS, PRODUCT_INFO, PRODUCTS, Product } from './constants.ts';
import { DEFAULT_MAP, getMap } from './maps/index.ts';
import type { MapDef } from './maps/types.ts';

export interface AABB { x0: number; z0: number; x1: number; z1: number; h: number; kind: string }

export const STORE_W = 24;
export const STORE_D = 16;
export const DOOR_X0 = 10.5;
export const DOOR_X1 = 13.5;
const T = 0.3; // wall thickness

function box(x0: number, z0: number, x1: number, z1: number, h: number, kind: string): AABB {
  return { x0, z0, x1, z1, h, kind };
}

export const WALLS: AABB[] = [
  box(-T, -T, STORE_W + T, 0, 3.2, 'wall'), // north
  box(-T, 0, 0, STORE_D, 3.2, 'wall'), // west
  box(STORE_W, 0, STORE_W + T, STORE_D, 3.2, 'wall'), // east
  box(-T, STORE_D, DOOR_X0, STORE_D + T, 3.2, 'wall'), // south-left
  box(DOOR_X1, STORE_D, STORE_W + T, STORE_D + T, 3.2, 'wall'), // south-right
  // stockroom walls (back-left), doorway at x 2.6..4.2
  box(0, 5, 2.6, 5.25, 3.2, 'wall'),
  box(4.2, 5, 6.5, 5.25, 3.2, 'wall'),
  box(6.5, 0, 6.75, 5.25, 3.2, 'wall'),
];
export const MOP_RACK = box(0, 12, 0.7, 13.4, 1.5, 'mop');
export const CRATES: { product: Product; box: AABB }[] = [
  { product: 'drinks', box: box(0.6, 0.6, 1.8, 1.6, 1.1, 'crate') },
  { product: 'snacks', box: box(2.6, 0.6, 3.8, 1.6, 1.1, 'crate') },
  { product: 'bento', box: box(4.6, 0.6, 5.8, 1.6, 1.1, 'crate') },
];
export const ENTRANCE = { x: 12, z: 15.4 };
export const SPAWN_OUTSIDE = { x: 12, z: 17.2 };

/** A station that this map doesn't have is parked far outside so nothing can reach it. */
const NOWHERE = box(-60, -60, -59, -59, 0, 'none');

export interface Shelf { product: Product; box: AABB }
// ---- map-dependent layout (live bindings, replaced by applyMap) ----
export let CURRENT_MAP: MapDef = getMap(DEFAULT_MAP);
export let SHELVES: Shelf[] = [];
export let COUNTER: AABB = NOWHERE;
export let REGISTERS: MapDef['registers'] = CURRENT_MAP.registers;
export let COFFEE_MACHINE: AABB = NOWHERE;
export let MICROWAVE: AABB = NOWHERE;
export let COFFEE_PICKUP = { x: 0, z: 0 };
export let COMPLAINT_SPOT = { x: 0, z: 0 };
/** Wall socket by the front window that the 充電霸王 karen squats at. */
export let OUTLET = { x: 3.2, z: 16 };
export let CHARGE_SPOT = { x: 3.2, z: 15.2 };
export let DECOR: AABB[] = [];
export let PLAYER_SPAWNS: { x: number; z: number }[] = [];
export let QUEUE_SPOTS: { x: number; z: number }[] = [];
export let WANDER_SPOTS: { x: number; z: number }[] = [];
export let TRYON_SPOTS: { x: number; z: number }[] = [];
export let SOLIDS: AABB[] = [];
/** Original product names/prices of the default map, so switching back restores them. */
const BASE_PRODUCTS = JSON.parse(JSON.stringify(PRODUCT_INFO)) as typeof PRODUCT_INFO;

/** Switches the whole game (simulation, renderer, bots) to a map. Returns the map actually used. */
export function applyMap(id?: string): MapDef {
  const m = getMap(id);
  if (m === CURRENT_MAP && SOLIDS.length) return m;
  CURRENT_MAP = m;
  SHELVES = m.shelves.map(s => ({ product: s.product, box: { ...s.box } }));
  COUNTER = { ...m.counter };
  REGISTERS = m.registers;
  COFFEE_MACHINE = m.coffee ? { ...m.coffee.box } : NOWHERE;
  MICROWAVE = m.meal ? { ...m.meal.box } : NOWHERE;
  COFFEE_PICKUP = { ...m.pickup }; COMPLAINT_SPOT = { ...m.complaint };
  OUTLET = { ...m.outlet }; CHARGE_SPOT = { ...m.chargeSpot };
  DECOR = m.decor.map(d => ({ ...d }));
  PLAYER_SPAWNS = m.playerSpawns; QUEUE_SPOTS = m.queue; WANDER_SPOTS = m.wander; TRYON_SPOTS = m.tryOnSpots ?? m.wander;
  SOLIDS = [
    ...WALLS, ...SHELVES.map(s => s.box), COUNTER, ...(m.coffee ? [COFFEE_MACHINE] : []), ...(m.meal ? [MICROWAVE] : []),
    MOP_RACK, ...CRATES.map(c => c.box), ...DECOR,
  ];
  for (const p of PRODUCTS) {
    const mp = m.products[p] ?? BASE_PRODUCTS[p];
    Object.assign(PRODUCT_INFO[p], { name: mp.name, price: mp.price, boxCost: mp.boxCost, color: mp.color });
  }
  Object.assign(FOOD_INFO.coffee, m.coffee ? { name: m.coffee.food, station: m.coffee.station, verb: m.coffee.verb, icon: m.coffee.icon, price: m.coffee.price } : { name: '', station: '', verb: '', icon: '', price: 0 });
  Object.assign(FOOD_INFO.meal, m.meal ? { name: m.meal.food, station: m.meal.station, verb: m.meal.verb, icon: m.meal.icon, price: m.meal.price, uses: m.meal.uses } : { name: '', station: '', verb: '', icon: '', price: 0, uses: '' });
  rebuildGrid();
  return m;
}

/** Points customers stand at to browse a shelf. Wall units are browsed from their open side. */
export function shelfBrowseSpots(product: Product): { x: number; z: number }[] {
  const s = SHELVES.find(sh => sh.product === product)!.box;
  const spots: { x: number; z: number }[] = [];
  if (s.z1 - s.z0 > s.x1 - s.x0) {
    const x = s.x1 > STORE_W - 1 ? s.x0 - 0.6 : s.x0 < 1 ? s.x1 + 0.6 : s.x0 - 0.6;
    for (let z = s.z0 + 0.7; z < s.z1; z += 1.2) spots.push({ x, z });
  } else {
    for (let x = s.x0 + 0.6; x < s.x1; x += 1.2) { spots.push({ x, z: s.z0 - 0.6 }); spots.push({ x, z: s.z1 + 0.6 }); }
  }
  return spots;
}

/** Which way a wall unit opens: -1 = toward west (unit on the east wall), +1 = toward east. 0 for free-standing. */
export function shelfFacing(b: AABB) { return b.z1 - b.z0 > b.x1 - b.x0 ? (b.x0 < 1 ? 1 : -1) : 0; }

export function distToAABB(x: number, z: number, b: AABB) {
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dz);
}

/** Push a circle out of all solids. Returns corrected position. */
export function resolveCollision(x: number, z: number, r = PLAYER_RADIUS, solids: AABB[] = SOLIDS): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of solids) {
      const cx = Math.min(Math.max(x, b.x0), b.x1);
      const cz = Math.min(Math.max(z, b.z0), b.z1);
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else {
        // centre inside box: push out along smallest axis
        const pl = x - b.x0, pr = b.x1 - x, pt = z - b.z0, pb = b.z1 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = b.x0 - r; else if (m === pr) x = b.x1 + r; else if (m === pt) z = b.z0 - r; else z = b.z1 + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** Keeps players inside the store footprint (door is open only for NPCs). */
export function clampToStore(x: number, z: number, r = PLAYER_RADIUS) {
  return { x: Math.min(Math.max(x, r), STORE_W - r), z: Math.min(Math.max(z, r), STORE_D - r) };
}

let pathCache = new Map<string, { x: number; z: number }[]>();

// ---------- grid pathfinding for NPCs ----------
export const CELL = 0.5;
export const GW = Math.ceil(STORE_W / CELL);
export const GD = Math.ceil((STORE_D + 2) / CELL); // include strip outside the door
let blocked: Uint8Array = new Uint8Array(GW * GD);
/** Each map's walkability grid and path cache, built once, so switching maps (e.g. between server rooms) is cheap. */
const gridCache = new Map<string, { blocked: Uint8Array; paths: Map<string, { x: number; z: number }[]> }>();
function rebuildGrid() {
  const hit = gridCache.get(CURRENT_MAP.id);
  if (hit) { blocked = hit.blocked; pathCache = hit.paths; return; }
  blocked = new Uint8Array(GW * GD);
  const npcR = 0.32;
  for (let gz = 0; gz < GD; gz++) for (let gx = 0; gx < GW; gx++) {
    const x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL;
    let b = 0;
    for (const s of SOLIDS) if (distToAABB(x, z, s) < npcR) { b = 1; break; }
    if (z > STORE_D && (x < DOOR_X0 - 1 || x > DOOR_X1 + 1)) b = 1;
    blocked[gz * GW + gx] = b;
  }
  pathCache = new Map();
  gridCache.set(CURRENT_MAP.id, { blocked, paths: pathCache });
}

export function isBlockedCell(gx: number, gz: number) {
  if (gx < 0 || gz < 0 || gx >= GW || gz >= GD) return true;
  return blocked[gz * GW + gx] === 1;
}

function toCell(p: { x: number; z: number }) {
  return { gx: Math.min(GW - 1, Math.max(0, Math.floor(p.x / CELL))), gz: Math.min(GD - 1, Math.max(0, Math.floor(p.z / CELL))) };
}

function nearestFree(gx: number, gz: number) {
  if (!isBlockedCell(gx, gz)) return { gx, gz };
  for (let r = 1; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (!isBlockedCell(gx + dx, gz + dz)) return { gx: gx + dx, gz: gz + dz };
  }
  return { gx, gz };
}


/** A* on the grid with 8-way movement, followed by line-of-sight smoothing. */
export function findPath(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const a = nearestFree(toCell(from).gx, toCell(from).gz);
  const b = nearestFree(toCell(to).gx, toCell(to).gz);
  const key = `${a.gx},${a.gz}>${b.gx},${b.gz}`;
  const cached = pathCache.get(key);
  if (cached) return [...cached.slice(0, -1), { x: to.x, z: to.z }];
  const N = GW * GD;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = a.gz * GW + a.gx, goal = b.gz * GW + b.gx;
  const open: number[] = [start];
  const f = new Float32Array(N).fill(Infinity);
  g[start] = 0; f[start] = 0;
  const h = (i: number) => { const x = i % GW, z = (i / GW) | 0; const dx = Math.abs(x - b.gx), dz = Math.abs(z - b.gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % GW, cz = (cur / GW) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (isBlockedCell(nx, nz)) continue;
      if (dx && dz && (isBlockedCell(cx + dx, cz) || isBlockedCell(cx, cz + dz))) continue;
      const ni = nz * GW + nx;
      const ng = g[cur] + (dx && dz ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; f[ni] = ng + h(ni); open.push(ni); }
    }
  }
  const cells: number[] = [];
  let c = goal;
  if (came[c] === -1 && c !== start) return [{ x: to.x, z: to.z }];
  while (c !== -1 && c !== start) { cells.push(c); c = came[c]; }
  cells.reverse();
  const pts = cells.map(i => ({ x: ((i % GW) + 0.5) * CELL, z: (((i / GW) | 0) + 0.5) * CELL }));
  // smoothing
  const out: { x: number; z: number }[] = [];
  let anchor = { x: ((start % GW) + 0.5) * CELL, z: (((start / GW) | 0) + 0.5) * CELL };
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1];
    if (next && lineClear(anchor, next)) continue;
    out.push(pts[i]); anchor = pts[i];
  }
  if (out.length) out[out.length - 1] = { x: to.x, z: to.z }; else out.push({ x: to.x, z: to.z });
  if (pathCache.size > 4000) pathCache.clear();
  pathCache.set(key, out);
  return [...out];
}

function lineClear(p: { x: number; z: number }, q: { x: number; z: number }) {
  const d = Math.hypot(q.x - p.x, q.z - p.z);
  const steps = Math.ceil(d / (CELL * 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const c = toCell({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    if (isBlockedCell(c.gx, c.gz)) return false;
  }
  return true;
}

applyMap(DEFAULT_MAP);
