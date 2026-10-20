// Store-specific shelf fixtures: bookcases with book spines, a magazine rack, pet-shop kennel racks and a feed-bag
// pallet rack, bakery bread baskets and a cake showcase, pharmacy glass cabinets, drugstore beauty gondolas,
// electronics pegboards and a tablet stand, a supermarket gondola with price strips, hotel gift tables and a brochure
// rack, a post-office parcel rack and envelope rack.
//
// The fixture is static (flattened into plain meshes that StoreView.mergeStatic folds into the shared draw calls; glass
// goes into the one shared glass mesh). The products stay ONE InstancedMesh per shelf, drawn by render.ts: this module
// only says where the item slots are (and optionally gives the items a store-specific mesh, e.g. a row of books), so
// the shelf still empties and refills with the stock level. Footprints are the map's collision boxes: nothing solid
// leaves the box (signs on top may stick up).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AABB } from '../../shared/map.ts';
import type { Product } from '../../shared/constants.ts';
import type { Quality } from './storage.ts';
import type { DecorCtx } from './decor.ts';
import { UI_FONT } from './labels.ts';
import { B, CAP, CONE, CYL, RB as RB0, SPH, TOR, mat, put } from './models.ts';

export interface ShelfSlot { p: THREE.Vector3; s?: THREE.Vector3; q?: THREE.Quaternion }
export interface ShelfStyle {
  /** Item slots in world space (filled in order as stock grows: render.ts shuffles them). */
  slots: ShelfSlot[];
  /** Item mesh replacing the product-shape mesh (may carry vertex colours: they are tinted by the item colour). */
  geometry?: THREE.BufferGeometry;
  /** Height of the floating product-name sign. */
  labelY?: number;
  /** Keep the slot order (do not shuffle), e.g. books filling a row from one end. */
  ordered?: boolean;
}

const rbFor = (q: Quality) => q === 'low' ? (w: number, h: number, d: number) => B(w, h, d) : RB0;

/** Half height of the default product meshes (render.ts productGeometry), to stand items on a surface. */
const HALF: Record<string, number> = { can: 0.15, bottle: 0.18, cup: 0.15, flat: 0.06, box: 0.15, bag: 0.15, shirt: 0.3, pants: 0.375 };

/**
 * Builds the store-specific fixture for one shelf, or returns null to use the generic shelf.
 * face: -1 = wall unit on the east wall (opens west), +1 = on the west wall (opens east), 0 = free-standing.
 */
export function buildShelfStyle(ctx: DecorCtx, mapId: string, product: Product, shape: string, b: AABB, face: number): ShelfStyle | null {
  const key = `${mapId}:${product}`;
  const builder = STYLES[key];
  if (!builder) return null;
  return buildFixture(ctx, shape, b, face, builder);
}

/**
 * Store-themed dressing for the generic glass-door fridge (render.ts draws the fridge itself): a lit header in the
 * store's sign colour, door handles, a kick plate and promo decals on the doors. Purely decorative, inside the footprint.
 */
export function dressFridge(ctx: DecorCtx, map: { id: string; icon: string; sign: { bg: string } }, productName: string, b: AABB, face: number) {
  buildFixture(ctx, 'can', b, face, k => fridgeDress(k, map, productName));
}

function buildFixture(ctx: DecorCtx, shape: string, b: AABB, face: number, builder: Builder): ShelfStyle {
  const { q } = ctx;
  const G = new THREE.Group();
  G.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  // local frame: x along the unit, +z = the open side (free-standing units open to both +z and -z)
  if (face !== 0) G.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2;
  G.updateMatrixWorld(true);
  const L = face !== 0 ? b.z1 - b.z0 : b.x1 - b.x0, D = face !== 0 ? b.x1 - b.x0 : b.z1 - b.z0;
  const slots: ShelfSlot[] = [];
  const p: Put = (g, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    put(G, g, typeof c === 'number' ? mat(c, q) : c, x, y, z, rx, ry, rz, sx, sy, sz);
  const k: Kit = {
    ctx, q, L, D, H: b.h, half: HALF[shape] ?? 0.15, shape, p, RB: rbFor(q), free: face === 0,
    slot: (x, y, z, s, rx = 0, ry = 0) => {
      const e = new THREE.Euler(rx, ry, 0, 'YXZ');
      slots.push({ p: new THREE.Vector3(x, y, z), s: s ? new THREE.Vector3(...s) : undefined, q: new THREE.Quaternion().setFromEuler(e) });
    },
    glass: (g, x, y, z, rx = 0) => {
      G.updateMatrixWorld(true);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
      ctx.glass(g, new THREE.Matrix4().multiplyMatrices(G.matrixWorld, m));
    },
    glow: (g, c, x, y, z, rx = 0) => put(G, g, ctx.glow(c), x, y, z, rx),
    sign: (w, h, draw, x, y, z, ry = 0) => { const s = ctx.sign(w, h, draw); s.position.set(x, y, z); s.rotation.y = ry; G.add(s); return s; },
  };
  const out = builder(k);
  // flatten the fixture into top-level scene meshes, slots into world space
  ctx.scene.add(G);
  G.updateMatrixWorld(true);
  const list: THREE.Mesh[] = [];
  G.traverse(o => { if ((o as THREE.Mesh).isMesh) list.push(o as THREE.Mesh); });
  for (const m of list) {
    const n = new THREE.Mesh(m.geometry, m.material);
    m.matrixWorld.decompose(n.position, n.quaternion, n.scale);
    n.castShadow = n.receiveShadow = true;
    ctx.scene.add(n);
  }
  ctx.scene.remove(G);
  for (const s of slots) { s.p.applyMatrix4(G.matrixWorld); s.q = G.quaternion.clone().multiply(s.q!); }
  return { slots, ...out };
}

type Put = (g: THREE.BufferGeometry, color: number | THREE.Material, x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number, sx?: number, sy?: number, sz?: number) => THREE.Mesh;
interface Kit {
  ctx: DecorCtx; q: Quality;
  /** Length (along local x), depth (local z), height. */
  L: number; D: number; H: number;
  /** Half height of the item mesh (default product shapes). */
  half: number; shape: string;
  free: boolean;
  p: Put;
  RB: (w: number, h: number, d: number, r?: number) => THREE.BufferGeometry;
  /** Item slot at local (x, y, z) (the item's centre), optional scale and tilt (rx about local x, then ry). */
  slot: (x: number, y: number, z: number, s?: [number, number, number], rx?: number, ry?: number) => void;
  glass: (g: THREE.BufferGeometry, x: number, y: number, z: number, rx?: number) => void;
  glow: (g: THREE.BufferGeometry, c: number, x: number, y: number, z: number, rx?: number) => void;
  sign: (w: number, h: number, draw: () => HTMLCanvasElement, x: number, y: number, z: number, ry?: number) => THREE.Mesh;
}
type Builder = (k: Kit) => Omit<ShelfStyle, 'slots'>;

/** Sides a unit is browsed from: both +z and -z for free-standing units, +z for wall units. */
const sides = (k: Kit) => k.free ? [1, -1] : [1];
/** Evenly spaced positions along the unit (centres), `step` apart, keeping `margin` from the ends. */
function along(L: number, step: number, margin = 0.25) {
  const n = Math.max(1, Math.floor((L - 2 * margin) / step) + 1);
  const span = (n - 1) * step;
  return Array.from({ length: n }, (_, i) => -span / 2 + i * step);
}

// ---------- item meshes (vertex colours = shading, tinted per item by the instance colour) ----------
function shaded(parts: [THREE.BufferGeometry, number][]) {
  const list = parts.map(([g, v]) => {
    const c = (g.index ? g.toNonIndexed() : g.clone());
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal'].includes(k)) c.deleteAttribute(k);
    const n = c.attributes.position.count, arr = new Float32Array(n * 3).fill(v);
    c.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return c;
  });
  return mergeGeometries(list, false)!;
}
let booksGeo: THREE.BufferGeometry | null = null;
/** A row of four upright books (spines facing +z), bottom at y 0, about 0.24 m wide. */
function books() {
  return booksGeo ??= shaded([
    [new THREE.BoxGeometry(0.055, 0.3, 0.2).translate(-0.09, 0.15, 0), 1],
    [new THREE.BoxGeometry(0.045, 0.26, 0.19).translate(-0.035, 0.13, 0), 0.72],
    [new THREE.BoxGeometry(0.06, 0.28, 0.2).translate(0.02, 0.14, 0), 0.88],
    [new THREE.BoxGeometry(0.04, 0.24, 0.18).translate(0.075, 0.12, 0).rotateZ(-0.08), 0.6],
    // pale spine bands
    [new THREE.BoxGeometry(0.057, 0.025, 0.004).translate(-0.09, 0.24, 0.1), 1.6],
    [new THREE.BoxGeometry(0.062, 0.025, 0.004).translate(0.02, 0.22, 0.1), 1.6],
  ]);
}
let breadGeo: THREE.BufferGeometry | null = null;
/** Two plump loaves side by side, bottom at y 0. */
function bread() {
  return breadGeo ??= shaded([
    [new THREE.SphereGeometry(0.1, 7, 4).scale(1.5, 0.65, 0.85).translate(-0.06, 0.06, -0.03), 1],
    [new THREE.SphereGeometry(0.085, 7, 4).scale(1.4, 0.7, 0.85).translate(0.08, 0.055, 0.06), 0.82],
    [new THREE.BoxGeometry(0.02, 0.012, 0.1).translate(-0.06, 0.122, -0.03), 1.25],
  ]);
}
let cakeGeo: THREE.BufferGeometry | null = null;
/** Round cake: sponge, cream top and a cherry, bottom at y 0. */
function cake() {
  return cakeGeo ??= shaded([
    [new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10).translate(0, 0.05, 0), 1],
    [new THREE.CylinderGeometry(0.123, 0.123, 0.025, 10).translate(0, 0.105, 0), 1.45],
    [new THREE.SphereGeometry(0.025, 5, 3).translate(0, 0.135, 0), 0.55],
  ]);
}
let giftGeo: THREE.BufferGeometry | null = null;
/** Gift box with a pale ribbon cross and bow, bottom at y 0. */
function gift() {
  return giftGeo ??= shaded([
    [new THREE.BoxGeometry(0.26, 0.18, 0.2).translate(0, 0.09, 0), 0.85],
    [new THREE.BoxGeometry(0.27, 0.185, 0.04).translate(0, 0.0925, 0), 1.5],
    [new THREE.BoxGeometry(0.04, 0.185, 0.21).translate(0, 0.0925, 0), 1.5],
    [new THREE.TorusGeometry(0.03, 0.01, 3, 6).translate(-0.025, 0.2, 0), 1.5],
    [new THREE.TorusGeometry(0.03, 0.01, 3, 6).translate(0.025, 0.2, 0), 1.5],
  ]);
}
let parcelGeo: THREE.BufferGeometry | null = null;
/** Cardboard parcel with a tape strip and a label, bottom at y 0. */
function parcel() {
  return parcelGeo ??= shaded([
    [new THREE.BoxGeometry(0.32, 0.24, 0.26).translate(0, 0.12, 0), 1],
    [new THREE.BoxGeometry(0.33, 0.005, 0.06).translate(0, 0.242, 0), 1.35],
    [new THREE.BoxGeometry(0.1, 0.07, 0.004).translate(0.06, 0.13, 0.131), 1.7],
  ]);
}

