// Transport-agnostic room: lobby, membership, reconnect, host transfer and the game loop.
// Used by the dedicated server (WebSocket connections) and by solo play (in-memory connection).
import {
  HOST_ACTION_BURST, HOST_ACTION_WINDOW_MS, HOST_AFK_S, MAX_FILL_BOTS, MAX_PLAYERS, PLAYER_COLORS, QUICK_BURST, QUICK_MESSAGES, QUICK_MIN_GAP_MS, QUICK_WINDOW_MS, RECONNECT_GRACE_GAME_S, RECONNECT_GRACE_LOBBY_S, SNAPSHOT_RATE, TICK_RATE,
} from './constants.ts';
import type { ClientMsg, GameEvent, LobbyState, ServerMsg, Snapshot, StoreSave, Target } from './protocol.ts';
import { Bot, BotTeam, botMessages } from './bot.ts';
import {
  World, addPing, addPlayer, applyInput, createWorld, playerDisconnected, removePlayer, requestAct, requestBuy, requestDrop,
  finishShift, requestSpin, requestHit, requestThrow, requestUltimate, sanitizeSave, setReady, snapshot, tick, dayConfig,
} from './sim.ts';
import type { ShiftConfig } from './career.ts';
import { applyMap } from './map.ts';
import { getMap } from './maps/index.ts';
import { Difficulty, isDifficulty, withDifficulty } from './difficulty.ts';
import { Outfit, sanitizeOutfit } from './shop.ts';

export interface Conn { send(msg: ServerMsg): void; close(reason: string): void }

export interface Member {
  playerId: string; name: string; token: string; conn: Conn | null; ready: boolean; connected: boolean;
  disconnectedAt: number; color: number; platform: string; joinOrder: number; lastQuickAt: number; lastPingAt: number;
  /** Cosmetics (hat / apron / name tag) the player chose; purely visual. */
  outfit?: Outfit;
  /** 電腦店員補位: a server-run fill-in clerk (not a person: never host, not counted as a player, not checkpointed). */
  bot?: boolean;
  /** Times of this player's recent quick messages / emotes (server-side rate limit). */
  quickTimes?: number[];
  /** When the "too many messages" hint was last sent to this player. */
  quickWarnAt?: number;
  /** Round trip the player's client last reported (ms), shown in the lobby and the in-shift team list. */
  rtt?: number;
  /** Last time this person did something (moved / looked around, acted, readied…), ms room clock: drives the host-AFK vote. */
  activeAt?: number;
  /** Last position / view sent, to tell real movement from the steady stream of unchanged inputs. */
  lastIn?: [number, number, number, number];
  /** Recent host tool uses (kick / hand over / bot), for the HOST_ACTION_BURST rate limit. */
  adminTimes?: number[];
  /** Voted to hand the host role on while the host is idle. */
  afkVote?: boolean;
  voteAt?: number;
}

const BOT_NAMES = ['🤖小陳', '🤖阿美', '🤖阿豪', '🤖佳佳'];

export interface RoomCheckpoint {
  code: string; save: StoreSave; hostId: string; started: boolean; savedAt: number; map?: string; difficulty?: Difficulty;
  /** 電腦店員補位 switched on (the bots themselves are not saved; they are re-created on restore). */
  bots?: boolean;
  /** How many bots the host wants (lobby switch = MAX_FILL_BOTS, or set one by one mid-shift). */
  botWant?: number;
  members: { playerId: string; name: string; token: string; color: number; platform: string; joinOrder: number; outfit?: Outfit }[];
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
  /** Store type for the business-day loop (multiplayer rooms). Career shifts carry their own. */
  map?: string;
  /** Difficulty of the business-day loop (multiplayer rooms). */
  difficulty?: Difficulty;
  /** Free play with a hired clerk: day wage charged at each nightly settlement (own store passes it in `shift`). */
  staffWage?: number;
  /** Host-AFK threshold (ms); defaults to HOST_AFK_S. Tests shorten it. */
  hostAfkMs?: number;
}

