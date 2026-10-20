// Three.js scene: the store, live stock displays, characters (players, customers, karens) and effects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  B, CAP, CONE, CYL, DOME, Human, ICON_Y, Label, Pose, RB, SIT_Y, SKIN, HAIR, SPH, TOR, basic, buildRegister, customerLook, geo, heldModel, hex,
  karenAccessory, mat, mergeInto, paint, vertexColorMat, poleTexture, posScreenTexture, put, textCanvas,
} from './models.ts';
import { FOOD_INFO, PRODUCT_INFO, PRODUCTS, Product, shelfCapacity, EYE_HEIGHT } from '../../shared/constants.ts';
import {
  AABB, COFFEE_MACHINE, MICROWAVE, COFFEE_PICKUP, COMPLAINT_SPOT, COUNTER, CRATES, DECOR, DOOR_X0, DOOR_X1, MOP_RACK, REGISTERS, SHELVES,
  CURRENT_MAP, CAMP_SPOTS, OUTLET, STORE_D, STORE_W, WALLS, shelfFacing, SOLIDS, QUEUE_SPOTS, PLAYER_SPAWNS, WANDER_SPOTS, TRYON_SPOTS, CHARGE_SPOT, distToAABB,
} from '../../shared/map.ts';
import type { CustomerSnap, Held, PlayerSnap, Snapshot } from '../../shared/protocol.ts';
import type { Quality } from './storage.ts';
import { sigDef } from '../../shared/sigkarens.ts';
import { DecorCtx, STORE_DECOR, buildStoreDecor, buildStoreExtras } from './decor.ts';
import { StationInfo, buildStation, stationGlowMesh } from './stations.ts';
import { buildShelfStyle, dressFridge } from './shelves.ts';
import { buildShopDecor, tagPrefix } from './cosmetics.ts';
import { INK, PillOpts, UI_FONT, isFontReady, labelTexture, pillCanvas, popCanvas, textTexture, whenFontReady } from './labels.ts';

// ---------- helpers ----------
export { textCanvas };

