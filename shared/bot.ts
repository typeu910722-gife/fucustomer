// Simulated player ("模擬玩家") used by automated tests and load tests. It only sees the same
// snapshot a real client sees and sends the same messages, so it exercises the real protocol.
import { PRODUCTS, Product, SERVER_INTERACT_RANGE, WALK_SPEED, shelfCapacity } from './constants.ts';
import { COFFEE_MACHINE, CRATES, MOP_RACK, REGISTERS, SHELVES, findPath, shelfBrowseSpots } from './map.ts';
import type { ActKind, CustomerSnap, PlayerSnap, Snapshot, Target } from './protocol.ts';

export interface BotOutput {
  x: number; z: number; yaw: number;
  act?: { kind: ActKind; target: Target };
  drop?: boolean; buy?: string; ready?: boolean;
}

interface Goal { pos: { x: number; z: number }; kind: ActKind; target: Target; key: string }

export class Bot {
  private path: { x: number; z: number }[] = [];
  private goalKey = '';
  private cooldown = 0;
  private stuck = 0;
  constructor(public role: 'any' | 'cashier' | 'stocker' | 'cleaner' = 'any', private seed = Math.random()) {}

  update(s: Snapshot, me: PlayerSnap, dt: number): BotOutput {
    const out: BotOutput = { x: me.x, z: me.z, yaw: me.yaw };
    this.cooldown -= dt;
    if (s.phase === 'summary') { if (!me.ready) out.ready = true; return out; }
    // reorder stock whenever the stockroom runs low (allowed during business too)
    const want = s.phase === 'prep' ? 18 : 6 + 3 * s.playerCount;
    const low = PRODUCTS.find(p => s.backstock[p] < want && s.money > 80);
    if (low && this.cooldown <= 0 && (this.role !== 'cashier' || s.phase === 'prep')) { out.buy = 'stock_' + low; this.cooldown = s.phase === 'prep' ? 0.5 : 4; return out; }
    if (s.phase === 'prep' && !me.ready && this.cooldown <= 0) { out.ready = true; this.cooldown = 1; }
    if (me.busy) return out;
    const goal = this.pickGoal(s, me);
    if (!goal) {
      if (me.held && me.held.kind !== 'mop' && this.cooldown <= 0) { out.drop = true; this.cooldown = 1; }
      return out;
    }
    if (goal.key !== this.goalKey) { this.goalKey = goal.key; this.path = findPath(me, goal.pos); this.stuck = 0; }
    const dist = goalDistance(s, me, goal);
    if (dist < SERVER_INTERACT_RANGE - 0.9) {
      if (this.cooldown <= 0) { out.act = { kind: goal.kind, target: goal.target }; this.cooldown = 0.35; }
      out.yaw = Math.atan2(goal.pos.x - me.x, goal.pos.z - me.z);
      return out;
    }
    // re-path toward moving targets
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(last.x - goal.pos.x, last.z - goal.pos.z) > 1.0 || ++this.stuck > 200) { this.path = findPath(me, goal.pos); this.stuck = 0; }
    let step = WALK_SPEED * 1.2 * dt;
    let x = me.x, z = me.z;
    while (step > 0 && this.path.length) {
      const t = this.path[0];
      const d = Math.hypot(t.x - x, t.z - z);
      if (d <= step) { x = t.x; z = t.z; step -= d; this.path.shift(); } else { x += ((t.x - x) / d) * step; z += ((t.z - z) / d) * step; step = 0; }
      out.yaw = Math.atan2(t.x - me.x, t.z - me.z);
    }
    out.x = x; out.z = z;
    return out;
  }

  private pickGoal(s: Snapshot, me: PlayerSnap): Goal | null {
    const C = s.customers;
    const cust = (c: CustomerSnap, kind: ActKind): Goal => ({ pos: { x: c.x, z: c.z }, kind, target: { t: 'customer', id: c.id }, key: kind + c.id });
    const held = me.held;
    if (held?.kind === 'box') {
      const p = held.product;
      if (s.shelves[p] < shelfCapacity(s.upgrades.shelves)) return shelfGoal(me, p, 'stock');
      const cr = CRATES.find(c => c.product === p)!;
      return { pos: { x: (cr.box.x0 + cr.box.x1) / 2, z: cr.box.z1 + 0.7 }, kind: 'returnBox', target: { t: 'crate', product: p }, key: 'rb' + p };
    }
    if (held?.kind === 'coffee') {
      const w = C.find(c => c.state === 'waitCoffee');
      return w ? cust(w, 'deliver') : null;
    }
    if (held?.kind === 'mop') {
      const sp = nearest(me, s.spills);
      if (sp) return { pos: sp, kind: 'clean', target: { t: 'spill', id: sp.id }, key: 'cl' + sp.id };
      return { pos: { x: 1.3, z: 12.7 }, kind: 'returnMop', target: { t: 'mop' }, key: 'rm' };
    }
    if (s.phase === 'summary') return null;
    // karens first
    const karens = C.filter(c => c.kind !== 'normal' && !c.resolved && c.revealed && c.state !== 'leaving');
    for (const k of karens) {
      if (k.kind === 'rager' && k.state === 'complain') return cust(k, 'calm');
      if (k.kind === 'cutter' && ['queue', 'toRegister', 'atRegister'].includes(k.state)) return cust(k, 'askQueue');
      if (k.kind === 'streamer' && this.role !== 'cashier') return cust(k, 'stopFilm');
      if (k.kind === 'hog') return cust(k, 'checkBag');
    }
    const regs = s.upgrades.register2 > 0 ? REGISTERS : [REGISTERS[0]];
    const tasks: Goal[] = [];
    for (const r of regs) {
      const waiting = C.find(c => c.state === 'atRegister' && Math.abs(c.x - r.customer.x) < 0.6 && Math.abs(c.z - r.customer.z) < 0.6);
      if (waiting) tasks.push({ pos: r.cashier, kind: 'checkout', target: { t: 'register', idx: r.idx }, key: 'co' + r.idx });
    }
    const coffeeWaiting = C.some(c => c.state === 'waitCoffee');
    const coffeeGoal: Goal = { pos: { x: (COFFEE_MACHINE.x0 + COFFEE_MACHINE.x1) / 2, z: COFFEE_MACHINE.z1 + 0.6 }, kind: 'brew', target: { t: 'coffee' }, key: 'brew' };
    const lowShelf = PRODUCTS.filter(p => s.shelves[p] < shelfCapacity(s.upgrades.shelves) * 0.5 && s.backstock[p] > 0);
    const restock: Goal[] = lowShelf.map(p => { const cr = CRATES.find(c => c.product === p)!; return { pos: { x: (cr.box.x0 + cr.box.x1) / 2, z: cr.box.z1 + 0.7 }, kind: 'takeBox' as ActKind, target: { t: 'crate', product: p } as Target, key: 'tb' + p }; });
    const item = nearest(me, s.items.filter(i => i.held.kind === 'box'));
    const clean: Goal[] = s.spills.length >= 2 && s.mopsOnRack > 0 ? [{ pos: { x: (MOP_RACK.x1) + 0.6, z: (MOP_RACK.z0 + MOP_RACK.z1) / 2 }, kind: 'takeMop', target: { t: 'mop' }, key: 'tm' }] : [];
    const order: Goal[][] =
      this.role === 'stocker' ? [restock, tasks, coffeeWaiting ? [coffeeGoal] : [], clean]
        : this.role === 'cleaner' ? [clean, tasks, restock, coffeeWaiting ? [coffeeGoal] : []]
          : [tasks, coffeeWaiting ? [coffeeGoal] : [], restock, clean];
    for (const list of order) if (list.length) return list[Math.floor(this.seed * list.length) % list.length];
    if (item) return { pos: item, kind: 'pickup', target: { t: 'item', id: item.id }, key: 'pk' + item.id };
    return null;
  }
}