const ACT_KINDS = new Set(['checkout', 'brew', 'deliver', 'takeBox', 'stock', 'returnBox', 'takeMop', 'returnMop', 'clean', 'calm', 'coupon', 'askQueue', 'stopFilm', 'checkBag', 'pickup', 'heat', 'grab', 'stopLitter', 'unplug', 'treat', 'repeatOrder', 'recommend', 'limitTry', 'knock', 'heckle', 'sigAct', 'sigAlt']);
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
  /** This room's store type. The map state is shared by the whole process, so every entry point switches to it first. */
  mapId: string;
  /** 電腦店員補位: the host lets bots fill empty slots (multiplayer business days only). */
  botFill = false;
  /** How many fill-in bots the host wants (capped by MAX_FILL_BOTS and the free slots). */
  botWant = 0;
  /** Host-AFK state last announced (lobby broadcast when it flips). */
  private afkShown = false;
  private lastAfkCheck = 0;
  private bots = new Map<string, { bot: Bot; snap: Snapshot | null; rid: number; assistUntil: number }>();
  /** A person's 「我去補貨」: until then the bots leave restocking to the people (ms, room clock). */
  private humanRestockUntil = 0;
  /** Lobby pings changed since the last lobby broadcast. */
  private lobbyDirty = false;
  private lastLobbyAt = 0;

  constructor(code: string, save: StoreSave | null | undefined, opts: RoomOptions = {}) {
    this.code = code;
    this.solo = !!opts.solo;
    this.save = sanitizeSave(save);
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.rid = opts.randomId ?? defaultRandomId;
    this.mapId = getMap(opts.shift?.map ?? opts.map).id;
    this.difficulty = isDifficulty(opts.difficulty) ? opts.difficulty : 'normal';
  }
  difficulty: Difficulty;
  /** Business-day config for this room's map and difficulty (career shifts use their own config). */
  private dayCfg(): ShiftConfig {
    const base = this.opts.shift ?? withDifficulty(dayConfig(), this.difficulty);
    return this.opts.staffWage ? { ...base, staffWage: this.opts.staffWage } : base;
  }
  private useMap() { applyMap(this.mapId); }

  static restore(cp: RoomCheckpoint, opts: RoomOptions = {}) {
    const r = new Room(cp.code, cp.save, { ...opts, map: cp.map ?? opts.map, difficulty: cp.difficulty ?? opts.difficulty });
    r.hostId = cp.hostId;
    r.botFill = !!cp.bots && !r.solo && !opts.shift;
    r.botWant = r.botFill ? Math.max(0, Math.min(MAX_FILL_BOTS, cp.botWant ?? MAX_FILL_BOTS)) : 0;
    const now = r.now();
    for (const m of cp.members) {
      r.members.set(m.playerId, {
        ...m, conn: null, ready: false, connected: false, disconnectedAt: now, lastQuickAt: 0, lastPingAt: 0, outfit: sanitizeOutfit(m.outfit),
      });
      r.joinCounter = Math.max(r.joinCounter, m.joinOrder + 1);
    }
    if (cp.started) {
      r.started = true;
      r.useMap();
      r.world = createWorld(r.save, Date.now(), r.dayCfg()); // resume from the start of the checkpointed day
    }
    r.syncBots(false);
    r.emptySince = now;
    r.log(`restored room ${cp.code} (day ${cp.save.day}, ${cp.members.length} members)`);
    return r;
  }

  checkpoint(): RoomCheckpoint {
    return {
      code: this.code, save: this.save, hostId: this.hostId, started: this.started, savedAt: this.now(), map: this.mapId, difficulty: this.difficulty,
      bots: this.botFill || undefined, botWant: this.botFill ? this.botWant : undefined,
      members: [...this.members.values()].filter(m => !m.bot).map(m => ({ playerId: m.playerId, name: m.name, token: m.token, color: m.color, platform: m.platform, joinOrder: m.joinOrder, outfit: m.outfit })),
    };
  }

  private log(s: string) { this.opts.log?.(s); }
  /** Connected people (fill-in bots are not players). */
  get connectedCount() { let n = 0; for (const m of this.members.values()) if (m.connected && !m.bot) n++; return n; }
  /** People holding a slot (connected or within their reconnect grace). */
  get humanCount() { let n = 0; for (const m of this.members.values()) if (!m.bot) n++; return n; }
  get botCount() { return this.bots.size; }

  /** 電腦店員補位: add or remove bots so they fill free slots (up to MAX_FILL_BOTS) while at least one person is here. */
  syncBots(announce = true) {
    const humans = this.humanCount;
    const target = this.botFill && humans > 0 && !this.solo && !this.opts.shift ? Math.max(0, Math.min(this.botWant, MAX_FILL_BOTS, MAX_PLAYERS - humans)) : 0;
    let changed = false;
    while (this.bots.size > target) { this.removeBot([...this.bots.keys()].pop()!, announce); changed = true; }
    while (this.bots.size < target) { this.addBot(announce); changed = true; }
    return changed;
  }

  private addBot(announce: boolean) {
    const used = new Set([...this.members.values()].map(m => m.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? `🤖店員${this.bots.size + 1}`;
    const usedColors = new Set([...this.members.values()].map(m => m.color));
    const order = this.joinCounter++;
    const st = { bot: new Bot('any', (order * 0.37) % 1), snap: null as Snapshot | null, rid: 0, assistUntil: 0 };
    const m: Member = {
      playerId: 'b' + this.rid(8), name, token: this.rid(32), bot: true, ready: true, connected: true, disconnectedAt: 0,
      color: PLAYER_COLORS.find(c => !usedColors.has(c)) ?? PLAYER_COLORS[order % PLAYER_COLORS.length], platform: 'bot', joinOrder: order, lastQuickAt: 0, lastPingAt: 0,
      conn: { send: msg => { if (msg.type === 'snap') st.snap = msg.s; }, close: () => {} },
    };
    this.members.set(m.playerId, m);
    this.bots.set(m.playerId, st);
    if (this.world) addPlayer(this.world, m.playerId, m.name, m.color).bot = true;
    if (announce && this.started) this.broadcastEvents([{ e: 'toast', text: `🤖 電腦店員 ${name} 來補位`, tone: 'info' }]);
    this.log(`${this.code}: bot ${name} added`);
  }

  private removeBot(id: string, announce: boolean) {
    const m = this.members.get(id);
    this.members.delete(id); this.bots.delete(id);
    if (this.world) removePlayer(this.world, id);
    if (m && announce && this.started) this.broadcastEvents([{ e: 'toast', text: `🤖 ${m.name} 讓出位置`, tone: 'info' }]);
  }

  /** The bots look at their latest snapshot and send the same messages a client would. */
  private driveBots(dt: number) {
    if (!this.world || this.paused) return;
    const now = this.now();
    // the bots split the work: each one sees which tasks the others hold (updated as each bot decides)
    const claims = new Map<string, string>();
    for (const [id, st] of this.bots) for (const k of st.bot.claimKeys()) if (!claims.has(k)) claims.set(k, id);
    for (const [id, st] of [...this.bots]) {
      if (!st.snap) continue;
      const me = st.snap.players.find(p => p.id === id); if (!me) continue;
      for (const [k, owner] of [...claims]) if (owner === id) claims.delete(k);
      const team: BotTeam = { claims, humanRestock: Math.max(0, (this.humanRestockUntil - now) / 1000), assist: Math.max(0, (st.assistUntil - now) / 1000) };
      const out = st.bot.update(st.snap, me, dt, team);
      for (const k of st.bot.claimKeys()) if (!claims.has(k)) claims.set(k, id);
      for (const msg of botMessages(out, () => 'bot' + st.rid++)) {
        if (!this.bots.has(id)) break;
        this.handle(id, msg);
      }
    }
  }

  /** Join or reconnect. Returns the member or an error code. */
  join(conn: Conn, name: unknown, token: unknown, platform = 'web', outfit?: unknown): { ok: true; member: Member } | { ok: false; code: string; message: string } {
    if (this.closed) return { ok: false, code: 'room_closed', message: '房間已關閉' };
    this.useMap();
    if (typeof token === 'string' && token) {
      for (const m of this.members.values()) {
        if (m.token === token) {
          if (m.conn && m.conn !== conn) m.conn.close('replaced');
          m.conn = conn; m.connected = true; m.platform = platform; m.activeAt = this.now();
          const fit = sanitizeOutfit(outfit); if (fit) m.outfit = fit;
          const wp = this.world?.players.get(m.playerId);
          if (this.world && !wp) addPlayer(this.world, m.playerId, m.name, m.color).outfit = m.outfit;
          else if (wp) { wp.connected = true; wp.away = false; if (fit) wp.outfit = fit; } // (a reconnect with an outfit used to stay "disconnected")
          conn.send({ type: 'welcome', playerId: m.playerId, token: m.token, code: this.code, reconnected: true, solo: this.solo });
          this.broadcastLobby();
          this.sendSnapshotTo(m);
          this.broadcastEvents([{ e: 'toast', text: `🔌 ${m.name} 回到店裡了`, tone: 'info' }]);
          this.log(`${this.code}: ${m.name} reconnected`);
          return { ok: true, member: m };
        }
      }
    }
    // a person always beats a fill-in bot to the last slot
    if (this.members.size >= MAX_PLAYERS && this.bots.size) this.removeBot([...this.bots.keys()].pop()!, true);
    if (this.members.size >= MAX_PLAYERS) return { ok: false, code: 'room_full', message: `房間已滿（最多 ${MAX_PLAYERS} 人）` };
    const order = this.joinCounter++;
    const used = new Set([...this.members.values()].map(m => m.color));
    const color = PLAYER_COLORS.find(c => !used.has(c)) ?? PLAYER_COLORS[order % PLAYER_COLORS.length];
    const m: Member = {
      playerId: 'p' + this.rid(8), name: sanitizeName(name, `店員${order + 1}`), token: this.rid(32), conn,
      ready: false, connected: true, disconnectedAt: 0, color, platform, joinOrder: order, lastQuickAt: 0, lastPingAt: 0,
      outfit: sanitizeOutfit(outfit), activeAt: this.now(),
    };
    this.members.set(m.playerId, m);
    if (!this.hostId || !this.members.get(this.hostId)) this.hostId = m.playerId;
    if (this.world) addPlayer(this.world, m.playerId, m.name, m.color).outfit = m.outfit;
    conn.send({ type: 'welcome', playerId: m.playerId, token: m.token, code: this.code, reconnected: false, solo: this.solo });
    this.syncBots();
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
    if (m.bot) this.bots.delete(playerId);
    else this.syncBots(); // a free slot gets a bot again; the last person leaving takes the bots along
    this.transferHostIfNeeded();
    this.broadcastLobby();
    this.broadcastEvents([{ e: 'toast', text: reason === 'kicked' ? `🚪 房主請 ${m.name} 離開了房間` : reason === 'timeout' ? `⌛ ${m.name} 超過保留時間，位置讓出來了` : `🚪 ${m.name} 離開了房間`, tone: 'info' }]);
  }

  private transferHostIfNeeded() {
    const host = this.members.get(this.hostId);
    if (host && host.connected) return;
    const candidates = [...this.members.values()].filter(m => m.connected && !m.bot).sort((a, b) => a.joinOrder - b.joinOrder);
    if (!candidates.length) return; // keep the old host id while nobody is online
    this.hostId = candidates[0].playerId;
    this.clearAfkVotes(); candidates[0].activeAt = this.now();
    this.log(`${this.code}: host → ${candidates[0].name}`);
    this.broadcastEvents([{ e: 'toast', text: `👑 房主${host ? '斷線' : '離開'}了，由 ${candidates[0].name} 接任房主（${this.started ? '營業照常進行，不中斷' : '可以開始營業、踢人和改設定'}）`, tone: 'info' }]);
  }

  handle(playerId: string, msg: ClientMsg) {
    const m = this.members.get(playerId);
    if (!m || !msg || typeof msg !== 'object') return;
    this.useMap();
    const w = this.world;
    if (!m.bot) this.noteActivity(m, msg);
    switch (msg.type) {
      case 'ready':
        if (!this.started) { m.ready = !!msg.ready; this.broadcastLobby(); }
        else if (w) setReady(w, playerId, !!msg.ready);
        break;
      case 'lobbyCfg': {
        // the host can switch store type / difficulty until the game starts (multiplayer business days only)
        if (this.started || this.solo || this.opts.shift || playerId !== this.hostId) return;
        if (typeof msg.map === 'string' && getMap(msg.map).id === msg.map) this.mapId = msg.map;
        if (isDifficulty(msg.difficulty)) this.difficulty = msg.difficulty;
        if (typeof msg.bots === 'boolean') { this.botFill = msg.bots; this.botWant = msg.bots ? MAX_FILL_BOTS : 0; this.syncBots(); }
        for (const x of this.members.values()) if (x.playerId !== this.hostId && !x.bot) x.ready = false; // everyone re-confirms
        this.opts.onCheckpoint?.(this.checkpoint());
        this.broadcastLobby();
        break;
      }
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
      case 'hit':
        if (w && typeof msg.rid === 'string' && Number.isFinite(msg.id) && !this.paused) { requestHit(w, playerId, msg.rid.slice(0, 40), Number(msg.id)); this.flushResults(); }
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
        if (typeof msg.msg !== 'number' || !Number.isInteger(msg.msg)) return;
        const text = QUICK_MESSAGES[msg.msg];
        if (!text) return;
        // presets only; at most QUICK_BURST in QUICK_WINDOW_MS and never closer than QUICK_MIN_GAP_MS
        const times = (m.quickTimes ??= []).filter(x => t - x < QUICK_WINDOW_MS);
        m.quickTimes = times;
        if (times.length >= QUICK_BURST || t - m.lastQuickAt < QUICK_MIN_GAP_MS) {
          if (!m.bot && t - (m.quickWarnAt ?? 0) > QUICK_WINDOW_MS) { m.quickWarnAt = t; m.conn?.send({ type: 'events', list: [{ e: 'hint', text: '訊息送太快了，等一下再喊' }] }); }
          return;
        }
        times.push(t); m.lastQuickAt = t;
        this.broadcastEvents([{ e: 'quick', from: m.name, text, id: m.playerId, msg: msg.msg }]);
        if (!m.bot) this.botsHear(m, msg.msg);
        break;
      }
      case 'kick': {
        // host only, people only (bots come and go with the 電腦店員補位 switch), never yourself
        const target = typeof msg.id === 'string' ? this.members.get(msg.id) : undefined;
        if (playerId !== this.hostId || this.solo || !target || target.bot || target.playerId === playerId || !this.hostActionOk(m)) return;
        target.conn?.send({ type: 'error', code: 'kicked', message: '房主請你先離開這個房間' });
        this.leave(target.playerId, 'kicked');
        this.opts.onCheckpoint?.(this.checkpoint());
        break;
      }
      case 'host': {
        const target = typeof msg.id === 'string' ? this.members.get(msg.id) : undefined;
        if (playerId !== this.hostId || this.solo || !target || target.bot || !target.connected || target.playerId === playerId || !this.hostActionOk(m)) return;
        this.hostId = target.playerId;
        this.clearAfkVotes(); target.activeAt = this.now();
        this.log(`${this.code}: host handed to ${target.name}`);
        this.broadcastLobby();
        this.broadcastEvents([{ e: 'toast', text: `👑 ${m.name} 把房主交給了 ${target.name}`, tone: 'info' }]);
        this.opts.onCheckpoint?.(this.checkpoint());
        break;
      }
      case 'bot': {
        // host only, multiplayer business days only (lobby or mid-shift), within MAX_FILL_BOTS and the free slots
        if (playerId !== this.hostId || this.solo || this.opts.shift || m.bot || (msg.op !== 'add' && msg.op !== 'remove') || !this.hostActionOk(m)) return;
        if (msg.op === 'add') {
          if (this.bots.size >= MAX_FILL_BOTS || this.members.size >= MAX_PLAYERS) {
            m.conn?.send({ type: 'events', list: [{ e: 'hint', text: this.bots.size >= MAX_FILL_BOTS ? `電腦店員最多 ${MAX_FILL_BOTS} 位` : '店裡已經滿員了' }] });
            return;
          }
          this.botFill = true; this.botWant = this.bots.size + 1;
          this.addBot(true);
        } else {
          const t = typeof msg.id === 'string' ? this.members.get(msg.id) : undefined;
          if (!t?.bot) return;
          this.removeBot(t.playerId, true);
          this.botWant = this.bots.size; this.botFill = this.botWant > 0;
        }
        this.opts.onCheckpoint?.(this.checkpoint());
        this.broadcastLobby();
        break;
      }
      case 'voteHost': {
        const t = this.now();
        if (this.solo || m.bot || playerId === this.hostId || !m.connected || t - (m.voteAt ?? 0) < 1000) return;
        m.voteAt = t;
        if (!this.hostAfk()) { m.afkVote = false; m.conn?.send({ type: 'events', list: [{ e: 'hint', text: '房主還在線上活動，現在不能投票換房主' }] }); return; }
        this.afkShown = true;
        const yes = msg.yes !== false;
        if (!!m.afkVote === yes) return;
        m.afkVote = yes;
        if (yes) this.broadcastEvents([{ e: 'toast', text: `🗳 ${m.name} 投票換房主（${this.afkTally().yes}/${this.afkTally().need}）`, tone: 'info' }]);
        if (!this.resolveAfkVote()) this.broadcastLobby();
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
      case 'hb': {
        m.conn?.send({ type: 'hb', t: msg.t });
        const rtt = Number(msg.rtt);
        if (Number.isFinite(rtt) && rtt >= 0) {
          const v = Math.min(9999, Math.round(rtt));
          if (m.rtt === undefined || Math.abs(v - m.rtt) >= 15) { m.rtt = v; this.lobbyDirty = true; }
        }
        break;
      }
    }
  }

  /** Real activity (not the steady stream of unchanged inputs / heartbeats) resets the person's idle clock;
   *  the host coming back cancels a running AFK vote. */
  private noteActivity(m: Member, msg: ClientMsg) {
    let active = false;
    if (msg.type === 'input') {
      const v: [number, number, number, number] = [Number(msg.x), Number(msg.z), Number(msg.yaw), Number(msg.pitch)];
      const o = m.lastIn;
      active = !!o && (Math.abs(v[0] - o[0]) > 0.05 || Math.abs(v[1] - o[1]) > 0.05 || Math.abs(v[2] - o[2]) > 0.02 || Math.abs(v[3] - o[3]) > 0.02);
      m.lastIn = v;
    } else active = msg.type !== 'hb' && msg.type !== 'bg' && msg.type !== 'voteHost' && msg.type !== 'leave' && msg.type !== 'pause';
    if (!active) return;
    m.activeAt = this.now();
    if (m.playerId === this.hostId && this.afkShown) { this.afkShown = false; this.clearAfkVotes(); this.broadcastLobby(); }
  }

  /** The host is connected but has done nothing for the AFK threshold (multiplayer only). */
  hostAfk() {
    if (this.solo) return false;
    const h = this.members.get(this.hostId);
    if (!h || !h.connected || h.bot) return false;
    return this.now() - (h.activeAt ?? this.now()) >= (this.opts.hostAfkMs ?? HOST_AFK_S * 1000);
  }

  private afkTally() {
    const voters = [...this.members.values()].filter(x => x.connected && !x.bot && x.playerId !== this.hostId);
    const yes = voters.filter(x => x.afkVote);
    return { voters, yes: yes.length, need: Math.floor(voters.length / 2) + 1, yesList: yes };
  }

  private clearAfkVotes() { for (const x of this.members.values()) x.afkVote = false; }

  /** A majority of the others voted: the earliest-joined voter takes over. Returns true when the host changed. */
  private resolveAfkVote() {
    if (!this.hostAfk()) return false;
    const t = this.afkTally();
    if (!t.yes || t.yes < t.need) return false;
    const next = t.yesList.sort((a, b) => a.joinOrder - b.joinOrder)[0];
    const old = this.members.get(this.hostId);
    this.hostId = next.playerId; next.activeAt = this.now();
    this.clearAfkVotes(); this.afkShown = false;
    this.log(`${this.code}: host voted over to ${next.name}`);
    this.broadcastLobby();
    this.broadcastEvents([{ e: 'toast', text: `👑 ${old?.name ?? '房主'} 太久沒動作，大家投票由 ${next.name} 接任房主`, tone: 'info' }]);
    this.opts.onCheckpoint?.(this.checkpoint());
    return true;
  }

  /** Host tools are rate limited (HOST_ACTION_BURST per HOST_ACTION_WINDOW_MS; extra requests are dropped). */
  private hostActionOk(m: Member) {
    const t = this.now();
    const times = (m.adminTimes ?? []).filter(x => t - x < HOST_ACTION_WINDOW_MS);
    m.adminTimes = times;
    if (times.length >= HOST_ACTION_BURST) return false;
    times.push(t);
    return true;
  }

  /** Fill-in bots react to a person's callout: one answers 「需要支援收銀」 / 「奧客在門口」 with 👍, and after 「我去補貨」
   *  they leave restocking to the people for a while. */
  private botsHear(from: Member, msg: number) {
    const now = this.now();
    if (msg === 1) { this.humanRestockUntil = now + 20_000; return; }
    if (msg !== 0 && msg !== 2) return;
    const w = this.world; if (!w || !this.bots.size) return;
    const fp = w.players.get(from.playerId);
    let best: { id: string; d: number } | null = null;
    for (const id of this.bots.keys()) {
      const p = w.players.get(id); if (!p || p.grabbing != null) continue;
      const d = fp ? Math.hypot(p.x - fp.x, p.z - fp.z) : 0;
      if (!best || d < best.d) best = { id, d };
    }
    if (!best) return;
    const st = this.bots.get(best.id)!;
    if (msg === 0) st.assistUntil = now + 20_000;
    this.handle(best.id, { type: 'quick', msg: 5 });
  }

  startGame() {
    this.useMap();
    this.started = true;
    this.world = createWorld(this.save, this.opts.seed ?? Date.now(), this.dayCfg());
    for (const m of [...this.members.values()].sort((a, b) => a.joinOrder - b.joinOrder)) {
      const p = addPlayer(this.world, m.playerId, m.name, m.color);
      p.outfit = m.outfit;
      p.connected = m.connected;
      if (m.bot) p.bot = true;
    }
    this.opts.onCheckpoint?.(this.checkpoint());
    this.broadcastLobby();
    this.broadcastEvents([{ e: 'phase', phase: 'prep', day: this.world.day }]);
    this.log(`${this.code}: game started with ${this.humanCount} players${this.bots.size ? ` + ${this.bots.size} bots` : ''}`);
  }

  /** Advance one simulation tick. */
  update(dt = 1 / TICK_RATE) {
    this.useMap();
    const now = this.now();
    // reconnect grace
    for (const m of [...this.members.values()]) {
      if (m.connected || m.bot) continue;
      const grace = (this.started ? RECONNECT_GRACE_GAME_S : RECONNECT_GRACE_LOBBY_S) * 1000;
      if (now - m.disconnectedAt > grace) this.leave(m.playerId, 'timeout');
    }
    if (this.connectedCount === 0) { if (!this.emptySince) this.emptySince = now; } else this.emptySince = 0;
    // host AFK: announce when it starts; a vote can also pass when a voter's departure lowers the bar
    if (now - this.lastAfkCheck >= 1000 && !this.solo) {
      this.lastAfkCheck = now;
      const afk = this.hostAfk();
      if (afk !== this.afkShown) {
        this.afkShown = afk;
        if (!afk) this.clearAfkVotes();
        this.broadcastLobby();
        if (afk && this.connectedCount > 1) {
          const h = this.members.get(this.hostId);
          this.broadcastEvents([{ e: 'toast', text: `💤 房主 ${h?.name ?? ''} 已經 ${Math.round((this.opts.hostAfkMs ?? HOST_AFK_S * 1000) / 1000)} 秒沒動作：其他人可以在 選單 → 隊友 投票換房主`, tone: 'info' }]);
        }
      } else if (afk) this.resolveAfkVote();
    }
    // pings (lobby and the in-shift team list): refreshed every 2 s at most while somebody's changed
    if (this.lobbyDirty && now - this.lastLobbyAt > 2000) this.broadcastLobby();
    if (!this.world || this.paused) return;
    tick(this.world, dt);
    this.flushResults();
    if (this.world.events.length) { this.broadcastEvents(this.world.events); this.world.events = []; }
    if (this.world.saveOut) {
      this.save = this.world.saveOut; this.world.saveOut = null;
      this.broadcast({ type: 'save', save: this.save, kind: this.world.saveKind ?? 'night' });
      this.opts.onCheckpoint?.(this.checkpoint());
    }
    this.tickCount++;
    if (this.tickCount % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) {
      const s = snapshot(this.world, now);
      for (const mm of this.members.values()) if (mm.conn) mm.conn.send({ type: 'snap', s });
    }
    this.driveBots(dt);
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
      code: this.code, hostId: this.hostId, started: this.started, max: MAX_PLAYERS, day: this.world?.day ?? this.save.day, map: this.mapId, difficulty: this.difficulty,
      bots: this.solo || this.opts.shift ? undefined : this.botFill,
      ...(this.afkShown ? { hostAfk: true, afkVotes: this.afkTally().yes, afkNeed: this.afkTally().need } : {}),
      players: [...this.members.values()].sort((a, b) => a.joinOrder - b.joinOrder)
        .map(m => ({ id: m.playerId, name: m.name, ready: m.ready, connected: m.connected, color: m.color, platform: m.platform, outfit: m.outfit, bot: m.bot || undefined, ping: m.bot || !m.connected ? undefined : m.rtt, afkVote: m.afkVote && this.afkShown ? true as const : undefined })),
    };
  }

  broadcast(msg: ServerMsg) { for (const m of this.members.values()) m.conn?.send(msg); }
  broadcastLobby() { this.lobbyDirty = false; this.lastLobbyAt = this.now(); this.broadcast({ type: 'lobby', lobby: this.lobbyState() }); }
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
