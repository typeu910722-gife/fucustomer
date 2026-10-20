// 存檔備份: moves local progress between devices (web ↔ Android ↔ Windows) without an account.
// The code is `FUC1-<base64url(JSON)>-<checksum>`. The checksum only catches typos / truncated copies; it is not a
// signature (progress is local and self-reported anyway, same as editing localStorage).
//
// What travels: career profile (fucustomer.career.v1), settings, one-time flags, avatar, free-play saves and the
// co-op save. What never travels:
//  - fucustomer.account.v1 (Google sign-in session = a credential) and fucustomer.session.v1 (multiplayer rejoin token);
//  - settings.serverUrl (device-specific, and a shared code must not be able to point someone at another server);
//  - paid-pack entitlements (shop.entitlements). They are only granted by a platform purchase / 「恢復購買」, so an
//    import keeps whatever entitlements THIS device already has and never adds any. Cosmetics bought with 薪資點數
//    (shop.owned, which sanitizeShop already limits to points-priced items) are progress and do travel.
// Pure functions (no DOM) so tests can run in node; the client wires them to localStorage in backup-ui.ts.
import { CareerProfile, rankOf, sanitizeProfile } from './career.ts';
import { getCosmetic } from './shop.ts';
import { sanitizeSave } from './sim.ts';
import { MAPS } from './maps/index.ts';
import type { StoreSave } from './protocol.ts';

export const SAVE_PREFIX = 'FUC1-';
/** Longest code accepted (characters). Real codes are a few KB. */
export const MAX_CODE_LEN = 200_000;

export const K = {
  career: 'fucustomer.career.v1', settings: 'fucustomer.settings.v1', flags: 'fucustomer.flags.v1', avatar: 'fucustomer.avatar.v1',
  coop: 'fucustomer.store.coop.v1', soloConv: 'fucustomer.store.solo.v1', account: 'fucustomer.account.v1', session: 'fucustomer.session.v1',
} as const;
/** Keys an import must never write or remove. */
export const PROTECTED_KEYS: readonly string[] = [K.account];
const soloKey = (map: string) => (map === 'convenience' ? K.soloConv : `fucustomer.store.solo.${map}.v1`);
const MAP_IDS = new Set(MAPS.map(m => m.id));

export interface SavePayload {
  v: 1;
  /** Export time (ms). */
  at: number;
  career: CareerProfile;
  settings: Record<string, string | number | boolean>;
  flags: { tutorialDone: boolean; seenKarens: string[]; seenMaps: string[] };
  avatar: string | null;
  solo: Record<string, StoreSave>;
  coop: StoreSave | null;
}

export interface SaveSummary {
  level: number; rank: string; stars: number; wallet: number; shifts: number; achievements: number; cosmetics: number;
  soloSaves: number; ownStore: boolean; at: number;
}

// ---------------- encoding helpers ----------------
function toB64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): string {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
/** FNV-1a 32-bit, 8 hex chars. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------- sanitizers ----------------
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const idList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(k)))].slice(0, 64) : []);

function cleanSettings(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!isObj(v)) return out;
  const num = (k: string, lo: number, hi: number) => { const x = v[k]; if (typeof x === 'number' && Number.isFinite(x)) out[k] = Math.max(lo, Math.min(hi, x)); };
  const bool = (k: string) => { if (typeof v[k] === 'boolean') out[k] = v[k] as boolean; };
  if (typeof v.name === 'string') out.name = v.name.slice(0, 16);
  num('sensitivity', 0.2, 3); num('fov', 60, 100); num('volume', 0, 1); num('music', 0, 1);
  if (v.quality === 'low' || v.quality === 'medium' || v.quality === 'high') out.quality = v.quality;
  if (v.fpsCap === 0 || v.fpsCap === 30 || v.fpsCap === 60) out.fpsCap = v.fpsCap;
  bool('invertY'); bool('showFps'); bool('adaptive');
  return out; // serverUrl is deliberately dropped
}

/** Strips paid-pack entitlements and premium equipped items the receiving device doesn't own. */
function stripPremium(p: CareerProfile, keep: readonly string[]) {
  p.shop.entitlements = [...keep];
  for (const [slot, id] of Object.entries(p.shop.equipped)) {
    const c = getCosmetic(id);
    if (!c || (c.pack && !keep.includes(c.pack))) delete p.shop.equipped[slot as keyof typeof p.shop.equipped];
  }
}

const parseJson = (s: string | null | undefined): unknown => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };

