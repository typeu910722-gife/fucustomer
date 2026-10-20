// One Durable Object per multiplayer room (named by the 5-letter room code).
// It owns the authoritative shared/room.ts simulation and the players' WebSockets — the same job the Node server does
// for one entry of its `rooms` map.
//
// Why standard `ws.accept()` instead of the WebSocket Hibernation API: while anyone is in the room the simulation has
// to tick 20 times per second (customers walk, patience drains, the reconnect grace timer runs), so the object can never
// hibernate during play anyway. Hibernation would only let the runtime evict the object between messages and throw away
// the in-memory world. Accepted sockets keep the object in memory for exactly as long as players are connected; when the
// room empties, the tick loop stops and the object is evicted (no more duration charges).
//
// Storage (SQLite-backed, Free-plan compatible): a single key `cp` holds the latest RoomCheckpoint. It is written only at
// day start, at day end, and at most once a minute when the member list changed — a few rows per room per hour, far
// below the free 100,000 rows written/day. After a restart (code deploy, runtime update, eviction) a player reconnecting
// with the same code + token gets the room back at the start of the checkpointed day, like the Node server's restore.
import { DurableObject } from 'cloudflare:workers';
import { PROTOCOL_VERSION, TICK_RATE } from '../../shared/constants.ts';
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts';
import { Room, type Conn, type RoomCheckpoint } from '../../shared/room.ts';
import { isDifficulty } from '../../shared/difficulty.ts';
import { closeReason, MAX_MSG_BYTES, MAX_MSGS_PER_SEC, type Env } from './env.ts';

const CHECKPOINT_MAX_AGE_MS = 30 * 60 * 1000;
const MEMBER_CHECKPOINT_EVERY_MS = 60_000;
/** A code handed out by the worker stays reserved this long for the creator's `create` message. */
const CLAIM_TTL_MS = 30_000;
/** Clients send `hb` every 3 s; a socket silent for this long is dead (phone lost signal without closing). */
const DEAD_SOCKET_MS = 30_000;

interface Session {
  ws: WebSocket; conn: Conn; inRoom: boolean; playerId: string; platform: string;
  msgCount: number; msgWindow: number; lastRx: number; drop: () => void;
}

export interface RoomInfo { code: string; map: string; difficulty: string; players: number }

export class RoomDO extends DurableObject<Env> {
  private code = '';
  private room: Room | null = null;
  private loaded = false;
  private claimedAt = 0;
  private sessions = new Set<Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastMemberSig = '';
  private lastSaveAt = 0;
  /** Storage writes made by this instance (for the README's free-plan estimates / debugging). */
  private writes = 0;

  private log(...a: unknown[]) { console.log(new Date().toISOString(), `[room ${this.code}]`, ...a); }

  // ---------- RPC from the worker ----------

  /** Reserve this code for a new room. False if a room (or a fresh checkpoint) already uses it. */
  async claim(code: string): Promise<boolean> {
    this.code = code;
    await this.load();
    if (this.room || Date.now() - this.claimedAt < CLAIM_TTL_MS) return false;
    this.claimedAt = Date.now();
    return true;
  }

  /** GET /api/room/:code */
  async info(code: string): Promise<RoomInfo | null> {
    this.code = code;
    await this.load();
    const r = this.room;
    return r && !r.closed ? { code: r.code, map: r.mapId, difficulty: r.difficulty, players: r.connectedCount } : null;
  }

  async debugStats() { return { code: this.code, hasRoom: !!this.room, sessions: this.sessions.size, writes: this.writes }; }

  // ---------- storage ----------

  private async load() {
    if (this.loaded || this.room) return;
    this.loaded = true;
    const cp = await this.ctx.storage.get<RoomCheckpoint>('cp');
    if (!cp) return;
    if (Date.now() - cp.savedAt > CHECKPOINT_MAX_AGE_MS) { await this.ctx.storage.delete('cp'); this.writes++; return; }
    this.code = cp.code;
    this.room = Room.restore(cp, this.roomOpts());
    this.lastMemberSig = memberSig(cp);
    this.lastSaveAt = Date.now();
    this.startLoop();
  }

  private roomOpts() {
    const afk = Number(this.env.BK_HOST_AFK_S); // test only: a shorter host-AFK threshold
    return { onCheckpoint: (cp: RoomCheckpoint) => this.saveCheckpoint(cp), log: (s: string) => this.log(s), hostAfkMs: afk > 0 ? afk * 1000 : undefined };
  }

