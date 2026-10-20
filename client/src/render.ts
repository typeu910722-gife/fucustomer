// Three.js scene: the store, live stock displays, characters (players, customers, karens) and effects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  B, CAP, CONE, CYL, DOME, Human, ICON_Y, Label, Pose, RB, SIT_Y, SKIN, HAIR, SPH, TOR, basic, buildRegister, customerLook, geo, heldModel, hex,
  karenAccessory, mat, mergeInto, poleTexture, posScreenTexture, put, textCanvas,
} from './models.ts';
import { FOOD_INFO, PRODUCT_INFO, PRODUCTS, Product, shelfCapacity, EYE_HEIGHT } from '../../shared/constants.ts';
import {
  AABB, COFFEE_MACHINE, MICROWAVE, COFFEE_PICKUP, COMPLAINT_SPOT, COUNTER, CRATES, DECOR, DOOR_X0, DOOR_X1, MOP_RACK, REGISTERS, SHELVES,
  CURRENT_MAP, OUTLET, STORE_D, STORE_W, WALLS, shelfFacing, SOLIDS, QUEUE_SPOTS, PLAYER_SPAWNS, WANDER_SPOTS, TRYON_SPOTS, CHARGE_SPOT, distToAABB,
} from '../../shared/map.ts';
import type { CustomerSnap, Held, PlayerSnap, Snapshot } from '../../shared/protocol.ts';
import type { Quality } from './storage.ts';

// ---------- helpers ----------
export { textCanvas };

