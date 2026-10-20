// Empty / near-empty shelf warnings for the HUD: which shelves to flash, the grace countdown before customers who
// find a bare shelf start costing rating (EMPTY_SHELF_GRACE in the sim), and a short guide arrow to the right crate.
import { EMPTY_SHELF_GRACE, PRODUCTS, type Product } from '../../shared/constants.ts';
import { CRATES, shelfBrowseSpots } from '../../shared/map.ts';
import type { PlayerSnap, Snapshot } from '../../shared/protocol.ts';

/** At or below this many items a shelf counts as nearly empty (its stock bar flashes). */
export const NEAR_EMPTY = 2;
/** How long the guide arrow points at the crate after a shelf runs out (ms). */
const GUIDE_MS = 9000;

export interface ShelfChanges { empty: Product[]; low: Product[] }

export class ShelfWatch {
  private emptyAt: Partial<Record<Product, number>> = {};
  private low = new Set<Product>();
  private active = false;

  /** Feed every HUD refresh. Returns shelves that just ran out / just got low (each once until restocked). */
  update(s: Snapshot, now: number): ShelfChanges {
    const out: ShelfChanges = { empty: [], low: [] };
    const on = (s.phase === 'open' || s.phase === 'closing') && !s.raid;
    if (!on) { this.emptyAt = {}; this.low.clear(); this.active = false; return out; }
    for (const p of PRODUCTS) {
      const n = s.shelves[p];
      if (n <= 0) {
        if (this.emptyAt[p] == null) { this.emptyAt[p] = now; if (this.active) out.empty.push(p); }
      } else delete this.emptyAt[p];
      if (n > 0 && n <= NEAR_EMPTY) {
        if (!this.low.has(p)) { this.low.add(p); if (this.active) out.low.push(p); }
      } else if (n > NEAR_EMPTY + 1) this.low.delete(p);
    }
    this.active = true; // shelves already empty when we first look (joined mid-shift) are flashed but not announced
    return out;
  }

  isEmpty(p: Product) { return this.emptyAt[p] != null; }

  /** Seconds left before a bare shelf starts costing rating (0 = it already does). */
  graceLeft(p: Product, now: number) {
    const t = this.emptyAt[p];
    return t == null ? 0 : Math.max(0, Math.ceil(EMPTY_SHELF_GRACE - (now - t) / 1000));
  }

  /** Where the guide arrow should point: a box of the shelf that ran out most recently (one lying on the floor, else its crate), or that shelf when carrying its box. */
  guide(s: Snapshot, me: PlayerSnap, now: number): { x: number; z: number } | null {
    if (me.held?.kind === 'box') {
      const p = me.held.product;
      if (this.emptyAt[p] == null && !this.low.has(p)) return null;
      const sp = shelfBrowseSpots(p); return sp[Math.floor(sp.length / 2)] ?? null;
    }
    if (me.held || me.grabbing != null) return null;
    let best: Product | null = null, bt = -Infinity;
    for (const p of PRODUCTS) { const t = this.emptyAt[p]; if (t != null && now - t < GUIDE_MS && s.backstock[p] > 0 && t > bt) { bt = t; best = p; } }
    // nothing empty with stock in the back, but the morning delivery box for an empty shelf may still be by the door
    if (!best) {
      const it = s.items.find(i => i.held.kind === 'box' && this.emptyAt[i.held.product] != null && now - this.emptyAt[i.held.product]! < GUIDE_MS);
      return it ? { x: it.x, z: it.z } : null;
    }
    const box = s.items.find(i => i.held.kind === 'box' && i.held.product === best);
    if (box) return { x: box.x, z: box.z };
    const c = CRATES.find(c => c.product === best);
    return c ? { x: (c.box.x0 + c.box.x1) / 2, z: (c.box.z0 + c.box.z1) / 2 } : null;
  }
}
