// Floating world labels in the cartoon UI style (cream / coloured pills, thick ink outline, Huninn font),
// with a capped on-screen size and near-camera fading, plus the font-ready refresh for every canvas text.
import * as THREE from 'three';
import { barColor, cbMode, isDangerColor } from './a11y.ts';
import { loadUiFonts } from './fonts.ts';

export const INK = '#2a1f3d', CREAM = '#fff6e5';
export const UI_FONT = '"Huninn","PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif';
export const font = (px: number, weight = 900) => `${weight} ${px}px ${UI_FONT}`;

// ---------- font loading ----------
// Canvas text drawn before the web font arrives falls back to a system font; everything drawn through
// trackCanvas()/Label is redrawn once Huninn has loaded.
let fontReady = typeof document === 'undefined' || !document.fonts;
const pending: { c: HTMLCanvasElement; draw: () => HTMLCanvasElement; done: () => void }[] = [];
const readyHooks: (() => void)[] = [];
if (!fontReady) {
  const finish = () => {
    if (fontReady) return;
    fontReady = true;
    for (const p of pending.splice(0)) {
      const fresh = p.draw();
      p.c.width = fresh.width; p.c.height = fresh.height;
      p.c.getContext('2d')!.drawImage(fresh, 0, 0);
      p.done();
    }
    for (const f of readyHooks.splice(0)) f();
  };
  // both font files (menu + game, see fonts.ts): canvas text never makes the browser fetch the game file by itself
  loadUiFonts().then(finish, finish);
  setTimeout(finish, 8000); // never wait forever (offline / blocked font)
}
export const isFontReady = () => fontReady;
/** Run once the UI font is ready (immediately if it already is). */
export function whenFontReady(fn: () => void) { if (fontReady) fn(); else readyHooks.push(fn); }
/**
 * Draws a canvas now and, if the UI font wasn't loaded yet, redraws it in place when it is
 * (`onRedraw` runs after that, e.g. to flag a texture for re-upload).
 */
