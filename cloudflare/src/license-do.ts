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

export interface LicenseCard {
  no: string; name: string; level: number; rank: string; title: string; avatar: string;
  stars: number; achievements: number; storeName: string; quote: string; updatedAt: number;
  /** 商城: equipped hat id and the supporter badge (cosmetic only; not verified against a store receipt yet). */
  hat?: string; supporter?: boolean;
}
interface LicenseRecord extends LicenseCard { owner: string; createdAt: number }
type R<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export const MAX_SESSIONS = 5;
// eslint-disable-next-line no-control-regex
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : d);
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
const rnd4 = () => 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
function view(r: LicenseRecord): LicenseCard {
  const { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat, supporter } = r;
  return { no, name, level, rank, title, avatar, stars, achievements, storeName, quote, updatedAt, hat: hat ?? '', supporter: supporter === true };
}

export class LicenseDO extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS licenses (owner TEXT PRIMARY KEY, no TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT NOT NULL UNIQUE, owner TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner);`);
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
    const session = randomToken(24);
    this.sql.exec('INSERT INTO sessions (hash, owner) VALUES (?, ?)', await sha256Hex(session), owner);
    // keep the newest 5 signed-in devices
    this.sql.exec('DELETE FROM sessions WHERE owner = ? AND rowid NOT IN (SELECT rowid FROM sessions WHERE owner = ? ORDER BY rowid DESC LIMIT ?)', owner, owner, MAX_SESSIONS);
    return { no: r.no, session, card: view(r) };
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
    if ('quote' in b) r.quote = str(b.quote, 40, r.quote);
    r.updatedAt = Date.now(); this.put(r);
    return { ok: true, value: view(r) };
  }

  async logout(session: unknown): Promise<void> {
    if (typeof session !== 'string' || !session || session.length > 200) return;
    this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(session));
  }

  async get(no: string): Promise<R<LicenseCard>> {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM licenses WHERE no = ?', no).toArray()[0];
    return row ? { ok: true, value: view(JSON.parse(row.data)) } : { ok: false, status: 404, error: '查無此證照' };
  }
}
