// Connections: a WebSocket connection to the dedicated server (with automatic reconnect) and an
// in-memory connection that runs the very same Room/simulation locally for solo play.
import { TICK_RATE } from '../../shared/constants.ts';
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

