// Simulated player ("模擬玩家") used by automated tests and load tests. It only sees the same
// snapshot a real client sees and sends the same messages, so it exercises the real protocol.
import { PRODUCTS, Product, SERVER_INTERACT_RANGE, WALK_SPEED, shelfCapacity } from './constants.ts';
import { COFFEE_MACHINE, CRATES, MICROWAVE, MOP_RACK, REGISTERS, SHELVES, findPath, shelfBrowseSpots } from './map.ts';
import type { ActKind, ClientMsg, CustomerSnap, PlayerSnap, Snapshot, Target } from './protocol.ts';

export interface BotOutput {
  x: number; z: number; yaw: number;
  act?: { kind: ActKind; target: Target };
  drop?: boolean; buy?: string; ready?: boolean;
  throw?: { yaw: number; pitch: number }; spin?: boolean; ultimate?: boolean;
  /** Customer id to hit (the bot only ever hits in self-defence, never anyone with connections). */
  hit?: number;
}

/** Turn a bot decision into the same protocol messages a real client sends. */
export function botMessages(o: BotOutput, rid: () => string): ClientMsg[] {
  const out: ClientMsg[] = [{ type: 'input', x: o.x, z: o.z, yaw: o.yaw, pitch: 0, seq: 0 }];
  if (o.act) out.push({ type: 'act', rid: rid(), kind: o.act.kind, target: o.act.target });
  if (o.drop) out.push({ type: 'drop', rid: rid() });
  if (o.buy) out.push({ type: 'buy', rid: rid(), item: o.buy });
  if (o.ready) out.push({ type: 'ready', ready: true });
  if (o.throw) out.push({ type: 'throw', rid: rid(), yaw: o.throw.yaw, pitch: o.throw.pitch });
  if (o.spin) out.push({ type: 'spin', rid: rid() });
  if (o.ultimate) out.push({ type: 'ultimate', rid: rid() });
  if (o.hit != null) out.push({ type: 'hit', rid: rid(), id: o.hit });
  return out;
}

const THROW_SPOT = { x: 12, z: 13.1 };

interface Goal { pos: { x: number; z: number }; kind: ActKind; target: Target; key: string }

export class Bot {
  private path: { x: number; z: number }[] = [];
  private goalKey = '';
  private cooldown = 0;
  private stuck = 0;
  private lastPos = { x: 0, z: 0 };
  private still = 0;
  private direct = 0;
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
    const ab = s.shift?.abilities ?? [];
    const open = s.phase === 'open' || s.phase === 'closing';
    const karens = s.customers.filter(c => c.kind !== 'normal' && !c.resolved && c.revealed && c.state !== 'leaving' && !c.flying);
    // full burst: clear the store
    if (open && ab.includes('ultimate') && s.burst >= 100 && this.cooldown <= 0 && (karens.length >= 2 || karens.some(k => k.kind === 'boss' && k.phase === 5))) {
      out.ultimate = true; this.cooldown = 0.5; return out;
    }
    // self-defence: smack a karen who has lost it (never one with connections)
    if (open && ab.includes('hit') && me.grabbing == null && this.cooldown <= 0) {
      const v = karens.find(k => k.violent && !k.vip && !(k.kind === 'boss' && k.stun > 0) && Math.hypot(k.x - me.x, k.z - me.z) < 1.8);
      if (v) { out.hit = v.id; out.yaw = Math.atan2(v.x - me.x, v.z - me.z); this.cooldown = 0.8; return out; }
    }
    // mop spin when a karen is close and no regular customer would get hit
    if (open && ab.includes('spin') && me.spinCd <= 0 && me.grabbing == null && this.cooldown <= 0) {
      const near = (r: number) => s.customers.filter(c => !c.flying && !c.held && Math.hypot(c.x - me.x, c.z - me.z) < r);
      const hit = near(3.2);
      if (hit.length && hit.every(c => c.kind !== 'normal' && c.kind !== 'boss') && hit.some(c => !c.resolved)) { out.spin = true; this.cooldown = 0.5; return out; }
    }
    // carrying someone: walk to the door and throw them out
    if (me.grabbing != null) {
      const d = Math.hypot(me.x - THROW_SPOT.x, me.z - THROW_SPOT.z);
      if (d < 0.35) { out.yaw = 0; if (this.cooldown <= 0) { out.throw = { yaw: 0, pitch: 0.12 }; this.cooldown = 0.5; } return out; }
      if (this.goalKey !== 'throw') { this.goalKey = 'throw'; this.path = findPath(me, THROW_SPOT); }
      return this.walk(me, out, dt, THROW_SPOT);
    }
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
    return this.walk(me, out, dt, goal.pos);
  }

  private walk(me: PlayerSnap, out: BotOutput, dt: number, pos: { x: number; z: number }): BotOutput {
    // no progress for a while (wedged on a corner): walk straight at the goal briefly, then re-path
    if (Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z) < 0.02) this.still += dt; else this.still = 0;
    this.lastPos = { x: me.x, z: me.z };
    if (this.still > 0.6) { this.still = 0; this.direct = 0.6; this.path = []; }
    if (this.direct > 0) {
      this.direct -= dt;
      const dx = pos.x - me.x, dz = pos.z - me.z, d = Math.hypot(dx, dz) || 1;
      const side = Math.sin(performance.now() / 300) * 0.6;
      const step = WALK_SPEED * dt;
      out.x = me.x + (dx / d) * step + (-dz / d) * side * step; out.z = me.z + (dz / d) * step + (dx / d) * side * step;
      out.yaw = Math.atan2(dx, dz);
      if (this.direct <= 0) this.path = findPath(out, pos);
      return out;
    }
    // re-path toward moving targets
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(last.x - pos.x, last.z - pos.z) > 1.0 || ++this.stuck > 200) { this.path = findPath(me, pos); this.stuck = 0; }
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
    if (held?.kind === 'coffee' || held?.kind === 'meal') {
      const kinds = [held.kind, me.held2?.kind];
      const w = C.find(c => c.state === 'waitFood' && c.want && kinds.includes(c.want));
      if (w) return cust(w, 'deliver');
      const more = C.find(c => c.state === 'waitFood' && c.want && !kinds.includes(c.want));
      if (more && !me.held2) return foodGoal(more.want!);
      return null;
    }
    if (held?.kind === 'mop') {
      const sp = nearest(me, s.spills);
      if (sp) return { pos: sp, kind: 'clean', target: { t: 'spill', id: sp.id }, key: 'cl' + sp.id };
      return { pos: { x: 1.3, z: 12.7 }, kind: 'returnMop', target: { t: 'mop' }, key: 'rm' };
    }
    if (s.phase === 'summary') return null;
    // karens first
    const canGrab = !!s.shift?.abilities.includes('grab') && !me.held && !me.held2;
    const karens = C.filter(c => c.kind !== 'normal' && !c.resolved && c.revealed && c.state !== 'leaving' && !c.flying && !c.held);
    for (const k of karens) {
      if (k.kind === 'boss') {
        if (k.phase === 1 && ['queue', 'toRegister', 'atRegister'].includes(k.state)) return cust(k, 'askQueue');
        if (k.phase === 4) continue; // deal with the minions first
        if (canGrab && k.phase !== 1) return cust(k, 'grab'); // walks up; the self-defence hit above stuns him first (he is too heavy otherwise)
        if (k.phase === 2 && k.state === 'complain') return cust(k, 'calm');
        if (k.phase === 3) return cust(k, 'stopFilm');
        continue;
      }
      if (k.kind === 'cutter' && ['queue', 'toRegister', 'atRegister'].includes(k.state)) return cust(k, 'askQueue');
      if (canGrab && k.kind !== 'cutter' && (!k.heavy || k.stun > 0)) return cust(k, 'grab');
      if (k.kind === 'rager' && k.state === 'complain') return cust(k, 'calm');
      if (k.kind === 'cutter' && ['queue', 'toRegister', 'atRegister'].includes(k.state)) return cust(k, 'askQueue');
      if (k.kind === 'streamer' && this.role !== 'cashier') return cust(k, 'stopFilm');
      if (k.kind === 'hog') return cust(k, 'checkBag');
      if (k.kind === 'litterer') return cust(k, 'stopLitter');
      if (k.kind === 'charger' && k.state === 'charge') return cust(k, 'unplug');
    }
    const regs = s.upgrades.register2 > 0 ? REGISTERS : [REGISTERS[0]];
    const tasks: Goal[] = [];
    for (const r of regs) {
      const waiting = C.find(c => c.state === 'atRegister' && Math.abs(c.x - r.customer.x) < 0.6 && Math.abs(c.z - r.customer.z) < 0.6);
      if (waiting) tasks.push({ pos: r.cashier, kind: 'checkout', target: { t: 'register', idx: r.idx }, key: 'co' + r.idx });
    }
    const waitingFood = C.find(c => c.state === 'waitFood' && c.want);
    const coffeeWaiting = !!waitingFood;
    const coffeeGoal: Goal = waitingFood ? foodGoal(waitingFood.want!) : foodGoal('coffee');
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