function shelfGoal(me: { x: number; z: number }, p: Product, kind: ActKind): Goal {
  const spot = nearest(me, shelfBrowseSpots(p))!;
  return { pos: spot, kind, target: { t: 'shelf', product: p }, key: kind + p };
}

function goalDistance(s: Snapshot, me: PlayerSnap, g: Goal) {
  const t = g.target;
  const box = t.t === 'shelf' ? SHELVES.find(x => x.product === t.product)!.box : t.t === 'crate' ? CRATES.find(x => x.product === t.product)!.box : t.t === 'coffee' ? COFFEE_MACHINE : t.t === 'mop' ? MOP_RACK : null;
  if (box) {
    const dx = Math.max(box.x0 - me.x, 0, me.x - box.x1), dz = Math.max(box.z0 - me.z, 0, me.z - box.z1);
    return Math.hypot(dx, dz);
  }
  if (t.t === 'customer') { const c = s.customers.find(c => c.id === t.id); if (c) return Math.hypot(c.x - me.x, c.z - me.z); }
  return Math.hypot(g.pos.x - me.x, g.pos.z - me.z);
}

function nearest<T extends { x: number; z: number }>(me: { x: number; z: number }, list: T[]): T | undefined {
  let best: T | undefined, bd = Infinity;
  for (const it of list) { const d = Math.hypot(it.x - me.x, it.z - me.z); if (d < bd) { bd = d; best = it; } }
  return best;
}
