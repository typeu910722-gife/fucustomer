// In-shift HUD layering: one queue for the transient pieces (toasts, the 新奧客 / store / 常客 cards) and one layout pass
// that stacks them in the centre-top "transient stack" (#hq) instead of letting them pile on top of each other.
//
// Zones (docs/UI-STYLE.md, 手機橫向 HUD): minimap + stock/team on the left, the shift bar at the top centre, the touch
// buttons own the right edge and the bottom-left corner (joystick), the interaction prompt sits under the crosshair in
// the column between them, and everything transient flows top-down in #hq between the shift bar and the prompt — in
// priority order (the DOM order of #hq). Whatever doesn't fit that box is hidden (.hq-off) until there is room: the
// prompt and the buttons are never covered. Cards wait in one queue (one slot, never two at once); on a phone they are
// short (title + the "how" line) and open on tap. Toasts: newest on top, at most 2 (phone) / 3 (desktop); a repeat of the
// same text replaces the old one.
//
// Coordinates: #hud and #captions are zoomed by --ui-scale (字級), so rects read from the page (real px) are divided by
// the zoom before they are written back as CSS px.

export type Tone = 'good' | 'bad' | 'info';
export type CardSlot = 'introcard' | 'arccard';
export interface CardSpec {
  slot: CardSlot;
  html: string;
  /** How long it stays up — counted only while it is actually on screen (not pushed out, not opened by a tap). */
  ms: number;
  /** Higher shows first and can bump a lower card that is up (it comes back later with the time it had left). */
  prio: number;
  /** Fade out (.fade, 0.5 s) instead of disappearing at once. */
  fade?: boolean;
  /** Runs each time the card actually appears (e.g. the solo pause for a new karen). */
  onShow?: () => void;
}
interface Card extends CardSpec { left: number; since: number; shown: boolean }

const $ = (id: string) => document.getElementById(id);
/** Pieces that join the stack on a phone only (on a desktop they keep their own corners). */
const PHONE_ONLY = ['tutskip', 'aftermath', 'feed'];
/** Where each phone-only piece goes in #hq (before this id). */
const PHONE_BEFORE: Record<string, string> = { tutskip: 'alert', aftermath: 'toasts', feed: '' };
const GAP = 4;
/** Cards that never found room are dropped after this long. */
const MAX_WAIT = 60000;

class HudQueue {
  touch = false;
  private queue: Card[] = [];
  private cur: Card | null = null;
  private fadeUntil = 0;
  private lastTick = 0;
  private home = new Map<string, { parent: Node; next: Node | null }>();
  private bound = false;

  /** Phone (touch HUD) or desktop: moves the phone-only pieces into / out of the stack. */
  setTouch(on: boolean) {
    this.touch = on;
    const hq = $('hq'); if (!hq) return;
    this.bind();
    for (const id of PHONE_ONLY) {
      const el = $(id); if (!el) continue;
      if (on && el.parentElement !== hq) {
        if (!this.home.has(id)) this.home.set(id, { parent: el.parentNode!, next: el.nextSibling });
        const before = PHONE_BEFORE[id] ? $(PHONE_BEFORE[id]) : null;
        hq.insertBefore(el, before && before.parentElement === hq ? before : null);
      } else if (!on && el.parentElement === hq) {
        const h = this.home.get(id);
        if (h) h.parent.insertBefore(el, h.next && h.next.parentNode === h.parent ? h.next : null);
      }
    }
    if (!on) for (const id of ['prompt', 'qte']) { const el = $(id); if (el) for (const p of ['left', 'top', 'bottom', 'width', 'maxWidth', 'maxHeight'] as const) el.style[p] = ''; }
  }

  private bind() {
    if (this.bound) return;
    this.bound = true;
    // phone: tap a card to read all of it (its time stops while it is open); tap again to fold it
    for (const id of ['introcard', 'arccard'] as const) {
      $(id)?.addEventListener('click', ev => {
        if (!this.touch) return;
        ev.stopPropagation();
        $(id)!.classList.toggle('open');
        this.layout();
      });
    }
  }

  toast(text: string, tone: Tone = 'info', ms = 2800) {
    const box = $('toasts'); if (!box) return;
    for (const t of [...box.children]) if (t.textContent === text) t.remove();
    const d = document.createElement('div'); d.className = `toast ${tone}`; d.textContent = text;
    box.appendChild(d);
    const max = this.touch ? 2 : 3;
    while (box.childElementCount > max) box.firstElementChild!.remove();
    setTimeout(() => { d.remove(); this.layout(); }, ms);
    this.layout();
  }

