// Accessibility settings applied to the page: 色盲友善 palette (CSS variables + minimap / 3D-label colours),
// 字級 (a CSS variable that scales the HUD and menus), 音效字幕 (captions.ts), 減少動態效果 (a body class for CSS).
// Shapes, icons and stripe patterns that carry state are always on; the palette only makes colours easier to tell apart.
import type { ColorblindMode, Settings } from './storage.ts';
import { audio } from './audio.ts';
import { onSound, setCaptions } from './captions.ts';

/** Colours the canvas-drawn parts use (minimap dots, 3D label bars). CSS has the same sets as variables (index.html). */
export interface Palette {
  /** fine / in progress */ ok: string;
  /** low / danger */ low: string;
  /** medium (anger rising, patience half gone) */ mid: string;
  /** a karen on the minimap */ karen: string;
  /** a customer waiting for coffee / food on the minimap */ wait: string;
  /** a customer at the till on the minimap */ till: string;
  /** other customers */ normal: string;
}
export const PALETTES: Record<ColorblindMode, Palette> = {
  off: { ok: '#39c96b', low: '#ff3b3b', mid: '#ffa94d', karen: '#ff2d2d', wait: '#ffd43b', till: '#ffffff', normal: '#6c757d' },
  // protanopia / deuteranopia: Okabe–Ito blue vs vermillion / yellow (also apart in lightness); karen vermillion, waiting sky blue
  rg: { ok: '#0072b2', low: '#d55e00', mid: '#f0e442', karen: '#d55e00', wait: '#56b4e9', till: '#ffffff', normal: '#6c757d' },
  // tritanopia: red vs teal (the axis tritans keep), no blue/yellow pairs. Checked by scripts/cvd-check.py.
  by: { ok: '#00a0b0', low: '#e8174a', mid: '#ff8fa3', karen: '#e8174a', wait: '#00a0b0', till: '#ffffff', normal: '#6c757d' },
};
let mode: ColorblindMode = 'off';
export const cbMode = () => mode;
export const palette = (): Palette => PALETTES[mode];

/** Bar colours used by the 3D labels (render.ts) → the active palette's ok / mid / low. */
const DANGER = new Set(['#ff5d5d', '#ff3b3b', '#ff6b6b', '#e03131']);
const MID = new Set(['#ffa94d', '#ffc23d', '#ff922b']);
const OK = new Set(['#39c96b', '#51cf66', '#3bc9db', '#4dabf7']);
/** Is this bar colour the "danger" one (drawn with warning stripes too)? */
export const isDangerColor = (c: string) => DANGER.has(c.toLowerCase());
export function barColor(c: string): string {
  if (mode === 'off') return c;
  const k = c.toLowerCase(), p = PALETTES[mode];
  return DANGER.has(k) ? p.low : MID.has(k) ? p.mid : OK.has(k) ? p.ok : c;
}

let hooked = false;
/** Applies the accessibility settings to the page. Safe to call often (settings preview, every save). */
export function applyA11y(s: Pick<Settings, 'colorblind' | 'textScale' | 'captions' | 'reduceMotion'>) {
  mode = s.colorblind === 'rg' || s.colorblind === 'by' ? s.colorblind : 'off';
  const scale = [1, 1.15, 1.3].includes(s.textScale) ? s.textScale : 1;
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  const b = document.body;
  if (mode === 'off') delete b.dataset.cb; else b.dataset.cb = mode;
  b.classList.toggle('big-text', scale > 1);
  b.classList.toggle('reduce-motion', !!s.reduceMotion);
  b.classList.toggle('captions-on', !!s.captions);
  setCaptions(!!s.captions);
  if (!hooked) { hooked = true; audio.onPlay((name, x, z, l) => onSound(name, x, z, l)); }
}
