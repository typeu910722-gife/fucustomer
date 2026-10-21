// 高級社畜證照 (licence cards) for Google-signed-in players: same rules as server/auth.ts LicenseRegistry.
// One card per Google account (keyed by SHA-256('google:' + sub), the e-mail is never stored), an 8-digit public number
// "1234-5678", up to 5 signed-in devices (only SHA-256 hashes of session tokens are stored), and a public view without
// owner or sessions.
//
// A single registry Durable Object (name "licenses") holds all cards in SQLite, because a session token has to be
// resolved to its card without knowing the card first. Licence traffic is light (sign-in, an occasional card sync,
// lookups), so one object is plenty; it is not on the 20-ticks/second game path.
import { DurableObject } from 'cloudflare:workers';
import { randomToken, sha256Hex } from './auth.ts';
import type { Env } from './env.ts';
import { getCosmetic } from '../../shared/shop.ts';
import { applyWeekBadges, viewWeekBadges } from '../../shared/license-card.ts';
import {
  CLOUD_ERR, CLOUD_MAX_SLOTS, CLOUD_MIN_INTERVAL_MS, CLOUD_RETENTION_MS, CloudOpsCounter, type CloudRecord, type CloudView,
  applyUpload, checkUploadQuota, utcDay, viewRecord,
} from '../../shared/cloudsave.ts';
import type { SaveSummary } from '../../shared/savecode.ts';

export interface LicenseCard {
  no: string; name: string; level: number; rank: string; title: string; avatar: string;
  stars: number; achievements: number; storeName: string; quote: string; updatedAt: number;
  /** 商城: equipped hat id and the supporter badge (cosmetic only; not verified against a store receipt yet). */
  hat?: string; supporter?: boolean;
  /** 每週挑戰週章: newest week ids (≤8, e.g. "2026-W43") and how many in total. Old cards: none. */
  weekBadges?: string[]; weekBadgeCount?: number;
}
interface LicenseRecord extends LicenseCard { owner: string; createdAt: number }
type R<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export const MAX_SESSIONS = 5;
// "link via browser" (same rules as server/auth.ts): Google blocks its sign-in inside the app WebView, so the app gets a
// short code + secret poll token, the player signs in on the web page …/#link=CODE, and the session is parked here
// (≤10 minutes) until the app polls with the token. The code alone never yields a session.
export const LINK_TTL_MS = 10 * 60 * 1000;
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_STARTS_PER_IP = 10; // per 10 minutes
const LINK_MAX_PENDING = 10_000;
export function normalizeLinkCode(v: unknown): string {
  if (typeof v !== 'string' || v.length > 16) return '';
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 6 || [...c].some(ch => !LINK_CODE_ALPHABET.includes(ch))) return '';
  return c.slice(0, 3) + '-' + c.slice(3);
}
export type LinkPoll = { pending: true; expiresIn: number } | { no: string; session: string; card: LicenseCard };
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
/** Constant-time comparison of two equal-length hex strings. */
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// eslint-disable-next-line no-control-regex
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : d);
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
const rnd4 = () => 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
function view(r: LicenseRecord): LicenseCard {
  const { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat, supporter } = r;
  return { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat: hat ?? '', supporter: supporter === true, ...viewWeekBadges(r) };
}

