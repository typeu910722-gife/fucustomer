// Transport-agnostic room: lobby, membership, reconnect, host transfer and the game loop.
// Used by the dedicated server (WebSocket connections) and by solo play (in-memory connection).
import {
  MAX_PLAYERS, PLAYER_COLORS, QUICK_MESSAGES, RECONNECT_GRACE_GAME_S, RECONNECT_GRACE_LOBBY_S, SNAPSHOT_RATE, TICK_RATE,
} from './constants.ts';
import type { ClientMsg, GameEvent, LobbyState, ServerMsg, StoreSave, Target } from './protocol.ts';
import {
  World, addPing, addPlayer, applyInput, createWorld, playerDisconnected, removePlayer, requestAct, requestBuy, requestDrop,
  finishShift, requestSpin, requestThrow, requestUltimate, sanitizeSave, setReady, snapshot, tick,
} from './sim.ts';
import type { ShiftConfig } from './career.ts';

export interface Conn { send(msg: ServerMsg): void; close(reason: string): void }

export interface Member {
  playerId: string; name: string; token: string; conn: Conn | null; ready: boolean; connected: boolean;
  disconnectedAt: number; color: number; platform: string; joinOrder: number; lastQuickAt: number; lastPingAt: number;
}

export interface RoomCheckpoint {
  code: string; save: StoreSave; hostId: string; started: boolean; savedAt: number;
  members: { playerId: string; name: string; token: string; color: number; platform: string; joinOrder: number }[];
}

export interface RoomOptions {
  solo?: boolean;
  now?: () => number;
  randomId?: (len: number) => string;
  onCheckpoint?: (cp: RoomCheckpoint) => void;
  log?: (msg: string) => void;
  /** Career shift config (solo). Omit for the multiplayer business-day loop. */
  shift?: ShiftConfig;
  seed?: number;
}

const ACT_KINDS = new Set(['checkout', 'brew', 'deliver', 'takeBox', 'stock', 'returnBox', 'takeMop', 'returnMop', 'clean', 'calm', 'coupon', 'askQueue', 'stopFilm', 'checkBag', 'pickup', 'heat', 'grab', 'stopLitter', 'unplug', 'treat']);
const TARGET_KINDS = new Set(['register', 'coffee', 'microwave', 'crate', 'shelf', 'mop', 'customer', 'spill', 'item']);

function defaultRandomId(len: number) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = new Uint32Array(len);
  globalThis.crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += a[buf[i] % a.length];
  return s;
}

export function sanitizeName(n: unknown, fallback: string) {
  if (typeof n !== 'string') return fallback;
  // strip control chars, keep it short
  // eslint-disable-next-line no-control-regex
  const s = n.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || fallback;
}

function validTarget(t: unknown): t is Target {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (typeof o.t !== 'string' || !TARGET_KINDS.has(o.t)) return false;
  if ('id' in o && typeof o.id !== 'number') return false;
  if ('idx' in o && typeof o.idx !== 'number') return false;
  return true;
}

export class Room {
  readonly code: string;
  readonly solo: boolean;
  members = new Map<string, Member>();
  hostId = '';
  started = false;
  world: World | null = null;
  save: StoreSave;
  paused = false;
  closed = false;
  emptySince = 0;
  private tickCount = 0;
  private joinCounter = 0;
  private now: () => number;
  private rid: (len: number) => string;
  private opts: RoomOptions;

  constructor(code: string, save: StoreSave | null | undefined, opts: RoomOptions = {}) {
    this.code = code;
    this.solo = !!opts.solo;
    this.save = sanitizeSave(save);
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.rid = opts.randomId ?? defaultRandomId;
  }

