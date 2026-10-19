// Store layout, collision and grid pathfinding. Units are metres, x → east, z → south.
import { PLAYER_RADIUS, Product } from './constants.ts';

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

export interface Shelf { product: Product; box: AABB }
export const SHELVES: Shelf[] = [
  { product: 'drinks', box: box(9, 3.4, 15, 4.3, 1.9, 'shelf') },
  { product: 'snacks', box: box(9, 6.9, 15, 7.8, 1.6, 'shelf') },
  { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'fridge') },
];

export const COUNTER = box(15, 11, 21, 11.8, 1.05, 'counter');
export const REGISTERS = [
  { idx: 0, x: 16.5, z: 11.4, cashier: { x: 16.5, z: 10.3 }, customer: { x: 16.5, z: 12.5 } },
  { idx: 1, x: 19.2, z: 11.4, cashier: { x: 19.2, z: 10.3 }, customer: { x: 19.2, z: 12.5 } },
];
export const COFFEE_MACHINE = box(15.1, 8.6, 16.1, 9.4, 1.0, 'coffee');
export const COFFEE_PICKUP = { x: 14.2, z: 11.6 };
export const COMPLAINT_SPOT = { x: 13.2, z: 13.2 };
export const MOP_RACK = box(0, 12, 0.7, 13.4, 1.5, 'mop');
export const CRATES: { product: Product; box: AABB }[] = [
  { product: 'drinks', box: box(0.6, 0.6, 1.8, 1.6, 1.1, 'crate') },
  { product: 'snacks', box: box(2.6, 0.6, 3.8, 1.6, 1.1, 'crate') },
  { product: 'bento', box: box(4.6, 0.6, 5.8, 1.6, 1.1, 'crate') },
];
export const DECOR: AABB[] = [
  box(0, 7.5, 0.6, 10.5, 1.2, 'atm'),
  box(23.4, 13.5, 24, 15.5, 1.3, 'plant'),
  box(7.2, 13.8, 8.2, 14.8, 0.9, 'display'),
];

export const ENTRANCE = { x: 12, z: 15.4 };
export const SPAWN_OUTSIDE = { x: 12, z: 17.2 };
export const PLAYER_SPAWNS = [
  { x: 18, z: 9.5 }, { x: 12, z: 9.5 }, { x: 4, z: 7 }, { x: 18, z: 6 }, { x: 8, z: 11 },
];

export const QUEUE_SPOTS = [
  { x: 17.85, z: 13.6 }, { x: 18.9, z: 14.4 }, { x: 19.9, z: 14.4 }, { x: 20.9, z: 14.4 }, { x: 21.9, z: 14.4 },
  { x: 22.9, z: 13.8 }, { x: 22.9, z: 12.9 }, { x: 22.9, z: 12.0 }, { x: 21.9, z: 12.4 }, { x: 22.2, z: 15.3 },
  { x: 21.2, z: 15.3 }, { x: 20.2, z: 15.3 },
];

export const SOLIDS: AABB[] = [
  ...WALLS, ...SHELVES.map(s => s.box), COUNTER, COFFEE_MACHINE, MOP_RACK, ...CRATES.map(c => c.box), ...DECOR,
];

/** Points customers stand at to browse a shelf. */
export function shelfBrowseSpots(product: Product): { x: number; z: number }[] {
  const s = SHELVES.find(sh => sh.product === product)!.box;
  const spots: { x: number; z: number }[] = [];
  if (product === 'bento') {
    for (let z = s.z0 + 0.7; z < s.z1; z += 1.2) spots.push({ x: s.x0 - 0.6, z });
  } else {
    for (let x = s.x0 + 0.6; x < s.x1; x += 1.2) { spots.push({ x, z: s.z0 - 0.6 }); spots.push({ x, z: s.z1 + 0.6 }); }
  }
  return spots;
}

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

// ---------- grid pathfinding for NPCs ----------
export const CELL = 0.5;
export const GW = Math.ceil(STORE_W / CELL);
export const GD = Math.ceil((STORE_D + 2) / CELL); // include strip outside the door
const blocked = new Uint8Array(GW * GD);
(function buildGrid() {
  const npcR = 0.32;
  for (let gz = 0; gz < GD; gz++) for (let gx = 0; gx < GW; gx++) {
    const x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL;
    let b = 0;
    for (const s of SOLIDS) if (distToAABB(x, z, s) < npcR) { b = 1; break; }
    if (z > STORE_D && (x < DOOR_X0 - 1 || x > DOOR_X1 + 1)) b = 1;
    blocked[gz * GW + gx] = b;
  }
})();

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

const pathCache = new Map<string, { x: number; z: number }[]>();

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
