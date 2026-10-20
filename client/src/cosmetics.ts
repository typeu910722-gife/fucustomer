// 3D cosmetics from the 商城 (shared/shop.ts): hats, apron colours/patterns and name tags on staff characters, store
// decorations (燈牌 / 地墊 / 櫃台公仔) for free play and your own store, and the small 3D preview in the shop tab.
// Everything is low-poly with shared materials: worn items are built in head/torso space before Human bakes the body
// into one skinned mesh, and store decorations are added before StoreView merges its static geometry.
import * as THREE from 'three';
import { COUNTER, DOOR_X1, STORE_D } from '../../shared/map.ts';
import { getCosmetic, type Loadout, type Outfit } from '../../shared/shop.ts';
import type { Quality } from './storage.ts';
import { B, CAP, CONE, CYL, DOME, HEAD_R, HAIR, Human, RB, SKIN, SPH, TOR, basic, mat, put } from './models.ts';
import { font, textTexture } from './labels.ts';

const color = (id: string | undefined, fallback?: number) => getCosmetic(id)?.color ?? fallback;

/** Apron colour for an outfit (undefined = the store's default). */
export function apronColor(o: Outfit | undefined): number | undefined { return color(o?.uniform); }

/** Emoji shown before the name on the overhead label. */
export function tagPrefix(o: Outfit | undefined): string { const c = getCosmetic(o?.tag); return c ? c.icon + ' ' : ''; }

/**
 * Worn cosmetics on a staff character (called from Human's constructor). `front(y)` is the body's front surface z.
 * Returns true when a hat was placed (then the store's own work hat is skipped).
 */
export function wearOutfit(q: Quality, H: THREE.Object3D, torso: THREE.Object3D, o: Outfit | undefined, w: number, front: (y: number) => number): boolean {
  if (!o) return false;
  const uni = getCosmetic(o.uniform);
  if (uni?.color2 !== undefined) apronPattern(q, torso, uni.id, uni.color2, w, front);
  const tag = getCosmetic(o.tag);
  if (tag) {
    const tm = mat(tag.color, q), t2 = basic(tag.color2 ?? 0xffffff);
    const g = new THREE.Group(); g.position.set(0.09 * w, 0.92, front(0.92) + 0.032); g.rotation.x = -0.1; torso.add(g);
    put(g, RB(0.14, 0.08, 0.02, 0.01), tm, 0, 0, 0.004);
    put(g, B(0.09, 0.016, 0.01), t2, 0, 0.005, 0.016);
    if (tag.id === 'tag_star' || tag.id === 'tag_gold') put(g, CONE(0.025, 0.012, 5), t2, -0.05, 0.02, 0.016, Math.PI / 2);
    if (tag.id === 'tag_heart') for (const s of [-1, 1]) put(g, SPH(0.014, 6, 4), t2, -0.05 + s * 0.009, 0.02, 0.016);
  }
  const hat = getCosmetic(o.hat);
  if (!hat) return false;
  buildHat(q, H, hat.id, hat.color, hat.color2 ?? 0xffffff);
  return true;
}

/** Pattern pieces laid on the apron (same frame as the apron in models.ts: centre y 0.72, tilted -0.1). */
function apronPattern(q: Quality, torso: THREE.Object3D, id: string, c2: number, w: number, front: (y: number) => number) {
  const g = new THREE.Group(); g.position.set(0, 0.72, front(0.72) + 0.012); g.rotation.x = -0.1; torso.add(g);
  const m2 = mat(c2, q), z = 0.0175 + 0.004, aw = 0.34 * w;
  if (id === 'uni_stripe') for (const y of [-0.19, -0.09, 0.01, 0.11]) put(g, B(aw, 0.04, 0.008), m2, 0, y, z);
  else if (id === 'uni_check') { for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) put(g, B(aw / 4, 0.09, 0.008), m2, (i - 1.5) * aw / 4, -0.2 + j * 0.095, z); }
  else if (id === 'uni_dots') { for (const [x, y] of [[-0.1, -0.16], [0.08, -0.12], [-0.03, -0.03], [0.11, 0.03], [-0.11, 0.07], [0.03, 0.14]]) put(g, CYL(0.022, 0.022, 0.008, 8), m2, x * w, y, z, Math.PI / 2); }
  else if (id === 'uni_neon') { put(g, B(aw, 0.018, 0.008), basic(c2), 0, -0.17, z); put(g, B(aw, 0.012, 0.008), basic(0xf06595), 0, -0.13, z); put(g, B(0.016, 0.36, 0.008), basic(c2), aw * 0.38, 0, z); }
}