function boxMesh(b: AABB, h: number, m: THREE.Material, y0 = 0) {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, h, b.z1 - b.z0);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set((b.x0 + b.x1) / 2, y0 + h / 2, (b.z0 + b.z1) / 2);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** Speckled terrazzo-like tiles with grout lines. */
/** Item mesh for a product shape (instanced on shelves). */
function productGeometry(shape: string): THREE.BufferGeometry {
  switch (shape) {
    case 'can': return new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10);
    case 'bottle': return new THREE.CylinderGeometry(0.07, 0.08, 0.36, 8);
    case 'cup': return new THREE.CylinderGeometry(0.1, 0.08, 0.28, 10);
    case 'flat': return new THREE.BoxGeometry(0.3, 0.12, 0.4);
    case 'shirt': return new THREE.BoxGeometry(0.05, 0.6, 0.48);
    case 'pants': return new THREE.BoxGeometry(0.05, 0.75, 0.36);
    case 'bag': return new THREE.BoxGeometry(0.36, 0.3, 0.16);
    default: return new THREE.BoxGeometry(0.4, 0.3, 0.12);
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

function windowsTexture(base: string) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let y = 12; y < 250; y += 28) for (let x = 10; x < 120; x += 28) {
    g.fillStyle = Math.random() < 0.35 ? '#ffe8a3' : 'rgba(40,50,70,0.75)'; g.fillRect(x, y, 16, 18);
  }
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
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffe066));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    const before = new Set(this.scene.children);
    this.build();
    this.mergeStatic(before);
    this.resize();
  }

  setQuality(q: Quality) {
    this.q = q;
    const pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 0.85);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q === 'high';
    this.resize();
  }

  /** Dynamic resolution: 0.5–1 multiplier on the quality's pixel ratio. */
  resScale = 1;
  setResolutionScale(f: number) { this.resScale = Math.max(0.5, Math.min(1, f)); this.resize(); }

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
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.62), fixtureM); f.position.set(x, 3.15, z); S.add(f);
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
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: CURRENT_MAP.sign.text, size: 70, color: '#fff' }], 1024, 200, CURRENT_MAP.sign.bg)) }));
    sign.position.set(12, 2.86, STORE_D - 0.02); sign.rotation.y = Math.PI; sign.scale.set(0.8, 0.62, 1); S.add(sign);
    const sign2 = sign.clone(); sign2.position.set(12, 2.9, STORE_D + 0.32); sign2.rotation.y = 0; sign2.scale.set(1, 1, 1); S.add(sign2);
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '出口 EXIT', size: 64, color: '#fff' }], 512, 160, '#2b8a3e')) }));
    exitSign.position.set(12, 2.4, STORE_D - 0.03); exitSign.rotation.y = Math.PI; S.add(exitSign);
    // wall socket by the window (where 充電霸王 squats)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.03), mat(0xf8f9fa, this.q)); plate.position.set(OUTLET.x, 0.35, OUTLET.z - 0.02); S.add(plate);
    const chargeSign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '🔌 充電座', size: 60, color: '#fff' }], 512, 180, '#1098ad')) }));
    chargeSign.position.set(OUTLET.x, 0.75, OUTLET.z - 0.03); chargeSign.rotation.y = Math.PI; S.add(chargeSign);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5c1a1a }));
    this.beacon.position.set(13.9, 2.9, STORE_D - 0.25); this.beacon.userData.dynamic = true; S.add(this.beacon);
    if (q !== 'low') { this.beaconLight = new THREE.PointLight(0xff3b30, 0, 9, 1.5); this.beaconLight.position.copy(this.beacon.position).add(new THREE.Vector3(0, -0.3, -0.4)); S.add(this.beaconLight); }
    const stockSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '倉庫 STOCK', size: 60 }], 512, 128, '#495057')) }));
    stockSign.position.set(3.4, 2.4, 5.27); S.add(stockSign);
    // shelves
    for (const sh of SHELVES) {
      const b = sh.box;
      const face = shelfFacing(b); // -1: wall unit on the east wall (opens west), +1: on the west wall, 0: free-standing
      const isWall = face !== 0, isFridge = b.kind === 'fridge', isRack = b.kind === 'rack';
      const info = CURRENT_MAP.products[sh.product];
      const frame = mat(isFridge ? 0xdee2e6 : TH.shelf, q, { metal: 0.3, rough: 0.5 });
      const openX = face < 0 ? b.x0 : b.x1, backX = face < 0 ? b.x1 : b.x0;
      S.add(boxMesh({ ...b }, isRack ? 0.04 : 0.12, frame));
      if (isWall) {
        S.add(boxMesh(face < 0 ? { ...b, x0: b.x1 - 0.12 } : { ...b, x1: b.x0 + 0.12 }, b.h, frame));
        S.add(boxMesh(b, 0.1, frame, b.h - 0.1));
        if (isFridge) {
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
      const slots: THREE.Vector3[] = [];
      if (isRack) {
        for (let x = b.x0 + 0.3; x < b.x1 - 0.2; x += 0.24) { slots.push(new THREE.Vector3(x, b.h - 0.45, b.z0 + 0.15)); slots.push(new THREE.Vector3(x, b.h - 0.45, b.z1 - 0.15)); }
      } else if (isWall) {
        for (const t of tiers.slice(0, 3)) for (let z = b.z0 + 0.3; z < b.z1 - 0.2; z += 0.75) slots.push(new THREE.Vector3(openX - face * 0.35, t + 0.16, z));
      } else {
        for (const t of tiers.slice(0, 3)) for (let x = b.x0 + 0.35; x < b.x1 - 0.2; x += 0.75) { slots.push(new THREE.Vector3(x, t + 0.17, b.z0 + 0.2)); slots.push(new THREE.Vector3(x, t + 0.17, b.z1 - 0.2)); }
      }
      // interleave so partially-filled shelves look evenly stocked
      slots.sort((a, c) => ((a.x * 7 + a.z * 13) % 1) - ((c.x * 7 + c.z * 13) % 1));
      const geo = productGeometry(info.shape);
      const inst = new THREE.InstancedMesh(geo, mat(0xffffff, q, { rough: 0.4 }), slots.length);
      const m4 = new THREE.Matrix4();
      const palette = info.palette;
      const col = new THREE.Color(), sc = new THREE.Vector3(), qt = new THREE.Quaternion(), ps = new THREE.Vector3();
      slots.forEach((p, i) => {
        const v = isRack ? 1 : 0.85 + ((i * 37) % 7) / 20;
        sc.set(v, isRack ? 1 : 0.85 + ((i * 13) % 5) / 12, v); qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), isRack ? 0 : ((i * 53) % 10) / 40);
        ps.set(p.x, p.y + (sc.y - 1) * 0.15, p.z); m4.compose(ps, qt, sc); inst.setMatrixAt(i, m4);
        inst.setColorAt(i, col.setHex(palette[(i * 7) % palette.length]));
      });
      inst.count = 0; inst.castShadow = true; inst.frustumCulled = false;
      S.add(inst);
      this.shelfInst.set(sh.product, { mesh: inst, slots });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: PRODUCT_INFO[sh.product].name, size: 64 }], 512, 128, '#' + PRODUCT_INFO[sh.product].color.toString(16).padStart(6, '0'))) }));
      if (isWall) { lbl.position.set(openX + face * 0.01, b.h + 0.25, (b.z0 + b.z1) / 2); lbl.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2; S.add(lbl); }
      else { lbl.position.set((b.x0 + b.x1) / 2, b.h + 0.25, b.z0 - 0.01); lbl.rotation.y = Math.PI; S.add(lbl); const l2 = lbl.clone(); l2.position.z = b.z1 + 0.01; l2.rotation.y = 0; S.add(l2); }
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
      const lbl = new Label(1.2, 0.3); lbl.set('reg' + r.idx, () => textCanvas([{ text: `收銀台 ${r.idx + 1}`, size: 54 }], 512, 128)); lbl.sprite.position.set(r.x, 2.2, r.z); S.add(lbl.sprite);
      if (r.idx === 1) { this.register2 = [g, lbl.sprite]; }
    }
    this.buildCounterDetails();
    // food stations (a map may have none)
    const hasCoffee = !!CURRENT_MAP.coffee, hasMeal = !!CURRENT_MAP.meal;
    const SA = (o: THREE.Object3D, on: boolean) => { if (on) S.add(o); };
    SA(boxMesh(COFFEE_MACHINE, 0.9, mat(0x343a40, q)), hasCoffee);
    const cm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.45), mat(0xadb5bd, q, { metal: 0.6, rough: 0.3 })); cm.position.set((COFFEE_MACHINE.x0 + COFFEE_MACHINE.x1) / 2, 1.2, (COFFEE_MACHINE.z0 + COFFEE_MACHINE.z1) / 2); SA(cm, hasCoffee);
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })); st.position.copy(cm.position).add(new THREE.Vector3(0, 0.35, 0)); SA(st, hasCoffee); this.coffeeSteam.push(st); }
    const cl = new Label(1.2, 0.3); cl.set('coffee' + FOOD_INFO.coffee.station, () => textCanvas([{ text: `${FOOD_INFO.coffee.icon} ${FOOD_INFO.coffee.station}`, size: 56 }], 512, 128)); cl.sprite.position.set(cm.position.x, 2.0, cm.position.z); SA(cl.sprite, hasCoffee);
    SA(boxMesh(MICROWAVE, 0.9, mat(0x343a40, q)), hasMeal);
    const mw = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.5), mat(0xf1f3f5, q, { rough: 0.4 })); mw.position.set((MICROWAVE.x0 + MICROWAVE.x1) / 2, 1.12, (MICROWAVE.z0 + MICROWAVE.z1) / 2); SA(mw, hasMeal);
    const mwDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), new THREE.MeshBasicMaterial({ color: 0x212529 })); mwDoor.position.set(mw.position.x - 0.08, 1.12, MICROWAVE.z1 - 0.14); mwDoor.rotation.y = 0; SA(mwDoor, hasMeal);
    this.microwaveGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.28), new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0 })); this.microwaveGlow.position.set(mw.position.x - 0.08, 1.12, MICROWAVE.z1 - 0.135); SA(this.microwaveGlow, hasMeal);
    const ml2 = new Label(1.2, 0.3); ml2.set('mw' + FOOD_INFO.meal.station, () => textCanvas([{ text: `${FOOD_INFO.meal.icon} ${FOOD_INFO.meal.station}`, size: 56 }], 512, 128)); ml2.sprite.position.set(mw.position.x, 2.0, mw.position.z); SA(ml2.sprite, hasMeal);
    const pickupMark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.35 })); pickupMark.rotation.x = -Math.PI / 2; pickupMark.position.set(COFFEE_PICKUP.x, 0.01, COFFEE_PICKUP.z); SA(pickupMark, hasCoffee || hasMeal);
    const pl = new Label(1.2, 0.3); pl.set('pick', () => textCanvas([{ text: '取餐區', size: 56 }], 512, 128)); pl.sprite.position.set(COFFEE_PICKUP.x, 2.3, COFFEE_PICKUP.z); SA(pl.sprite, hasCoffee || hasMeal);
    const compMark = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.3 })); compMark.rotation.x = -Math.PI / 2; compMark.position.set(COMPLAINT_SPOT.x, 0.01, COMPLAINT_SPOT.z); S.add(compMark);
    // queue rope
    const R = CURRENT_MAP.rope;
    if (R) {
      for (let x = R.x0; x <= R.x1 + 0.01; x += 1) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 8), mat(0xfab005, q, { metal: 0.7, rough: 0.3 })); post.position.set(x, 0.45, R.z); S.add(post); }
      const rope = new THREE.Mesh(new THREE.BoxGeometry(R.x1 - R.x0, 0.05, 0.05), mat(0xc92a2a, q)); rope.position.set((R.x0 + R.x1) / 2, 0.8, R.z); S.add(rope);
    }
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
    this.buildDecor();
    // wall clock
    this.clockLabel.sprite.position.set(18.5, 2.6, 0.05); S.add(this.clockLabel.sprite);
    // posters
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: CURRENT_MAP.poster[0], size: 72, color: '#ffd43b' }, { text: CURRENT_MAP.poster[1], size: 54 }], 512, 256, CURRENT_MAP.sign.bg)) }));
    poster.position.set(12, 2.0, 0.02); S.add(poster);
    put(S, RB(2.32, 1.22, 0.03, 0.012), mat(0xf8f9fa, q), 12, 2.0, 0.005);
    this.buildDetails();
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
      const tag = new THREE.Mesh(geo('tipTag', () => new THREE.PlaneGeometry(0.14, 0.07)), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: 'TIPS ♥', size: 50, color: '#fff' }], 256, 128, hex(TH.accent))) }));
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

  /** Map decor (plants, ATM, tables, bars, fitting rooms, mannequins, displays) as chunky toy props. */
  private buildDecor() {
    const q = this.q, S = this.scene, TH = CURRENT_MAP.theme;
    for (const d of DECOR) {
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
        const sign = new THREE.Mesh(geo('atmSign', () => new THREE.PlaneGeometry(dp * 0.8, 0.22)), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '🏧 ATM 提款機', size: 56 }], 512, 128, '#0b4f8a')) }));
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
        const lbl = new Label(1.0, 0.26); lbl.set('fit', () => textCanvas([{ text: '👗 試衣間', size: 56 }], 512, 128)); lbl.sprite.position.set(cx, d.h + 0.4, cz); S.add(lbl.sprite);
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
        const sale = new THREE.Mesh(geo('saleSign', () => new THREE.PlaneGeometry(0.7, 0.35)), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: '特價 SALE', size: 60, color: '#fff' }], 512, 256, '#f03e3e')), side: THREE.DoubleSide }));
        sale.position.set(cx, 1.75, cz); sale.rotation.y = 0.4; S.add(sale);
      }
      else { put(S, RB(w, d.h, dp, 0.05), mat(0xfab005, q), cx, d.h / 2, cz); }
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
    const wf = this.pick([[0.5, MOP_RACK.z1 + 0.45], [0.5, MOP_RACK.z0 - 0.45], [1.2, MOP_RACK.z1 + 0.5]], 0.25);
    if (wf) {
      const [x, z] = wf, y = mat(0xffd43b, q, { rough: 0.5 });
      for (const s of [-1, 1]) put(S, RB(0.36, 0.62, 0.02, 0.01), y, x, 0.3, z + s * 0.1, s * 0.18);
      for (const s of [-1, 1]) put(S, CONE(0.07, 0.12, 3), basic(0x212529), x, 0.38, z + s * 0.125, Math.PI / 2 * s + s * 0.18, 0, Math.PI);
      put(S, SPH(0.022, 6, 4), basic(0x212529), x, 0.25, z + 0.13);
      put(S, SPH(0.022, 6, 4), basic(0x212529), x, 0.25, z - 0.13);
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
      const pm = new THREE.Mesh(geo('poster', () => new THREE.PlaneGeometry(1.2, 0.75)), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text: a, size: 46 }, { text: b, size: 40, color: '#fff3bf' }], 512, 320, bg)) }));
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
    for (const o of this.scene.children) {
      if (before.has(o) || !(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.userData.dynamic) continue;
      const m = o.material as THREE.Material;
      if (Array.isArray(o.material) || m.transparent) continue;
      o.updateMatrixWorld(true);
      const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.index) continue;
      (groups.get(m) ?? groups.set(m, []).get(m)!).push(g);
      remove.push(o);
    }
    for (const o of remove) this.scene.remove(o);
    for (const [m, list] of groups) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
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
    for (let i = 0; i < 7; i++) {
      const hgt = 7 + (i * 37) % 10;
      const tex = windowsTexture(cols[i % cols.length]);
      const b = new THREE.Mesh(new THREE.BoxGeometry(7, hgt, 6), new THREE.MeshLambertMaterial({ map: tex }));
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
      // icons
      let key = '', draw: (() => HTMLCanvasElement) | null = null;
      if (c.kind === 'boss' && !c.resolved && !c.held && !c.flying) {
        const ph = ['', '插隊霸王', '退貨暴君', '直播帝王', '召喚小弟', '強弩之末'][c.phase] ?? '';
        key = 'boss' + c.phase + (c.phase === 2 ? Math.round(c.anger / 5) : '');
        draw = () => textCanvas([{ text: `👑 奧客之王・${ph}`, size: 44, color: '#ffe066' }], 512, 150, 'rgba(80,20,120,0.92)', c.phase === 2 ? { v: c.anger / 100, color: '#ff6b6b' } : { v: (c.phase - 1) / 4, color: '#ffd43b' });
      } else if (c.stun > 0 && !c.held && !c.flying) { key = 'stun' + (c.heavy ? 'h' : ''); draw = () => textCanvas([{ text: c.heavy ? '💫 暈了！現在抓得動' : '💫 暈了', size: 46, color: '#fff3bf' }], 512, 128, 'rgba(15,16,26,0.7)'); }
      else if (c.down > 0) { key = 'down'; draw = () => textCanvas([{ text: '💫 好痛…', size: 50 }], 512, 128, 'rgba(15,16,26,0.6)'); }
      else if (c.held || c.flying) { key = c.held ? 'held' : 'fly'; draw = () => textCanvas([{ text: c.held ? '😵 放開我！' : '😱 啊——', size: 50 }], 512, 128, 'rgba(15,16,26,0.7)'); }
      else if (c.kind !== 'normal' && !c.resolved && c.revealed) {
        const tag = (c.violent ? '🤬' : '') + (c.vip ? '💼' : '') + (c.heavy ? '🏋' : '');
        if (tag && c.kind !== 'rager') { key = 'tag' + c.kind + tag + (c.kind === 'charger' ? Math.round(c.patience * 10) + '' + c.phase : ''); const name = { cutter: '⚠ 插隊！', streamer: '📱 直播亂拍', hog: '❓ 偷吃中', litterer: '🗑 亂丟垃圾', charger: c.phase ? '🔌 又插回去了！' : '🔌 霸佔插座', custom: '🍳 客製魔人', fickle: '🧋 改單達人', tryhard: '👕 試穿狂' }[c.kind as string] ?? ''; draw = () => textCanvas([{ text: name, size: 44, color: '#ffe066' }, { text: `${c.vip ? '💼 好像有背景' : ''}${c.vip && c.heavy ? '・' : ''}${c.heavy ? '🏋 抓不動' : ''}`, size: 34, color: '#ffc9c9' }], 512, 170, 'rgba(60,20,40,0.9)'); }
        else if (c.kind === 'rager') { const a = c.anger; key = 'r' + Math.round(a / 4) + tag; draw = () => textCanvas([{ text: c.violent ? '🤬 失控！可正當防衛' : '😡 退貨大鬧', size: 46, color: '#ffc9c9' }, ...(c.vip || c.heavy ? [{ text: `${c.vip ? '💼 好像有背景' : ''}${c.vip && c.heavy ? '・' : ''}${c.heavy ? '🏋 抓不動' : ''}`, size: 32, color: '#ffe066' }] : [])], 512, 150, 'rgba(120,10,30,0.88)', { v: a / 100, color: a > 70 ? '#ff3b3b' : '#ffa94d' }); }
        else if (c.kind === 'cutter') { key = 'cut'; draw = () => textCanvas([{ text: '⚠ 插隊！', size: 54, color: '#ffe066' }], 512, 128, 'rgba(120,60,0,0.88)'); }
        else if (c.kind === 'streamer') { key = 'str'; draw = () => textCanvas([{ text: '📱 直播亂拍', size: 50, color: '#d0bfff' }], 512, 128, 'rgba(60,20,120,0.88)'); }
        else if (c.kind === 'hog') { key = 'hog'; draw = () => textCanvas([{ text: '❓ 偷吃中', size: 52, color: '#ffe066' }], 512, 128, 'rgba(60,60,60,0.88)'); }
        else if (c.kind === 'custom') { key = 'cus' + c.state; draw = () => textCanvas([{ text: c.state === 'atRegister' ? '🍳 我要改單…' : '🍳 客製魔人', size: 48, color: '#ffe066' }], 512, 128, 'rgba(120,70,0,0.9)'); }
        else if (c.kind === 'fickle') { key = 'fic' + c.phase; draw = () => textCanvas([{ text: c.phase ? '🧋 我要改甜度！' : '🧋 改單達人', size: 48, color: '#fcc2d7' }], 512, 128, 'rgba(110,20,60,0.9)'); }
        else if (c.kind === 'tryhard') { key = 'try'; draw = () => textCanvas([{ text: '👕 試穿中…', size: 50, color: '#e5dbff' }], 512, 128, 'rgba(60,30,110,0.9)'); }
        else if (c.kind === 'charger') { const v = c.patience; key = 'chg' + Math.round(v * 10) + c.phase; draw = () => textCanvas([{ text: c.phase ? '🔌 又插回去了！' : '🔌 霸佔插座', size: 46, color: '#99e9f2' }], 512, 150, 'rgba(10,60,80,0.9)', { v, color: '#3bc9db' }); }
        else if (c.kind === 'litterer') { key = 'lit'; draw = () => textCanvas([{ text: '🗑 亂丟垃圾', size: 50, color: '#d8f5a2' }], 512, 128, 'rgba(40,70,20,0.88)'); }
      } else if (c.want && (c.state === 'waitFood' || c.state === 'toFood')) {
        const label = c.want === 'meal' ? '🍱 等熱便當' : '☕ 等咖啡';
        key = 'cf' + c.want + Math.round(c.patience * 10); draw = () => textCanvas([{ text: label, size: 46 }], 512, 150, 'rgba(15,16,26,0.82)', { v: c.patience, color: c.patience < 0.3 ? '#ff6b6b' : '#ffd43b' });
      } else if (c.state === 'queue' || c.state === 'atRegister' || c.state === 'toRegister') {
        key = 'q' + Math.round(c.patience * 10) + c.state; draw = () => textCanvas([{ text: c.state === 'atRegister' ? '💳 等結帳' : '⏳ 排隊', size: 44 }], 512, 150, 'rgba(15,16,26,0.82)', { v: c.patience, color: c.patience < 0.3 ? '#ff6b6b' : '#51cf66' });
      } else if (c.state === 'leaving' && c.kind === 'normal' && c.patience <= 0.01) {
        key = 'angry'; draw = () => textCanvas([{ text: '💢', size: 80 }], 256, 128, '');
      }
      e.h.icon.set(key, draw ?? (() => document.createElement('canvas')));
      // fade overhead labels that are right in front of the camera so they don't cover the view
      const camD = Math.hypot(this.camera.position.x - e.s.x, this.camera.position.z - e.s.z);
      (e.h.icon.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0.12, Math.min(1, (camD - 1.0) / 1.6));
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
      const lkey = p.name + status + (p.busy ? '…' : '');
      e.h.label.set(lkey, () => textCanvas([{ text: p.name + status, size: 52, color: '#' + p.color.toString(16).padStart(6, '0') }], 512, 128));
      e.h.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && 'opacity' in m && o !== e!.h.label.sprite) { m.transparent = !p.connected; m.opacity = p.connected ? 1 : 0.4; } });
      if (Math.abs(e.s.x - 12) < 2.2 && Math.abs(e.s.z - 16) < 2.2) doorNear = true;
    }
    for (const [id, e] of this.players) if (!seenP.has(id)) { this.scene.remove(e.h.group); this.players.delete(id); }

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
    (this.microwaveGlow.material as THREE.MeshBasicMaterial).opacity = snap.players.some(p => p.busy?.kind === 'heat') ? 0.6 + Math.sin(this.time * 8) * 0.2 : 0;
    const me = snap.players.find(p => p.id === selfId);
    (this.exitGlow.material as THREE.MeshBasicMaterial).opacity = me?.grabbing != null ? 0.35 + Math.sin(this.time * 6) * 0.15 : 0;
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
    this.particles = this.particles.filter(p => { if (p.life <= 0) { this.scene.remove(p.mesh); if (this.particlePool.length < 120) this.particlePool.push(p.mesh); return false; } return true; });
  }

  floatText(text: string, x: number, z: number, color = '#69db7c') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(textCanvas([{ text, size: 72, color }], 512, 128, '')), transparent: true, depthTest: false }));
    s.scale.set(1.4, 0.35, 1); s.position.set(x, 2.0, z); s.renderOrder = 20;
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

  render() { this.renderer.render(this.scene, this.camera); }

  customerWorldPos(id: number) { const e = this.customers.get(id); return e ? e.s : null; }
}

export { Human, heldModel };
export type { Pose };
export const FIXTURE_HEIGHT: Record<string, number> = { shelf: 1.9, fridge: 2, counter: 1.1, coffee: 1.5, crate: 1.3, mop: 1.5 };
export { COFFEE_MACHINE, CRATES, MOP_RACK, REGISTERS, SHELVES };
