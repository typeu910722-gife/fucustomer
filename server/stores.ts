// Friend stores (prototype): owners upload a snapshot of their own store and get a store code; friends can raid it.
// A locked store can only be "raided" from outside the door (tiny damage). Owners collect damage reports next time
// they are online. The owner token is returned once and only its hash is kept.
import { createHash, randomBytes, randomInt } from 'node:crypto';

export interface RaidReport { at: number; raider: string; score: number; outside: boolean; money: number; rating: number }
export interface FriendStore {
  code: string; name: string; map: string; money: number; rating: number; shelves: Record<string, number>;
  locked: boolean; ownerHash: string; createdAt: number; updatedAt: number; reports: RaidReport[];
  /** raider key → last raid time (ms) */
  lastRaid: Record<string, number>;
}
export interface PublicStoreView { code: string; name: string; map: string; rating: number; locked: boolean; shelves: Record<string, number> }

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RAID_COOLDOWN_MS = 10 * 60 * 1000;
export const RAID_MAX_SCORE = 2000;
export const OUTSIDE_MAX_SCORE = 30;

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
function cleanShelves(v: unknown) {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['drinks', 'snacks', 'bento']) out[k] = Math.round(num(o[k], 0, 99, 0));
    // the optional fourth product line (e.g. the gas station's drinks fridge) is kept only when the store has one
    if (typeof o.extra === 'number') out.extra = Math.round(num(o.extra, 0, 99, 0));
  }
  return out;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export class StoreRegistry {
  stores = new Map<string, FriendStore>();
  constructor(private persist: (s: FriendStore) => void = () => {}, private now: () => number = () => Date.now()) {}

  private newCode() {
    for (let i = 0; i < 1000; i++) {
      let c = ''; for (let k = 0; k < 6; k++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.stores.has(c)) return c;
    }
    throw new Error('no free store code');
  }
  private owned(code: string, token: unknown): Result<FriendStore> {
    const s = this.stores.get(code);
    if (!s) return fail(404, '找不到這家店');
    if (typeof token !== 'string' || hash(token) !== s.ownerHash) return fail(403, '不是店主');
    return { ok: true, value: s };
  }
  view(s: FriendStore): PublicStoreView { return { code: s.code, name: s.name, map: s.map, rating: s.rating, locked: s.locked, shelves: s.shelves }; }

  create(body: Record<string, unknown>): Result<{ code: string; token: string }> {
    if (this.stores.size >= 5000) return fail(503, '店太多了');
    const token = randomBytes(18).toString('base64url');
    const t = this.now();
    const s: FriendStore = {
      code: this.newCode(), name: str(body.name, 16, '某人的店') || '某人的店', map: str(body.map, 24, 'convenience') || 'convenience',
      money: Math.round(num(body.money, -1e6, 1e8, 0)), rating: num(body.rating, 0, 5, 3), shelves: cleanShelves(body.shelves),
      locked: body.locked === true, ownerHash: hash(token), createdAt: t, updatedAt: t, reports: [], lastRaid: {},
    };
    this.stores.set(s.code, s); this.persist(s);
    return { ok: true, value: { code: s.code, token } };
  }

  /** The owner syncs the latest state of the store (and whether the door is locked). */
  update(code: string, token: unknown, body: Record<string, unknown>): Result<PublicStoreView> {
    const r = this.owned(code, token); if (!r.ok) return r;
    const s = r.value;
    if ('name' in body) s.name = str(body.name, 16, s.name) || s.name;
    if ('map' in body) s.map = str(body.map, 24, s.map) || s.map;
    if ('money' in body) s.money = Math.round(num(body.money, -1e6, 1e8, s.money));
    if ('rating' in body) s.rating = num(body.rating, 0, 5, s.rating);
    if ('shelves' in body) s.shelves = cleanShelves(body.shelves);
    if ('locked' in body) s.locked = body.locked === true;
    s.updatedAt = this.now(); this.persist(s);
    return { ok: true, value: this.view(s) };
  }

  get(code: string): Result<PublicStoreView> {
    const s = this.stores.get(code);
    return s ? { ok: true, value: this.view(s) } : fail(404, '找不到這家店');
  }

  /**
   * A friend finished a raid. Prototype rules: the score is reported by the raider's game (a public release must run
   * the raid on the server instead), so it is capped and each raider can hit the same store once per 10 minutes.
   */
  raid(code: string, raiderKey: string, body: Record<string, unknown>): Result<RaidReport> {
    const s = this.stores.get(code);
    if (!s) return fail(404, '找不到這家店');
    const outside = body.outside === true;
    if (s.locked && !outside) return fail(423, '店門鎖著，進不去');
    const t = this.now();
    if (t - (s.lastRaid[raiderKey] ?? -Infinity) < RAID_COOLDOWN_MS) return fail(429, '你剛搗亂過這家店，休息一下吧');
    const score = Math.round(num(body.score, 0, outside ? OUTSIDE_MAX_SCORE : RAID_MAX_SCORE, 0));
    const money = Math.min(300, Math.round(score * 0.5), Math.max(0, Math.round(s.money * 0.15)));
    const rating = Math.round(Math.min(0.3, score / 2000 * 0.3) * 100) / 100;
    const rep: RaidReport = { at: t, raider: str(body.raider, 16, '神秘客') || '神秘客', score, outside, money, rating };
    s.money -= money; s.rating = Math.max(0, Math.round((s.rating - rating) * 100) / 100);
    s.reports = [...s.reports, rep].slice(-20);
    s.lastRaid[raiderKey] = t;
    for (const [k, v] of Object.entries(s.lastRaid)) if (t - v > RAID_COOLDOWN_MS) delete s.lastRaid[k];
    s.updatedAt = t; this.persist(s);
    return { ok: true, value: rep };
  }

  /** The owner collects (and clears) the damage reports. */
  takeReports(code: string, token: unknown): Result<RaidReport[]> {
    const r = this.owned(code, token); if (!r.ok) return r;
    const out = r.value.reports; r.value.reports = []; this.persist(r.value);
    return { ok: true, value: out };
  }

  load(s: FriendStore) { if (s && typeof s.code === 'string') this.stores.set(s.code, s); }
}
