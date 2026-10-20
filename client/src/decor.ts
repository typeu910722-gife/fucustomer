// Store-specific furniture for the map decor kinds added for the newer shops (gym gear, cinema seats, hot-pot tables…).
// Every prop is built in a local frame centred on its footprint (floor at y = 0, +z = the side it faces) and then
// flattened into plain scene meshes, so StoreView.mergeStatic folds all of it into the shared static draw calls.
// Footprints come from the map data (shared/maps/*.ts) and are also the collision boxes: props may overhang a little
// (chairs, barbell ends) but the solid part stays inside. Keep parts low-poly: this runs on phones.
import * as THREE from 'three';
import type { AABB } from '../../shared/map.ts';
import type { MapDef } from '../../shared/maps/types.ts';
import type { Quality } from './storage.ts';
import { B, CAP, CONE, CYL, DOME, RB, SPH, TOR, basic, geo, mat, put } from './models.ts';

export interface DecorCtx {
  scene: THREE.Scene;
  q: Quality;
  theme: MapDef['theme'];
  /** Unlit material that dims with a power outage (screens, lit panels). */
  glow: (color: number) => THREE.Material;
  /** Adds a piece of glass (merged into one shared transparent mesh at the end). */
  glass: (g: THREE.BufferGeometry, m: THREE.Matrix4) => void;
  /** Canvas-text plane from the shared sign atlas. */
  sign: (w: number, h: number, draw: () => HTMLCanvasElement) => THREE.Mesh;
  /** Nearest camp spot (where squatting karens settle), used to turn seats toward it. */
  campSpots: { x: number; z: number }[];
}

/** Decor kinds handled here. */
export const STORE_DECOR = new Set([
  'beauty', 'readtable', 'bakecase', 'sample', 'petpen', 'cages', 'cafetable', 'seats', 'hotpot', 'pump',
  'treadmill', 'bench', 'bike', 'dumbbells', 'dining', 'demo', 'tvwall', 'mirrors', 'dryer', 'writedesk',
  'parcel', 'bpmeter', 'medcase', 'lobby', 'luggage',
]);

type P = (g: THREE.BufferGeometry, color: number | THREE.Material, x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number, sx?: number, sy?: number, sz?: number) => THREE.Mesh;

/** Moves every mesh below `g` into the scene as a top-level mesh with its world transform (so it can be merged). */
function flatten(S: THREE.Scene, g: THREE.Object3D) {
  g.updateMatrixWorld(true);
  const list: THREE.Mesh[] = [];
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) list.push(o as THREE.Mesh); });
  for (const m of list) {
    const n = new THREE.Mesh(m.geometry, m.material);
    m.matrixWorld.decompose(n.position, n.quaternion, n.scale);
    n.castShadow = n.receiveShadow = true;
    S.add(n);
  }
}

