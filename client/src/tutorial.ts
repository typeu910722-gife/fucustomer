// Step-by-step first-shift tutorial (shift 1-1): one short objective at a time with a guide target.
// Starts during the prep seconds (walk to the till; arriving there opens the store), and two things can cut in
// front of the current step: an 插隊 karen (the day's first 退散) and a customer left waiting at the till.
import { CRATES, MOP_RACK, REGISTERS, shelfBrowseSpots } from '../../shared/map.ts';
import { PRODUCT_INFO, PRODUCTS } from '../../shared/constants.ts';
import type { CustomerSnap, PlayerSnap, Snapshot } from '../../shared/protocol.ts';

export interface TutorialView {
  step: number; total: number; text: string; target: { x: number; z: number } | null;
  /** Prep only: the player reached the till, so the store can open right away. */
  ready?: boolean;
  /** An interruption (karen / waiting customer) shown in place of the numbered step. */
  urgent?: boolean;
}

interface Step {
  text: (s: Snapshot, me: PlayerSnap) => string;
  target: (s: Snapshot, me: PlayerSnap) => { x: number; z: number } | null;
  done: (s: Snapshot, me: PlayerSnap, pos: { x: number; z: number }) => boolean;
}

const lowestShelf = (s: Snapshot) => [...PRODUCTS].sort((a, b) => s.shelves[a] - s.shelves[b])[0];
const QUEUE_STATES = ['queue', 'toRegister', 'atRegister'];
/** The unresolved 插隊 karen standing in line, if any. */
export const tutorialCutter = (s: Snapshot): CustomerSnap | undefined =>
  s.customers.find(c => c.kind === 'cutter' && !c.resolved && QUEUE_STATES.includes(c.state));

export class Tutorial {
  private i = 0;
  private finishedAt = 0;
  constructor(private touch: boolean, private interactKey: () => string = () => 'E') {}

  private key(k: string) { return this.touch ? `「${k}」` : k === '互動' ? this.interactKey() : k; }

  private steps: Step[] = [
    {
      text: () => '走到櫃台後面的收銀機（跟著黃色箭頭）',
      target: () => REGISTERS[0].cashier,
      done: (_s, _m, pos) => Math.hypot(pos.x - REGISTERS[0].cashier.x, pos.z - REGISTERS[0].cashier.z) < 1.1,
    },
    {
      text: s => s.customers.some(c => c.state === 'atRegister') ? `客人來了！看著收銀機按 ${this.key('互動')} 結帳` : '站好，第一位客人馬上來……',
      target: () => ({ x: REGISTERS[0].x, z: REGISTERS[0].z }),
      done: s => s.dayStats.served >= 1,
    },
    {
      text: s => `貨架快空了：去倉庫對「${PRODUCT_INFO[lowestShelf(s)].name}貨箱」按 ${this.key('互動')} 拿一箱`,
      target: s => { const c = CRATES.find(c => c.product === lowestShelf(s))!; return { x: (c.box.x0 + c.box.x1) / 2, z: (c.box.z0 + c.box.z1) / 2 }; },
      done: (_s, me) => me.held?.kind === 'box',
    },
    {
      text: (_s, me) => me.held?.kind === 'box' ? `搬到「${PRODUCT_INFO[me.held.product].name}」貨架，按 ${this.key('互動')} 上架` : '上架完成！',
      target: (_s, me) => { if (me.held?.kind !== 'box') return null; const p = me.held.product; const sp = shelfBrowseSpots(p); return sp[Math.floor(sp.length / 2)] ?? null; },
      done: (_s, me) => me.held?.kind !== 'box',
    },
    {
      text: () => `地上髒了：去牆邊按 ${this.key('互動')} 拿拖把`,
      target: () => ({ x: (MOP_RACK.x0 + MOP_RACK.x1) / 2, z: (MOP_RACK.z0 + MOP_RACK.z1) / 2 }),
      done: (s, me) => me.held?.kind === 'mop' || s.spills.length === 0,
    },
    {
      text: () => `對準髒污按 ${this.key('互動')} 拖乾淨`,
      target: (s, me) => { let best: { x: number; z: number } | null = null, bd = Infinity; for (const sp of s.spills) { const d = Math.hypot(sp.x - me.x, sp.z - me.z); if (d < bd) { bd = d; best = sp; } } return best; },
      done: s => s.dayStats.spillsCleaned >= 1 || s.spills.length === 0,
    },
  ];

  update(s: Snapshot, me: PlayerSnap, pos: { x: number; z: number }, now: number): TutorialView | null {
    const total = this.steps.length;
    if (s.phase === 'prep') {
      const st = this.steps[0];
      return { step: 1, total, text: st.text(s, me), target: st.target(s, me), ready: st.done(s, me, pos) };
    }
    if (s.phase !== 'open') return null;
    while (this.i < total && this.steps[this.i].done(s, me, pos)) this.i++;
    // interruptions: the 插隊 karen first (the day's payoff), then a customer left waiting at the till
    const k = tutorialCutter(s);
    if (k) return { step: Math.min(this.i + 1, total), total, urgent: true, text: `⚠ 有人插隊！走到他旁邊按 ${this.key('互動')}「請重新排隊」`, target: { x: k.x, z: k.z } };
    if (this.i >= 2 && !me.held && s.customers.some(c => c.state === 'atRegister' && c.kind === 'normal')) {
      return { step: Math.min(this.i + 1, total), total, urgent: true, text: `客人在等結帳！先回收銀機按 ${this.key('互動')}`, target: { x: REGISTERS[0].x, z: REGISTERS[0].z } };
    }
    if (this.i >= total) {
      if (!this.finishedAt) this.finishedAt = now;
      if (now - this.finishedAt > 8000) return null;
      return { step: total, total, text: `🎉 教學完成！繼續結帳、補貨，下班前賺到 $${s.shift.goal}`, target: null };
    }
    const st = this.steps[this.i];
    return { step: this.i + 1, total, text: st.text(s, me), target: st.target(s, me) };
  }
}
