// Dedicated authoritative game server: room codes, lobby, 5-player cap, simulation, checkpoints.
// Clients on any network reach it over WebSocket (wss in production) — no port forwarding needed.
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, TICK_RATE } from '../shared/constants.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { Conn, Room, RoomCheckpoint } from '../shared/room.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STATIC_DIR = process.env.STATIC_DIR ?? path.join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data', 'rooms');
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);
const CHECKPOINT_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 80;
// Test-only fast-forward of simulated time (never set in production).
const TIME_SCALE = Math.max(0.1, Math.min(20, Number(process.env.BK_TIME_SCALE ?? 1)));

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const rooms = new Map<string, Room>();

function newCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no free room code');
}

async function writeCheckpoint(cp: RoomCheckpoint) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `${cp.code}.json`);
    await fs.writeFile(file + '.tmp', JSON.stringify(cp));
    await fs.rename(file + '.tmp', file);
  } catch (e) { log('checkpoint write failed', e); }
}

async function deleteCheckpoint(code: string) {
  try { await fs.unlink(path.join(DATA_DIR, `${code}.json`)); } catch { /* ignore */ }
}

function makeRoom(code: string, save: unknown) {
  return new Room(code, save as never, { onCheckpoint: cp => void writeCheckpoint(cp), log: s => log(s) });
}

async function restoreRooms() {
  if (!existsSync(DATA_DIR)) return;
  for (const f of await fs.readdir(DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const cp = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8')) as RoomCheckpoint;
      if (Date.now() - cp.savedAt > CHECKPOINT_MAX_AGE_MS) { await fs.unlink(path.join(DATA_DIR, f)); continue; }
      rooms.set(cp.code, Room.restore(cp, { onCheckpoint: c => void writeCheckpoint(c), log: s => log(s) }));
    } catch (e) { log('bad checkpoint', f, e); }
  }
}

// ---------- HTTP (health + static client) ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    let players = 0;
    for (const r of rooms.values()) players += r.connectedCount;
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.size, players }));
    return;
  }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p) p = 'index.html';
  const file = path.join(STATIC_DIR, p);
  if (!file.startsWith(STATIC_DIR) || !existsSync(file)) {
    const idx = path.join(STATIC_DIR, 'index.html');
    if (existsSync(idx)) { sendFile(req, res, idx); return; }
    res.writeHead(404); res.end('not found'); return;
  }
  sendFile(req, res, file);
}

// Static files are gzip-compressed once and kept in memory; hashed assets are cached by browsers for a year.
const fileCache = new Map<string, { raw: Buffer; gz: Buffer | null; mtime: number }>();
function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const ext = path.extname(file);
  let entry = fileCache.get(file);
  if (!entry) {
    const raw = readFileSync(file);
    const gz = /\.(js|css|html|json|svg|webmanifest)$/.test(file) && raw.length > 1024 ? gzipSync(raw, { level: 9 }) : null;
    entry = { raw, gz, mtime: Date.now() };
    if (process.env.NODE_ENV === 'production') fileCache.set(file, entry);
  }
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (entry.gz && acceptsGzip) { headers['content-encoding'] = 'gzip'; headers['vary'] = 'accept-encoding'; res.writeHead(200, headers); res.end(entry.gz); return; }
  res.writeHead(200, headers); res.end(entry.raw);
}

const http = createServer(serveStatic);
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MSG_BYTES });

interface Session { room: Room | null; playerId: string; platform: string; alive: boolean; msgCount: number; msgWindow: number }

wss.on('connection', (ws: WebSocket) => {
  const s: Session = { room: null, playerId: '', platform: 'web', alive: true, msgCount: 0, msgWindow: Date.now() };
  const conn: Conn = {
    send(msg: ServerMsg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close(reason: string) { try { ws.close(4000, reason.slice(0, 60)); } catch { /* ignore */ } },
  };
  const fail = (code: string, message: string) => conn.send({ type: 'error', code, message });
  ws.on('pong', () => { s.alive = true; });
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - s.msgWindow > 1000) { s.msgWindow = now; s.msgCount = 0; }
    if (++s.msgCount > MAX_MSGS_PER_SEC) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (s.room) { s.room.handle(s.playerId, msg); if (msg.type === 'leave') { s.room = null; } return; }
    switch (msg.type) {
      case 'hello':
        if (msg.v !== PROTOCOL_VERSION) fail('version', '版本不符，請更新遊戲');
        s.platform = typeof msg.platform === 'string' ? msg.platform.slice(0, 12) : 'web';
        break;
      case 'create': {
        if (rooms.size >= MAX_ROOMS) return fail('server_full', '伺服器房間已滿，請稍後再試');
        const room = makeRoom(newCode(), msg.save);
        rooms.set(room.code, room);
        const r = room.join(conn, msg.name, undefined, s.platform);
        if (r.ok) { s.room = room; s.playerId = r.member.playerId; }
        break;
      }
      case 'join': {
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        const room = rooms.get(code);
        if (!room) return fail('no_room', '找不到房間，請確認房間碼');
        const r = room.join(conn, msg.name, msg.token, s.platform);
        if (!r.ok) return fail(r.code, r.message);
        s.room = room; s.playerId = r.member.playerId;
        break;
      }
      case 'hb': conn.send({ type: 'hb', t: msg.t }); break;
    }
  });
  ws.on('close', () => { if (s.room) s.room.disconnect(conn); });
  ws.on('error', () => { /* close follows */ });
  (ws as WebSocket & { _s?: Session })._s = s;
});

// Detect dead sockets (phones that lost signal without closing)
setInterval(() => {
  for (const ws of wss.clients) {
    const s = (ws as WebSocket & { _s?: Session })._s;
    if (!s) continue;
    if (!s.alive) { ws.terminate(); continue; }
    s.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 10_000);

// Game loop
let last = performance.now();
setInterval(() => {
  const t = performance.now();
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  for (const [code, room] of rooms) {
    room.update(dt * TIME_SCALE);
    if (room.closed || (room.members.size === 0)) { rooms.delete(code); void deleteCheckpoint(code); log(`room ${code} closed`); }
  }
}, 1000 / TICK_RATE);

function shutdown(sig: string) {
  log(`${sig}: saving checkpoints and closing`);
  const pending: Promise<void>[] = [];
  for (const room of rooms.values()) { pending.push(writeCheckpoint(room.checkpoint())); room.broadcast({ type: 'closed', reason: '伺服器維護中，稍後可用相同房間碼重新加入（回到當天開店前的檢查點）' }); }
  Promise.all(pending).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await restoreRooms();
http.listen(PORT, () => log(`FUCustomer server on :${PORT} (ws path /ws, static ${STATIC_DIR})`));
