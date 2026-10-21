// Simulated player ("模擬玩家") used by automated tests and load tests. It only sees the same
// snapshot a real client sees and sends the same messages, so it exercises the real protocol.
import { BOX_SIZE, PRODUCTS, Product, SERVER_INTERACT_RANGE, WALK_SPEED, loungePace, shelfCapacity } from './constants.ts';
import { COFFEE_MACHINE, CRATES, ENTRANCE, MICROWAVE, MOP_RACK, REGISTERS, SHELVES, findPath, shelfBrowseSpots } from './map.ts';
import type { ActKind, ClientMsg, CustomerSnap, PlayerSnap, Snapshot, Target } from './protocol.ts';
import { SIG_KARENS, SigNeed, isSig, sigWaitReason } from './sigkarens.ts';
import { bagmanAtDoor, changeAnswer } from './genkarens.ts';

export interface BotOutput {
  x: number; z: number; yaw: number;
  act?: { kind: ActKind; target: Target; opt?: number };
  drop?: boolean; buy?: string; ready?: boolean;
  throw?: { yaw: number; pitch: number }; spin?: boolean; ultimate?: boolean;
  /** Customer id to hit (the bot only ever hits in self-defence, never anyone with connections). */
  hit?: number;
}

/** Turn a bot decision into the same protocol messages a real client sends. */
export function botMessages(o: BotOutput, rid: () => string): ClientMsg[] {
  const out: ClientMsg[] = [{ type: 'input', x: o.x, z: o.z, yaw: o.yaw, pitch: 0, seq: 0 }];
  if (o.act) out.push({ type: 'act', rid: rid(), kind: o.act.kind, target: o.act.target, ...(o.act.opt !== undefined ? { opt: o.act.opt } : {}) });
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
/** Where an idle fill-in bot waits: inside the stockroom (the same fixed shell on every map), next to the crates. */
const STANDBY = { x: 3.4, z: 3.4 };

/** opt: extra choice sent with the action; wait: only walk to `pos` and stand there (escorting, waiting at the door). */
interface Goal { pos: { x: number; z: number }; kind: ActKind; target: Target; key: string; opt?: number; wait?: boolean }
/** Where a bot waits for the 免費袋子阿伯 to reach the door. */
const DOOR_WAIT = { x: 12, z: 14.1 };

/**
 * What the other fill-in bots in the room are doing, so they split the work instead of chasing the same task
 * (built by shared/room.ts every tick; optional — a lone bot / the test players run without it).
 */
export interface BotTeam {
  /** Task key → id of the bot that owns it (a bot's current goal and what it is fetching things for). */
  claims: Map<string, string>;
  /** Seconds left of a person's 「我去補貨」 callout: bots leave restocking to them (except for an empty shelf). */
  humanRestock?: number;
  /** Seconds left of a 「需要支援收銀」 callout this bot answered: the till / food orders come before everything else. */
  assist?: number;
}

/** Task keys only one bot works on at a time (carrying, throwing, returning things are personal). */
export function exclusiveKey(k: string) { return !!k && !/^(throw|watch|rm|rb|stock|deliver)/.test(k); }
/** A person standing this close to a karen / dropped box is taking care of it: bots look for something else. */
const YIELD_R = 1.4;
/** Bots keep this far from people when they walk (players pass through each other, but a bot inside your view is a wall). */
const PERSONAL_SPACE = 0.75;

/**
 * How a bot plays, beyond its role. The default bot (all off) grabs and throws out every karen it can from chapter 3
 * on, which is the fastest way but skips each karen's own mechanic. `proper` ("照規矩處理", round 28 balance):
 * - never grabs / mop-spins / clears the store unless the karen has turned violent (self-defence; the 奧客之王 always is),
 *   so every karen is dealt with by its intended action (escort to the 對獎機, the change quick-time, waiting at the door
 *   for the 免費袋子阿伯, finding the 借廁所大隊 leader, the store-signature fetch-and-act…);
 * - answers the 找零計較姐 quick-time like a person: `think` seconds to read the three handfuls, then picks a wrong one
 *   with probability `changeErr` (each try is a fresh roll; a wrong pick costs her 8 s and he reads again).
 */
export interface BotStyle { proper?: boolean; changeErr?: number; think?: number }

export class Bot {
  private path: { x: number; z: number }[] = [];
  private goalKey = '';
  private cooldown = 0;
  private stuck = 0;
  private lastPos = { x: 0, z: 0 };
  private still = 0;
  private direct = 0;
  /** Movement speed multiplier (an unhappy employee drags their feet). */
  pace = 1;
  /** 員工休息室 upgrade of the store this bot works in (read from each snapshot). */
  private rested = 1;
  /** The karen / customer this bot is fetching something for (a mop, a drink…): claimed while it fetches. */
  private intent = '';
  private team: BotTeam | null = null;
  /** Seconds spent shuffling past a person before starting a task (capped: then it just works). */
  private crowdT = 0;
  private meId = '';
  /** The task keys this bot currently holds (see BotTeam.claims). */
  claimKeys(): string[] { return [this.goalKey, this.intent].filter(exclusiveKey); }
  get currentGoal() { return this.goalKey; }
  /** proper mode: seconds spent reading the change prompt so far, and a private random stream (only proper mode rolls). */
  private thinkT = 0;
  private rs: number;
  constructor(public role: 'any' | 'cashier' | 'stocker' | 'cleaner' = 'any', private seed = Math.random(), public style: BotStyle = {}) {
    this.rs = Math.floor(seed * 4294967296) ^ 0x9e3779b9;
  }
  private rnd() { let t = (this.rs = (this.rs + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  update(s: Snapshot, me: PlayerSnap, dt: number, team: BotTeam | null = null): BotOutput {
    this.team = team; this.meId = me.id; this.clock += dt;
    const out: BotOutput = { x: me.x, z: me.z, yaw: me.yaw };
    this.cooldown -= dt;
    this.rested = loungePace(s.upgrades?.lounge ?? 0);
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
    const proper = !!this.style.proper;
    if (open && ab.includes('ultimate') && s.burst >= 100 && this.cooldown <= 0 && ((!proper && karens.length >= 2) || karens.some(k => k.kind === 'boss' && k.phase === 5))) {
      out.ultimate = true; this.cooldown = 0.5; return out;
    }
    // self-defence: smack a karen who has lost it (never one with connections)
    if (open && ab.includes('hit') && me.grabbing == null && this.cooldown <= 0) {
      const v = karens.find(k => k.violent && !k.vip && !(k.kind === 'boss' && k.stun > 0) && Math.hypot(k.x - me.x, k.z - me.z) < 1.8);
      if (v) { out.hit = v.id; out.yaw = Math.atan2(v.x - me.x, v.z - me.z); this.cooldown = 0.8; return out; }
    }
    // mop spin when a karen is close and no regular customer would get hit
    if (open && !proper && ab.includes('spin') && me.spinCd <= 0 && me.grabbing == null && this.cooldown <= 0) {
      const near = (r: number) => s.customers.filter(c => !c.flying && !c.held && Math.hypot(c.x - me.x, c.z - me.z) < r);
      // gear widens the whirlwind up to ~4.3 m, so look that far for bystanders
      const hit = near(3.2), reach = near(4.5);
      if (hit.length && reach.every(c => c.kind !== 'normal' && c.kind !== 'boss') && hit.some(c => !c.resolved)) { out.spin = true; this.cooldown = 0.5; return out; }
    }
    // carrying someone: walk to the door and throw them out
    if (me.grabbing != null) {
      const d = Math.hypot(me.x - THROW_SPOT.x, me.z - THROW_SPOT.z);
      if (d < 0.35) { out.yaw = 0; if (this.cooldown <= 0) { out.throw = { yaw: 0, pitch: 0.12 }; this.cooldown = 0.5; } return out; }
      if (this.goalKey !== 'throw') { this.goalKey = 'throw'; this.path = findPath(me, THROW_SPOT); }
      return this.walk(me, out, dt, THROW_SPOT);
    }
    // friend-store raid: the clerk keeps an eye on the troublemaker (on and off, so a careful raider gets chances)
    if (open && s.raid && !me.raider) {
      const r = s.players.find(p => p.raider);
      if (r && Math.hypot(r.x - me.x, r.z - me.z) < 6 && s.phaseLeft % 12 > 5) {
        if (this.goalKey !== 'watch') { this.goalKey = 'watch'; this.path = findPath(me, r); }
        if (Math.hypot(r.x - me.x, r.z - me.z) < 1.1) { out.yaw = Math.atan2(r.x - me.x, r.z - me.z); return out; }
        return this.walk(me, out, dt, { x: r.x, z: r.z });
      }
    }
    const goal = this.pickGoal(s, me);
    if (!goal) {
      this.intent = '';
      if (me.held && me.held.kind !== 'mop' && this.cooldown <= 0) { out.drop = true; this.cooldown = 1; }
      // nothing to do: don't loiter in the doorway or next to a person (e.g. at their till) — wait by the stock crates instead
      const inWay = this.goalKey === 'standby' ? Math.hypot(me.x - STANDBY.x, me.z - STANDBY.z) > 0.4
        : s.players.some(p => p.id !== me.id && !p.bot && p.connected && Math.hypot(p.x - me.x, p.z - me.z) < 1.3)
          || (Math.abs(me.x - ENTRANCE.x) < 1.8 && me.z > ENTRANCE.z - 2.6);
      if (inWay && !me.held) {
        if (this.goalKey !== 'standby') { this.goalKey = 'standby'; this.path = findPath(me, STANDBY); }
        return this.giveWay(s, me, this.walk(me, out, dt, STANDBY));
      }
      this.goalKey = '';
      return out;
    }
    if (goal.key !== this.goalKey) { this.goalKey = goal.key; this.path = findPath(me, goal.pos); this.stuck = 0; this.crowdT = 0; this.thinkT = 0; }
    if (goal.wait) {
      // escorting / waiting at the door: get there and stand still, facing the customer
      const tc = goal.target.t === 'customer' ? s.customers.find(c => c.id === (goal.target as { id: number }).id) : null;
      if (Math.hypot(goal.pos.x - me.x, goal.pos.z - me.z) < 0.9) { if (tc) out.yaw = Math.atan2(tc.x - me.x, tc.z - me.z); return out; }
      return this.giveWay(s, me, this.walk(me, out, dt, goal.pos));
    }
    const dist = goalDistance(s, me, goal);
    if (dist < SERVER_INTERACT_RANGE - 0.9) {
      const yaw = Math.atan2(goal.pos.x - me.x, goal.pos.z - me.z);
      // in range but standing in someone's face (the till is right next to the coffee machine / microwave):
      // walk on to the proper spot first, then start working (a busy bot stands still for seconds)
      if (this.crowdT < 1.5 && this.crowding(s, me) && Math.hypot(goal.pos.x - me.x, goal.pos.z - me.z) > 0.3 && goal.target.t !== 'customer') { this.crowdT += dt; const o = this.giveWay(s, me, this.walk(me, out, dt, goal.pos)); o.yaw = yaw; return o; }
      if (goal.kind === 'exactChange' && this.style.proper && goal.opt !== undefined) {
        // a person reads the three handfuls first, and sometimes picks the wrong one
        this.thinkT += dt;
        if (this.thinkT >= (this.style.think ?? 0) && this.cooldown <= 0) {
          this.thinkT = 0;
          const ok = this.rnd() >= (this.style.changeErr ?? 0);
          out.act = { kind: goal.kind, target: goal.target, opt: ok ? goal.opt : (goal.opt + 1 + Math.floor(this.rnd() * 2)) % 3 };
          this.cooldown = 0.35;
        }
      } else if (this.cooldown <= 0) { out.act = { kind: goal.kind, target: goal.target, ...(goal.opt !== undefined ? { opt: goal.opt } : {}) }; this.cooldown = 0.35; }
      out.yaw = yaw;
      return out;
    }
    return this.giveWay(s, me, this.walk(me, out, dt, goal.pos));
  }

  /** Karen id → bot clock when a person was first seen next to it (bots leave it to them for a while). */
  private yieldSince = new Map<number, number>();
  private clock = 0;
  private yielding(id: number) {
    const t0 = this.yieldSince.get(id);
    if (t0 === undefined) { this.yieldSince.set(id, this.clock); if (this.yieldSince.size > 40) this.yieldSince.delete(this.yieldSince.keys().next().value!); return true; }
    return this.clock - t0 < 6;
  }

  /** Free task? (not held by another bot in this room) */
  private free(key: string) { const o = this.team?.claims.get(key); return !o || o === this.meId; }

  private crowding(s: Snapshot, me: PlayerSnap) { return s.players.some(p => p.id !== me.id && !p.bot && p.connected && !p.raider && Math.hypot(p.x - me.x, p.z - me.z) < PERSONAL_SPACE); }

  /** Personal space: step around a person instead of walking through them / parking in their face. */
  private giveWay(s: Snapshot, me: PlayerSnap, out: BotOutput): BotOutput {
    for (const p of s.players) {
      if (p.id === me.id || p.bot || !p.connected || p.raider) continue;
      const dx = out.x - p.x, dz = out.z - p.z, d = Math.hypot(dx, dz);
      if (d >= PERSONAL_SPACE) continue;
      // push sideways (relative to the bot's heading) and slightly away, so it slides past instead of stopping
      const hx = out.x - me.x, hz = out.z - me.z, hl = Math.hypot(hx, hz);
      let nx: number, nz: number;
      if (d > 0.05) { nx = dx / d; nz = dz / d; } else if (hl > 1e-3) { nx = -hz / hl; nz = hx / hl; } else { nx = 1; nz = 0; }
      if (hl > 1e-3) { const sx = -hz / hl, sz = hx / hl, side = sx * nx + sz * nz >= 0 ? 1 : -1; nx = nx * 0.5 + sx * side * 0.8; nz = nz * 0.5 + sz * side * 0.8; }
      const nl = Math.hypot(nx, nz) || 1, push = Math.min(0.12, PERSONAL_SPACE - d);
      out.x += (nx / nl) * push; out.z += (nz / nl) * push;
    }
    return out;
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
      const step = WALK_SPEED * dt * this.pace * this.rested;
      out.x = me.x + (dx / d) * step + (-dz / d) * side * step; out.z = me.z + (dz / d) * step + (dx / d) * side * step;
      out.yaw = Math.atan2(dx, dz);
      if (this.direct <= 0) this.path = findPath(out, pos);
      return out;
    }
    // re-path toward moving targets
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(last.x - pos.x, last.z - pos.z) > 1.0 || ++this.stuck > 200) { this.path = findPath(me, pos); this.stuck = 0; }
    let step = WALK_SPEED * 1.2 * dt * this.pace * this.rested;
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
    // people (not bots, not a raider) — bots yield to them: a person next to a karen / holding that box is on it
    const people = s.players.filter(p => p.id !== me.id && !p.bot && p.connected && !p.raider);
    // (only when that person is at least as close as this bot: two simulated players never both back off)
    const personNear = (x: number, z: number, r = YIELD_R) => { const mine = Math.hypot(me.x - x, me.z - z); return people.some(p => { const d = Math.hypot(p.x - x, p.z - z); return d < r && d <= mine; }); };
    const take = (g: Goal | null, intent = '') => (g && this.free(g.key) && (!intent || this.free(intent)) ? ((this.intent = intent), g) : null);
    // store-signature karens: fetch what they need (mop, a drink, a hot meal, a box of stock), then do the action
    const canGrabNow = !!s.shift?.abilities.includes('grab') && !me.held && !me.held2;
    const sigs = C.filter(c => isSig(c.kind) && !c.resolved && c.revealed && c.state !== 'leaving' && !c.flying && !c.held && !sigWaitReason(c.kind, c.state)
      && this.free('sigAct' + c.id) && !personNear(c.x, c.z));
    for (const sig of sigs) {
      if (canGrabNow && (!sig.heavy || sig.stun > 0) && (!this.style.proper || sig.violent)) break;
      const d = SIG_KARENS[sig.kind as keyof typeof SIG_KARENS];
      const has = (n: SigNeed) => n === 'box' || n === 'mop' ? held?.kind === n : held?.kind === n || me.held2?.kind === n;
      const intent = 'sigAct' + sig.id;
      if (!d.need || has(d.need)) { const g = take(cust(sig, 'sigAct'), intent); if (g) return g; continue; }
      if (d.need === 'mop' && !held && s.mopsOnRack > 0) { const g = take({ pos: { x: MOP_RACK.x1 + 0.6, z: (MOP_RACK.z0 + MOP_RACK.z1) / 2 }, kind: 'takeMop', target: { t: 'mop' }, key: 'tm' }, intent); if (g) return g; }
      if (d.need === 'box' && !held) {
        const p = PRODUCTS.find(x => s.backstock[x] > 0);
        if (p) { const cr = CRATES.find(c => c.product === p)!; const g = take({ pos: { x: (cr.box.x0 + cr.box.x1) / 2, z: cr.box.z1 + 0.7 }, kind: 'takeBox', target: { t: 'crate', product: p }, key: 'tb' + p }, intent); if (g) return g; }
      }
      if ((d.need === 'coffee' || d.need === 'meal') && (!held || ((held.kind === 'coffee' || held.kind === 'meal') && !me.held2)) && (d.need === 'coffee' || s.backstock.bento > 0)) { const g = take(foodGoal(d.need), intent); if (g) return g; }
      break;
    }
    this.intent = '';
    if (held?.kind === 'box') {
      const p = held.product;
      if (s.shelves[p] < shelfCapacity(s.upgrades.shelves)) return shelfGoal(me, p, 'stock');
      const cr = CRATES.find(c => c.product === p)!;
      return { pos: { x: (cr.box.x0 + cr.box.x1) / 2, z: cr.box.z1 + 0.7 }, kind: 'returnBox', target: { t: 'crate', product: p }, key: 'rb' + p };
    }
    if (held?.kind === 'coffee' || held?.kind === 'meal') {
      const kinds = [held.kind, me.held2?.kind];
      // deliver to a waiting customer nobody else is bringing it to (fall back to anyone waiting for it)
      const waiting = C.filter(c => c.state === 'waitFood' && c.want && kinds.includes(c.want));
      const w = waiting.find(c => this.free('deliver' + c.id)) ?? waiting[0];
      if (w) return cust(w, 'deliver');
      const more = C.find(c => c.state === 'waitFood' && c.want && !kinds.includes(c.want));
      if (more && !me.held2) return foodGoal(more.want!);
      return null;
    }
    if (held?.kind === 'mop') {
      // the 借廁所大隊 floods the restroom faster than anyone can mop: talk to the leader first (hands needn't be free)
      const flood = C.find(c => c.kind === 'toilet' && c.phase === 1 && !c.resolved && c.revealed && (c.state === 'toToilet' || c.state === 'toilet')
        && !c.flying && !c.held && !personNear(c.x, c.z));
      if (flood) { const g = take(cust(flood, 'toiletRule')); if (g) return g; }
      // a customer waiting at a till nobody is on: put the mop back and go check them out (the till needs free hands;
      // on a 特殊營業日 the floor never stays dry, and mopping on while the queue walks out loses the shift). Only in
      // proper mode / on special days, so the main-story numbers of docs/BALANCE.md stay comparable.
      const others = s.players.filter(p => p.id !== me.id && p.connected && !p.raider);
      const tillWaits = (this.style.proper || !!s.shift?.special) && (s.upgrades.register2 > 0 ? REGISTERS : [REGISTERS[0]]).some(r => this.free('co' + r.idx)
        && C.some(c => c.state === 'atRegister' && Math.abs(c.x - r.customer.x) < 0.6 && Math.abs(c.z - r.customer.z) < 0.6)
        && !others.some(p => Math.hypot(p.x - r.cashier.x, p.z - r.cashier.z) < 1.3));
      if (tillWaits) return { pos: { x: 1.3, z: 12.7 }, kind: 'returnMop', target: { t: 'mop' }, key: 'rm' };
      // a spill another mop (a bot's claim, or a person standing on it with a mop) is already on goes to them
      const mopper = people.filter(p => p.held?.kind === 'mop');
      const sp = nearest(me, s.spills.filter(x => this.free('cl' + x.id) && !mopper.some(p => Math.hypot(p.x - x.x, p.z - x.z) <= Math.min(YIELD_R, Math.hypot(me.x - x.x, me.z - x.z)))));
      if (sp) return { pos: sp, kind: 'clean', target: { t: 'spill', id: sp.id }, key: 'cl' + sp.id };
      return { pos: { x: 1.3, z: 12.7 }, kind: 'returnMop', target: { t: 'mop' }, key: 'rm' };
    }
    if (s.phase === 'summary') return null;
    const regs = s.upgrades.register2 > 0 ? REGISTERS : [REGISTERS[0]];
    // someone else (a person or another bot) is already standing at that till
    const others = s.players.filter(p => p.id !== me.id && p.connected && !p.raider);
    const manned = (r: (typeof REGISTERS)[number]) => others.some(p => Math.hypot(p.x - r.cashier.x, p.z - r.cashier.z) < 1.3);
    const tasks: Goal[] = [];
    for (const r of regs) {
      const waiting = C.find(c => c.state === 'atRegister' && Math.abs(c.x - r.customer.x) < 0.6 && Math.abs(c.z - r.customer.z) < 0.6);
      if (waiting && (this.role === 'cashier' || !manned(r)) && this.free('co' + r.idx)) tasks.push({ pos: r.cashier, kind: 'checkout', target: { t: 'register', idx: r.idx }, key: 'co' + r.idx });
    }
    const waitingFood = C.find(c => c.state === 'waitFood' && c.want);
    const coffeeGoal: Goal = waitingFood ? foodGoal(waitingFood.want!) : foodGoal('coffee');
    // a waiting food order, unless a teammate is already making or carrying it
    const foodCovered = !!waitingFood && others.some(p => p.held?.kind === waitingFood.want || p.held2?.kind === waitingFood.want
      || p.busy?.kind === coffeeGoal.kind);
    const food = waitingFood && (this.role !== 'any' || !foodCovered) && this.free(coffeeGoal.key) ? [coffeeGoal] : [];
    // answering a 「需要支援收銀」: the till / the food order first
    if ((this.team?.assist ?? 0) > 0) { const g = tasks[0] ?? food[0]; if (g) return g; }
    // karens first
    const canGrab = !!s.shift?.abilities.includes('grab') && !me.held && !me.held2;
    const karens = C.filter(c => c.kind !== 'normal' && !c.resolved && c.revealed && c.state !== 'leaving' && !c.flying && !c.held
      // a person dealing with it (standing next to it) keeps it — unless it turned violent or they've been at it for 6 s
      && (c.violent || !personNear(c.x, c.z) || !this.yielding(c.id)));
    for (const k of karens) {
      // proper mode: grab only a karen who has turned violent (self-defence)
      const g = this.karenGoal(k, canGrab && (!this.style.proper || k.violent), cust);
      if (g && this.free(g.key)) return g;
    }
    // restocking covers every product line of the current map (including a fourth 'extra' line), emptiest shelf first;
    // skip a product a person is already carrying a box of, and leave it all to them after their 「我去補貨」 (unless a shelf is bare)
    const cap = shelfCapacity(s.upgrades.shelves);
    const personRestock = (this.team?.humanRestock ?? 0) > 0;
    const restockBelow = (frac: number): Goal[] => PRODUCTS
      .filter(p => s.shelves[p] < cap * frac && s.backstock[p] > 0 && (!personRestock || s.shelves[p] === 0)
        && !people.some(x => x.held?.kind === 'box' && x.held.product === p) && this.free('tb' + p))
      .sort((a, b) => s.shelves[a] - s.shelves[b])
      .map(p => { const cr = CRATES.find(c => c.product === p)!; return { pos: { x: (cr.box.x0 + cr.box.x1) / 2, z: cr.box.z1 + 0.7 }, kind: 'takeBox' as ActKind, target: { t: 'crate', product: p } as Target, key: 'tb' + p }; });
    const restock = restockBelow(0.4);
    /** Nothing urgent: top up any shelf that has room for a whole box. */
    const topUp = restockBelow((cap - BOX_SIZE + 1) / cap);
    const item = nearest(me, s.items.filter(i => i.held.kind === 'box' && this.free('pk' + i.id) && !personNear(i.x, i.z, 1)));
    const personMopping = people.some(p => p.held?.kind === 'mop');
    const clean: Goal[] = s.spills.length >= (personMopping ? 4 : 2) && s.mopsOnRack > 0 && this.free('tm') ? [{ pos: { x: (MOP_RACK.x1) + 0.6, z: (MOP_RACK.z0 + MOP_RACK.z1) / 2 }, kind: 'takeMop', target: { t: 'mop' }, key: 'tm' }] : [];
    const order: Goal[][] =
      this.role === 'stocker' ? [restock, tasks, food, topUp, clean]
        : this.role === 'cleaner' ? [clean, tasks, restock, food]
          : this.role === 'cashier' ? [tasks, food, restock, clean]
            // 'any' (the employee / fill-in bot): the till when nobody else is on it, a food order nobody is making,
            // shelves below 40 %, topping up shelves with room for a whole box, then cleaning
            : [tasks, food, restock, topUp, clean];
    for (const list of order) if (list.length) return list === tasks || list === clean ? list[Math.floor(this.seed * list.length) % list.length] : list[0];
    if (item) return { pos: item, kind: 'pickup', target: { t: 'item', id: item.id }, key: 'pk' + item.id };
    return null;
  }

  /** How this bot would deal with a karen right now (null: nothing to do about it yet). */
  private karenGoal(k: CustomerSnap, canGrab: boolean, cust: (c: CustomerSnap, kind: ActKind) => Goal): Goal | null {
    if (k.kind === 'boss') {
      if (k.phase === 1 && ['queue', 'toRegister', 'atRegister'].includes(k.state)) return cust(k, 'askQueue');
      if (k.phase === 4) return null; // deal with the minions first
      if (canGrab && k.phase !== 1) return cust(k, 'grab'); // walks up; the self-defence hit above stuns him first (he is too heavy otherwise)
      if (k.phase === 2 && k.state === 'complain') return cust(k, 'calm');
      if (k.phase === 3) return cust(k, 'stopFilm');
      return null;
    }
    if (k.kind === 'cutter' && ['queue', 'toRegister', 'atRegister'].includes(k.state)) return cust(k, 'askQueue');
    // 借廁所大隊: only the leader matters (his followers go with him)
    if (k.kind === 'toilet' && k.phase !== 1) return null;
    // 發票對獎魔人 on the way to the 對獎機: walk next to him (he only moves while someone is with him)
    if (k.kind === 'lottery' && k.state === 'toKiosk') return { ...cust(k, 'escort'), key: 'esc' + k.id, wait: true };
    if (canGrab && k.kind !== 'cutter' && (!k.heavy || k.stun > 0)) return cust(k, 'grab');
    if (k.kind === 'lottery' && k.state === 'atRegister') return cust(k, 'escort');
    if (k.kind === 'change' && k.state === 'atRegister') return { ...cust(k, 'exactChange'), opt: changeAnswer(k.look) };
    if (k.kind === 'bagman' && k.state === 'toExit') return bagmanAtDoor(k) ? cust(k, 'stopBag') : { ...cust(k, 'stopBag'), pos: DOOR_WAIT, key: 'bagw' + k.id, wait: true };
    if (k.kind === 'toilet' && (k.state === 'toToilet' || k.state === 'toilet')) return cust(k, 'toiletRule');
    if (k.kind === 'rager' && k.state === 'complain') return cust(k, 'calm');
    if (k.kind === 'streamer' && this.role !== 'cashier') return cust(k, 'stopFilm');
    if (k.kind === 'hog') return cust(k, 'checkBag');
    if (k.kind === 'litterer') return cust(k, 'stopLitter');
    if (k.kind === 'charger' && k.state === 'charge') return cust(k, 'unplug');
    if (k.kind === 'custom' && k.state === 'atRegister') return cust(k, 'repeatOrder');
    if (k.kind === 'fickle' && k.state === 'waitFood') return cust(k, 'recommend');
    if (k.kind === 'tryhard' && k.state === 'tryon') return cust(k, 'limitTry');
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