export function buildStoreDecor(ctx: DecorCtx, d: AABB) {
  const { q, theme: TH } = ctx;
  const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
  let w = d.x1 - d.x0, dp = d.z1 - d.z0;
  const G = new THREE.Group();
  G.position.set(cx, 0, cz);
  // turn the prop so its "front" (+z local) faces the nearest camp spot / open side
  const yawTo = (tx: number, tz: number) => Math.atan2(tx - cx, tz - cz);
  const turn = (yaw: number) => {
    const r = Math.round(yaw / (Math.PI / 2)) & 3;
    G.rotation.y = r * Math.PI / 2;
    if (r % 2) [w, dp] = [dp, w];
  };
  const p: P = (g, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    put(G, g, typeof c === 'number' ? mat(c, q) : c, x, y, z, rx, ry, rz, sx, sy, sz);
  const glass = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    G.updateMatrixWorld(true);
    ctx.glass(g, new THREE.Matrix4().multiplyMatrices(G.matrixWorld, new THREE.Matrix4().makeTranslation(x, y, z)));
  };
  const nearestCamp = () => {
    let best: { x: number; z: number } | null = null, bd = 1e9;
    for (const s of ctx.campSpots) { const dd = Math.hypot(s.x - cx, s.z - cz); if (dd < bd) { bd = dd; best = s; } }
    return bd < 3 ? best : null;
  };
  /** Simple chair with a back, at local (x, z), facing yaw (0 = +z). */
  const chair = (x: number, z: number, yaw: number, seat: number, frame = 0x495057, back = true) => {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = yaw; G.add(c);
    put(c, RB(0.42, 0.08, 0.42, 0.03), mat(seat, q), 0, 0.46, 0);
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) put(c, CYL(0.022, 0.022, 0.44, 5), mat(frame, q), lx, 0.22, lz);
    if (back) put(c, RB(0.42, 0.42, 0.07, 0.03), mat(seat, q), 0, 0.75, -0.2, -0.08);
  };
  /** Plush armchair / sofa (width along local x), facing +z. */
  const sofa = (x: number, z: number, yaw: number, width: number, col: number) => {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = yaw; G.add(c);
    const m = mat(col, q);
    put(c, RB(width, 0.3, 0.6, 0.08), m, 0, 0.22, 0);
    put(c, RB(width - 0.16, 0.12, 0.48, 0.06), mat(0xfff8eb, q), 0, 0.42, 0.04); // cushion
    put(c, RB(width, 0.5, 0.16, 0.08), m, 0, 0.55, -0.24);
    for (const s of [-1, 1]) put(c, RB(0.14, 0.4, 0.6, 0.06), m, s * (width / 2 - 0.05), 0.42, 0);
    for (const s of [-1, 1]) put(c, CYL(0.025, 0.02, 0.08, 5), mat(0x5c3d2e, q), s * (width / 2 - 0.08), 0.04, 0.22);
  };
  const tableTop = (r: number, h: number, top: number, leg = 0x495057) => {
    p(CYL(0.05, 0.05, h - 0.04, 6), leg, 0, (h - 0.04) / 2, 0);
    p(CYL(0.26, 0.3, 0.04, 10), leg, 0, 0.02, 0);
    p(CYL(r, r, 0.05, 14), top, 0, h - 0.025, 0);
  };
  const S = Math.min(w, dp);

  switch (d.kind) {
    case 'beauty': { // cosmetics tester island: white pedestal, mirror, rows of lipsticks and bottles
      p(RB(w, 0.8, dp, 0.08, 2), 0xf8f9fa, 0, 0.4, 0);
      p(B(w + 0.01, 0.08, dp + 0.01), TH.accent, 0, 0.62, 0);
      p(RB(w + 0.04, 0.05, dp + 0.04, 0.02), 0xfff0f6, 0, 0.82, 0);
      const pal = [0xe03131, 0xf783ac, 0xc2255c, 0xff8787, 0xa61e4d, 0xfcc2d7];
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
        p(CYL(0.025, 0.025, 0.07, 6), 0x212529, -w / 2 + 0.15 + i * (w - 0.3) / 5, 0.88, s * (dp / 2 - 0.12));
        p(CYL(0.018, 0.022, 0.05, 6), pal[(i + (s > 0 ? 2 : 0)) % 6], -w / 2 + 0.15 + i * (w - 0.3) / 5, 0.94, s * (dp / 2 - 0.12));
      }
      for (let i = 0; i < 3; i++) p(CYL(0.04, 0.045, 0.14, 8), [0xffdeeb, 0xe599f7, 0xffffff][i], -0.2 + i * 0.2, 0.92, 0);
      p(CYL(0.012, 0.012, 0.35, 5), 0xced4da, 0, 1.0, -0.05);
      p(CYL(0.16, 0.16, 0.025, 14), TH.accent, 0, 1.28, -0.05, Math.PI / 2);
      p(CYL(0.135, 0.135, 0.01, 14), 0xdbe4ff, 0, 1.28, -0.035, Math.PI / 2);
      break;
    }
    case 'readtable': { // reading table with stacks of books, a green banker's lamp and two chairs
      p(RB(w, 0.06, dp, 0.02), 0x8d6e63, 0, d.h - 0.03, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(B(0.06, d.h - 0.06, 0.06), 0x5c3d2e, sx * (w / 2 - 0.08), (d.h - 0.06) / 2, sz * (dp / 2 - 0.08));
      const books = [0x2b8a3e, 0xe8590c, 0x1971c2, 0xfab005, 0x862e9c, 0xc92a2a];
      for (let i = 0; i < 4; i++) p(B(0.26 - i * 0.02, 0.05, 0.19), books[i], -0.25, d.h + 0.025 + i * 0.05, 0.2, 0, i * 0.2);
      p(B(0.3, 0.012, 0.22), 0xfff9db, 0.12, d.h + 0.01, -0.1, 0, -0.3); // open book
      p(B(0.012, 0.03, 0.22), books[4], 0.12, d.h + 0.015, -0.1, 0, -0.3);
      p(CYL(0.06, 0.07, 0.03, 8), 0xb08968, 0.32, d.h + 0.015, 0.25);
      p(CYL(0.012, 0.012, 0.3, 5), 0xb08968, 0.32, d.h + 0.17, 0.25);
      p(CYL(0.05, 0.13, 0.08, 8, true), 0x2b8a3e, 0.32, d.h + 0.33, 0.2, 0.3);
      p(SPH(0.035, 6, 4), basic(0xfff3bf), 0.32, d.h + 0.3, 0.2);
      chair(-w / 2 - 0.35, 0, Math.PI / 2, TH.accent, 0x5c3d2e); chair(w / 2 + 0.35, 0, -Math.PI / 2, TH.accent, 0x5c3d2e);
      break;
    }
    case 'bakecase': { // glass display case: cakes on the top shelf, bread on the bottom
      p(RB(w, 0.5, dp, 0.04), 0xa0522d, 0, 0.25, 0);
      p(B(w + 0.02, 0.06, dp + 0.02), 0xfff3bf, 0, 0.53, 0);
      p(B(w - 0.08, 0.02, dp - 0.08), 0xf8f9fa, 0, 0.88, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(B(0.035, 0.66, 0.035), 0xd9a066, sx * (w / 2 - 0.02), 0.89, sz * (dp / 2 - 0.02));
      p(RB(w, 0.05, dp, 0.02), 0xa0522d, 0, 1.24, 0);
      glass(B(w - 0.03, 0.64, dp - 0.03), 0, 0.88, 0);
      const cake = (x: number, z: number, c: number) => {
        p(CYL(0.13, 0.13, 0.12, 10), c, x, 0.97, z);
        p(CYL(0.135, 0.135, 0.025, 10), 0xffffff, x, 1.04, z);
        p(SPH(0.025, 6, 4), basic(0xe03131), x, 1.07, z);
      };
      cake(-0.28 * w, -0.2 * dp, 0xf783ac); cake(0.05, 0.18 * dp, 0x8b5a2b); cake(0.3 * w, -0.15 * dp, 0xfff3bf);
      for (let i = 0; i < 5; i++) {
        const x = -w / 2 + 0.22 + i * (w - 0.44) / 4;
        p(TOR(0.07, 0.035, 5, 8, Math.PI * 1.2), 0xd9822b, x, 0.6, -0.15, Math.PI / 2, 0, 0.3);
        p(CAP(0.05, 0.14, 6), 0xc8823c, x, 0.61, 0.2, 0, 0, Math.PI / 2);
      }
      break;
    }
    case 'sample': { // supermarket tasting stand: skirted table, hot plate with sausages, toothpick tray, little sign
      p(RB(w, d.h - 0.05, dp, 0.03), 0xf8f9fa, 0, (d.h - 0.05) / 2, 0);
      p(B(w + 0.02, 0.18, dp + 0.02), TH.accent, 0, d.h - 0.15, 0);
      for (let i = 0; i < 5; i++) p(B(0.03, d.h - 0.3, 0.012), 0xffc9c9, -w / 2 + 0.15 + i * (w - 0.3) / 4, (d.h - 0.3) / 2, dp / 2 + 0.006);
      p(RB(w + 0.04, 0.04, dp + 0.04, 0.015), 0xe9ecef, 0, d.h, 0);
      p(RB(0.42, 0.05, 0.3, 0.02), 0x343a40, -0.18, d.h + 0.045, -0.08);
      p(B(0.36, 0.01, 0.24), 0x868e96, -0.18, d.h + 0.075, -0.08);
      for (let i = 0; i < 4; i++) p(CAP(0.022, 0.12, 5), 0xc0582f, -0.3 + i * 0.08, d.h + 0.1, -0.08, 0, 0, Math.PI / 2);
      p(CYL(0.15, 0.13, 0.025, 10), 0xffffff, 0.25, d.h + 0.035, 0.12);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05, x = 0.25 + Math.cos(a) * 0.08, z = 0.12 + Math.sin(a) * 0.08;
        p(B(0.04, 0.04, 0.04), [0xffd43b, 0xff8787, 0xc0582f][i % 3], x, d.h + 0.07, z);
        p(CYL(0.004, 0.004, 0.08, 3), 0xe9d8a6, x, d.h + 0.11, z);
      }
      p(CYL(0.012, 0.012, 0.6, 5), 0x495057, w / 2 - 0.12, d.h + 0.3, -dp / 2 + 0.12);
      const sg = ctx.sign(0.42, 0.26, () => signCanvas('試吃', '#ff6b6b'));
      sg.position.set(w / 2 - 0.12, d.h + 0.7, -dp / 2 + 0.12 + 0.01); G.add(sg);
      const sb = sg.clone(); sb.rotation.y = Math.PI; sb.position.z -= 0.02; G.add(sb);
      break;
    }
    case 'petpen': { // low puppy play pen with two puppies, a ball and a bone
      p(B(w - 0.04, 0.02, dp - 0.04), 0x8ce99a, 0, 0.01, 0);
      const n = 4;
      for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
        const t = -w / 2 + 0.03 + i * (w - 0.06) / n;
        p(CYL(0.025, 0.025, d.h, 5), 0xf8f9fa, t, d.h / 2, s * (dp / 2 - 0.03));
        p(CYL(0.025, 0.025, d.h, 5), 0xf8f9fa, s * (w / 2 - 0.03), d.h / 2, t * dp / w);
      }
      for (const y of [0.12, d.h - 0.04]) for (const s of [-1, 1]) {
        p(B(w - 0.04, 0.035, 0.035), TH.accent, 0, y, s * (dp / 2 - 0.03));
        p(B(0.035, 0.035, dp - 0.04), TH.accent, s * (w / 2 - 0.03), y, 0);
      }
      const pup = (x: number, z: number, yaw: number, c: number) => {
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; G.add(g);
        put(g, CAP(0.08, 0.14, 6), mat(c, q), 0, 0.13, 0, Math.PI / 2);
        put(g, SPH(0.09, 8, 6), mat(c, q), 0, 0.25, 0.13);
        put(g, SPH(0.035, 6, 4), mat(0xfff4e6, q), 0, 0.23, 0.21);
        put(g, SPH(0.016, 5, 3), basic(0x212529), 0, 0.245, 0.245);
        for (const s of [-1, 1]) {
          put(g, CAP(0.03, 0.06, 5), mat(0x5c3d2e, q), s * 0.08, 0.26, 0.12, 0, 0, s * 0.4);
          put(g, SPH(0.012, 5, 3), basic(0x212529), s * 0.035, 0.28, 0.21);
          for (const fz of [-0.08, 0.08]) put(g, CYL(0.025, 0.025, 0.08, 5), mat(c, q), s * 0.05, 0.04, fz);
        }
        put(g, CAP(0.015, 0.06, 4), mat(c, q), 0, 0.2, -0.13, -0.6);
      };
      pup(-0.2, -0.1, 0.6, 0xf4d58d); pup(0.22, 0.15, -2.2, 0xffffff);
      p(SPH(0.06, 8, 6), 0xe03131, 0.1, 0.07, -0.25);
      p(CAP(0.02, 0.12, 5), 0xfff4e6, -0.25, 0.04, 0.3, 0, 0.7, Math.PI / 2);
      break;
    }
    case 'cages': { // stacked pet cages (2 × 2): wire fronts, a cat, a bunny, a hamster with its wheel
      p(RB(w, 0.1, dp, 0.02), 0x495057, 0, 0.05, 0);
      const cw = w / 2 - 0.02, ch = (d.h + 0.6 - 0.12) / 2;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const x = (c - 0.5) * (cw + 0.02), y = 0.12 + r * ch;
        p(B(cw, 0.03, dp - 0.04), 0xf1f3f5, x, y + 0.015, 0);
        p(B(cw, ch - 0.02, 0.03), TH.wainscot, x, y + ch / 2, -dp / 2 + 0.04);
        for (let i = 0; i <= 5; i++) p(B(0.012, ch - 0.03, 0.012), 0xadb5bd, x - cw / 2 + i * cw / 5, y + ch / 2, dp / 2 - 0.03);
        p(B(cw, 0.025, 0.025), TH.accent, x, y + ch - 0.01, dp / 2 - 0.03);
        p(B(0.025, ch - 0.02, dp - 0.04), 0xadb5bd, x - cw / 2, y + ch / 2, 0);
      }
      const y0 = 0.15, y1 = 0.15 + ch, xl = -(cw + 0.02) / 2, xr = (cw + 0.02) / 2;
      // cat
      p(SPH(0.1, 8, 6), 0xffa94d, xl, y0 + 0.08, 0, 0, 0, 0, 1.2, 0.8, 1);
      p(SPH(0.075, 8, 6), 0xffa94d, xl + 0.02, y0 + 0.18, 0.08);
      for (const s of [-1, 1]) p(CONE(0.03, 0.06, 4), 0xffa94d, xl + 0.02 + s * 0.045, y0 + 0.26, 0.08);
      // bunny
      p(SPH(0.09, 8, 6), 0xf8f9fa, xr, y0 + 0.07, -0.02);
      p(SPH(0.06, 8, 6), 0xf8f9fa, xr, y0 + 0.15, 0.06);
      for (const s of [-1, 1]) p(CAP(0.02, 0.1, 4), 0xffdeeb, xr + s * 0.025, y0 + 0.25, 0.05, 0, 0, s * 0.2);
      // hamster + wheel
      p(TOR(0.12, 0.012, 3, 12), 0x74c0fc, xl + 0.05, y1 + 0.14, -0.05);
      p(SPH(0.05, 6, 5), 0xe9b872, xl - 0.12, y1 + 0.05, 0.1);
      // water bottle + food bowl
      p(CYL(0.03, 0.03, 0.16, 6), 0xa5d8ff, xr + 0.15, y1 + 0.14, -dp / 2 + 0.1);
      p(CYL(0.07, 0.05, 0.04, 8), TH.accent, xr - 0.05, y1 + 0.03, 0.1);
      break;
    }
    case 'cafetable': { // round wooden café table, latte cups and a bud vase, two plush armchairs
      tableTop(S / 2 + 0.02, d.h, 0x8d6e63, 0x343a40);
      for (const s of [-1, 1]) {
        p(CYL(0.05, 0.04, 0.08, 8), 0xffffff, s * 0.18, d.h + 0.04, s * 0.1);
        p(CYL(0.046, 0.046, 0.005, 8), basic(0xd9a066), s * 0.18, d.h + 0.082, s * 0.1);
        p(CYL(0.08, 0.08, 0.01, 8), 0xffffff, s * 0.18, d.h + 0.005, s * 0.1);
      }
      p(CYL(0.03, 0.04, 0.12, 6), 0xd0ebff, 0, d.h + 0.06, -0.15);
      p(SPH(0.04, 6, 4), basic(0xff8787), 0, d.h + 0.15, -0.15);
      sofa(-w / 2 - 0.3, 0, Math.PI / 2, 0.62, TH.accent); sofa(w / 2 + 0.3, 0, -Math.PI / 2, 0.62, TH.accent);
      break;
    }
    case 'seats': { // a row of cinema seats (cushioned, cup holders), facing the nearest waiting spot
      turn(Math.PI); // rows face north, toward the trailer screen (the 踢椅背 karen sits behind a row)
      const n = Math.max(1, Math.round(w / 0.62)), sw = w / n;
      const red = 0xc92a2a, dark = 0x343a40;
      p(B(w, 0.08, dp), dark, 0, 0.04, 0);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + sw * (i + 0.5);
        p(RB(sw - 0.1, 0.12, dp - 0.12, 0.04), red, x, 0.4, 0.04);
        p(RB(sw - 0.08, 0.62, 0.12, 0.05), red, x, 0.68, -dp / 2 + 0.08, -0.12);
        p(B(sw - 0.18, 0.06, 0.02), 0xfcc419, x, 0.95, -dp / 2 + 0.03, -0.12);
        p(B(0.12, 0.34, dp - 0.1), dark, x - sw / 2, 0.25, 0.0);
      }
      p(B(0.12, 0.34, dp - 0.1), dark, w / 2, 0.25, 0);
      for (let i = 0; i <= n; i++) {
        const x = -w / 2 + sw * i;
        p(B(0.1, 0.04, dp * 0.6), dark, x, 0.56, 0.02);
        p(CYL(0.045, 0.035, 0.05, 6), 0x212529, x, 0.6, dp / 2 - 0.05);
      }
      break;
    }
    case 'hotpot': { // hot-pot table: a split pot (spicy / clear broth) in the middle, meat and veg plates, chairs
      p(RB(w, 0.06, dp, 0.02), 0x343a40, 0, d.h - 0.03, 0);
      p(B(w - 0.2, d.h - 0.06, dp - 0.2), 0x5c3d2e, 0, (d.h - 0.06) / 2, 0);
      p(CYL(0.24, 0.2, 0.12, 12), 0xced4da, 0, d.h + 0.04, 0);
      p(geo('potHalf', () => new THREE.CylinderGeometry(0.21, 0.21, 0.02, 10, 1, false, 0, Math.PI)), 0xe03131, 0, d.h + 0.09, 0);
      p(geo('potHalf', () => new THREE.CylinderGeometry(0.21, 0.21, 0.02, 10, 1, false, 0, Math.PI)), 0xfff4e6, 0, d.h + 0.09, 0, 0, Math.PI);
      p(B(0.42, 0.04, 0.015), 0xced4da, 0, d.h + 0.1, 0);
      for (const s of [-1, 1]) for (const [x, c] of [[0.15, 0xff8fa3], [-0.18, 0x8ce99a]] as [number, number][]) {
        p(CYL(0.11, 0.09, 0.02, 10), 0xffffff, x * s * 1.2, d.h + 0.01, s * 0.38);
        p(CYL(0.08, 0.08, 0.03, 8), c, x * s * 1.2, d.h + 0.03, s * 0.38, 0, 0, 0, 1, 0.6, 1);
      }
      for (const s of [-1, 1]) p(B(0.22, 0.012, 0.012), 0x8b5a2b, s * 0.45, d.h + 0.01, s * 0.1, 0, 0.1);
      chair(-w / 2 - 0.35, 0, Math.PI / 2, TH.accent); chair(w / 2 + 0.35, 0, -Math.PI / 2, TH.accent);
      break;
    }
    case 'pump': { // fuel pump on a little island: two nozzles with hoses, a glowing display, price stripes
      p(RB(w, 0.12, dp, 0.04), 0xadb5bd, 0, 0.06, 0);
      p(B(w - 0.1, 0.06, dp - 0.1), 0xfab005, 0, 0.14, 0);
      p(RB(0.6, 1.5, 0.4, 0.06, 2), 0xf8f9fa, 0, 0.92, 0);
      p(RB(0.62, 0.22, 0.42, 0.05), TH.wainscot, 0, 1.72, 0);
      p(B(0.63, 0.06, 0.43), TH.accent, 0, 1.55, 0);
      for (const s of [-1, 1]) {
        const scr = new THREE.Mesh(geo('pumpScr', () => new THREE.PlaneGeometry(0.4, 0.18)), ctx.glow(0x96f2d7)); scr.position.set(0, 1.3, s * 0.205); scr.rotation.y = s > 0 ? 0 : Math.PI; G.add(scr);
        [0x2f9e44, 0xfab005, 0xe03131].forEach((c, i) => p(B(0.12, 0.08, 0.01), basic(c), -0.15 + i * 0.15, 1.05, s * 0.205));
      }
      for (const s of [-1, 1]) {
        p(RB(0.08, 0.2, 0.1, 0.02), 0x212529, s * 0.33, 0.95, 0.05);
        p(CYL(0.012, 0.012, 0.16, 5), 0x495057, s * 0.38, 0.85, 0.12, 0.8);
        p(TOR(0.22, 0.018, 3, 10, Math.PI), 0x212529, s * 0.34, 0.62, 0.02, 0, Math.PI / 2, Math.PI);
      }
      break;
    }
    case 'treadmill': {
      const t = nearestCamp(); if (t) turn(yawTo(t.x, t.z));
      p(B(w - 0.04, 0.02, dp - 0.04), 0x343a40, 0, 0.01, 0);
      p(RB(w * 0.85, 0.14, 0.62, 0.05), 0x495057, -0.05, 0.1, 0);
      p(B(w * 0.8, 0.02, 0.48), 0x212529, -0.05, 0.18, 0);
      for (const s of [-1, 1]) {
        p(CYL(0.03, 0.03, 1.05, 6), 0xadb5bd, w / 2 - 0.2, 0.68, s * 0.28, 0, 0, 0.12);
        p(CYL(0.025, 0.025, 0.45, 6), TH.accent, w / 2 - 0.42, 1.0, s * 0.3, 0, 0, Math.PI / 2);
      }
      p(RB(0.2, 0.3, 0.66, 0.05), TH.accent, w / 2 - 0.15, 1.22, 0, 0, 0, 0.5);
      const scr = new THREE.Mesh(geo('tmScr', () => new THREE.PlaneGeometry(0.34, 0.14)), ctx.glow(0x99e9f2)); scr.position.set(w / 2 - 0.25, 1.25, 0); scr.rotation.set(0, -Math.PI / 2, 0); scr.rotateX(-0.5 + 0.0); G.add(scr);
      break;
    }
    case 'bench': { // flat bench + squat rack with a loaded barbell
      const t = nearestCamp(); if (t) turn(yawTo(t.x, t.z));
      p(B(w - 0.04, 0.02, dp - 0.04), 0x343a40, 0, 0.01, 0);
      p(RB(1.0, 0.1, 0.3, 0.04), TH.accent, 0.1, 0.45, 0.05);
      for (const x of [-0.3, 0.45]) { p(B(0.06, 0.4, 0.06), 0x495057, x, 0.2, 0.05); p(B(0.06, 0.04, 0.36), 0x495057, x, 0.02, 0.05); }
      for (const s of [-1, 1]) { p(B(0.07, 1.25, 0.07), 0x212529, -0.45, 0.63, s * 0.42); p(B(0.2, 0.04, 0.2), 0x212529, -0.45, 0.02, s * 0.42); p(B(0.08, 0.04, 0.1), 0xfab005, -0.4, 1.05, s * 0.42); }
      p(CYL(0.02, 0.02, 1.5, 6), 0xced4da, -0.37, 1.1, 0, Math.PI / 2);
      for (const s of [-1, 1]) {
        p(CYL(0.2, 0.2, 0.05, 12), 0x212529, -0.37, 1.1, s * 0.56, Math.PI / 2);
        p(CYL(0.15, 0.15, 0.05, 12), 0xe03131, -0.37, 1.1, s * 0.62, Math.PI / 2);
      }
      break;
    }
    case 'bike': { // spin bike + a pair of kettlebells
      const t = nearestCamp(); if (t) turn(yawTo(t.x, t.z));
      p(B(w - 0.04, 0.02, dp - 0.04), 0x343a40, 0, 0.01, 0);
      p(B(0.9, 0.06, 0.12), 0x495057, -0.05, 0.05, 0);
      p(CYL(0.24, 0.24, 0.06, 14), 0x212529, 0.28, 0.3, 0, Math.PI / 2);
      p(CYL(0.1, 0.1, 0.07, 10), TH.accent, 0.28, 0.3, 0, Math.PI / 2);
      p(B(0.07, 0.6, 0.07), TH.accent, -0.15, 0.4, 0, 0, 0, -0.35);
      p(B(0.06, 0.75, 0.06), TH.accent, 0.3, 0.55, 0, 0, 0, 0.25);
      p(RB(0.28, 0.06, 0.16, 0.03), 0x212529, -0.26, 0.74, 0);
      p(CYL(0.02, 0.02, 0.42, 6), 0x343a40, 0.42, 0.93, 0, Math.PI / 2);
      for (const s of [-1, 1]) p(CAP(0.025, 0.08, 5), 0x212529, 0.42, 0.93, s * 0.22, Math.PI / 2);
      for (const s of [-1, 1]) {
        p(SPH(0.11, 8, 6), 0x343a40, -0.45, 0.11, s * 0.38 * (dp / 1.2));
        p(TOR(0.06, 0.018, 3, 8, Math.PI), 0x343a40, -0.45, 0.2, s * 0.38 * (dp / 1.2));
      }
      break;
    }
    case 'dumbbells': { // two-tier dumbbell rack, colourful pairs
      p(B(w - 0.04, 0.02, dp - 0.04), 0x343a40, 0, 0.01, 0);
      for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) p(B(0.08, 0.7, 0.5), 0x212529, x, 0.36, 0, -0.0);
      for (const [y, z] of [[0.38, 0.12], [0.66, -0.1]]) {
        p(B(w - 0.2, 0.04, 0.24), 0x495057, 0, y, z, 0.25);
        const cols = [0xe03131, 0xfab005, 0x1c7ed6, 0x2f9e44, 0x7048e8];
        for (let i = 0; i < 4; i++) {
          const x = -w / 2 + 0.35 + i * (w - 0.6) / 3, c = cols[(i + (y > 0.5 ? 2 : 0)) % 5];
          p(CYL(0.018, 0.018, 0.22, 5), 0xadb5bd, x, y + 0.07, z, Math.PI / 2);
          for (const s of [-1, 1]) p(CYL(0.055, 0.055, 0.08, 6), c, x, y + 0.07, z + s * 0.09, Math.PI / 2);
        }
      }
      p(CYL(0.025, 0.025, 0.02, 6), 0xfab005, 0, 0.04, dp / 2 - 0.15);
      p(RB(0.7, 0.02, 0.22, 0.01), 0x7048e8, 0.1, 0.03, dp / 2 - 0.15, 0, 0.1); // yoga mat
      break;
    }
    case 'dining': { // steakhouse table: tablecloth, sizzling iron plates (steak, egg, noodles), candle, chairs
      p(RB(w + 0.04, 0.05, dp + 0.04, 0.02), 0xffffff, 0, d.h - 0.025, 0);
      p(B(w + 0.06, 0.25, dp + 0.06), 0xffffff, 0, d.h - 0.15, 0);
      p(B(0.3, 0.012, dp + 0.08), TH.wainscot, 0, d.h + 0.003, 0);
      p(B(0.3, 0.24, 0.012), TH.wainscot, 0, d.h - 0.12, dp / 2 + 0.035);
      p(B(0.3, 0.24, 0.012), TH.wainscot, 0, d.h - 0.12, -dp / 2 - 0.035);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(CYL(0.03, 0.03, d.h - 0.28, 5), 0x5c3d2e, sx * (w / 2 - 0.1), (d.h - 0.28) / 2, sz * (dp / 2 - 0.1));
      for (const s of [-1, 1]) {
        const x = s * 0.33;
        p(RB(0.32, 0.03, 0.24, 0.02), 0x8b5a2b, x, d.h + 0.015, 0);
        p(RB(0.3, 0.03, 0.22, 0.03), 0x212529, x, d.h + 0.04, 0);
        p(RB(0.15, 0.04, 0.1, 0.03), 0x7f3b1a, x - s * 0.03, d.h + 0.07, -0.03);
        p(CYL(0.04, 0.04, 0.012, 8), 0xffffff, x + s * 0.08, d.h + 0.06, 0.06);
        p(CYL(0.018, 0.018, 0.015, 6), 0xfcc419, x + s * 0.08, d.h + 0.068, 0.06);
        p(CYL(0.05, 0.05, 0.02, 8), 0xffe066, x + s * 0.06, d.h + 0.062, -0.07);
        p(B(0.012, 0.005, 0.18), 0xced4da, x - s * 0.18, d.h + 0.01, 0.02);
      }
      p(CYL(0.025, 0.025, 0.08, 6), 0xfff4e6, 0, d.h + 0.04, 0.3);
      p(CONE(0.012, 0.03, 4), basic(0xffa94d), 0, d.h + 0.1, 0.3);
      chair(-w / 2 - 0.35, 0, Math.PI / 2, TH.wainscot, 0x5c3d2e); chair(w / 2 + 0.35, 0, -Math.PI / 2, TH.wainscot, 0x5c3d2e);
      break;
    }
    case 'demo': { // 3C demo table: phones on stands, an open laptop, a tablet, a smartwatch
      p(RB(w, d.h - 0.05, dp, 0.05), 0xf8f9fa, 0, (d.h - 0.05) / 2, 0);
      p(B(w + 0.01, 0.1, dp + 0.01), TH.accent, 0, d.h - 0.2, 0);
      p(RB(w + 0.04, 0.04, dp + 0.04, 0.015), 0xdee2e6, 0, d.h, 0);
      const scrM = ctx.glow(0x74c0fc);
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
        const x = -0.35 + i * 0.35, z = s * (dp / 2 - 0.15);
        p(B(0.08, 0.04, 0.06), 0x343a40, x, d.h + 0.04, z);
        p(RB(0.09, 0.17, 0.012, 0.01), 0x212529, x, d.h + 0.13, z + s * 0.01, -s * 0.25);
        const sc = new THREE.Mesh(geo('demoScr', () => new THREE.PlaneGeometry(0.075, 0.15)), scrM);
        sc.position.set(x, d.h + 0.13, z + s * 0.018); sc.rotation.set(-s * 0.25, s > 0 ? 0 : Math.PI, 0); G.add(sc);
        p(CYL(0.004, 0.004, 0.2, 3), 0x495057, x + 0.05, d.h + 0.03, z - s * 0.08, Math.PI / 2 - 0.3);
      }
      p(RB(0.36, 0.015, 0.24, 0.01), 0xadb5bd, 0, d.h + 0.03, 0);
      p(RB(0.36, 0.24, 0.012, 0.01), 0xadb5bd, 0, d.h + 0.15, -0.12, -0.25);
      const lap = new THREE.Mesh(geo('lapScr', () => new THREE.PlaneGeometry(0.32, 0.2)), ctx.glow(0x91a7ff)); lap.position.set(0, d.h + 0.15, -0.112); lap.rotation.x = -0.25; G.add(lap);
      break;
    }
    case 'tvwall': { // low TV cabinet against the wall with three big TVs above showing bright pictures
      const face = d.x0 < 1 ? 1 : -1; // +1: on the west wall, facing east
      G.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2; [w, dp] = [dp, w];
      p(RB(w, 0.5, dp, 0.04), 0x343a40, 0, 0.25, 0);
      p(B(w + 0.01, 0.04, dp + 0.01), TH.accent, 0, 0.45, 0);
      const cols = [0x74c0fc, 0xffa94d, 0x8ce99a];
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * (w / 3), big = i === 1;
        const tw = w / 3 - 0.08, th = big ? 0.62 : 0.5, y = big ? 1.55 : 1.0;
        p(RB(tw, th, 0.06, 0.02), 0x212529, x, y, -dp / 2 + 0.06);
        const sc = new THREE.Mesh(geo('tv' + tw.toFixed(2) + th, () => new THREE.PlaneGeometry(tw - 0.06, th - 0.06)), ctx.glow(cols[i]));
        sc.position.set(x, y, -dp / 2 + 0.095); G.add(sc);
        p(SPH(0.07, 6, 4), basic(0xfff3bf), x - tw * 0.2, y + th * 0.15, -dp / 2 + 0.1, 0, 0, 0, 1, 1, 0.2);
        p(B(tw * 0.5, 0.06, 0.01), basic(0xffffff), x + tw * 0.1, y - th * 0.25, -dp / 2 + 0.1);
        if (!big) p(B(0.2, 0.02, 0.12), 0x212529, x, 0.52, -dp / 2 + 0.12);
      }
      p(B(0.04, 0.8, 0.04), 0x212529, 0, 1.0, -dp / 2 + 0.03);
      break;
    }
    case 'mirrors': { // salon styling counter: a long shelf with big round mirrors, sprays and a hair dryer
      p(RB(w, 0.08, dp, 0.03), 0xf8f9fa, 0, d.h - 0.04, 0);
      p(RB(w - 0.1, d.h - 0.3, dp - 0.1, 0.04), TH.counter, 0, (d.h - 0.3) / 2 + 0.2, 0);
      const n = Math.max(2, Math.round(w / 1.5));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w / n) * (i + 0.5);
        p(CYL(0.42, 0.42, 0.05, 16), TH.accent, x, d.h + 0.55, -dp / 2 + 0.08, Math.PI / 2);
        p(CYL(0.37, 0.37, 0.01, 16), 0xdbe4ff, x, d.h + 0.55, -dp / 2 + 0.11, Math.PI / 2);
        p(B(0.04, 0.2, 0.04), 0xadb5bd, x, d.h + 0.1, -dp / 2 + 0.08);
        p(CYL(0.03, 0.035, 0.16, 6), [0xf783ac, 0x74c0fc, 0xffd43b][i % 3], x - 0.3, d.h + 0.08, 0.05);
        p(CYL(0.02, 0.02, 0.04, 5), 0x212529, x - 0.3, d.h + 0.18, 0.05);
        p(CAP(0.045, 0.12, 6), 0x212529, x + 0.28, d.h + 0.06, 0.05, 0, 0, Math.PI / 2);
        p(CYL(0.02, 0.02, 0.1, 5), 0x212529, x + 0.22, d.h + 0.02, 0.1);
        for (let k = 0; k < 4; k++) p(B(0.012, 0.004, 0.12), 0x495057, x - 0.05 + k * 0.03, d.h + 0.005, 0.08);
      }
      break;
    }
    case 'dryer': { // salon hood-dryer chair
      p(CYL(0.28, 0.32, 0.05, 12), 0x343a40, 0, 0.025, 0);
      p(CYL(0.05, 0.05, 0.38, 6), 0xadb5bd, 0, 0.22, 0);
      p(RB(0.6, 0.12, 0.55, 0.05), TH.accent, 0, 0.45, 0.05);
      p(RB(0.6, 0.55, 0.12, 0.05), TH.accent, 0, 0.75, -0.24);
      for (const s of [-1, 1]) p(RB(0.08, 0.06, 0.5, 0.03), 0x212529, s * 0.3, 0.62, 0.05);
      p(CYL(0.03, 0.03, 0.8, 6), 0xadb5bd, 0, 1.15, -0.32);
      p(DOME(0.3, Math.PI * 0.55, 12, 5), 0xf8f9fa, 0, 1.45, -0.05, -0.5);
      p(TOR(0.26, 0.03, 4, 14), TH.accent, 0, 1.38, 0.05, Math.PI / 2 + 0.5);
      break;
    }
    case 'writedesk': { // post office writing desk: slanted top, pens on chains, form slots, glue pot
      p(B(0.12, d.h - 0.1, 0.12), 0x495057, 0, (d.h - 0.1) / 2, 0);
      p(RB(0.6, 0.04, 0.6, 0.02), 0x495057, 0, 0.02, 0);
      p(RB(w, 0.06, dp, 0.02), TH.accent, 0, d.h - 0.05, 0);
      p(RB(w - 0.1, 0.03, dp - 0.1, 0.01), 0xd8f5a2, 0, d.h - 0.01, 0);
      p(RB(0.3, 0.3, 0.3, 0.03), 0xf8f9fa, 0, d.h + 0.15, 0);
      for (let i = 0; i < 3; i++) p(B(0.22, 0.012, 0.3), [0xffffff, 0xd3f9d8, 0xfff3bf][i], 0, d.h + 0.05 + i * 0.09, 0);
      for (const [x, z] of [[-0.4, 0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, -0.4]]) {
        p(CYL(0.008, 0.008, 0.12, 4), 0x212529, x, d.h + 0.015, z, Math.PI / 2, 0.5);
        p(TOR(0.06, 0.004, 3, 6, Math.PI), 0xadb5bd, x * 0.8, d.h + 0.005, z * 0.8, -Math.PI / 2);
        p(B(0.18, 0.004, 0.25), 0xffffff, x * 0.6, d.h + 0.003, z * 0.75, 0, x * z * 2);
      }
      p(CYL(0.04, 0.04, 0.07, 8), 0xffd43b, 0.2, d.h + 0.035, 0.25);
      break;
    }
    case 'parcel': { // parcel shelf with brown boxes and a scale on top
      p(B(w, 0.05, dp), 0x495057, 0, 0.03, 0);
      for (const s of [-1, 1]) for (const t of [-1, 1]) p(B(0.05, d.h, 0.05), 0x495057, s * (w / 2 - 0.03), d.h / 2, t * (dp / 2 - 0.03));
      p(B(w, 0.04, dp), 0x868e96, 0, d.h * 0.5, 0);
      p(B(w, 0.05, dp), 0x495057, 0, d.h, 0);
      const box = (x: number, y: number, z: number, s: number, r = 0) => {
        p(B(0.3 * s, 0.22 * s, 0.26 * s), 0xd2a679, x, y + 0.11 * s, z, 0, r);
        p(B(0.06 * s, 0.222 * s, 0.262 * s), 0xc49a6c, x, y + 0.11 * s, z, 0, r);
        p(B(0.1 * s, 0.07 * s, 0.005), basic(0xffffff), x + 0.07 * s, y + 0.13 * s, z + 0.131 * s, 0, r);
      };
      box(-0.3, 0.06, 0.2, 1.1); box(0.15, 0.06, -0.15, 1.2, 0.3); box(0.3, 0.06, 0.3, 0.8); box(-0.25, 0.06, -0.25, 0.9, -0.2);
      box(-0.3, d.h * 0.5 + 0.02, 0.1, 1); box(0.25, d.h * 0.5 + 0.02, 0.0, 1.1, 0.2);
      p(RB(0.4, 0.08, 0.36, 0.02), 0xf8f9fa, 0.05, d.h + 0.065, 0);
      p(RB(0.42, 0.02, 0.38, 0.01), 0xadb5bd, 0.05, d.h + 0.115, 0);
      p(RB(0.16, 0.1, 0.03, 0.01), 0x212529, 0.05, d.h + 0.08, 0.19, -0.3);
      const sc = new THREE.Mesh(geo('scaleScr', () => new THREE.PlaneGeometry(0.12, 0.06)), ctx.glow(0x8ce99a)); sc.position.set(0.05, d.h + 0.08, 0.206); sc.rotation.x = -0.3; G.add(sc);
      box(-0.3, d.h + 0.025, 0, 0.8, 0.4);
      break;
    }
    case 'bpmeter': { // free blood-pressure station: small table, the machine with a cuff, a stool
      p(RB(w, 0.05, dp, 0.02), 0xf8f9fa, 0, d.h - 0.025, 0);
      p(B(w - 0.12, d.h - 0.05, dp - 0.12), TH.wainscot, 0, (d.h - 0.05) / 2, 0);
      p(RB(0.45, 0.3, 0.4, 0.05), 0xf8f9fa, 0, d.h + 0.15, -0.15);
      p(CYL(0.13, 0.13, 0.38, 12, true), TH.accent, 0, d.h + 0.15, 0.05, 0, Math.PI / 2, Math.PI / 2);
      const sc = new THREE.Mesh(geo('bpScr', () => new THREE.PlaneGeometry(0.2, 0.1)), ctx.glow(0x99e9f2)); sc.position.set(0, d.h + 0.28, 0.056); sc.rotation.x = -0.6; G.add(sc);
      p(B(0.08, 0.04, 0.02), basic(0xff6b6b), 0.12, d.h + 0.25, 0.06, -0.6);
      p(CYL(0.2, 0.2, 0.06, 10), TH.accent, 0, 0.45, dp / 2 + 0.35);
      p(CYL(0.04, 0.05, 0.42, 6), 0xadb5bd, 0, 0.21, dp / 2 + 0.35);
      break;
    }
    case 'medcase': { // glass medicine cabinet: wood frame, three shelves of bottles and boxes, a green cross on top
      p(RB(w, 0.12, dp, 0.03), 0xf8f9fa, 0, 0.06, 0);
      const H = 1.7;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(B(0.05, H, 0.05), 0xf8f9fa, sx * (w / 2 - 0.03), H / 2, sz * (dp / 2 - 0.03));
      p(B(w, 0.05, dp), 0xf8f9fa, 0, H, 0);
      p(B(w - 0.06, H - 0.1, 0.03), TH.wainscot, 0, H / 2, -dp / 2 + 0.04);
      glass(B(w - 0.04, H - 0.14, dp - 0.04), 0, H / 2 + 0.03, 0);
      const cols = [0xffffff, 0xff8787, 0x74c0fc, 0xffd43b, 0x8ce99a];
      for (let lvl = 0; lvl < 3; lvl++) {
        const y = 0.15 + lvl * 0.5;
        p(B(w - 0.08, 0.025, dp - 0.08), 0xe9ecef, 0, y, 0);
        for (let i = 0; i < 4; i++) {
          const x = -w / 2 + 0.17 + i * (w - 0.34) / 3;
          if ((i + lvl) % 2) p(CYL(0.05, 0.05, 0.16, 8), cols[(i + lvl) % 5], x, y + 0.09, 0);
          else p(B(0.12, 0.18, 0.1), cols[(i + lvl + 2) % 5], x, y + 0.1, 0.05);
        }
      }
      p(B(0.24, 0.08, 0.03), basic(0x2f9e44), 0, H + 0.18, 0);
      p(B(0.08, 0.24, 0.03), basic(0x2f9e44), 0, H + 0.18, 0);
      break;
    }
    case 'lobby': { // hotel lobby: low coffee table with flowers and a magazine, plush sofas either side
      p(RB(w, 0.06, dp, 0.03), 0x5c3d2e, 0, 0.42, 0);
      p(RB(w - 0.15, 0.04, dp - 0.15, 0.02), 0xfff3bf, 0, 0.1, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(CYL(0.03, 0.025, 0.4, 5), 0x5c3d2e, sx * (w / 2 - 0.1), 0.2, sz * (dp / 2 - 0.1));
      p(CYL(0.06, 0.08, 0.18, 8), 0xf8f9fa, 0.15, 0.54, -0.1);
      for (const [x, z, c] of [[0.15, -0.1, 0xff8787], [0.1, -0.05, 0xffd43b], [0.2, -0.14, 0xf783ac]] as [number, number, number][]) p(SPH(0.05, 6, 4), basic(c), x, 0.68, z);
      p(B(0.22, 0.012, 0.3), TH.wainscot, -0.2, 0.455, 0.12, 0, 0.3);
      sofa(-w / 2 - 0.36, 0, Math.PI / 2, 1.0, TH.wainscot); sofa(w / 2 + 0.36, 0, -Math.PI / 2, 1.0, TH.wainscot);
      break;
    }
    case 'luggage': { // bellboy luggage cart: brass frame with stacked suitcases
      const brass = mat(0xfcc419, q, { metal: 0.6, rough: 0.3 });
      p(RB(w, 0.06, dp - 0.1, 0.02), 0xc92a2a, 0, 0.15, 0);
      for (const s of [-1, 1]) for (const t of [-1, 1]) p(CYL(0.035, 0.035, 0.08, 6), 0x212529, s * (w / 2 - 0.1), 0.05, t * (dp / 2 - 0.1), 0, 0, Math.PI / 2);
      for (const s of [-1, 1]) p(CYL(0.02, 0.02, 1.5, 6), brass, s * (w / 2 - 0.05), 0.9, 0);
      p(TOR((w - 0.1) / 2, 0.02, 4, 12, Math.PI), brass, 0, 1.65, 0);
      p(SPH(0.04, 6, 4), brass, 0, 1.65 + (w - 0.1) / 2, 0);
      p(RB(0.55, 0.4, 0.3, 0.05), 0x1971c2, -0.02, 0.38, 0.05);
      p(RB(0.5, 0.32, 0.26, 0.05), 0xf08c00, 0.02, 0.74, -0.02, 0, 0.2);
      p(RB(0.34, 0.24, 0.18, 0.04), 0x2f9e44, -0.05, 1.02, 0.05, 0, -0.2);
      p(TOR(0.06, 0.012, 3, 8, Math.PI), 0x212529, -0.02, 0.58, 0.05);
      break;
    }
    default: return false;
  }
  ctx.scene.add(G);
  flatten(ctx.scene, G);
  ctx.scene.remove(G);
  return true;
}