// ---------------- export ----------------
/**
 * Builds a code from raw localStorage contents (key → string). `now` is the export time.
 * Only fucustomer.* keys listed above are read; anything else (including the account) is ignored.
 */
export function exportSaveCode(store: Record<string, string | null | undefined>, now = Date.now()): string {
  const career = sanitizeProfile(parseJson(store[K.career]));
  career.shop.entitlements = []; // paid packs are restored from the platform store, never from a code
  const f = parseJson(store[K.flags]);
  const solo: Record<string, StoreSave> = {};
  for (const m of MAP_IDS) { const s = parseJson(store[soloKey(m)]); if (isObj(s)) solo[m] = sanitizeSave(s); }
  const coop = parseJson(store[K.coop]);
  const av = store[K.avatar];
  const payload: SavePayload = {
    v: 1, at: Math.floor(now), career,
    settings: cleanSettings(parseJson(store[K.settings])),
    flags: { tutorialDone: isObj(f) && f.tutorialDone === true, seenKarens: idList(isObj(f) ? f.seenKarens : null), seenMaps: idList(isObj(f) ? f.seenMaps : null) },
    avatar: typeof av === 'string' && av.length <= 16 ? av : null,
    solo, coop: isObj(coop) ? sanitizeSave(coop) : null,
  };
  const body = toB64url(JSON.stringify(payload));
  return `${SAVE_PREFIX}${body}-${checksum(body)}`;
}

// ---------------- import ----------------
export type ParseResult = { ok: true; payload: SavePayload; summary: SaveSummary } | { ok: false; error: string };

/** Strictly validates a pasted code. Whitespace / line breaks (from chat apps) are ignored. */
export function parseSaveCode(input: unknown): ParseResult {
  if (typeof input !== 'string') return { ok: false, error: '存檔碼格式不對' };
  if (input.length > MAX_CODE_LEN) return { ok: false, error: '存檔碼太長了（超過 200KB），可能貼錯內容' };
  const code = input.replace(/\s+/g, '');
  if (!code) return { ok: false, error: '請先貼上存檔碼' };
  if (!code.startsWith(SAVE_PREFIX)) return { ok: false, error: '這不是《奧客退散》的存檔碼（開頭應該是 FUC1-）' };
  const m = /^FUC1-([A-Za-z0-9_-]+)-([0-9a-f]{8})$/.exec(code);
  if (!m) return { ok: false, error: '存檔碼格式不對，可能沒有複製完整' };
  const [, body, sum] = m;
  if (checksum(body) !== sum) return { ok: false, error: '存檔碼檢查碼不符，可能少複製或改到了幾個字' };
  let raw: unknown;
  try { raw = JSON.parse(fromB64url(body)); } catch { return { ok: false, error: '存檔碼內容損壞，無法讀取' }; }
  if (!isObj(raw)) return { ok: false, error: '存檔碼內容損壞，無法讀取' };
  if (raw.v !== 1) return { ok: false, error: '這個存檔碼是更新版本的遊戲做的，請先更新遊戲' };
  // shape check: wrong types are rejected outright instead of being silently replaced by defaults
  const c = raw.career;
  if (!isObj(c) || c.version !== 1 || typeof c.level !== 'number' || typeof c.exp !== 'number' || typeof c.wallet !== 'number'
    || !isObj(c.stars) || !isObj(c.stats) || (c.shop !== undefined && !isObj(c.shop))) return { ok: false, error: '存檔碼裡的職涯資料格式不對' };
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return { ok: false, error: '存檔碼內容損壞，無法讀取' };
  if (!isObj(raw.settings) || !isObj(raw.flags) || !isObj(raw.solo)) return { ok: false, error: '存檔碼內容損壞，無法讀取' };
  if (raw.avatar !== null && typeof raw.avatar !== 'string') return { ok: false, error: '存檔碼內容損壞，無法讀取' };
  if (raw.coop !== null && !isObj(raw.coop)) return { ok: false, error: '存檔碼內容損壞，無法讀取' };
  for (const [k, s] of Object.entries(raw.solo)) if (!MAP_IDS.has(k) || !isObj(s)) return { ok: false, error: '存檔碼裡的自由營業存檔格式不對' };

  const career = sanitizeProfile(c);
  career.shop.entitlements = []; // never trust entitlements from a code; applySave() puts back this device's own
  const solo: Record<string, StoreSave> = {};
  for (const [k, s] of Object.entries(raw.solo)) solo[k] = sanitizeSave(s);
  const f = raw.flags;
  const payload: SavePayload = {
    v: 1, at: Math.floor(raw.at), career, settings: cleanSettings(raw.settings),
    flags: { tutorialDone: f.tutorialDone === true, seenKarens: idList(f.seenKarens), seenMaps: idList(f.seenMaps) },
    avatar: typeof raw.avatar === 'string' && raw.avatar.length <= 16 ? raw.avatar : null,
    solo, coop: isObj(raw.coop) ? sanitizeSave(raw.coop) : null,
  };
  return { ok: true, payload, summary: summarize(payload.career, Object.keys(solo).length, payload.at) };
}