function buildHat(q: Quality, H: THREE.Object3D, id: string, c1: number, c2: number) {
  const R = HEAD_R, m1 = mat(c1, q), m2 = mat(c2, q);
  switch (id) {
    case 'hat_cap':
      put(H, DOME(R * 1.1, Math.PI * 0.42, 12, 4), m1, 0, 0.03, 0, -0.12);
      put(H, RB(0.34, 0.03, 0.2, 0.012), m1, 0, 0.15, R + 0.02, 0.18);
      put(H, SPH(0.03, 6, 4), m2, 0, R * 1.1 + 0.02, -0.04);
      put(H, CYL(0.05, 0.05, 0.012, 10), basic(c2), 0, 0.24, R * 0.86, Math.PI / 2 - 0.75);
      break;
    case 'hat_beanie':
      put(H, DOME(R * 1.1, Math.PI * 0.45, 12, 5), m1, 0, 0.05, -0.01, -0.15, 0, 0, 1, 1.12, 1);
      put(H, CYL(R * 1.11, R * 1.13, 0.07, 14, true), m2, 0, 0.06, -0.01, -0.15);
      put(H, SPH(0.075, 7, 5), m2, 0, R * 1.25, -0.08);
      break;
    case 'hat_party':
      put(H, TOR(0.12, 0.018, 4, 12), m2, 0.035, R + 0.03, -0.02, Math.PI / 2, 0, -0.15);
      put(H, CONE(0.13, 0.34, 10), m1, 0.04, R + 0.17, -0.02, 0, 0, -0.15);
      put(H, SPH(0.055, 7, 5), m2, 0.067, R + 0.34, -0.02);
      break;
    case 'hat_chef':
      put(H, CYL(R * 0.8, R * 0.84, 0.24, 14), m1, 0, R * 0.92, -0.03, -0.22);
      put(H, CYL(R * 0.85, R * 0.85, 0.05, 14), m2, 0, R * 0.74, -0.01, -0.22);
      for (const [x, z, r] of [[0, -0.08, 0.17], [-0.13, -0.04, 0.14], [0.13, -0.04, 0.14], [0, 0.06, 0.14]]) put(H, SPH(r, 10, 8), m1, x, R * 1.3 + 0.03, z - 0.06, 0, 0, 0, 1, 0.75, 1);
      break;
    case 'hat_cat':
      put(H, TOR(R * 1.04, 0.02, 4, 16, Math.PI), m1, 0, 0.02, -0.04, -0.25);
      for (const s of [-1, 1]) {
        put(H, CONE(0.1, 0.17, 4), m1, s * 0.18, R * 0.95, -0.05, -0.2, 0, -s * 0.4);
        put(H, CONE(0.055, 0.1, 4), basic(c2), s * 0.172, R * 0.93, -0.005, -0.2, 0, -s * 0.4);
      }
      break;
    case 'hat_crown':
      put(H, CYL(R * 0.78, R * 0.82, 0.11, 10, true), m1, 0, R * 0.9, -0.03, -0.2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        put(H, CONE(0.045, 0.1, 4), m1, Math.sin(a) * R * 0.78, R * 0.9 + 0.1 + Math.cos(a) * 0.02, -0.03 + Math.cos(a) * R * 0.76);
      }
      put(H, SPH(0.032, 6, 4), basic(c2), 0, R * 0.92, R * 0.78 - 0.02);
      break;
    case 'hat_gold':
      put(H, CYL(R * 1.08, R * 1.08, 0.025, 16), m1, 0, R * 0.8, -0.02, -0.15);
      put(H, CYL(R * 0.64, R * 0.68, 0.28, 12), m1, 0, R * 0.8 + 0.15, -0.04, -0.15);
      put(H, CYL(R * 0.69, R * 0.69, 0.06, 12), m2, 0, R * 0.8 + 0.05, -0.03, -0.15);
      put(H, SPH(0.035, 6, 4), basic(0xfff3bf), 0, R * 0.8 + 0.06, R * 0.62, 0, 0, 0, 1, 1, 0.5);
      break;
  }
}

