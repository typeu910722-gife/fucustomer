// Quick-message / emote wheel (T or the controller's View button): 8 preset callouts in a ring.
// Pick one with 1–8, by pointing (mouse movement while the cursor is captured, either stick) and clicking / A /
// letting go of View, or by tapping a slice. Presets only — there is no free text anywhere.
import { QUICK_ICONS, QUICK_MESSAGES } from '../../shared/constants.ts';

/**
 * Which slice a direction points at (slice 0 straight up, then clockwise), or null inside the dead zone.
 * x right, y up; `dead` is the minimum length (same units as x/y).
 */
export function wheelSlot(x: number, y: number, n = QUICK_MESSAGES.length, dead = 0.45): number | null {
  if (Math.hypot(x, y) < dead) return null;
  const a = Math.atan2(x, y); // 0 = up, clockwise positive
  const step = (Math.PI * 2) / n;
  return ((Math.round(a / step) % n) + n) % n;
}

const CSS = `
#emotewheel { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: rgba(42,31,61,.18); pointer-events: auto; }
#emotewheel.hidden { display: none; }
#emotewheel .ew-ring { position: relative; width: min(86vmin, 560px); height: min(86vmin, 560px); }
#emotewheel .ew-slot { position: absolute; transform: translate(-50%, -50%); width: 28%; min-height: 15%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: rgba(255,246,229,.96); color: #2a1f3d; border: 3px solid #2a1f3d; border-radius: 18px; box-shadow: 0 4px 0 rgba(42,31,61,.55); font: inherit; font-weight: 900; cursor: pointer; padding: 6px 4px; touch-action: none; }
#emotewheel .ew-slot.on { background: #ffd43b; transform: translate(-50%, -50%) scale(1.1); }
#emotewheel .ew-ico { font-size: clamp(20px, 5vmin, 32px); line-height: 1; }
#emotewheel .ew-txt { font-size: clamp(11px, 2.4vmin, 15px); line-height: 1.15; text-align: center; }
#emotewheel .ew-key { position: absolute; left: 6px; top: 4px; font-size: 11px; opacity: .65; }
#emotewheel .ew-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 34%; text-align: center; background: #2a1f3d; color: #fff6e5; border-radius: 50%; aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; }
#emotewheel .ew-center b { font-size: clamp(13px, 2.8vmin, 18px); }
#emotewheel .ew-center small { font-size: clamp(10px, 1.9vmin, 12px); opacity: .8; margin-top: 4px; }
.feedline .fl-ico { margin-right: 2px; }
`;
let cssDone = false;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class EmoteWheel {
  readonly el: HTMLDivElement;
  sel: number | null = null;
  /** Mouse movement collected while open (cursor captured): points the selection like a stick. */
  private mx = 0; private my = 0;
  isOpen = false;
  /** Opened with the controller's View button (letting go of it sends the pointed-at slice). */
  byPad = false;

  constructor(parent: HTMLElement, private onPick: (i: number) => void, private onCancel: () => void) {
    if (!cssDone) { cssDone = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
    this.el = document.createElement('div');
    this.el.id = 'emotewheel';
    this.el.className = 'hidden';
    const n = QUICK_MESSAGES.length;
    this.el.innerHTML = `<div class="ew-ring">${QUICK_MESSAGES.map((m, i) => {
      const a = (i / n) * Math.PI * 2;
      return `<button class="ew-slot" data-ew="${i}" style="left:calc(50% + ${(Math.sin(a) * 41).toFixed(1)}%);top:calc(50% - ${(Math.cos(a) * 41).toFixed(1)}%)"><b class="ew-key">${i + 1}</b><span class="ew-ico">${QUICK_ICONS[i]}</span><span class="ew-txt">${esc(m)}</span></button>`;
    }).join('')}<div class="ew-center"><b id="ew-pick">快捷訊息</b><small id="ew-help"></small></div></div>`;
    parent.appendChild(this.el);
    this.el.querySelectorAll<HTMLButtonElement>('[data-ew]').forEach(b => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.onPick(Number(b.dataset.ew)); });
      b.addEventListener('pointerenter', () => this.setSel(Number(b.dataset.ew)));
    });
    // a tap / click outside the slices closes it
    this.el.addEventListener('pointerdown', e => { if (e.target === this.el) { e.preventDefault(); this.onCancel(); } });
  }

  open(byPad: boolean, help: string) {
    this.isOpen = true; this.byPad = byPad; this.mx = 0; this.my = 0;
    this.setSel(null);
    (this.el.querySelector('#ew-help') as HTMLElement).textContent = help;
    this.el.classList.remove('hidden');
  }
  close() { this.isOpen = false; this.el.classList.add('hidden'); }

  /** Mouse movement (pixels, y down) while the cursor is captured. */
  mouse(dx: number, dy: number) {
    if (!dx && !dy) return;
    this.mx += dx; this.my += dy;
    const l = Math.hypot(this.mx, this.my);
    if (l > 120) { this.mx *= 120 / l; this.my *= 120 / l; }
    const s = wheelSlot(this.mx, -this.my, QUICK_MESSAGES.length, 35);
    if (s !== null) this.setSel(s);
  }
  /** Stick (x right, y down as the Gamepad API reports it). */
  stick(x: number, y: number) {
    const s = wheelSlot(x, -y, QUICK_MESSAGES.length, 0.5);
    if (s !== null) this.setSel(s);
  }

  setSel(i: number | null) {
    this.sel = i;
    this.el.querySelectorAll<HTMLElement>('[data-ew]').forEach(b => b.classList.toggle('on', Number(b.dataset.ew) === i));
    (this.el.querySelector('#ew-pick') as HTMLElement).textContent = i === null ? '快捷訊息' : `${QUICK_ICONS[i]} ${QUICK_MESSAGES[i]}`;
  }
}
