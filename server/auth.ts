// Google sign-in (ID token from Google Identity Services) and the public 高級社畜證照 (worker licence card).
// No secrets: the ID token is checked against Google's public keys and the OAuth client ID (which is public).
// We keep only a SHA-256 hash of the Google account id, never the e-mail address.
import { createHash, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify, type JsonWebKeyInput } from 'node:crypto';
import { getCosmetic } from '../shared/shop.ts';
import { applyWeekBadges, viewWeekBadges } from '../shared/license-card.ts';
type JsonWebKey = JsonWebKeyInput['key'];

export interface GoogleClaims { sub: string; aud: string; iss: string; exp: number; name?: string }
export type KeyFetcher = () => Promise<JsonWebKey[]>;

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let certCache: { keys: JsonWebKey[]; until: number } | null = null;
export const fetchGoogleKeys: KeyFetcher = async () => {
  if (certCache && certCache.until > Date.now()) return certCache.keys;
  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error('google certs ' + res.status);
  const age = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys;
  certCache = { keys, until: Date.now() + age * 1000 };
  return keys;
};

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Returns the verified claims, or null when the token is not a valid Google ID token for our client. */
export async function verifyGoogleIdToken(token: unknown, clientId: string, keys: KeyFetcher = fetchGoogleKeys, now = Date.now()): Promise<GoogleClaims | null> {
  if (typeof token !== 'string' || token.length > 4096 || !clientId) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256') return null;
    const jwk = (await keys()).find(k => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    const ok = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: jwk, format: 'jwk' }), b64(parts[2]));
    if (!ok) return null;
    const c = JSON.parse(b64(parts[1]).toString('utf8')) as GoogleClaims;
    if (c.aud !== clientId) return null;
    if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') return null;
    if (typeof c.exp !== 'number' || c.exp * 1000 < now) return null;
    if (typeof c.sub !== 'string' || !c.sub) return null;
    return c;
  } catch { return null; }
}

// ---------------- licence cards ----------------
export interface LicenseCard {
  no: string; name: string; level: number; rank: string; title: string; avatar: string;
  stars: number; achievements: number; storeName: string; quote: string; updatedAt: number;
  /** 商城: equipped hat id and the supporter badge (cosmetic only; not verified against a store receipt yet). */
  hat?: string; supporter?: boolean;
  /** 每週挑戰週章: newest week ids (≤8, e.g. "2026-W43") and how many in total. Old cards: none. */
  weekBadges?: string[]; weekBadgeCount?: number;
}
interface LicenseRecord extends LicenseCard { owner: string; sessions: string[]; createdAt: number }

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : d); // eslint-disable-line no-control-regex
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
type R<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

// ---------------- "link via browser" (Google blocks its sign-in inside the Android/iOS WebView) ----------------
// The app asks for a short code + a secret poll token, opens the system browser at …/#link=CODE, the player signs in
// there and confirms; the server mints a NEW session for that licence and parks it on the link record until the app
// polls with its poll token (which never leaves the app). The code alone never yields a session.
export const LINK_TTL_MS = 10 * 60 * 1000;
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const LINK_STARTS_PER_IP = 10; // per 10 minutes
const LINK_MAX_PENDING = 10_000;
/** "k7q 4mz" → "K7Q-4MZ"; '' when it can't be a link code. */
export function normalizeLinkCode(v: unknown): string {
  if (typeof v !== 'string' || v.length > 16) return '';
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 6 || [...c].some(ch => !LINK_CODE_ALPHABET.includes(ch))) return '';
  return c.slice(0, 3) + '-' + c.slice(3);
}
interface LinkRecord { code: string; pollHash: string; expires: number; owner?: string; no?: string; session?: string }
export type LinkPoll = { pending: true; expiresIn: number } | { no: string; session: string; card: LicenseCard };

export class LicenseRegistry {
  byOwner = new Map<string, LicenseRecord>();
  byNo = new Map<string, LicenseRecord>();
  constructor(private persist: (r: LicenseRecord) => void = () => {}, private now = () => Date.now()) {}

  private newNo() {
    for (let i = 0; i < 1000; i++) {
      const no = `${randomInt(1000, 10000)}-${randomInt(1000, 10000)}`;
      if (!this.byNo.has(no)) return no;
    }
    throw new Error('no free licence number');
  }
  /** Pending app links by code. In memory only: a server restart just means "start again". */
  links = new Map<string, LinkRecord>();
  private linkByPoll = new Map<string, string>(); // SHA-256(pollToken) → code
  private linkStarts = new Map<string, { n: number; at: number }>();
  private dropLink(l: LinkRecord) { this.links.delete(l.code); this.linkByPoll.delete(l.pollHash); }
  load(r: LicenseRecord) { if (r?.owner && r.no) { this.byOwner.set(r.owner, r); this.byNo.set(r.no, r); } }

  /** Signed in with Google: find or create the card for this account, hand out a new session token. */
  login(googleSub: string, displayName?: string): { no: string; session: string; card: LicenseCard } {
    const owner = hash('google:' + googleSub);
    let r = this.byOwner.get(owner);
    if (!r) {
      const t = this.now();
      r = { no: this.newNo(), owner, sessions: [], createdAt: t, updatedAt: t, name: str(displayName, 16, '打工人') || '打工人', level: 1, rank: '試用期工讀生', title: '', avatar: '🧑', stars: 0, achievements: 0, storeName: '', quote: '' };
      this.byOwner.set(owner, r); this.byNo.set(r.no, r);
    }
    const session = this.newSession(r);
    return { no: r.no, session, card: this.view(r) };
  }
  private newSession(r: LicenseRecord) {
    const session = randomBytes(24).toString('base64url');
    r.sessions = [...r.sessions, hash(session)].slice(-5); // up to 5 signed-in devices
    this.persist(r);
    return session;
  }

