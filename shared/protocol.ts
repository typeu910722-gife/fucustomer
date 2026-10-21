// Wire protocol (JSON over WebSocket). The same messages are used by the in-browser solo transport.
import type { KarenKind, Product, UpgradeId } from './constants.ts';
import type { Ability, Food, ShiftResult } from './career.ts';
import type { Outfit } from './shop.ts';

export type Held =
  | { kind: 'box'; product: Product; qty: number }
  | { kind: 'coffee' }
  | { kind: 'meal' }
  | { kind: 'mop' };

export type Phase = 'prep' | 'open' | 'closing' | 'summary';
export type CustomerKind = 'normal' | KarenKind;

export type ActKind =
  | 'checkout' | 'brew' | 'deliver' | 'takeBox' | 'stock' | 'returnBox' | 'takeMop' | 'returnMop'
  | 'clean' | 'calm' | 'coupon' | 'askQueue' | 'stopFilm' | 'checkBag' | 'pickup' | 'heat' | 'grab' | 'stopLitter' | 'unplug' | 'treat' | 'repeatOrder' | 'recommend' | 'limitTry' | 'knock' | 'heckle'
  /** Store-signature karens (sigkarens.ts): main action and the alternative choice. */
  | 'sigAct' | 'sigAlt'
  /** General karens (round 27): 發票對獎魔人, 找零計較姐 (exactChange carries the chosen handful in `opt`), 免費袋子阿伯, 借廁所大隊. */
  | 'escort' | 'countChange' | 'exactChange' | 'stopBag' | 'toiletRule';

/** A target is either a static fixture or a dynamic entity id. */
export type Target =
  | { t: 'register'; idx: number }
  | { t: 'coffee' }
  | { t: 'microwave' }
  | { t: 'crate'; product: Product }
  | { t: 'shelf'; product: Product }
  | { t: 'mop' }
  | { t: 'customer'; id: number }
  | { t: 'spill'; id: number }
  | { t: 'item'; id: number };

export interface StoreSave {
  version: 1;
  day: number;
  money: number;
  rating: number;
  backstock: Record<Product, number>;
  shelves: Record<Product, number>;
  upgrades: Record<UpgradeId, number>;
  totals: { served: number; karens: number; revenue: number };
}

export interface DayStats {
  revenue: number; served: number; angryLeft: number; karensResolved: number; karensFailed: number;
  spillsCleaned: number; tips: number; expenses: number; bonus: number; ratingStart: number;
  ejected: number; maxCombo: number;
  /** Employee day wage charged at tonight's settlement (own store / a clerk hired in free play); part of expenses. */
  wage?: number;
}

// ---- snapshot shapes (server → client) ----
export interface PlayerSnap {
  id: string; name: string; color: number; x: number; z: number; yaw: number; pitch: number;
  held: Held | null; held2: Held | null; connected: boolean; away: boolean; ready: boolean;
  busy: { kind: ActKind; p: number } | null;
  grabbing: number | null; spinCd: number;
  /** This player is raiding the store (friend-store mode). */
  raider?: boolean;
  /** 電腦店員補位: a server-run fill-in clerk. */
  bot?: boolean;
  /** Cosmetics others see (hat / apron / name tag); omitted = default staff look. */
  outfit?: Outfit;
}
export interface CustomerSnap {
  id: number; kind: CustomerKind; x: number; z: number; yaw: number; state: string;
  patience: number; // 0..1
  anger: number; // 0..100 (rager)
  resolved: boolean; revealed: boolean; items: number; want: Food | null; look: number; moving: boolean;
  y: number; held: boolean; flying: boolean; down: number;
  heavy: boolean; vip: boolean; stun: number; violent: boolean; // seconds left lying on the pavement after being thrown out
  phase: number; // boss phase; for 充電霸王 the number of unplugs so far; 借廁所大隊 1 = leader, 2 = follower
  /** 跨年夜: a drunk karen (wobbles). Omitted otherwise. */
  drunk?: boolean;
}
export interface Snapshot {
  t: number; // server time ms
  /** Friend-store raid: score so far and how close the staff is to throwing you out (0..1). */
  raid?: { score: number; watched: number };
  phase: Phase; phaseLeft: number; clock: number; day: number;
  money: number; rating: number; backstock: Record<Product, number>; shelves: Record<Product, number>;
  upgrades: Record<UpgradeId, number>; mopsOnRack: number;
  players: PlayerSnap[]; customers: CustomerSnap[];
  spills: { id: number; x: number; z: number }[];
  items: { id: number; x: number; z: number; held: Held }[];
  pings: { id: number; x: number; z: number; by: string; ttl: number }[];
  dayStats: DayStats; playerCount: number;
  chaos: number; burst: number; combo: number; power: number;
  event: { kind: 'rush' | 'outage'; left: number } | null;
  shift: { mode: 'day' | 'shift'; id: string; title: string; chapter: number; goal: number; length: number; abilities: Ability[]; foods: Food[]; endless: boolean; boss: boolean; staminaMax: number; staminaRegen: number; speed: number;
    /** 特殊營業日 running today ('typhoon' | 'newyear'); omitted on ordinary days. */
    special?: string } ;
  result: ShiftResult | null;
}

