// Step-by-step first-shift tutorial (shift 1-1): one objective at a time with a guide target.
import { CRATES, MOP_RACK, REGISTERS, SHELVES, shelfBrowseSpots } from '../../shared/map.ts';
import { PRODUCT_INFO, PRODUCTS } from '../../shared/constants.ts';
import type { PlayerSnap, Snapshot } from '../../shared/protocol.ts';

export interface TutorialView { step: number; total: number; text: string; target: { x: number; z: number } | null }

interface Step {
  text: (s: Snapshot, me: PlayerSnap) => string;
  target: (s: Snapshot, me: PlayerSnap) => { x: number; z: number } | null;
  done: (s: Snapshot, me: PlayerSnap, pos: { x: number; z: number }) => boolean;
}

const lowestShelf = (s: Snapshot) => [...PRODUCTS].sort((a, b) => s.shelves[a] - s.shelves[b])[0];

export class Tutorial {
  private i = 0;
  private finishedAt = 0;
  private startServed = -1;
  constructor(private touch: boolean, private interactKey: () => string = () => 'E') {}

  private key(k: string) { return this.touch ? `「${k}」按鈕` : k === '互動' ? this.interactKey() : k; }

  private steps: Step[] = [
    {
      text: () => '走到櫃台內側的收銀機前（跟著黃色箭頭）',
      target: () => REGISTERS[0].cashier,
      done: (_s, _m, pos) => Math.hypot(pos.x - REGISTERS[0].cashier.x, pos.z - REGISTERS[0].cashier.z) < 1.1,
    },
    {
      text: s => s.customers.some(c => c.state === 'atRegister') ? `顧客到了！面向收銀機按 ${this.key('互動')} 結帳` : '等顧客挑完商品走到收銀台前……',
      target: () => ({ x: REGISTERS[0].x, z: REGISTERS[0].z }),
      done: s => s.dayStats.served >= 1,
    },
    {
      text: s => `貨架會被買空。去左上角倉庫，對「${PRODUCT_INFO[lowestShelf(s)].name}貨箱」按 ${this.key('互動')} 拿一箱`,
      target: s => { const c = CRATES.find(c => c.product === lowestShelf(s))!; return { x: (c.box.x0 + c.box.x1) / 2, z: (c.box.z0 + c.box.z1) / 2 }; },
      done: (_s, me) => me.held?.kind === 'box',
    },
    {
      text: (_s, me) => me.held?.kind === 'box' ? `把貨箱拿到「${PRODUCT_INFO[me.held.product].name}」貨架，按 ${this.key('互動')} 上架` : '上架完成！',
      target: (_s, me) => { if (me.held?.kind !== 'box') return null; const p = me.held.product; const sp = shelfBrowseSpots(p); return sp[Math.floor(sp.length / 2)] ?? null; },
      done: (_s, me) => me.held?.kind !== 'box',
    },
    {
      text: () => `地上有髒污會拉高混亂度。去西側牆邊按 ${this.key('互動')} 拿拖把`,
      target: () => ({ x: (MOP_RACK.x0 + MOP_RACK.x1) / 2, z: (MOP_RACK.z0 + MOP_RACK.z1) / 2 }),
      done: (s, me) => me.held?.kind === 'mop' || s.spills.length === 0,
    },
    {
      text: () => `對準地上的髒污按 ${this.key('互動')} 拖乾淨`,
      target: (s, me) => { let best: { x: number; z: number } | null = null, bd = Infinity; for (const sp of s.spills) { const d = Math.hypot(sp.x - me.x, sp.z - me.z); if (d < bd) { bd = d; best = sp; } } return best; },
      done: s => s.dayStats.spillsCleaned >= 1 || s.spills.length === 0,
    },
  ];

  update(s: Snapshot, me: PlayerSnap, pos: { x: number; z: number }, now: number): TutorialView | null {
    if (s.phase !== 'open') return null;
    if (this.startServed < 0) this.startServed = s.dayStats.served;
    while (this.i < this.steps.length && this.steps[this.i].done(s, me, pos)) this.i++;
    if (this.i >= this.steps.length) {
      if (!this.finishedAt) this.finishedAt = now;
      if (now - this.finishedAt > 8000) return null;
      return { step: this.steps.length, total: this.steps.length, text: '🎉 教學完成！繼續結帳、補貨、清潔，在時間內達成營業額就能下班', target: null };
    }
    const st = this.steps[this.i];
    return { step: this.i + 1, total: this.steps.length, text: st.text(s, me), target: st.target(s, me) };
  }
}
