// Store-specific food-station machines (espresso machine, drip brewer, pour-over bar, waffle irons, siphon bar,
// tea urn, deli hot case). Each machine sits on the station cabinet the caller draws (cabinet top at y ≈ 0.91, the
// worker stands on the +z side) and reports where its "working" feedback goes: the steam puffs (coffee stations)
// and the heat glow that pulses while someone is preparing food (meal stations). Like decor.ts, every part is
// flattened into plain scene meshes so StoreView.mergeStatic folds them into the shared static draw calls; glass goes
// into the one shared glass mesh. Keep parts low-poly: this runs on phones.
import * as THREE from 'three';
import type { AABB } from '../../shared/map.ts';
import type { Quality } from './storage.ts';
import { DecorCtx, buildStationTop } from './decor.ts';
import { B, CAP, CONE, CYL, DOME, RB as RB0, SPH, TOR, geo, mat, put } from './models.ts';

/** Where a station's live feedback is drawn (world coordinates). */
export interface StationInfo {
  /** Bottom of the rising steam puffs. */
  steam?: THREE.Vector3;
  /** Plane that glows while someone works the station (default: facing +z; rx tilts it, e.g. -PI/2 = lying flat). */
  glow?: { pos: THREE.Vector3; w: number; h: number; rx?: number; /** round glow; w is the radius */ circle?: boolean };
}

const rbFor = (q: Quality) => q === 'low' ? (w: number, h: number, d: number) => B(w, h, d) : RB0;
type P = (g: THREE.BufferGeometry, color: number | THREE.Material, x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number, sx?: number, sy?: number, sz?: number) => THREE.Mesh;

function flatten(S: THREE.Scene, G: THREE.Object3D) {
  G.updateMatrixWorld(true);
  const list: THREE.Mesh[] = [];
  G.traverse(o => { if ((o as THREE.Mesh).isMesh) list.push(o as THREE.Mesh); });
  for (const m of list) {
    const n = new THREE.Mesh(m.geometry, m.material);
    m.matrixWorld.decompose(n.position, n.quaternion, n.scale);
    n.castShadow = n.receiveShadow = true;
    S.add(n);
  }
}

/**
 * Builds the machine for `key` ('<mapId>:coffee' or '<mapId>:meal') on the station footprint `b`.
 * Returns null when the store uses the default coffee machine / microwave.
 */
