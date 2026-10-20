// One Durable Object per friend store (named by the 6-character store code), SQLite-backed.
// Same rules as server/stores.ts (StoreRegistry): the owner token is returned once and only its SHA-256 hash is kept,
// a locked store can only be "raided" from outside the door, each raider key can hit a store once per 10 minutes,
// scores are capped, and the owner collects (and clears) damage reports.
// server/stores.ts uses node:crypto, so the logic is mirrored here with WebCrypto. Keep the numbers in sync.
import { DurableObject } from 'cloudflare:workers';
import { randomToken, sha256Hex } from './auth.ts';
import type { Env } from './env.ts';

export interface RaidReport { at: number; raider: string; score: number; outside: boolean; money: number; rating: number }
export interface FriendStore {
  code: string; name: string; map: string; money: number; rating: number; shelves: Record<string, number>;
  locked: boolean; ownerHash: string; createdAt: number; updatedAt: number; reports: RaidReport[];
  lastRaid: Record<string, number>;
}
export interface PublicStoreView { code: string; name: string; map: string; rating: number; locked: boolean; shelves: Record<string, number> }

export const STORE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const STORE_CODE_LENGTH = 6;
export const RAID_COOLDOWN_MS = 10 * 60 * 1000;
export const RAID_MAX_SCORE = 2000;
export const OUTSIDE_MAX_SCORE = 30;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

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
const view = (s: FriendStore): PublicStoreView => ({ code: s.code, name: s.name, map: s.map, rating: s.rating, locked: s.locked, shelves: s.shelves });

export class StoreDO extends DurableObject<Env> {
  /** undefined = not loaded yet, null = no store with this code. */
  private s: FriendStore | null | undefined;

  private async load() {
    if (this.s === undefined) this.s = (await this.ctx.storage.get<FriendStore>('store')) ?? null;
    return this.s;
  }
  /** One row written per change (the whole store is one small JSON value; reports are capped at 20). */
  private async save(s: FriendStore) { this.s = s; await this.ctx.storage.put('store', s); }

  private async owned(token: unknown): Promise<Result<FriendStore>> {
    const s = await this.load();
    if (!s) return fail(404, '找不到這家店');
    if (typeof token !== 'string' || (await sha256Hex(token)) !== s.ownerHash) return fail(403, '不是店主');
    return { ok: true, value: s };
  }

  /** 409 means the code is taken; the worker then tries another code. */
  async create(code: string, body: Record<string, unknown>): Promise<Result<{ code: string; token: string }>> {
    if (await this.load()) return fail(409, 'code taken');
    const token = randomToken(18);
    const t = Date.now();
    const s: FriendStore = {
      code, name: str(body.name, 16, '某人的店') || '某人的店', map: str(body.map, 24, 'convenience') || 'convenience',
      money: Math.round(num(body.money, -1e6, 1e8, 0)), rating: num(body.rating, 0, 5, 3), shelves: cleanShelves(body.shelves),
      locked: body.locked === true, ownerHash: await sha256Hex(token), createdAt: t, updatedAt: t, reports: [], lastRaid: {},
    };
    await this.save(s);
    return { ok: true, value: { code, token } };
  }

  async update(token: unknown, body: Record<string, unknown>): Promise<Result<PublicStoreView>> {
    const r = await this.owned(token); if (!r.ok) return r;
    const s = r.value;
    if ('name' in body) s.name = str(body.name, 16, s.name) || s.name;
    if ('map' in body) s.map = str(body.map, 24, s.map) || s.map;
    if ('money' in body) s.money = Math.round(num(body.money, -1e6, 1e8, s.money));
    if ('rating' in body) s.rating = num(body.rating, 0, 5, s.rating);
    if ('shelves' in body) s.shelves = cleanShelves(body.shelves);
    if ('locked' in body) s.locked = body.locked === true;
    s.updatedAt = Date.now(); await this.save(s);
    return { ok: true, value: view(s) };
  }

  async get(): Promise<Result<PublicStoreView>> {
    const s = await this.load();
    return s ? { ok: true, value: view(s) } : fail(404, '找不到這家店');
  }

  async raid(raiderKey: string, body: Record<string, unknown>): Promise<Result<RaidReport>> {
    const s = await this.load();
    if (!s) return fail(404, '找不到這家店');
    const outside = body.outside === true;
    if (s.locked && !outside) return fail(423, '店門鎖著，進不去');
    const t = Date.now();
    if (t - (s.lastRaid[raiderKey] ?? -Infinity) < RAID_COOLDOWN_MS) return fail(429, '你剛搗亂過這家店，休息一下吧');
    const score = Math.round(num(body.score, 0, outside ? OUTSIDE_MAX_SCORE : RAID_MAX_SCORE, 0));
    const money = Math.min(300, Math.round(score * 0.5), Math.max(0, Math.round(s.money * 0.15)));
    const rating = Math.round(Math.min(0.3, score / 2000 * 0.3) * 100) / 100;
    const rep: RaidReport = { at: t, raider: str(body.raider, 16, '神秘客') || '神秘客', score, outside, money, rating };
    s.money -= money; s.rating = Math.max(0, Math.round((s.rating - rating) * 100) / 100);
    s.reports = [...s.reports, rep].slice(-20);
    s.lastRaid[raiderKey] = t;
    for (const [k, v] of Object.entries(s.lastRaid)) if (t - v > RAID_COOLDOWN_MS) delete s.lastRaid[k];
    s.updatedAt = t; await this.save(s);
    return { ok: true, value: rep };
  }

  async takeReports(token: unknown): Promise<Result<RaidReport[]>> {
    const r = await this.owned(token); if (!r.ok) return r;
    const out = r.value.reports;
    if (out.length) { r.value.reports = []; await this.save(r.value); } // skip the write when there is nothing to clear
    return { ok: true, value: out };
  }
}
