// WebSocket connection to the dedicated server (with automatic reconnect).
// Kept in its own module so single-player never downloads it.
import { applyMap } from '../../shared/map.ts';
import { PROTOCOL_VERSION, RECONNECT_GRACE_GAME_S } from '../../shared/constants.ts';
import type { ClientMsg, ServerMsg, StoreSave } from '../../shared/protocol.ts';
import type { GameConnection, NetStatus } from './net.ts';
import type { Outfit } from '../../shared/shop.ts';

export interface JoinIntent { kind: 'create'; name: string; save: StoreSave | null; map?: string; difficulty?: string; outfit?: Outfit }
/** `map` for a join is the room's store type, looked up before connecting (see roomMap). */
export type Intent = JoinIntent | { kind: 'join'; code: string; name: string; token?: string; map?: string; outfit?: Outfit };

/** Asks the server which store type a room uses, so the 3D view is built for the right map. */
export async function roomMap(wsUrl: string, code: string): Promise<string | undefined> {
  try {
    const http = wsUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
    const r = await fetch(`${http}/api/room/${encodeURIComponent(code)}`);
    if (!r.ok) return undefined;
    const j = await r.json() as { map?: string };
    return typeof j.map === 'string' ? j.map : undefined;
  } catch { return undefined; }
}

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
  /** When the connection dropped (performance.now()), 0 while connected: drives the 「位置保留 N 秒」 countdown. */
  private downSince = 0;
  private countdownTimer = 0;
  /** Smoothed round trip to the server (ms), from the heartbeat echo; 0 = not measured yet. */
  rtt = 0;
  /** How long the last reconnect took (ms), for tests / the HUD. */
  lastOutageMs = 0;

  constructor(public url: string, private intent: Intent, private platform: string) {
    applyMap(intent.map); // the room's store type (defaults to the 便利商店)
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

  /** The room goes in the URL so the Cloudflare server can hand the socket straight to that room (the Node server ignores it). */
  private socketUrl() {
    const room = this.everJoined && this.code ? this.code : this.intent.kind === 'join' ? this.intent.code : '';
    const q = room ? `room=${encodeURIComponent(room)}` : 'create=1';
    return this.url + (this.url.includes('?') ? '&' : '?') + q;
  }

  private connect() {
    clearTimeout(this.retryTimer);
    if (this.everJoined) this.startCountdown(); else this.onStatus('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.socketUrl()); } catch (e) { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0; this.lastRx = performance.now();
      this.raw({ type: 'hello', v: PROTOCOL_VERSION, platform: this.platform });
      // the name goes along: if the slot was already given up, the server lets you back in as a new clerk with the same name
      if (this.everJoined && this.token) this.raw({ type: 'join', code: this.code, name: this.intent.name, token: this.token, outfit: this.intent.outfit });
      else if (this.intent.kind === 'create') this.raw({ type: 'create', name: this.intent.name, save: this.intent.save, map: this.intent.map, difficulty: this.intent.difficulty, outfit: this.intent.outfit });
      else this.raw({ type: 'join', code: this.intent.code, name: this.intent.name, token: this.intent.token, outfit: this.intent.outfit });
    };
    ws.onmessage = (ev) => {
      this.lastRx = performance.now();
      // data flows again on the same socket after a quiet spell: back to normal
      if (this.downSince && this.ws === ws && this.everJoined && ws.readyState === WebSocket.OPEN && this.attempts === 0) { this.lastOutageMs = Math.round(performance.now() - this.downSince); this.downSince = 0; this.stopCountdown(); this.onStatus('online'); }
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') {
        this.everJoined = true; this.code = msg.code; this.token = msg.token; this.giveUpAt = 0;
        if (this.downSince) this.lastOutageMs = Math.round(performance.now() - this.downSince);
        this.downSince = 0; clearInterval(this.countdownTimer); this.countdownTimer = 0;
        this.onStatus('online');
        this.raw({ type: 'hb', t: Date.now(), rtt: this.rtt || undefined }); // first ping right away (the lobby shows it)
      }
      if (msg.type === 'error' && msg.code === 'kicked') { this.closedByUser = true; this.stopCountdown(); this.onStatus('offline', '👋 房主把你請出了這個房間。'); return; }
      if (msg.type === 'error' && this.everJoined && (msg.code === 'no_room' || msg.code === 'room_full' || msg.code === 'room_closed')) {
        this.closedByUser = true; this.stopCountdown();
        this.onStatus('offline', msg.code === 'no_room' || msg.code === 'room_closed' ? '🌙 這間店已經打烊了：房間保留時間到了，或大家都離開了。' : msg.message);
      }
      if (msg.type === 'hb') {
        const r = Date.now() - msg.t;
        if (r >= 0 && r < 30_000) this.rtt = this.rtt ? Math.round(this.rtt * 0.6 + r * 0.4) : r;
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      if (ev.code === 4000 && ev.reason === 'replaced') { this.closedByUser = true; this.onStatus('offline', '此帳號已在其他裝置連線'); return; }
      if (ev.code === 4000 && ev.reason === 'kicked') { this.closedByUser = true; this.onStatus('offline', '👋 房主把你請出了這個房間。'); return; }
      if (!this.everJoined && this.attempts >= 2) { this.onStatus('offline', '無法連線到伺服器'); this.closedByUser = true; return; }
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleRetry() {
    if (this.closedByUser) return;
    if (!this.giveUpAt) this.giveUpAt = performance.now() + (RECONNECT_GRACE_GAME_S + 5) * 1000;
    if (performance.now() > this.giveUpAt) { this.closedByUser = true; this.stopCountdown(); this.onStatus('offline', `⌛ 重新連線逾時：超過 ${RECONNECT_GRACE_GAME_S} 秒沒連上，店裡的位置已經讓出來了。`); return; }
    this.startCountdown();
    // short waits: once the network is back you're in again within ~2 s (the 'online' event retries at once)
    const delay = Math.min(2500, 300 * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  /** 「重新連線中… 位置保留 N 秒」, updated every second while the connection is down. */
  private startCountdown() {
    if (!this.downSince) this.downSince = performance.now();
    const show = () => {
      const left = Math.max(0, Math.ceil(RECONNECT_GRACE_GAME_S - (performance.now() - this.downSince) / 1000));
      this.onStatus('reconnecting', `📶 連線中斷，重新連線中…\n你的位置和手上的東西會保留 ${left} 秒`);
    };
    show();
    if (!this.countdownTimer) this.countdownTimer = window.setInterval(() => { if (this.downSince && !this.closedByUser) show(); }, 1000);
  }
  private stopCountdown() { clearInterval(this.countdownTimer); this.countdownTimer = 0; }

  private reconnectNow() {
    if (this.closedByUser) return;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null; this.attempts = 0;
    this.connect();
  }

  private heartbeat() {
    if (!this.isOpen()) return;
    // A socket that silently died (e.g. network switch) receives nothing: tell the player after ~4 s of silence
    // (snapshots normally arrive 12×/s), force a reconnect after 9 s.
    const quiet = performance.now() - this.lastRx;
    if (quiet > 9000) { this.startCountdown(); this.reconnectNow(); return; }
    if (quiet > 4000 && this.everJoined && !this.downSince) { this.downSince = this.lastRx; this.startCountdown(); }
    this.raw({ type: 'hb', t: Date.now(), rtt: this.rtt || undefined });
  }

  private raw(msg: ClientMsg) { if (this.isOpen()) this.ws!.send(JSON.stringify(msg)); }
  send(msg: ClientMsg) { this.raw(msg); }

  close() {
    this.closedByUser = true;
    clearInterval(this.hbTimer); clearTimeout(this.retryTimer); this.stopCountdown();
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVis);
    try { this.raw({ type: 'leave' }); this.ws?.close(); } catch { /* ignore */ }
  }
}
