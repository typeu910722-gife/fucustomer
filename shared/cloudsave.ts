// 雲端備份 (optional, signed-in players only): one slot per licence holding the newest save code plus the one before it.
// The rules live here so the Node server (server/cloudsave.ts) and the Cloudflare LicenseDO behave the same.
// Limits are chosen to keep a small player base well inside the Cloudflare Workers Free plan — see docs/CLOUD-SAVE.md.
//
// What is stored is NOT the uploaded text: the code is parsed with parseSaveCode (strict validation; paid-pack
// entitlements are dropped there) and re-encoded, so a cloud copy can never carry entitlements, the Google session,
// the rejoin token or a custom server URL. A restore then goes through the same applySave() as a pasted code, which
// keeps the receiving device's own entitlements and adds none.
import { encodeSavePayload, parseSaveCode, type SaveSummary } from './savecode.ts';

/** Longest stored code (characters). Real codes are ~10–20 KB. */
export const CLOUD_MAX_CODE = 64 * 1024;
/** Longest request body accepted for an upload (JSON `{ "code": "FUC1-…" }`, whitespace in the code is ignored). */
export const CLOUD_MAX_BODY = 72 * 1024;
/** Uploads per account per UTC day (Cloudflare's free daily limits also reset at 00:00 UTC). */
export const CLOUD_UPLOADS_PER_DAY = 20;
/** Minimum time between two uploads of one account (the game's auto backup waits at least 10 minutes). */
export const CLOUD_MIN_INTERVAL_MS = 60_000;
/** The game's own auto-backup spacing (client side). */
export const CLOUD_AUTO_INTERVAL_MS = 10 * 60_000;
/** Safety valves for the whole server: cloud-save requests (upload / download / delete) per UTC day, and slots. */
export const CLOUD_GLOBAL_OPS_PER_DAY = 15_000;
export const CLOUD_MAX_SLOTS = 20_000;
/** A slot nobody has uploaded to for this long is deleted. */
export const CLOUD_RETENTION_MS = 365 * 24 * 3600_000;

export interface CloudEntry { code: string; at: number; size: number; summary: SaveSummary }
export interface CloudRecord { latest: CloudEntry; prev?: CloudEntry; day: string; n: number; lastAt: number }
/** What GET returns. */
export interface CloudView {
  latest: CloudEntry; prev: CloudEntry | null;
  quota: { used: number; max: number; resetsAt: number };
}
export type CloudResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

// ---------------- client-side shape checks ----------------
// A 200 answer is not always ours: a captive portal / proxy can answer with an HTML page, a broken deploy with `{}`.
// The game checks the shape before it uses the data (round 30 monkey sweep: a 200 HTML page after 上傳到雲端 threw
// "Cannot read properties of undefined (reading 'level')" and left the buttons disabled).
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSummary = (v: unknown) => isObj(v) && isNum(v.level);
const isEntry = (v: unknown) => isObj(v) && typeof v.code === 'string' && isNum(v.at) && isSummary(v.summary);
/** PUT answer: { at, size, summary, used, max }. */
export function isUploadAnswer(v: unknown): boolean { return isObj(v) && isNum(v.at) && isSummary(v.summary) && isNum(v.used) && isNum(v.max); }
/** GET answer (CloudView): latest entry, prev entry or null. */
export function isCloudView(v: unknown): boolean { return isObj(v) && isEntry(v.latest) && (v.prev == null || isEntry(v.prev)); }
/** DELETE answer: { deleted }. */
export function isDeleteAnswer(v: unknown): boolean { return isObj(v) && typeof v.deleted === 'boolean'; }

export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const nextUtcMidnight = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

export const CLOUD_ERR = {
  auth: { ok: false, status: 401, error: '請先用 Google 登入（登入已過期的話請重新登入）' },
  none: { ok: false, status: 404, error: '雲端上還沒有存檔' },
  busy: { ok: false, status: 503, error: '雲端備份今天的額度用完了，明天（台灣時間早上 8 點後）再試；存檔仍安全地留在這台裝置上' },
  full: { ok: false, status: 503, error: '雲端備份空間暫時滿了，存檔仍安全地留在這台裝置上' },
  big: { ok: false, status: 413, error: '存檔太大了，無法上傳到雲端（請改用存檔碼備份）' },
} as const;

/** Validates an upload body and returns the canonical (re-encoded, entitlement-free) code and its summary. */
export function prepareUpload(body: unknown): CloudResult<{ code: string; summary: SaveSummary }> {
  const raw = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  if (typeof raw !== 'string' || !raw) return { ok: false, status: 400, error: '沒有收到存檔' };
  if (raw.length > CLOUD_MAX_BODY) return CLOUD_ERR.big;
  const r = parseSaveCode(raw);
  if (!r.ok) return { ok: false, status: 400, error: r.error };
  const code = encodeSavePayload(r.payload);
  if (code.length > CLOUD_MAX_CODE) return CLOUD_ERR.big;
  return { ok: true, value: { code, summary: r.summary } };
}

/** Per-account limits; `minIntervalMs` is CLOUD_MIN_INTERVAL_MS except in tests. */
export function checkUploadQuota(rec: CloudRecord | null, now: number, minIntervalMs = CLOUD_MIN_INTERVAL_MS): CloudResult<null> {
  if (!rec) return { ok: true, value: null };
  if (rec.day === utcDay(now) && rec.n >= CLOUD_UPLOADS_PER_DAY) return { ok: false, status: 429, error: `今天已經上傳 ${CLOUD_UPLOADS_PER_DAY} 次了，明天再試（存檔仍在這台裝置上）` };
  const wait = rec.lastAt + minIntervalMs - now;
  if (wait > 0) return { ok: false, status: 429, error: `剛剛才上傳過，請 ${Math.ceil(wait / 1000)} 秒後再試` };
  return { ok: true, value: null };
}

/** The record after a successful upload: the old newest copy becomes the previous version. */
export function applyUpload(rec: CloudRecord | null, code: string, summary: SaveSummary, now: number): CloudRecord {
  const day = utcDay(now);
  return {
    latest: { code, at: now, size: code.length, summary }, prev: rec?.latest,
    day, n: rec && rec.day === day ? rec.n + 1 : 1, lastAt: now,
  };
}

export function viewRecord(rec: CloudRecord, now: number): CloudView {
  return {
    latest: rec.latest, prev: rec.prev ?? null,
    quota: { used: rec.day === utcDay(now) ? rec.n : 0, max: CLOUD_UPLOADS_PER_DAY, resetsAt: nextUtcMidnight(now) },
  };
}

/** Server-wide daily counter of cloud-save requests (best effort; in memory, flushed now and then by the caller). */
export class CloudOpsCounter {
  day = ''; n = 0;
  constructor(private max = CLOUD_GLOBAL_OPS_PER_DAY) {}
  /** Counts one request; false when today's budget is used up. */
  take(now: number): boolean {
    const d = utcDay(now);
    if (d !== this.day) { this.day = d; this.n = 0; }
    if (this.n >= this.max) return false;
    this.n++;
    return true;
  }
}