export interface LobbyPlayer {
  id: string; name: string; ready: boolean; connected: boolean; color: number; platform: string; outfit?: Outfit; bot?: boolean;
  /** Round-trip time the player's client last reported (ms); omitted for bots and before the first measurement. */
  ping?: number;
  /** This person voted to hand the host role on (the host has been idle for HOST_AFK_S). */
  afkVote?: true;
}
export interface LobbyState {
  code: string; hostId: string; started: boolean; players: LobbyPlayer[]; max: number; day: number;
  /** Store type and difficulty of a multiplayer room (the host can change them in the lobby). */
  map?: string; difficulty?: string;
  /** 電腦店員補位: the host lets server-run bots fill empty slots. */
  bots?: boolean;
  /** The host has sent no input for HOST_AFK_S: the others may vote to hand the host role on. */
  hostAfk?: boolean;
  /** Votes so far / votes needed (a majority of the connected people other than the host); set while hostAfk. */
  afkVotes?: number; afkNeed?: number;
}

// ---- messages ----
export type ClientMsg =
  | { type: 'hello'; v: number; platform: string }
  | { type: 'create'; name: string; save?: StoreSave | null; map?: string; difficulty?: string; outfit?: Outfit }
  | { type: 'join'; code: string; name: string; token?: string; outfit?: Outfit }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'lobbyCfg'; map?: string; difficulty?: string; bots?: boolean }
  | { type: 'input'; x: number; z: number; yaw: number; pitch: number; seq: number }
  /** opt: extra choice for some actions (exactChange: which handful of coins, 0–2, or -1 = ran out of time). */
  | { type: 'act'; rid: string; kind: ActKind; target: Target; opt?: number }
  | { type: 'drop'; rid: string }
  | { type: 'throw'; rid: string; yaw: number; pitch: number }
  | { type: 'spin'; rid: string }
  | { type: 'ultimate'; rid: string }
  | { type: 'hit'; rid: string; id: number }
  | { type: 'endShift' }
  | { type: 'buy'; rid: string; item: string; level?: number }
  | { type: 'ping'; x: number; z: number }
  | { type: 'quick'; msg: number }
  | { type: 'bg'; away: boolean }
  | { type: 'leave' }
  | { type: 'pause'; paused: boolean }
  /** Host only: remove a person from the room (lobby or game). */
  | { type: 'kick'; id: string }
  /** Host only: hand the host role to another connected person. */
  | { type: 'host'; id: string }
  /** Host only (multiplayer business days, lobby or mid-shift): add a 電腦店員 (within MAX_FILL_BOTS / free slots) or remove one. */
  | { type: 'bot'; op: 'add' | 'remove'; id?: string }
  /** The host has been idle for HOST_AFK_S: vote (yes) or withdraw (no) to hand the host role on; majority wins. */
  | { type: 'voteHost'; yes: boolean }
  /** rtt: the client's last measured round trip (ms), shown next to its name in the lobby. */
  | { type: 'hb'; t: number; rtt?: number };

export type GameEvent =
  /** karen/kid/ok: set when the toast reports a karen being dealt with (kind, customer id, success) — older clients ignore them. */
  | { e: 'toast'; text: string; tone?: 'good' | 'bad' | 'info'; karen?: string; kid?: number; ok?: boolean }
  | { e: 'sfx'; name: string; x?: number; z?: number }
  | { e: 'money'; amount: number; x: number; z: number }
  | { e: 'karen'; kind: KarenKind; id: number }
  /** id / msg: sender and preset index (speech bubble over the sender); older clients only read from + text. */
  | { e: 'quick'; from: string; text: string; id?: string; msg?: number }
  | { e: 'phase'; phase: Phase; day: number }
  | { e: 'hint'; text: string }
  /** report (hit only): this smack will bring the police (client plays a siren sting) — older clients ignore it. */
  | { e: 'fx'; name: 'eject' | 'ultimate' | 'spin' | 'throw' | 'mistake' | 'impact' | 'hit' | 'shove' | 'fireworks'; x: number; z: number; combo?: number; by?: string; report?: boolean };

export type ServerMsg =
  | { type: 'welcome'; playerId: string; token: string; code: string; reconnected: boolean; solo: boolean }
  | { type: 'lobby'; lobby: LobbyState }
  | { type: 'snap'; s: Snapshot }
  | { type: 'events'; list: GameEvent[] }
  | { type: 'actResult'; rid: string; ok: boolean; reason?: string }
  /** kind: 'night' = the nightly settlement; 'purchase' = something bought between days (older servers omit it = night). */
  | { type: 'save'; save: StoreSave; kind?: 'night' | 'purchase' }
  | { type: 'error'; code: string; message: string }
  | { type: 'closed'; reason: string }
  | { type: 'hb'; t: number };