function boxMesh(b: AABB, h: number, m: THREE.Material, y0 = 0) {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, h, b.z1 - b.z0);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set((b.x0 + b.x1) / 2, y0 + h / 2, (b.z0 + b.z1) / 2);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** Chalk-style menu (food shops) or price list (clothes shop) built from the map's own products. */
function menuBoardCanvas(): HTMLCanvasElement {
  const M = CURRENT_MAP, c = document.createElement('canvas'); c.width = 512; c.height = 282;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f3b35'; g.fillRect(0, 0, 512, 282);
  g.fillStyle = 'rgba(255,255,255,0.04)'; for (let i = 0; i < 60; i++) g.fillRect(Math.random() * 512, Math.random() * 282, 40, 2);
  g.fillStyle = hex(M.theme.accent); g.beginPath(); g.roundRect(150, 12, 212, 50, 25); g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2a1f3d'; g.stroke();
  g.fillStyle = '#fff'; g.font = `900 34px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(M.coffee || M.meal ? 'MENU' : 'PRICE', 256, 38);
  const rows: [string, number][] = PRODUCTS.map(p => [M.products[p]!.name, M.products[p]!.price]);
  if (M.coffee) rows.push([M.coffee.food, M.coffee.price]);
  if (M.meal) rows.push([M.meal.food, M.meal.price]);
  const lh = Math.min(42, 200 / rows.length);
  rows.forEach(([n, pr], i) => {
    const y = 92 + i * lh;
    g.font = `900 ${Math.round(lh * 0.7)}px ${UI_FONT}`; g.textAlign = 'left'; g.fillStyle = i % 2 ? '#fff3bf' : '#f8f9fa'; g.fillText(n, 36, y);
    g.textAlign = 'right'; g.fillStyle = '#ffd43b'; g.fillText('$' + pr, 476, y);
    g.fillStyle = 'rgba(255,255,255,0.25)'; const w0 = 44 + g.measureText(n).width * 0 + 150; for (let x = w0; x < 410; x += 14) g.fillRect(x, y + 4, 6, 3);
  });
  return c;
}

/** Little framed artworks in the shop's colours (no text). */
function artCanvas(kind: number): HTMLCanvasElement {
  const TH = CURRENT_MAP.theme, c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!, acc = hex(TH.accent), wain = hex(TH.wainscot);
  const pal = CURRENT_MAP.products.drinks.palette.concat(CURRENT_MAP.products.snacks.palette).map(hex);
  const stroke = () => { g.lineWidth = 7; g.strokeStyle = '#2a1f3d'; g.stroke(); };
  switch (kind % 4) {
    case 0: { // sunny hills
      const sky = g.createLinearGradient(0, 0, 0, 256); sky.addColorStop(0, '#9ed8ff'); sky.addColorStop(1, '#fff6e5');
      g.fillStyle = sky; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#ffc23d'; g.beginPath(); g.arc(190, 70, 34, 0, Math.PI * 2); g.fill(); stroke();
      g.fillStyle = '#7bd389'; g.beginPath(); g.ellipse(70, 250, 150, 110, 0, Math.PI, 0); g.fill(); stroke();
      g.fillStyle = '#39c96b'; g.beginPath(); g.ellipse(220, 260, 140, 80, 0, Math.PI, 0); g.fill(); stroke();
      break;
    }
    case 1: { // polka still life in the product colours
      g.fillStyle = '#fff6e5'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 7; i++) { g.fillStyle = pal[i % pal.length]; g.beginPath(); g.arc(40 + (i % 3) * 88 + (i > 2 ? 44 : 0), 50 + Math.floor(i / 3) * 80, 30, 0, Math.PI * 2); g.fill(); stroke(); }
      break;
    }
    case 2: { // big heart on stripes
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff6e5' : wain; g.fillRect(i * 32, 0, 32, 256); }
      g.fillStyle = acc; g.beginPath(); g.moveTo(128, 210); g.bezierCurveTo(20, 140, 40, 40, 128, 90); g.bezierCurveTo(216, 40, 236, 140, 128, 210); g.fill(); stroke();
      break;
    }
    default: { // cat face
      g.fillStyle = acc; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#fff6e5';
      g.beginPath(); g.moveTo(50, 110); g.lineTo(70, 40); g.lineTo(110, 80); g.lineTo(146, 80); g.lineTo(186, 40); g.lineTo(206, 110); g.arc(128, 150, 85, -0.2, Math.PI + 0.2); g.closePath(); g.fill(); stroke();
      g.fillStyle = '#2a1f3d'; for (const x of [95, 161]) { g.beginPath(); g.arc(x, 145, 11, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ff9eaa'; for (const x of [78, 178]) { g.beginPath(); g.ellipse(x, 172, 14, 8, 0, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 5; g.beginPath(); g.moveTo(116, 175); g.quadraticCurveTo(128, 186, 128, 172); g.quadraticCurveTo(128, 186, 140, 175); g.stroke();
    }
  }
  g.lineWidth = 10; g.strokeStyle = '#2a1f3d'; g.strokeRect(0, 0, 256, 256);
  return c;
}

/**
 * Packs the canvases of the static wall signs into one texture, so every sign shares a material and the static
 * merge turns them into a single draw call. Signs are redrawn once the UI font has loaded.
 */
class SignAtlas {
  private items: { draw: () => HTMLCanvasElement; c: HTMLCanvasElement; geos: THREE.BufferGeometry[]; x: number; y: number; s: number }[] = [];
  readonly mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture | null = null;
  /** A plane (w × h metres) showing the canvas drawn by `draw`. */
  mesh(w: number, h: number, draw: () => HTMLCanvasElement): THREE.Mesh {
    const g = new THREE.PlaneGeometry(w, h);
    this.items.push({ draw, c: draw(), geos: [g], x: 0, y: 0, s: 1 });
    return new THREE.Mesh(g, this.mat);
  }
  /** Lay the canvases out (shelf packing), remap the planes' UVs and build the texture. */
  pack() {
    if (!this.items.length) return;
    const W = 2048, pad = 6;
    let scale = 1, H = 0;
    for (; scale > 0.2; scale *= 0.8) {
      let x = 0, y = 0, row = 0;
      for (const it of [...this.items].sort((a, b) => b.c.height - a.c.height)) {
        const w = Math.ceil(it.c.width * scale), h = Math.ceil(it.c.height * scale);
        if (x + w + pad > W) { x = 0; y += row + pad; row = 0; }
        it.x = x; it.y = y; it.s = scale; x += w + pad; row = Math.max(row, h);
      }
      H = y + row;
      if (H <= 2048) break;
    }
    H = Math.min(2048, 2 ** Math.ceil(Math.log2(Math.max(64, H))));
    this.canvas.width = W; this.canvas.height = H;
    this.redraw(false);
    for (const it of this.items) {
      const w = it.c.width * it.s, h = it.c.height * it.s;
      for (const g of it.geos) {
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (it.x + uv.getX(i) * w) / W, 1 - (it.y + (1 - uv.getY(i)) * h) / H);
      }
    }
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mat.map = this.tex; this.mat.needsUpdate = true;
    if (!isFontReady()) whenFontReady(() => this.redraw(true));
  }
  private redraw(fresh: boolean) {
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#2a1f3d'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const it of this.items) {
      if (fresh) it.c = it.draw();
      g.drawImage(it.c, it.x, it.y, it.c.width * it.s, it.c.height * it.s);
    }
    if (this.tex) this.tex.needsUpdate = true;
  }
}

/** Item mesh for a product shape (instanced on shelves). */
function productGeometry(shape: string): THREE.BufferGeometry {
  const lathe = (pts: [number, number][], seg: number) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const center = (g: THREE.BufferGeometry, h: number) => g.translate(0, -h / 2, 0);
  switch (shape) {
    // toy-like silhouettes: rimmed can, bottle with a neck and cap, cup with a domed lid, bevelled boxes
    case 'can': return center(lathe([[0, 0], [0.08, 0], [0.09, 0.02], [0.09, 0.27], [0.075, 0.3], [0, 0.3]], 10), 0.3);
    case 'bottle': return center(lathe([[0, 0], [0.075, 0], [0.08, 0.02], [0.08, 0.2], [0.035, 0.29], [0.035, 0.32], [0.04, 0.32], [0.04, 0.36], [0, 0.36]], 8), 0.36);
    case 'cup': return center(lathe([[0, 0], [0.075, 0], [0.095, 0.24], [0.105, 0.245], [0.09, 0.3], [0, 0.3]], 10), 0.3);
    case 'flat': return new RoundedBoxGeometry(0.3, 0.12, 0.4, 1, 0.03);
    case 'shirt': return new RoundedBoxGeometry(0.05, 0.6, 0.48, 1, 0.02);
    case 'pants': return new RoundedBoxGeometry(0.05, 0.75, 0.36, 1, 0.02);
    case 'bag': return new RoundedBoxGeometry(0.36, 0.3, 0.16, 1, 0.05);
    default: return new RoundedBoxGeometry(0.4, 0.3, 0.12, 1, 0.04);
  }
}

function floorTexture(style: 'tile' | 'wood' | 'concrete' = 'tile', base: [number, number, number] = [232, 228, 218]) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const [R, G, B] = base;
  const rgb = (d: number) => `rgb(${R + d},${G + d},${B + d})`;
  if (style === 'wood') {
    // planks
    for (let j = 0; j < 8; j++) for (let i = 0; i < 3; i++) {
      const d = ((i * 5 + j * 11) % 7) * 4 - 12;
      const off = (j % 2) * 85;
      g.fillStyle = rgb(d); g.fillRect(i * 171 + off - 171, j * 64, 171, 64); g.fillRect(i * 171 + off, j * 64, 171, 64);
    }
    g.strokeStyle = 'rgba(40,25,15,0.35)'; g.lineWidth = 2;
    for (let j = 0; j <= 8; j++) { g.beginPath(); g.moveTo(0, j * 64); g.lineTo(512, j * 64); g.stroke(); }
    for (let k = 0; k < 900; k++) { g.fillStyle = 'rgba(60,35,20,0.12)'; g.fillRect(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 20, 1); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  if (style === 'concrete') {
    g.fillStyle = rgb(0); g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 5000; k++) { const v = Math.random(); g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)'; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    g.strokeStyle = 'rgba(80,80,80,0.25)'; g.lineWidth = 2; g.strokeRect(1, 1, 510, 510);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  const n = 4, s = 512 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = ((i * 7 + j * 13) % 5) * 3 - 4;
    g.fillStyle = `rgb(${R + v},${G + v - 4},${B + v - 10})`; g.fillRect(i * s, j * s, s, s);
  }
  for (let k = 0; k < 2600; k++) {
    const r = Math.random();
    g.fillStyle = r < 0.33 ? 'rgba(120,110,95,0.25)' : r < 0.66 ? 'rgba(255,255,255,0.35)' : 'rgba(160,140,120,0.2)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Lit-window facades, one 128 px column per wall colour (all buildings share the texture → one draw call). */
function windowsTexture(bases: string[]) {
  const c = document.createElement('canvas'); c.width = 128 * bases.length; c.height = 256;
  const g = c.getContext('2d')!;
  bases.forEach((base, i) => {
    const ox = i * 128;
    g.fillStyle = base; g.fillRect(ox, 0, 128, 256);
    for (let y = 12; y < 250; y += 28) for (let x = 10; x < 120; x += 28) {
      g.fillStyle = Math.random() < 0.35 ? '#ffe8a3' : 'rgba(40,50,70,0.75)'; g.fillRect(ox + x, y, 16, 18);
    }
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tileTexture(a: string, b: string, n = 8) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const s = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s, j * s, s, s); }
  g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(256, i * s); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

// ---------- overhead customer tags ----------
/** A customer's overhead tag: the full pill, an optional compact (icon-only) form used when far away or crowded. */
interface Tag { key: string; full: PillOpts; compact: PillOpts | null; prio: number }
const GOOD = '#39c96b', BAD = '#ff5d5d', WARN = '#ffc23d';
const KAREN_BG: Record<string, string> = {
  cutter: '#ff9f1c', rager: '#ff5d5d', streamer: '#8f6bff', hog: '#868e96', litterer: '#4fb35a', charger: '#48a6ff',
  custom: '#ffc23d', fickle: '#ff7eb6', tryhard: '#9775fa', boss: '#5f3dc4',
};
const SIG_BG: Record<string, string> = { haggle: '#ff5d5d', camp: '#ff9f1c', roam: '#8f6bff', till: '#48a6ff', redo: '#ff7eb6', sneak: '#868e96', refund: '#4fb35a' };
const q20 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 20) / 20;
function customerTag(c: CustomerSnap): Tag | null {
  const loose = !c.held && !c.flying;
  if (c.kind === 'boss' && !c.resolved && loose) {
    const ph = ['', '插隊霸王', '退貨暴君', '直播帝王', '召喚小弟', '強弩之末'][c.phase] ?? '';
    const bar = c.phase === 2 ? { v: q20(c.anger / 100), color: BAD } : { v: q20((c.phase - 1) / 4), color: WARN };
    return { key: `boss${c.phase}|${bar.v}`, full: { text: `👑 奧客之王・${ph}`, bg: KAREN_BG.boss, fg: '#ffe066', bar }, compact: null, prio: 3 };
  }
  if (c.stun > 0 && loose) {
    return { key: 'stun' + (c.heavy ? 'h' : ''), full: { text: c.heavy ? '💫 暈了！現在抓得動' : '💫 暈了', bg: WARN, fg: INK }, compact: { text: '💫', bg: WARN, fg: INK }, prio: 2 };
  }
  if (c.down > 0) return { key: 'down', full: { text: '💫 好痛…', size: 40 }, compact: { text: '💫', size: 40 }, prio: 0 };
  if (!loose) return { key: c.held ? 'held' : 'fly', full: { text: c.held ? '😵 放開我！' : '😱 啊——', size: 44 }, compact: null, prio: 2 };
  if (c.kind !== 'normal' && !c.resolved && c.revealed) {
    const extras = `${c.vip ? '💼 好像有背景' : ''}${c.vip && c.heavy ? '・' : ''}${c.heavy ? '🏋 抓不動' : ''}`;
    const badge = (c.vip ? '💼' : '') + (c.heavy ? '🏋' : '');
    let name = '', bar: PillOpts['bar'];
    const sd = sigDef(c.kind);
    if (sd) { // store-signature karen: its own tag; heat bar while haggling, otherwise how long until he wins
      name = sd.tag.replace('N', String(c.phase + 1));
      if (sd.tpl === 'haggle') bar = { v: q20(c.anger / 100), color: c.anger > 70 ? '#ff3b3b' : '#ffa94d' };
      else if (['charge', 'camp', 'wander', 'flee', 'complain', 'atRegister'].includes(c.state)) bar = { v: q20(c.patience), color: '#3bc9db' };
    } else switch (c.kind) {
      case 'rager': name = c.violent ? '🤬 失控！可正當防衛' : '😡 退貨大鬧'; bar = { v: q20(c.anger / 100), color: c.anger > 70 ? '#ff3b3b' : '#ffa94d' }; break;
      case 'cutter': name = '⚠ 插隊！'; break;
      case 'streamer': name = '📱 直播亂拍'; break;
      case 'hog': name = '❓ 偷吃中'; break;
      case 'litterer': name = '🗑 亂丟垃圾'; break;
      case 'charger': name = c.phase ? '🔌 又插回去了！' : '🔌 霸佔插座'; bar = { v: q20(c.patience), color: '#3bc9db' }; break;
      case 'custom': name = c.state === 'atRegister' ? '🍳 我要改單…' : '🍳 客製魔人'; break;
      case 'fickle': name = c.phase ? '🧋 我要改甜度！' : '🧋 改單達人'; break;
      case 'tryhard': name = '👕 試穿中…'; break;
      default: return null;
    }
    const bg = c.violent ? '#d6336c' : KAREN_BG[c.kind] ?? SIG_BG[sd?.tpl ?? ''] ?? '#ff5d5d', fg = bg === WARN ? INK : undefined;
    const icon = name.split(' ')[0] + (c.violent && c.kind !== 'rager' ? '🤬' : '') + badge;
    return {
      key: `k${c.kind}|${name}|${extras}|${c.violent ? 1 : 0}|${bar?.v ?? ''}`,
      full: { text: name, sub: extras || undefined, subFg: fg ? INK : '#fff3bf', bg, fg, bar, size: 44 },
      compact: { text: icon, bg, fg, bar, size: 40 }, prio: 1,
    };
  }
  if (c.want && (c.state === 'waitFood' || c.state === 'toFood')) {
    const v = q20(c.patience);
    const t: PillOpts = { text: c.want === 'meal' ? '🍱' : '☕', size: 38, bar: { v, color: v < 0.3 ? BAD : WARN } };
    return { key: `cf${c.want}|${v}`, full: t, compact: null, prio: 0 };
  }
  if (c.state === 'queue' || c.state === 'atRegister' || c.state === 'toRegister') {
    const v = q20(c.patience);
    const t: PillOpts = { text: c.state === 'atRegister' ? '💳' : '⏳', size: 38, bar: { v, color: v < 0.3 ? BAD : GOOD } };
    return { key: `q${c.state === 'atRegister' ? 1 : 0}|${v}`, full: t, compact: null, prio: 0 };
  }
  if (c.state === 'leaving' && c.kind === 'normal' && c.patience <= 0.01) return { key: 'angry', full: { text: '💢', bg: BAD, size: 40 }, compact: null, prio: 0 };
  return null;
}

// ---------- the store ----------
interface Smoothed { x: number; z: number; yaw: number }

export class StoreView {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  private q: Quality;
  private shelfInst = new Map<Product, { mesh: THREE.InstancedMesh; slots: THREE.Vector3[] }>();
  private crateStacks = new Map<Product, THREE.Group>();
  private mopsOnRack: THREE.Object3D[] = [];
  private register2: THREE.Object3D[] = [];
  private reg2On = false;
  private stationLabels: { l: Label; on: () => boolean }[] = [];
  private doorL!: THREE.Mesh; private doorR!: THREE.Mesh; private doorOpen = 0;
  private customers = new Map<number, { h: Human; s: Smoothed; kind: string; tag: Tag | null; compactT: number }>();
  private players = new Map<string, { h: Human; s: Smoothed }>();
  private spills = new Map<number, THREE.Mesh>();
  private items = new Map<number, THREE.Object3D>();
  private pings = new Map<number, THREE.Group>();
  private floaters: { obj: THREE.Sprite; life: number; vy: number }[] = [];
  private particles: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private viewHeld = new THREE.Group();
  private viewHeldKey = '';
  private time = 0;
  private clockHands: THREE.Object3D[] = [];
  /** Soft round shadows under every character (instanced: one draw call); characters cast no real shadows. */
  private blobs: THREE.InstancedMesh;
  private shadowSig = '';
  private atlas = new SignAtlas();
  private coffeeSteam: THREE.Mesh[] = [];
  private steamBase = new THREE.Vector3();
  private spillGeo = new THREE.CircleGeometry(0.45, 20);
  private spillMat = new THREE.MeshBasicMaterial({ color: 0x8a6d3b, transparent: true, opacity: 0.85 });
  highlight: THREE.Box3Helper;
  private microwaveGlow!: THREE.Mesh;
  private lights: { l: THREE.Light; base: number }[] = [];
  private exitGlow!: THREE.Mesh;
  private power = 1;
  private glow: { m: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  private beacon: THREE.Mesh | null = null;
  private beaconLight: THREE.PointLight | null = null;
  private puffs: { s: THREE.Sprite; life: number }[] = [];
  private puffTex: THREE.Texture | null = null;
  private rings: { m: THREE.Mesh; life: number }[] = [];
  shake = 0;
  flash = 0;
  private guide!: THREE.Group;

  constructor(canvas: HTMLCanvasElement, quality: Quality, fov: number) {
    this.q = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = quality === 'low' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // only static things cast shadows, so the shadow map is re-rendered just when they change (see update())
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.camera.add(this.viewHeld);
    this.viewHeld.position.set(0.32, -0.28, -0.55);
    this.guide = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12), new THREE.MeshBasicMaterial({ color: 0xffd43b }));
    cone.rotation.x = Math.PI; cone.position.y = 0.2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 28), new THREE.MeshBasicMaterial({ color: 0xffd43b, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -2.2;
    this.guide.add(cone, ring); this.guide.visible = false; this.scene.add(this.guide);
    this.blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 18).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a1f3d, transparent: true, opacity: 0.2, depthWrite: false }), 96);
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1; this.scene.add(this.blobs);
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffe066));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    const before = new Set(this.scene.children);
    this.build();
    buildShopDecor(this.scene, this.q); // 商城 decorations (free play / own store only)
    this.atlas.pack();
    this.mergeStatic(before);
    this.resize();
  }

  setQuality(q: Quality) {
    this.q = q;
    const pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 0.85);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q === 'high';
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  /** Dynamic resolution: 0.5–1 multiplier on the quality's pixel ratio. */
  resScale = 1;
  /** Player's 解析度比例 setting: the dynamic scale never goes above it. */
  maxScale = 1;
  setResolutionScale(f: number) { this.resScale = Math.max(Math.min(0.5, this.maxScale), Math.min(this.maxScale, f)); this.resize(); }
  setMaxScale(m: number) { this.maxScale = Math.max(0.5, Math.min(1, Number.isFinite(m) ? m : 1)); this.setResolutionScale(this.maxScale); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = (this.q === 'high' ? Math.min(devicePixelRatio, 2) : this.q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 0.85)) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private build() {
    const q = this.q, S = this.scene;
    S.background = new THREE.Color(0x9ec9ef);
    S.fog = new THREE.Fog(0x9ec9ef, 30, 90);
    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f6a, q === 'low' ? 1.6 : 1.1); S.add(hemi); this.lights.push({ l: hemi, base: hemi.intensity });
    if (q !== 'low') {
      for (const [x, z] of [[6, 4], [12, 8], [18, 4], [18, 12], [6, 12]]) {
        const l = new THREE.PointLight(0xfff1d6, 9, 14, 1.6); l.position.set(x, 2.6, z); S.add(l); this.lights.push({ l, base: l.intensity });
      }
    } else { const a = new THREE.AmbientLight(0xffffff, 0.6); S.add(a); this.lights.push({ l: a, base: a.intensity }); }
    if (q === 'high') {
      const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(16, 12, 22); d.target.position.set(12, 0, 8);
      d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
      Object.assign(d.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
      S.add(d, d.target);
    }
    // floor & ceiling
    const TH = CURRENT_MAP.theme;
    const floorT = floorTexture(TH.floor, TH.floorColor); floorT.repeat.set(STORE_W / 2.4, STORE_D / 2.4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(STORE_W, STORE_D), q === 'low' ? new THREE.MeshLambertMaterial({ map: floorT }) : new THREE.MeshStandardMaterial({ map: floorT, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(STORE_W / 2, 0, STORE_D / 2); floor.receiveShadow = true; S.add(floor);
    const stockFloor = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 5), mat(0x9a948a, q)); stockFloor.rotation.x = -Math.PI / 2; stockFloor.position.set(3.25, 0.005, 2.5); S.add(stockFloor);
    // ceiling: unlit so it never turns brown; dims with the power
    const ceilM = this.glowMat(0xe2ded6);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(STORE_W, STORE_D), ceilM); ceil.rotation.x = Math.PI / 2; ceil.position.set(STORE_W / 2, 3.2, STORE_D / 2); S.add(ceil);
    const fixtureM = mat(0xced4da, q);
    const panelM = this.glowMat(0xffffff);
    for (let x = 3; x < STORE_W; x += 6) for (let z = 3; z < STORE_D; z += 5) {
      const f = new THREE.Mesh(RB(2.0, 0.08, 0.62, 0.035), fixtureM); f.position.set(x, 3.15, z); S.add(f);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), panelM); p.rotation.x = Math.PI / 2; p.position.set(x, 3.105, z); S.add(p);
    }
    this.buildStreet();
    // walls (south wall gets windows)
    const wallM = mat(TH.wall, q);
    const accent = mat(TH.accent, q);
    const wainscot = mat(TH.wainscot, q);
    const baseboard = mat(0x495057, q);
    for (const w of WALLS) {
      const isSouth = w.z0 >= STORE_D - 0.01;
      if (isSouth) {
        S.add(boxMesh(w, 0.9, wallM));
        S.add(boxMesh(w, 0.6, accent, 2.6));
        const glass = boxMesh({ ...w, z0: w.z0 + 0.1, z1: w.z1 - 0.1 }, 1.7, mat(0xbfe3ff, q, { transparent: true, opacity: 0.25, rough: 0.1 }), 0.9);
        glass.castShadow = false; S.add(glass);
      } else {
        S.add(boxMesh(w, w.h, wallM));
        // wainscot band and baseboard on interior walls
        const e = 0.012;
        S.add(boxMesh({ ...w, x0: w.x0 - e, x1: w.x1 + e, z0: w.z0 - e, z1: w.z1 + e }, 1.0, wainscot));
        S.add(boxMesh({ ...w, x0: w.x0 - 2 * e, x1: w.x1 + 2 * e, z0: w.z0 - 2 * e, z1: w.z1 + 2 * e }, 0.1, baseboard));
        S.add(boxMesh({ ...w, x0: w.x0 - 2 * e, x1: w.x1 + 2 * e, z0: w.z0 - 2 * e, z1: w.z1 + 2 * e }, 0.04, accent, 1.0));
      }
    }
    const lintel = boxMesh({ x0: DOOR_X0, z0: STORE_D, x1: DOOR_X1, z1: STORE_D + 0.3, h: 0, kind: '' }, 0.6, accent, 2.6); S.add(lintel);
    const doorM = mat(0xd0ebff, q, { transparent: true, opacity: 0.35, rough: 0.05 });
    this.doorL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.55, 0.06), doorM); this.doorL.position.set(DOOR_X0 + 0.75, 1.3, STORE_D + 0.15);
    this.doorR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.55, 0.06), doorM); this.doorR.position.set(DOOR_X1 - 0.75, 1.3, STORE_D + 0.15);
    this.doorL.userData.dynamic = this.doorR.userData.dynamic = true;
    S.add(this.doorL, this.doorR);
    this.exitGlow = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_X1 - DOOR_X0, 2.6), new THREE.MeshBasicMaterial({ color: 0xff922b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.exitGlow.position.set(12, 1.3, STORE_D + 0.05); this.exitGlow.userData.dynamic = true; S.add(this.exitGlow);
    // sign
    const sign = this.atlas.mesh(4.5, 0.9, () => textCanvas([{ text: CURRENT_MAP.sign.text, size: 70, color: '#fff' }], 1024, 200, CURRENT_MAP.sign.bg));
    sign.position.set(12, 2.86, STORE_D - 0.02); sign.rotation.y = Math.PI; sign.scale.set(0.8, 0.62, 1); S.add(sign);
    const sign2 = sign.clone(); sign2.position.set(12, 2.9, STORE_D + 0.32); sign2.rotation.y = 0; sign2.scale.set(1, 1, 1); S.add(sign2);
    const exitSign = this.atlas.mesh(0.7, 0.25, () => textCanvas([{ text: '出口 EXIT', size: 64, color: '#fff' }], 512, 160, '#2b8a3e'));
    exitSign.position.set(12, 2.4, STORE_D - 0.03); exitSign.rotation.y = Math.PI; S.add(exitSign);
    // wall socket by the window (where 充電霸王 squats)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.03), mat(0xf8f9fa, this.q)); plate.position.set(OUTLET.x, 0.35, OUTLET.z - 0.02); S.add(plate);
    const chargeSign = this.atlas.mesh(0.6, 0.22, () => textCanvas([{ text: '🔌 充電座', size: 60, color: '#fff' }], 512, 180, '#1098ad'));
    chargeSign.position.set(OUTLET.x, 0.75, OUTLET.z - 0.03); chargeSign.rotation.y = Math.PI; S.add(chargeSign);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5c1a1a }));
    this.beacon.position.set(13.9, 2.9, STORE_D - 0.25); this.beacon.userData.dynamic = true; S.add(this.beacon);
    if (q !== 'low') { this.beaconLight = new THREE.PointLight(0xff3b30, 0, 9, 1.5); this.beaconLight.position.copy(this.beacon.position).add(new THREE.Vector3(0, -0.3, -0.4)); S.add(this.beaconLight); }
    const stockSign = this.atlas.mesh(1.6, 0.4, () => textCanvas([{ text: '倉庫 STOCK', size: 60 }], 512, 128, '#495057'));
    stockSign.position.set(3.4, 2.4, 5.27); S.add(stockSign);
    // shelves
    for (const sh of SHELVES) {
      const b = sh.box;
      const face = shelfFacing(b); // -1: wall unit on the east wall (opens west), +1: on the west wall, 0: free-standing
      const isWall = face !== 0, isFridge = b.kind === 'fridge', isRack = b.kind === 'rack';
      const info = CURRENT_MAP.products[sh.product]!;
      const frame = mat(isFridge ? 0xdee2e6 : TH.shelf, q, { metal: 0.3, rough: 0.5 });
      const openX = face < 0 ? b.x0 : b.x1, backX = face < 0 ? b.x1 : b.x0;
      // store-specific fixture (bookcase, bread baskets, glass cabinet…); otherwise the generic shelf below
      const style = buildShelfStyle(this.decorCtx(), CURRENT_MAP.id, sh.product, info.shape, b, face);
      const slots: THREE.Vector3[] = [];
      if (!style) {
      S.add(boxMesh({ ...b }, isRack ? 0.04 : 0.12, frame));
      if (isWall) {
        S.add(boxMesh(face < 0 ? { ...b, x0: b.x1 - 0.12 } : { ...b, x1: b.x0 + 0.12 }, b.h, frame));
        S.add(boxMesh(b, 0.1, frame, b.h - 0.1));
        if (isFridge) {
          dressFridge(this.decorCtx(), CURRENT_MAP, info.name, b, face); // store-themed header, handles, decals
          const glass = boxMesh(face < 0 ? { ...b, x1: b.x0 + 0.04 } : { ...b, x0: b.x1 - 0.04 }, b.h - 0.15, mat(0xa5d8ff, q, { transparent: true, opacity: 0.18, rough: 0.05 }), 0.1); glass.castShadow = false; S.add(glass);
          const glow = new THREE.Mesh(new THREE.PlaneGeometry(b.z1 - b.z0 - 0.4, 0.06), this.glowMat(0xe7f5ff)); glow.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2; glow.position.set(openX - face * 0.06, b.h - 0.2, (b.z0 + b.z1) / 2); S.add(glow);
          const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(b.z1 - b.z0 - 0.2, b.h - 0.3), this.glowMat(0xd0ebff)); backGlow.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2; backGlow.position.set(backX + face * 0.13, b.h / 2 + 0.05, (b.z0 + b.z1) / 2); S.add(backGlow);
        }
        for (let z = b.z0; z <= b.z1 + 0.01; z += (b.z1 - b.z0) / 4) S.add(boxMesh({ x0: openX - 0.04, x1: openX + 0.04, z0: z - 0.03, z1: z + 0.03, h: 0, kind: '' }, b.h, frame));
      } else if (isRack) {
        // clothes rack: two posts per end and a rail along each long side
        for (const x of [b.x0 + 0.05, b.x1 - 0.05]) S.add(boxMesh({ x0: x - 0.04, x1: x + 0.04, z0: b.z0, z1: b.z1, h: 0, kind: '' }, b.h, frame));
        for (const z of [b.z0 + 0.15, b.z1 - 0.15]) S.add(boxMesh({ x0: b.x0, x1: b.x1, z0: z - 0.025, z1: z + 0.025, h: 0, kind: '' }, 0.05, frame, b.h - 0.08));
      } else {
        S.add(boxMesh({ ...b, z0: (b.z0 + b.z1) / 2 - 0.04, z1: (b.z0 + b.z1) / 2 + 0.04 }, b.h, frame));
      }
      const tiers = isRack ? [b.h - 0.08] : isWall ? [0.25, 0.75, 1.25, 1.7].filter(t => t < b.h) : [0.12, 0.6, 1.08, 1.5].filter(t => t < b.h);
      if (!isRack) for (const t of tiers) S.add(boxMesh(b, 0.04, frame, t));
      // yellow price-tag strips on the shelf edges
      const tagM = mat(0xffe066, q);
      if (!isRack) for (const t of tiers.slice(0, 3)) {
        if (isWall) S.add(boxMesh(face < 0 ? { ...b, x1: b.x0 + 0.03 } : { ...b, x0: b.x1 - 0.03 }, 0.05, tagM, t + 0.02));
        else { S.add(boxMesh({ ...b, z1: b.z0 + 0.03 }, 0.05, tagM, t + 0.02)); S.add(boxMesh({ ...b, z0: b.z1 - 0.03 }, 0.05, tagM, t + 0.02)); }
        // little white price cards (every few one is a red 特價 tag)
        let k = 0;
        if (isWall) for (let z = b.z0 + 0.3; z < b.z1 - 0.2; z += 0.75) put(S, B(0.012, 0.07, 0.13), k++ % 4 === 2 ? basic(0xff6b6b) : basic(0xffffff), openX + face * 0.012, t + 0.045, z);
        else for (let x = b.x0 + 0.35; x < b.x1 - 0.2; x += 0.75) for (const z of [b.z0 - 0.012, b.z1 + 0.012]) put(S, B(0.13, 0.07, 0.012), k++ % 5 === 3 ? basic(0xff6b6b) : basic(0xffffff), x, t + 0.045, z);
      }
      // rounded end caps in the store's accent colour on free-standing units
      if (!isWall && !isRack) for (const x of [b.x0 - 0.03, b.x1 + 0.03]) {
        put(S, RB(0.07, b.h + 0.06, b.z1 - b.z0 + 0.04, 0.03), mat(TH.accent, q), x, (b.h + 0.06) / 2, (b.z0 + b.z1) / 2);
        put(S, CYL(0.17, 0.17, 0.012, 16), basic(PRODUCT_INFO[sh.product].color), x + (x < b.x0 ? -0.04 : 0.04), b.h * 0.6, (b.z0 + b.z1) / 2, 0, 0, Math.PI / 2);
      }
      // product slots
      if (isRack) {
        for (let x = b.x0 + 0.3; x < b.x1 - 0.2; x += 0.24) { slots.push(new THREE.Vector3(x, b.h - 0.45, b.z0 + 0.15)); slots.push(new THREE.Vector3(x, b.h - 0.45, b.z1 - 0.15)); }
      } else if (isWall) {
        for (const t of tiers.slice(0, 3)) for (let z = b.z0 + 0.3; z < b.z1 - 0.2; z += 0.75) slots.push(new THREE.Vector3(openX - face * 0.35, t + 0.16, z));
      } else {
        for (const t of tiers.slice(0, 3)) for (let x = b.x0 + 0.35; x < b.x1 - 0.2; x += 0.75) { slots.push(new THREE.Vector3(x, t + 0.17, b.z0 + 0.2)); slots.push(new THREE.Vector3(x, t + 0.17, b.z1 - 0.2)); }
      }
      }
      // interleave so partially-filled shelves look evenly stocked
      const key = (v: THREE.Vector3, y: number) => (v.x * 7 + v.z * 13 + v.y * y) % 1;
      if (style) { if (!style.ordered) style.slots.sort((a, c) => key(a.p, 3) - key(c.p, 3)); for (const t of style.slots) slots.push(t.p); }
      else slots.sort((a, c) => key(a, 0) - key(c, 0));
      const geo = style?.geometry ?? productGeometry(info.shape);
      const inst = new THREE.InstancedMesh(geo, geo.attributes.color ? this.itemVCMat() : mat(0xffffff, q, { rough: 0.4 }), slots.length);
      const m4 = new THREE.Matrix4();
      const palette = info.palette;
      const col = new THREE.Color(), sc = new THREE.Vector3(), qt = new THREE.Quaternion(), ps = new THREE.Vector3();
      slots.forEach((p, i) => {
        const st = style?.slots[i];
        if (st) { m4.compose(st.p, st.q ?? qt.identity(), st.s ?? sc.set(1, 1, 1)); inst.setMatrixAt(i, m4); inst.setColorAt(i, col.setHex(palette[(i * 7) % palette.length])); return; }
        const v = isRack ? 1 : 0.85 + ((i * 37) % 7) / 20;
        sc.set(v, isRack ? 1 : 0.85 + ((i * 13) % 5) / 12, v); qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), isRack ? 0 : ((i * 53) % 10) / 40);
        ps.set(p.x, p.y + (sc.y - 1) * 0.15, p.z); m4.compose(ps, qt, sc); inst.setMatrixAt(i, m4);
        inst.setColorAt(i, col.setHex(palette[(i * 7) % palette.length]));
      });
      inst.count = 0; inst.castShadow = true; inst.frustumCulled = false;
      S.add(inst);
      this.shelfInst.set(sh.product, { mesh: inst, slots });
      const lbl = this.atlas.mesh(1.2, 0.3, () => textCanvas([{ text: PRODUCT_INFO[sh.product].name, size: 64 }], 512, 128, '#' + PRODUCT_INFO[sh.product].color.toString(16).padStart(6, '0')));
      const ly = style?.labelY ?? b.h + 0.25;
      if (isWall) { lbl.position.set(openX + face * 0.01, ly, (b.z0 + b.z1) / 2); lbl.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2; S.add(lbl); }
      else { lbl.position.set((b.x0 + b.x1) / 2, ly, b.z0 - 0.01); lbl.rotation.y = Math.PI; S.add(lbl); const l2 = lbl.clone(); l2.position.z = b.z1 + 0.01; l2.rotation.y = 0; S.add(l2); }
    }
    // counter
    S.add(boxMesh(COUNTER, COUNTER.h, mat(TH.counter, q)));
    put(S, RB(COUNTER.x1 - COUNTER.x0 + 0.1, 0.06, COUNTER.z1 - COUNTER.z0 + 0.1, 0.025), mat(0xf1f3f5, q, { rough: 0.3 }), (COUNTER.x0 + COUNTER.x1) / 2, COUNTER.h + 0.02, (COUNTER.z0 + COUNTER.z1) / 2);
    const scrM = this.glowMat(0xffffff); scrM.map = posScreenTexture();
    const poleM = this.glowMat(0xffffff); poleM.map = poleTexture();
    for (const r of REGISTERS) {
      // the clerk stands on the low-z side of the counter, customers on the high-z side
      const g = buildRegister(q, TH.accent, scrM, poleM);
      g.position.set(r.x, COUNTER.h + 0.05, r.z);
      mergeInto(g, new Set(), q === 'high');
      S.add(g);
      this.stationLabel('reg' + r.idx, `🧾 收銀台 ${r.idx + 1}`, r.x, 2.1, r.z, r.idx === 1 ? () => this.reg2On : undefined);
      if (r.idx === 1) { this.register2 = [g]; }
    }
    this.buildCounterDetails();
    // food stations (a map may have none)
    const hasCoffee = !!CURRENT_MAP.coffee, hasMeal = !!CURRENT_MAP.meal;
    const SA = (o: THREE.Object3D, on: boolean) => { if (on) S.add(o); };
    const cab = mat(TH.counter, q), slab = mat(0xf1f3f5, q, { rough: 0.35 }), dk = mat(0x343a40, q, { rough: 0.5 }), steel = mat(0xced4da, q, { metal: 0.4, rough: 0.35 });
    const cm = new THREE.Group(); cm.position.set((COFFEE_MACHINE.x0 + COFFEE_MACHINE.x1) / 2, 1.2, (COFFEE_MACHINE.z0 + COFFEE_MACHINE.z1) / 2);
    let coffeeTop: StationInfo | null = null;
    if (hasCoffee) {
      const B0 = COFFEE_MACHINE, cx = cm.position.x, cz = cm.position.z, fz = B0.z1;
      put(S, RB(B0.x1 - B0.x0, 0.86, B0.z1 - B0.z0, 0.04), cab, cx, 0.43, cz);
      put(S, RB(B0.x1 - B0.x0 + 0.06, 0.05, B0.z1 - B0.z0 + 0.06, 0.02), slab, cx, 0.885, cz);
      put(S, RB(0.4, 0.035, 0.03, 0.012), mat(0xadb5bd, q), cx, 0.7, fz + 0.01); // drawer handle
      coffeeTop = buildStation(this.decorCtx(), CURRENT_MAP.id + ':coffee', B0);
      if (!coffeeTop) {
      // the machine: chunky body, accent cheeks, dark brew bay, drip tray, cup, bean hopper, buttons
      put(S, RB(0.66, 0.62, 0.44, 0.08, 2), dk, cx, 1.22, cz);
      for (const sx of [-0.34, 0.34]) put(S, RB(0.03, 0.5, 0.36, 0.015), mat(TH.accent, q), cx + sx, 1.22, cz);
      put(S, RB(0.36, 0.26, 0.04, 0.03), mat(0x1b1d22, q), cx - 0.08, 1.08, cz + 0.205);
      put(S, RB(0.3, 0.025, 0.14, 0.01), steel, cx - 0.08, 0.95, cz + 0.22);
      put(S, CYL(0.025, 0.02, 0.06, 8), steel, cx - 0.08, 1.2, cz + 0.2);
      put(S, CYL(0.045, 0.035, 0.1, 10), mat(0xffffff, q), cx - 0.08, 1.015, cz + 0.2);
      put(S, CYL(0.12, 0.1, 0.2, 10), mat(0x8b5a2b, q, { rough: 0.4 }), cx + 0.12, 1.63, cz - 0.04);
      put(S, CYL(0.125, 0.125, 0.03, 10), dk, cx + 0.12, 1.745, cz - 0.04);
      const scr = new THREE.Mesh(geo('cmScr', () => new THREE.PlaneGeometry(0.16, 0.08)), this.glowMat(0x96f2d7)); scr.position.set(cx + 0.18, 1.38, cz + 0.222); S.add(scr);
      [0xff8787, 0x69db7c, 0xffd43b].forEach((c, i) => put(S, CYL(0.022, 0.022, 0.02, 8), basic(c), cx + 0.13 + i * 0.05, 1.24, cz + 0.225, Math.PI / 2));
      for (let i = 0; i < 3; i++) put(S, CYL(0.04, 0.03, 0.09, 8), mat([0xffffff, 0xffd8a8, 0xffffff][i], q), cx - 0.3 + i * 0.09, 0.955, cz - 0.28); // cup stack
      }
    }
    // steam puffs rise from the machine's spout (store-specific machines say where that is)
    this.steamBase.copy(coffeeTop?.steam ?? new THREE.Vector3(cm.position.x, 1.55, cm.position.z));
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })); st.position.copy(this.steamBase); SA(st, hasCoffee); this.coffeeSteam.push(st); }
    if (hasCoffee) this.stationLabel('coffee' + FOOD_INFO.coffee.station, `${FOOD_INFO.coffee.icon} ${FOOD_INFO.coffee.station}`, cm.position.x, 2.15, cm.position.z);
    const mw = new THREE.Group(); mw.position.set((MICROWAVE.x0 + MICROWAVE.x1) / 2, 1.12, (MICROWAVE.z0 + MICROWAVE.z1) / 2);
    let customMeal = false, mealTop: StationInfo | null = null;
    if (hasMeal) {
      const B0 = MICROWAVE, cx = mw.position.x, cz = mw.position.z, fz = B0.z1 - 0.16;
      put(S, RB(B0.x1 - B0.x0, 0.86, B0.z1 - B0.z0, 0.04), cab, cx, 0.43, cz);
      put(S, RB(B0.x1 - B0.x0 + 0.06, 0.05, B0.z1 - B0.z0 + 0.06, 0.02), slab, cx, 0.885, cz);
      mealTop = buildStation(this.decorCtx(), CURRENT_MAP.id + ':meal', B0);
      customMeal = !!mealTop;
      if (!customMeal) {
      put(S, RB(0.8, 0.46, 0.46, 0.07, 2), mat(0xfff9f0, q, { rough: 0.4 }), cx, 1.14, fz - 0.23);
      put(S, RB(0.5, 0.34, 0.03, 0.03), mat(TH.accent, q), cx - 0.08, 1.12, fz - 0.005);
      put(S, RB(0.04, 0.26, 0.04, 0.015), steel, cx + 0.2, 1.12, fz + 0.02);
      for (let i = 0; i < 2; i++) put(S, CYL(0.035, 0.035, 0.03, 10), dk, cx + 0.31, 1.2 - i * 0.12, fz + 0.01, Math.PI / 2);
      for (const sx of [-0.3, 0.3]) put(S, CYL(0.03, 0.03, 0.03, 6), dk, cx + sx, 0.92, fz - 0.05); // feet
      }
    }
    const mwDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.27), new THREE.MeshBasicMaterial({ color: 0x212529 })); mwDoor.position.set(mw.position.x - 0.08, 1.12, MICROWAVE.z1 - 0.14); mwDoor.rotation.y = 0; SA(mwDoor, hasMeal && !customMeal);
    // heat glow while someone prepares food: the microwave window, or the spot a store-specific machine names
    this.microwaveGlow = mealTop?.glow ? stationGlowMesh(mealTop.glow) : new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.28), new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0 }));
    if (!mealTop) this.microwaveGlow.position.set(mw.position.x - 0.08, 1.12, MICROWAVE.z1 - 0.135);
    this.microwaveGlow.userData.dynamic = true;
    SA(this.microwaveGlow, hasMeal && (!customMeal || !!mealTop?.glow));
    if (hasMeal) this.stationLabel('mw' + FOOD_INFO.meal.station, `${FOOD_INFO.meal.icon} ${FOOD_INFO.meal.station}`, mw.position.x, 2.15, mw.position.z);
    const pickupMark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.35 })); pickupMark.rotation.x = -Math.PI / 2; pickupMark.position.set(COFFEE_PICKUP.x, 0.01, COFFEE_PICKUP.z); SA(pickupMark, hasCoffee || hasMeal);
    if (hasCoffee || hasMeal) this.stationLabel('pick', '🛎 取餐區', COFFEE_PICKUP.x, 2.3, COFFEE_PICKUP.z, undefined, '#ffc23d');
    const compMark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.3 })); compMark.rotation.x = -Math.PI / 2; compMark.position.set(COMPLAINT_SPOT.x, 0.01, COMPLAINT_SPOT.z); S.add(compMark);
    // queue rope
    const R = CURRENT_MAP.rope;
    if (R) {
      const brass = mat(0xfab005, q, { metal: 0.3, rough: 0.35 });
      for (let x = R.x0; x <= R.x1 + 0.01; x += 1) {
        put(S, CYL(0.035, 0.045, 0.86, 8), brass, x, 0.45, R.z);
        put(S, CYL(0.17, 0.19, 0.05, 12), mat(0x343a40, q), x, 0.025, R.z);
        put(S, SPH(0.065, 8, 6), brass, x, 0.9, R.z);
      }
      // velvet rope sagging between the posts
      for (let x = R.x0; x < R.x1 - 0.01; x += 1) put(S, geo('ropeSag', () => new THREE.TorusGeometry(0.5, 0.025, 4, 12, Math.PI).rotateZ(Math.PI)), mat(0xc92a2a, q), x + 0.5, 0.86, R.z, 0, 0, 0, 1, 0.25, 1);
    }
    // crates
    for (const c of CRATES) {
      S.add(boxMesh(c.box, 0.12, mat(0x795548, q)));
      const stack = new THREE.Group(); S.add(stack); this.crateStacks.set(c.product, stack);
      this.stationLabel('cr' + c.product, `📦 ${PRODUCT_INFO[c.product].name}貨箱`, (c.box.x0 + c.box.x1) / 2, 2.2, (c.box.z0 + c.box.z1) / 2);
    }
    // mop rack
    S.add(boxMesh(MOP_RACK, 0.1, mat(0x495057, q)));
    for (let i = 0; i < 2; i++) {
      const mop = heldModel(q, { kind: 'mop' }); mop.rotation.x = -0.5; mop.position.set(0.35, 0.65, MOP_RACK.z0 + 0.4 + i * 0.6); S.add(mop); this.mopsOnRack.push(mop);
    }
    this.stationLabel('mop', '🧹 拖把', 0.5, 2.0, (MOP_RACK.z0 + MOP_RACK.z1) / 2);
    this.buildDecor();
    // posters
    const poster = this.atlas.mesh(2.2, 1.1, () => textCanvas([{ text: CURRENT_MAP.poster[0], size: 72, color: '#ffd43b' }, { text: CURRENT_MAP.poster[1], size: 54 }], 512, 256, CURRENT_MAP.sign.bg));
    poster.position.set(12, 2.0, 0.02); S.add(poster);
    put(S, RB(2.32, 1.22, 0.02, 0.008), mat(0xf8f9fa, q), 12, 2.0, 0.0);
    this.buildDetails();
    this.buildWallDecor();
  }

  /**
   * Cheap wall dressing (all merged into the static meshes, no collisions): crown moulding, an analog clock, AC units,
   * a menu / price board, framed pictures, a staff notice board and light switches. Spots that something tall stands
   * in front of (shelves, fridges, fitting rooms, the ATM) or that already carry a poster/sign are skipped.
   */
  private buildWallDecor() {
    const q = this.q, S = this.scene, TH = CURRENT_MAP.theme;
    type Face = 'N' | 'W' | 'E' | 'SS' | 'SN';
    // posters / signs already on the walls: [face, t0, t1, y0]
    const reserved: [Face, number, number, number][] = [['N', 7.9, 9.3, 1.9], ['N', 10.8, 13.2, 1.3], ['N', 14.9, 16.3, 1.9], ['SS', 2.5, 4.3, 0]];
    const blocked = (f: Face, t0: number, t1: number, y0: number) => {
      for (const b of SOLIDS) {
        if (b.kind === 'wall') continue;
        const h = b.kind === 'atm' ? 2.2 : b.kind === 'fridge' || b.kind === 'wallshelf' ? b.h + 0.55 : b.h; // the ATM's sign / wall units' headers and name labels sit above them
        const [near, s0, s1] = f === 'N' ? [b.z0 < 1.2, b.x0, b.x1] : f === 'W' ? [b.x0 < 1.2, b.z0, b.z1] : f === 'E' ? [b.x1 > STORE_W - 1.2, b.z0, b.z1]
          : f === 'SS' ? [b.z0 < 6.4 && b.z1 > 5.25, b.x0, b.x1] : [b.z1 > 3.9 && b.z0 < 5, b.x0, b.x1];
        if (near && s1 > t0 - 0.1 && s0 < t1 + 0.1 && h > y0 - 0.05) return true;
      }
      return reserved.some(([rf, a, b, ry]) => rf === f && b > t0 && a < t1 && y0 >= ry - 1.2);
    };
    /** Position + yaw of a point `off` metres out from a wall face. */
    const at = (f: Face, t: number, off: number): [number, number, number] =>
      f === 'N' ? [t, off, 0] : f === 'W' ? [off, t, Math.PI / 2] : f === 'E' ? [STORE_W - off, t, -Math.PI / 2] : f === 'SS' ? [t, 5.25 + off, 0] : [t, 5 - off, Math.PI];
    const place = (cands: [Face, number][], w: number, y0: number, y1: number) => {
      const c = cands.find(([f, t]) => !blocked(f, t - w / 2, t + w / 2, y0));
      if (c) reserved.push([c[0], c[1] - w / 2, c[1] + w / 2, y0 + 1.2]);
      return c ?? null;
    };
    const box = (f: Face, t: number, y: number, off: number, g: THREE.BufferGeometry, m: THREE.Material, rz = 0) => {
      const [x, z, ry] = at(f, t, off); return put(S, g, m, x, y, z, 0, ry, rz);
    };
    const ink = basic(0x2a1f3d), white = mat(0xffffff, q), accent = mat(TH.accent, q);

    // crown moulding along the top of the solid walls
    const trim = mat(0xfffaf0, q), e = 0.025;
    for (const w of WALLS) if (w.z0 < STORE_D - 0.01) S.add(boxMesh({ ...w, x0: w.x0 - e, x1: w.x1 + e, z0: w.z0 - e, z1: w.z1 + e }, 0.09, trim, 3.06));

    // analog wall clock (hands follow the game clock)
    const ck = place([['N', 18.5], ['N', 20.2], ['E', 10]], 0.62, 2.15, 2.85);
    if (ck) {
      const [f, t] = ck, y = 2.5;
      box(f, t, y, 0.03, CYL(0.3, 0.3, 0.05, 24), accent, 0).rotateX(Math.PI / 2);
      box(f, t, y, 0.06, CYL(0.25, 0.25, 0.02, 24), white).rotateX(Math.PI / 2);
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, r = 0.205, [x, z, ry] = at(f, t, 0.075);
        const o = new THREE.Object3D(); o.rotation.y = ry; o.updateMatrix();
        const p = new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r, 0).applyMatrix4(o.matrix);
        put(S, B(i % 3 ? 0.014 : 0.026, i % 3 ? 0.035 : 0.06, 0.01), ink, x + p.x, y + p.y, z + p.z, 0, ry, -a);
      }
      const [x, z, ry] = at(f, t, 0.085);
      const hands = new THREE.Group(); hands.position.set(x, y, z); hands.rotation.y = ry; S.add(hands);
      const hand = (len: number, wd: number, zo: number) => {
        const pv = new THREE.Group(); pv.position.z = zo; hands.add(pv);
        put(pv, B(wd, len, 0.008), ink, 0, len / 2 - 0.02, 0); return pv;
      };
      this.clockHands = [hand(0.13, 0.026, 0), hand(0.19, 0.016, 0.008)];
      put(hands, CYL(0.022, 0.022, 0.02, 10), basic(TH.accent), 0, 0, 0.012, Math.PI / 2);
    }

    // AC units high on the wall (white body, dark vent slot, a green power light)
    for (const ac of [place([['N', 17.1], ['N', 21.9], ['N', 9.9]], 1.1, 2.5, 3.0), place([['E', 5], ['E', 12.5], ['W', 6]], 1.1, 2.5, 3.0)]) {
      if (!ac) continue;
      const [f, t] = ac;
      box(f, t, 2.76, 0.13, RB(1.05, 0.32, 0.24, 0.06, 2), mat(0xf8f9fa, q, { rough: 0.5 }));
      box(f, t, 2.65, 0.255, B(0.9, 0.035, 0.012), mat(0x495057, q));
      for (let i = 0; i < 3; i++) box(f, t, 2.84 - i * 0.045, 0.252, B(0.86, 0.01, 0.006), mat(0xdee2e6, q));
      const [x, z, ry] = at(f, t, 0.256); const o = new THREE.Vector3(0.43, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      put(S, SPH(0.012, 6, 4), basic(0x51cf66), x + o.x, 2.7, z + o.z);
    }

    // menu / price board in the shop's colours
    const mb = place([['N', 20.9], ['N', 17.3], ['E', 10.6], ['E', 12.4]], 1.7, 1.75, 2.8);
    if (mb) {
      const [f, t] = mb;
      box(f, t, 2.3, 0.025, RB(1.72, 1.0, 0.05, 0.02), mat(0x8d6e63, q));
      const m = this.atlas.mesh(1.6, 0.88, () => menuBoardCanvas());
      const [x, z, ry] = at(f, t, 0.055); m.position.set(x, 2.3, z); m.rotation.y = ry; S.add(m);
    }

    // framed pictures (procedural art, no text)
    const pics: [[Face, number][], number, number, number][] = [
      [[['E', 12.6], ['E', 10.4], ['W', 14.4]], 0.8, 0.6, 1.75],
      [[['W', 14.4], ['W', 5.9], ['E', 14.6]], 0.6, 0.75, 1.8],
      [[['N', 7.35], ['SS', 1.3], ['E', 9.1]], 0.5, 0.62, 1.75],
      [[['SS', 1.3], ['SS', 0.7], ['W', 11.6]], 0.6, 0.5, 1.7],
    ];
    const frameM = [mat(0x8d6e63, q), mat(0xfffaf0, q), mat(0x2a1f3d, q), accent];
    pics.forEach(([cands, w, h, y], i) => {
      const pc = place(cands, w + 0.1, y - h / 2 - 0.05, y + h / 2 + 0.05);
      if (!pc) return;
      const [f, t] = pc;
      box(f, t, y, 0.02, RB(w + 0.1, h + 0.1, 0.04, 0.015), frameM[i % frameM.length]);
      const m = this.atlas.mesh(w - 0.02, h - 0.02, () => artCanvas(i));
      const [x, z, ry] = at(f, t, 0.042); m.position.set(x, y, z); m.rotation.y = ry; S.add(m);
    });

    // staff notice board: cork with pinned notes, by the stockroom
    const nb = place([['SS', 5.35], ['SS', 1.2], ['E', 9.3]], 1.15, 1.05, 1.95);
    if (nb) {
      const [f, t] = nb;
      box(f, t, 1.5, 0.02, RB(1.15, 0.8, 0.04, 0.02), mat(0x6d4c41, q));
      box(f, t, 1.5, 0.035, B(1.03, 0.68, 0.02), mat(0xd4a373, q));
      const notes: [number, number, number, number, number][] = [[-0.34, 0.12, 0.26, 0.3, 0xfff9db], [-0.02, 0.15, 0.24, 0.22, 0xd0ebff], [0.3, 0.1, 0.24, 0.32, 0xffffff],
        [-0.3, -0.18, 0.3, 0.2, 0xffdeeb], [0.05, -0.14, 0.26, 0.26, 0xd3f9d8], [0.34, -0.2, 0.2, 0.16, 0xfff3bf]];
      const pins = [0xff5d5d, 0x48a6ff, 0xffc23d, 0x39c96b];
      notes.forEach(([dx, dy, w, h, c], i) => {
        const [x, z, ry] = at(f, t, 0.048); const v = new THREE.Vector3(dx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        put(S, B(w, h, 0.006), mat(c, q), x + v.x, 1.5 + dy, z + v.z, 0, ry, ((i * 37) % 7 - 3) * 0.03);
        for (let l = 0; l < 3; l++) put(S, B(w * (0.75 - l * 0.12), 0.012, 0.004), basic(0xadb5bd), x + v.x * 1.0, 1.5 + dy + h * 0.2 - l * 0.05, z + v.z, 0, ry, 0);
        const [px, pz] = at(f, t, 0.058); const pv = new THREE.Vector3(dx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        put(S, SPH(0.018, 6, 4), basic(pins[i % pins.length]), px + pv.x, 1.5 + dy + h / 2 - 0.03, pz + pv.z);
      });
    }

    // light switches beside the stockroom doorway (both sides of the wall)
    for (const [f, t] of [['SS', 4.45], ['SN', 4.45]] as [Face, number][]) {
      if (blocked(f, t - 0.1, t + 0.1, 1.1)) continue;
      box(f, t, 1.25, 0.012, RB(0.09, 0.13, 0.02, 0.008), white);
      box(f, t, 1.25, 0.024, RB(0.03, 0.05, 0.012, 0.005), mat(0xdee2e6, q));
    }
  }

  /** Floating station name (cream pill). Hidden when the camera is right next to it: the interaction prompt says it then. */
  private stationLabel(key: string, text: string, x: number, y: number, z: number, on: () => boolean = () => true, bg?: string) {
    const l = new Label({ k: 0.0024, maxScreen: 0.05, minScreen: 0.034, fade: [1.3, 2.3] });
    l.set(key, () => pillCanvas({ text, size: 46, bg }));
    l.sprite.position.set(x, y, z); l.sprite.userData.dynamic = true; this.scene.add(l.sprite);
    this.stationLabels.push({ l, on });
    return l;
  }

  /** Is a floor spot free for a purely visual prop (not in anyone's way)? */
  private freeSpot(x: number, z: number, r: number) {
    if (x < r || z < r || x > STORE_W - r || z > STORE_D - r) return false;
    for (const b of SOLIDS) if (b.kind !== 'wall' && distToAABB(x, z, b) < r) return false;
    const spots = [...QUEUE_SPOTS, ...PLAYER_SPAWNS, ...WANDER_SPOTS, ...TRYON_SPOTS, CHARGE_SPOT, COFFEE_PICKUP, COMPLAINT_SPOT, ...REGISTERS.flatMap(g => [g.cashier, g.customer])];
    for (const p of spots) if (Math.hypot(p.x - x, p.z - z) < r + 0.7) return false;
    if (Math.abs(x - (DOOR_X0 + DOOR_X1) / 2) < 2 && z > STORE_D - 2.5) return false; // door lane
    return true;
  }
  private pick(cands: [number, number][], r: number) { return cands.find(([x, z]) => this.freeSpot(x, z, r)) ?? null; }

  /** Counter trim plus the little things on it: tip jar, impulse-snack rack, service bell, lucky cat. */
  private buildCounterDetails() {
    const q = this.q, S = this.scene, TH = CURRENT_MAP.theme, C = COUNTER;
    const len = C.x1 - C.x0, cx = (C.x0 + C.x1) / 2, cz = (C.z0 + C.z1) / 2, top = C.h + 0.05;
    const acc = mat(TH.accent, q), darkM = mat(0x343a40, q);
    // customer-side face: accent band, panel grooves, kick plates
    put(S, B(len + 0.02, 0.14, 0.03), acc, cx, C.h - 0.2, C.z1 + 0.005);
    put(S, B(len + 0.02, 0.1, 0.03), darkM, cx, 0.05, C.z1 + 0.005);
    put(S, B(len + 0.02, 0.1, 0.03), darkM, cx, 0.05, C.z0 - 0.005);
    const groove = mat(new THREE.Color(TH.counter).multiplyScalar(0.8).getHex(), q);
    for (let x = C.x0 + 1; x < C.x1 - 0.5; x += 1) put(S, B(0.03, C.h - 0.4, 0.02), groove, x, 0.1 + (C.h - 0.4) / 2 + 0.02, C.z1 + 0.005);
    // anti-fatigue mat for the clerks
    put(S, RB(len - 0.4, 0.02, 0.6, 0.01), mat(0x2b2d42, q), cx, 0.01, C.z0 - 0.45);
    // free counter spots away from the registers
    const xs: number[] = [];
    for (let x = C.x0 + 0.3; x <= C.x1 - 0.3; x += 0.05) if (REGISTERS.every(r => Math.abs(r.x - x) > 0.6)) xs.push(x);
    const take = (x: number) => { for (let i = xs.length - 1; i >= 0; i--) if (Math.abs(xs[i] - x) < 0.35) xs.splice(i, 1); };
    const nearest = (x: number) => xs.length ? xs.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a) : null;
    // impulse snack rack between the registers
    const mid = nearest((REGISTERS[0].x + REGISTERS[1].x) / 2);
    if (mid !== null) {
      take(mid);
      const z = C.z1 - 0.2;
      put(S, RB(0.36, 0.03, 0.2, 0.01), mat(0xadb5bd, q, { metal: 0.5, rough: 0.4 }), mid, top + 0.015, z);
      for (const sx of [-0.17, 0.17]) put(S, B(0.02, 0.4, 0.02), mat(0xadb5bd, q, { metal: 0.5, rough: 0.4 }), mid + sx, top + 0.2, z - 0.08);
      const pal = CURRENT_MAP.products.snacks.palette;
      for (let t = 0; t < 2; t++) {
        put(S, B(0.36, 0.015, 0.18), mat(0xadb5bd, q, { metal: 0.5, rough: 0.4 }), mid, top + 0.03 + t * 0.18, z);
        for (let i = 0; i < 4; i++) put(S, RB(0.075, 0.12, 0.05, 0.015), mat(pal[(i + t * 2) % pal.length], q), mid - 0.12 + i * 0.08, top + 0.1 + t * 0.18, z, -0.2);
      }
    }
    // tip jar (glass) with coins, on the customer side
    const tj = nearest(C.x1 - 0.4);
    if (tj !== null) {
      take(tj);
      const jar = new THREE.Mesh(CYL(0.085, 0.08, 0.2, 12, true), mat(0xd0ebff, q, { transparent: true, opacity: 0.35, rough: 0.1 }));
      jar.position.set(tj, top + 0.1, C.z1 - 0.2); S.add(jar);
      put(S, CYL(0.075, 0.075, 0.05, 10), mat(0xfcc419, q, { metal: 0.6, rough: 0.35 }), tj, top + 0.03, C.z1 - 0.2);
      put(S, TOR(0.085, 0.012, 4, 14), mat(0xd0ebff, q), tj, top + 0.2, C.z1 - 0.2, Math.PI / 2);
      const tag = this.atlas.mesh(0.14, 0.07, () => textCanvas([{ text: 'TIPS ♥', size: 50, color: '#fff' }], 256, 128, hex(TH.accent)));
      tag.position.set(tj, top + 0.1, C.z1 - 0.11); S.add(tag);
    }
    // service bell on the customer side
    const bl = nearest(REGISTERS[0].x - 0.7);
    if (bl !== null) {
      take(bl);
      put(S, CYL(0.07, 0.075, 0.02, 12), darkM, bl, top + 0.01, C.z1 - 0.15);
      put(S, DOME(0.055, Math.PI / 2, 12, 4), mat(0xfcc419, q, { metal: 0.8, rough: 0.25 }), bl, top + 0.02, C.z1 - 0.15);
      put(S, SPH(0.012, 6, 4), mat(0xfcc419, q, { metal: 0.8, rough: 0.25 }), bl, top + 0.08, C.z1 - 0.15);
    }
    // lucky cat (招財貓) waving at the customers
    const lc = nearest(C.x0 + 0.3);
    if (lc !== null) {
      take(lc);
      const cat = new THREE.Group(); cat.position.set(lc, top, cz); cat.rotation.y = 0.3;
      const w = mat(0xfffaf0, q, { rough: 0.5 }), red = basic(0xe03131), blk = basic(0x222222), gold = mat(0xfcc419, q, { metal: 0.6, rough: 0.3 });
      put(cat, RB(0.16, 0.14, 0.12, 0.05), w, 0, 0.07, 0);
      put(cat, SPH(0.085, 10, 8), w, 0, 0.2, 0, 0, 0, 0, 1.1, 0.95, 0.95);
      for (const s of [-1, 1]) put(cat, CONE(0.03, 0.05, 4), w, s * 0.055, 0.285, 0, 0, 0, -s * 0.3);
      for (const s of [-1, 1]) put(cat, SPH(0.012, 5, 4), blk, s * 0.03, 0.21, 0.078);
      put(cat, B(0.13, 0.02, 0.1), red, 0, 0.135, 0.01); // collar
      put(cat, SPH(0.02, 6, 4), gold, 0, 0.12, 0.06); // bell
      put(cat, CAP(0.025, 0.06, 6), w, 0.075, 0.22, 0.02, 0, 0, -0.2); // raised paw
      put(cat, RB(0.06, 0.04, 0.03, 0.01), gold, -0.03, 0.06, 0.06); // koban coin
      mergeInto(cat, new Set(), q === 'high'); S.add(cat);
    }
  }

  private glassGeos: THREE.BufferGeometry[] = [];
  private ctx: DecorCtx | null = null;
  /** Context for the store-specific props in decor.ts (glass pieces are merged into one mesh at the end of buildDecor). */
  private decorCtx(): DecorCtx {
    return this.ctx ??= {
      scene: this.scene, q: this.q, theme: CURRENT_MAP.theme, campSpots: CAMP_SPOTS,
      glow: c => this.glowMat(c),
      glass: (g, m) => { const c = g.clone().applyMatrix4(m); for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k); this.glassGeos.push(c.index ? c.toNonIndexed() : c); },
      sign: (w, h, draw) => this.atlas.mesh(w, h, draw),
    };
  }

  /** Map decor (plants, ATM, tables, bars, fitting rooms, mannequins, displays) as chunky toy props. */
  private buildDecor() {
    const q = this.q, S = this.scene, TH = CURRENT_MAP.theme;
    const glassGeos = this.glassGeos, ctx = this.decorCtx();
    for (const d of DECOR) {
      if (STORE_DECOR.has(d.kind)) { buildStoreDecor(ctx, d); continue; }
      const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2, w = d.x1 - d.x0, dp = d.z1 - d.z0;
      if (d.kind === 'plant') this.plant(cx, cz, Math.min(w, dp) * 0.9, 1.3);
      else if (d.kind === 'atm') {
        const face = d.x0 < 1 ? 1 : -1, fx = face > 0 ? d.x1 : d.x0;
        put(S, RB(w, 1.9, dp, 0.08, 2), mat(0x1971c2, q, { rough: 0.5 }), cx, 0.95, cz);
        put(S, RB(0.06, 0.3, dp - 0.3, 0.02), mat(0x0b4f8a, q), fx, 1.4, cz);
        const scr = new THREE.Mesh(geo('atmScr', () => new THREE.PlaneGeometry(dp * 0.45, 0.24)), this.glowMat(0x99e9f2)); scr.position.set(fx + face * 0.035, 1.4, cz); scr.rotation.y = face * Math.PI / 2; S.add(scr);
        put(S, RB(0.22, 0.06, dp - 0.6, 0.02), mat(0xdee2e6, q), fx + face * 0.06, 1.05, cz, 0, 0, face * -0.3);
        for (let i = 0; i < 9; i++) put(S, B(0.02, 0.012, 0.05), basic(i === 8 ? 0x51cf66 : 0x495057), fx + face * 0.1, 1.09, cz - 0.08 + (i % 3) * 0.08, 0, 0, face * -0.3);
        put(S, B(0.02, 0.02, 0.18), basic(0x212529), fx + face * 0.01, 1.2, cz + 0.4);
        const sign = this.atlas.mesh(dp * 0.8, 0.22, () => textCanvas([{ text: '🏧 ATM 提款機', size: 56 }], 512, 128, '#0b4f8a'));
        sign.position.set(fx + face * 0.01, 1.75, cz); sign.rotation.y = face * Math.PI / 2; S.add(sign);
      } else if (d.kind === 'table') {
        put(S, CYL(0.06, 0.06, d.h - 0.05, 8), mat(0x495057, q), cx, (d.h - 0.05) / 2, cz);
        put(S, CYL(0.3, 0.32, 0.04, 14), mat(0x495057, q), cx, 0.02, cz);
        put(S, CYL(Math.min(w, dp) / 2 + 0.05, Math.min(w, dp) / 2, 0.06, 18), mat(0xf8f9fa, q, { rough: 0.4 }), cx, d.h - 0.03, cz);
        put(S, CYL(Math.min(w, dp) / 2 + 0.06, Math.min(w, dp) / 2 + 0.06, 0.02, 18), mat(TH.accent, q), cx, d.h - 0.07, cz);
        put(S, CYL(0.04, 0.05, 0.12, 8), mat(0xf03e3e, q), cx - 0.12, d.h + 0.06, cz); // ketchup
        put(S, CYL(0.04, 0.05, 0.12, 8), mat(0xfab005, q), cx - 0.03, d.h + 0.06, cz + 0.03); // mustard
        for (const sx of [d.x0 - 0.35, d.x1 + 0.35]) {
          put(S, CYL(0.05, 0.07, 0.4, 8), mat(0x495057, q), sx, 0.2, cz);
          put(S, CYL(0.2, 0.18, 0.08, 12), mat(TH.accent, q), sx, 0.44, cz);
        }
      } else if (d.kind === 'bar') {
        put(S, RB(w, d.h - 0.06, dp, 0.04), mat(TH.counter, q), cx, (d.h - 0.06) / 2, cz);
        put(S, RB(w + 0.1, 0.06, dp + 0.12, 0.025), mat(0xf8f9fa, q, { rough: 0.35 }), cx, d.h - 0.03, cz);
        put(S, B(w, 0.1, 0.02), mat(TH.accent, q), cx, d.h - 0.25, d.z0 - 0.005);
        for (let x = d.x0 + 0.6; x < d.x1 - 0.3; x += 1.4) { // napkin box + straw cup
          put(S, RB(0.12, 0.08, 0.1, 0.02), mat(0xffffff, q), x, d.h + 0.04, cz);
          put(S, CYL(0.04, 0.035, 0.12, 8), mat(TH.accent, q), x + 0.15, d.h + 0.06, cz);
        }
      } else if (d.kind === 'fitting') {
        put(S, RB(0.08, d.h, dp, 0.02), mat(TH.wainscot, q), d.x0 + 0.04, d.h / 2, cz);
        put(S, RB(w, d.h, 0.08, 0.02), mat(TH.wainscot, q), cx, d.h / 2, d.z0 + 0.04);
        put(S, RB(w, d.h, 0.08, 0.02), mat(TH.wainscot, q), cx, d.h / 2, d.z1 - 0.04);
        put(S, CYL(0.025, 0.025, dp, 6), mat(0xadb5bd, q, { metal: 0.6, rough: 0.3 }), d.x1 - 0.03, d.h - 0.08, cz, Math.PI / 2);
        // wavy curtain: a row of soft folds
        for (let z = d.z0 + 0.15; z < d.z1 - 0.1; z += 0.17) put(S, CAP(0.06, d.h - 0.45, 6), mat(TH.accent, q), d.x1 - 0.04, d.h / 2 + 0.02, z);
        put(S, RB(0.04, 0.9, 0.4, 0.02), mat(0xdbe4ff, q, { rough: 0.15, metal: 0.3 }), d.x0 + 0.09, 1.3, cz); // mirror
        this.stationLabel('fit', '👗 試衣間', cx, d.h + 0.35, cz);
      } else if (d.kind === 'mannequin') {
        const wm = mat(0xf1f3f5, q, { rough: 0.5 });
        put(S, CYL(0.25, 0.28, 0.06, 14), mat(0x495057, q), cx, 0.03, cz);
        put(S, CYL(0.025, 0.025, 0.75, 6), mat(0x495057, q), cx, 0.4, cz);
        put(S, CYL(0.17, 0.22, 0.6, 12), mat(TH.accent, q), cx, 1.05, cz);
        put(S, DOME(0.17, Math.PI / 2, 12, 4), mat(TH.accent, q), cx, 1.35, cz, 0, 0, 0, 1, 0.5, 1);
        put(S, CYL(0.05, 0.06, 0.1, 8), wm, cx, 1.45, cz);
        put(S, SPH(0.2, 12, 10), wm, cx, 1.66, cz);
        for (const s of [-1, 1]) put(S, CAP(0.055, 0.3, 6), mat(TH.accent, q), cx + s * 0.22, 1.12, cz, 0, 0, s * 0.15);
        put(S, DOME(0.215, Math.PI * 0.4, 12, 4), mat(0x212529, q), cx, 1.68, cz, -0.3); // hat
        put(S, CYL(0.3, 0.3, 0.02, 14), mat(0x212529, q), cx, 1.75, cz);
      } else if (d.kind === 'display') {
        // promo island: accent base, pyramid of product boxes, a 特價 sign
        put(S, RB(w, 0.45, dp, 0.06, 2), mat(TH.accent, q), cx, 0.225, cz);
        put(S, RB(w + 0.04, 0.05, dp + 0.04, 0.02), mat(0xf8f9fa, q), cx, 0.47, cz);
        const pal = CURRENT_MAP.products.snacks.palette;
        let i = 0;
        for (let lvl = 0; lvl < 3; lvl++) for (let a = 0; a < 3 - lvl; a++) for (let b = 0; b < 3 - lvl; b++) {
          const x = cx + (a - (2 - lvl) / 2) * 0.28, z = cz + (b - (2 - lvl) / 2) * 0.28;
          put(S, RB(0.24, 0.2, 0.24, 0.03), mat(pal[i++ % pal.length], q), x, 0.6 + lvl * 0.2, z);
        }
        put(S, CYL(0.015, 0.015, 0.6, 6), mat(0x495057, q), cx, 1.4, cz);
        // two-sided sale sign from the shared sign atlas (no per-sign texture or draw call)
        for (const back of [0, 1]) {
          const sale = this.atlas.mesh(0.7, 0.35, () => textCanvas([{ text: '特價 SALE', size: 60, color: '#fff' }], 512, 256, '#f03e3e'));
          sale.position.set(cx - Math.sin(0.4) * 0.005 * (back ? 1 : -1), 1.75, cz - Math.cos(0.4) * 0.005 * (back ? 1 : -1)); sale.rotation.y = 0.4 + back * Math.PI; S.add(sale);
        }
      }
      else { put(S, RB(w, d.h, dp, 0.05), mat(0xfab005, q), cx, d.h / 2, cz); }
    }
    buildStoreExtras(ctx, CURRENT_MAP.id);
    // all display-case glass in one transparent mesh (one draw call)
    if (glassGeos.length) {
      const gm = new THREE.Mesh(mergeGeometries(glassGeos, false)!, mat(0xd0ebff, q, { transparent: true, opacity: 0.22, rough: 0.05 }));
      gm.renderOrder = 2; S.add(gm);
    }
  }

  /** Chunky potted plant: pot with a rim, soil, a cluster of faceted leaf blobs. */
  private plant(x: number, z: number, size: number, h: number) {
    const q = this.q, S = this.scene, TH = CURRENT_MAP.theme;
    const r = Math.max(0.18, size * 0.38);
    put(S, CYL(r, r * 0.8, h * 0.38, 10), mat(0xd9825b, q), x, h * 0.19, z);
    put(S, CYL(r * 1.12, r * 1.12, 0.08, 10), mat(TH.accent, q), x, h * 0.38, z);
    put(S, CYL(r * 0.98, r * 0.98, 0.02, 10), mat(0x5c4033, q), x, h * 0.4, z);
    const leaf = geo('leafBlob', () => new THREE.IcosahedronGeometry(1, 0));
    const greens = [0x37b24d, 0x51cf66, 0x2f9e44];
    const blobs = [[0, 0.75, 0, 0.42], [-0.22, 0.6, 0.12, 0.3], [0.24, 0.62, -0.08, 0.32], [0.05, 0.95, -0.1, 0.28], [-0.1, 0.62, -0.25, 0.26]];
    blobs.forEach(([bx, by, bz, br], i) => put(S, leaf, mat(greens[i % 3], q), x + bx * size * 1.3, h * by, z + bz * size * 1.3, i, i * 2, 0, br * size * 1.5));
    for (const [fx, fy, fz] of [[0.2, 0.9, 0.2], [-0.25, 0.75, -0.1], [0.05, 1.18, 0.1]]) put(S, SPH(0.05, 6, 4), basic(0xffd43b), x + fx * size, h * fy, z + fz * size);
  }

  /** Small cute props around the store: door mat, frames, trash can, wet-floor sign, posters, extinguisher, camera. */
  private buildDetails() {
    const q = this.q, S = this.scene, TH = CURRENT_MAP.theme;
    const acc = hex(TH.accent);
    // welcome mat inside the door
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g2 = c.getContext('2d')!;
    g2.fillStyle = '#343a40'; g2.fillRect(0, 0, 512, 256);
    g2.strokeStyle = acc; g2.lineWidth = 18; g2.strokeRect(14, 14, 484, 228);
    g2.fillStyle = 'rgba(255,255,255,0.06)'; for (let y = 30; y < 230; y += 10) g2.fillRect(30, y, 452, 4);
    g2.fillStyle = '#fff'; g2.font = '900 70px "Noto Sans TC",sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('歡迎光臨', 256, 108);
    g2.fillStyle = acc; g2.font = '900 40px sans-serif'; g2.fillText('WELCOME ♥', 256, 180);
    const mt = new THREE.CanvasTexture(c); mt.colorSpace = THREE.SRGBColorSpace; mt.anisotropy = 4;
    const doorMat = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), q === 'low' ? new THREE.MeshLambertMaterial({ map: mt }) : new THREE.MeshStandardMaterial({ map: mt, roughness: 0.95 }));
    doorMat.rotation.x = -Math.PI / 2; doorMat.rotation.z = Math.PI; doorMat.position.set((DOOR_X0 + DOOR_X1) / 2, 0.012, STORE_D - 0.8); doorMat.receiveShadow = true; S.add(doorMat);
    // door frame trims + motion sensor on the inside wall face, window mullions
    const alu = mat(0xced4da, q, { metal: 0.5, rough: 0.35 });
    for (const x of [DOOR_X0 - 0.07, DOOR_X1 + 0.07]) put(S, RB(0.14, 2.6, 0.06, 0.02), alu, x, 1.3, STORE_D - 0.02);
    put(S, RB(DOOR_X1 - DOOR_X0 + 0.28, 0.14, 0.06, 0.02), alu, (DOOR_X0 + DOOR_X1) / 2, 2.62, STORE_D - 0.02);
    put(S, RB(0.36, 0.1, 0.12, 0.03), mat(0x343a40, q), DOOR_X1 - 0.5, 2.5, STORE_D - 0.08);
    put(S, SPH(0.018, 6, 4), basic(0xff3b30), DOOR_X1 - 0.5, 2.48, STORE_D - 0.14);
    for (const w of WALLS) if (w.z0 >= STORE_D - 0.01) {
      for (let x = w.x0 + 1.6; x < w.x1 - 0.4; x += 1.6) put(S, B(0.07, 1.7, 0.34), alu, x, 1.75, (w.z0 + w.z1) / 2);
      put(S, B(w.x1 - w.x0, 0.07, 0.34), alu, (w.x0 + w.x1) / 2, 0.92, (w.z0 + w.z1) / 2);
    }
    // sliding glass doors: aluminium frame + push bar (move with the door)
    for (const d of [this.doorL, this.doorR]) {
      const fr = new THREE.Group();
      for (const sx of [-0.72, 0.72]) put(fr, B(0.06, 2.55, 0.08), alu, sx, 0, 0);
      for (const sy of [-1.25, 1.25]) put(fr, B(1.5, 0.06, 0.08), alu, 0, sy, 0);
      put(fr, B(1.5, 0.22, 0.08), alu, 0, -1.15, 0);
      const inner = d === this.doorL ? 0.6 : -0.6;
      put(fr, CYL(0.02, 0.02, 0.7, 6), mat(0x868e96, q, { metal: 0.7, rough: 0.3 }), inner, 0, -0.09);
      put(fr, CYL(0.02, 0.02, 0.7, 6), mat(0x868e96, q, { metal: 0.7, rough: 0.3 }), inner, 0, 0.09);
      put(fr, CYL(0.12, 0.12, 0.005, 16), basic(TH.accent), 0, 0.2, -0.045, Math.PI / 2); // round sticker
      mergeInto(fr, new Set(), false); d.add(fr);
    }
    // trash can near the door
    const tc = this.pick([[DOOR_X0 - 0.6, STORE_D - 0.4], [DOOR_X1 + 0.6, STORE_D - 0.4], [DOOR_X0 - 1.4, STORE_D - 0.4], [DOOR_X1 + 1.5, STORE_D - 0.4], [STORE_W - 0.5, STORE_D - 3]], 0.3);
    if (tc) {
      const [x, z] = tc;
      put(S, RB(0.42, 0.7, 0.36, 0.06, 2), mat(0x495057, q), x, 0.35, z);
      put(S, RB(0.46, 0.08, 0.4, 0.03), mat(0x2b8a3e, q), x, 0.74, z);
      put(S, B(0.26, 0.06, 0.02), basic(0x111111), x, 0.6, z - 0.181);
      put(S, CYL(0.06, 0.06, 0.005, 12), basic(0x51cf66), x, 0.4, z - 0.181, Math.PI / 2); // recycle dot
    }
    // yellow wet-floor sign by the mop rack
    const wf = this.pick([[0.9, MOP_RACK.z1 + 0.55], [0.9, MOP_RACK.z0 - 0.55], [1.4, MOP_RACK.z1 + 0.6]], 0.25);
    if (wf) {
      const sg = new THREE.Group(), y = mat(0xffd43b, q, { rough: 0.5 });
      sg.position.set(wf[0], 0, wf[1]); sg.rotation.y = Math.PI / 2 + 0.4;
      for (const s of [-1, 1]) {
        const p = new THREE.Group(); p.position.set(0, 0.32, s * 0.07); p.rotation.x = -s * 0.2; sg.add(p);
        put(p, RB(0.34, 0.62, 0.025, 0.012), y);
        put(p, B(0.04, 0.16, 0.01), basic(0x212529), 0, 0.08, s * 0.016);
        put(p, B(0.04, 0.04, 0.01), basic(0x212529), 0, -0.07, s * 0.016);
        put(p, B(0.3, 0.05, 0.01), basic(0x212529), 0, -0.22, s * 0.016);
      }
      put(sg, CYL(0.02, 0.02, 0.06, 6), y, 0, 0.64, 0);
      mergeInto(sg, new Set(), q === 'high'); S.add(sg);
    }
    // fire extinguisher on the stockroom wall
    const fe = this.pick([[6.92, 4.6], [6.92, 3.2], [7.0, 0.3]], 0.15);
    if (fe) {
      const [x, z] = fe;
      put(S, CAP(0.08, 0.28, 8), mat(0xe03131, q, { rough: 0.4 }), x, 0.42, z);
      put(S, CYL(0.03, 0.03, 0.06, 6), mat(0x212529, q), x, 0.66, z);
      put(S, B(0.04, 0.02, 0.12), mat(0x212529, q), x, 0.7, z - 0.04);
      put(S, B(0.02, 0.12, 0.2), basic(0xfff5f5), x + 0.08, 0.42, z, 0, 0, 0);
    }
    // corner plants
    for (const [x, z] of [[STORE_W - 0.45, 0.45], [7.2, 0.45], [0.45, STORE_D - 0.45]] as [number, number][]) if (this.freeSpot(x, z, 0.3)) this.plant(x, z, 0.55, 1.0);
    // security camera dome in the corner
    put(S, CYL(0.1, 0.1, 0.04, 10), mat(0xf8f9fa, q), STORE_W - 0.4, 3.18, 0.4);
    put(S, DOME(0.09, Math.PI / 2, 10, 4), basic(0x212529), STORE_W - 0.4, 3.16, 0.4, Math.PI);
    // small posters on the back wall
    const P = CURRENT_MAP.products;
    const posters: [string, string, string][] = [
      [`今日特價 ${P.drinks.name}`, `$${P.drinks.price} ★`, hex(P.drinks.color)],
      ['微笑服務 😊', '奧客請自重', acc],
    ];
    posters.forEach(([a, b, bg], i) => {
      const x = i === 0 ? 8.6 : 15.6;
      const pm = this.atlas.mesh(1.2, 0.75, () => textCanvas([{ text: a, size: 46 }, { text: b, size: 40, color: '#fff3bf' }], 512, 320, bg));
      pm.position.set(x, 2.4, 0.02); S.add(pm);
      put(S, B(1.28, 0.83, 0.02), mat(0xf8f9fa, q), x, 2.4, 0.005);
    });
  }

  /**
   * Merge every static, opaque mesh added by build() into one mesh per material.
   * Cuts draw calls a lot (walls, shelves, fixtures, street) without changing the look.
   */
  private mergeStatic(before: Set<THREE.Object3D>) {
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const remove: THREE.Mesh[] = [];
    const glowSet = new Set<THREE.Material>(this.glow.map(g => g.m));
    for (const o of this.scene.children) {
      if (before.has(o) || !(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.userData.dynamic) continue;
      const m = o.material as THREE.Material;
      if (Array.isArray(o.material) || m.transparent) continue;
      o.updateMatrixWorld(true);
      const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const keep = m.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      // plain colours share one vertex-coloured material (glow materials keep theirs: they dim with the power)
      // untextured glow parts share one vertex-coloured unlit material too (it dims as a whole: base colour white)
      const glowVC = glowSet.has(m) && !(m as THREE.MeshBasicMaterial).map ? this.glowVC() : null;
      const vc = glowVC ?? (glowSet.has(m) ? null : vertexColorMat(m));
      if (vc) paint(g, glowVC ? this.glow.find(x => x.m === m)!.base : (m as THREE.MeshBasicMaterial).color);
      const key = vc ?? m;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(g);
      remove.push(o);
    }
    for (const o of remove) this.scene.remove(o);
    for (const [m, raw] of groups) {
      const list = raw.some(g => !g.index) ? raw.map(g => g.index ? g.toNonIndexed() : g) : raw;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
  }

  private itemVC: THREE.Material | null = null;
  /** Material for shelf items whose mesh carries vertex shading (books, loaves, cakes…), tinted per item. */
  private itemVCMat() {
    return this.itemVC ??= this.q === 'low' ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  }
  private glowShared: THREE.MeshBasicMaterial | null = null;
  /** The shared vertex-coloured unlit material that merged glow parts use (dims like the others). */
  private glowVC() {
    if (!this.glowShared) { this.glowShared = new THREE.MeshBasicMaterial({ vertexColors: true }); this.glow.push({ m: this.glowShared, base: new THREE.Color(0xffffff) }); }
    return this.glowShared;
  }
  /** Unlit material that follows the store's power level (outage dims it). */
  private glowMat(color: number) {
    const m = new THREE.MeshBasicMaterial({ color });
    this.glow.push({ m, base: new THREE.Color(color) });
    return m;
  }

  private buildStreet() {
    const q = this.q, S = this.scene;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), mat(0x8c8f7a, q)); ground.rotation.x = -Math.PI / 2; ground.position.set(12, -0.03, 8); S.add(ground);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(60, 4), mat(0xc9c2b6, q)); walk.rotation.x = -Math.PI / 2; walk.position.set(12, -0.01, 18.3); S.add(walk);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(60, 0.15, 0.25), mat(0x868e96, q)); curb.position.set(12, 0.05, 20.35); S.add(curb);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 8), mat(0x3d3f45, q)); road.rotation.x = -Math.PI / 2; road.position.set(12, -0.015, 24.5); S.add(road);
    const lineM = new THREE.MeshBasicMaterial({ color: 0xfcc419 });
    for (let x = -16; x < 42; x += 4) { const d = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.15), lineM); d.rotation.x = -Math.PI / 2; d.position.set(x, 0, 24.5); S.add(d); }
    const zebraM = new THREE.MeshBasicMaterial({ color: 0xf1f3f5 });
    for (let i = 0; i < 8; i++) { const z = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 7.5), zebraM); z.rotation.x = -Math.PI / 2; z.position.set(9.4 + i * 0.75, -0.005, 24.5); S.add(z); }
    // trees and street lamps along the sidewalk (instanced: cheap on phones)
    const xs = [-8, -3, 2, 7, 17, 22, 27, 32];
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 6), mat(0x6b4f3a, q), xs.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.1, 0), mat(0x40a35a, q), xs.length);
    const m4 = new THREE.Matrix4();
    xs.forEach((x, i) => { m4.makeTranslation(x, 1.1, 19.6); trunk.setMatrixAt(i, m4); m4.makeTranslation(x, 2.7, 19.6); crown.setMatrixAt(i, m4); });
    S.add(trunk, crown);
    for (const x of [4.5, 19.5]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6), mat(0x495057, q)); pole.position.set(x, 2.1, 20.0); S.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.25), this.glowMat(0xfff3bf)); lamp.position.set(x, 4.15, 19.75); S.add(lamp);
    }
    // buildings across the street with lit windows
    const cols = ['#c9ada7', '#9a8c98', '#b5838d', '#6d6875', '#a3b18a'];
    const bm = new THREE.MeshLambertMaterial({ map: windowsTexture(cols) });
    for (let i = 0; i < 7; i++) {
      const hgt = 7 + (i * 37) % 10, col = i % cols.length;
      const bg = new THREE.BoxGeometry(7, hgt, 6), uv = bg.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (col + 0.02 + uv.getX(k) * 0.96) / cols.length);
      const b = new THREE.Mesh(bg, bm);
      b.position.set(-12 + i * 8, hgt / 2, 32); S.add(b);
    }
    // a couple of parked scooters
    for (const [x, c] of [[15.5, 0xe03131], [16.6, 0x1c7ed6], [7.0, 0xf1f3f5]] as const) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 1.3), mat(c, q)); body.position.y = 0.45; g.add(body);
      for (const z of [-0.5, 0.5]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10), mat(0x212529, q)); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.22, z); g.add(wheel); }
      g.position.set(x, 0, 21.5); g.rotation.y = 0.2; S.add(g);
    }
  }

  /** Expanding ring on the floor (ejects, ultimate, spin). */
  shockwave(x: number, z: number, color: number, size = 3) {
    if (this.q === 'low' && this.rings.length > 2) return;
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.55, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.userData.size = size;
    this.scene.add(m); this.rings.push({ m, life: 0.7 });
  }

  private puff(x: number, y: number, z: number) {
    if (!this.puffTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      this.puffTex = new THREE.CanvasTexture(c);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false }));
    s.position.set(x, y, z); s.scale.setScalar(0.5);
    this.scene.add(s); this.puffs.push({ s, life: 0.5 });
  }

  // ---------- per-frame updates ----------
  private smooth(s: Smoothed, x: number, z: number, yaw: number, dt: number) {
    const k = 1 - Math.exp(-dt * 14);
    if (Math.hypot(x - s.x, z - s.z) > 4) { s.x = x; s.z = z; }
    s.x += (x - s.x) * k; s.z += (z - s.z) * k;
    let dy = yaw - s.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * k;
  }

  update(snap: Snapshot, selfId: string, dt: number, renderPlayers: (id: string) => { x: number; z: number; yaw: number } | null) {
    this.time += dt;
    const q = this.q;
    // shelves
    const cap = shelfCapacity(snap.upgrades.shelves);
    for (const p of PRODUCTS) {
      const si = this.shelfInst.get(p)!;
      const ratio = Math.min(1, snap.shelves[p] / Math.max(1, cap));
      si.mesh.count = Math.min(si.slots.length, Math.round(ratio * si.slots.length + (snap.shelves[p] > 0 ? 0.5 : 0)));
      const stack = this.crateStacks.get(p)!;
      const boxes = Math.min(10, Math.ceil(snap.backstock[p] / 6));
      if (stack.userData.n !== boxes) {
        stack.userData.n = boxes;
        for (const o of stack.children) (o as THREE.Mesh).geometry?.dispose();
        stack.clear();
        const c = CRATES.find(c => c.product === p)!.box;
        for (let i = 0; i < boxes; i++) {
          const b = heldModel(q, { kind: 'box', product: p, qty: 6 });
          b.position.set((c.x0 + c.x1) / 2 + ((i % 2) - 0.5) * 0.5, 0.27 + Math.floor(i / 2) * 0.31, (c.z0 + c.z1) / 2);
          stack.add(b);
        }
        mergeInto(stack, new Set(), q === 'high');
      }
    }
    this.mopsOnRack.forEach((m, i) => { m.visible = i < snap.mopsOnRack; });
    // re-render the shadow map only when something that casts a shadow changed (stock levels, crates, 2nd register)
    const sig = PRODUCTS.map(p => this.shelfInst.get(p)!.mesh.count + ':' + this.crateStacks.get(p)!.userData.n).join(',') + (snap.upgrades.register2 > 0 ? 'r' : '');
    if (sig !== this.shadowSig) { this.shadowSig = sig; this.renderer.shadowMap.needsUpdate = true; }
    this.reg2On = snap.upgrades.register2 > 0;
    this.register2.forEach(o => { o.visible = this.reg2On; });
    // analog wall clock follows the in-game time
    if (this.clockHands.length) {
      this.clockHands[0].rotation.z = -((snap.clock / 60) % 12) / 12 * Math.PI * 2;
      this.clockHands[1].rotation.z = -(snap.clock % 60) / 60 * Math.PI * 2;
    }
    this.coffeeSteam.forEach((s, i) => { const t = (this.time * 0.6 + i / 3) % 1; s.position.set(this.steamBase.x + Math.sin(t * 5 + i) * 0.03, this.steamBase.y + t * 0.6, this.steamBase.z); (s.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - t); });

    // customers
    const seen = new Set<number>();
    let doorNear = false;
    for (const c of snap.customers) {
      seen.add(c.id);
      let e = this.customers.get(c.id);
      if (!e) {
        const h = new Human(q, customerLook(c));
        if (c.kind !== 'normal') karenAccessory(q, h, c.kind);
        e = { h, s: { x: c.x, z: c.z, yaw: c.yaw }, kind: c.kind, tag: null, compactT: 0 };
        this.customers.set(c.id, e); this.scene.add(h.group);
      }
      if (c.flying || c.held) { e.s.x = c.x; e.s.z = c.z; } else this.smooth(e.s, c.x, c.z, c.yaw, dt);
      // held: carried sideways at chest height so the view stays clear; flying: tumbling
      const sitting = c.state === 'charge' && !c.held && !c.flying;
      // thrown out: flat on the back, then sits up over the last 0.7 s
      const lying = c.down > 0 ? Math.min(1, c.down / 0.7) : 0;
      e.h.group.position.set(e.s.x, c.held ? 0.95 : sitting ? SIT_Y : lying ? 0.3 * lying : c.y, e.s.z); e.h.group.rotation.y = e.s.yaw;
      // lying face-up so the dazed face is visible
      e.h.group.rotation.x = c.flying ? e.h.group.rotation.x + dt * 9 : -Math.PI / 2 * lying;
      e.h.group.rotation.z = c.held ? Math.PI / 2 + Math.sin(this.time * 12) * 0.15 : 0;
      const pose = c.held || c.flying ? 'flail'
        : lying ? 'dazed'
        : sitting && c.kind === 'charger' && c.phase > 0 ? 'sitAngry'
        : (c.kind === 'rager' || (c.kind === 'boss' && c.phase === 2)) && c.state === 'complain' && !c.resolved ? 'angry'
          : (c.kind === 'streamer' || (c.kind === 'boss' && c.phase === 3)) && !c.resolved ? 'film'
            : sitting ? 'sit'
            : c.state === 'atRegister' ? 'pay'
              : c.state === 'leaving' && c.patience <= 0.01 && c.kind === 'normal' ? 'angry'
                : (c.state === 'queue' || c.state === 'waitFood') && c.patience < 0.25 ? 'angry' : 'normal';
      e.h.animate(dt, c.moving, c.kind === 'streamer' ? 1.4 : 1, pose as Pose);
      e.h.setBasket(q, c.items > 0 && !c.held && !c.flying && c.state !== 'atRegister');
      if (Math.abs(c.x - 12) < 2.2 && Math.abs(c.z - 16) < 2.2) doorNear = true;
      // overhead status tag (picked here, laid out against the other tags in render())
      e.tag = customerTag(c); e.compactT = Math.max(0, e.compactT - dt);
      // keep the status icon upright above a carried / knocked-down body (the group itself is rotated)
      const iy = c.flying ? ICON_Y : c.held ? 0.9 : lying ? 1.1 : ICON_Y;
      if (c.flying || (!c.held && !lying)) e.h.icon.sprite.position.set(0, ICON_Y, 0);
      else {
        _v.set(0, iy, 0).applyQuaternion(_q.copy(e.h.group.quaternion).invert()).divide(e.h.group.scale);
        e.h.icon.sprite.position.copy(_v);
      }
      if (c.kind === 'rager' && !c.resolved && c.state === 'complain') e.h.group.position.x += Math.sin(this.time * 40) * 0.02 * (c.anger / 100);
    }
    for (const [id, e] of this.customers) if (!seen.has(id)) { this.scene.remove(e.h.group); this.customers.delete(id); }

    // players (others)
    const seenP = new Set<string>();
    for (const p of snap.players) {
      if (p.id === selfId) continue;
      seenP.add(p.id);
      let e = this.players.get(p.id);
      if (!e) {
        const h = new Human(q, { shirt: p.color, pants: 0x343a40, skin: SKIN[p.id.charCodeAt(1) % SKIN.length], hair: HAIR[p.id.charCodeAt(2) % HAIR.length], hairStyle: p.id.charCodeAt(3) % 4, apron: true, outfit: p.outfit });
        e = { h, s: { x: p.x, z: p.z, yaw: p.yaw } };
        // player models get their own material copies: disconnect fading must not touch shared materials
        e.h.group.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh && !Array.isArray(mm.material)) mm.material = (mm.material as THREE.Material).clone(); });
        this.players.set(p.id, e); this.scene.add(e.h.group);
      }
      const rp = renderPlayers(p.id) ?? p;
      const moving = Math.hypot(rp.x - e.s.x, rp.z - e.s.z) > 0.01;
      this.smooth(e.s, rp.x, rp.z, rp.yaw, dt);
      e.h.group.position.set(e.s.x, 0, e.s.z); e.h.group.rotation.y = e.s.yaw;
      e.h.animate(dt, moving);
      e.h.setHeld(q, p.held);
      const status = !p.connected ? ' 📶斷線' : p.away ? ' 💤' : '';
      const tagged = tagPrefix(p.outfit) + p.name; // 商城 name tag shows as an emoji before the name
      const lkey = tagged + status + (p.busy ? '…' : '');
      e.h.label.set(lkey, () => pillCanvas({ text: tagged + status, dot: hex(p.color), size: 42 }));
      e.h.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && 'opacity' in m && o !== e!.h.label.sprite) { m.transparent = !p.connected; m.opacity = p.connected ? 1 : 0.4; } });
      if (Math.abs(e.s.x - 12) < 2.2 && Math.abs(e.s.z - 16) < 2.2) doorNear = true;
    }
    for (const [id, e] of this.players) if (!seenP.has(id)) { this.scene.remove(e.h.group); this.players.delete(id); }
    // blob shadows: shrink and fade-ish (smaller) while someone is lifted or flying
    let nb = 0;
    const m4 = new THREE.Matrix4();
    const blob = (x: number, z: number, y: number, s: number) => {
      if (nb >= this.blobs.instanceMatrix.count) return;
      const k = s * Math.max(0.35, 1 - Math.max(0, y) * 0.35);
      this.blobs.setMatrixAt(nb++, m4.makeScale(k, 1, k).setPosition(x, 0.018, z));
    };
    for (const c of snap.customers) { const e = this.customers.get(c.id); if (e) blob(e.s.x, e.s.z, c.held ? 0.9 : c.flying ? c.y : 0, e.h.group.scale.x * (c.state === 'charge' && !c.held ? 1.2 : 1)); }
    for (const e of this.players.values()) blob(e.s.x, e.s.z, 0, 1);
    this.blobs.count = nb; this.blobs.instanceMatrix.needsUpdate = true;

    // outage dims the lights, microwave glows while someone heats food
    this.power += (snap.power - this.power) * Math.min(1, dt * 4);
    const flicker = snap.power < 1 ? 0.85 + Math.random() * 0.15 : 1;
    for (const { l, base } of this.lights) l.intensity = base * this.power * flicker;
    for (const { m, base } of this.glow) m.color.copy(base).multiplyScalar(0.25 + 0.75 * this.power * flicker);
    if (this.beacon) {
      const on = snap.power < 1;
      const blink = on && Math.sin(this.time * 9) > 0;
      (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(blink ? 0xff3b30 : on ? 0x8a1c1c : 0x5c1a1a);
      if (this.beaconLight) this.beaconLight.intensity = blink ? 6 : 0;
    }
    // throw trails
    if (this.q !== 'low' || this.puffs.length < 10) {
      for (const c of snap.customers) if (c.flying && Math.random() < 0.7) { const e = this.customers.get(c.id); if (e) this.puff(e.s.x, c.y + 1.0, e.s.z); }
    }
    for (const p of this.puffs) { p.life -= dt; p.s.scale.setScalar(0.5 + (0.5 - p.life) * 1.6); (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, p.life * 1.6); }
    this.puffs = this.puffs.filter(p => { if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); return false; } return true; });
    for (const r of this.rings) { r.life -= dt; const k = 1 + (0.7 - r.life) * (r.m.userData.size as number) * 2.2; r.m.scale.set(k, k, k); (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life / 0.7); }
    this.rings = this.rings.filter(r => { if (r.life <= 0) { this.scene.remove(r.m); (r.m.material as THREE.Material).dispose(); r.m.geometry.dispose(); return false; } return true; });
    const heating = snap.players.some(p => p.busy?.kind === 'heat');
    (this.microwaveGlow.material as THREE.MeshBasicMaterial).opacity = heating ? 0.6 + Math.sin(this.time * 8) * 0.2 : 0;
    this.microwaveGlow.visible = heating && !!CURRENT_MAP.meal; // invisible glows cost a draw call too
    const me = snap.players.find(p => p.id === selfId);
    (this.exitGlow.material as THREE.MeshBasicMaterial).opacity = me?.grabbing != null ? 0.35 + Math.sin(this.time * 6) * 0.15 : 0;
    this.exitGlow.visible = me?.grabbing != null;
    this.shake = Math.max(0, this.shake - dt); this.flash = Math.max(0, this.flash - dt);
    // door
    this.doorOpen += ((doorNear ? 1 : 0) - this.doorOpen) * Math.min(1, dt * 5);
    this.doorL.position.x = DOOR_X0 + 0.75 - this.doorOpen * 1.3;
    this.doorR.position.x = DOOR_X1 - 0.75 + this.doorOpen * 1.3;

    // spills
    const seenS = new Set<number>();
    for (const s of snap.spills) {
      seenS.add(s.id);
      if (!this.spills.has(s.id)) {
        const m = new THREE.Mesh(this.spillGeo, this.spillMat); m.rotation.x = -Math.PI / 2; m.position.set(s.x, 0.012, s.z); m.scale.set(1, 0.7 + (s.id % 5) * 0.1, 1);
        this.scene.add(m); this.spills.set(s.id, m);
      }
    }
    for (const [id, m] of this.spills) if (!seenS.has(id)) { this.burst(m.position.x, m.position.z, 0x99e9f2, 10); this.scene.remove(m); this.spills.delete(id); }
    // dropped items
    const seenI = new Set<number>();
    for (const it of snap.items) {
      seenI.add(it.id);
      if (!this.items.has(it.id)) { const o = heldModel(q, it.held); o.position.set(it.x, 0.16, it.z); if (it.held.kind === 'mop') o.rotation.set(Math.PI / 2, 0, 0); this.scene.add(o); this.items.set(it.id, o); }
    }
    for (const [id, o] of this.items) if (!seenI.has(id)) { this.scene.remove(o); this.items.delete(id); }
    // pings
    const seenPg = new Set<number>();
    for (const pg of snap.pings) {
      seenPg.add(pg.id);
      if (!this.pings.has(pg.id)) {
        const color = snap.players.find(p => p.id === pg.by)?.color ?? 0xffffff;
        const g = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })); beam.position.y = 1.5;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
        const lbl = new Label({ maxScreen: 0.05 }); lbl.set('ping', () => pillCanvas({ text: '📍 這裡', bg: '#48a6ff', size: 46 })); lbl.sprite.position.y = 3.2;
        g.add(beam, ring, lbl.sprite); g.position.set(pg.x, 0, pg.z);
        this.scene.add(g); this.pings.set(pg.id, g);
      }
      const g = this.pings.get(pg.id)!; g.children[1].scale.setScalar(1 + 0.25 * Math.sin(this.time * 6));
    }
    for (const [id, g] of this.pings) if (!seenPg.has(id)) { this.scene.remove(g); this.pings.delete(id); }

    // floaters & particles
    for (const f of this.floaters) { f.life -= dt; f.obj.position.y += f.vy * dt; (f.obj.material as THREE.SpriteMaterial).opacity = Math.min(1, f.life); }
    this.floaters = this.floaters.filter(f => { if (f.life <= 0) { this.scene.remove(f.obj); (f.obj.material as THREE.SpriteMaterial).map?.dispose(); return false; } return true; });
    for (const p of this.particles) { p.life -= dt; p.v.y -= 6 * dt; p.mesh.position.addScaledVector(p.v, dt); p.mesh.scale.setScalar(Math.max(0.01, p.life)); }
    this.particles = this.particles.filter(p => { if (p.life <= 0) { this.scene.remove(p.mesh); if (this.particlePool.length < 120) this.particlePool.push(p.mesh); return false; } return true; });
  }

  floatText(text: string, x: number, z: number, color = '#69db7c') {
    const c = popCanvas(text, color);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(0.42 * c.width / c.height, 0.42, 1); s.position.set(x, 2.0, z); s.renderOrder = 20;
    this.scene.add(s); this.floaters.push({ obj: s, life: 1.6, vy: 0.8 });
  }

  burst(x: number, z: number, color: number, n = 14) {
    if (this.q === 'low') n = Math.ceil(n / 2);
    const m = basic(color);
    for (let i = 0; i < n; i++) {
      // reuse finished particle meshes instead of allocating new ones (less GC on phones)
      const mesh = this.particlePool.pop() ?? new THREE.Mesh(B(0.06, 0.06, 0.06), m);
      mesh.material = m; mesh.position.set(x, 0.6, z); mesh.scale.setScalar(1);
      this.scene.add(mesh);
      this.particles.push({ mesh, v: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3), life: 0.9 });
    }
  }
  private particlePool: THREE.Mesh[] = [];

  /** First-person camera + held item view model. */
  private viewHeld2 = new THREE.Group();
  private viewHeld2Key = '';
  setSecondHand(held: Held | null) {
    if (!this.viewHeld2.parent) { this.camera.add(this.viewHeld2); this.viewHeld2.position.set(-0.34, -0.3, -0.55); }
    const key = held ? held.kind : '';
    if (key === this.viewHeld2Key) return;
    this.viewHeld2Key = key; this.viewHeld2.clear();
    if (held) this.viewHeld2.add(heldModel(this.q, held));
  }

  setCamera(x: number, z: number, yaw: number, pitch: number, bob: number, held: Held | null) {
    const sh = this.shake * 0.12;
    this.camera.position.set(x + (Math.random() - 0.5) * sh, EYE_HEIGHT + Math.sin(bob) * 0.035 + (Math.random() - 0.5) * sh, z);
    this.camera.rotation.set(pitch, yaw + Math.PI, 0);
    const key = held ? (held.kind === 'box' ? 'box' + held.product : held.kind) : '';
    if (key !== this.viewHeldKey) {
      this.viewHeldKey = key; this.viewHeld.clear();
      if (held) { const m = heldModel(this.q, held); if (held.kind === 'mop') { m.rotation.set(0.3, 0, 0); m.position.set(0, 0.1, 0); } this.viewHeld.add(m); m.traverse(o => { o.renderOrder = 5; }); }
    }
    this.viewHeld.position.set(0.32 + Math.cos(bob * 0.5) * 0.01, -0.3 + Math.abs(Math.sin(bob)) * 0.015, -0.55);
  }

  setGuide(p: { x: number; z: number } | null) {
    this.guide.visible = !!p;
    if (p) { this.guide.position.set(p.x, 2.3 + Math.sin(this.time * 4) * 0.12, p.z); this.guide.rotation.y += 0.04; }
  }

  setHighlight(box: THREE.Box3 | null) {
    if (!box) { this.highlight.visible = false; return; }
    this.highlight.box.copy(box); this.highlight.visible = true;
  }

  render() {
    this.layoutLabels();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Station labels hide right next to the camera; customer tags are laid out nearest-first and a tag that would
   * overlap a nearer (or more important) one, or is far away, shows its compact icon-only form instead.
   */
  private layoutLabels() {
    const cam = this.camera; cam.updateMatrixWorld();
    for (const { l, on } of this.stationLabels) l.sprite.visible = on() && l.sprite.position.distanceTo(cam.position) > (l.o.fade?.[0] ?? 0);
    const vw = this.renderer.domElement.clientWidth || innerWidth, vh = this.renderer.domElement.clientHeight || innerHeight;
    const list: { e: { h: Human; compactT: number }; t: Tag; d: number; x: number; y: number; on: boolean }[] = [];
    for (const e of this.customers.values()) {
      const t = e.tag;
      if (!t) { e.h.icon.set('', () => document.createElement('canvas')); continue; }
      const g = e.h.group;
      _v.copy(e.h.icon.sprite.position).multiply(g.scale).applyQuaternion(g.quaternion).add(g.position);
      const d = _v.distanceTo(cam.position);
      _v.project(cam);
      list.push({ e, t, d, x: (_v.x + 1) / 2 * vw, y: (1 - _v.y) / 2 * vh, on: _v.z < 1 && Math.abs(_v.x) < 1.3 && Math.abs(_v.y) < 1.3 });
    }
    list.sort((a, b) => b.t.prio - a.t.prio || a.d - b.d);
    const placed: number[][] = [];
    const hit = (x: number, y: number, hw: number, hh: number) => placed.some(([px, py, pw, ph]) => Math.abs(px - x) < pw + hw - 4 && Math.abs(py - y) < ph + hh - 2);
    for (const it of list) {
      const { e, t } = it;
      let compact = !!t.compact && (it.d > 11 || e.compactT > 0);
      if (it.on && t.compact && !compact) {
        const [hw, hh] = e.h.icon.screenHalf(labelTexture(t.key + '|f', () => pillCanvas(t.full)), cam, it.d, vh);
        if (hit(it.x, it.y, hw, hh)) { compact = true; e.compactT = 0.6; }
      }
      const key = t.key + (compact ? '|c' : '|f'), opts = compact ? t.compact! : t.full;
      e.h.icon.set(key, () => pillCanvas(opts));
      if (it.on) { const [hw, hh] = e.h.icon.screenHalf(labelTexture(key, () => pillCanvas(opts)), cam, it.d, vh); placed.push([it.x, it.y, hw, hh]); }
    }
  }

  customerWorldPos(id: number) { const e = this.customers.get(id); return e ? e.s : null; }
}

export { Human, heldModel };
export type { Pose };
export const FIXTURE_HEIGHT: Record<string, number> = { shelf: 1.9, fridge: 2, counter: 1.1, coffee: 1.5, crate: 1.3, mop: 1.5 };
export { COFFEE_MACHINE, CRATES, MOP_RACK, REGISTERS, SHELVES };