  card(spec: CardSpec) {
    const c: Card = { ...spec, left: spec.ms, since: performance.now(), shown: false };
    // a higher-priority card bumps the one that is up (unless it is already on its way out)
    if (this.cur && c.prio > this.cur.prio && !this.fadeUntil) {
      const was = this.cur; this.cur = null;
      this.hideSlot(was.slot);
      if (was.left > 1000) this.queue.unshift(was);
    }
    const i = this.queue.findIndex(q => q.prio < c.prio);
    if (i < 0) this.queue.push(c); else this.queue.splice(i, 0, c);
    this.tick();
  }

  /** Shift over: no queued cards, nothing left up. */
  reset() {
    this.queue = []; this.cur = null; this.fadeUntil = 0;
    for (const id of ['introcard', 'arccard'] as const) this.hideSlot(id);
  }

  private hideSlot(slot: CardSlot) {
    const el = $(slot); if (!el) return;
    el.classList.add('hidden'); el.classList.remove('fade', 'open', 'hq-off');
  }

  /** Card timing: the one that is up counts down while it is visible; then the next one in the queue. */
  private tick() {
    const now = performance.now(), dt = this.lastTick ? Math.min(500, now - this.lastTick) : 0;
    this.lastTick = now;
    if (this.fadeUntil) {
      if (now < this.fadeUntil) return;
      this.fadeUntil = 0;
      if (this.cur) { this.hideSlot(this.cur.slot); this.cur = null; }
    }
    if (this.cur) {
      const el = $(this.cur.slot)!;
      if (!el.classList.contains('hq-off') && !el.classList.contains('open') && !el.classList.contains('hidden')) this.cur.left -= dt;
      if (this.cur.left > 0) return;
      if (this.cur.fade) { el.classList.add('fade'); this.fadeUntil = now + 600; return; }
      this.hideSlot(this.cur.slot); this.cur = null;
    }
    this.queue = this.queue.filter(q => now - q.since < MAX_WAIT);
    const next = this.queue.shift(); if (!next) return;
    this.cur = next;
    const el = $(next.slot); if (!el) { this.cur = null; return; }
    for (const id of ['introcard', 'arccard'] as const) if (id !== next.slot) this.hideSlot(id);
    el.innerHTML = next.html;
    el.className = '';
    // restart the pop-in animation
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    next.onShow?.();
    next.shown = true;
  }