// ---------------- store decorations ----------------
let storeDecor: Loadout | null = null;
/** Set before a free-play / own-store game starts (null for career shifts and other people's stores). */
export function setStoreDecor(l: Loadout | null) { storeDecor = l; }

/** Builds the equipped 燈牌 / 地墊 / 櫃台公仔 into the store (called by StoreView before it merges static meshes). */
export function buildShopDecor(scene: THREE.Object3D, q: Quality) {
  const l = storeDecor; if (!l) return;
  const mat_ = getCosmetic(l.mat);
  if (mat_) {
    const g = new THREE.Group(); g.position.set(12, 0, STORE_D - 0.85); scene.add(g);
    put(g, RB(1.7, 0.03, 0.95, 0.012), mat(mat_.color, q), 0, 0.015, 0);
    if (mat_.id === 'mat_paw') {
      const m2 = mat(mat_.color2 ?? 0xffffff, q);
      put(g, CYL(0.17, 0.17, 0.035, 12), m2, 0, 0.02, 0.05);
      for (const [x, z] of [[-0.2, -0.17], [-0.07, -0.26], [0.07, -0.26], [0.2, -0.17]]) put(g, CYL(0.06, 0.06, 0.035, 10), m2, x, 0.02, z);
    } else {
      put(g, RB(1.45, 0.034, 0.72, 0.01), mat(mat_.color2 ?? 0xffffff, q), 0, 0.017, 0);
      put(g, RB(1.3, 0.036, 0.58, 0.01), mat(mat_.color, q), 0, 0.019, 0);
    }
  }
  const sign = getCosmetic(l.sign);
  if (sign) {
    const g = new THREE.Group(); g.position.set(DOOR_X1 + 1.4, 2.25, STORE_D - 0.06); g.rotation.y = Math.PI; scene.add(g);
    put(g, RB(1.2, 0.56, 0.05, 0.03), mat(0x212529, q), 0, 0, 0);
    const neon = basic(sign.color), n2 = basic(sign.color2 ?? 0xffffff);
    for (const [x, y, w, h] of [[0, 0.22, 1.08, 0.03], [0, -0.22, 1.08, 0.03], [-0.53, 0, 0.03, 0.44], [0.53, 0, 0.03, 0.44]]) put(g, B(w, h, 0.02), neon, x, y, 0.035);
    if (sign.id === 'sign_live') {
      // red recording dot + LIVE
      put(g, CYL(0.07, 0.07, 0.02, 14), neon, -0.34, 0, 0.05, Math.PI / 2);
      const tex = textTexture(() => {
        const c = document.createElement('canvas'); c.width = 256; c.height = 96;
        const x = c.getContext('2d')!;
        x.font = font(64); x.textAlign = 'center'; x.textBaseline = 'middle';
        x.shadowColor = '#ff4d6d'; x.shadowBlur = 16; x.fillStyle = '#ff4d6d'; x.fillText('LIVE', 128, 50);
        x.shadowBlur = 0; x.fillStyle = '#ffffff'; x.fillText('LIVE', 128, 50);
        return c;
      });
      put(g, new THREE.PlaneGeometry(0.75, 0.28), new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0.12, 0, 0.04);
    } else if (sign.id === 'sign_coffee') {
      put(g, CYL(0.11, 0.09, 0.2, 10, true), neon, -0.05, -0.02, 0.06);
      put(g, TOR(0.06, 0.015, 4, 10), neon, 0.08, -0.01, 0.06);
      for (const x of [-0.09, -0.01]) put(g, CAP(0.012, 0.06, 4), n2, x, 0.14, 0.06);
    } else {
      // 「營業中」 (or a 店面等級 sign's words) in glowing neon letters (one small canvas texture)
      const col = '#' + sign.color.toString(16).padStart(6, '0');
      const words = SIGN_WORDS[sign.id] ?? '營業中', light = '#' + (sign.color2 ?? 0xfff5f5).toString(16).padStart(6, '0');
      const tex = textTexture(() => {
        const c = document.createElement('canvas'); c.width = 256; c.height = 96;
        const x = c.getContext('2d')!;
        x.font = font(64); x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = font(words.length > 3 ? 54 : 64);
        x.shadowColor = col; x.shadowBlur = 16; x.fillStyle = col; x.fillText(words, 128, 50);
        x.shadowBlur = 0; x.fillStyle = light; x.fillText(words, 128, 50);
        return c;
      });
      put(g, new THREE.PlaneGeometry(1.0, 0.375), new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0, 0, 0.04);
    }
  }
  const mascot = getCosmetic(l.mascot);
  if (mascot && COUNTER.x1 > COUNTER.x0) {
    const g = buildMascot(q, mascot.id, mascot.color, mascot.color2 ?? 0xffffff);
    g.position.set(COUNTER.x0 + 0.28, COUNTER.h, (COUNTER.z0 + COUNTER.z1) / 2); g.rotation.y = 0; // faces the customers (south)
    scene.add(g);
  }
}