  static restore(cp: RoomCheckpoint, opts: RoomOptions = {}) {
    const r = new Room(cp.code, cp.save, opts);
    r.hostId = cp.hostId;
    const now = r.now();
    for (const m of cp.members) {
      r.members.set(m.playerId, {
        ...m, conn: null, ready: false, connected: false, disconnectedAt: now, lastQuickAt: 0, lastPingAt: 0,
      });
      r.joinCounter = Math.max(r.joinCounter, m.joinOrder + 1);
    }
    if (cp.started) {
      r.started = true;
      r.world = createWorld(r.save); // resume from the start of the checkpointed day
    }
    r.emptySince = now;
    r.log(`restored room ${cp.code} (day ${cp.save.day}, ${cp.members.length} members)`);
    return r;
  }

  checkpoint(): RoomCheckpoint {
    return {
      code: this.code, save: this.save, hostId: this.hostId, started: this.started, savedAt: this.now(),
      members: [...this.members.values()].map(m => ({ playerId: m.playerId, name: m.name, token: m.token, color: m.color, platform: m.platform, joinOrder: m.joinOrder })),
    };
  }

  private log(s: string) { this.opts.log?.(s); }
  get connectedCount() { let n = 0; for (const m of this.members.values()) if (m.connected) n++; return n; }

  /** Join or reconnect. Returns the member or an error code. */
  join(conn: Conn, name: unknown, token: unknown, platform = 'web'): { ok: true; member: Member } | { ok: false; code: string; message: string } {
    if (this.closed) return { ok: false, code: 'room_closed', message: '房間已關閉' };
    if (typeof token === 'string' && token) {
      for (const m of this.members.values()) {
        if (m.token === token) {
          if (m.conn && m.conn !== conn) m.conn.close('replaced');
          m.conn = conn; m.connected = true; m.platform = platform;
          const wp = this.world?.players.get(m.playerId);
          if (this.world && !wp) addPlayer(this.world, m.playerId, m.name, m.color);
          else if (wp) { wp.connected = true; wp.away = false; }
          conn.send({ type: 'welcome', playerId: m.playerId, token: m.token, code: this.code, reconnected: true, solo: this.solo });
          this.broadcastLobby();
          this.sendSnapshotTo(m);
          this.broadcastEvents([{ e: 'toast', text: `🔌 ${m.name} 重新連線`, tone: 'info' }]);
          this.log(`${this.code}: ${m.name} reconnected`);
          return { ok: true, member: m };
        }
      }
    }
    if (this.members.size >= MAX_PLAYERS) return { ok: false, code: 'room_full', message: `房間已滿（最多 ${MAX_PLAYERS} 人）` };
    const order = this.joinCounter++;
    const used = new Set([...this.members.values()].map(m => m.color));
    const color = PLAYER_COLORS.find(c => !used.has(c)) ?? PLAYER_COLORS[order % PLAYER_COLORS.length];
    const m: Member = {
      playerId: 'p' + this.rid(8), name: sanitizeName(name, `店員${order + 1}`), token: this.rid(32), conn,
      ready: false, connected: true, disconnectedAt: 0, color, platform, joinOrder: order, lastQuickAt: 0, lastPingAt: 0,
    };
    this.members.set(m.playerId, m);
    if (!this.hostId || !this.members.get(this.hostId)) this.hostId = m.playerId;
    if (this.world) addPlayer(this.world, m.playerId, m.name, m.color);
    conn.send({ type: 'welcome', playerId: m.playerId, token: m.token, code: this.code, reconnected: false, solo: this.solo });
    this.broadcastLobby();
    if (this.started) {
      this.sendSnapshotTo(m);
      this.broadcastEvents([{ e: 'toast', text: `👋 ${m.name} 加入營業`, tone: 'info' }]);
    }
    this.log(`${this.code}: ${m.name} joined (${this.members.size}/${MAX_PLAYERS})`);
    return { ok: true, member: m };
  }

  /** Connection lost (not an intentional leave). The slot is kept for the reconnect grace period. */
  disconnect(conn: Conn) {
    for (const m of this.members.values()) {
      if (m.conn !== conn) continue;
      m.conn = null; m.connected = false; m.disconnectedAt = this.now(); m.ready = false;
      if (this.world) playerDisconnected(this.world, m.playerId);
      this.log(`${this.code}: ${m.name} disconnected`);
      this.transferHostIfNeeded();
      this.broadcastLobby();
      this.broadcastEvents([{ e: 'toast', text: `📶 ${m.name} 斷線，保留位置 ${this.started ? RECONNECT_GRACE_GAME_S : RECONNECT_GRACE_LOBBY_S} 秒`, tone: 'bad' }]);
    }
  }

