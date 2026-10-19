// Three.js scene: the store, live stock displays, characters (players, customers, karens) and effects.
import * as THREE from 'three';
import { PRODUCT_INFO, PRODUCTS, Product, shelfCapacity, EYE_HEIGHT } from '../../shared/constants.ts';
import {
  AABB, COFFEE_MACHINE, COFFEE_PICKUP, COMPLAINT_SPOT, COUNTER, CRATES, DECOR, DOOR_X0, DOOR_X1, MOP_RACK, REGISTERS, SHELVES,
  STORE_D, STORE_W, WALLS,
} from '../../shared/map.ts';
import type { CustomerSnap, Held, PlayerSnap, Snapshot } from '../../shared/protocol.ts';
import type { Quality } from './storage.ts';

// ---------- helpers ----------
export function textCanvas(lines: { text: string; color?: string; size?: number; bold?: boolean }[], w = 512, h = 128, bg = 'rgba(15,16,26,0.82)', bar?: { v: number; color: string }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  if (bg) { g.fillStyle = bg; roundRect(g, 4, 4, w - 8, h - 8, 26); g.fill(); }
  const total = lines.reduce((s, l) => s + (l.size ?? 44) * 1.15, 0) + (bar ? 22 : 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    const size = l.size ?? 44;
    g.font = `${l.bold === false ? 600 : 900} ${size}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    g.fillStyle = l.color ?? '#fff'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(l.text, w / 2, y + size * 0.05); y += size * 1.15;
  }
  if (bar) {
    g.fillStyle = 'rgba(255,255,255,0.2)'; roundRect(g, 40, y + 4, w - 80, 14, 7); g.fill();
    g.fillStyle = bar.color; roundRect(g, 40, y + 4, Math.max(14, (w - 80) * Math.max(0, Math.min(1, bar.v))), 14, 7); g.fill();
  }
  return c;
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

class Label {
  sprite: THREE.Sprite; key = ''; private tex: THREE.CanvasTexture | null = null;
  constructor(public scaleW = 1.4, public scaleH = 0.35) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true, transparent: true }));
    this.sprite.scale.set(scaleW, scaleH, 1);
    this.sprite.renderOrder = 10;
  }
  set(key: string, draw: () => HTMLCanvasElement) {
    if (key === this.key) return;
    this.key = key;
    this.tex?.dispose();
    if (!key) { this.sprite.visible = false; return; }
    this.sprite.visible = true;
    this.tex = new THREE.CanvasTexture(draw());
    this.tex.colorSpace = THREE.SRGBColorSpace;
    (this.sprite.material as THREE.SpriteMaterial).map = this.tex;
    (this.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
  }
}

function mat(color: number, q: Quality, opts: { emissive?: number; rough?: number; metal?: number; transparent?: boolean; opacity?: number } = {}) {
  if (q === 'low') return new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? 0, transparent: opts.transparent, opacity: opts.opacity ?? 1 });
  return new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0, emissive: opts.emissive ?? 0, transparent: opts.transparent, opacity: opts.opacity ?? 1 });
}

function boxMesh(b: AABB, h: number, m: THREE.Material, y0 = 0) {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, h, b.z1 - b.z0);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set((b.x0 + b.x1) / 2, y0 + h / 2, (b.z0 + b.z1) / 2);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
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

// ---------- characters ----------
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIR = [0x2b1b0e, 0x4a3020, 0x111111, 0x8a6a3a, 0xb8b8b8, 0x6b2b14];
const SHIRT = [0x5c7cfa, 0x94d82d, 0xf783ac, 0x20c997, 0xadb5bd, 0xffa94d, 0x845ef7, 0x868e96];

export class Human {
  group = new THREE.Group();
  body: THREE.Mesh; head: THREE.Mesh; legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  hand: THREE.Group; label = new Label(); icon = new Label(1.7, 0.55);
  phase = 0; heldKey = '';
  constructor(q: Quality, opts: { shirt: number; pants: number; skin: number; hair: number; hairStyle: number; scale?: number; apron?: boolean }) {
    const g = this.group;
    const skinM = mat(opts.skin, q), shirtM = mat(opts.shirt, q), pantsM = mat(opts.pants, q), hairM = mat(opts.hair, q), shoeM = mat(0x222222, q);
    const leg = (x: number) => {
      const lg = new THREE.Group(); lg.position.set(x, 0.85, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.8, 0.2), pantsM); m.position.y = -0.4; m.castShadow = true; lg.add(m);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.1, 0.3), shoeM); shoe.position.set(0, -0.8, 0.05); lg.add(shoe);
      g.add(lg); return lg;
    };
    this.legL = leg(-0.11); this.legR = leg(0.11);
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.28), shirtM); this.body.position.y = 1.16; this.body.castShadow = true; g.add(this.body);
    if (opts.apron) { const ap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.02), mat(0x2f9e44, q)); ap.position.set(0, 1.08, 0.15); g.add(ap); }
    const arm = (x: number) => {
      const ag = new THREE.Group(); ag.position.set(x, 1.42, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.58, 0.15), shirtM); m.position.y = -0.27; m.castShadow = true; ag.add(m);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.12), skinM); h.position.y = -0.6; ag.add(h);
      g.add(ag); return ag;
    };
    this.armL = arm(-0.31); this.armR = arm(0.31);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.17, q === 'low' ? 10 : 16, q === 'low' ? 8 : 12), skinM);
    this.head.position.y = 1.66; this.head.castShadow = true; g.add(this.head);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const x of [-0.06, 0.06]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeM); e.position.set(x, 0.03, 0.155); this.head.add(e); }
    if (opts.hairStyle !== 2) {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI * (opts.hairStyle === 1 ? 0.62 : 0.5)), hairM);
      hair.position.y = 0.02; this.head.add(hair);
      if (opts.hairStyle === 1) { const back = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.08), hairM); back.position.set(0, -0.12, -0.14); this.head.add(back); }
      if (opts.hairStyle === 3) { const bun = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), hairM); bun.position.set(0, 0.14, -0.12); this.head.add(bun); }
    }
    this.hand = new THREE.Group(); this.hand.position.set(0, 1.05, 0.35); g.add(this.hand);
    this.label.sprite.position.y = 2.15; g.add(this.label.sprite);
    this.icon.sprite.position.y = 2.45; g.add(this.icon.sprite);
    if (opts.scale) g.scale.setScalar(opts.scale);
  }
  animate(dt: number, moving: boolean, speed = 1) {
    if (moving) this.phase += dt * 9 * speed; else this.phase *= 0.85;
    const s = Math.sin(this.phase) * (moving ? 0.6 : 0);
    this.legL.rotation.x = s; this.legR.rotation.x = -s;
    if (!this.heldKey) { this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8; }
    else { this.armL.rotation.x = -1.2; this.armR.rotation.x = -1.2; }
    this.body.position.y = 1.16 + Math.abs(Math.sin(this.phase)) * (moving ? 0.03 : 0);
  }
  setHeld(q: Quality, held: Held | null) {
    const key = held ? (held.kind === 'box' ? 'box' + held.product : held.kind) : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.hand.clear();
    if (held) this.hand.add(heldModel(q, held));
  }
}

export function heldModel(q: Quality, held: Held): THREE.Object3D {
  const g = new THREE.Group();
  if (held.kind === 'box') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.32), mat(0xc49a6c, q));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.33), mat(PRODUCT_INFO[held.product].color, q));
    g.add(b, stripe);
  } else if (held.kind === 'coffee') {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.17, 12), mat(0xffffff, q));
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.05, 12), mat(0x8b5a2b, q)); sl.position.y = 0.02;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 12), mat(0x333333, q)); lid.position.y = 0.095;
    g.add(cup, sl, lid);
  } else {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), mat(0xd9480f, q)); stick.rotation.x = 0.5; stick.position.set(0, 0.1, 0.1);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.15), mat(0x74c0fc, q)); head.position.set(0, -0.45, 0.42);
    g.add(stick, head);
  }
  return g;
}

function customerLook(c: CustomerSnap) {
  const L = c.look;
  const base = { shirt: SHIRT[L % SHIRT.length], pants: [0x343a40, 0x1c3f6e, 0x5c4033, 0x495057][(L >> 3) % 4], skin: SKIN[(L >> 2) % SKIN.length], hair: HAIR[(L >> 4) % HAIR.length], hairStyle: (L >> 5) % 4 };
  if (c.kind === 'rager') return { ...base, shirt: 0xe64980, hair: 0xf4d58d, hairStyle: 1 };
  if (c.kind === 'cutter') return { ...base, shirt: 0xfd7e14, hairStyle: 0 };
  if (c.kind === 'streamer') return { ...base, shirt: 0x7048e8, hair: 0x15aabf, hairStyle: 3 };
  if (c.kind === 'hog') return { ...base, shirt: 0x495057, pants: 0x212529, hairStyle: 2 };
  return base;
}

function karenAccessory(q: Quality, h: Human, kind: string) {
  if (kind === 'rager') { const purse = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), mat(0x862e9c, q)); purse.position.set(0.05, -0.62, 0.05); h.armL.add(purse); }
  if (kind === 'cutter') { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 12), mat(0xf03e3e, q)); cap.position.y = 0.12; h.head.add(cap); const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.18), mat(0xf03e3e, q)); brim.position.set(0, 0.09, 0.18); h.head.add(brim); }
  if (kind === 'streamer') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), mat(0x222222, q)); stick.position.set(0, -0.6, 0.35); stick.rotation.x = 1.1; h.armR.add(stick);
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.015), new THREE.MeshBasicMaterial({ color: 0x99e9f2 })); phone.position.set(0, -0.45, 0.68); h.armR.add(phone);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 16), new THREE.MeshBasicMaterial({ color: 0xffffff })); ring.position.set(0, -0.45, 0.7); h.armR.add(ring);
  }
  if (kind === 'hog') { const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(0x343a40, q)); hood.position.y = 0.02; hood.rotation.x = -0.2; h.head.add(hood); }
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
  private doorL!: THREE.Mesh; private doorR!: THREE.Mesh; private doorOpen = 0;
  private customers = new Map<number, { h: Human; s: Smoothed; kind: string }>();
  private players = new Map<string, { h: Human; s: Smoothed }>();
  private spills = new Map<number, THREE.Mesh>();
  private items = new Map<number, THREE.Object3D>();
  private pings = new Map<number, THREE.Group>();
  private floaters: { obj: THREE.Sprite; life: number; vy: number }[] = [];
  private particles: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private viewHeld = new THREE.Group();
  private viewHeldKey = '';
  private time = 0;
  private clockLabel = new Label(2.2, 0.55);
  private coffeeSteam: THREE.Mesh[] = [];
  private spillGeo = new THREE.CircleGeometry(0.45, 20);
  private spillMat = new THREE.MeshBasicMaterial({ color: 0x8a6d3b, transparent: true, opacity: 0.85 });
  highlight: THREE.Box3Helper;

  constructor(canvas: HTMLCanvasElement, quality: Quality, fov: number) {
    this.q = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = quality === 'low' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.camera.add(this.viewHeld);
    this.viewHeld.position.set(0.32, -0.28, -0.55);
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffe066));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.build();
    this.resize();
  }

  setQuality(q: Quality) {
    this.q = q;
    const pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 0.85);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q === 'high';
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.q === 'high' ? Math.min(devicePixelRatio, 2) : this.q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 0.85);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private build() {
    const q = this.q, S = this.scene;
    S.background = new THREE.Color(0x9ec9ef);
    S.fog = new THREE.Fog(0x9ec9ef, 30, 90);
    // lights
    S.add(new THREE.HemisphereLight(0xffffff, 0x8a7f6a, q === 'low' ? 1.6 : 1.1));
    if (q !== 'low') {
      for (const [x, z] of [[6, 4], [12, 8], [18, 4], [18, 12], [6, 12]]) {
        const l = new THREE.PointLight(0xfff1d6, 9, 14, 1.6); l.position.set(x, 2.9, z); S.add(l);
      }
    } else S.add(new THREE.AmbientLight(0xffffff, 0.6));
    if (q === 'high') {
      const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(16, 12, 22); d.target.position.set(12, 0, 8);
      d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
      Object.assign(d.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
      S.add(d, d.target);
    }
    // floor & ceiling
    const floorT = tileTexture('#e9e4d8', '#d8d2c4'); floorT.repeat.set(STORE_W / 2, STORE_D / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(STORE_W, STORE_D), q === 'low' ? new THREE.MeshLambertMaterial({ map: floorT }) : new THREE.MeshStandardMaterial({ map: floorT, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(STORE_W / 2, 0, STORE_D / 2); floor.receiveShadow = true; S.add(floor);
    const stockFloor = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 5), mat(0x9a948a, q)); stockFloor.rotation.x = -Math.PI / 2; stockFloor.position.set(3.25, 0.005, 2.5); S.add(stockFloor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(STORE_W, STORE_D), mat(0xf4f1ea, q)); ceil.rotation.x = Math.PI / 2; ceil.position.set(STORE_W / 2, 3.2, STORE_D / 2); S.add(ceil);
    for (let x = 3; x < STORE_W; x += 6) for (let z = 3; z < STORE_D; z += 5) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff })); p.rotation.x = Math.PI / 2; p.position.set(x, 3.19, z); S.add(p);
    }
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x6c757d, q)); outside.rotation.x = -Math.PI / 2; outside.position.set(12, -0.02, 8); S.add(outside);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), mat(0xb0a99f, q)); walk.rotation.x = -Math.PI / 2; walk.position.set(12, -0.01, 18.8); S.add(walk);
    for (let i = 0; i < 6; i++) {
      const hgt = 6 + (i * 37) % 9;
      const b = new THREE.Mesh(new THREE.BoxGeometry(7, hgt, 6), mat([0xc9ada7, 0x9a8c98, 0xb5838d, 0x6d6875][i % 4], q));
      b.position.set(-8 + i * 8, hgt / 2, 30); S.add(b);
    }
    // walls (south wall gets windows)
    const wallM = mat(0xf8f0e3, q);
    const accent = mat(0xff6b6b, q);
    for (const w of WALLS) {
      const isSouth = w.z0 >= STORE_D - 0.01;
      if (isSouth) {
        S.add(boxMesh(w, 0.9, wallM));
        S.add(boxMesh(w, 0.6, accent, 2.6));
        const glass = boxMesh({ ...w, z0: w.z0 + 0.1, z1: w.z1 - 0.1 }, 1.7, mat(0xbfe3ff, q, { transparent: true, opacity: 0.25, rough: 0.1 }), 0.9);
        glass.castShadow = false; S.add(glass);
      } else S.add(boxMesh(w, w.h, wallM));
    }
    const lintel = boxMesh({ x0: DOOR_X0, z0: STORE_D, x1: DOOR_X1, z1: STORE_D + 0.3, h: 0, kind: '' }, 0.6, accent, 2.6); S.add(lintel);
    const doorM = mat(0xd0ebff, q, { transparent: true, opacity: 0.35, rough: 0.05 });
    this.doorL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.55, 0.06), doorM); this.doorL.position.set(DOOR_X0 + 0.75, 1.3, STORE_D + 0.15);
    this.doorR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.55, 0.06), doorM); this.doorR.position.set(DOOR_X1 - 0.75, 1.3, STORE_D + 0.15);
    S.add(this.doorL, this.doorR);
    // sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '奧客退散 ByeKarens', size: 70, color: '#fff' }], 1024, 200, '#ff6b6b')) }));
    sign.position.set(12, 2.7, STORE_D - 0.02); sign.rotation.y = Math.PI; S.add(sign);
    const sign2 = sign.clone(); sign2.position.set(12, 2.9, STORE_D + 0.32); sign2.rotation.y = 0; S.add(sign2);
    const stockSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '倉庫 STOCK', size: 60 }], 512, 128, '#495057')) }));
    stockSign.position.set(3.4, 2.4, 5.27); S.add(stockSign);
    // shelves
    for (const sh of SHELVES) {
      const b = sh.box;
      const isFridge = b.kind === 'fridge';
      const frame = mat(isFridge ? 0xdee2e6 : 0x868e96, q, { metal: 0.3, rough: 0.5 });
      S.add(boxMesh({ ...b }, 0.12, frame));
      if (isFridge) {
        const back = boxMesh({ ...b, x0: b.x1 - 0.12 }, b.h, frame); S.add(back);
        const top = boxMesh(b, 0.1, frame, b.h - 0.1); S.add(top);
        const glass = boxMesh({ ...b, x1: b.x0 + 0.04 }, b.h - 0.15, mat(0xa5d8ff, q, { transparent: true, opacity: 0.18, rough: 0.05 }), 0.1); glass.castShadow = false; S.add(glass);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.06), new THREE.MeshBasicMaterial({ color: 0xe7f5ff })); glow.rotation.y = -Math.PI / 2; glow.position.set(b.x0 + 0.06, b.h - 0.2, (b.z0 + b.z1) / 2); S.add(glow);
      } else {
        const mid = boxMesh({ ...b, z0: (b.z0 + b.z1) / 2 - 0.04, z1: (b.z0 + b.z1) / 2 + 0.04 }, b.h, frame); S.add(mid);
      }
      const tiers = isFridge ? [0.25, 0.75, 1.25, 1.7] : [0.12, 0.6, 1.08, 1.5].filter(t => t < b.h);
      for (const t of tiers) S.add(boxMesh(b, 0.04, frame, t));
      // product slots
      const slots: THREE.Vector3[] = [];
      const pTiers = tiers.slice(0, 3);
      if (isFridge) {
        for (const t of pTiers) for (let z = b.z0 + 0.3; z < b.z1 - 0.2; z += 0.75) slots.push(new THREE.Vector3(b.x0 + 0.35, t + 0.16, z));
      } else {
        for (const t of pTiers) for (let x = b.x0 + 0.35; x < b.x1 - 0.2; x += 0.75) { slots.push(new THREE.Vector3(x, t + 0.17, b.z0 + 0.2)); slots.push(new THREE.Vector3(x, t + 0.17, b.z1 - 0.2)); }
      }
      // interleave so partially-filled shelves look evenly stocked
      slots.sort((a, c) => ((a.x * 7 + a.z * 13) % 1) - ((c.x * 7 + c.z * 13) % 1));
      const geo = sh.product === 'drinks' ? new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10) : sh.product === 'snacks' ? new THREE.BoxGeometry(0.4, 0.3, 0.12) : new THREE.BoxGeometry(0.3, 0.12, 0.4);
      const inst = new THREE.InstancedMesh(geo, mat(PRODUCT_INFO[sh.product].color, q, { rough: 0.4 }), slots.length);
      const m4 = new THREE.Matrix4();
      slots.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m4); });
      inst.count = 0; inst.castShadow = true; inst.frustumCulled = false;
      S.add(inst);
      this.shelfInst.set(sh.product, { mesh: inst, slots });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: PRODUCT_INFO[sh.product].name, size: 64 }], 512, 128, '#' + PRODUCT_INFO[sh.product].color.toString(16).padStart(6, '0'))) }));
      if (isFridge) { lbl.position.set(b.x0 - 0.01, b.h + 0.25, (b.z0 + b.z1) / 2); lbl.rotation.y = -Math.PI / 2; S.add(lbl); }
      else { lbl.position.set((b.x0 + b.x1) / 2, b.h + 0.25, b.z0 - 0.01); lbl.rotation.y = Math.PI; S.add(lbl); const l2 = lbl.clone(); l2.position.z = b.z1 + 0.01; l2.rotation.y = 0; S.add(l2); }
    }
    // counter
    S.add(boxMesh(COUNTER, COUNTER.h, mat(0x8d6e63, q)));
    S.add(boxMesh({ ...COUNTER, x0: COUNTER.x0 - 0.05, x1: COUNTER.x1 + 0.05, z0: COUNTER.z0 - 0.05, z1: COUNTER.z1 + 0.05 }, 0.05, mat(0xf1f3f5, q, { rough: 0.3 }), COUNTER.h));
    for (const r of REGISTERS) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.4), mat(0x343a40, q)); base.position.y = 0.075;
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.04), mat(0x212529, q)); scr.position.set(0, 0.32, -0.08); scr.rotation.x = -0.25;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ color: r.idx === 0 ? 0x69db7c : 0x69db7c })); glow.position.set(0, 0.32, -0.055); glow.rotation.x = -0.25;
      g.add(base, scr, glow);
      g.position.set(r.x, COUNTER.h + 0.05, r.z);
      S.add(g);
      const lbl = new Label(1.2, 0.3); lbl.set('reg' + r.idx, () => textCanvas([{ text: `收銀台 ${r.idx + 1}`, size: 54 }], 512, 128)); lbl.sprite.position.set(r.x, 2.2, r.z); S.add(lbl.sprite);
      if (r.idx === 1) { this.register2 = [g, lbl.sprite]; }
    }
    // coffee machine
    S.add(boxMesh(COFFEE_MACHINE, 0.9, mat(0x343a40, q)));
    const cm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.45), mat(0xadb5bd, q, { metal: 0.6, rough: 0.3 })); cm.position.set((COFFEE_MACHINE.x0 + COFFEE_MACHINE.x1) / 2, 1.2, (COFFEE_MACHINE.z0 + COFFEE_MACHINE.z1) / 2); S.add(cm);
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })); st.position.copy(cm.position).add(new THREE.Vector3(0, 0.35, 0)); S.add(st); this.coffeeSteam.push(st); }
    const cl = new Label(1.2, 0.3); cl.set('coffee', () => textCanvas([{ text: '☕ 咖啡機', size: 56 }], 512, 128)); cl.sprite.position.set(cm.position.x, 2.0, cm.position.z); S.add(cl.sprite);
    const pickupMark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.35 })); pickupMark.rotation.x = -Math.PI / 2; pickupMark.position.set(COFFEE_PICKUP.x, 0.01, COFFEE_PICKUP.z); S.add(pickupMark);
    const pl = new Label(1.2, 0.3); pl.set('pick', () => textCanvas([{ text: '取餐區', size: 56 }], 512, 128)); pl.sprite.position.set(COFFEE_PICKUP.x, 2.3, COFFEE_PICKUP.z); S.add(pl.sprite);
    const compMark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.3 })); compMark.rotation.x = -Math.PI / 2; compMark.position.set(COMPLAINT_SPOT.x, 0.01, COMPLAINT_SPOT.z); S.add(compMark);
    // queue rope
    for (let i = 0; i < 5; i++) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 8), mat(0xfab005, q, { metal: 0.7, rough: 0.3 })); post.position.set(18.2 + i * 1.0, 0.45, 13.85); S.add(post); }
    const rope = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 0.05), mat(0xc92a2a, q)); rope.position.set(20.2, 0.8, 13.85); S.add(rope);
    // crates
    for (const c of CRATES) {
      S.add(boxMesh(c.box, 0.12, mat(0x795548, q)));
      const stack = new THREE.Group(); S.add(stack); this.crateStacks.set(c.product, stack);
      const lbl = new Label(1.1, 0.28); lbl.set('cr' + c.product, () => textCanvas([{ text: `${PRODUCT_INFO[c.product].name}貨箱`, size: 52 }], 512, 128)); lbl.sprite.position.set((c.box.x0 + c.box.x1) / 2, 2.3, (c.box.z0 + c.box.z1) / 2); S.add(lbl.sprite);
    }
    // mop rack
    S.add(boxMesh(MOP_RACK, 0.1, mat(0x495057, q)));
    for (let i = 0; i < 2; i++) {
      const mop = heldModel(q, { kind: 'mop' }); mop.rotation.x = -0.5; mop.position.set(0.35, 0.65, MOP_RACK.z0 + 0.4 + i * 0.6); S.add(mop); this.mopsOnRack.push(mop);
    }
    const ml = new Label(1.0, 0.26); ml.set('mop', () => textCanvas([{ text: '🧹 拖把', size: 56 }], 512, 128)); ml.sprite.position.set(0.5, 2.0, (MOP_RACK.z0 + MOP_RACK.z1) / 2); S.add(ml.sprite);
    // decor
    for (const d of DECOR) {
      if (d.kind === 'plant') { S.add(boxMesh(d, 0.5, mat(0x8d6e63, q))); const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), mat(0x37b24d, q)); leaves.position.set((d.x0 + d.x1) / 2, 1.1, (d.z0 + d.z1) / 2); S.add(leaves); }
      else if (d.kind === 'atm') { S.add(boxMesh(d, 1.9, mat(0x1971c2, q))); }
      else { S.add(boxMesh(d, d.h, mat(0xfab005, q))); }
    }
    // wall clock
    this.clockLabel.sprite.position.set(18.5, 2.6, 0.05); S.add(this.clockLabel.sprite);
    // posters
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '顧客至上', size: 72, color: '#ffd43b' }, { text: '但奧客退散', size: 54 }], 512, 256, '#c92a2a')) }));
    poster.position.set(12, 2.0, 0.02); S.add(poster);
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
      if (stack.children.length !== boxes) {
        stack.clear();
        const c = CRATES.find(c => c.product === p)!.box;
        for (let i = 0; i < boxes; i++) {
          const b = heldModel(q, { kind: 'box', product: p, qty: 6 });
          b.position.set((c.x0 + c.x1) / 2 + ((i % 2) - 0.5) * 0.5, 0.27 + Math.floor(i / 2) * 0.31, (c.z0 + c.z1) / 2);
          stack.add(b);
        }
      }
    }
    this.mopsOnRack.forEach((m, i) => { m.visible = i < snap.mopsOnRack; });
    this.register2.forEach(o => { o.visible = snap.upgrades.register2 > 0; });
    const hh = Math.floor(snap.clock / 60), mm = Math.floor(snap.clock % 60);
    const clk = `${String(hh).padStart(2, '0')}:${String(mm - (mm % 5)).padStart(2, '0')}`;
    this.clockLabel.set(clk, () => textCanvas([{ text: '🕒 ' + clk, size: 64 }], 512, 128, '#212529'));
    this.coffeeSteam.forEach((s, i) => { const t = (this.time * 0.6 + i / 3) % 1; s.position.y = 1.55 + t * 0.6; (s.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - t); });

    // customers
    const seen = new Set<number>();
    let doorNear = false;
    for (const c of snap.customers) {
      seen.add(c.id);
      let e = this.customers.get(c.id);
      if (!e) {
        const h = new Human(q, customerLook(c));
        if (c.kind !== 'normal') karenAccessory(q, h, c.kind);
        e = { h, s: { x: c.x, z: c.z, yaw: c.yaw }, kind: c.kind };
        this.customers.set(c.id, e); this.scene.add(h.group);
      }
      this.smooth(e.s, c.x, c.z, c.yaw, dt);
      e.h.group.position.set(e.s.x, 0, e.s.z); e.h.group.rotation.y = e.s.yaw;
      e.h.animate(dt, c.moving, c.kind === 'streamer' ? 1.4 : 1);
      if (Math.abs(c.x - 12) < 2.2 && Math.abs(c.z - 16) < 2.2) doorNear = true;
      // icons
      let key = '', draw: (() => HTMLCanvasElement) | null = null;
      if (c.kind !== 'normal' && !c.resolved && c.revealed) {
        if (c.kind === 'rager') { const a = c.anger; key = 'r' + Math.round(a / 4); draw = () => textCanvas([{ text: '😡 退貨大鬧', size: 46, color: '#ffc9c9' }], 512, 150, 'rgba(120,10,30,0.88)', { v: a / 100, color: a > 70 ? '#ff3b3b' : '#ffa94d' }); }
        else if (c.kind === 'cutter') { key = 'cut'; draw = () => textCanvas([{ text: '⚠ 插隊！', size: 54, color: '#ffe066' }], 512, 128, 'rgba(120,60,0,0.88)'); }
        else if (c.kind === 'streamer') { key = 'str'; draw = () => textCanvas([{ text: '📱 直播亂拍', size: 50, color: '#d0bfff' }], 512, 128, 'rgba(60,20,120,0.88)'); }
        else if (c.kind === 'hog') { key = 'hog'; draw = () => textCanvas([{ text: '❓ 偷吃中', size: 52, color: '#ffe066' }], 512, 128, 'rgba(60,60,60,0.88)'); }
      } else if (c.state === 'waitCoffee' || (c.wantsCoffee && c.state === 'toCoffee')) {
        key = 'cf' + Math.round(c.patience * 10); draw = () => textCanvas([{ text: '☕ 等咖啡', size: 46 }], 512, 150, 'rgba(15,16,26,0.82)', { v: c.patience, color: c.patience < 0.3 ? '#ff6b6b' : '#ffd43b' });
      } else if (c.state === 'queue' || c.state === 'atRegister' || c.state === 'toRegister') {
        key = 'q' + Math.round(c.patience * 10) + c.state; draw = () => textCanvas([{ text: c.state === 'atRegister' ? '💳 等結帳' : '⏳ 排隊', size: 44 }], 512, 150, 'rgba(15,16,26,0.82)', { v: c.patience, color: c.patience < 0.3 ? '#ff6b6b' : '#51cf66' });
      } else if (c.state === 'leaving' && c.kind === 'normal' && c.patience <= 0.01) {
        key = 'angry'; draw = () => textCanvas([{ text: '💢', size: 80 }], 256, 128, '');
      }
      e.h.icon.set(key, draw ?? (() => document.createElement('canvas')));
      e.h.icon.sprite.scale.set(key === 'angry' ? 0.7 : 1.7, key === 'angry' ? 0.35 : (key.startsWith('r') || key.startsWith('q') || key.startsWith('cf') ? 0.5 : 0.42), 1);
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
        const h = new Human(q, { shirt: p.color, pants: 0x343a40, skin: SKIN[p.id.charCodeAt(1) % SKIN.length], hair: HAIR[p.id.charCodeAt(2) % HAIR.length], hairStyle: p.id.charCodeAt(3) % 4, apron: true });
        e = { h, s: { x: p.x, z: p.z, yaw: p.yaw } };
        this.players.set(p.id, e); this.scene.add(e.h.group);
      }
      const rp = renderPlayers(p.id) ?? p;
      const moving = Math.hypot(rp.x - e.s.x, rp.z - e.s.z) > 0.01;
      this.smooth(e.s, rp.x, rp.z, rp.yaw, dt);
      e.h.group.position.set(e.s.x, 0, e.s.z); e.h.group.rotation.y = e.s.yaw;
      e.h.animate(dt, moving);
      e.h.setHeld(q, p.held);
      const status = !p.connected ? ' 📶斷線' : p.away ? ' 💤' : '';
      const lkey = p.name + status + (p.busy ? '…' : '');
      e.h.label.set(lkey, () => textCanvas([{ text: p.name + status, size: 52, color: '#' + p.color.toString(16).padStart(6, '0') }], 512, 128));
      e.h.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && 'opacity' in m && o !== e!.h.label.sprite) { m.transparent = !p.connected; m.opacity = p.connected ? 1 : 0.4; } });
      if (Math.abs(e.s.x - 12) < 2.2 && Math.abs(e.s.z - 16) < 2.2) doorNear = true;
    }
    for (const [id, e] of this.players) if (!seenP.has(id)) { this.scene.remove(e.h.group); this.players.delete(id); }

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
        const lbl = new Label(0.9, 0.3); lbl.set('ping', () => textCanvas([{ text: '📍 這裡', size: 60 }], 512, 160)); lbl.sprite.position.y = 3.2;
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
    this.particles = this.particles.filter(p => { if (p.life <= 0) { this.scene.remove(p.mesh); return false; } return true; });
  }

  floatText(text: string, x: number, z: number, color = '#69db7c') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text, size: 72, color }], 512, 128, '')), transparent: true, depthTest: false }));
    s.scale.set(1.4, 0.35, 1); s.position.set(x, 2.0, z); s.renderOrder = 20;
    this.scene.add(s); this.floaters.push({ obj: s, life: 1.6, vy: 0.8 });
  }

  burst(x: number, z: number, color: number, n = 14) {
    if (this.q === 'low') n = Math.ceil(n / 2);
    const m = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), m);
      mesh.position.set(x, 0.6, z);
      this.scene.add(mesh);
      this.particles.push({ mesh, v: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3), life: 0.9 });
    }
  }

  /** First-person camera + held item view model. */
  setCamera(x: number, z: number, yaw: number, pitch: number, bob: number, held: Held | null) {
    this.camera.position.set(x, EYE_HEIGHT + Math.sin(bob) * 0.035, z);
    this.camera.rotation.set(pitch, yaw + Math.PI, 0);
    const key = held ? (held.kind === 'box' ? 'box' + held.product : held.kind) : '';
    if (key !== this.viewHeldKey) {
      this.viewHeldKey = key; this.viewHeld.clear();
      if (held) { const m = heldModel(this.q, held); if (held.kind === 'mop') { m.rotation.set(0.3, 0, 0); m.position.set(0, 0.1, 0); } this.viewHeld.add(m); m.traverse(o => { o.renderOrder = 5; }); }
    }
    this.viewHeld.position.set(0.32 + Math.cos(bob * 0.5) * 0.01, -0.3 + Math.abs(Math.sin(bob)) * 0.015, -0.55);
  }

  setHighlight(box: THREE.Box3 | null) {
    if (!box) { this.highlight.visible = false; return; }
    this.highlight.box.copy(box); this.highlight.visible = true;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  customerWorldPos(id: number) { const e = this.customers.get(id); return e ? e.s : null; }
}

export const FIXTURE_HEIGHT: Record<string, number> = { shelf: 1.9, fridge: 2, counter: 1.1, coffee: 1.5, crate: 1.3, mop: 1.5 };
export { COFFEE_MACHINE, CRATES, MOP_RACK, REGISTERS, SHELVES };