/** Words on the 店面等級 reward signs (the default sign says 營業中). */
const SIGN_WORDS: Record<string, string> = { sign_local: '在地推薦', sign_legend: '傳說名店' };

export function buildMascot(q: Quality, id: string, c1: number, c2: number): THREE.Group {
  const g = new THREE.Group(), m1 = mat(c1, q), m2 = mat(c2, q), ink = basic(0x2b2230);
  if (id === 'mascot_cat') {
    put(g, SPH(0.14, 10, 8), m1, 0, 0.13, 0, 0, 0, 0, 1, 1.05, 0.9);
    put(g, SPH(0.12, 10, 8), m1, 0, 0.33, 0);
    for (const s of [-1, 1]) { put(g, CONE(0.045, 0.08, 4), m1, s * 0.07, 0.45, 0, 0, 0, -s * 0.3); put(g, SPH(0.014, 5, 4), ink, s * 0.045, 0.34, 0.11); }
    put(g, CAP(0.035, 0.1, 5), m1, 0.15, 0.36, 0.02, 0, 0, -0.3); // waving paw
    put(g, TOR(0.09, 0.018, 4, 12), m2, 0, 0.23, 0, Math.PI / 2);
    put(g, SPH(0.028, 6, 4), mat(0xfcc419, q), 0, 0.2, 0.09);
  } else if (id === 'mascot_duck') {
    put(g, SPH(0.15, 10, 8), m1, 0, 0.12, 0, 0, 0, 0, 1.1, 0.8, 1.25);
    put(g, SPH(0.1, 10, 8), m1, 0, 0.3, 0.06);
    put(g, RB(0.09, 0.03, 0.08, 0.012), m2, 0, 0.29, 0.16);
    for (const s of [-1, 1]) put(g, SPH(0.014, 5, 4), ink, s * 0.045, 0.33, 0.14);
  } else if (id === 'mascot_plug') {
    // a little two-pin plug with a face, sitting on its coiled cable
    put(g, TOR(0.1, 0.025, 5, 14), m2, 0, 0.03, 0, Math.PI / 2);
    put(g, RB(0.2, 0.2, 0.14, 0.04), m1, 0, 0.15, 0);
    for (const s of [-1, 1]) { put(g, B(0.025, 0.09, 0.025), mat(0xced4da, q), s * 0.05, 0.29, 0); put(g, SPH(0.016, 5, 4), ink, s * 0.045, 0.17, 0.072); }
    put(g, TOR(0.025, 0.008, 4, 8, Math.PI), ink, 0, 0.125, 0.072, 0, 0, Math.PI);
  } else if (id === 'mascot_trophy') {
    // a gold cup on a wooden base (店面 Lv8 reward)
    put(g, B(0.2, 0.06, 0.16), m2, 0, 0.03, 0);
    put(g, CYL(0.025, 0.04, 0.1, 8), m1, 0, 0.11, 0);
    put(g, CYL(0.11, 0.05, 0.16, 12), m1, 0, 0.24, 0);
    for (const s of [-1, 1]) put(g, TOR(0.045, 0.012, 4, 8), m1, s * 0.11, 0.25, 0);
  } else {
    put(g, CYL(0.1, 0.08, 0.12, 10), m2, 0, 0.06, 0);
    put(g, CAP(0.06, 0.16, 6), m1, 0, 0.25, 0);
    put(g, CAP(0.03, 0.06, 5), m1, 0.08, 0.27, 0, 0, 0, -0.9);
    put(g, CAP(0.03, 0.05, 5), m1, -0.08, 0.22, 0, 0, 0, 0.9);
    put(g, SPH(0.025, 6, 4), basic(0xf783ac), 0, 0.38, 0);
  }
  g.scale.setScalar(1.25);
  return g;
}