  leave(playerId: string, reason = 'left') {
    const m = this.members.get(playerId);
    if (!m) return;
    this.members.delete(playerId);
    if (this.world) removePlayer(this.world, playerId);
    m.conn?.close(reason);
    this.log(`${this.code}: ${m.name} removed (${reason})`);
    this.transferHostIfNeeded();
    this.broadcastLobby();
    this.broadcastEvents([{ e: 'toast', text: `🚪 ${m.name} 離開了房間`, tone: 'info' }]);
  }

  private transferHostIfNeeded() {
    const host = this.members.get(this.hostId);
    if (host && host.connected) return;
    const candidates = [...this.members.values()].filter(m => m.connected).sort((a, b) => a.joinOrder - b.joinOrder);
    if (!candidates.length) return; // keep the old host id while nobody is online
    this.hostId = candidates[0].playerId;
    this.log(`${this.code}: host → ${candidates[0].name}`);
    this.broadcastEvents([{ e: 'toast', text: `👑 房主轉移給 ${candidates[0].name}（遊戲在伺服器上繼續，不中斷）`, tone: 'info' }]);
  }

  handle(playerId: string, msg: ClientMsg) {
    const m = this.members.get(playerId);
    if (!m || !msg || typeof msg !== 'object') return;
    const w = this.world;
    switch (msg.type) {
      case 'ready':
        if (!this.started) { m.ready = !!msg.ready; this.broadcastLobby(); }
        else if (w) setReady(w, playerId, !!msg.ready);
        break;
      case 'start':
        if (this.started || playerId !== this.hostId) return;
        if (![...this.members.values()].filter(x => x.connected).every(x => x.ready || x.playerId === this.hostId)) {
          m.conn?.send({ type: 'error', code: 'not_ready', message: '還有玩家沒有準備' });
          return;
        }
        this.startGame();
        break;
      case 'input':
        if (w) applyInput(w, playerId, msg.x, msg.z, msg.yaw, msg.pitch);
        break;
      case 'act':
        if (!w || typeof msg.rid !== 'string' || !ACT_KINDS.has(msg.kind) || !validTarget(msg.target)) return;
        if (this.paused) return;
        requestAct(w, playerId, msg.rid.slice(0, 40), msg.kind, msg.target);
        this.flushResults();
        break;
      case 'drop':
        if (w && typeof msg.rid === 'string') requestDrop(w, playerId, msg.rid.slice(0, 40));
        break;
      case 'throw':
        if (w && typeof msg.rid === 'string' && !this.paused) requestThrow(w, playerId, msg.rid.slice(0, 40), Number(msg.yaw), Number(msg.pitch));
        break;
      case 'spin':
        if (w && typeof msg.rid === 'string' && !this.paused) { requestSpin(w, playerId, msg.rid.slice(0, 40)); this.flushResults(); }
        break;
      case 'ultimate':
        if (w && typeof msg.rid === 'string' && !this.paused) { requestUltimate(w, playerId, msg.rid.slice(0, 40)); this.flushResults(); }
        break;
      case 'buy':
        if (!w || typeof msg.rid !== 'string' || typeof msg.item !== 'string') return;
        requestBuy(w, playerId, msg.rid.slice(0, 40), msg.item, typeof msg.level === 'number' ? msg.level : undefined);
        this.flushResults();
        break;
      case 'ping': {
        const t = this.now();
        if (!w || t - m.lastPingAt < 700) return;
        m.lastPingAt = t;
        addPing(w, playerId, msg.x, msg.z);
        break;
      }
      case 'quick': {
        const t = this.now();
        if (t - m.lastQuickAt < 1200 || typeof msg.msg !== 'number') return;
        const text = QUICK_MESSAGES[msg.msg];
        if (!text) return;
        m.lastQuickAt = t;
        this.broadcastEvents([{ e: 'quick', from: m.name, text }]);
        break;
      }
      case 'bg': {
        const wp = w?.players.get(playerId);
        if (wp) wp.away = !!msg.away;
        break;
      }
      case 'endShift':
        if (this.solo && w && w.cfg.endless && w.phase !== 'summary') finishShift(w, '');
        break;
      case 'pause':
        if (this.solo) this.paused = !!msg.paused; // multiplayer menus never pause the shared world
        break;
      case 'leave':
        this.leave(playerId, 'left');
        break;
      case 'hb':
        m.conn?.send({ type: 'hb', t: msg.t });
        break;
    }
  }