  /**
   * The layout pass (after every HUD update, toast and card): works out the free box between the shift bar, the side
   * panels, the touch buttons and the prompt, puts #hq there, and hides what doesn't fit (lowest in #hq first).
   */
  layout() {
    this.tick();
    const hud = $('hud'), hq = $('hq');
    if (!hud || !hq || hud.classList.contains('hidden')) return;
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const W = innerWidth, H = innerHeight;
    const rect = (id: string) => {
      const el = $(id); if (!el || el.classList.contains('hidden') || el.closest('.hidden')) return null;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 ? r : null;
    };
    const filled = (id: string) => { const el = $(id); return !!el && (el.childElementCount > 0 || !!el.textContent?.trim()); };
    let top = 0;
    for (const id of ['shiftbar', 'topbar']) { const r = rect(id); if (r && r.bottom < H / 2) top = Math.max(top, r.bottom); }
    let left: number, right: number, bottom: number;
    const pr = $('prompt');
    if (this.touch) {
      if (filled('phasebanner')) { const r = rect('phasebanner'); if (r && r.bottom < H / 2) top = Math.max(top, r.bottom); }
      // a card the player opened may use the shift bar's rows too (only while it is open; its time stops meanwhile)
      if (hq.querySelector(':scope > .open')) top = 4;
      left = Math.max(rect('minimap')?.right ?? 0, rect('rightinfo')?.right ?? 0) + 8;
      right = W - 8;
      // the touch buttons own the right edge: the column stops at the nearest one beside it
      for (const b of document.querySelectorAll<HTMLElement>('#touch .tbtn')) {
        if (b.classList.contains('hidden')) continue;
        const r = b.getBoundingClientRect();
        if (r.width > 1 && r.left > W * 0.5 && r.bottom > top) right = Math.min(right, r.left - 8);
      }
      // the prompt: under the crosshair, its bottom just above the stamina bar, clear of the joystick corner (left 30 %)
      const st = rect('stamina');
      const anchor = (st ? st.top : H - 48 * z) - GAP;
      const lowL = Math.max(left, W * 0.24), lowR = right;
      if (pr) {
        pr.style.left = `${(lowL + lowR) / 2 / z}px`; pr.style.top = 'auto';
        pr.style.bottom = `${(H - anchor) / z}px`; pr.style.maxWidth = `${(lowR - lowL) / z}px`;
      }
      document.documentElement.style.setProperty('--hq-low-cx', `${(lowL + lowR) / 2 / z}px`);
      document.documentElement.style.setProperty('--hq-low-w', `${(lowR - lowL) / z}px`);
      const pRect = pr && pr.textContent?.trim() ? pr.getBoundingClientRect() : null;
      // the stack ends above the prompt (or the room kept for a two-line one); if it reaches down beside the joystick
      // corner (bottom-left: 24 % wide, 40 % high) it steps right of it
      bottom = Math.min(anchor - 52 * z, pRect && pRect.height > 1 ? pRect.top : Infinity) - GAP;
      if (bottom > H * 0.6) left = Math.max(left, W * 0.24);

    } else {
      left = Math.max(rect('minimap')?.right ?? 0, filled('feed') ? rect('feed')?.right ?? 0 : 0, rect('aftermath')?.right ?? 0) + 12;
      right = (rect('rightinfo')?.left ?? W) - 12;
      const pRect = pr && pr.textContent?.trim() ? pr.getBoundingClientRect() : null;
      bottom = Math.min(H * 0.58, pRect && pRect.height > 1 ? pRect.top : Infinity) - 8;
    }
    top += GAP;
    hud.style.setProperty('--hq-cx', `${(left + right) / 2 / z}px`);
    hud.style.setProperty('--hq-rgap', `${(W - right) / z}px`);
    hq.style.left = `${left / z}px`; hq.style.top = `${top / z}px`;
    hq.style.width = `${Math.max(0, right - left) / z}px`; hq.style.height = `${Math.max(0, bottom - top) / z}px`;
    hq.style.setProperty('--hq-h', `${Math.max(0, bottom - top) / z}px`);
    // phone: the exact-change prompt (#qte) covers the stack's box for its few seconds; the stack waits behind it
    hq.classList.toggle('hq-mute', this.touch && !!$('qte'));
    // fit: in visual order (an opened card first), anything that runs past the bottom is hidden
    const items: HTMLElement[] = [];
    for (const el of [...hq.children] as HTMLElement[]) {
      if (el.id === 'toasts') { items.push(...[...el.children].reverse() as HTMLElement[]); continue; }
      if (el.classList.contains('hidden')) continue;
      if (el.classList.contains('open')) items.unshift(el); else items.push(el);
    }
    // (#hq's bottom padding is room for the last piece's drop shadow)
    const limit = hq.clientHeight - (parseFloat(getComputedStyle(hq).paddingBottom) || 0) + 0.5;
    const card = items.find(el => (el.id === 'introcard' || el.id === 'arccard') && !el.classList.contains('open'));
    // first try: the card folded; if that pushes the karen alert out, the card goes down to its title line and we fit again
    if (!this.fit(items, limit, null) && this.touch && card && !card.classList.contains('hq-off')) this.fit(items, limit, card);
  }

  /** One fitting pass; false when the karen alert had to be hidden. */
  private fit(items: HTMLElement[], limit: number, tight: HTMLElement | null) {
    for (const el of items) el.classList.remove('hq-off', 'tight');
    tight?.classList.add('tight');
    let toastsFull = false, alertOn = true;
    for (const el of items) {
      const toast = el.parentElement?.id === 'toasts';
      if (toast && toastsFull) { el.classList.add('hq-off'); continue; }
      if (el.offsetHeight < 1) continue;
      // (offsetTop is from #hq for the toasts too: #toasts itself is not positioned)
      if (el.offsetTop + el.offsetHeight <= limit) continue;
      // no room: a phone card shrinks to its title line (still tappable), the karen alert to its first line, before
      // either one waits
      if ((el.id === 'alert' || (this.touch && (el.id === 'introcard' || el.id === 'arccard'))) && !el.classList.contains('open')) {
        el.classList.add('tight');
        if (el.offsetTop + el.offsetHeight <= limit) continue;
      }
      el.classList.add('hq-off'); if (toast) toastsFull = true;
      if (el.id === 'alert') alertOn = false;
    }
    return alertOn;
  }
}

export const hudq = new HudQueue();