function foodGoal(f: 'coffee' | 'meal'): Goal {
  const b = f === 'coffee' ? COFFEE_MACHINE : MICROWAVE;
  return { pos: { x: (b.x0 + b.x1) / 2, z: b.z1 + 0.6 }, kind: f === 'coffee' ? 'brew' : 'heat', target: { t: f === 'coffee' ? 'coffee' : 'microwave' }, key: 'food' + f };
}

function shelfGoal(me: { x: number; z: number }, p: Product, kind: ActKind): Goal {
  const spot = nearest(me, shelfBrowseSpots(p))!;
  return { pos: spot, kind, target: { t: 'shelf', product: p }, key: kind + p };
}

function goalDistance(s: Snapshot, me: PlayerSnap, g: Goal) {
  const t = g.target;
  const box = t.t === 'shelf' ? SHELVES.find(x => x.product === t.product)!.box : t.t === 'crate' ? CRATES.find(x => x.product === t.product)!.box : t.t === 'coffee' ? COFFEE_MACHINE : t.t === 'microwave' ? MICROWAVE : t.t === 'mop' ? MOP_RACK : null;
  if (box) {
    const dx = Math.max(box.x0 - me.x, 0, me.x - box.x1), dz = Math.max(box.z0 - me.z, 0, me.z - box.z1);
    return Math.hypot(dx, dz);
  }
  if (t.t === 'customer') { const c = s.customers.find(c => c.id === t.id); if (c) return Math.hypot(c.x - me.x, c.z - me.z); }
  // registers: the server measures to the till itself, so stand at the cashier spot before acting
  if (t.t === 'register') return Math.max(Math.hypot(g.pos.x - me.x, g.pos.z - me.z) * 2.5, Math.hypot(REGISTERS[t.idx].x - me.x, REGISTERS[t.idx].z - me.z) - 0.6);
  return Math.hypot(g.pos.x - me.x, g.pos.z - me.z);
}

function nearest<T extends { x: number; z: number }>(me: { x: number; z: number }, list: T[]): T | undefined {
  let best: T | undefined, bd = Infinity;
  for (const it of list) { const d = Math.hypot(it.x - me.x, it.z - me.z); if (d < bd) { bd = d; best = it; } }
  return best;
}
