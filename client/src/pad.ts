// Gamepad runtime: which device the player last used (keyboard/mouse vs pad), pad style, rumble.
// The pure mapping/deadzone logic lives in padmap.ts.
import { actionLabel, controlsLine, isDown, padStyleOf, type PadAction, type PadStyle } from './padmap.ts';

export type InputMode = 'kb' | 'pad';
let mode: InputMode = 'kb';
let style: PadStyle = 'xbox';
let rumbleOn = true;
const listeners = new Set<() => void>();

/** First connected pad (standard mapping preferred). Tests replace navigator.getGamepads to inject a fake one. */
export function currentPad(): Gamepad | null {
  let pads: (Gamepad | null)[] = [];
  try { pads = [...(navigator.getGamepads?.() ?? [])]; } catch { return null; }
  const live = pads.filter((p): p is Gamepad => !!p && p.connected);
  return live.find(p => p.mapping === 'standard') ?? live[0] ?? null;
}

export function inputMode() { return mode; }
export function padStyle() { return style; }
export function onModeChange(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }

export function setMode(m: InputMode, padId?: string) {
  const st = padId !== undefined ? padStyleOf(padId) : style;
  if (m === mode && st === style) return;
  mode = m; style = st;
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('pad-mode', m === 'pad');
    const hk = document.getElementById('helpkeys');
    if (hk) hk.textContent = controlsLine(mode, style);
  }
  for (const fn of listeners) fn();
}

/** True if any button is down or a stick is pushed past a firm threshold (used to switch hints to the pad). */
export function padActive(gp: Gamepad): boolean {
  return gp.buttons.some(b => isDown(b)) || gp.axes.some(a => Math.abs(a) > 0.5);
}

/** Key / button label for an action on the device the player last used. */
export function keyOf(a: PadAction): string { return actionLabel(a, mode, style); }

export function setRumble(on: boolean) { rumbleOn = on; }

/** Short rumble on the active pad (no-op on pads/browsers without vibrationActuator, or when turned off). */
export function rumble(strong: number, weak: number, ms: number) {
  if (!rumbleOn || mode !== 'pad') return;
  const gp = currentPad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
  try { void gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {}); } catch { /* unsupported */ }
}

if (typeof window !== 'undefined') {
  // Any keyboard / mouse use switches prompts back to keyboard labels.
  window.addEventListener('keydown', () => setMode('kb'), true);
  window.addEventListener('mousedown', () => setMode('kb'), true);
  window.addEventListener('mousemove', e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) setMode('kb'); }, true);
  window.addEventListener('gamepadconnected', e => { style = padStyleOf((e as GamepadEvent).gamepad?.id ?? ''); });
}