export function trackCanvas(draw: () => HTMLCanvasElement, onRedraw: () => void = () => {}): HTMLCanvasElement {
  const c = draw();
  if (!fontReady) pending.push({ c, draw, done: onRedraw });
  return c;
}
/** A CanvasTexture whose canvas is redrawn once the UI font has loaded. */
export function textTexture(draw: () => HTMLCanvasElement): THREE.CanvasTexture {
  let tex: THREE.CanvasTexture | null = null;
  const c = trackCanvas(draw, () => { if (tex) tex.needsUpdate = true; });
  tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- drawing ----------
export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export interface PillOpts {
  text: string;
  /** Smaller second line. */
  sub?: string;
  /** Pill colour (default cream). Dark / saturated colours get white text with an ink outline. */
  bg?: string;
  fg?: string;
  subFg?: string;
  /** Outline the text in ink (default: on when the text is white). */
  stroke?: boolean;
  /** Progress bar under the text (0..1). */
  bar?: { v: number; color: string };
  /** Coloured dot before the text (player colour). */
  dot?: string;
  /** Font size in px (default 50). */
  size?: number;
}
let mctx: CanvasRenderingContext2D | null = null;
const measureCtx = () => (mctx ??= document.createElement('canvas').getContext('2d')!);

/** Pixel height of a plain one-line pill at the default size (labels are sized relative to it). */
export const PILL_REF_H = 50 * 1.28 + 2 * 14 + 10;

/** Chunky pill label: rounded body, 7 px ink outline, a solid ink "drop" under it (like the UI buttons). */
export function pillCanvas(o: PillOpts): HTMLCanvasElement {
  const size = o.size ?? 50, subSize = Math.round(size * 0.66);
  const g0 = measureCtx();
  const bg = o.bg ?? CREAM;
  const fg = o.fg ?? (bg === CREAM || bg === '#fff' || bg === '#ffffff' ? INK : '#fff');
  const stroke = o.stroke ?? fg === '#fff';
  g0.font = font(size); const tw = o.text ? g0.measureText(o.text).width : 0;
  g0.font = font(subSize); const sw = o.sub ? g0.measureText(o.sub).width : 0;
  const padX = 26, padY = 14, lw = 7, drop = 8, dotW = o.dot ? size * 0.62 + 12 : 0;
  const barH = o.bar ? 18 : 0, barW = o.bar ? Math.max(120, Math.min(260, tw + dotW)) : 0;
  const lineH = o.text ? size * 1.28 : 0;
  const innerW = Math.max(tw + dotW, sw, barW);
  const innerH = lineH + (o.sub ? subSize * 1.3 : 0) + (o.bar ? barH + 10 : 0);
  const W = Math.ceil(innerW + padX * 2 + lw * 2), H = Math.ceil(innerH + padY * 2 + lw * 2 + drop);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const bx = lw / 2 + 1, by = lw / 2 + 1, bw = W - lw - 2, bh = H - lw - 2 - drop;
  const r = Math.min(bh / 2, 40);
  // drop shadow, body, inner highlight, outline
  g.fillStyle = INK; roundRect(g, bx, by + drop, bw, bh, r); g.fill();
  g.fillStyle = bg; roundRect(g, bx, by, bw, bh, r); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)'; roundRect(g, bx + lw, by + lw * 0.8, bw - lw * 2, Math.min(12, bh / 5), 6); g.fill();
  g.lineWidth = lw; g.strokeStyle = INK; roundRect(g, bx, by, bw, bh, r); g.stroke();
  let y = by + lw / 2 + padY;
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  if (o.text) {
    const x0 = (W - (tw + dotW)) / 2;
    if (o.dot) {
      g.fillStyle = o.dot; g.beginPath(); g.arc(x0 + size * 0.31, y + lineH / 2, size * 0.31, 0, Math.PI * 2); g.fill();
      g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
    }
    g.font = font(size);
    if (stroke) { g.lineWidth = Math.max(6, size * 0.16); g.strokeStyle = INK; g.strokeText(o.text, x0 + dotW, y + lineH / 2 + size * 0.04); }
    g.fillStyle = fg; g.fillText(o.text, x0 + dotW, y + lineH / 2 + size * 0.04);
    y += lineH;
  }
  if (o.sub) {
    g.font = font(subSize); g.textAlign = 'center';
    const sy = y + subSize * 0.65;
    if (stroke) { g.lineWidth = Math.max(5, subSize * 0.16); g.strokeStyle = INK; g.strokeText(o.sub, W / 2, sy); }
    g.fillStyle = o.subFg ?? fg; g.fillText(o.sub, W / 2, sy);
    y += subSize * 1.3;
  }
  if (o.bar) {
    const x = (W - barW) / 2, yy = y + 4;
    g.fillStyle = 'rgba(42,31,61,0.25)'; roundRect(g, x, yy, barW, barH, barH / 2); g.fill();
    const fw = Math.max(barH, barW * Math.max(0, Math.min(1, o.bar.v)));
    g.fillStyle = barColor(o.bar.color); roundRect(g, x, yy, fw, barH, barH / 2); g.fill();
    if (isDangerColor(o.bar.color)) { // danger is not colour-only: warning stripes over the fill (色盲友善)
      g.save(); roundRect(g, x, yy, fw, barH, barH / 2); g.clip();
      g.strokeStyle = 'rgba(42,31,61,0.55)'; g.lineWidth = 5;
      for (let sx = x - barH; sx < x + fw + barH; sx += 14) { g.beginPath(); g.moveTo(sx, yy + barH); g.lineTo(sx + barH, yy); g.stroke(); }
      g.restore();
    }
    g.lineWidth = 4; g.strokeStyle = INK; roundRect(g, x, yy, barW, barH, barH / 2); g.stroke();
  }
  return c;
}

/** Big outlined floating text (score pop-ups): coloured fill, thick ink outline, no background. */
export function popCanvas(text: string, color: string, size = 72): HTMLCanvasElement {
  const g0 = measureCtx(); g0.font = font(size);
  const w = Math.ceil(g0.measureText(text).width + 40), h = Math.ceil(size * 1.5);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = size * 0.2; g.strokeStyle = INK; g.strokeText(text, w / 2, h / 2 + 4);
  g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  return c;
}

