// Cloudflare Worker entry: the same URL paths as server/index.ts so the game client works unchanged
// (point its server URL at wss://<worker-host>/ws). Static client files stay on Cloudflare Pages.
//
//   GET  /health                      → { ok, protocol }
//   GET  /ws                          → WebSocket. Current clients pick the room *after* connecting (create / join
//                                       message), so the worker holds the socket and relays it to the room's Durable
//                                       Object once it knows the code ("relay mode").
//   GET  /ws?room=CODE                → WebSocket straight to that room's Durable Object (no relay; see README)
//   GET  /ws?create=1                 → WebSocket straight to a freshly reserved room code (no relay)
//   GET  /api/room/:code              → { code, map, players } | 404
//   POST /api/stores                  → { code, token }
//   GET  /api/stores/:code            → public view
//   PUT  /api/stores/:code            → owner update (x-owner-token)
//   POST /api/stores/:code/raid       → raid report
//   GET  /api/stores/:code/reports    → owner collects reports (x-owner-token)
//   GET  /api/auth/config             → { googleClientId: string | null }
//   POST /api/auth/google             → { no, session, card }  (body { credential } = Google ID token)
//   POST /api/auth/logout             → {}  (x-session)
//   POST /api/auth/link/start         → { code, pollToken, expiresIn }  (app; Google sign-in is blocked in WebViews)
//   POST /api/auth/link/complete      → { no }  (browser, x-session, body { code })
//   POST /api/auth/link/poll          → { pending, expiresIn } | { no, session, card }  (app, body { pollToken })
//   PUT  /api/license                 → card (x-session)
//   GET  /api/license/:no             → public card
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/constants.ts';
import { closeReason, MAX_MSG_BYTES, type Env } from './env.ts';
import { STORE_CODE_ALPHABET, STORE_CODE_LENGTH, type Result } from './store-do.ts';
import { GOOGLE_CERTS, jwksFetcher, verifyGoogleIdToken } from './auth.ts';

export { RoomDO } from './room-do.ts';
export { StoreDO } from './store-do.ts';
export { LicenseDO } from './license-do.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-owner-token, x-session',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

const esc = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
const ROOM_CODE_RE = new RegExp(`^[${esc(ROOM_CODE_ALPHABET)}]{${ROOM_CODE_LENGTH}}$`);
const STORE_CODE_RE = new RegExp(`^[${esc(STORE_CODE_ALPHABET)}]{${STORE_CODE_LENGTH}}$`);

function randomCode(alphabet: string, len: number) {
  const buf = crypto.getRandomValues(new Uint32Array(len));
  let c = '';
  for (let i = 0; i < len; i++) c += alphabet[buf[i] % alphabet.length];
  return c;
}

const clientIp = (req: Request) =>
  req.headers.get('cf-connecting-ip') ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();

// Per-IP API rate limit (120 requests/minute, as in server/index.ts). Best effort: this map lives in one isolate,
// and Cloudflare runs many isolates, so a determined client can exceed it. For a hard limit use the Workers
// Rate Limiting binding or a WAF rule after deploying.
const apiHits = new Map<string, { n: number; at: number }>();
function rateLimited(ip: string) {
  const t = Date.now();
  if (apiHits.size > 10_000) apiHits.clear();
  const hit = apiHits.get(ip);
  if (hit && t - hit.at < 60_000) return ++hit.n > 120;
  apiHits.set(ip, { n: 1, at: t });
  return false;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 8192) return {};
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
const storeStub = (env: Env, code: string) => env.STORES.get(env.STORES.idFromName(code));
const licenseStub = (env: Env) => env.LICENSES.get(env.LICENSES.idFromName('licenses'));

/** Google's JWKS, or (tests only) a local stand-in; any other override is ignored so production can't be repointed. */
function certsUrl(env: Env) {
  const u = env.GOOGLE_CERTS_URL ?? '';
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) ? u : GOOGLE_CERTS;
}

/** Pick an unused room code and reserve it in that room's Durable Object. */
async function allocateRoom(env: Env): Promise<string | null> {
  for (let i = 0; i < 12; i++) {
    const code = randomCode(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);
    if (await roomStub(env, code).claim(code)) return code;
  }
  return null;
}

