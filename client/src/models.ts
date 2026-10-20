// Low-poly "toy" models: shared material/geometry caches, chibi characters, held items and small props.
// Everything is built from a handful of cached geometries and merged per material so it stays cheap on phones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PRODUCT_INFO } from '../../shared/constants.ts';
import { CURRENT_MAP } from '../../shared/map.ts';
import type { CustomerSnap, Held } from '../../shared/protocol.ts';
import type { Quality } from './storage.ts';
import { INK, Label, UI_FONT, roundRect } from './labels.ts';
import { buildKarenProp } from './karen-props.ts';
import { isSig } from '../../shared/sigkarens.ts';

// ---------- canvas text ----------
export { Label, roundRect };
/** Text on a flat rounded panel (wall signs, posters). Uses the UI font (see labels.ts for the font-ready refresh). */
export function textCanvas(lines: { text: string; color?: string; size?: number; bold?: boolean }[], w = 512, h = 128, bg = 'rgba(15,16,26,0.82)', bar?: { v: number; color: string }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  // cartoon panel: thick ink outline like the 2D UI
  if (bg) { g.fillStyle = bg; roundRect(g, 5, 5, w - 10, h - 10, 26); g.fill(); g.lineWidth = 8; g.strokeStyle = INK; roundRect(g, 5, 5, w - 10, h - 10, 26); g.stroke(); }
  const total = lines.reduce((s, l) => s + (l.size ?? 44) * 1.15, 0) + (bar ? 22 : 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    const size = l.size ?? 44;
    g.font = `${l.bold === false ? 600 : 900} ${size}px ${UI_FONT}`;
    g.fillStyle = l.color ?? '#fff'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(l.text, w / 2, y + size * 0.05, w - 24); y += size * 1.15;
  }
  if (bar) {
    g.fillStyle = 'rgba(255,255,255,0.2)'; roundRect(g, 40, y + 4, w - 80, 14, 7); g.fill();
    g.fillStyle = bar.color; roundRect(g, 40, y + 4, Math.max(14, (w - 80) * Math.max(0, Math.min(1, bar.v))), 14, 7); g.fill();
  }
  return c;
}
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

