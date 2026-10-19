// Connections: a WebSocket connection to the dedicated server (with automatic reconnect) and an
// in-memory connection that runs the very same Room/simulation locally for solo play.
import { TICK_RATE } from '../../shared/constants.ts';
import type { ClientMsg, ServerMsg, StoreSave } from '../../shared/protocol.ts';
import { Room } from '../../shared/room.ts';
import { applyMap } from '../../shared/map.ts';
import type { ShiftConfig } from '../../shared/career.ts';
import { Bot, botMessages } from '../../shared/bot.ts';
import type { Snapshot } from '../../shared/protocol.ts';

export interface LocalExtras {
  /** An employee played by the simulated player (own store). */
  staff?: { name: string; pace: number };
  /** Receives each nightly save instead of the free-play save slot. */
  onSave?: (save: StoreSave) => void;
  /** Map for free play / own store (career shifts carry it in their config). */
  map?: string;
}

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
  readonly onSave?: (save: StoreSave) => void;
  private staff: { bot: Bot; id: string; snap: Snapshot | null; rid: number } | null = null;
  constructor(name: string, save: StoreSave | null, shift?: ShiftConfig, seed?: number, extras: LocalExtras = {}) {
    applyMap(shift?.map ?? extras.map); // must happen before the world and the 3D view are built
    this.room = new Room('SOLO', save, { solo: true, shift, seed });
    this.onSave = extras.onSave;
    const conn = { send: (m: ServerMsg) => queueMicrotask(() => { if (m.type === 'save') this.onSave?.(m.save); this.onMessage(m); }), close: () => {} };
    const r = this.room.join(conn, name, undefined, 'solo');
    if (r.ok) this.playerId = r.member.playerId;
    if (extras.staff) {
      const bot = new Bot('any', 0.5); bot.pace = extras.staff.pace;
      const st = { bot, id: '', snap: null as Snapshot | null, rid: 0 };
      const sr = this.room.join({ send: (m: ServerMsg) => { if (m.type === 'snap') st.snap = m.s; }, close: () => {} }, extras.staff.name, undefined, 'staff');
      if (sr.ok) { st.id = sr.member.playerId; this.staff = st; }
    }
    this.timer = window.setInterval(() => {
      const t = performance.now();
      const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
      this.room.update(dt);
      this.driveStaff(dt);
    }, 1000 / TICK_RATE);
    queueMicrotask(() => { this.onStatus('online'); this.room.startGame(); });
  }
  private driveStaff(dt: number) {
    const st = this.staff; if (!st || !st.snap || this.room.paused) return;
    const me = st.snap.players.find(p => p.id === st.id); if (!me) return;
    for (const m of botMessages(st.bot.update(st.snap, me, dt), () => 'staff' + st.rid++)) this.room.handle(st.id, m);
  }
  /** The employee quit: they leave the store. */
  dismissStaff() { if (this.staff) { this.room.handle(this.staff.id, { type: 'leave' }); this.staff = null; } }
  setStaffPace(p: number) { if (this.staff) this.staff.bot.pace = p; }

  send(msg: ClientMsg) { this.room.handle(this.playerId, msg); }
  close() { clearInterval(this.timer); }
}