/** Open a server-side WebSocket to the room's Durable Object. */
async function connectRoom(env: Env, code: string): Promise<WebSocket | null> {
  const resp = await roomStub(env, code).fetch('https://room.internal/ws', { headers: { Upgrade: 'websocket', 'x-fc-room': code } });
  const ws = resp.webSocket;
  if (!ws) return null;
  ws.accept();
  return ws;
}

/** Forward the client's upgrade request straight to a room Durable Object (no relay). */
function forwardUpgrade(req: Request, env: Env, code: string) {
  const headers = new Headers(req.headers);
  headers.set('x-fc-room', code);
  return roomStub(env, code).fetch(new Request(req.url, { method: 'GET', headers }));
}

/**
 * Relay mode for the current client, which sends `hello` then `create`/`join` after the socket opens. The worker answers
 * `hello`/`hb` itself, and on `create`/`join` opens a socket to the right room Durable Object and pipes both ways.
 * If the room answers with an error before `welcome` (no_room, room_full …) the relay unbinds so the client can try
 * again on the same socket, like the Node server.
 */
function relay(env: Env): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  let up: WebSocket | null = null;
  let binding = false;
  let joined = false;
  let hello: string | null = null;
  let queue: string[] = [];
  const sendClient = (o: unknown) => { try { server.send(JSON.stringify(o)); } catch { /* gone */ } };
  const closeClient = (code: number, reason: string) => {
    try { server.close(code >= 1000 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1011, closeReason(reason)); } catch { /* ignore */ }
  };

  async function bind(code: string, first: string) {
    binding = true;
    let ws: WebSocket | null = null;
    try { ws = await connectRoom(env, code); } catch { ws = null; }
    binding = false;
    if (!ws) { sendClient({ type: 'error', code: 'no_room', message: '找不到房間，請確認房間碼' }); queue = []; return; }
    up = ws;
    const mine = ws;
    ws.addEventListener('message', ev => {
      if (up !== mine) return;
      const data = ev.data;
      if (typeof data !== 'string') return;
      if (!joined) {
        try {
          const m = JSON.parse(data) as { type?: string };
          if (m.type === 'welcome') joined = true;
          else if (m.type === 'error') { up = null; try { mine.close(1000, 'unbound'); } catch { /* ignore */ } }
        } catch { /* ignore */ }
      }
      try { server.send(data); } catch { /* gone */ }
    });
    ws.addEventListener('close', ev => { if (up === mine) { up = null; closeClient(ev.code, ev.reason); } });
    ws.addEventListener('error', () => { if (up === mine) { up = null; closeClient(1011, 'room error'); } });
    if (hello) ws.send(hello);
    ws.send(first);
    for (const q of queue) ws.send(q);
    queue = [];
  }

  server.addEventListener('message', ev => {
    const data = ev.data;
    if (typeof data !== 'string' || data.length > MAX_MSG_BYTES) return;
    if (up) { try { up.send(data); } catch { /* ignore */ } return; }
    if (binding) { if (queue.length < 50) queue.push(data); return; }
    let msg: { type?: string; v?: number; code?: unknown; t?: number };
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'hello':
        hello = data;
        if (msg.v !== PROTOCOL_VERSION) sendClient({ type: 'error', code: 'version', message: '版本不符，請更新遊戲' });
        break;
      case 'hb': sendClient({ type: 'hb', t: msg.t }); break;
      case 'create':
        binding = true;
        allocateRoom(env).then(code => {
          if (!code) { binding = false; sendClient({ type: 'error', code: 'server_full', message: '伺服器房間已滿，請稍後再試' }); return; }
          return bind(code, data);
        }).catch(() => { binding = false; sendClient({ type: 'error', code: 'server_full', message: '建立房間失敗，請再試一次' }); });
        break;
      case 'join': {
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        if (!ROOM_CODE_RE.test(code)) { sendClient({ type: 'error', code: 'no_room', message: '找不到房間，請確認房間碼' }); return; }
        void bind(code, data);
        break;
      }
    }
  });
  const gone = () => { const u = up; up = null; try { u?.close(1000, 'client left'); } catch { /* ignore */ } };
  server.addEventListener('close', gone);
  server.addEventListener('error', gone);
  return new Response(null, { status: 101, webSocket: client });
}

