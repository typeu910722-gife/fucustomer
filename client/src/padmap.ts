// Gamepad mapping, deadzones, button glyphs and menu-navigation geometry.
// Pure logic only (no DOM, no navigator) so it can be unit-tested in Node: tests/padmap.test.ts.
import type { Action } from './input.ts';

/** W3C "standard" gamepad layout (Xbox / PlayStation / Steam Deck all report this in Chromium/Electron). */
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
} as const;

export type PadStyle = 'xbox' | 'ps';
export type PadAction = Action | 'run';

/** In-shift bindings: button index → action. 'run' is held, everything else fires once per press. */
export const GAME_BINDINGS: ReadonlyArray<[number, PadAction]> = [
  [BTN.A, 'interact'], [BTN.B, 'drop'], [BTN.X, 'alt'], [BTN.Y, 'grab'],
  [BTN.RB, 'spin'], [BTN.LB, 'ultimate'], [BTN.RT, 'hit'], [BTN.LT, 'run'], [BTN.L3, 'run'],
  [BTN.UP, 'ping'], [BTN.R3, 'ping'], [BTN.DOWN, 'shop'], [BTN.RIGHT, 'ready'], [BTN.LEFT, 'skip'],
  [BTN.VIEW, 'quick'], [BTN.MENU, 'menu'],
];

/** Keyboard / mouse labels for the same actions (matches the key map in input.ts). */
export const KEY_LABEL: Record<PadAction, string> = {
  interact: 'E', alt: 'F', drop: 'G', grab: '空白', spin: 'Q', ultimate: 'R', hit: 'X', ping: 'V', quick: 'T', shop: 'B',
  ready: 'Enter', menu: 'Esc', tab: 'Tab', run: 'Shift', skip: 'K', q1: '1', q2: '2', q3: '3', q4: '4', q5: '5', q6: '6', q7: '7', q8: '8',
};

const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '十字↑', '十字↓', '十字←', '十字→', 'Home'];
const PS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', '十字↑', '十字↓', '十字←', '十字→', 'PS'];

/** PlayStation pads get PS symbols; everything else (Xbox, Steam Deck, generic XInput) gets A/B/X/Y. */
export function padStyleOf(id: string): PadStyle {
  return /playstation|dualsense|dualshock|wireless controller|\b054c\b|vendor: 054c/i.test(id) ? 'ps' : 'xbox';
}

export function buttonGlyph(button: number, style: PadStyle): string {
  return (style === 'ps' ? PS : XBOX)[button] ?? `#${button}`;
}

/** Glyph for the first button bound to an action (e.g. interact → "A" / "✕"). */
export function actionGlyph(a: PadAction, style: PadStyle): string {
  const b = GAME_BINDINGS.find(([, x]) => x === a);
  return b ? buttonGlyph(b[0], style) : '';
}

/** Label for an action on the device the player last used. */
export function actionLabel(a: PadAction, mode: 'kb' | 'pad', style: PadStyle): string {
  return mode === 'pad' ? actionGlyph(a, style) || KEY_LABEL[a] : KEY_LABEL[a];
}

/** One-line control summary for the HUD. */
/** In-game controls hint shows only what the current shift can use (null = everything, e.g. outside a game). */
export interface ControlsContext { abilities: string[]; alt: boolean; social: boolean; shop: boolean; ready: boolean }
let controlsCtx: ControlsContext | null = null;
export function setControlsContext(c: ControlsContext | null) { controlsCtx = c; }
/** Drops the segments of a controls line that the context says are not usable yet. */
export function filterControls(line: string, c: ControlsContext | null): string {
  if (!c) return line;
  const off: [RegExp, boolean][] = [
    [/次要$/, !c.alt], [/抓\/丟$/, !c.abilities.includes('grab')], [/出手$/, !c.abilities.includes('hit')], [/旋風$/, !c.abilities.includes('spin')],
    [/全店退散$/, !c.abilities.includes('ultimate')], [/(標記|訊息)$/, !c.social], [/採購$/, !c.shop], [/準備$/, !c.ready],
  ];
  return line.split('・').filter(seg => !off.some(([re, hide]) => hide && re.test(seg))).join('・');
}
export function controlsLine(mode: 'kb' | 'pad', style: PadStyle): string { return filterControls(fullControlsLine(mode, style), controlsCtx); }
function fullControlsLine(mode: 'kb' | 'pad', style: PadStyle): string {
  if (mode === 'kb') return 'WASD 移動・Shift 跑・滑鼠 視角・E 互動・F 次要・G 放下・空白 抓/丟・X 出手・Q 旋風・R 全店退散・V 標記・T 訊息・B 採購・Esc 選單';
  const g = (a: PadAction) => actionGlyph(a, style);
  const ls = style === 'ps' ? 'L 搖桿' : '左搖桿', rs = style === 'ps' ? 'R 搖桿' : '右搖桿';
  return `${ls} 移動・${g('run')} 跑・${rs} 視角・${g('interact')} 互動・${g('alt')} 次要・${g('drop')} 放下・${g('grab')} 抓/丟・${g('hit')} 出手・${g('spin')} 旋風・${g('ultimate')} 全店退散・${g('ping')} 標記・${g('quick')} 訊息・${g('shop')} 採購・${g('ready')} 準備・${g('menu')} 選單`;
}

