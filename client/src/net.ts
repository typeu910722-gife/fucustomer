// Connections: a WebSocket connection to the dedicated server (with automatic reconnect) and an
// in-memory connection that runs the very same Room/simulation locally for solo play.
import { PROTOCOL_VERSION, TICK_RATE } from '../../shared/constants.ts';
import type { ClientMsg, ServerMsg, StoreSave } from '../../shared/protocol.ts';
import { Room } from '../../shared/room.ts';
import type { ShiftConfig } from '../../shared/career.ts';

export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface GameConnection {
  readonly solo: boolean;
  send(msg: ClientMsg): void;
  onMessage: (msg: ServerMsg) => void;
  onStatus: (s: NetStatus, detail?: string) => void;
  close(): void;
}

export class LocalConnection implements GameConnection {
  readonly solo = true;
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};
  private room: Room;
  private playerId = '';
  private timer: number;
  private last = performance.now();
  constructor(name: string, save: StoreSave | null, shift?: ShiftConfig) {
    this.room = new Room('SOLO', save, { solo: true, shift });
    const conn = { send: (m: ServerMsg) => queueMicrotask(() => this.onMessage(m)), close: () => {} };
    const r = this.room.join(conn, name, undefined, 'solo');
    if (r.ok) this.playerId = r.member.playerId;
    this.timer = window.setInterval(() => {
      const t = performance.now();
      const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
      this.room.update(dt);
    }, 1000 / TICK_RATE);
    queueMicrotask(() => { this.onStatus('online'); this.room.startGame(); });
  }
  send(msg: ClientMsg) { this.room.handle(this.playerId, msg); }
  close() { clearInterval(this.timer); }
}

export interface JoinIntent { kind: 'create'; name: string; save: StoreSave | null }
export type Intent = JoinIntent | { kind: 'join'; code: string; name: string; token?: string };

export class WsConnection implements GameConnection {
  readonly solo = false;
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus, detail?: string) => void = () => {};
  /** Set after welcome; used to resume the same player on reconnect. */
  code = ''; token = '';
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private attempts = 0;
  private lastRx = 0;
  private hbTimer = 0;
  private retryTimer = 0;
  private everJoined = false;
  private giveUpAt = 0;

  constructor(public url: string, private intent: Intent, private platform: string) {
    this.connect();
    this.hbTimer = window.setInterval(() => this.heartbeat(), 3000);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVis);
  }

  private onOnline = () => { if (!this.isOpen()) this.reconnectNow(); };
  private onVis = () => {
    if (document.visibilityState === 'visible') {
      if (!this.isOpen()) this.reconnectNow();
      else this.send({ type: 'bg', away: false });
    } else this.send({ type: 'bg', away: true });
  };

  private isOpen() { return this.ws?.readyState === WebSocket.OPEN; }

  private connect() {
    clearTimeout(this.retryTimer);
    this.onStatus(this.everJoined ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch (e) { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0; this.lastRx = performance.now();
      this.raw({ type: 'hello', v: PROTOCOL_VERSION, platform: this.platform });
      if (this.everJoined && this.token) this.raw({ type: 'join', code: this.code, name: '', token: this.token });
      else if (this.intent.kind === 'create') this.raw({ type: 'create', name: this.intent.name, save: this.intent.save });
      else this.raw({ type: 'join', code: this.intent.code, name: this.intent.name, token: this.intent.token });
    };
    ws.onmessage = (ev) => {
      this.lastRx = performance.now();
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') {
        this.everJoined = true; this.code = msg.code; this.token = msg.token; this.giveUpAt = 0;
        this.onStatus('online');
      }
      if (msg.type === 'error' && this.everJoined && (msg.code === 'no_room' || msg.code === 'room_full' || msg.code === 'room_closed')) {
        this.closedByUser = true; this.onStatus('offline', msg.message);
      }
      if (msg.type === 'hb') return;
      this.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      if (ev.code === 4000 && ev.reason === 'replaced') { this.closedByUser = true; this.onStatus('offline', '此帳號已在其他裝置連線'); return; }
      if (!this.everJoined && this.attempts >= 2) { this.onStatus('offline', '無法連線到伺服器'); this.closedByUser = true; return; }
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleRetry() {
    if (this.closedByUser) return;
    if (!this.giveUpAt) this.giveUpAt = performance.now() + 125_000;
    if (performance.now() > this.giveUpAt) { this.closedByUser = true; this.onStatus('offline', '重新連線逾時'); return; }
    this.onStatus('reconnecting', `連線中斷，重新連線中…（第 ${this.attempts + 1} 次）`);
    const delay = Math.min(8000, 400 * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private reconnectNow() {
    if (this.closedByUser) return;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null; this.attempts = 0;
    this.connect();
  }

  private heartbeat() {
    if (!this.isOpen()) return;
    // A socket that silently died (e.g. network switch) receives nothing: force a reconnect.
    if (performance.now() - this.lastRx > 9000) { this.reconnectNow(); return; }
    this.raw({ type: 'hb', t: Date.now() });
  }

  private raw(msg: ClientMsg) { if (this.isOpen()) this.ws!.send(JSON.stringify(msg)); }
  send(msg: ClientMsg) { this.raw(msg); }

  close() {
    this.closedByUser = true;
    clearInterval(this.hbTimer); clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVis);
    try { this.raw({ type: 'leave' }); this.ws?.close(); } catch { /* ignore */ }
  }
}