// ---------------- shop preview ----------------
/** A small turntable showing a staff character wearing `outfit` (and the mascot when one is picked). */
export function mountPreview(canvas: HTMLCanvasElement, outfit: Outfit, mascot?: string) {
  const q: Quality = 'medium';
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7fa8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 4, 3); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20); cam.position.set(0, 1.25, 4.1); cam.lookAt(0, 0.95, 0);
  const stand = new THREE.Group(); scene.add(stand);
  put(stand, CYL(0.62, 0.66, 0.08, 24), mat(0xffe8a3, q), 0, -0.04, 0);
  let human: Human | null = null, extra: THREE.Group | null = null;
  const build = (o: Outfit, m?: string) => {
    if (human) { stand.remove(human.group); human.group.traverse(x => { const mm = x as THREE.Mesh; if (mm.isMesh && (mm as THREE.SkinnedMesh).isSkinnedMesh) mm.geometry.dispose(); }); }
    human = new Human(q, { shirt: 0x5c7cfa, pants: 0x343a40, skin: SKIN[0], hair: HAIR[0], hairStyle: 0, apron: true, outfit: o });
    human.label.sprite.visible = false; human.icon.sprite.visible = false;
    stand.add(human.group);
    if (extra) { stand.remove(extra); extra = null; }
    const mc = getCosmetic(m);
    if (mc) { extra = buildMascot(q, mc.id, mc.color, mc.color2 ?? 0xffffff); extra.position.set(0.45, 0, 0.25); stand.add(extra); }
  };
  build(outfit, mascot);
  let raf = 0, last = performance.now(), dragging = false, lastX = 0, spin = 0.6;
  const frame = (t: number) => {
    if (!canvas.isConnected) { dispose(); return; }
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio()))) {
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    if (!dragging) stand.rotation.y += dt * spin;
    human?.animate(dt, false);
    renderer.render(scene, cam);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  canvas.onpointerdown = e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = e => { if (dragging) { stand.rotation.y += (e.clientX - lastX) * 0.012; lastX = e.clientX; } };
  canvas.onpointerup = canvas.onpointercancel = () => { dragging = false; spin = 0.6; };
  const dispose = () => { cancelAnimationFrame(raf); renderer.dispose(); renderer.forceContextLoss(); };
  return { update: build, dispose };
}