export function summarize(p: CareerProfile, soloSaves: number, at = 0): SaveSummary {
  return {
    level: p.level, rank: rankOf(p.level), stars: Object.values(p.stars).reduce((a, b) => a + b, 0), wallet: p.wallet,
    shifts: p.stats.shifts, achievements: p.achievements.length, cosmetics: p.shop.owned.length, soloSaves, ownStore: !!p.store, at,
  };
}

/** Summary of what is on this device right now (shown next to the incoming one). */
export function summarizeStore(store: Record<string, string | null | undefined>): SaveSummary {
  const p = sanitizeProfile(parseJson(store[K.career]));
  return summarize(p, [...MAP_IDS].filter(m => isObj(parseJson(store[soloKey(m)]))).length);
}

/**
 * What an import writes: every progress key is replaced (keys absent from the code are removed), the account stays,
 * the rejoin session is cleared, and this device's own entitlements + serverUrl are kept.
 */
export function applySave(payload: SavePayload, current: Record<string, string | null | undefined>): { set: Record<string, string>; remove: string[] } {
  const curCareer = sanitizeProfile(parseJson(current[K.career]));
  const career: CareerProfile = JSON.parse(JSON.stringify(payload.career));
  stripPremium(career, curCareer.shop.entitlements);
  const curSettings = parseJson(current[K.settings]);
  const settings: Record<string, unknown> = { ...(isObj(curSettings) ? curSettings : {}), ...payload.settings };
  const set: Record<string, string> = {
    [K.career]: JSON.stringify(career), [K.settings]: JSON.stringify(settings), [K.flags]: JSON.stringify(payload.flags),
  };
  if (payload.avatar) set[K.avatar] = payload.avatar;
  if (payload.coop) set[K.coop] = JSON.stringify(payload.coop);
  for (const [m, s] of Object.entries(payload.solo)) set[soloKey(m)] = JSON.stringify(s);
  // only keys this module knows are progress (plus the rejoin session) are removed; unknown keys are left alone
  const progress = (k: string) => k === K.avatar || k === K.coop || k === K.session || /^fucustomer\.store\.solo\.([a-z0-9_-]+\.)?v1$/.test(k);
  const remove = Object.keys(current).filter(k => progress(k) && !(k in set) && !PROTECTED_KEYS.includes(k));
  return { set, remove };
}
