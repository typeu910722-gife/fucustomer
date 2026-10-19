// Wire protocol (JSON over WebSocket). The same messages are used by the in-browser solo transport.
import type { KarenKind, Product, UpgradeId } from './constants.ts';

export type Held =
  | { kind: 'box'; product: Product; qty: number }
  | { kind: 'coffee' }
  | { kind: 'mop' };

export type Phase = 'prep' | 'open' | 'closing' | 'summary';
export type CustomerKind = 'normal' | KarenKind;

export type ActKind =
  | 'checkout' | 'brew' | 'deliver' | 'takeBox' | 'stock' | 'returnBox' | 'takeMop' | 'returnMop'
  | 'clean' | 'calm' | 'coupon' | 'askQueue' | 'stopFilm' | 'checkBag' | 'pickup';

/** A target is either a static fixture or a dynamic entity id. */
export type Target =
  | { t: 'register'; idx: number }
  | { t: 'coffee' }
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
}

// ---- snapshot shapes (server → client) ----
export interface PlayerSnap {
  id: string; name: string; color: number; x: number; z: number; yaw: number; pitch: number;
  held: Held | null; connected: boolean; away: boolean; ready: boolean;
  busy: { kind: ActKind; p: number } | null;
}
export interface CustomerSnap {
  id: number; kind: CustomerKind; x: number; z: number; yaw: number; state: string;
  patience: number; // 0..1
  anger: number; // 0..100 (rager)
  resolved: boolean; revealed: boolean; items: number; wantsCoffee: boolean; look: number; moving: boolean;
}
export interface Snapshot {
  t: number; // server time ms
  phase: Phase; phaseLeft: number; clock: number; day: number;
  money: number; rating: number; backstock: Record<Product, number>; shelves: Record<Product, number>;
  upgrades: Record<UpgradeId, number>; mopsOnRack: number;
  players: PlayerSnap[]; customers: CustomerSnap[];
  spills: { id: number; x: number; z: number }[];
  items: { id: number; x: number; z: number; held: Held }[];
  pings: { id: number; x: number; z: number; by: string; ttl: number }[];
  dayStats: DayStats; playerCount: number;
}

export interface LobbyPlayer { id: string; name: string; ready: boolean; connected: boolean; color: number; platform: string }
export interface LobbyState {
  code: string; hostId: string; started: boolean; players: LobbyPlayer[]; max: number; day: number;
}

// ---- messages ----
export type ClientMsg =
  | { type: 'hello'; v: number; platform: string }
  | { type: 'create'; name: string; save?: StoreSave | null }
  | { type: 'join'; code: string; name: string; token?: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'input'; x: number; z: number; yaw: number; pitch: number; seq: number }
  | { type: 'act'; rid: string; kind: ActKind; target: Target }
  | { type: 'drop'; rid: string }
  | { type: 'buy'; rid: string; item: string; level?: number }
  | { type: 'ping'; x: number; z: number }
  | { type: 'quick'; msg: number }
  | { type: 'bg'; away: boolean }
  | { type: 'leave' }
  | { type: 'pause'; paused: boolean }
  | { type: 'hb'; t: number };

export type GameEvent =
  | { e: 'toast'; text: string; tone?: 'good' | 'bad' | 'info' }
  | { e: 'sfx'; name: string; x?: number; z?: number }
  | { e: 'money'; amount: number; x: number; z: number }
  | { e: 'karen'; kind: KarenKind; id: number }
  | { e: 'quick'; from: string; text: string }
  | { e: 'phase'; phase: Phase; day: number };

export type ServerMsg =
  | { type: 'welcome'; playerId: string; token: string; code: string; reconnected: boolean; solo: boolean }
  | { type: 'lobby'; lobby: LobbyState }
  | { type: 'snap'; s: Snapshot }
  | { type: 'events'; list: GameEvent[] }
  | { type: 'actResult'; rid: string; ok: boolean; reason?: string }
  | { type: 'save'; save: StoreSave }
  | { type: 'error'; code: string; message: string }
  | { type: 'closed'; reason: string }
  | { type: 'hb'; t: number };
