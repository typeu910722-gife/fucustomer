// Google sign-in (ID token from Google Identity Services) and the public 高級社畜證照 (worker licence card).
// No secrets: the ID token is checked against Google's public keys and the OAuth client ID (which is public).
// We keep only a SHA-256 hash of the Google account id, never the e-mail address.
import { createHash, createPublicKey, randomBytes, randomInt, verify, type JsonWebKeyInput } from 'node:crypto';
import { getCosmetic } from '../shared/shop.ts';
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
}
interface LicenseRecord extends LicenseCard { owner: string; sessions: string[]; createdAt: number }

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : d); // eslint-disable-line no-control-regex
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
type R<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

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
    const session = randomBytes(24).toString('base64url');
    r.sessions = [...r.sessions, hash(session)].slice(-5); // up to 5 signed-in devices
    this.persist(r);
    return { no: r.no, session, card: this.view(r) };
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
    if ('quote' in b) r.quote = str(b.quote, 40, r.quote);
    r.updatedAt = this.now(); this.persist(r);
    return { ok: true, value: this.view(r) };
  }
  logout(session: unknown) { const r = this.bySession(session); if (r) { const h = hash(String(session)); r.sessions = r.sessions.filter(s => s !== h); this.persist(r); } }
  get(no: string): R<LicenseCard> { const r = this.byNo.get(no); return r ? { ok: true, value: this.view(r) } : { ok: false, status: 404, error: '查無此證照' }; }
  view(r: LicenseRecord): LicenseCard {
    const { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat, supporter } = r;
    return { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat: hat ?? '', supporter: supporter === true };
  }
}