async function handleWs(req: Request, env: Env, url: URL) {
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426, headers: CORS });
  const room = (url.searchParams.get('room') ?? '').toUpperCase();
  if (room) return ROOM_CODE_RE.test(room) ? forwardUpgrade(req, env, room) : new Response('bad room code', { status: 404 });
  if (url.searchParams.get('create') === '1') {
    const code = await allocateRoom(env);
    return code ? forwardUpgrade(req, env, code) : new Response('no free room code', { status: 503 });
  }
  return relay(env);
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method === 'OPTIONS') return json(204, {});
  const ip = clientIp(req);
  if (rateLimited(ip)) return json(429, { error: '太頻繁了，稍後再試' });
  const parts = url.pathname.split('/').filter(Boolean); // api, room|stores, code?, action?
  const token = req.headers.get('x-owner-token') ?? undefined;
  const out = (r: Result<unknown>) => (r.ok ? json(200, r.value) : json(r.status, { error: r.error }));

  if (parts[1] === 'room' && parts[2] && req.method === 'GET') {
    const code = parts[2].toUpperCase();
    const info = ROOM_CODE_RE.test(code) ? await roomStub(env, code).info(code) : null;
    return info ? json(200, info) : json(404, { error: '找不到房間' });
  }
  const clientId = env.GOOGLE_CLIENT_ID ?? '';
  const session = req.headers.get('x-session') ?? undefined;
  if (parts[1] === 'auth' && parts[2] === 'config' && req.method === 'GET') return json(200, { googleClientId: clientId || null });
  if (parts[1] === 'auth' && parts[2] === 'google' && req.method === 'POST') {
    if (!clientId) return json(503, { error: '伺服器還沒設定 Google 登入' });
    const claims = await verifyGoogleIdToken((await readBody(req)).credential, clientId, jwksFetcher(certsUrl(env)));
    if (!claims) return json(401, { error: 'Google 登入驗證失敗' });
    return json(200, await licenseStub(env).login(claims.sub, claims.name));
  }
  if (parts[1] === 'auth' && parts[2] === 'logout' && req.method === 'POST') { await licenseStub(env).logout(session); return json(200, {}); }
  if (parts[1] === 'auth' && parts[2] === 'link' && req.method === 'POST') {
    if (parts[3] === 'start') return out(await licenseStub(env).linkStart(ip));
    if (parts[3] === 'complete') return out(await licenseStub(env).linkComplete(session, (await readBody(req)).code));
    if (parts[3] === 'poll') return out(await licenseStub(env).linkPoll((await readBody(req)).pollToken));
  }
  if (parts[1] === 'license') {
    if (!parts[2] && req.method === 'PUT') return out(await licenseStub(env).update(session, await readBody(req)));
    if (parts[2] && req.method === 'GET') {
      const no = decodeURIComponent(parts[2]);
      return /^\d{4}-\d{4}$/.test(no) ? out(await licenseStub(env).get(no)) : json(404, { error: '查無此證照' });
    }
  }
  if (parts[1] === 'stores') {
    const code = (parts[2] ?? '').toUpperCase();
    if (!code && req.method === 'POST') {
      const body = await readBody(req);
      for (let i = 0; i < 8; i++) {
        const c = randomCode(STORE_CODE_ALPHABET, STORE_CODE_LENGTH);
        const r = await storeStub(env, c).create(c, body);
        if (!r.ok && r.status === 409) continue;
        return out(r);
      }
      return json(503, { error: '店太多了' });
    }
    if (code && !STORE_CODE_RE.test(code)) return json(404, { error: '找不到這家店' }); // never wake a DO for junk codes
    const stub = code ? storeStub(env, code) : null;
    if (stub && !parts[3] && req.method === 'GET') return out(await stub.get());
    if (stub && !parts[3] && req.method === 'PUT') return out(await stub.update(token, await readBody(req)));
    if (stub && parts[3] === 'raid' && req.method === 'POST') {
      const b = await readBody(req);
      return out(await stub.raid(`${ip}|${String(b.raider ?? '')}`, b));
    }
    if (stub && parts[3] === 'reports' && req.method === 'GET') return out(await stub.takeReports(token));
  }
  return json(404, { error: 'not found' });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') return handleWs(req, env, url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, url);
    if (url.pathname === '/health') return json(200, { ok: true, protocol: PROTOCOL_VERSION, runtime: 'cloudflare-workers' });
    if (req.method === 'OPTIONS') return json(204, {});
    return json(404, { error: 'not found' });
  },
} satisfies ExportedHandler<Env>;