  private pruneLinks() {
    const t = this.now();
    for (const l of this.links.values()) if (l.expires <= t) {
      this.dropLink(l);
      // completed but never collected: revoke the parked session so it can't linger
      const r = l.owner ? this.byOwner.get(l.owner) : undefined;
      if (r && l.session) { const h = hash(l.session); r.sessions = r.sessions.filter(s => s !== h); this.persist(r); }
    }
    for (const [ip, v] of this.linkStarts) if (t - v.at > LINK_TTL_MS) this.linkStarts.delete(ip);
  }
  /** App side, step 1: a short human code for the browser and a secret poll token that stays in the app. */
  linkStart(ip: string): R<{ code: string; pollToken: string; expiresIn: number }> {
    this.pruneLinks();
    const t = this.now(), hit = this.linkStarts.get(ip);
    if (hit && t - hit.at < LINK_TTL_MS) { if (++hit.n > LINK_STARTS_PER_IP) return { ok: false, status: 429, error: '太頻繁了，稍後再試' }; }
    else this.linkStarts.set(ip, { n: 1, at: t });
    if (this.links.size >= LINK_MAX_PENDING) return { ok: false, status: 503, error: '伺服器忙碌，稍後再試' };
    let code = '';
    for (let i = 0; i < 100 && !code; i++) {
      let c = '';
      for (let k = 0; k < 6; k++) c += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
      c = c.slice(0, 3) + '-' + c.slice(3);
      if (!this.links.has(c)) code = c;
    }
    if (!code) return { ok: false, status: 503, error: '伺服器忙碌，稍後再試' };
    const pollToken = randomBytes(32).toString('hex');
    const l = { code, pollHash: hash(pollToken), expires: t + LINK_TTL_MS };
    this.links.set(code, l); this.linkByPoll.set(l.pollHash, code);
    return { ok: true, value: { code, pollToken, expiresIn: LINK_TTL_MS / 1000 } };
  }
  /** Browser side, step 2: a signed-in browser hands a NEW session for its licence to the waiting app. */
  linkComplete(session: unknown, codeIn: unknown): R<{ no: string }> {
    this.pruneLinks();
    const r = this.bySession(session); if (!r) return { ok: false, status: 401, error: '請重新登入' };
    const l = this.links.get(normalizeLinkCode(codeIn));
    if (!l) return { ok: false, status: 404, error: '代碼不存在或已過期，請在 App 重新開始' };
    if (l.session) return { ok: false, status: 409, error: '這個代碼已經用過了' };
    l.owner = r.owner; l.no = r.no; l.session = this.newSession(r);
    return { ok: true, value: { no: r.no } };
  }
  /** App side, step 3: poll with the secret token; the session is handed out once, then the link is gone. */
  linkPoll(pollToken: unknown): R<LinkPoll> {
    this.pruneLinks();
    if (typeof pollToken !== 'string' || !/^[0-9a-f]{64}$/.test(pollToken)) return { ok: false, status: 404, error: '登入代碼已過期，請重新開始' };
    // Looked up by the token's SHA-256 (timing of a hash-keyed lookup says nothing usable about the token itself),
    // then compared in constant time anyway.
    const ph = hash(pollToken);
    const found = this.links.get(this.linkByPoll.get(ph) ?? '');
    if (!found || !timingSafeEqual(Buffer.from(found.pollHash, 'hex'), Buffer.from(ph, 'hex'))) return { ok: false, status: 404, error: '登入代碼已過期，請重新開始' };
    if (!found.session || !found.owner) return { ok: true, value: { pending: true, expiresIn: Math.max(0, Math.round((found.expires - this.now()) / 1000)) } };
    this.dropLink(found);
    const r = this.byOwner.get(found.owner);
    if (!r) return { ok: false, status: 404, error: '查無此證照' };
    return { ok: true, value: { no: r.no, session: found.session, card: this.view(r) } };
  }
  private bySession(session: unknown): LicenseRecord | null {
    if (typeof session !== 'string' || !session) return null;
    const h = hash(session);
    for (const r of this.byOwner.values()) if (r.sessions.includes(h)) return r;
    return null;
  }
  update(session: unknown, b: Record<string, unknown>): R<LicenseCard> {
    const r = this.bySession(session); if (!r) return { ok: false, status: 401, error: '請重新登入' };
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
    r.updatedAt = this.now(); this.persist(r);
    return { ok: true, value: this.view(r) };
  }
  logout(session: unknown) { const r = this.bySession(session); if (r) { const h = hash(String(session)); r.sessions = r.sessions.filter(s => s !== h); this.persist(r); } }
  get(no: string): R<LicenseCard> { const r = this.byNo.get(no); return r ? { ok: true, value: this.view(r) } : { ok: false, status: 404, error: '查無此證照' }; }
  view(r: LicenseRecord): LicenseCard {
    const { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat, supporter } = r;
    return { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat: hat ?? '', supporter: supporter === true, ...viewWeekBadges(r) };
  }
}