  startGame() {
    this.started = true;
    this.world = createWorld(this.save, this.opts.seed ?? Date.now(), this.opts.shift);
    for (const m of [...this.members.values()].sort((a, b) => a.joinOrder - b.joinOrder)) {
      const p = addPlayer(this.world, m.playerId, m.name, m.color);
      p.connected = m.connected;
    }
    this.opts.onCheckpoint?.(this.checkpoint());
    this.broadcastLobby();
    this.broadcastEvents([{ e: 'phase', phase: 'prep', day: this.world.day }]);
    this.log(`${this.code}: game started with ${this.members.size} players`);
  }

  /** Advance one simulation tick. */
  update(dt = 1 / TICK_RATE) {
    const now = this.now();
    // reconnect grace
    for (const m of [...this.members.values()]) {
      if (m.connected) continue;
      const grace = (this.started ? RECONNECT_GRACE_GAME_S : RECONNECT_GRACE_LOBBY_S) * 1000;
      if (now - m.disconnectedAt > grace) this.leave(m.playerId, 'timeout');
    }
    if (this.connectedCount === 0) { if (!this.emptySince) this.emptySince = now; } else this.emptySince = 0;
    if (!this.world || this.paused) return;
    tick(this.world, dt);
    this.flushResults();
    if (this.world.events.length) { this.broadcastEvents(this.world.events); this.world.events = []; }
    if (this.world.saveOut) {
      this.save = this.world.saveOut; this.world.saveOut = null;
      this.broadcast({ type: 'save', save: this.save });
      this.opts.onCheckpoint?.(this.checkpoint());
    }
    this.tickCount++;
    if (this.tickCount % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) {
      const s = snapshot(this.world, now);
      for (const mm of this.members.values()) if (mm.conn) mm.conn.send({ type: 'snap', s });
    }
  }

  private flushResults() {
    const w = this.world;
    if (!w || !w.results.length) return;
    for (const r of w.results) this.members.get(r.playerId)?.conn?.send({ type: 'actResult', rid: r.rid, ok: r.ok, reason: r.reason });
    w.results = [];
  }

  private sendSnapshotTo(m: Member) {
    if (this.world && m.conn) m.conn.send({ type: 'snap', s: snapshot(this.world, this.now()) });
  }

  lobbyState(): LobbyState {
    return {
      code: this.code, hostId: this.hostId, started: this.started, max: MAX_PLAYERS, day: this.world?.day ?? this.save.day,
      players: [...this.members.values()].sort((a, b) => a.joinOrder - b.joinOrder)
        .map(m => ({ id: m.playerId, name: m.name, ready: m.ready, connected: m.connected, color: m.color, platform: m.platform })),
    };
  }

  broadcast(msg: ServerMsg) { for (const m of this.members.values()) m.conn?.send(msg); }
  broadcastLobby() { this.broadcast({ type: 'lobby', lobby: this.lobbyState() }); }
  broadcastEvents(list: GameEvent[]) {
    if (list.length) this.broadcast({ type: 'events', list: [...list] });
  }

  /** Server shutdown: persist and tell clients they can rejoin with the same code later. */
  shutdown(reason: string) {
    this.opts.onCheckpoint?.(this.checkpoint());
    this.broadcast({ type: 'closed', reason });
    for (const m of this.members.values()) m.conn?.close(reason);
    this.closed = true;
  }
}