/** Overhead / wall extras for a store that need no collision (hung from the ceiling, above everyone's heads). */
export function buildStoreExtras(ctx: DecorCtx, mapId: string) {
  const { q, theme: TH } = ctx, S = ctx.scene;
  if (mapId === 'cinema') {
    // trailer screen hanging over the waiting area
    const x = 5.5, z = 6.7, y = 2.68;
    put(S, RB(4.2, 0.95, 0.12, 0.04), mat(0x212529, q), x, y, z);
    const scr = ctx.sign(3.9, 0.8, () => screenCanvas());
    scr.position.set(x, y, z + 0.065); S.add(scr);
    for (const s of [-1, 1]) put(S, CYL(0.012, 0.012, 3.2 - y - 0.45, 4), mat(0x495057, q), x + s * 1.8, (3.2 + y + 0.45) / 2, z);
    put(S, B(4.3, 0.06, 0.16), mat(TH.accent, q), x, y - 0.5, z);
  } else if (mapId === 'hotel') {
    // brass reception bell sign + key rack behind the counter
    const x = 18, z = 8.25;
    put(S, RB(2.4, 0.5, 0.06, 0.02), mat(0x5c3d2e, q), x, 2.55, z);
    const sg = ctx.sign(2.2, 0.4, () => signCanvas('RECEPTION', '#5f3dc4'));
    sg.position.set(x, 2.55, z + 0.035); S.add(sg);
  }
}

function signCanvas(text: string, bg: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#2a1f3d'; g.lineWidth = 16; g.strokeRect(8, 8, 496, 240);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${text.length > 4 ? 84 : 140}px "Noto Sans TC",sans-serif`;
  g.fillText(text, 256, 132, 470);
  return c;
}
function screenCanvas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 210;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 1024, 210); gr.addColorStop(0, '#1c3f6e'); gr.addColorStop(0.5, '#7048e8'); gr.addColorStop(1, '#e64980');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 210);
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(80 + i * 115, 40 + (i % 3) * 60, 24 + (i % 2) * 18, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffd43b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 52px sans-serif'; g.fillText('NOW SHOWING', 512, 62);
  g.fillStyle = '#fff'; g.font = '900 78px sans-serif'; g.fillText('★ KAREN BUSTERS 2 ★', 512, 145, 980);
  return c;
}