  private saveCheckpoint(cp: RoomCheckpoint) {
    this.lastSaveAt = Date.now();
    this.lastMemberSig = memberSig(cp);
    this.writes++;
    this.ctx.storage.put('cp', cp).catch(e => this.log('checkpoint write failed', e));
  }

  // ---------- WebSocket ----------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const code = request.headers.get('x-fc-room') ?? '';
    if (!this.code) this.code = code;
    await this.load();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const s: Session = {
      ws: server, inRoom: false, playerId: '', platform: 'web', msgCount: 0, msgWindow: Date.now(), lastRx: Date.now(), drop: () => {},
      conn: {
        send(msg: ServerMsg) { try { server.send(JSON.stringify(msg)); } catch { /* socket gone */ } },
        close(reason: string) { try { server.close(4000, closeReason(reason)); } catch { /* ignore */ } },
      },
    };
    this.sessions.add(s);
    server.addEventListener('message', ev => this.onMessage(s, ev.data));
    const gone = () => {
      if (!this.sessions.delete(s)) return;
      if (s.inRoom && this.room) this.room.disconnect(s.conn);
      try { server.close(1000, 'bye'); } catch { /* already closed */ }
    };
    s.drop = gone;
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    this.startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(s: Session, data: string | ArrayBuffer) {
    const now = Date.now();
    s.lastRx = now;
    if (typeof data !== 'string' || data.length > MAX_MSG_BYTES) return;
    if (now - s.msgWindow > 1000) { s.msgWindow = now; s.msgCount = 0; }
    if (++s.msgCount > MAX_MSGS_PER_SEC) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const fail = (code: string, message: string) => s.conn.send({ type: 'error', code, message });
    if (s.inRoom && this.room) { this.room.handle(s.playerId, msg); if (msg.type === 'leave') s.inRoom = false; return; }
    switch (msg.type) {
      case 'hello':
        if (msg.v !== PROTOCOL_VERSION) fail('version', '版本不符，請更新遊戲');
        s.platform = typeof msg.platform === 'string' ? msg.platform.slice(0, 12) : 'web';
        break;
      case 'create': {
        if (this.room || !this.claimedAt || now - this.claimedAt > CLAIM_TTL_MS) return fail('server_full', '建立房間失敗，請再試一次');
        this.claimedAt = 0;
        const map = typeof msg.map === 'string' ? msg.map.slice(0, 24) : undefined;
        const difficulty = isDifficulty(msg.difficulty) ? msg.difficulty : undefined;
        this.room = new Room(this.code, msg.save as never, { ...this.roomOpts(), map, difficulty });
        const r = this.room.join(s.conn, msg.name, undefined, s.platform, msg.outfit);
        if (r.ok) { s.inRoom = true; s.playerId = r.member.playerId; }
        this.startLoop();
        break;
      }
      case 'join': {
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        const room = this.room;
        if (!room || room.closed || code !== this.code) return fail('no_room', '找不到房間，請確認房間碼');
        const r = room.join(s.conn, msg.name, msg.token, s.platform, msg.outfit);
        if (!r.ok) return fail(r.code, r.message);
        s.inRoom = true; s.playerId = r.member.playerId;
        break;
      }
      case 'hb': s.conn.send({ type: 'hb', t: msg.t }); break;
    }
  }

  // ---------- game loop ----------

  private startLoop() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  private stopLoop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private tick() {
    const t = performance.now();
    const dt = Math.min(0.25, (t - this.lastTick) / 1000);
    this.lastTick = t;
    const now = Date.now();
    for (const s of this.sessions) if (now - s.lastRx > DEAD_SOCKET_MS) { try { s.ws.close(4001, 'timeout'); } catch { /* ignore */ } s.drop(); }
    const room = this.room;
    if (room) {
      const scale = Math.max(0.1, Math.min(20, Number(this.env.BK_TIME_SCALE ?? 1) || 1));
      room.update(dt * scale);
      if (room.closed || room.members.size === 0) {
        this.room = null;
        this.writes++;
        this.ctx.storage.delete('cp').catch(() => {});
        this.log('room closed');
      } else if (now - this.lastSaveAt > MEMBER_CHECKPOINT_EVERY_MS) {
        // New joiners / leavers since the last checkpoint: save so their tokens survive a restart.
        const cp = room.checkpoint();
        if (memberSig(cp) !== this.lastMemberSig) this.saveCheckpoint(cp);
        else this.lastSaveAt = now;
      }
    }
    if (!this.room && this.sessions.size === 0) this.stopLoop();
  }
}

function memberSig(cp: RoomCheckpoint) { return cp.members.map(m => m.playerId).sort().join(','); }
