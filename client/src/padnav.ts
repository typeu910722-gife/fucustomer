// Controller navigation for the DOM menus in #ui: D-pad / left stick moves a focus ring between buttons,
// A presses, B goes back, left/right change sliders and drop-downs. In a shift (menus closed) it stays out of the way.
import { BTN, NavRepeat, isDown, looksLikeBack, menuDir, pickSpatial, type Dir, type Rect } from './padmap.ts';
import { currentPad, inputMode, padActive, setMode } from './pad.ts';

const FOCUSABLE = 'button, input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
let fallbackBack: () => void = () => {};
let prev: boolean[] = [];
let lastScreen: Element | null = null;
let last = 0;
const repeat = new NavRepeat();

/** What B does when the screen has no back / close button (e.g. close the pause menu, or return to the main menu). */
export function setPadBack(fn: () => void) { fallbackBack = fn; }

const uiRoot = () => document.getElementById('ui');
const visible = (el: HTMLElement) => {
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && el.closest('.hidden') === null;
};
function focusables(): HTMLElement[] {
  const root = uiRoot();
  if (!root || !root.firstElementChild) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}
const rectOf = (el: HTMLElement): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

function focusEl(el: HTMLElement) {
  document.querySelectorAll('.padfocus').forEach(e => e.classList.remove('padfocus'));
  el.classList.add('padfocus');
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function current(list: HTMLElement[]): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && list.includes(a)) return a;
  const p = document.querySelector<HTMLElement>('.padfocus');
  return p && list.includes(p) ? p : null;
}
/** The button a controller player most likely wants first on a new screen. */
function defaultFocus(list: HTMLElement[]): HTMLElement | null {
  return list.find(e => e.matches('.btn.continue, #m-next')) ?? list.find(e => e.matches('.btn.primary, .btn.good')) ?? list.find(e => e.tagName === 'BUTTON') ?? list[0] ?? null;
}

function adjust(el: HTMLElement, dir: Dir): boolean {
  if (dir !== 'left' && dir !== 'right') return false;
  const d = dir === 'right' ? 1 : -1;
  if (el instanceof HTMLInputElement && el.type === 'range') {
    const step = Number(el.step) || 1, min = Number(el.min), max = Number(el.max);
    // Already at the end in this direction: let the D-pad move focus instead, so a slider never traps the player in a column.
    if ((d > 0 && Number(el.value) >= max) || (d < 0 && Number(el.value) <= min)) return false;
    const v = Math.max(min, Math.min(max, Math.round((Number(el.value) + d * step) / step) * step));
    el.value = String(Number(v.toFixed(4)));
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d));
    if (i === el.selectedIndex) return false; // at the first/last option: move focus instead
    el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

function goBack(list: HTMLElement[]) {
  const back = list.find(e => e.dataset.back !== undefined) ?? list.find(e => e.tagName === 'BUTTON' && looksLikeBack(e.id, e.textContent ?? ''));
  if (back) back.click(); else fallbackBack();
}

function step(now: number) {
  requestAnimationFrame(step);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const gp = currentPad();
  if (!gp) { prev = []; return; }
  const b = gp.buttons.map(isDown);
  if (padActive(gp)) setMode('pad', gp.id);
  const pressed = (i: number) => !!b[i] && !prev[i];
  const list = focusables();
  const root = uiRoot();
  const screen = root?.firstElementChild ?? null;
  if (!list.length) { prev = b; lastScreen = screen; repeat.update(null, dt); return; }
  // new screen while using the pad → put the focus ring on its main button
  if (screen !== lastScreen) {
    lastScreen = screen;
    if (inputMode() === 'pad' && !current(list)) { const d = defaultFocus(list); if (d) focusEl(d); }
  }
  const cur = current(list);
  const dir = repeat.update(menuDir(b, gp.axes[0] ?? 0, gp.axes[1] ?? 0), dt);
  if (dir) {
    if (!cur) { const d = defaultFocus(list); if (d) focusEl(d); }
    else if (!adjust(cur, dir)) {
      const others = list.filter(e => e !== cur);
      const i = pickSpatial(rectOf(cur), others.map(rectOf), dir);
      if (i >= 0) focusEl(others[i]);
    }
  }
  if (pressed(BTN.A)) {
    const el = cur ?? defaultFocus(list);
    if (el && !cur) focusEl(el);
    else if (el) {
      if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'number')) el.focus();
      else if (el instanceof HTMLSelectElement) adjust(el, 'right');
      else el.click();
    }
  }
  if (pressed(BTN.B)) goBack(list);
  // LB / RB page through tab bars (career screen, shop) when the screen has them
  if (pressed(BTN.LB) || pressed(BTN.RB)) {
    const tabs = list.filter(e => e.matches('.tab, [data-tab]'));
    if (tabs.length > 1) {
      const on = tabs.findIndex(t => t.classList.contains('on') || t.classList.contains('primary'));
      const next = tabs[(Math.max(0, on) + (pressed(BTN.RB) ? 1 : tabs.length - 1)) % tabs.length];
      next.click();
    }
  }
  prev = b;
}

let started = false;
export function startPadNav() {
  if (started) return; started = true;
  // keyboard / mouse users don't see the focus ring
  window.addEventListener('mousedown', () => document.querySelectorAll('.padfocus').forEach(e => e.classList.remove('padfocus')), true);
  requestAnimationFrame(t => { last = t; step(t); });
}