export function buildStation(ctx: DecorCtx, key: string, b: AABB): StationInfo | null {
  const { q, theme: TH } = ctx;
  const RB = rbFor(q);
  const G = new THREE.Group(); G.position.set((b.x0 + b.x1) / 2, 0.91, (b.z0 + b.z1) / 2);
  G.updateMatrixWorld(true);
  const w = b.x1 - b.x0;
  const p: P = (g, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    put(G, g, typeof c === 'number' ? mat(c, q) : c, x, y, z, rx, ry, rz, sx, sy, sz);
  const shiny = (c: number) => mat(c, q, { metal: 0.45, rough: 0.3 });
  const glow = (g: THREE.BufferGeometry, c: number, x: number, y: number, z: number, rx = 0) => put(G, g, ctx.glow(c), x, y, z, rx);
  const glass = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) =>
    ctx.glass(g, new THREE.Matrix4().compose(G.localToWorld(new THREE.Vector3(x, y, z)), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1)));
  const at = (x: number, y: number, z: number) => G.localToWorld(new THREE.Vector3(x, y, z));
  const done = (info: StationInfo) => { ctx.scene.add(G); flatten(ctx.scene, G); ctx.scene.remove(G); return info; };
  const steel = shiny(0xced4da), dark = mat(0x343a40, q), white = mat(0xf8f9fa, q, { rough: 0.4 });
  const cup = (x: number, z: number, c = 0xffffff, saucer = true) => {
    if (saucer) p(CYL(0.055, 0.05, 0.012, 10), c, x, 0.006, z);
    p(CYL(0.038, 0.03, 0.06, 10), c, x, 0.042, z);
    p(TOR(0.018, 0.006, 3, 6), c, x + 0.042, 0.045, z, 0, 0, Math.PI / 2);
  };

  switch (key) {
    case 'bakery:coffee': { // cream espresso machine with copper trim: two group heads, cups warming on top, steam wand
      const cream = mat(0xfff4e6, q, { rough: 0.45 }), copper = shiny(0xd9480f);
      for (const sx of [-0.3, 0.3]) for (const sz of [-0.22, 0.08]) p(CYL(0.025, 0.03, 0.05, 6), dark, sx, 0.025, sz);
      p(RB(0.72, 0.4, 0.4, 0.06), cream, 0, 0.25, -0.08);
      p(RB(0.74, 0.07, 0.42, 0.03), TH.accent, 0, 0.47, -0.08);
      p(B(0.66, 0.02, 0.34), steel, 0, 0.515, -0.08);
      for (let i = 0; i < 4; i++) p(CYL(0.035, 0.028, 0.055, 8), [0xffffff, 0xffd8a8, 0xffffff, 0xd0ebff][i], -0.22 + i * 0.14, 0.555, -0.12 + (i % 2) * 0.06);
      p(B(0.72, 0.05, 0.02), copper, 0, 0.12, 0.125);
      for (const sx of [-0.16, 0.16]) {
        p(CYL(0.055, 0.05, 0.06, 10), steel, sx, 0.25, 0.15);
        p(CYL(0.045, 0.045, 0.025, 10), dark, sx, 0.21, 0.15);
        p(B(0.03, 0.03, 0.16), dark, sx, 0.21, 0.26, 0.15);
        cup(sx, 0.17, 0xffffff, false);
      }
      p(B(0.62, 0.025, 0.14), steel, 0, 0.0125 + 0.02, 0.19);
      p(CYL(0.06, 0.06, 0.02, 12), white, 0, 0.36, 0.125, Math.PI / 2);
      glow(CYL(0.045, 0.045, 0.005, 12), 0xfff3bf, 0, 0.36, 0.137, Math.PI / 2);
      p(B(0.006, 0.035, 0.004), 0xe03131, 0.01, 0.37, 0.141, 0, 0, -0.6);
      p(CYL(0.012, 0.012, 0.2, 5), steel, 0.33, 0.2, 0.17, 0.25, 0, -0.15);
      p(SPH(0.02, 6, 4), dark, 0.31, 0.31, 0.15);
      // jar of beans
      p(CYL(0.06, 0.06, 0.14, 8), 0x6b3f1d, -0.42, 0.07, 0.15);
      p(CYL(0.064, 0.064, 0.03, 8), TH.accent, -0.42, 0.155, 0.15);
      return done({ steam: at(0.16, 0.62, 0.12) });
    }
    case 'gas:coffee': { // self-serve drip brewer: black tower with a yellow header, two glass carafes on warmer plates
      p(RB(0.86, 0.66, 0.2, 0.04), 0x212529, 0, 0.33, -0.27);
      p(RB(0.88, 0.12, 0.46, 0.04), 0x212529, 0, 0.6, -0.12);
      p(B(0.9, 0.05, 0.48), TH.accent, 0, 0.68, -0.12);
      const sg = ctx.sign(0.7, 0.1, () => tinySign('HOT COFFEE', '#fab005', '#212529'));
      sg.position.copy(at(0, 0.6, 0.115)); ctx.scene.add(sg);
      p(B(0.86, 0.03, 0.42), 0x495057, 0, 0.015, -0.1);
      for (const sx of [-0.2, 0.2]) {
        p(CYL(0.1, 0.1, 0.015, 12), 0x212529, sx, 0.035, 0.0);
        glow(B(0.03, 0.03, 0.005), 0xff6b6b, sx, 0.1, -0.163);
        p(CYL(0.07, 0.07, 0.03, 8), dark, sx, 0.52, 0.0); // brew basket
        // carafe: glass, coffee inside, black collar and handle
        glass(CYL(0.08, 0.09, 0.2, 10), sx, 0.145, 0.0);
        p(CYL(0.08, 0.088, 0.1, 10), 0x5c2e0e, sx, 0.095, 0.0);
        p(CYL(0.07, 0.08, 0.05, 10), 0x212529, sx, 0.27, 0.0);
        p(B(0.025, 0.12, 0.03), 0x212529, sx + 0.1, 0.18, 0.0);
      }
      // cup sleeve
      for (let i = 0; i < 4; i++) p(CYL(0.045, 0.035, 0.08, 8), 0xffffff, 0.42, 0.04 + i * 0.03, 0.22);
      return done({ steam: at(-0.2, 0.3, 0.02) });
    }
    case 'cafe:coffee': { // pour-over bar: wooden drip stand, two ceramic drippers over glass servers, gooseneck kettle
      const wood = mat(0xb08060, q);
      p(B(0.6, 0.03, 0.22), wood, -0.12, 0.015, -0.02);
      for (const sx of [-0.4, 0.16]) p(B(0.03, 0.3, 0.2), wood, sx, 0.165, -0.02);
      p(B(0.6, 0.03, 0.22), wood, -0.12, 0.315, -0.02);
      for (const sx of [-0.26, 0.02]) {
        p(CONE(0.085, 0.11, 10), 0xffffff, sx, 0.385, -0.02, Math.PI);
        p(CYL(0.09, 0.09, 0.02, 10), 0xffffff, sx, 0.44, -0.02);
        p(CYL(0.07, 0.07, 0.01, 10), 0x5c2e0e, sx, 0.445, -0.02);
        glass(CYL(0.06, 0.07, 0.16, 10), sx, 0.11, -0.02);
        p(CYL(0.058, 0.068, 0.07, 10), 0x6b3f1d, sx, 0.065, -0.02);
      }
      // scale with a little lit display under the right server
      p(B(0.2, 0.02, 0.24), 0x212529, 0.02, 0.0, 0.02);
      glow(B(0.07, 0.02, 0.003), 0x96f2d7, 0.02, 0.006, 0.142);
      // gooseneck kettle
      p(CYL(0.075, 0.085, 0.14, 10), 0x212529, 0.36, 0.07, 0.05);
      p(DOME(0.075, Math.PI / 2, 10, 3), 0x212529, 0.36, 0.14, 0.05);
      p(SPH(0.018, 6, 4), 0xadb5bd, 0.36, 0.22, 0.05);
      p(CYL(0.008, 0.012, 0.2, 5), 0x212529, 0.26, 0.15, 0.05, 0, 0, 0.7);
      p(TOR(0.05, 0.01, 3, 8, Math.PI), 0x212529, 0.45, 0.09, 0.05, 0, 0, -Math.PI / 2);
      // jar of beans and a hand grinder
      p(CYL(0.05, 0.05, 0.12, 8), 0x6b3f1d, -0.44, 0.06, 0.2);
      p(CYL(0.054, 0.054, 0.025, 8), TH.accent, -0.44, 0.13, 0.2);
      p(CYL(0.04, 0.045, 0.14, 8), 0xadb5bd, 0.32, 0.07, -0.25);
      p(B(0.12, 0.01, 0.015), 0x212529, 0.36, 0.15, -0.25);
      return done({ steam: at(-0.12, 0.5, -0.02) });
    }
    case 'cafe:meal': { // two waffle irons (one open with a golden waffle), batter jug, a plate of waffles with cream
      const iron = mat(0x2b2f33, q, { metal: 0.3, rough: 0.5 }), waffle = mat(0xe8a24a, q);
      // closed iron
      p(RB(0.38, 0.1, 0.38, 0.04), iron, -0.35, 0.05, 0);
      p(CYL(0.18, 0.18, 0.07, 14), iron, -0.35, 0.14, 0);
      p(B(0.05, 0.035, 0.18), TH.accent, -0.35, 0.15, 0.25);
      glow(B(0.02, 0.02, 0.005), 0x69db7c, -0.2, 0.06, 0.192);
      // open iron with a waffle
      p(RB(0.38, 0.1, 0.38, 0.04), iron, 0.22, 0.05, 0);
      p(CYL(0.15, 0.15, 0.025, 14), waffle, 0.22, 0.11, 0);
      for (let i = -1; i <= 1; i++) { p(B(0.26, 0.01, 0.02), 0xc77a2a, 0.22, 0.125, i * 0.07); p(B(0.02, 0.01, 0.26), 0xc77a2a, 0.22 + i * 0.07, 0.125, 0); }
      p(CYL(0.18, 0.18, 0.07, 14), iron, 0.22, 0.286, -0.134, -1.15);
      p(B(0.05, 0.035, 0.18), TH.accent, 0.22, 0.5, -0.05, -1.15);
      // batter jug
      p(CYL(0.07, 0.06, 0.16, 10), 0xffffff, 0.62, 0.08, -0.1);
      p(CYL(0.064, 0.064, 0.01, 10), 0xffe8a8, 0.62, 0.16, -0.1);
      p(TOR(0.045, 0.012, 3, 8, Math.PI), 0xffffff, 0.69, 0.09, -0.1, 0, 0, -Math.PI / 2);
      // plate with a stack of waffles, cream and a strawberry
      p(CYL(0.13, 0.11, 0.015, 12), 0xffffff, -0.72, 0.008, 0.08);
      for (let i = 0; i < 2; i++) p(CYL(0.09, 0.09, 0.025, 10), waffle, -0.72, 0.03 + i * 0.027, 0.08, 0, i * 0.4);
      p(SPH(0.045, 8, 5), 0xffffff, -0.72, 0.095, 0.08);
      p(CONE(0.025, 0.05, 6), 0xe03131, -0.71, 0.14, 0.08, Math.PI);
      return done({ glow: { pos: at(-0.35, 0.18, 0), w: 0.17, h: 0.17, rx: -Math.PI / 2, circle: true } });
    }
    case 'bookstore:coffee': { // siphon bar: two glass siphons over little blue burners, cups on saucers
      const wood = mat(0x8d6e63, q);
      p(B(0.86, 0.03, 0.46), wood, 0, 0.015, -0.04);
      for (const sx of [-0.2, 0.12]) {
        p(CYL(0.08, 0.09, 0.025, 10), 0x212529, sx, 0.045, -0.06);
        p(B(0.02, 0.5, 0.02), 0x212529, sx, 0.28, -0.17);
        p(B(0.02, 0.02, 0.11), 0x212529, sx, 0.33, -0.115);
        p(CYL(0.03, 0.035, 0.05, 8), 0xadb5bd, sx, 0.08, -0.06);
        glow(CONE(0.022, 0.05, 6), 0x74c0fc, sx, 0.13, -0.06);
        // the glass alone reads as nothing from across the store: opaque rims and collars outline the shape,
        // both chambers hold coffee, and thin white glints mark the glass surfaces
        glass(SPH(0.08, 10, 7), sx, 0.23, -0.06);
        p(SPH(0.068, 8, 5), 0x5c2e0e, sx, 0.215, -0.06, 0, 0, 0, 1, 0.72, 1);
        p(TOR(0.079, 0.006, 3, 14), steel, sx, 0.23, -0.06, Math.PI / 2);
        p(CYL(0.026, 0.026, 0.025, 8), steel, sx, 0.31, -0.06);
        glass(CYL(0.014, 0.014, 0.08, 6), sx, 0.33, -0.06);
        p(CYL(0.045, 0.045, 0.02, 10), steel, sx, 0.365, -0.06);
        glass(CYL(0.065, 0.04, 0.14, 10), sx, 0.43, -0.06);
        p(CYL(0.057, 0.04, 0.085, 10), 0x6f4e37, sx, 0.415, -0.06);
        p(CYL(0.058, 0.058, 0.012, 10), 0xd9b38c, sx, 0.462, -0.06);
        p(CYL(0.069, 0.069, 0.018, 10), 0x212529, sx, 0.5, -0.06);
        glow(B(0.012, 0.07, 0.004), 0xffffff, sx - 0.035, 0.25, -0.06 + 0.072);
        glow(B(0.01, 0.09, 0.004), 0xffffff, sx - 0.032, 0.43, -0.06 + 0.06);
      }
      cup(0.36, 0.1, 0xffffff); cup(0.36, -0.08, 0xfff3bf);
      // stack of menus and a tiny sugar pot
      p(B(0.14, 0.03, 0.2), 0x5c940d, -0.4, 0.045, 0.12);
      p(CYL(0.035, 0.035, 0.06, 8), 0xffffff, -0.42, 0.06, -0.15);
      return done({ steam: at(-0.04, 0.52, -0.06) });
    }
    case 'hotel:coffee': { // tea station: brass-banded hot-water urn, a porcelain teapot, cups on saucers, tea caddy
      const brass = shiny(0xfab005);
      p(RB(0.9, 0.03, 0.56, 0.01), 0x5c3d2e, 0, 0.015, -0.02);
      // urn
      p(CYL(0.11, 0.13, 0.05, 12), dark, -0.26, 0.055, -0.1);
      p(CYL(0.13, 0.13, 0.36, 12), steel, -0.26, 0.26, -0.1);
      for (const y of [0.13, 0.4]) p(CYL(0.134, 0.134, 0.025, 12), brass, -0.26, y, -0.1);
      p(DOME(0.13, Math.PI / 2, 12, 3), steel, -0.26, 0.44, -0.1);
      p(SPH(0.025, 6, 4), brass, -0.26, 0.58, -0.1);
      p(B(0.03, 0.03, 0.08), brass, -0.26, 0.13, 0.05);
      p(B(0.06, 0.02, 0.02), 0x212529, -0.26, 0.15, 0.08);
      p(CYL(0.012, 0.012, 0.04, 5), brass, -0.26, 0.1, 0.085);
      // teapot
      const porcelain = mat(0xffffff, q, { rough: 0.3 });
      p(SPH(0.095, 10, 7), porcelain, 0.12, 0.09, -0.12, 0, 0, 0, 1, 0.8, 1);
      p(CYL(0.098, 0.098, 0.025, 12), 0x5f3dc4, 0.12, 0.09, -0.12);
      p(DOME(0.05, Math.PI / 2, 8, 3), porcelain, 0.12, 0.16, -0.12);
      p(SPH(0.015, 6, 4), 0x5f3dc4, 0.12, 0.215, -0.12);
      p(CYL(0.012, 0.022, 0.12, 6), porcelain, 0.235, 0.12, -0.12, 0, 0, -0.9);
      p(TOR(0.045, 0.012, 3, 8, Math.PI), porcelain, 0.02, 0.1, -0.12, 0, 0, Math.PI / 2);
      // cups and the tea caddy
      cup(0.04, 0.16); cup(0.2, 0.16); cup(0.36, 0.1);
      p(RB(0.12, 0.14, 0.12, 0.02), 0x5f3dc4, 0.36, 0.1, -0.15);
      p(B(0.125, 0.02, 0.125), brass, 0.36, 0.17, -0.15);
      return done({ steam: at(0.28, 0.2, -0.12) });
    }
    case 'supermarket:meal': { // deli hot case: steel well with food trays under slanted glass, red heat-lamp canopy
      p(RB(w - 0.1, 0.12, 0.7, 0.03), steel, 0, 0.06, 0);
      p(B(w - 0.2, 0.02, 0.6), 0x495057, 0, 0.125, 0);
      const foods: [number, (x: number) => void][] = [
        [0xc0582f, x => { for (let i = 0; i < 6; i++) p(SPH(0.045, 6, 4), 0xc0582f, x - 0.1 + (i % 3) * 0.1, 0.17, -0.08 + Math.floor(i / 3) * 0.14); }],
        [0x51cf66, x => { for (let i = 0; i < 5; i++) p(SPH(0.05, 6, 4), [0x51cf66, 0x2f9e44][i % 2], x - 0.1 + (i % 3) * 0.1, 0.165, -0.08 + Math.floor(i / 3) * 0.14); }],
        [0xfff9db, x => { p(B(0.3, 0.04, 0.42), 0xfff9db, x, 0.16, 0); }],
        [0xe03131, x => { for (let i = 0; i < 4; i++) p(CAP(0.025, 0.1, 5), 0xe03131, x, 0.165, -0.15 + i * 0.1, 0, 0, Math.PI / 2); }],
      ];
      foods.forEach(([, make], i) => {
        const x = -0.6 + i * 0.4;
        p(B(0.36, 0.04, 0.48), steel, x, 0.15, 0);
        make(x);
      });
      // slanted sneeze glass along the front, side panels
      glass(B(w - 0.2, 0.36, 0.015), 0, 0.3, 0.27, -0.45);
      for (const s of [-1, 1]) glass(B(0.015, 0.32, 0.5), s * (w / 2 - 0.1), 0.28, 0.05);
      // canopy with heat lamps on two back posts
      for (const s of [-1, 1]) p(B(0.04, 0.5, 0.04), steel, s * (w / 2 - 0.12), 0.37, -0.3);
      p(RB(w - 0.1, 0.07, 0.36, 0.02), TH.accent, 0, 0.64, -0.14);
      for (let i = 0; i < 3; i++) glow(B(0.3, 0.012, 0.08), 0xffd8a8, -0.5 + i * 0.5, 0.6, -0.14);
      // price tags along the front rim
      for (let i = 0; i < 4; i++) p(B(0.12, 0.05, 0.01), i % 2 ? 0xffe066 : 0xffffff, -0.6 + i * 0.4, 0.07, 0.355);
      return done({ glow: { pos: at(0, 0.21, 0), w: w - 0.3, h: 0.5, rx: -Math.PI / 2 } });
    }
  }
  return buildStationTop(ctx, key, b) ? { glow: legacyGlow(key, b) } : null;
}