/** Trigger buttons report analog values; treat half-pull as pressed so light pulls don't chatter. */
export function isDown(b: { pressed: boolean; value: number } | undefined): boolean {
  return !!b && (b.pressed || b.value > 0.5);
}

/**
 * Radial deadzone with rescaling: inside `dz` → 0, outside it the output ramps 0…1 smoothly
 * (no jump at the edge) and keeps the stick's direction. Magnitude is clamped to 1.
 */
export function radialDeadzone(x: number, y: number, dz = 0.18): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (!Number.isFinite(m) || m <= dz) return { x: 0, y: 0 };
  const scaled = Math.min(1, (Math.min(1, m) - dz) / (1 - dz));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}

/**
 * Right-stick look: deadzone, then a power curve for fine aim near the centre.
 * Returns the look delta in "mouse pixels" for this frame (the game turns pixels into radians like mouse input).
 */
export function stickLook(rx: number, ry: number, dt: number, sens: number, invertY: boolean, dz = 0.15): { dx: number; dy: number } {
  const v = radialDeadzone(rx, ry, dz);
  const m = Math.hypot(v.x, v.y);
  if (m === 0) return { dx: 0, dy: 0 };
  const k = Math.pow(m, 1.6) / m; // curve applied to the magnitude only
  const speed = 1100 * sens * dt; // full tilt ≈ 150°/s at sensitivity 1
  return { dx: v.x * k * speed, dy: v.y * k * speed * 0.75 * (invertY ? -1 : 1) };
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Menu direction from the D-pad (wins) or the left stick (needs a firm push so drift never moves focus). */
export function menuDir(buttons: boolean[], lx: number, ly: number): Dir | null {
  if (buttons[BTN.UP]) return 'up';
  if (buttons[BTN.DOWN]) return 'down';
  if (buttons[BTN.LEFT]) return 'left';
  if (buttons[BTN.RIGHT]) return 'right';
  const m = Math.hypot(lx, ly);
  if (!(m > 0.6)) return null;
  return Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : (ly > 0 ? 'down' : 'up');
}

/** Held direction auto-repeat: fires on press, again after `delay`, then every `rate` seconds. */
export class NavRepeat {
  private dir: Dir | null = null;
  private t = 0;
  constructor(private delay = 0.38, private rate = 0.11) {}
  update(dir: Dir | null, dt: number): Dir | null {
    if (dir !== this.dir) { this.dir = dir; this.t = this.delay; return dir; }
    if (!dir) return null;
    this.t -= dt;
    if (this.t <= 0) { this.t += this.rate; if (this.t < 0) this.t = this.rate; return dir; }
    return null;
  }
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Spatial navigation: the best candidate in direction `dir` from `from`.
 * Candidates must lie on that side (by centre, within a 45° cone unless they share the row / column); distance along the direction counts once,
 * sideways offset counts double, and boxes that overlap on the cross axis (same row / column) win ties.
 * Returns the candidate index, or -1 when nothing is on that side.
 */
export function pickSpatial(from: Rect, cands: Rect[], dir: Dir): number {
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  let best = -1, bestScore = Infinity;
  cands.forEach((c, i) => {
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const dx = cx - fx, dy = cy - fy;
    let along: number, gap: number, off: number;
    if (dir === 'down' || dir === 'up') {
      along = dir === 'down' ? dy : -dy;
      gap = Math.max(0, c.x - (from.x + from.w), from.x - (c.x + c.w)); // sideways distance between the boxes
      off = Math.abs(dx);
    } else {
      along = dir === 'right' ? dx : -dx;
      gap = Math.max(0, c.y - (from.y + from.h), from.y - (c.y + c.h));
      off = Math.abs(dy);
    }
    if (along <= 2) return;
    if (gap > 0 && along < gap) return; // more sideways than forward: not "in" that direction
    const score = along + gap * 2 + off * 0.05 - (gap === 0 ? 1e4 : 0);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** Back-button detection for menus: explicit data-back, ids ending in -back/-close, or "←…/返回/關閉/取消/算了" text. */
export function looksLikeBack(id: string, text: string): boolean {
  return /(^|-)(back|close)$/.test(id) || /^\s*←/.test(text) || /^(返回|關閉|取消|算了)/.test(text.trim());
}
