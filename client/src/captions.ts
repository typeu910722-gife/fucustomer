// 音效字幕: short text captions for important sounds (deaf / hard-of-hearing players, or playing muted).
// audio.ts reports every play() through a listener hook (before the mute / AudioContext checks, so captions work
// even with the sound off); nothing here touches the mix. Captions are rate-limited and de-duplicated:
// the same caption while its line is still showing refreshes the existing line (with a ×N count) instead of adding another one.

/** Sound name → caption. Only sounds that carry information get one (no footsteps, pickups, UI blips). */
export const CAPTION_TEXT: Record<string, string> = {
  angry: '[客人生氣]', karen: '[奧客出現！]', door: '[門鈴]', siren: '[警笛]', ultimate: '[退散！]', bassdrop: '[退散！]',
  eject: '[請出門！]', crash: '[東西打翻]', splat: '[有東西灑了]', mistake: '[出錯了]', outage: '[停電]', unplug: '[插頭火花]',
  win: '[下班鈴]', lose: '[失敗音效]', levelup: '[升級！]', achievement: '[成就解鎖]', slap: '[啪！]', trombone: '[哀怨的喇叭]',
  ping: '[隊友標記]', quick: '[隊友訊息]', hit: '[出手]', open: '[開店音樂]', cash: '[收銀機]', ooh: '[圍觀：喔～]',
  calm: '[客人冷靜了]', brew: '[咖啡機]',
  rustle: '[塑膠袋沙沙聲]', flush: '[廁所沖水・淹水了]', coins: '[零錢叮噹]', fireworks: '[煙火砰砰]', crowd: '[倒數人潮湧入]',
};
/** A new caption line at most this often (bursts are dropped, the most important line survives via priority). */
export const MIN_GAP_MS = 220;
export const SHOW_MS = 2600;
export const MAX_LINES = 3;
/** Higher wins when lines must be dropped. */
const PRIO: Record<string, number> = { karen: 3, siren: 3, angry: 3, ultimate: 3, bassdrop: 3, outage: 3, door: 2, eject: 2, crash: 2, win: 3, lose: 3, flush: 2, crowd: 3, fireworks: 2 };

export interface CaptionLine { text: string; count: number; until: number; prio: number; far: boolean }

/** Pure caption queue (no DOM) so the rate limiting can be unit-tested. */
export class CaptionQueue {
  lines: CaptionLine[] = [];
  private lastNew = -1e9;
  /** Returns true when the visible lines changed. `dist` (metres from the listener) marks far-away sounds. */
  push(name: string, now: number, dist = 0): boolean {
    const text = CAPTION_TEXT[name];
    if (!text) return false;
    this.expire(now);
    const far = dist > 12;
    const same = this.lines.find(l => l.text === text);
    if (same) {
      same.count++; same.until = now + SHOW_MS; same.far = same.far && far;
      return true;
    }
    const prio = PRIO[name] ?? 1;
    if (now - this.lastNew < MIN_GAP_MS && prio < 3) return false;
    if (this.lines.length >= MAX_LINES) {
      // drop the least important (oldest first among equals); give up if all are more important
      let worst = -1;
      for (let i = 0; i < this.lines.length; i++) if (this.lines[i].prio <= prio && (worst < 0 || this.lines[i].prio < this.lines[worst].prio)) worst = i;
      if (worst < 0) return false;
      this.lines.splice(worst, 1);
    }
    this.lines.push({ text, count: 1, until: now + SHOW_MS, prio, far });
    this.lastNew = now;
    return true;
  }
  expire(now: number): boolean {
    const n = this.lines.length;
    this.lines = this.lines.filter(l => l.until > now);
    return this.lines.length !== n;
  }
}

// ---------- DOM ----------
let enabled = false;
let el: HTMLElement | null = null;
let timer = 0;
const q = new CaptionQueue();

function box(): HTMLElement {
  if (el && el.isConnected) return el;
  el = document.getElementById('captions');
  if (!el) {
    el = document.createElement('div'); el.id = 'captions';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}
function render() {
  const b = box();
  b.innerHTML = q.lines.map(l => `<div class="cap${l.far ? ' far' : ''}">${l.text}${l.count > 1 ? `<small>×${l.count}</small>` : ''}</div>`).join('');
  b.classList.toggle('hidden', !q.lines.length);
}
function tick() {
  timer = 0;
  if (q.expire(performance.now())) render();
  if (q.lines.length) timer = window.setTimeout(tick, 250);
}

export function setCaptions(on: boolean) {
  enabled = on;
  if (!on) { q.lines = []; if (el) render(); }
}
export const captionsOn = () => enabled;
/** Called for every audio.play(name, x, z). */
export function onSound(name: string, x: number | undefined, z: number | undefined, from: { x: number; z: number }) {
  if (!enabled || typeof document === 'undefined') return;
  const d = x === undefined || z === undefined ? 0 : Math.hypot(x - from.x, z - from.z);
  if (q.push(name, performance.now(), d)) render();
  if (!timer && q.lines.length) timer = window.setTimeout(tick, 250);
}