// ---------- the sprite ----------
const labelCache = new Map<string, THREE.CanvasTexture>();
const cbKey = () => { const m = cbMode(); return m === 'off' ? '' : '|cb' + m; };
/** Label texture for a content key (drawn once, shared by every label showing the same thing). */
export function labelTexture(key: string, draw: () => HTMLCanvasElement): THREE.CanvasTexture {
  key += cbKey(); // 色盲友善 palette changes the drawn colours
  let tex = labelCache.get(key);
  if (!tex) {
    tex = textTexture(draw); tex.anisotropy = 2;
    labelCache.set(key, tex);
    // (bounded: each entry is a GPU texture; ~240 covers every tag / bar step in a busy shift without redrawing)
    if (labelCache.size > 240) { const k = labelCache.keys().next().value!; const t = labelCache.get(k)!; if (t !== tex) { t.dispose(); labelCache.delete(k); } }
  }
  return tex;
}
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

export interface LabelOpts {
  /** World metres per canvas pixel at normal size. */
  k?: number;
  /** Largest on-screen height of a one-line pill, as a fraction of the viewport height. */
  maxScreen?: number;
  /** Smallest on-screen height (far away labels grow a bit to stay readable). */
  minScreen?: number;
  /** Fade out when the camera is closer than fade[1] (fully at fade[0]); opacity floor fadeMin. */
  fade?: [number, number];
  fadeMin?: number;
}

export class Label {
  sprite: THREE.Sprite; key = '';
  opacity = 1;
  constructor(public o: LabelOpts = {}) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true, transparent: true }));
    this.sprite.renderOrder = 10;
    this.sprite.visible = false; // an unset label would render as a white square
    this.sprite.onBeforeRender = (_r, _sc, cam) => this.fit(cam as THREE.PerspectiveCamera);
  }
  /** Shows the texture for `key` (drawn once and shared by every label with the same key). Empty key hides. */
  set(key: string, draw: () => HTMLCanvasElement) {
    const full = key ? key + cbKey() : ''; // a palette switch redraws the label
    if (full === this.key) return;
    this.key = full;
    if (!key) { this.sprite.visible = false; return; }
    this.sprite.visible = true;
    const tex = labelTexture(key, draw);
    const m = this.sprite.material as THREE.SpriteMaterial;
    m.map = tex; m.needsUpdate = true;
  }
  private get img() { return (this.sprite.material as THREE.SpriteMaterial).map?.image as HTMLCanvasElement | undefined; }
  /** Size factor for a camera distance d: keeps the on-screen size between minScreen and maxScreen. */
  sizeAt(d: number, cam: THREE.PerspectiveCamera) {
    const k = this.o.k ?? 0.0028, ref = PILL_REF_H * k;
    const view = 2 * Math.max(0.05, d) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2); // visible height at d
    const frac = ref / view;
    const hi = this.o.maxScreen ?? 0.05, lo = this.o.minScreen ?? 0.024;
    return frac > hi ? hi / frac : frac < lo ? lo / frac : 1;
  }
  private fit(cam: THREE.PerspectiveCamera) {
    const s = this.sprite;
    _p.setFromMatrixPosition(s.matrixWorld);
    const d = _p.distanceTo(cam.position);
    const img = this.img;
    const ph = img?.height || PILL_REF_H, aspect = img ? img.width / Math.max(1, img.height) : 1;
    const h = ph * (this.o.k ?? 0.0028) * this.sizeAt(d, cam), w = h * aspect;
    // undo the parent's scale (big karens, the boss) so the label size is the same for everyone
    if (s.parent && s.parent !== cam.parent) _s.setFromMatrixScale(s.parent.matrixWorld); else _s.set(1, 1, 1);
    s.scale.set(w / (_s.x || 1), h / (_s.y || 1), 1);
    s.updateMatrix();
    if (s.parent) s.matrixWorld.multiplyMatrices(s.parent.matrixWorld, s.matrix); else s.matrixWorld.copy(s.matrix);
    let op = this.opacity;
    if (this.o.fade) { const [a, b] = this.o.fade; op *= Math.max(this.o.fadeMin ?? 0, Math.min(1, (d - a) / (b - a))); }
    (s.material as THREE.SpriteMaterial).opacity = op;
  }
  /** On-screen half size in pixels of a texture shown on this label (for decluttering). */
  screenHalf(tex: THREE.Texture, cam: THREE.PerspectiveCamera, d: number, vh: number): [number, number] {
    const img = tex.image as HTMLCanvasElement;
    const view = 2 * Math.max(0.05, d) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const h = img.height * (this.o.k ?? 0.0028) * this.sizeAt(d, cam) / view * vh;
    return [h * img.width / img.height / 2, h / 2];
  }
}