// ---------- fixtures ----------
function signCanvas(text: string, bg: string, fg = '#fff', w = 512, h = 160) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${Math.round(h * 0.62)}px ${UI_FONT}`;
  g.fillText(text, w / 2, h / 2 + h * 0.04, w - 30);
  return c;
}

/** Wooden double-sided bookcase: plinth, crown, dividers; rows of books on three shelves, a display shelf on top. */
const bookcase: Builder = k => {
  const { L, D, H, p, RB } = k;
  const wood = k.ctx.theme.shelf, dark = 0x6d4c41;
  p(B(L, 0.1, D), dark, 0, 0.05, 0);
  p(B(L - 0.04, H - 0.1, 0.04), wood, 0, H / 2 + 0.05, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), dark, x, H / 2, 0);
  for (const x of [-L / 6, L / 6]) p(B(0.04, H - 0.1, D), wood, x, H / 2 + 0.05, 0);
  p(RB(L + 0.08, 0.07, D + 0.08, 0.02), dark, 0, H + 0.035, 0);
  const tiers = [0.1, 0.55, 1.0, 1.45];
  for (const t of tiers.slice(1)) p(B(L - 0.06, 0.03, D - 0.02), wood, 0, t, 0);
  const sectionW = (L - 0.2) / 3;
  for (const s of sides(k)) {
    for (const t of tiers.slice(0, 3)) for (let sec = 0; sec < 3; sec++) {
      const x0 = -L / 2 + 0.1 + sec * sectionW;
      for (const x of along(sectionW, 0.29, 0.17)) k.slot(x0 + sectionW / 2 + x, t + 0.015 + (t === 0.1 ? 0 : 0.015), s * (D / 2 - 0.14), undefined, 0, s > 0 ? 0 : Math.PI);
    }
    // display shelf on top: lying stacks, bookends, a "new books" card
    const top = tiers[3] + 0.03;
    for (let i = 0; i < 3; i++) {
      const x = -L / 2 + 0.45 + i * (L - 0.9) / 2;
      for (let j = 0; j < 3; j++) p(B(0.26 - j * 0.02, 0.05, 0.18), [0xc92a2a, 0x1c7ed6, 0xf59f00, 0x2f9e44][(i + j) % 4], x, top + 0.025 + j * 0.05, s * (D / 2 - 0.16), 0, j * 0.15);
      p(B(0.2, 0.28, 0.02), [0xf8f9fa, 0xffe066, 0xd0ebff][i], x + 0.45, top + 0.14, s * (D / 2 - 0.2), -0.25 * s, 0, 0);
    }
  }
  k.sign(0.9, 0.22, () => signCanvas('📚 新書', '#5c940d'), 0, H + 0.2, D / 2 + 0.05);
  return { geometry: books(), labelY: H + 0.6 };
};

/** Magazine rack: a closed back cabinet with stepped ledges, magazines leaning on it. */
const magazineRack: Builder = k => {
  const { L, D, H, p } = k;
  const wood = k.ctx.theme.shelf, back = -D / 2 + 0.3;
  p(B(L, H, 0.3), wood, 0, H / 2, -D / 2 + 0.15);
  p(B(L, 0.08, D), 0x6d4c41, 0, 0.04, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), 0x6d4c41, x, H / 2, 0);
  const rows = [0.1, 0.55, 1.0, 1.45].filter(t => t + 0.4 < H);
  rows.forEach((t, i) => {
    const front = back + 0.42 - i * 0.04;
    p(B(L - 0.06, 0.03, front - back), 0x6d4c41, 0, t, (front + back) / 2);
    k.glass(B(L - 0.08, 0.1, 0.012), 0, t + 0.06, front);
    for (const x of along(L - 0.1, 0.34, 0.2)) k.slot(x, t + 0.2, front - 0.12, [0.93, 0.25, 0.95], -Math.PI / 2 + 0.22);
  });
  return {};
};

/** Pet-shop kennel rack: white wire shelving (wire end panels, wire decks) with little cages and pets on top. */
const kennelRack: Builder = k => {
  const { L, D, H, p, RB, ctx } = k;
  const wire = mat(0xf1f3f5, k.q, { metal: 0.3, rough: 0.4 }), acc = ctx.theme.accent;
  p(RB(L, 0.12, D, 0.03), acc, 0, 0.06, 0);
  p(B(L - 0.06, H - 0.1, 0.03), 0xfff4e6, 0, H / 2 + 0.05, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) {
    for (const z of [-D / 2 + 0.03, D / 2 - 0.03]) p(B(0.04, H, 0.04), wire, x, H / 2, z);
    for (let y = 0.3; y < H; y += 0.25) p(B(0.02, 0.02, D), wire, x, y, 0);
  }
  const tiers = [0.12, 0.6, 1.08].filter(t => t < H - 0.2);
  for (const t of tiers.slice(1)) {
    p(B(L - 0.04, 0.025, D - 0.04), 0xfff4e6, 0, t, 0);
    for (const s of [1, -1]) p(B(L - 0.04, 0.04, 0.02), acc, 0, t + 0.02, s * (D / 2 - 0.01));
  }
  for (const s of [1, -1]) for (const t of tiers) for (const x of along(L, 0.75, 0.35)) k.slot(x, t + 0.03 + k.half * 0.95, s * (D / 2 - 0.2), [0.95, 0.95, 0.95], 0, (x * 7) % 0.3);
  // cages with pets on top (the top board is the cage floor)
  p(B(L, 0.03, D), 0xfff4e6, 0, H, 0);
  const pets = [[0xf4c27a, 'dog'], [0x868e96, 'cat'], [0xffffff, 'bunny'], [0xe8a24a, 'dog']] as const;
  along(L, 1.5, 0.75).forEach((x, i) => {
    const cw = 0.8, ch = 0.42, cd = D - 0.1, y0 = H + 0.015;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(B(0.025, ch, 0.025), wire, x + sx * cw / 2, y0 + ch / 2, sz * cd / 2);
    for (const sz of [-1, 1]) for (const yy of [y0 + 0.02, y0 + ch]) p(B(cw, 0.02, 0.02), wire, x, yy, sz * cd / 2);
    for (const sz of [-1, 1]) for (let j = 1; j < 6; j++) p(B(0.012, ch, 0.012), wire, x - cw / 2 + j * cw / 6, y0 + ch / 2, sz * cd / 2);
    p(B(cw, 0.02, cd), wire, x, y0 + ch, 0);
    p(B(cw - 0.04, 0.03, cd - 0.04), 0xffe8cc, x, y0 + 0.02, 0); // bedding
    const [c, kind] = pets[i % pets.length];
    const px = x + 0.08, pz = 0.05;
    p(SPH(0.11, 7, 5), c, px, y0 + 0.11, pz - 0.05, 0, 0, 0, 1.2, 0.85, 1);
    p(SPH(0.09, 7, 5), c, px, y0 + 0.22, pz + 0.08);
    for (const s of [-1, 1]) {
      if (kind === 'dog') p(SPH(0.04, 5, 3), 0x8b5a2b, px + s * 0.08, y0 + 0.22, pz + 0.08, 0, 0, 0, 0.6, 1.3, 0.8);
      else if (kind === 'cat') p(CONE(0.035, 0.07, 4), c, px + s * 0.05, y0 + 0.31, pz + 0.08);
      else p(CAP(0.022, 0.1, 4), c, px + s * 0.035, y0 + 0.35, pz + 0.07);
      p(SPH(0.014, 5, 3), 0x212529, px + s * 0.032, y0 + 0.24, pz + 0.165);
    }
    p(SPH(0.016, 5, 3), kind === 'bunny' ? 0xf783ac : 0x212529, px, y0 + 0.21, pz + 0.175);
    p(CYL(0.06, 0.05, 0.04, 8), [0x4dabf7, 0xff8787][i % 2], x - 0.25, y0 + 0.04, 0.12); // food bowl
  });
  return { labelY: H + 0.8 };
};

/** Heavy pallet rack (blue uprights, orange beams) with wooden pallets: big feed bags. */
const palletRack: Builder = k => {
  const { L, D, H, p } = k;
  const levels = [0.0, 0.75, 1.45].filter(t => t < H - 0.4);
  for (const x of along(L, (L - 0.1) / 3, 0.05)) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) p(B(0.07, H, 0.07), 0x1971c2, x, H / 2, z);
  for (const t of levels.slice(1)) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) p(B(L, 0.1, 0.06), 0xf76707, 0, t - 0.05, z);
  for (const t of levels) for (const x of along(L, 1.05, 0.6)) {
    p(B(0.95, 0.03, D - 0.15), 0xc68642, x, t + 0.03, 0);
    p(B(0.95, 0.06, 0.1), 0xa47148, x, t + 0.06 + 0.03, D / 2 - 0.2);
    p(B(0.95, 0.06, 0.1), 0xa47148, x, t + 0.06 + 0.03, -D / 2 + 0.2);
    p(B(0.95, 0.03, D - 0.15), 0xc68642, x, t + 0.135, 0);
  }
  for (const t of levels) for (const x of along(L, 0.5, 0.3)) k.slot(x, t + 0.15 + 0.15 * 1.35, D / 2 - 0.3, [1.25, 1.35, 1.5], 0, (x * 3) % 0.25 - 0.1);
  return {};
};

/** Bakery bread rack: wooden stand with two sloped tiers of wicker baskets per side. */
const breadRack: Builder = k => {
  const { L, D, H, p, RB } = k;
  const wood = k.ctx.theme.shelf, dark = k.ctx.theme.accent;
  p(B(L, 0.1, D - 0.1), dark, 0, 0.05, 0);
  p(B(L - 0.1, H - 0.1, 0.05), wood, 0, H / 2, 0);
  for (const x of [-L / 2 + 0.04, L / 2 - 0.04]) p(RB(0.08, H, D, 0.03), dark, x, H / 2, 0);
  p(RB(L, 0.05, 0.3, 0.02), dark, 0, H, 0);
  const wicker = 0xc68642, rim = 0xe0a96d;
  for (const s of [1, -1]) {
    for (const [y, z, tilt] of [[0.42, D / 2 - 0.16, 0.25], [0.82, D / 2 - 0.36, 0.25]] as const) {
      p(B(L - 0.1, 0.03, 0.34), wood, 0, y - 0.04, s * z, s * tilt);
      for (const x of along(L - 0.1, 0.62, 0.35)) {
        p(RB(0.54, 0.1, 0.3, 0.03), wicker, x, y + 0.03, s * z, s * tilt);
        p(B(0.56, 0.025, 0.32), rim, x, y + 0.08, s * z, s * tilt);
        p(B(0.5, 0.012, 0.26), 0xfff4e6, x, y + 0.06, s * z, s * tilt); // paper liner
        for (const dx of [-0.13, 0.13]) k.slot(x + dx, y + 0.05, s * z, undefined, s * tilt, (dx * 9) % 0.6);
      }
    }
  }
  k.sign(0.9, 0.22, () => signCanvas('🥐 剛出爐', '#a0522d'), 0, H + 0.2, 0);
  return { geometry: bread(), labelY: H + 0.55 };
};

/** Cake showcase: cream cabinet, glass case on top with a glass mid shelf, lit canopy. */
const cakeCase: Builder = k => {
  const { L, D, H, p, RB } = k;
  const base = 0.58, acc = k.ctx.theme.accent;
  p(RB(L, base, D, 0.04), 0xfff4e6, 0, base / 2, 0);
  for (const s of [1, -1]) p(B(L - 0.1, 0.05, 0.01), 0xf783ac, 0, base - 0.08, s * (D / 2 + 0.003));
  p(B(L - 0.04, 0.02, D - 0.04), 0xffffff, 0, base + 0.01, 0);
  k.glass(B(L - 0.06, H - base - 0.04, D - 0.06), 0, (base + H) / 2, 0);
  k.glass(B(L - 0.1, 0.012, D - 0.12), 0, base + 0.26, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.05, H - base, D), acc, x, (base + H) / 2, 0);
  p(RB(L + 0.04, 0.06, D + 0.04, 0.02), acc, 0, H + 0.01, 0);
  k.glow(B(L - 0.2, 0.012, 0.06), 0xfff3bf, 0, H - 0.03, 0);
  for (const s of [1, -1]) for (const y of [base + 0.02, base + 0.27]) for (const x of along(L - 0.2, 0.42, 0.25)) k.slot(x, y, s * (D / 2 - 0.22));
  return { geometry: cake(), labelY: H + 0.3 };
};

/** Pharmacy glass cabinet: closed cupboard below, glass-fronted shelves above, teal crown with green crosses. */
const glassCabinet: Builder = k => {
  const { L, D, H, p, RB } = k;
  const body = 0xf8f9fa, acc = k.ctx.theme.accent, cup = 0.5;
  p(RB(L, cup, D, 0.03), body, 0, cup / 2, 0);
  p(B(L - 0.04, H - cup, 0.03), 0xe3fafc, 0, (H + cup) / 2, 0);
  for (const s of sides(k)) {
    for (const x of along(L, 0.75, 0.4)) {
      p(B(0.72, 0.36, 0.01), 0xe9ecef, x, cup / 2, s * (D / 2 + 0.003));
      p(B(0.12, 0.025, 0.02), 0xadb5bd, x, cup - 0.08, s * (D / 2 + 0.01));
    }
    k.glass(B(L - 0.1, H - cup - 0.1, 0.012), 0, (H + cup) / 2 - 0.02, s * (D / 2 - 0.01));
    for (const x of along(L - 0.1, (L - 0.1) / 4, 0)) p(B(0.035, H - cup, 0.035), acc, x, (H + cup) / 2, s * (D / 2 - 0.02));
  }
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H - cup, D), acc, x, (H + cup) / 2, 0);
  const tiers = [cup, cup + 0.42, cup + 0.84].filter(t => t < H - 0.3);
  for (const t of tiers.slice(1)) p(B(L - 0.06, 0.025, D - 0.06), 0xffffff, 0, t, 0);
  p(RB(L + 0.04, 0.1, D + 0.04, 0.02), acc, 0, H + 0.03, 0);
  k.glow(B(L - 0.3, 0.02, 0.05), 0xe3fafc, 0, H - 0.04, 0);
  for (const x of [-L / 2 - 0.02, L / 2 + 0.02]) {
    k.p(B(0.02, 0.26, 0.08), 0x2f9e44, x, H - 0.2, 0);
    k.p(B(0.02, 0.08, 0.26), 0x2f9e44, x, H - 0.2, 0);
  }
  for (const s of sides(k)) for (const t of tiers) for (const x of along(L, 0.6, 0.35)) k.slot(x, t + 0.02 + k.half * 0.9, s * (D / 2 - 0.22), [0.9, 0.9, 0.9], 0, (x * 5) % 0.25);
  return {};
};

/** Drugstore beauty gondola: white glossy shelves with clear acrylic lips, pink end caps, a lit header. */
const beautyGondola: Builder = k => {
  const { L, D, H, p, RB } = k;
  const acc = k.ctx.theme.accent, pink = k.ctx.theme.shelf;
  p(RB(L, 0.12, D, 0.03), acc, 0, 0.06, 0);
  p(B(L - 0.04, H, 0.05), 0xffffff, 0, H / 2, 0);
  for (const x of [-L / 2 + 0.04, L / 2 - 0.04]) {
    p(RB(0.08, H + 0.04, D, 0.03), pink, x, (H + 0.04) / 2, 0);
    k.glass(B(0.012, H - 0.3, D - 0.15), x + Math.sign(x) * 0.05, H / 2, 0); // mirror-ish acrylic wing
  }
  const tiers = [0.12, 0.58, 1.04].filter(t => t < H - 0.3);
  for (const t of tiers.slice(1)) p(B(L - 0.08, 0.025, D - 0.04), 0xffffff, 0, t, 0);
  for (const s of [1, -1]) for (const t of tiers) k.glass(B(L - 0.1, 0.08, 0.01), 0, t + 0.05, s * (D / 2 - 0.01));
  // lit header box with a sale card on each side
  p(RB(L * 0.6, 0.28, 0.12, 0.03), acc, 0, H + 0.14, 0);
  for (const s of [1, -1]) k.sign(L * 0.55, 0.2, () => signCanvas('✨ 人氣美妝 ✨', '#fff0f6', '#d6336c', 1024, 160), 0, H + 0.14, s * 0.065, s > 0 ? 0 : Math.PI);
  // tester tray on the top tier
  for (const s of [1, -1]) {
    p(B(0.6, 0.03, 0.22), 0xffffff, -L / 2 + 0.55, tiers[tiers.length - 1] + 0.43, s * (D / 2 - 0.15));
    for (let i = 0; i < 4; i++) p(CYL(0.02, 0.02, 0.09, 6), [0xc2255c, 0xf783ac, 0xe64980, 0xfcc2d7][i], -L / 2 + 0.35 + i * 0.13, tiers[tiers.length - 1] + 0.49, s * (D / 2 - 0.15));
  }
  for (const s of [1, -1]) for (const t of tiers) for (const x of along(L, 0.5, 0.35)) k.slot(x, t + 0.02 + k.half * 0.85, s * (D / 2 - 0.2), [0.85, 0.85, 0.85], 0, (x * 5) % 0.3);
  return { labelY: H + 0.5 };
};

/** Cosmetics wall: white back with lit strips, glass shelves, makeup in small boxes. */
const cosmeticsWall: Builder = k => {
  const { L, D, H, p } = k;
  const acc = k.ctx.theme.accent;
  p(B(L, H, 0.12), 0xffffff, 0, H / 2, -D / 2 + 0.06);
  p(B(L, 0.3, D), acc, 0, 0.15, 0);
  for (const x of [-L / 2 + 0.04, L / 2 - 0.04]) p(B(0.08, H, D), 0xfcc2d7, x, H / 2, 0);
  for (const x of along(L, (L - 0.2) / 3, 0.1)) k.glow(B(0.04, H - 0.5, 0.01), 0xfff0f6, x, H / 2 + 0.15, -D / 2 + 0.125);
  p(B(L, 0.12, D), acc, 0, H - 0.06, 0);
  const tiers = [0.3, 0.72, 1.14, 1.56].filter(t => t < H - 0.3);
  for (const t of tiers.slice(1)) k.glass(B(L - 0.16, 0.02, D - 0.2), 0, t, 0.04);
  for (const t of tiers) for (const x of along(L - 0.2, 0.42, 0.2)) k.slot(x, t + 0.012 + k.half * 0.6, 0.1, [0.6, 0.6, 1.2], 0, (x * 3) % 0.4 - 0.2);
  return {};
};

/** 3C pegboard gondola: dark pegboard spine with hooks, items hanging as blister cards, a blue lit header. */
const pegboard: Builder = k => {
  const { L, D, H, p, RB } = k;
  const acc = k.ctx.theme.accent;
  p(RB(L, 0.4, D, 0.03), 0xf1f3f5, 0, 0.2, 0);
  p(B(L, 0.03, D), acc, 0, 0.41, 0);
  p(B(L - 0.06, H - 0.4, 0.06), 0x495057, 0, (H + 0.4) / 2, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), 0x343a40, x, H / 2, 0);
  // pegboard holes as faint stripes
  for (const s of [1, -1]) for (let y = 0.55; y < H - 0.1; y += 0.18) p(B(L - 0.12, 0.01, 0.005), 0x5c636a, 0, y, s * 0.032);
  const rows = [0.62, 0.98, 1.34].filter(y => y < H - 0.15);
  for (const s of [1, -1]) for (const y of rows) for (const x of along(L, 0.42, 0.3)) {
    p(CYL(0.008, 0.008, 0.16, 4), 0xced4da, x, y + 0.15, s * 0.11, Math.PI / 2);
    k.slot(x, y, s * 0.075, [0.55, 0.9, 0.3]);
  }
  // display drawers along the base: a few boxed products
  for (const s of [1, -1]) for (const x of along(L, 1.2, 0.5)) p(B(0.22, 0.12, 0.16), [0x1c7ed6, 0x212529, 0xf8f9fa][Math.abs(Math.round(x)) % 3], x, 0.48, s * (D / 2 - 0.15));
  // lit header
  p(RB(L * 0.7, 0.24, 0.1, 0.02), 0x212529, 0, H + 0.12, 0);
  for (const s of [1, -1]) k.glow(B(L * 0.66, 0.05, 0.01), 0x74c0fc, 0, H + 0.04, s * 0.055);
  return { labelY: H + 0.45 };
};

/** Laptop / tablet stand: white stepped display along the wall, tablets on easels, blue lit step edges. */
const tabletStand: Builder = k => {
  const { L, D, H, p } = k;
  p(B(L, H, 0.12), 0xf1f3f5, 0, H / 2, -D / 2 + 0.06);
  const steps = [0.7, 1.05, 1.4];
  steps.forEach((y, i) => {
    const front = D / 2 - i * 0.24;
    p(B(L - 0.04, y, front + D / 2 - 0.12), 0xffffff, 0, y / 2, (front - D / 2 + 0.12) / 2);
    k.glow(B(L - 0.1, 0.02, 0.01), 0x74c0fc, 0, y - 0.03, front + 0.003);
    for (const x of along(L, 0.5, 0.3)) {
      p(B(0.04, 0.12, 0.1), 0x868e96, x, y + 0.06, front - 0.17, -0.3);
      k.slot(x, y + 0.17, front - 0.12, [1.0, 0.22, 0.8], -Math.PI / 2 + 0.3);
    }
  });
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), 0x343a40, x, H / 2, 0);
  k.sign(1.0, 0.22, () => signCanvas('體驗區', '#1864ab'), 0, H - 0.1, -D / 2 + 0.125);
  return {};
};

/** Supermarket gondola: grey metal, red kick plate, white price channels with yellow tags, a hanging sale sign. */
const gondola: Builder = k => {
  const { L, D, H, p } = k;
  const metal = mat(0xadb5bd, k.q, { metal: 0.3, rough: 0.5 });
  p(B(L, 0.14, D), k.ctx.theme.accent, 0, 0.07, 0);
  p(B(L - 0.04, H, 0.05), metal, 0, H / 2, 0);
  for (const x of [-L / 2 + 0.025, L / 2 - 0.025]) p(B(0.05, H + 0.05, D), 0x868e96, x, (H + 0.05) / 2, 0);
  for (const x of along(L, (L - 0.1) / 4, 0.05)) for (const s of [1, -1]) p(B(0.03, H, 0.02), 0x868e96, x, H / 2, s * 0.035);
  const tiers = [0.14, 0.56, 0.98, 1.4].filter(t => t < H - 0.2);
  for (const t of tiers.slice(1)) p(B(L - 0.06, 0.025, D - 0.02), metal, 0, t, 0);
  for (const s of [1, -1]) for (const t of tiers) {
    p(B(L - 0.06, 0.06, 0.02), 0xffffff, 0, t + 0.0, s * (D / 2 - 0.0));
    for (const x of along(L, 0.5, 0.3)) p(B(0.1, 0.045, 0.006), Math.round(x * 2) % 3 === 0 ? 0xff6b6b : 0xffe066, x, t, s * (D / 2 + 0.012));
  }
  for (const s of [1, -1]) for (const t of tiers.slice(0, 3)) for (const x of along(L, 0.45, 0.3)) k.slot(x, t + 0.04 + k.half * 0.9, s * (D / 2 - 0.2), [0.9, 0.9, 0.9], 0, (x * 7) % 0.25);
  // top: overflow stock boxes and a hanging sale sign
  for (const x of along(L, 1.4, 0.6)) p(B(0.5, 0.25, 0.4), 0xc68642, x, H + 0.125, 0, 0, (x * 3) % 0.3);
  k.sign(0.8, 0.3, () => signCanvas('特價', '#e03131', '#ffe066', 512, 192), L / 4, H + 0.7, 0.01);
  k.sign(0.8, 0.3, () => signCanvas('特價', '#e03131', '#ffe066', 512, 192), L / 4, H + 0.7, -0.01, Math.PI);
  p(CYL(0.006, 0.006, 3.2 - H - 0.85, 4), 0x495057, L / 4 - 0.3, (3.2 + H + 0.85) / 2, 0);
  p(CYL(0.006, 0.006, 3.2 - H - 0.85, 4), 0x495057, L / 4 + 0.3, (3.2 + H + 0.85) / 2, 0);
  return {};
};

/** Hotel gift table: dark-wood stepped pyramid with gold trim and white runners, gift boxes on every step. */
const giftTable: Builder = k => {
  const { L, D, H, p, RB } = k;
  const wood = 0x5c3d2e, gold = mat(0xfab005, k.q, { metal: 0.4, rough: 0.35 });
  const steps = [H * 0.38, H * 0.7, H];
  steps.forEach((y, i) => {
    const d = D - i * 0.3, l = L - i * 0.5;
    p(RB(l, y, d, 0.03), wood, 0, y / 2, 0);
    for (const s of [1, -1]) p(B(l + 0.01, 0.025, 0.012), gold, 0, y - 0.03, s * d / 2);
    p(B(l - 0.2, 0.008, d + 0.02), 0xfff9f0, 0, y + 0.004, 0);
  });
  for (const s of [1, -1]) steps.forEach((y, i) => {
    if (i === 2) return;
    const z = s * (D / 2 - 0.15 - i * 0.15);
    for (const x of along(L - i * 0.5, 0.42, 0.3)) k.slot(x, y + 0.01, z, undefined, 0, (x * 5) % 0.4 - 0.2 + (s > 0 ? 0 : Math.PI));
  });
  for (const x of along(L - 1.0, 0.5, 0.3)) k.slot(x, H + 0.01, 0, [1.1, 1.1, 1.1], 0, (x * 5) % 0.4 - 0.2);
  return { geometry: gift(), labelY: H + 0.55 };
};

/** Brochure & souvenir rack: wood back cabinet, acrylic brochure pockets above, souvenir shelves below. */
const brochureRack: Builder = k => {
  const { L, D, H, p } = k;
  const wood = k.ctx.theme.shelf;
  p(B(L, H, 0.25), wood, 0, H / 2, -D / 2 + 0.125);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), 0x5c3d2e, x, H / 2, 0);
  p(B(L, 0.1, D), 0x5c3d2e, 0, 0.05, 0);
  p(B(L, 0.06, D), 0x5c3d2e, 0, H - 0.03, 0);
  const shelves = [0.1, 0.62];
  p(B(L - 0.06, 0.03, D - 0.25), 0x5c3d2e, 0, shelves[1], 0.125);
  for (const t of shelves) for (const x of along(L, 0.5, 0.3)) k.slot(x, t + 0.03 + k.half * 1.1, 0.12, [1.1, 1.1, 1.1], 0, (x * 3) % 0.3 - 0.15);
  // brochure pockets: two rows of tilted acrylic pockets with leaflets in them (static)
  const cols = [0xf03e3e, 0x1c7ed6, 0x2f9e44, 0xfab005, 0x7048e8, 0xe64980];
  [1.0, 1.3].filter(y => y < H - 0.3).forEach((y, r) => {
    let i = r * 2;
    for (const x of along(L, 0.3, 0.2)) {
      p(B(0.2, 0.28, 0.015), cols[i++ % cols.length], x, y + 0.08, -D / 2 + 0.3, -0.2);
      p(B(0.18, 0.06, 0.01), 0xffffff, x, y + 0.14, -D / 2 + 0.31, -0.2);
    }
    k.glass(B(L - 0.1, 0.16, 0.012), 0, y + 0.02, -D / 2 + 0.36, -0.2);
  });
  k.sign(0.9, 0.2, () => signCanvas('旅遊資訊', '#5f3dc4'), 0, H - 0.16, -D / 2 + 0.26);
  return {};
};

/** Post-office parcel rack: green steel uprights and beams, mesh decks, parcels, flat-pack boxes and tape at the bottom. */
const parcelRack: Builder = k => {
  const { L, D, H, p } = k;
  const steel = 0x2f9e44, deck = mat(0xdee2e6, k.q, { metal: 0.3, rough: 0.5 });
  for (const x of along(L, (L - 0.08) / 3, 0.04)) for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) p(B(0.06, H, 0.06), steel, x, H / 2, z);
  const tiers = [0.1, 0.55, 1.0].filter(t => t < H - 0.2);
  for (const t of [...tiers, H - 0.02]) {
    p(B(L - 0.02, t === 0.1 ? 0.04 : 0.025, D - 0.04), deck, 0, t, 0);
    for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) p(B(L, 0.07, 0.04), 0xffd43b, 0, t - 0.02, z);
  }
  for (const s of [1, -1]) for (const t of tiers) for (const x of along(L, 0.45, 0.3)) k.slot(x, t + 0.02, s * (D / 2 - 0.2), undefined, 0, (x * 4) % 0.3 - 0.15);
  // flat-pack boxes and tape rolls on top
  for (const x of along(L, 1.3, 0.6)) {
    for (let j = 0; j < 3; j++) p(B(0.6, 0.03, 0.45), 0xc68642, x, H + 0.02 + j * 0.032, 0, 0, j * 0.08);
    p(TOR(0.05, 0.025, 4, 8), 0xa47148, x + 0.45, H + 0.03, 0.1, Math.PI / 2);
  }
  return { geometry: parcel(), labelY: H + 0.4 };
};

/** Post-office envelope rack: green metal stepped pockets with envelopes and stamp sheets. */
const envelopeRack: Builder = k => {
  const { L, D, H, p } = k;
  const green = k.ctx.theme.accent;
  p(B(L, H, 0.25), 0xf1f3f5, 0, H / 2, -D / 2 + 0.125);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.05, H, D), green, x, H / 2, 0);
  p(B(L, 0.1, D), green, 0, 0.05, 0);
  const back = -D / 2 + 0.25;
  const rows = [0.1, 0.5, 0.9].filter(t => t + 0.35 < H);
  rows.forEach((t, i) => {
    const front = back + 0.5 - i * 0.12;
    p(B(L - 0.06, 0.03, front - back), green, 0, t, (front + back) / 2);
    p(B(L - 0.06, 0.14, 0.02), green, 0, t + 0.08, front);
    for (const x of along(L - 0.1, 0.32, 0.2)) k.slot(x, t + 0.19, front - 0.1, [0.85, 0.12, 0.62], -Math.PI / 2 + 0.25);
  });
  // stamp sheets pinned on the back board
  for (const x of along(L, 0.6, 0.4)) {
    p(B(0.36, 0.26, 0.01), 0xffffff, x, H - 0.25, back + 0.005);
    for (let i = 0; i < 4; i++) p(B(0.06, 0.07, 0.006), [0xe03131, 0x1c7ed6, 0x2f9e44, 0xfab005][i], x - 0.11 + i * 0.075, H - 0.25, back + 0.012);
  }
  return {};
};

// ---------- gas station, east-wall units, supermarket chillers, fridge dressing ----------
let oilGeo: THREE.BufferGeometry | null = null;
/** Motor-oil jug: squarish bottle with a pale label band, sloped shoulder, dark cap and a carry handle, bottom at y 0. */
function oilJug() {
  return oilGeo ??= shaded([
    [new THREE.BoxGeometry(0.15, 0.22, 0.09).translate(0, 0.11, 0), 1],
    [new THREE.BoxGeometry(0.152, 0.09, 0.092).translate(0, 0.1, 0), 1.7],
    [new THREE.BoxGeometry(0.12, 0.04, 0.08).translate(0.012, 0.24, 0), 0.9],
    [new THREE.CylinderGeometry(0.022, 0.022, 0.04, 6).translate(-0.042, 0.275, 0), 0.3],
    [new THREE.BoxGeometry(0.06, 0.018, 0.03).translate(0.035, 0.3, 0), 0.85],
    [new THREE.BoxGeometry(0.016, 0.05, 0.03).translate(0.058, 0.275, 0), 0.85],
  ]);
}
let wiperGeo: THREE.BufferGeometry | null = null;
/** Wiper blade on a hanging blister card (centred): coloured card, black blade, pale header with the hang hole. */
function wiper() {
  return wiperGeo ??= shaded([
    [new THREE.BoxGeometry(0.11, 0.48, 0.012).translate(0, -0.02, 0), 1],
    [new THREE.BoxGeometry(0.11, 0.07, 0.014).translate(0, 0.25, 0), 1.7],
    [new THREE.BoxGeometry(0.028, 0.5, 0.03).translate(0, -0.02, 0.02), 0.22],
    [new THREE.BoxGeometry(0.05, 0.05, 0.016).translate(0, -0.12, 0.014), 1.6],
  ]);
}
let produceGeo: THREE.BufferGeometry | null = null;
/** Produce tray: pale tray with three fruits / veg and a leaf, bottom at y 0. */
function produce() {
  return produceGeo ??= shaded([
    [new THREE.BoxGeometry(0.26, 0.035, 0.2).translate(0, 0.0175, 0), 1.6],
    [new THREE.SphereGeometry(0.06, 7, 5).translate(-0.07, 0.085, 0.02), 1],
    [new THREE.SphereGeometry(0.058, 7, 5).translate(0.06, 0.085, -0.03), 0.85],
    [new THREE.SphereGeometry(0.055, 7, 5).translate(0.0, 0.09, 0.06), 1.12],
    [new THREE.ConeGeometry(0.02, 0.06, 4).translate(-0.06, 0.16, 0.02), 0.45],
  ]);
}
const hex = (css: string) => parseInt(css.replace('#', ''), 16) || 0x495057;

/** Gas-station motor-oil gondola: dark steel, hazard-stripe kick plate, black drip-tray lips, a lit "機油" header. */
const oilRack: Builder = k => {
  const { L, D, H, p, RB } = k;
  const steel = mat(0x495057, k.q, { metal: 0.4, rough: 0.45 }), yellow = k.ctx.theme.accent;
  p(B(L, 0.14, D), 0x212529, 0, 0.07, 0);
  for (const s of [1, -1]) for (let x = -L / 2 + 0.15; x < L / 2 - 0.1; x += 0.28) p(B(0.06, 0.12, 0.01), yellow, x, 0.07, s * (D / 2 + 0.004), 0, 0, 0.55);
  p(B(L - 0.04, H, 0.05), steel, 0, H / 2, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H + 0.05, D), 0x343a40, x, (H + 0.05) / 2, 0);
  const tiers = [0.14, 0.62, 1.1].filter(t => t < H - 0.3);
  for (const t of tiers.slice(1)) p(B(L - 0.08, 0.03, D - 0.02), steel, 0, t, 0);
  for (const s of [1, -1]) for (const t of tiers) {
    p(B(L - 0.08, 0.05, 0.02), 0x212529, 0, t + 0.03, s * (D / 2 - 0.01));
    for (const x of along(L, 0.75, 0.4)) p(B(0.12, 0.04, 0.006), Math.round(x * 3) % 4 === 0 ? 0xe03131 : 0xffe066, x, t + 0.03, s * (D / 2 + 0.003));
    for (const x of along(L, 0.4, 0.3)) k.slot(x, t + 0.04, s * (D / 2 - 0.2), undefined, 0, (s > 0 ? 0 : Math.PI) + ((x * 7) % 0.3) - 0.15);
  }
  // lit header with the oil-drop logo, a funnel and spare oil cases on top
  p(RB(L * 0.5, 0.3, 0.12, 0.03), 0x212529, 0, H + 0.17, 0);
  for (const s of [1, -1]) k.sign(L * 0.46, 0.22, () => signCanvas('🛢 機油專區', '#fab005', '#212529', 768, 160), 0, H + 0.17, s * 0.063, s > 0 ? 0 : Math.PI);
  for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) {
    p(B(0.46, 0.22, 0.34), x < 0 ? 0xe03131 : yellow, x, H + 0.11, 0, 0, 0.15);
    p(B(0.47, 0.05, 0.345), 0x212529, x, H + 0.13, 0, 0, 0.15);
  }
  p(CONE(0.09, 0.16, 8), yellow, L / 2 - 1.1, H + 0.09, 0, Math.PI);
  p(CYL(0.014, 0.014, 0.1, 5), yellow, L / 2 - 1.1, H - 0.02 + 0.01, 0);
  return { geometry: oilJug(), labelY: H + 0.6 };
};

/** Gas-station snack gondola: green metal, yellow price channels, car air-fresheners on the end caps, a road-trip header. */
const roadGondola: Builder = k => {
  const { L, D, H, p, RB } = k;
  const green = k.ctx.theme.wainscot, yellow = k.ctx.theme.accent;
  p(B(L, 0.14, D), green, 0, 0.07, 0);
  p(B(L - 0.04, H, 0.05), 0xdee2e6, 0, H / 2, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H + 0.05, D), green, x, (H + 0.05) / 2, 0);
  const tiers = [0.14, 0.6, 1.06].filter(t => t < H - 0.3);
  for (const t of tiers.slice(1)) p(B(L - 0.08, 0.025, D - 0.02), 0xf1f3f5, 0, t, 0);
  for (const s of [1, -1]) for (const t of tiers) {
    p(B(L - 0.08, 0.06, 0.02), yellow, 0, t + 0.01, s * (D / 2 - 0.0));
    for (const x of along(L, 0.6, 0.35)) p(B(0.12, 0.045, 0.006), Math.round(x * 2) % 3 === 0 ? 0xe03131 : 0xffffff, x, t + 0.01, s * (D / 2 + 0.012));
    for (const x of along(L, 0.48, 0.3)) k.slot(x, t + 0.04 + k.half * 0.9, s * (D / 2 - 0.2), [0.9, 0.9, 0.9], 0, (x * 7) % 0.25);
  }
  // end caps: a hook strip of little tree-shaped car air fresheners
  const tree = [0x40c057, 0xfab005, 0xe64980, 0x228be6];
  for (const ex of [-L / 2 - 0.005, L / 2 + 0.005]) {
    p(B(0.012, 0.03, D - 0.2), 0xadb5bd, ex, H - 0.15, 0);
    along(D - 0.2, 0.17, 0.08).forEach((z, i) => {
      p(B(0.006, 0.12, 0.004), 0xf8f9fa, ex, H - 0.24, z);
      p(CONE(0.045, 0.14, 3), tree[i % tree.length], ex, H - 0.37, z, 0, Math.PI / 2, 0, 1, 1, 0.25);
    });
  }
  // header and a few shrink-wrapped water packs on top
  p(RB(L * 0.5, 0.28, 0.12, 0.03), green, 0, H + 0.16, 0);
  for (const s of [1, -1]) k.sign(L * 0.46, 0.2, () => signCanvas('🚗 公路補給站', '#2b8a3e', '#ffe066', 768, 160), 0, H + 0.16, s * 0.063, s > 0 ? 0 : Math.PI);
  for (const x of [-L / 2 + 0.55, L / 2 - 0.55]) {
    p(B(0.5, 0.24, 0.34), 0xa5d8ff, x, H + 0.12, 0, 0, 0.1);
    for (const dx of [-0.17, 0, 0.17]) for (const dz of [-0.09, 0.09]) p(CYL(0.035, 0.035, 0.03, 6), 0x1c7ed6, x + dx, H + 0.255, dz);
  }
  return { labelY: H + 0.6 };
};

/** Gas-station east wall: dark slatwall with wiper blades on pegs, two stacks of tyres, a car-supplies header. */
const wiperWall: Builder = k => {
  const { L, D, H, p } = k;
  const back = -D / 2;
  p(B(L, H, 0.08), 0x6c757d, 0, H / 2, back + 0.04);
  for (let y = 0.55; y < H - 0.3; y += 0.12) p(B(L - 0.1, 0.012, 0.01), 0x495057, 0, y, back + 0.085);
  p(B(L, 0.12, D), 0x212529, 0, 0.06, 0);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), 0x343a40, x, H / 2, 0);
  p(B(L, 0.06, 0.1), k.ctx.theme.accent, 0, H - 0.03, back + 0.09);
  // tyre stacks at both ends (silver hubs)
  const tyreX = [-L / 2 + 0.6, L / 2 - 0.6];
  for (const x of tyreX) for (let i = 0; i < 3; i++) {
    p(TOR(0.22, 0.1, 5, 12), 0x212529, x, 0.22 + i * 0.205, 0.04, Math.PI / 2, 0, 0);
    p(CYL(0.13, 0.13, 0.12, 10), mat(0xadb5bd, k.q, { metal: 0.6, rough: 0.3 }), x, 0.22 + i * 0.205, 0.04);
  }
  for (const x of tyreX) k.sign(0.62, 0.18, () => signCanvas('輪胎免費檢查', '#e03131', '#fff', 640, 160), x, 1.22, back + 0.09);
  // wiper blades hanging on pegs between the tyre stacks
  const span = L - 2.5;
  for (const y of [0.85, 1.38]) for (const x of along(span, 0.22, 0.1)) {
    p(CYL(0.007, 0.007, 0.16, 4), 0xced4da, x, y + 0.26, back + 0.16, Math.PI / 2);
    k.slot(x, y, back + 0.17);
  }
  k.sign(1.5, 0.22, () => signCanvas('雨刷・汽車百貨', '#2b8a3e', '#ffe066', 768, 128), 0, H - 0.19, back + 0.09);
  return { geometry: wiper() };
};

/** Bookstore east wall: wooden stationery cubbies above a drawer cabinet, pen cups, washi tape and gift-wrap rolls. */
const stationeryWall: Builder = k => {
  const { L, D, H, p, RB } = k;
  const wood = k.ctx.theme.shelf, dark = 0x6d4c41, back = -D / 2, cd = 0.48, cz = back + 0.06 + cd / 2;
  p(B(L, H, 0.06), wood, 0, H / 2, back + 0.03);
  // drawer cabinet along the bottom (its top is a display ledge)
  p(B(L, 0.5, D - 0.14), dark, 0, 0.25, -0.07);
  for (const x of along(L, 0.75, 0.38)) {
    p(B(0.66, 0.16, 0.01), 0xa1887f, x, 0.32, D / 2 - 0.135);
    p(SPH(0.02, 5, 3), 0xfab005, x, 0.32, D / 2 - 0.125);
  }
  p(B(L, 0.03, D - 0.12), 0xa1887f, 0, 0.515, -0.06);
  // cubbies
  const rows = [0.53, 0.93, 1.33, 1.73].filter(t => t < H - 0.1);
  for (const t of rows.slice(1)) p(B(L - 0.06, 0.03, cd), wood, 0, t, cz);
  const cols = along(L, 0.6, 0.3);
  const edges = [-L / 2 + 0.03, ...cols.slice(1).map((x, i) => (x + cols[i]) / 2), L / 2 - 0.03];
  for (const x of edges) p(B(0.04, rows[rows.length - 1] - rows[0], cd), dark, x, (rows[0] + rows[rows.length - 1]) / 2, cz);
  for (const t of rows.slice(0, -1)) for (const x of cols) for (const dx of [-0.14, 0.14]) k.slot(x + dx, t + 0.03 + k.half * 0.7, cz + 0.06, [0.7, 0.7, 0.7], 0, ((x + dx) * 9) % 0.3 - 0.15);
  // on top: pen cups, washi tape rolls and a sign
  const top = rows[rows.length - 1];
  along(L, 0.9, 0.5).forEach((x, i) => {
    if (Math.abs(x) < 0.8) return; // keep the sign clear
    p(CYL(0.06, 0.055, 0.14, 8), [0xffffff, 0xffe066, 0x74c0fc][i % 3], x, top + 0.085, cz + 0.08);
    for (let j = 0; j < 4; j++) p(CYL(0.008, 0.008, 0.2, 4), [0xe03131, 0x1c7ed6, 0x2f9e44, 0x212529][j], x - 0.03 + j * 0.02, top + 0.2, cz + 0.08 + (j % 2) * 0.02 - 0.01, 0.15 * (j - 1.5), 0, 0.1 * (j - 1.5));
    p(TOR(0.045, 0.02, 4, 8), [0xffa8a8, 0x8ce99a, 0xffd43b, 0xb197fc][i % 4], x + 0.3, top + 0.065, cz + 0.05, -0.1);
  });
  // gift-wrap rolls lying on the cabinet ledge
  along(L, 1.5, 0.6).forEach((x, i) => {
    for (let j = 0; j < 3; j++) p(CYL(0.04, 0.04, 0.7, 8), [0xff8787, 0x74c0fc, 0xffe066, 0x8ce99a][(i + j) % 4], x, 0.57 + (j === 2 ? 0.065 : 0), D / 2 - 0.25 + (j === 2 ? -0.04 : j * 0.085 - 0.04), 0, 0, Math.PI / 2);
  });
  k.sign(1.2, 0.24, () => signCanvas('✏️ 文具・禮品', '#5c940d'), 0, H + 0.02, back + 0.065);
  return { labelY: H + 0.25 };
};

/** Pharmacy east wall: white mask wall with wire baskets on teal-edged shelves, a lit header, sanitizer on the cabinet. */
const maskWall: Builder = k => {
  const { L, D, H, p, RB } = k;
  const teal = k.ctx.theme.accent, back = -D / 2, front = D / 2 - 0.18, sd = front - back - 0.08, sz = (front + back + 0.08) / 2;
  const wire = mat(0xced4da, k.q, { metal: 0.4, rough: 0.4 });
  p(B(L, H, 0.08), 0xffffff, 0, H / 2, back + 0.04);
  p(RB(L, 0.42, D - 0.1, 0.03), 0xf8f9fa, 0, 0.21, -0.05);
  p(B(L, 0.08, 0.02), teal, 0, 0.04, D / 2 - 0.09);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), 0xe3fafc, x, H / 2, 0);
  const tiers = [0.43, 0.83, 1.23].filter(t => t < H - 0.4);
  for (const t of tiers) {
    p(B(L - 0.06, 0.025, sd), 0xffffff, 0, t, sz);
    p(B(L - 0.06, 0.05, 0.015), teal, 0, t + 0.01, front);
    for (const x of along(L, 0.6, 0.35)) {
      p(B(0.5, 0.08, 0.012), wire, x, t + 0.055, front - 0.03);
      for (const sx of [-1, 1]) p(B(0.012, 0.08, sd - 0.1), wire, x + sx * 0.25, t + 0.055, sz);
      // mask boxes stand leaning back in the basket, face out
      for (const dx of [-0.11, 0.11]) k.slot(x + dx, t + 0.15, front - 0.16, [0.62, 0.55, 0.62], -Math.PI / 2 + 0.3, (x * 5) % 0.15);
    }
  }
  // lit header box
  p(RB(L * 0.6, 0.3, 0.12, 0.03), teal, 0, H - 0.2, back + 0.14);
  k.sign(L * 0.56, 0.22, () => signCanvas('😷 口罩・防疫專區', '#0c8599', '#fff', 1024, 160), 0, H - 0.2, back + 0.205);
  k.glow(B(L * 0.58, 0.02, 0.02), 0xe3fafc, 0, H - 0.36, back + 0.2);
  p(B(L - 0.06, 0.025, sd), 0xffffff, 0, 1.63, sz);
  // hand sanitizer pumps on the top board, either side of the header
  for (const x of [-L / 2 + 0.45, L / 2 - 0.45]) {
    p(CYL(0.05, 0.05, 0.18, 8), 0xe7f5ff, x, 1.72, back + 0.3);
    p(CYL(0.012, 0.012, 0.05, 5), 0xffffff, x, 1.835, back + 0.3);
    p(B(0.07, 0.015, 0.02), 0xffffff, x + 0.025, 1.86, back + 0.3);
    p(B(0.07, 0.07, 0.004), teal, x, 1.72, back + 0.352);
  }
  return { labelY: H + 0.25 };
};

/** Post-office east wall: a wall of postcards (white-bordered) above green-edged shelves of gift boxes. */
const postcardWall: Builder = k => {
  const { L, D, H, p } = k;
  const green = k.ctx.theme.accent, back = -D / 2;
  p(B(L, H, 0.06), 0xe8b04b, 0, H / 2, back + 0.03);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H, D), green, x, H / 2, 0);
  p(B(L, 0.1, D), green, 0, 0.05, 0);
  p(B(L, 0.06, 0.1), green, 0, H - 0.03, back + 0.08);
  // postcards
  const cardC = [0x74c0fc, 0xffa8a8, 0x8ce99a, 0xffe066, 0xffc078, 0xb197fc, 0x63e6be];
  let i = 0;
  for (const y of [1.25, 1.44, 1.63]) for (const x of along(L, 0.24, 0.2)) {
    const tilt = ((i * 37) % 7 - 3) * 0.02;
    p(B(0.18, 0.13, 0.006), 0xffffff, x, y, back + 0.065, 0, 0, tilt);
    p(B(0.15, 0.1, 0.006), cardC[i++ % cardC.length], x, y, back + 0.07, 0, 0, tilt);
  }
  p(B(L - 0.1, 0.02, 0.05), 0xa47148, 0, 1.13, back + 0.085);
  // shelves of gift boxes
  const tiers = [0.1, 0.56].filter(t => t < H - 0.8);
  p(B(L - 0.06, 0.03, D - 0.2), 0xf1f3f5, 0, tiers[1], -0.1 + 0.0);
  p(B(L - 0.06, 0.05, 0.02), green, 0, tiers[1] + 0.01, D / 2 - 0.2);
  for (const t of tiers) for (const x of along(L, 0.48, 0.3)) k.slot(x, t + 0.03 + k.half * 0.85, D / 2 - 0.4, [0.85, 0.85, 0.85], 0, (x * 3) % 0.3 - 0.15);
  k.sign(1.3, 0.24, () => signCanvas('📮 明信片・禮盒', '#2b8a3e', '#fff', 768, 144), 0, 0.98, back + 0.075);
  return { labelY: H + 0.25 };
};

/** Supermarket open multideck chiller: stepped open shelves with red price rails, a cold-lit back, air-curtain canopy. */
const multideck: Builder = k => {
  const { L, D, H, p, RB } = k;
  const blue = k.ctx.theme.wainscot, red = k.ctx.theme.accent, back = -D / 2;
  p(B(L, H, 0.12), 0xdee2e6, 0, H / 2, back + 0.06);
  for (const x of [-L / 2 + 0.04, L / 2 - 0.04]) p(RB(0.08, H, D, 0.03), blue, x, H / 2, 0);
  p(B(L, 0.3, D), 0xf1f3f5, 0, 0.15, 0);
  for (let j = 0; j < 3; j++) p(B(L - 0.2, 0.02, 0.01), 0x495057, 0, 0.08 + j * 0.06, D / 2 + 0.003);
  k.glow(B(L - 0.3, H - 0.75, 0.01), 0xe7f5ff, 0, 0.3 + (H - 0.75) / 2 + 0.05, back + 0.125);
  // canopy with the air curtain and a header
  p(B(L, 0.3, D - 0.15), 0xf8f9fa, 0, H - 0.15, -0.075);
  p(B(L, 0.3, 0.04), blue, 0, H - 0.15, D / 2 - 0.17);
  k.glow(B(L - 0.2, 0.02, 0.05), 0xd0ebff, 0, H - 0.31, D / 2 - 0.22);
  k.sign(L * 0.4, 0.22, () => signCanvas('❄ 冰涼飲料', '#1971c2', '#fff', 768, 160), 0, H - 0.15, D / 2 - 0.148);
  const tiers = [0.3, 0.68, 1.06, 1.44].filter(t => t < H - 0.45);
  tiers.forEach((t, i) => {
    const front = D / 2 - 0.08 - i * 0.07;
    if (i > 0) p(B(L - 0.16, 0.025, front - back - 0.12), 0xced4da, 0, t, (front + back + 0.12) / 2);
    p(B(L - 0.16, 0.05, 0.015), red, 0, t + 0.02, front);
    for (const x of along(L, 0.75, 0.4)) p(B(0.11, 0.04, 0.006), 0xffffff, x, t + 0.02, front + 0.009);
    for (const x of along(L, 0.3, 0.25)) k.slot(x, t + 0.02 + k.half * 0.95, front - 0.18, [0.95, 0.95, 0.95], 0, (x * 7) % 0.3);
  });
  return {};
};

/** Supermarket produce stand: three tilted tiers of wooden crates with green liners, a mist bar and a farm header. */
const produceStand: Builder = k => {
  const { L, D, H, p } = k;
  const back = -D / 2, wood = 0xc68642;
  p(B(L, H, 0.08), 0x2b8a3e, 0, H / 2, back + 0.04);
  p(B(L, 0.36, D - 0.05), 0x8d6e63, 0, 0.18, -0.025);
  for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) p(B(0.06, H - 0.3, D - 0.05), 0x8d6e63, x, (H - 0.3) / 2, -0.025);
  const tiers: [number, number][] = [[0.44, D / 2 - 0.2], [0.76, D / 2 - 0.44], [1.08, D / 2 - 0.66]];
  const tilt = 0.3;
  for (const [y, z] of tiers) {
    p(B(L - 0.1, y - 0.36, 0.2), 0x6d4c41, 0, 0.36 + (y - 0.36) / 2, z - 0.05);
    for (const x of along(L, 0.62, 0.32)) {
      p(B(0.56, 0.12, 0.3), wood, x, y + 0.03, z, tilt);
      p(B(0.5, 0.015, 0.26), 0x8ce99a, x, y + 0.075, z, tilt);
      for (const dx of [-0.13, 0.13]) k.slot(x + dx, y + 0.08, z, [0.95, 0.95, 0.95], tilt, (dx * 9) % 0.5);
    }
  }
  // mist bar + header
  p(CYL(0.015, 0.015, L - 0.2, 6), 0xced4da, 0, H - 0.4, back + 0.2, 0, 0, Math.PI / 2);
  for (const x of along(L, 0.5, 0.3)) p(CYL(0.012, 0.02, 0.03, 5), 0xadb5bd, x, H - 0.43, back + 0.2);
  k.sign(1.6, 0.3, () => signCanvas('🥬 產地直送', '#2f9e44', '#fff', 768, 144), 0, H - 0.18, back + 0.085);
  return { geometry: produce(), labelY: H + 0.3 };
};

/** Dressing for a generic glass-door fridge (local frame: x along the unit, +z = the doors). */
function fridgeDress(k: Kit, map: { icon: string; sign: { bg: string } }, name: string) {
  const { L, D, H, p, RB } = k;
  const col = hex(map.sign.bg), steel = mat(0xced4da, k.q, { metal: 0.6, rough: 0.3 });
  // lit header box on top, in the store's sign colour
  p(RB(L - 0.1, 0.3, 0.16, 0.03), col, 0, H + 0.15, D / 2 - 0.09);
  // two header panels, leaving the middle free for the floating product-name label
  const hw = Math.min(L * 0.3, 1.5);
  k.sign(hw, 0.22, () => signCanvas(`❄ 冰涼${name}`, map.sign.bg, '#fff', 640, 160), -L / 2 + 0.15 + hw / 2, H + 0.15, D / 2 - 0.008);
  k.sign(hw, 0.22, () => signCanvas(`${map.icon} 現冰現賣`, map.sign.bg, '#fff', 640, 160), L / 2 - 0.15 - hw / 2, H + 0.15, D / 2 - 0.008);
  // coloured top rail and kick plate on the door frame
  p(B(L, 0.07, 0.02), col, 0, H - 0.05, D / 2 + 0.002);
  p(B(L, 0.1, 0.02), k.ctx.theme.accent, 0, 0.05, D / 2 + 0.002);
  // four doors: a handle on each and promo decals on two of them
  for (let i = 0; i < 4; i++) {
    const cx = -L / 2 + (i + 0.5) * L / 4, hx = cx + (i % 2 ? -1 : 1) * (L / 8 - 0.12);
    p(B(0.03, 0.55, 0.025), steel, hx, 1.05, D / 2 + 0.014);
    if (i === 0 || i === 2) k.sign(0.44, 0.22, () => signCanvas(i === 0 ? `${map.icon} 冰涼` : '第二件6折', i === 0 ? '#ffffff' : '#ffe066', i === 0 ? map.sign.bg : '#e03131', 384, 192), cx, 1.38, D / 2 + 0.006);
  }
  return {};
}

const STYLES: Record<string, Builder> = {
  'gas:drinks': oilRack,
  'gas:snacks': roadGondola,
  'gas:bento': wiperWall,
  'bookstore:bento': stationeryWall,
  'pharmacy:bento': maskWall,
  'post:bento': postcardWall,
  'supermarket:drinks': multideck,
  'supermarket:bento': produceStand,
  'bookstore:snacks': bookcase,
  'bookstore:drinks': magazineRack,
  'petshop:drinks': kennelRack,
  'petshop:snacks': kennelRack,
  'petshop:bento': palletRack,
  'bakery:snacks': breadRack,
  'bakery:bento': cakeCase,
  'pharmacy:drinks': glassCabinet,
  'pharmacy:snacks': glassCabinet,
  'drugstore:drinks': beautyGondola,
  'drugstore:snacks': beautyGondola,
  'drugstore:bento': cosmeticsWall,
  'electronics:drinks': pegboard,
  'electronics:snacks': pegboard,
  'electronics:bento': tabletStand,
  'supermarket:snacks': gondola,
  'hotel:snacks': giftTable,
  'hotel:bento': brochureRack,
  'post:snacks': parcelRack,
  'post:drinks': envelopeRack,
};