// ---------- shared materials & geometries ----------
type MatOpts = { emissive?: number; rough?: number; metal?: number; transparent?: boolean; opacity?: number };
const matCache = new Map<string, THREE.Material>();
/** Shared materials: identical colour/options reuse one material (fewer state changes, merge-friendly). */
export function mat(color: number, q: Quality, opts: MatOpts = {}): THREE.Material {
  const key = `${q}|${color}|${opts.emissive ?? 0}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.transparent ? 1 : 0}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) { m = makeMat(color, q, opts); matCache.set(key, m); }
  return m;
}
function makeMat(color: number, q: Quality, opts: MatOpts) {
  if (q === 'low') return new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? 0, transparent: opts.transparent, opacity: opts.opacity ?? 1 });
  return new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0, emissive: opts.emissive ?? 0, transparent: opts.transparent, opacity: opts.opacity ?? 1 });
}

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Shared geometries for repeated character/prop parts. */
export function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const basicCache = new Map<number, THREE.MeshBasicMaterial>();
export const basic = (color: number) => { let m = basicCache.get(color); if (!m) { m = new THREE.MeshBasicMaterial({ color }); basicCache.set(color, m); } return m; };
const k3 = (...n: number[]) => n.map(v => v.toFixed(3)).join(',');
export const B = (w: number, h: number, d: number) => geo(`b${k3(w, h, d)}`, () => new THREE.BoxGeometry(w, h, d));
/** Rounded (bevelled) box — the main "toy" building block. */
export const RB = (w: number, h: number, d: number, r = 0.04, seg = 1) => geo(`rb${k3(w, h, d, r)}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
export const SPH = (r: number, ws = 10, hs = 8) => geo(`s${k3(r)}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const CYL = (rt: number, rb: number, h: number, seg = 10, open = false) => geo(`c${k3(rt, rb, h)}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
export const CAP = (r: number, len: number, seg = 8) => geo(`cap${k3(r, len)}|${seg}`, () => new THREE.CapsuleGeometry(r, len, 3, seg));
export const TOR = (r: number, t: number, rs = 5, ts = 14, arc = Math.PI * 2) => geo(`t${k3(r, t, arc)}|${rs}|${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
export const CONE = (r: number, h: number, seg = 6) => geo(`cone${k3(r, h)}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
/** Partial sphere (caps, hair, hoods). */
export const DOME = (r: number, theta: number, ws = 14, hs = 6) => geo(`d${k3(r, theta)}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, theta));

/** Adds a mesh to a parent at a position (and optional rotation / scale). */
export function put(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.scale.set(sx, sy, sz);
  parent.add(mesh); return mesh;
}

/**
 * Merge all meshes below `root` (except `skip` subtrees) into one mesh per material, parented to `root`.
 * Transparent / non-indexed parts are handled too. Cuts draw calls for multi-part props and characters.
 */
export function mergeInto(root: THREE.Object3D, skip: Set<THREE.Object3D> = new Set(), shadow = true) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const parts: THREE.Mesh[] = [];
  const m4 = new THREE.Matrix4();
  const collect = (o: THREE.Object3D) => {
    for (const c of [...o.children]) {
      if (skip.has(c)) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && !(m as THREE.InstancedMesh).isInstancedMesh) {
        const g = m.geometry.clone().applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
        // (already-merged vertex-coloured parts keep their colours)
        const keep = (m.material as THREE.Material).vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
        for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        // plain coloured materials collapse into one shared vertex-coloured material (one draw call for many colours)
        let key = m.material as THREE.Material;
        const vc = vertexColorMat(key);
        if (vc) { paint(g, (key as THREE.MeshBasicMaterial).color); key = vc; }
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(g);
        parts.push(m);
      }
      collect(c);
    }
  };
  collect(root);
  for (const p of parts) p.parent?.remove(p);
  for (const [m, raw] of groups) {
    // mergeGeometries needs all-indexed or all-non-indexed parts
    const list = raw.some(g => !g.index) ? raw.map(g => g.index ? g.toNonIndexed() : g) : raw;
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = shadow; mesh.receiveShadow = shadow; root.add(mesh);
  }
}

/** Bakes a flat colour into a geometry's vertex colours. */
export function paint(g: THREE.BufferGeometry, col: THREE.Color) {
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
const vcCache = new Map<string, THREE.Material>();
/** The shared vertex-colour twin of a plain (untextured, opaque, non-emissive) material, or null. */
export function vertexColorMat(m: THREE.Material): THREE.Material | null {
  if (m.transparent || (m as THREE.MeshBasicMaterial).map || m.vertexColors) return null;
  let key: string, make: () => THREE.Material;
  if (m instanceof THREE.MeshBasicMaterial) { key = 'basic'; make = () => new THREE.MeshBasicMaterial({ vertexColors: true }); }
  else if (m instanceof THREE.MeshLambertMaterial) {
    if (m.emissive.getHex()) return null;
    key = 'lambert'; make = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  } else if (m instanceof THREE.MeshStandardMaterial) {
    if (m.emissive.getHex()) return null;
    const r = Math.round(m.roughness * 10) / 10, mt = Math.round(m.metalness * 10) / 10;
    key = `std${r}|${mt}`; make = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: mt });
  } else return null;
  let v = vcCache.get(key);
  if (!v) { v = make(); vcCache.set(key, v); }
  return v;
}

// ---------- characters (chibi) ----------
export const SKIN = [0xf8cfa4, 0xefb98a, 0xd99a6c, 0xa86b45, 0xffe0c4];
export const HAIR = [0x3b2516, 0x5a3a24, 0x1e1e24, 0xa5793f, 0xc9c9c9, 0x8a3b1c];
export const SHIRT = [0x5c7cfa, 0x94d82d, 0xf783ac, 0x20c997, 0xadb5bd, 0xffa94d, 0x845ef7, 0x868e96];

export type Pose = 'normal' | 'angry' | 'flail' | 'pay' | 'film' | 'sit' | 'sitAngry' | 'dazed';
export interface Look {
  shirt: number; pants: number; skin: number; hair: number; hairStyle: number; scale?: number; apron?: boolean;
  build?: number; height?: number; accessory?: number; vip?: boolean;
}

/** Chibi proportions: a big round head (~40 % of the height) on a short pear-shaped body. */
export const HEAD_R = 0.31, HEAD_Y = 1.3, HIP_Y = 0.42, SHOULDER_Y = 0.93;
/** Group y offset that puts a sitting character's bottom on the floor. */
export const SIT_Y = -0.3;
/** Overhead name label / status icon heights (group space). */
export const LABEL_Y = 1.98, ICON_Y = 2.28;
/** z of the head surface at (x, y) in head space (front side). */
const onHead = (x: number, y: number, r = HEAD_R) => Math.sqrt(Math.max(0, r * r - x * x - y * y));

export class Human {
  group = new THREE.Group();
  body: THREE.Mesh; head: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D;
  hand: THREE.Group;
  /** Name tag (staff) and status / karen tag (customers); both shrink when close and fade right in front of the camera. */
  label = new Label({ k: 0.0026, maxScreen: 0.055, minScreen: 0.04, fade: [0.9, 1.9], fadeMin: 0.15 }); icon = new Label({ k: 0.0026, maxScreen: 0.065, minScreen: 0.042, fade: [0.9, 2.1], fadeMin: 0.15 });
  phase = 0; heldKey = ''; private t = Math.random() * 10;
  private face: THREE.Mesh; private faceKey = ''; private basket: THREE.Object3D | null = null;
  private torso: THREE.Object3D = new THREE.Group();
  constructor(q: Quality, opts: Look) {
    const g = this.group;
    const lo = q === 'low';
    const seg = lo ? 8 : 12;
    const skinM = mat(opts.skin, q), shirtM = mat(opts.shirt, q), pantsM = mat(opts.pants, q), hairM = mat(opts.hair, q);
    const shoeM = mat(opts.apron ? 0x343a40 : [0x343a40, 0xf8f9fa, 0x862e9c, 0xc92a2a][(opts.shirt >> 5) % 4], q);
    const soleM = mat(0xf1f3f5, q);
    const w = opts.build ?? 1, zs = 0.78 * Math.sqrt(w), lw = Math.sqrt(w);
    // legs: stubby capsules + chunky shoes with a white sole
    const leg = (x: number) => {
      const lg = new THREE.Group(); lg.position.set(x * Math.min(w, 1.4), HIP_Y, 0);
      put(lg, CAP(0.085, 0.16, seg), pantsM, 0, -0.15, 0, 0, 0, 0, lw, 1, lw).castShadow = true;
      put(lg, RB(0.17, 0.1, 0.25, 0.045), shoeM, 0, -0.35, 0.035, 0, 0, 0, lw, 1, 1);
      put(lg, lo ? B(0.18, 0.035, 0.26) : RB(0.18, 0.035, 0.26, 0.015), soleM, 0, -0.405, 0.035, 0, 0, 0, lw, 1, 1);
      g.add(lg); return lg;
    };
    this.legL = leg(-0.1); this.legR = leg(0.1);
    g.add(this.torso);
    // pear-shaped body: shirt, rounded shoulders, pants/hips
    this.body = put(this.torso, CYL(0.19, 0.245, 0.5, seg), shirtM, 0, 0.79, 0, 0, 0, 0, w, 1, zs);
    put(this.torso, DOME(0.19, Math.PI / 2, seg, 4), shirtM, 0, 1.04, 0, 0, 0, 0, w, 0.5, zs);
    put(this.torso, CYL(0.24, 0.23, 0.2, seg), pantsM, 0, 0.47, 0, 0, 0, 0, w, 1, zs);
    // collar
    put(this.torso, TOR(0.1, 0.03, 4, 12), shirtM, 0, 1.11, 0, Math.PI / 2, 0, 0, 1, zs / 0.78, 1);
    const front = (y: number) => (0.245 - (y - 0.54) * 0.11) * zs; // body surface z at height y
    if (opts.apron) {
      const apM = mat(CURRENT_MAP.theme.wainscot, q);
      put(this.torso, RB(0.36 * w, 0.5, 0.035, 0.015), apM, 0, 0.72, front(0.72) + 0.012, -0.1);
      put(this.torso, RB(0.2 * w, 0.1, 0.02, 0.01), apM, 0, 0.67, front(0.67) + 0.036, -0.1); // pocket
      for (const x of [-0.12, 0.12]) put(this.torso, B(0.035, 0.24, 0.02), apM, x * w, 1.0, front(1.0) - 0.01, -0.35); // straps
      put(this.torso, RB(0.11, 0.06, 0.015, 0.008), basic(0xffffff), 0.09 * w, 0.92, front(0.92) + 0.03, -0.1); // name badge
      put(this.torso, B(0.06, 0.012, 0.016), basic(0xff6b6b), 0.09 * w, 0.93, front(0.92) + 0.036, -0.1);
    } else if (!opts.vip) {
      // a little chest emblem so plain shirts read as clothing
      put(this.torso, CYL(0.045, 0.045, 0.012, 10), basic(0xffffff), 0.08 * w, 0.92, front(0.92) + 0.004, Math.PI / 2 - 0.1);
    }
    if (opts.vip) {
      // dark suit jacket left open at the front (the karen's colour shows as the shirt), red tie
      const suit = mat(0x1b1f3b, q);
      put(this.torso, geo('vest' + seg, () => new THREE.CylinderGeometry(0.2, 0.255, 0.5, seg, 1, true, 0.55, Math.PI * 2 - 1.1)), suit, 0, 0.79, 0, 0, 0, 0, w, 1, zs);
      put(this.torso, DOME(0.2, Math.PI / 2, seg, 4), suit, 0, 1.04, -0.01, 0, 0, 0, w, 0.5, zs * 0.9);
      put(this.torso, B(0.055, 0.26, 0.02), mat(0xc92a2a, q), 0, 0.88, front(0.88) + 0.008, -0.1);
      put(this.torso, B(0.07, 0.05, 0.03), mat(0xc92a2a, q), 0, 1.02, front(1.0) + 0.0, -0.2);
    }
    const arm = (x: number) => {
      const ag = new THREE.Group(); ag.position.set(x * (0.17 * w + 0.07), SHOULDER_Y, 0);
      put(ag, CAP(0.068, 0.17, seg), shirtM, 0, -0.14, 0).castShadow = true;
      put(ag, SPH(0.078, seg, 6), skinM, 0, -0.32, 0);
      this.torso.add(ag); return ag;
    };
    this.armL = arm(-1); this.armR = arm(1);
    if (opts.vip) put(this.armL, CYL(0.075, 0.075, 0.05, 10), mat(0xfcc419, q, { metal: 0.8, rough: 0.25 }), 0, -0.25, 0); // gold watch
    // head
    this.head = put(this.torso, SPH(HEAD_R, lo ? 12 : 18, lo ? 9 : 13), skinM, 0, HEAD_Y, 0);
    this.head.castShadow = true;
    const H = this.head;
    const es = lo ? 6 : 8, eh = lo ? 4 : 6; // small spheres: fewer segments on 'low'
    for (const s of [-1, 1]) put(H, SPH(0.06, es, eh), skinM, s * (HEAD_R - 0.01), -0.03, 0, 0, 0, 0, 0.6, 1, 1); // ears
    const dark = basic(0x2b2230), white = basic(0xffffff);
    const eyeX = 0.115, eyeY = -0.02;
    for (const s of [-1, 1]) {
      const x = s * eyeX;
      put(H, SPH(0.046, es, eh), dark, x, eyeY, onHead(x, eyeY) - 0.012, 0, 0, 0, 0.8, 1.1, 0.5);
      put(H, SPH(0.014, 6, 4), white, x + 0.014, eyeY + 0.02, onHead(x, eyeY) + 0.008);
      put(H, SPH(0.05, es, eh), basic(0xff9eaa), s * 0.19, -0.085, onHead(s * 0.19, -0.085) - 0.018, 0, s * 0.5, 0, 1.1, 0.55, 0.35); // blush
    }
    // hair
    const hs = opts.hairStyle;
    if (hs !== 2) {
      // a cap of hair tilted back to show the forehead, plus a fringe of tufts
      put(H, DOME(HEAD_R * 1.07, Math.PI * (hs === 1 ? 0.55 : 0.48), lo ? 10 : 14, 5), hairM, 0, 0.0, -0.01, -0.42);
      const tufts = hs === 5 ? [] : [[-0.15, 0.17], [-0.05, 0.2], [0.06, 0.2], [0.16, 0.16]];
      for (const [x, y] of tufts) put(H, SPH(0.075, 7, 5), hairM, x, y, onHead(x, y) - 0.035, 0, 0, x * -2, 1.2, 0.85, 0.7);
      if (hs === 1) { // long hair: back curtain + side locks
        put(H, RB(0.56, 0.46, 0.2, 0.09), hairM, 0, -0.16, -0.14);
        for (const s of [-1, 1]) put(H, CAP(0.06, 0.24, 6), hairM, s * 0.28, -0.17, 0.06);
      }
      if (hs === 3) { put(H, SPH(0.12, 8, 6), hairM, 0, 0.28, -0.17); put(H, TOR(0.06, 0.02, 4, 10), basic(0xff8787), 0, 0.21, -0.12, -0.8); }
      if (hs === 4) for (const s of [-1, 1]) { put(H, SPH(0.1, 8, 6), hairM, s * 0.33, -0.02, -0.08, 0, 0, 0, 0.9, 1.4, 0.9); put(H, SPH(0.035, 6, 4), basic(0xffd43b), s * 0.3, 0.1, -0.08); }
      if (hs === 5) for (let i = 0; i < 4; i++) put(H, CONE(0.07, 0.2, 6), hairM, 0, 0.3 - Math.abs(i - 1.5) * 0.02, 0.15 - i * 0.11, -0.3 + i * 0.2); // spiky crest
    }
    // accessories
    const acc = opts.accessory ?? 0;
    if (acc === 1) { // round glasses
      const rim = basic(0x343a40);
      for (const s of [-1, 1]) put(H, TOR(0.06, 0.01, 4, 14), rim, s * eyeX, eyeY, onHead(eyeX, eyeY) + 0.02);
      put(H, B(0.06, 0.012, 0.012), rim, 0, eyeY + 0.01, onHead(0, eyeY) + 0.02);
    } else if (acc === 2) { // baseball cap
      const cm = mat([0x1c7ed6, 0xe03131, 0x2b8a3e, 0x212529][(opts.shirt >> 4) % 4], q);
      put(H, DOME(HEAD_R * 1.1, Math.PI * 0.42, 12, 4), cm, 0, 0.03, 0, -0.12);
      put(H, RB(0.34, 0.03, 0.2, 0.012), cm, 0, 0.15, HEAD_R + 0.02, 0.18);
      put(H, SPH(0.03, 6, 4), cm, 0, HEAD_R * 1.1 + 0.02, -0.04);
    } else if (acc === 3) { // beanie with pompom
      const bm = mat([0xf76707, 0x5c940d, 0x862e9c][(opts.shirt >> 3) % 3], q);
      put(H, DOME(HEAD_R * 1.1, Math.PI * 0.45, 12, 5), bm, 0, 0.05, -0.01, -0.15, 0, 0, 1, 1.12, 1);
      put(H, CYL(HEAD_R * 1.11, HEAD_R * 1.13, 0.07, 14, true), mat(0xf8f9fa, q), 0, 0.06, -0.01, -0.15);
      put(H, SPH(0.075, 7, 5), mat(0xf8f9fa, q), 0, HEAD_R * 1.25, -0.08);
    } else if (acc === 4) { // backpack
      const bpM = mat([0x364fc7, 0x495057, 0xc2255c][(opts.shirt >> 2) % 3], q);
      put(this.torso, RB(0.34 * w, 0.4, 0.16, 0.06), bpM, 0, 0.8, -0.22 * zs / 0.78 - 0.04);
      put(this.torso, RB(0.24 * w, 0.14, 0.06, 0.03), bpM, 0, 0.7, -0.22 * zs / 0.78 - 0.13);
    } else if (acc === 5) { // headphones
      const hm = mat(0x212529, q);
      put(H, TOR(HEAD_R + 0.04, 0.02, 4, 16, Math.PI), hm, 0, 0.0, 0);
      for (const s of [-1, 1]) put(H, CYL(0.075, 0.075, 0.07, 10), mat(0xff6b6b, q), s * (HEAD_R + 0.02), -0.01, 0, 0, 0, Math.PI / 2);
    }
    if (opts.apron) staffHat(q, H);
    this.skinStaticParts(q);
    // brows + mouth: one mesh whose (shared, cached) geometry is swapped per expression
    this.face = new THREE.Mesh(faceGeo('0|0|1|1'), vertexColorMat(basic(0))!);
    this.face.position.set(0, HEAD_Y, 0); this.torso.add(this.face);
    this.hand = new THREE.Group(); this.hand.position.set(0, 0.78, 0.36); this.hand.scale.setScalar(0.85); g.add(this.hand);
    this.label.sprite.position.y = LABEL_Y; g.add(this.label.sprite);
    this.icon.sprite.position.y = ICON_Y; g.add(this.icon.sprite);
    const sc = (opts.scale ?? 1) * (opts.height ?? 1);
    if (sc !== 1) g.scale.set(opts.scale ?? 1, sc, opts.scale ?? 1);
  }
  /**
   * Bake the whole body (torso, head, hair, hat/accessories, arms, legs) into ONE skinned mesh with five bones
   * (torso, two legs, two arms) and one shared vertex-coloured material, so a character costs one draw call for its
   * body instead of five or more. The bones take over the old part groups (same positions), so animate() is unchanged.
   * Only the face (its geometry is swapped per expression), held items and karen props stay separate meshes.
   */
  private skinStaticParts(q: Quality) {
    const g = this.group;
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), m4 = new THREE.Matrix4();
    const parts: THREE.BufferGeometry[] = [], dead: THREE.Mesh[] = [];
    const collect = (root: THREE.Object3D, bone: number, skip: THREE.Object3D[] = []) => {
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material)) return;
        for (let p: THREE.Object3D | null = m; p && p !== root; p = p.parent) if (skip.includes(p)) return;
        const c = m.geometry.clone().applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
        for (const k of Object.keys(c.attributes)) if (!['position', 'normal'].includes(k)) c.deleteAttribute(k);
        const nc = c.index ? c.toNonIndexed() : c;
        paint(nc, (m.material as THREE.MeshBasicMaterial).color);
        const n = nc.attributes.position.count;
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
        nc.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        nc.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        parts.push(nc); dead.push(m);
      });
    };
    collect(this.torso, 0, [this.armL, this.armR]);
    collect(this.legL, 1); collect(this.legR, 2); collect(this.armL, 3); collect(this.armR, 4);
    for (const m of dead) m.parent?.remove(m);
    // bones replace the part groups at the same spots
    const bone = (from: THREE.Object3D, parent: THREE.Object3D) => {
      const b = new THREE.Bone(); b.position.copy(from.position); b.rotation.copy(from.rotation);
      from.parent?.remove(from); parent.add(b); return b;
    };
    const headPos = this.head.position.clone();
    const torso = bone(this.torso, g);
    this.legL = bone(this.legL, g); this.legR = bone(this.legR, g);
    this.armL = bone(this.armL, torso); this.armR = bone(this.armR, torso);
    this.torso = torso;
    g.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([torso as THREE.Bone, this.legL as THREE.Bone, this.legR as THREE.Bone, this.armL as THREE.Bone, this.armR as THREE.Bone]);
    const body = new THREE.SkinnedMesh(mergeGeometries(parts, false)!, skinMat(q));
    body.castShadow = false; body.receiveShadow = false;
    g.add(body); g.updateMatrixWorld(true);
    body.bind(skeleton, body.matrixWorld);
    this.body = body;
    // empty anchor at the head centre for accessories added later (karen marks, hats…)
    this.head = new THREE.Object3D(); this.head.position.copy(headPos); torso.add(this.head);
  }

  /** Shopping basket in the left hand while the customer carries items. */
  setBasket(q: Quality, on: boolean) {
    if (on === !!this.basket) return;
    if (!on) { this.armL.remove(this.basket!); this.basket = null; return; }
    const b = new THREE.Group();
    put(b, RB(0.28, 0.15, 0.2, 0.03), mat(0xe03131, q), 0, -0.46, 0.02);
    put(b, TOR(0.1, 0.012, 4, 10, Math.PI), mat(0xe03131, q), 0, -0.39, 0.02);
    put(b, RB(0.1, 0.08, 0.1, 0.02), mat(0x74c0fc, q), -0.05, -0.36, 0.02);
    put(b, CYL(0.035, 0.035, 0.12, 8), mat(0xffd43b, q), 0.07, -0.35, 0.02);
    mergeInto(b, new Set(), false);
    this.armL.add(b); this.basket = b;
  }
  animate(dt: number, moving: boolean, speed = 1, pose: Pose = 'normal') {
    this.t += dt;
    if (moving) this.phase += dt * 11 * speed; else this.phase *= 0.85;
    const s = Math.sin(this.phase) * (moving ? 0.7 : 0);
    this.legL.rotation.x = s; this.legR.rotation.x = -s; this.legL.rotation.z = 0; this.legR.rotation.z = 0;
    const breathe = Math.sin(this.t * 2.2) * 0.012;
    // toy-like bounce while walking, a little waddle side to side
    this.torso.position.y = Math.abs(Math.sin(this.phase)) * (moving ? 0.05 : 0) + breathe;
    this.torso.rotation.z = moving ? Math.sin(this.phase) * 0.06 : 0;
    this.armL.rotation.z = -0.12; this.armR.rotation.z = 0.12;
    // expression: brow tilt (left, right) and mouth stretch (x, y)
    let face: Face = [0, 0, 1, 1];
    if (this.heldKey) { this.armL.rotation.x = -1.2; this.armR.rotation.x = -1.2; this.setFace(face); return; }
    switch (pose) {
      case 'angry': { // stomping, arms shaking in the air
        const sh = Math.sin(this.t * 22) * 0.25;
        this.armL.rotation.x = -2.6 + sh; this.armR.rotation.x = -2.6 - sh; this.armL.rotation.z = -0.3; this.armR.rotation.z = 0.3;
        this.torso.rotation.z = Math.sin(this.t * 14) * 0.05;
        face = [-0.5, 0.5, 0.7, 3.5];
        if (!moving) { this.legL.rotation.x = Math.max(0, Math.sin(this.t * 10)) * 0.4; }
        break;
      }
      case 'flail': {
        this.armL.rotation.x = -1.6 + Math.sin(this.t * 25) * 0.6; this.armR.rotation.x = -1.6 + Math.cos(this.t * 25) * 0.6;
        this.armL.rotation.z = -0.9; this.armR.rotation.z = 0.9;
        this.legL.rotation.x = Math.sin(this.t * 30) * 0.8; this.legR.rotation.x = -Math.sin(this.t * 30) * 0.8;
        face = [0.4, -0.4, 1.2, 4];
        break;
      }
      case 'pay': this.armR.rotation.x = -1.3 + Math.sin(this.t * 3) * 0.08; this.armL.rotation.x = -s * 0.8; face = [0, 0, 1.3, 1.6]; break;
      case 'dazed': // flat on the pavement, limbs out, swirly-eyed
        this.armL.rotation.z = -1.2 + Math.sin(this.t * 3) * 0.1; this.armR.rotation.z = 1.2 - Math.sin(this.t * 3) * 0.1;
        this.legL.rotation.z = -0.25; this.legR.rotation.z = 0.25; face = [0.5, -0.5, 1.3, 2.2]; break;
      case 'sitAngry': // just got unplugged: legs out, shaking a fist at you
        this.legL.rotation.x = -1.45; this.legR.rotation.x = -1.4; this.armR.rotation.x = -2.4 + Math.sin(this.t * 18) * 0.3; this.armL.rotation.x = -0.9;
        face = [-0.5, 0.5, 0.8, 3]; break;
      case 'sit': // on the floor, legs out, staring at the phone
        this.legL.rotation.x = -1.45; this.legR.rotation.x = -1.4; this.armR.rotation.x = -1.1; this.armL.rotation.x = -0.9; this.armL.rotation.z = 0.25;
        face = [0.15, -0.15, 1.1, 0.8]; break;
      case 'film': this.armR.rotation.x = -1.9; this.armL.rotation.x = -s * 0.6; face = [0, 0, 1.4, 2.5]; break;
      default: this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8 + (moving ? 0 : Math.sin(this.t * 1.3) * 0.04);
    }
    this.setFace(face);
  }
  private setFace(f: Face) {
    const key = f.join('|');
    if (key === this.faceKey) return;
    this.faceKey = key; this.face.geometry = faceGeo(key);
  }
  setHeld(q: Quality, held: Held | null) {
    const key = held ? (held.kind === 'box' ? 'box' + held.product : held.kind) : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.hand.clear();
    if (held) this.hand.add(heldModel(q, held));
  }
}

const skinMats = new Map<Quality, THREE.Material>();
/** The one vertex-coloured material every character body shares. */
function skinMat(q: Quality) {
  let m = skinMats.get(q);
  // its own instance (not the static props' vertex-colour material): skinned and static meshes need different shader programs
  if (!m) { m = q === 'low' ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }); skinMats.set(q, m); }
  return m;
}

type Face = [number, number, number, number];
const EYE_X = 0.115;
/** Brows + mouth for an expression "browL|browR|mouthX|mouthY", in torso space relative to the head centre. Shared by everyone. */
function faceGeo(key: string) {
  return geo('face' + key, () => {
    const [bl, br, mx, my] = key.split('|').map(Number);
    const dark = new THREE.Color(0x2b2230), lip = new THREE.Color(0x8c2f39);
    const part = (g: THREE.BufferGeometry, col: THREE.Color, m: THREE.Matrix4) => {
      const c = g.clone().applyMatrix4(m);
      for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
      paint(c, col); return c.index ? c.toNonIndexed() : c;
    };
    const m4 = (x: number, y: number, z: number, rz: number, sx = 1, sy = 1) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, 1));
    const brow = RB(0.075, 0.02, 0.02, 0.008), mouth = geo('mouth', () => new THREE.SphereGeometry(0.036, 8, 6).scale(1.2, 0.38, 0.5));
    return mergeGeometries([
      part(brow, dark, m4(-EYE_X, 0.075, onHead(EYE_X, 0.075) + 0.004, bl)),
      part(brow, dark, m4(EYE_X, 0.075, onHead(EYE_X, 0.075) + 0.004, br)),
      part(mouth, lip, m4(0, -0.13, onHead(0, -0.13) - 0.002, 0, mx, my)),
    ], false)!;
  });
}

/** Work hat for staff, in the map's colours: a different style per shop. Built in head space (merged with the head). */
function staffHat(q: Quality, H: THREE.Object3D) {
  const TH = CURRENT_MAP.theme, R = HEAD_R;
  const acc = mat(TH.accent, q), wain = mat(TH.wainscot, q), white = mat(0xffffff, q);
  switch (CURRENT_MAP.id) {
    case 'breakfast': { // puffy little chef's toque with an accent band
      put(H, CYL(R * 0.82, R * 0.86, 0.11, 14), white, 0, R * 0.78, -0.03, -0.22);
      put(H, CYL(R * 0.87, R * 0.87, 0.045, 14), acc, 0, R * 0.7, -0.01, -0.22);
      for (const [x, z, r] of [[0, -0.07, 0.17], [-0.12, -0.02, 0.13], [0.12, -0.02, 0.13], [0, 0.07, 0.13]]) put(H, SPH(r, 10, 8), white, x, R * 1.1 + 0.02, z - 0.04, 0, 0, 0, 1, 0.8, 1);
      break;
    }
    case 'boba': { // sun visor: a band round the head + a wide brim, logo dot
      put(H, CYL(R * 1.07, R * 1.07, 0.08, 16, true), acc, 0, R * 0.55, -0.02, -0.18);
      put(H, geo('visorBrim', () => new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14, 1, false, -1.2, 2.4).scale(1.3, 1, 1)), acc, 0, R * 0.52, R * 0.95, 0.12);
      put(H, CYL(0.045, 0.045, 0.012, 10), mat(0xffffff, q), 0, R * 0.62, R * 1.02, Math.PI / 2 - 0.2);
      break;
    }
    case 'clothing': { // slouchy beret with a stalk
      put(H, SPH(R * 1.12, 14, 8), acc, 0.05, R * 0.75, -0.04, -0.15, 0, -0.18, 1.05, 0.38, 1.05);
      put(H, CYL(0.018, 0.022, 0.05, 6), acc, 0.05, R * 1.2, -0.04, 0, 0, -0.2);
      break;
    }
    case 'chicken': { // fast-food paper garrison cap with a stripe
      put(H, geo('garrison', () => new THREE.CylinderGeometry(0.0, R * 0.95, 0.2, 4, 1).rotateY(Math.PI / 4).scale(0.7, 1, 1.25)), wain, 0, R * 0.92, -0.02, -0.12);
      put(H, CYL(R * 1.02, R * 1.03, 0.07, 14, true), wain, 0, R * 0.64, -0.02, -0.15);
      put(H, CYL(R * 1.04, R * 1.04, 0.025, 14, true), mat(TH.accent, q), 0, R * 0.66, -0.02, -0.15);
      break;
    }
    case 'drugstore': { // beauty-counter headband with a big bow
      put(H, TOR(R * 1.03, 0.028, 4, 14, Math.PI), acc, 0, 0.02, -0.04, -0.35);
      const bx = -0.17, by = R * 0.86;
      for (const s of [-1, 1]) put(H, CONE(0.06, 0.13, 5), mat(0xf783ac, q), bx + s * 0.065, by, 0.02, 0, 0, s * Math.PI / 2);
      put(H, SPH(0.035, 6, 4), acc, bx, by, 0.02);
      break;
    }
    case 'bookstore': { // reader's beret + a pencil tucked behind the ear
      put(H, SPH(R * 1.1, 12, 6), wain, -0.04, R * 0.78, -0.05, -0.2, 0, 0.16, 1.05, 0.34, 1.05);
      put(H, CYL(0.016, 0.02, 0.05, 5), acc, -0.04, R * 1.18, -0.05, 0, 0, 0.2);
      put(H, CYL(0.014, 0.014, 0.17, 6), mat(0xfcc419, q), R * 0.98, 0.1, 0.0, 0.25, 0, 0.55);
      put(H, CONE(0.014, 0.035, 6), mat(0xf1c27d, q), R * 0.98 + 0.04, 0.03, 0.025, 0.25, 0, 0.55 + Math.PI);
      break;
    }
    case 'bakery': { // tall puffy baker's hat with a brown band
      put(H, CYL(R * 0.84, R * 0.88, 0.16, 12), white, 0, R * 0.86, -0.04, -0.18);
      put(H, CYL(R * 0.89, R * 0.89, 0.05, 12), acc, 0, R * 0.74, -0.025, -0.18);
      put(H, SPH(R * 1.12, 12, 7), white, 0, R * 1.3, -0.1, -0.18, 0, 0, 1, 0.62, 1);
      break;
    }
    case 'supermarket': { // red visor, blue band, a little price-tag badge
      put(H, CYL(R * 1.07, R * 1.07, 0.07, 14, true), mat(TH.wainscot, q), 0, R * 0.55, -0.02, -0.18);
      put(H, geo('visorBrim', () => new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14, 1, false, -1.2, 2.4).scale(1.3, 1, 1)), acc, 0, R * 0.52, R * 0.95, 0.12);
      put(H, RB(0.1, 0.06, 0.015, 0.01), mat(0xffe066, q), 0.1, R * 0.6, R * 0.98, -0.2, 0.35, 0.25);
      break;
    }
    case 'petshop': { // cap with floppy dog ears and a paw print
      put(H, DOME(R * 1.1, Math.PI * 0.42, 12, 4), acc, 0, 0.03, 0, -0.12);
      put(H, RB(0.32, 0.03, 0.19, 0.012), acc, 0, 0.15, R + 0.02, 0.18);
      for (const s of [-1, 1]) put(H, CAP(0.055, 0.13, 6), mat(0x8d5524, q), s * R * 0.92, R * 0.55, -0.03, 0, 0, s * 0.5);
      put(H, CYL(0.045, 0.045, 0.01, 8), white, 0, R * 0.8, R * 0.72, Math.PI / 2 - 0.75);
      for (const t of [-1, 0, 1]) put(H, CYL(0.017, 0.017, 0.01, 6), white, t * 0.045, R * 0.8 + 0.06 - Math.abs(t) * 0.015, R * 0.72 - 0.045, Math.PI / 2 - 0.75);
      break;
    }
    case 'cafe': { // barista knit beanie (no pompom) with a turned-up cuff and a bean patch
      put(H, DOME(R * 1.1, Math.PI * 0.45, 12, 5), mat(0x5c3d2e, q), 0, 0.05, -0.02, -0.25, 0, 0, 1, 1.05, 1);
      put(H, CYL(R * 1.12, R * 1.14, 0.08, 14, true), acc, 0, 0.07, -0.02, -0.25);
      put(H, SPH(0.035, 6, 4), mat(0xc08552, q), 0.13, 0.1, R * 1.0, 0, 0, 0.5, 1, 0.7, 0.5);
      break;
    }
    case 'cinema': { // striped popcorn-box paper hat with popcorn on top
      put(H, CYL(R * 0.95, R * 0.7, 0.16, 8), white, 0, R * 0.95, -0.03, -0.15);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 8; put(H, B(0.06, 0.162, 0.02), mat(0xe03131, q), Math.sin(a) * R * 0.83, R * 0.95, -0.03 + Math.cos(a) * R * 0.83, -0.15, a, 0); }
      for (const [x, z] of [[0, 0], [-0.08, -0.06], [0.08, -0.04], [0.02, 0.08], [-0.06, 0.06]]) put(H, SPH(0.055, 6, 4), mat(0xfff3bf, q), x, R * 1.25, z - 0.06);
      break;
    }
    case 'hotpot': { // red bandana tied at the back, white polka dots
      put(H, DOME(R * 1.13, Math.PI * 0.46, 12, 4), wain, 0, 0.02, -0.02, -0.18);
      for (const [x, y] of [[-0.12, 0.2], [0.1, 0.22], [0, 0.29], [0.2, 0.12], [-0.21, 0.1]]) put(H, SPH(0.022, 5, 3), white, x, y, onHead(x, y, R * 1.13) - 0.03);
      for (const s of [-1, 1]) put(H, CONE(0.05, 0.14, 4), wain, s * 0.06, 0.02, -R - 0.03, -0.6, 0, s * 0.6);
      break;
    }
    case 'gas': { // mesh-back trucker cap with a round oil-drop logo patch
      put(H, DOME(R * 1.1, Math.PI * 0.42, 12, 4), wain, 0, 0.03, 0, -0.12);
      put(H, RB(0.34, 0.03, 0.21, 0.012), acc, 0, 0.15, R + 0.02, 0.18);
      put(H, CYL(0.07, 0.07, 0.012, 10), acc, 0, R * 0.78, R * 0.74, Math.PI / 2 - 0.75);
      put(H, CONE(0.03, 0.06, 6), mat(0xe03131, q), 0, R * 0.8, R * 0.76, -0.75);
      break;
    }
    case 'gym': { // terry sweatband round the forehead
      put(H, CYL(R * 1.05, R * 1.06, 0.075, 16, true), acc, 0, 0.12, -0.01, -0.25);
      put(H, CYL(R * 1.065, R * 1.065, 0.018, 16, true), white, 0, 0.12, -0.01, -0.25);
      put(H, CYL(0.035, 0.035, 0.01, 8), white, 0.1, 0.13, R * 1.0, Math.PI / 2 - 0.25, 0, 0, 1, 1, 1);
      break;
    }
    case 'steak': { // tall pleated chef's toque with a coloured band
      put(H, CYL(R * 0.8, R * 0.86, 0.32, 10), white, 0, R * 1.08, -0.05, -0.15);
      put(H, CYL(R * 0.87, R * 0.87, 0.05, 10), wain, 0, R * 0.68, -0.02, -0.15);
      put(H, SPH(R * 0.9, 10, 6), white, 0, R * 1.62, -0.13, -0.15, 0, 0, 1, 0.45, 1);
      break;
    }
    case 'electronics': { // service headset: band, one ear cup, mic boom; blue polo-cap colours
      put(H, TOR(R + 0.03, 0.018, 4, 14, Math.PI), mat(0x343a40, q), 0, 0.0, -0.02, -0.15);
      put(H, CYL(0.08, 0.08, 0.06, 10), acc, R + 0.02, -0.02, 0, 0, 0, Math.PI / 2);
      put(H, CYL(0.012, 0.012, 0.22, 5), mat(0x343a40, q), R * 0.75, -0.14, 0.17, 1.2, 0, -0.35);
      put(H, SPH(0.03, 6, 4), mat(0x212529, q), R * 0.42, -0.19, R * 0.95);
      break;
    }
    case 'salon': { // wide hair wrap with a knotted bow on top
      put(H, CYL(R * 1.05, R * 1.07, 0.1, 14, true), acc, 0, 0.1, -0.02, -0.35);
      put(H, SPH(0.05, 6, 4), acc, 0, R * 0.97, 0.06);
      for (const s of [-1, 1]) put(H, SPH(0.07, 6, 4), mat(0xb197fc, q), s * 0.08, R * 1.02, 0.05, 0, 0, s * 0.5, 1.2, 0.6, 0.7);
      break;
    }
    case 'post': { // postman's peaked cap: flat green crown, black peak, gold badge
      put(H, CYL(R * 1.06, R * 0.95, 0.12, 14), acc, 0, R * 0.8, -0.03, -0.12);
      put(H, CYL(R * 1.07, R * 1.07, 0.03, 14), mat(0x1b4d2b, q), 0, R * 0.7, -0.02, -0.12);
      put(H, geo('visorBrim', () => new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14, 1, false, -1.2, 2.4).scale(1.3, 1, 1)), mat(0x212529, q), 0, R * 0.62, R * 0.9, 0.2);
      put(H, CYL(0.03, 0.03, 0.012, 8), mat(0xfcc419, q, { metal: 0.6, rough: 0.3 }), 0, R * 0.82, R * 0.98, Math.PI / 2 - 0.12);
      break;
    }
    case 'pharmacy': { // little folded nurse-style cap with a teal cross
      put(H, geo('nurseCap', () => new THREE.CylinderGeometry(0.15, 0.2, 0.12, 4, 1).rotateY(Math.PI / 4).scale(1.3, 1, 0.6)), white, 0, R * 0.98, 0.0, -0.3);
      put(H, B(0.08, 0.025, 0.012), acc, 0, R * 1.0, 0.11, -0.3);
      put(H, B(0.025, 0.08, 0.012), acc, 0, R * 1.0, 0.11, -0.3);
      break;
    }
    case 'hotel': { // bellboy pillbox cap with a gold band and chin strap, worn at an angle
      put(H, CYL(0.16, 0.17, 0.13, 12), wain, 0.06, R * 1.0, -0.02, -0.1, 0, -0.18);
      put(H, CYL(0.172, 0.172, 0.03, 12), mat(0xfcc419, q, { metal: 0.6, rough: 0.3 }), 0.064, R * 0.92, -0.02, -0.1, 0, -0.18);
      put(H, SPH(0.025, 6, 4), mat(0xfcc419, q, { metal: 0.6, rough: 0.3 }), 0.1, R * 1.21, -0.02);
      put(H, TOR(R * 0.98, 0.008, 3, 12, Math.PI), mat(0x212529, q), 0, -0.02, 0.02, Math.PI, 0, 0);
      break;
    }
    default: { // convenience store: baseball cap in the store colour with a white front panel
      put(H, DOME(R * 1.1, Math.PI * 0.42, 14, 4), acc, 0, 0.03, 0, -0.12);
      put(H, RB(0.34, 0.03, 0.2, 0.012), acc, 0, 0.15, R + 0.02, 0.18);
      put(H, SPH(0.03, 6, 4), acc, 0, R * 1.1 + 0.02, -0.04);
      put(H, RB(0.15, 0.09, 0.02, 0.008), white, 0, R * 0.78, R * 0.73, -0.75);
      put(H, CYL(0.025, 0.025, 0.01, 8), mat(TH.wainscot, q), 0, R * 0.79, R * 0.745, Math.PI / 2 - 0.75);
    }
  }
}

export function heldModel(q: Quality, held: Held): THREE.Object3D {
  const g = new THREE.Group();
  if (held.kind === 'box') {
    put(g, RB(0.45, 0.3, 0.32, 0.035), mat(0xd2a679, q));
    put(g, B(0.46, 0.07, 0.33), mat(PRODUCT_INFO[held.product].color, q));
    put(g, B(0.08, 0.012, 0.33), mat(0xc49a6c, q), 0, 0.151, 0); // tape
    put(g, RB(0.14, 0.1, 0.01, 0.01), basic(0xffffff), 0.12, 0.06, 0.163); // label
  } else if (held.kind === 'meal') {
    put(g, RB(0.32, 0.07, 0.24, 0.025), mat(0xf8f9fa, q));
    put(g, RB(0.13, 0.05, 0.18, 0.02), mat(0xe8590c, q), -0.07, 0.04, 0);
    put(g, RB(0.13, 0.05, 0.08, 0.02), mat(0x69db7c, q), 0.07, 0.04, -0.04);
    put(g, RB(0.13, 0.05, 0.08, 0.02), mat(0xffe066, q), 0.07, 0.04, 0.05);
    put(g, SPH(0.05, 6, 6), steamMat(), 0, 0.15, 0);
  } else if (held.kind === 'coffee') {
    put(g, CYL(0.07, 0.055, 0.17, 12), mat(0xffffff, q));
    put(g, CYL(0.072, 0.066, 0.06, 12), mat(0x8b5a2b, q), 0, 0.0, 0);
    put(g, CYL(0.076, 0.076, 0.025, 12), mat(0x495057, q), 0, 0.095, 0);
    put(g, CYL(0.04, 0.05, 0.02, 10), mat(0x495057, q), 0, 0.115, 0);
  } else {
    put(g, CYL(0.022, 0.022, 1.3, 6), mat(0xd9480f, q), 0, 0.1, 0.1, 0.5);
    put(g, RB(0.36, 0.08, 0.15, 0.03), mat(0x4dabf7, q), 0, -0.45, 0.42, 0.5);
    for (let i = 0; i < 5; i++) put(g, CAP(0.02, 0.12, 4), mat(0xf1f3f5, q), -0.14 + i * 0.07, -0.53, 0.47, 0.5);
  }
  mergeInto(g, new Set(), false);
  return g;
}
let steam: THREE.MeshBasicMaterial | null = null;
const steamMat = () => steam ??= new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });

/** Heavy karens (抓不動) are noticeably bigger; VIPs wear a suit and a gold watch. */
export function customerLook(c: CustomerSnap): Look {
  const l = baseLook(c);
  const v = c.vip ? { ...l, vip: true } : l;
  return c.heavy ? { ...v, build: 1.6, height: 1.08 } : v;
}
function baseLook(c: CustomerSnap) {
  const L = c.look;
  const base: Look = {
    shirt: SHIRT[L % SHIRT.length], pants: [0x343a40, 0x1c3f6e, 0x5c4033, 0x495057, 0x868e96, 0x2b2d42][(L >> 3) % 6], skin: SKIN[(L >> 2) % SKIN.length],
    hair: HAIR[(L >> 4) % HAIR.length], hairStyle: (L >> 5) % 6, build: [0.88, 1, 1, 1.12, 1.25][(L >> 1) % 5], height: [0.92, 0.96, 1, 1.04, 1.08][(L >> 6) % 5],
    accessory: [0, 0, 1, 2, 3, 4, 5, 0, 1][(L * 7) % 9],
  };
  if (c.kind === 'rager') return { ...base, shirt: 0xe64980, hair: 0xf4d58d, hairStyle: 1, accessory: 1 };
  if (c.kind === 'cutter') return { ...base, shirt: 0xfd7e14, hairStyle: 0, accessory: 0 };
  if (c.kind === 'streamer') return { ...base, shirt: 0x7048e8, hair: 0x15aabf, hairStyle: 5, accessory: 0 };
  if (c.kind === 'hog') return { ...base, shirt: 0x495057, pants: 0x212529, hairStyle: 2, accessory: 0, build: 1.3 };
  if (c.kind === 'boss') return { ...base, shirt: 0x5f3dc4, pants: 0x212529, hair: 0xf4d58d, hairStyle: 1, scale: 1.35, accessory: 1, build: 1.2, height: 1 };
  if (c.kind === 'litterer') return { ...base, shirt: 0x5c940d, accessory: 3 };
  if (c.kind === 'charger') return { ...base, shirt: 0x1098ad, pants: 0x343a40, hairStyle: 3, accessory: 4 };
  if (c.kind === 'custom') return { ...base, shirt: 0xf59f00, hairStyle: 4, accessory: 1 };
  if (c.kind === 'fickle') return { ...base, shirt: 0xf783ac, hair: 0x343a40, hairStyle: 5, accessory: 2 };
  if (c.kind === 'tryhard') return { ...base, shirt: 0x9775fa, pants: 0xe64980, hairStyle: 1, accessory: 0 };
  const sig = SIG_LOOK[c.kind];
  if (sig) return { ...base, shirt: sig[0], pants: sig[1], hairStyle: sig[2], accessory: sig[3], ...(sig[4] ? { build: sig[4] } : {}) };
  return base;
}

/** Store-signature karens: [shirt, pants, hair style, accessory (1 glasses 2 cap 3 beanie 4 backpack 5 headphones), build]. */
const SIG_LOOK: Record<string, [number, number, number, number, number?]> = {
  sampler: [0xf783ac, 0x343a40, 1, 1], reader: [0x2b8a3e, 0x5c4033, 3, 1], toucher: [0xffa94d, 0x1c3f6e, 0, 3],
  taster: [0xfab005, 0x495057, 4, 2], dogfeed: [0x74c0fc, 0x5c4033, 1, 0], squatter: [0x845ef7, 0x343a40, 5, 5],
  kicker: [0x343a40, 0x1c3f6e, 0, 5], packer: [0x5c940d, 0x343a40, 2, 4], wiper: [0x1c7ed6, 0x212529, 0, 2],
  benchhog: [0xe03131, 0x212529, 5, 0, 1.3], doneness: [0x862e9c, 0x212529, 1, 1], refry: [0xf08c00, 0x495057, 3, 2],
  unboxer: [0x15aabf, 0x343a40, 0, 4], photo: [0xe64980, 0x212529, 1, 0], coins: [0x868e96, 0x5c4033, 2, 3],
  rx: [0x99e9f2, 0x1c3f6e, 0, 1], upgrader: [0x1b1f3b, 0x1b1f3b, 1, 1],
};

/** Props that make each karen kind recognisable at a glance (head-anchor coords: head centre, radius HEAD_R). */
export function karenAccessory(q: Quality, h: Human, kind: string) {
  const extra = new THREE.Group(); // merged per material at the end (attached to the head anchor)
  const R = HEAD_R;
  if (kind === 'rager') { // big purse + angry vein
    put(h.armL, RB(0.24, 0.17, 0.09, 0.04), mat(0x862e9c, q), 0.02, -0.45, 0.04);
    put(h.armL, TOR(0.07, 0.012, 4, 10, Math.PI), mat(0xfcc419, q, { metal: 0.6, rough: 0.3 }), 0.02, -0.37, 0.04);
    put(extra, B(0.08, 0.025, 0.02), basic(0xe03131), 0.17, 0.2, onHead(0.17, 0.2) + 0.005, 0, 0, 0.8);
    put(extra, B(0.08, 0.025, 0.02), basic(0xe03131), 0.17, 0.2, onHead(0.17, 0.2) + 0.005, 0, 0, -0.8);
  }
  if (kind === 'cutter') { // red cap worn backwards
    const cm = mat(0xf03e3e, q);
    put(extra, DOME(R * 1.1, Math.PI * 0.42, 12, 4), cm, 0, 0.03, 0, -0.1);
    put(extra, RB(0.3, 0.03, 0.2, 0.012), cm, 0, 0.13, -R - 0.03, -0.25);
    put(extra, CYL(0.05, 0.05, 0.03, 8), mat(0xffffff, q), 0, R * 1.08, 0.08, -0.3);
  }
  if (kind === 'streamer') { // selfie stick + ring light
    put(h.armR, CYL(0.012, 0.012, 0.6, 6), mat(0x222222, q), 0, -0.42, 0.25, 1.1);
    put(h.armR, RB(0.09, 0.16, 0.02, 0.01), basic(0x99e9f2), 0, -0.3, 0.5, 1.1 - Math.PI / 2);
    put(h.armR, TOR(0.1, 0.016, 4, 16), basic(0xffffff), 0, -0.29, 0.52, 1.1 - Math.PI / 2);
    put(extra, SPH(0.03, 6, 4), basic(0xff3b30), -0.2, 0.2, onHead(-0.2, 0.2)); // "LIVE" dot
  }
  if (kind === 'boss') { // golden crown with gems + red cape
    const gold = mat(0xfcc419, q, { metal: 0.7, rough: 0.3, emissive: 0x332200 });
    put(extra, CYL(0.2, 0.22, 0.12, 10, true), gold, 0, R + 0.0, 0);
    put(extra, CYL(0.2, 0.2, 0.02, 10), gold, 0, R - 0.05, 0);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; put(extra, CONE(0.04, 0.11, 5), gold, Math.sin(a) * 0.2, R + 0.11, Math.cos(a) * 0.2); put(extra, SPH(0.022, 5, 4), basic(i % 2 ? 0x4dabf7 : 0xff4d6d), Math.sin(a) * 0.215, R, Math.cos(a) * 0.215); }
    const cape = new THREE.Mesh(RB(0.55, 0.72, 0.04, 0.02), mat(0xc92a2a, q)); cape.position.set(0, 0.66, -0.25); cape.rotation.x = 0.12; h.group.add(cape);
    const collar = new THREE.Mesh(TOR(0.2, 0.05, 5, 14), mat(0xf8f9fa, q)); collar.position.set(0, 1.07, -0.02); collar.rotation.x = Math.PI / 2; h.group.add(collar);
  }
  if (kind === 'charger') { // phone + power bank with a cable
    put(h.armR, RB(0.08, 0.15, 0.02, 0.008), basic(0x74c0fc), 0, -0.4, 0.08);
    put(h.armL, RB(0.16, 0.06, 0.22, 0.02), mat(0xfab005, q), 0, -0.4, 0.05);
    put(h.armL, CYL(0.008, 0.008, 0.3, 4), basic(0xf8f9fa), 0.06, -0.35, 0.12, 0.4);
  }
  if (kind === 'hog') { // grey hoodie hood with drawstrings
    const hm = mat(0x343a40, q);
    put(extra, DOME(R * 1.14, Math.PI * 0.62, 12, 6), hm, 0, 0.02, -0.03, -0.35);
    for (const x of [-0.07, 0.07]) put(extra, CYL(0.01, 0.01, 0.16, 4), basic(0xf1f3f5), x, -0.3, 0.2);
    put(h.armR, RB(0.12, 0.05, 0.12, 0.02), mat(0xf5b83f, q), 0, -0.4, 0.06); // a snack he's eating
  }
  if (kind === 'litterer') { // drink cup with a straw, about to be dropped
    put(h.armR, CYL(0.06, 0.045, 0.16, 8), mat(0xffffff, q), 0, -0.42, 0.07);
    put(h.armR, CYL(0.01, 0.01, 0.12, 4), basic(0xff6b6b), 0.02, -0.3, 0.07, 0, 0, 0.3);
  }
  if (kind === 'custom') { // order notepad + pen behind the ear
    put(h.armL, RB(0.12, 0.16, 0.02, 0.008), mat(0xfff9db, q), 0, -0.42, 0.09, -0.3);
    put(extra, CYL(0.012, 0.012, 0.16, 5), basic(0x1c7ed6), R + 0.01, 0.07, 0.02, 0.2, 0, 0.6);
  }
  if (kind === 'fickle') { // boba tea with a fat straw
    put(h.armR, CYL(0.065, 0.05, 0.17, 10), mat(0xe9c46a, q, { transparent: true, opacity: 0.9 }), 0, -0.42, 0.07);
    put(h.armR, CYL(0.067, 0.067, 0.02, 10), mat(0xf783ac, q), 0, -0.33, 0.07);
    put(h.armR, CYL(0.015, 0.015, 0.14, 5), basic(0xf783ac), 0.02, -0.26, 0.07, 0, 0, 0.2);
  }
  if (kind === 'tryhard') { // armful of clothes on a hanger
    put(h.armL, RB(0.24, 0.3, 0.04, 0.015), mat(0x63e6be, q), 0, -0.48, 0.12);
    put(h.armL, TOR(0.12, 0.01, 3, 10, Math.PI), basic(0xadb5bd), 0, -0.33, 0.12);
  }
  if (isSig(kind)) { // store-signature karens: their prop in the right hand (origin = grip)
    const prop = buildKarenProp(kind);
    if (prop) { prop.position.set(0, -0.33, 0.03); h.armR.add(prop); }
    put(extra, SPH(0.035, 6, 4), basic(0xff3b30), 0.2, 0.22, onHead(0.2, 0.22)); // little red "trouble" dot like the other karens' marks
  }
  if (extra.children.length) { h.head.add(extra); mergeInto(extra, new Set(), false); }
  // props held in the hands: fold them into the arm meshes (one draw call per arm)
  for (const a of [h.armL, h.armR]) if (a.children.length) mergeInto(a, new Set(), false);
}

// ---------- props ----------
/** Screen texture of the POS (clerk side) and the little customer-facing pole display. */
let posTex: THREE.CanvasTexture | null = null, poleTex: THREE.CanvasTexture | null = null;
export function posScreenTexture() {
  if (posTex) return posTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f3b2c'; g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#8ce99a'; roundRect(g, 10, 10, 236, 34, 8); g.fill();
  g.fillStyle = '#1f3b2c'; g.font = '900 24px sans-serif'; g.textBaseline = 'middle'; g.fillText('POS  ♥', 22, 28);
  g.fillStyle = 'rgba(140,233,154,0.6)';
  for (let i = 0; i < 4; i++) { roundRect(g, 16, 56 + i * 22, 140 - i * 18, 12, 5); g.fill(); roundRect(g, 190, 56 + i * 22, 50, 12, 5); g.fill(); }
  const cols = ['#ffd43b', '#74c0fc', '#ff8787', '#69db7c'];
  cols.forEach((col, i) => { g.fillStyle = col; roundRect(g, 14 + i * 60, 148, 50, 34, 8); g.fill(); });
  posTex = new THREE.CanvasTexture(c); posTex.colorSpace = THREE.SRGBColorSpace;
  return posTex;
}
export function poleTexture() {
  if (poleTex) return poleTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1a2a'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#3bc9db'; g.font = '900 40px monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText('THANK U', 128, 32); g.font = '900 30px monospace'; g.fillStyle = '#99e9f2'; g.fillText('$  0.00', 128, 70);
  poleTex = new THREE.CanvasTexture(c); poleTex.colorSpace = THREE.SRGBColorSpace;
  return poleTex;
}

/**
 * Chunky cute POS register. Local frame: the clerk stands at −z, the customer at +z.
 * Main screen + keypad + cash drawer + scanner face the clerk; a pole display and card reader face the customer.
 */
export function buildRegister(q: Quality, accent: number, screenMat: THREE.Material, poleMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const body = mat(0xf1f3f5, q, { rough: 0.5 }), trim = mat(0xced4da, q, { rough: 0.5 }), darkM = mat(0x343a40, q, { rough: 0.5 }), acc = mat(accent, q, { rough: 0.5 });
  // base with the cash drawer on the clerk side
  put(g, RB(0.58, 0.16, 0.46, 0.05, 2), body, 0, 0.08, 0);
  put(g, RB(0.6, 0.035, 0.48, 0.015), acc, 0, 0.02, 0);
  put(g, RB(0.46, 0.09, 0.04, 0.02), trim, 0, 0.075, -0.225);
  put(g, RB(0.16, 0.022, 0.02, 0.008), darkM, 0, 0.09, -0.247);
  put(g, CYL(0.012, 0.012, 0.01, 8), basic(0xfcc419), 0.17, 0.09, -0.248, Math.PI / 2); // keyhole
  // keypad tilted toward the clerk
  const kp = new THREE.Group(); kp.position.set(0.1, 0.17, -0.12); kp.rotation.x = -0.25; g.add(kp);
  put(kp, RB(0.26, 0.04, 0.18, 0.015), darkM);
  const keyCols = [0xf8f9fa, 0xf8f9fa, 0xf8f9fa, 0xff8787, 0xf8f9fa, 0xf8f9fa, 0xf8f9fa, 0xffd43b, 0xf8f9fa, 0xf8f9fa, 0xf8f9fa, 0x69db7c];
  keyCols.forEach((c, i) => put(kp, RB(0.045, 0.02, 0.035, 0.008), mat(c, q, { rough: 0.5 }), -0.09 + (i % 4) * 0.06, 0.025, -0.055 + Math.floor(i / 4) * 0.055));
  // main screen on a stand, tilted up toward the clerk's eyes
  put(g, CYL(0.025, 0.035, 0.18, 8), darkM, -0.12, 0.25, 0.05);
  const sg = new THREE.Group(); sg.position.set(-0.12, 0.44, 0.04); sg.rotation.x = 0.3; g.add(sg);
  put(sg, RB(0.4, 0.28, 0.06, 0.03), mat(accent, q, { rough: 0.5 }));
  put(sg, RB(0.36, 0.24, 0.02, 0.01), darkM, 0, 0, -0.025);
  const scr = new THREE.Mesh(geo('posScreen', () => new THREE.PlaneGeometry(0.33, 0.21)), screenMat); scr.position.set(0, 0, -0.037); scr.rotation.y = Math.PI; sg.add(scr);
  // receipt printer with a curl of paper
  put(g, RB(0.15, 0.1, 0.15, 0.03), darkM, 0.19, 0.21, 0.08);
  put(g, B(0.08, 0.004, 0.006), basic(0x111111), 0.19, 0.261, 0.03);
  put(g, B(0.07, 0.1, 0.004), basic(0xffffff), 0.19, 0.3, 0.02, -0.25);
  // customer-facing pole display
  put(g, CYL(0.015, 0.015, 0.26, 6), darkM, 0.22, 0.38, 0.17);
  put(g, RB(0.2, 0.09, 0.05, 0.02), darkM, 0.22, 0.53, 0.17);
  const pd = new THREE.Mesh(geo('poleScreen', () => new THREE.PlaneGeometry(0.17, 0.065)), poleMat); pd.position.set(0.22, 0.53, 0.196); g.add(pd);
  // card reader tilted toward the customer
  const cr = new THREE.Group(); cr.position.set(-0.17, 0.18, 0.17); cr.rotation.x = 0.35; g.add(cr);
  put(cr, RB(0.1, 0.03, 0.15, 0.015), darkM);
  put(cr, B(0.07, 0.004, 0.04), basic(0x74c0fc), 0, 0.017, -0.03);
  for (let i = 0; i < 6; i++) put(cr, B(0.018, 0.006, 0.014), basic(0xdee2e6), -0.022 + (i % 3) * 0.022, 0.017, 0.02 + Math.floor(i / 3) * 0.025);
  // handheld barcode scanner in its cradle, beside the base on the clerk's side, red window glowing
  const sc = new THREE.Group(); sc.position.set(0.38, 0.0, -0.14); g.add(sc);
  put(sc, RB(0.1, 0.03, 0.1, 0.012), darkM, 0, 0.015, 0);
  put(sc, RB(0.045, 0.14, 0.05, 0.015), mat(0xffd43b, q, { rough: 0.5 }), 0, 0.1, 0.0, 0.25);
  put(sc, RB(0.09, 0.06, 0.08, 0.02), mat(0xffd43b, q, { rough: 0.5 }), 0, 0.18, -0.025, 0.25);
  put(sc, B(0.06, 0.03, 0.004), basic(0xff3b30), 0, 0.18, -0.066, 0.25);
  return g;
}