export class LicenseDO extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS licenses (owner TEXT PRIMARY KEY, no TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT NOT NULL UNIQUE, owner TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner);
      CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, poll_hash TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, owner TEXT, session TEXT);
      CREATE TABLE IF NOT EXISTS cloudsaves (owner TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS cloudsaves_updated ON cloudsaves(updated);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
  }

  private byOwner(owner: string): LicenseRecord | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM licenses WHERE owner = ?', owner).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }
  private async bySession(session: unknown): Promise<LicenseRecord | null> {
    if (typeof session !== 'string' || !session || session.length > 200) return null;
    const row = this.sql.exec<{ owner: string }>('SELECT owner FROM sessions WHERE hash = ?', await sha256Hex(session)).toArray()[0];
    return row ? this.byOwner(row.owner) : null;
  }
  private put(r: LicenseRecord) {
    this.sql.exec('INSERT INTO licenses (owner, no, data) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data', r.owner, r.no, JSON.stringify(r));
  }

  /** Signed in with Google (claims already verified by the worker): find or create the card, hand out a session. */
  async login(googleSub: string, displayName?: string): Promise<{ no: string; session: string; card: LicenseCard }> {
    const owner = await sha256Hex('google:' + googleSub);
    let r = this.byOwner(owner);
    if (!r) {
      let no = '';
      for (let i = 0; i < 1000 && !no; i++) {
        const n = `${rnd4()}-${rnd4()}`;
        if (!this.sql.exec('SELECT 1 FROM licenses WHERE no = ?', n).toArray().length) no = n;
      }
      if (!no) throw new Error('no free licence number');
      const t = Date.now();
      r = { no, owner, createdAt: t, updatedAt: t, name: str(displayName, 16, '打工人') || '打工人', level: 1, rank: '試用期工讀生', title: '', avatar: '🧑', stars: 0, achievements: 0, storeName: '', quote: '' };
      this.put(r);
    }
    const session = await this.newSession(owner);
    return { no: r.no, session, card: view(r) };
  }
  private async newSession(owner: string) {
    const session = randomToken(24);
    this.sql.exec('INSERT INTO sessions (hash, owner) VALUES (?, ?)', await sha256Hex(session), owner);
    // keep the newest 5 signed-in devices
    this.sql.exec('DELETE FROM sessions WHERE owner = ? AND rowid NOT IN (SELECT rowid FROM sessions WHERE owner = ? ORDER BY rowid DESC LIMIT ?)', owner, owner, MAX_SESSIONS);
    return session;
  }

  // ---------- link via browser ----------
  private linkStarts = new Map<string, { n: number; at: number }>(); // per-IP start counter (memory only, best effort)
  private async pruneLinks() {
    const t = Date.now();
    // completed but never collected: revoke the parked session too
    for (const row of this.sql.exec<{ session: string }>('SELECT session FROM links WHERE expires <= ? AND session IS NOT NULL', t).toArray())
      this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(row.session));
    this.sql.exec('DELETE FROM links WHERE expires <= ?', t);
    for (const [ip, v] of this.linkStarts) if (t - v.at > LINK_TTL_MS) this.linkStarts.delete(ip);
  }
  /** Expired links are also removed lazily on every link call; the alarm just makes sure nothing outlives 10 minutes. */
  override async alarm() {
    await this.pruneLinks();
    const next = this.sql.exec<{ e: number | null }>('SELECT MIN(expires) AS e FROM links').toArray()[0]?.e;
    if (next) await this.ctx.storage.setAlarm(next + 1000);
  }
  async linkStart(ip: string): Promise<R<{ code: string; pollToken: string; expiresIn: number }>> {
    await this.pruneLinks();
    const t = Date.now(), hit = this.linkStarts.get(ip);
    if (hit && t - hit.at < LINK_TTL_MS) { if (++hit.n > LINK_STARTS_PER_IP) return { ok: false, status: 429, error: '太頻繁了，稍後再試' }; }
    else this.linkStarts.set(ip, { n: 1, at: t });
    if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM links').toArray()[0].n >= LINK_MAX_PENDING) return { ok: false, status: 503, error: '伺服器忙碌，稍後再試' };
    let code = '';
    for (let i = 0; i < 100 && !code; i++) {
      const r = crypto.getRandomValues(new Uint32Array(6));
      let c = '';
      for (let k = 0; k < 6; k++) c += LINK_CODE_ALPHABET[r[k] % LINK_CODE_ALPHABET.length];
      c = c.slice(0, 3) + '-' + c.slice(3);
      if (!this.sql.exec('SELECT 1 FROM links WHERE code = ?', c).toArray().length) code = c;
    }
    if (!code) return { ok: false, status: 503, error: '伺服器忙碌，稍後再試' };
    const pollToken = hex(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec('INSERT INTO links (code, poll_hash, expires) VALUES (?, ?, ?)', code, await sha256Hex(pollToken), t + LINK_TTL_MS);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(t + LINK_TTL_MS + 1000);
    return { ok: true, value: { code, pollToken, expiresIn: LINK_TTL_MS / 1000 } };
  }
  async linkComplete(session: unknown, codeIn: unknown): Promise<R<{ no: string }>> {
    await this.pruneLinks();
    const r = await this.bySession(session); if (!r) return { ok: false, status: 401, error: '請重新登入' };
    const l = this.sql.exec<{ session: string | null }>('SELECT session FROM links WHERE code = ?', normalizeLinkCode(codeIn)).toArray()[0];
    if (!l) return { ok: false, status: 404, error: '代碼不存在或已過期，請在 App 重新開始' };
    if (l.session) return { ok: false, status: 409, error: '這個代碼已經用過了' };
    const s = await this.newSession(r.owner);
    this.sql.exec('UPDATE links SET owner = ?, session = ? WHERE code = ?', r.owner, s, normalizeLinkCode(codeIn));
    return { ok: true, value: { no: r.no } };
  }
  async linkPoll(pollToken: unknown): Promise<R<LinkPoll>> {
    await this.pruneLinks();
    const gone = { ok: false, status: 404, error: '登入代碼已過期，請重新開始' } as const;
    if (typeof pollToken !== 'string' || !/^[0-9a-f]{64}$/.test(pollToken)) return gone;
    const ph = await sha256Hex(pollToken);
    const l = this.sql.exec<{ code: string; poll_hash: string; expires: number; owner: string | null; session: string | null }>('SELECT * FROM links WHERE poll_hash = ?', ph).toArray()[0];
    if (!l || !sameHex(l.poll_hash, ph)) return gone;
    if (!l.session || !l.owner) return { ok: true, value: { pending: true, expiresIn: Math.max(0, Math.round((l.expires - Date.now()) / 1000)) } };
    this.sql.exec('DELETE FROM links WHERE code = ?', l.code);
    const r = this.byOwner(l.owner);
    if (!r) return { ok: false, status: 404, error: '查無此證照' };
    return { ok: true, value: { no: r.no, session: l.session, card: view(r) } };
  }

  async update(session: unknown, b: Record<string, unknown>): Promise<R<LicenseCard>> {
    const r = await this.bySession(session); if (!r) return { ok: false, status: 401, error: '請重新登入' };
    if ('name' in b) r.name = str(b.name, 16, r.name) || r.name;
    if ('level' in b) r.level = int(b.level, 1, 99, r.level);
    if ('rank' in b) r.rank = str(b.rank, 16, r.rank);
    if ('title' in b) r.title = str(b.title, 16, r.title);
    if ('avatar' in b) r.avatar = str(b.avatar, 8, r.avatar) || r.avatar;
    if ('stars' in b) r.stars = int(b.stars, 0, 9999, r.stars);
    if ('achievements' in b) r.achievements = int(b.achievements, 0, 999, r.achievements);
    if ('storeName' in b) r.storeName = str(b.storeName, 16, r.storeName);
    if ('hat' in b) r.hat = typeof b.hat === 'string' && getCosmetic(b.hat)?.slot === 'hat' ? b.hat : '';
    if ('supporter' in b) r.supporter = b.supporter === true;
    applyWeekBadges(r, b);
    if ('quote' in b) r.quote = str(b.quote, 40, r.quote);
    r.updatedAt = Date.now(); this.put(r);
    return { ok: true, value: view(r) };
  }

  async logout(session: unknown): Promise<void> {
    if (typeof session !== 'string' || !session || session.length > 200) return;
    this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(session));
  }

  // ---------- 雲端備份 (cloud save): one slot per licence owner, rules in shared/cloudsave.ts ----------
  // Lives in this object (a table next to the licences) so every cloud request is ONE Durable Object request: the session
  // has to be resolved here anyway. The worker validates and re-encodes the code before calling cloudPut.
  // Free-plan budget: a server-wide daily request counter (in memory, written to `meta` every 25 requests so an eviction
  // loses at most 25), a slot cap kept in `meta`, and a once-a-day prune of slots older than CLOUD_RETENTION_MS.
  private cloudOps: CloudOpsCounter | null = null;
  private cloudPruned = '';
  private metaGet(k: string) { return this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v ?? null; }
  private metaSet(k: string, v: string) { this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); }
  private async cloudGate(session: unknown): Promise<R<string>> {
    if (typeof session !== 'string' || !session || session.length > 200) return CLOUD_ERR.auth;
    const row = this.sql.exec<{ owner: string }>('SELECT owner FROM sessions WHERE hash = ?', await sha256Hex(session)).toArray()[0];
    if (!row) return CLOUD_ERR.auth;
    const t = Date.now();
    if (!this.cloudOps) {
      this.cloudOps = new CloudOpsCounter();
      const saved = JSON.parse(this.metaGet('cloud_ops') ?? 'null') as { day: string; n: number } | null;
      if (saved && saved.day === utcDay(t)) { this.cloudOps.day = saved.day; this.cloudOps.n = saved.n; }
    }
    if (!this.cloudOps.take(t)) return CLOUD_ERR.busy;
    if (this.cloudOps.n % 25 === 0) this.metaSet('cloud_ops', JSON.stringify({ day: this.cloudOps.day, n: this.cloudOps.n }));
    return { ok: true, value: row.owner };
  }
  private cloudRec(owner: string): CloudRecord | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM cloudsaves WHERE owner = ?', owner).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }
  private cloudSlots(): number {
    const v = this.metaGet('cloud_slots');
    if (v !== null) return Number(v);
    const n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM cloudsaves').toArray()[0].n;
    this.metaSet('cloud_slots', String(n));
    return n;
  }
  private cloudPrune(t: number) {
    const d = utcDay(t);
    if (this.cloudPruned === d) return;
    this.cloudPruned = d;
    if (this.metaGet('cloud_pruned') === d) return;
    this.metaSet('cloud_pruned', d);
    const gone = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM cloudsaves WHERE updated < ?', t - CLOUD_RETENTION_MS).toArray()[0].n;
    if (gone) {
      this.sql.exec('DELETE FROM cloudsaves WHERE updated < ?', t - CLOUD_RETENTION_MS);
      this.metaSet('cloud_slots', String(Math.max(0, this.cloudSlots() - gone)));
    }
  }
  /** `code`/`summary` were produced by prepareUpload() in the worker (validated, re-encoded, entitlement-free). */
  async cloudPut(session: unknown, code: string, summary: SaveSummary): Promise<R<{ at: number; size: number; summary: SaveSummary; used: number; max: number }>> {
    const g = await this.cloudGate(session); if (!g.ok) return g;
    const owner = g.value, t = Date.now();
    this.cloudPrune(t);
    const rec = this.cloudRec(owner);
    if (!rec && this.cloudSlots() >= CLOUD_MAX_SLOTS) return CLOUD_ERR.full;
    const minS = Number(this.env.BK_CLOUDSAVE_MIN_S);
    const q = checkUploadQuota(rec, t, this.env.BK_CLOUDSAVE_MIN_S && minS >= 0 ? minS * 1000 : CLOUD_MIN_INTERVAL_MS); if (!q.ok) return q;
    const next = applyUpload(rec, code, summary, t);
    this.sql.exec('INSERT INTO cloudsaves (owner, updated, data) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET updated = excluded.updated, data = excluded.data', owner, t, JSON.stringify(next));
    if (!rec) this.metaSet('cloud_slots', String(this.cloudSlots() + 1));
    const v = viewRecord(next, t);
    return { ok: true, value: { at: t, size: next.latest.size, summary, used: v.quota.used, max: v.quota.max } };
  }
  async cloudGet(session: unknown): Promise<R<CloudView>> {
    const g = await this.cloudGate(session); if (!g.ok) return g;
    const rec = this.cloudRec(g.value);
    return rec ? { ok: true, value: viewRecord(rec, Date.now()) } : CLOUD_ERR.none;
  }
  async cloudDelete(session: unknown): Promise<R<{ deleted: boolean }>> {
    const g = await this.cloudGate(session); if (!g.ok) return g;
    const had = this.sql.exec('SELECT 1 FROM cloudsaves WHERE owner = ?', g.value).toArray().length > 0;
    if (had) { this.sql.exec('DELETE FROM cloudsaves WHERE owner = ?', g.value); this.metaSet('cloud_slots', String(Math.max(0, this.cloudSlots() - 1))); }
    return { ok: true, value: { deleted: had } };
  }

  async get(no: string): Promise<R<LicenseCard>> {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM licenses WHERE no = ?', no).toArray()[0];
    return row ? { ok: true, value: view(JSON.parse(row.data)) } : { ok: false, status: 404, error: '查無此證照' };
  }
}