/** Heat glow for the meal stations built in decor.ts (griddle, roller grill, stock pot). */
function legacyGlow(key: string, b: AABB): StationInfo['glow'] {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, w = b.x1 - b.x0, dp = b.z1 - b.z0;
  switch (key) {
    case 'steak:meal': return { pos: new THREE.Vector3(cx, 0.91 + 0.105, cz), w: w - 0.3, h: dp - 0.3, rx: -Math.PI / 2 };
    case 'cinema:meal': return { pos: new THREE.Vector3(cx, 0.91 + 0.25, cz), w: 0.84, h: 0.44, rx: -Math.PI / 2 };
    case 'hotpot:meal': return { pos: new THREE.Vector3(cx - 0.45, 0.91 + 0.39, cz), w: 0.21, h: 0.22, rx: -Math.PI / 2, circle: true };
  }
  return undefined;
}

/** Glow mesh for a StationInfo glow spot (transparent; the caller animates its opacity). */
export function stationGlowMesh(g: NonNullable<StationInfo['glow']>, color = 0xff922b) {
  const shape = g.circle ? geo(`sgc${g.w}`, () => new THREE.CircleGeometry(g.w, 16)) : new THREE.PlaneGeometry(g.w, g.h);
  const m = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  m.position.copy(g.pos); m.rotation.x = g.rx ?? 0;
  return m;
}

function tinySign(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 80);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 52px sans-serif'; g.fillText(text, 256, 42, 490);
  return c;
}
