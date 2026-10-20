// Local persistence. Store progress and player settings are kept under separate keys.
import type { StoreSave } from '../../shared/protocol.ts';
import { cleanSettings } from '../../shared/savecode.ts';

export type Quality = 'low' | 'medium' | 'high';
export interface Settings {
  name: string; sensitivity: number; invertY: boolean; quality: Quality; volume: number; music: number; serverUrl: string; showFps: boolean; fov: number;
  fpsCap: number; adaptive: boolean;
  /** 主音量 (master); `volume` is the sound-effects volume and `music` the music volume. */
  master: number;
  /** Controller: right-stick look sensitivity, its own invert-Y, rumble. */
  padSens: number; padInvertY: boolean; rumble: boolean;
  /** 解析度比例 0.5–1 (the dynamic-resolution option never goes above it). */
  renderScale: number;
  /** Desktop app: start in full screen (the browser can only enter full screen from a click). */
  fullscreen: boolean;
  /** 畫面震動 (camera shake on hits / throws). */
  shake: boolean;
  /** 減少動態效果: no shake, hit-stop / slow-mo, or full-screen flashes (sounds and rumble stay). */
  reduceMotion: boolean;
}

const SETTINGS_KEY = 'fucustomer.settings.v1';
const SOLO_KEY = 'fucustomer.store.solo.v1';
const COOP_KEY = 'fucustomer.store.coop.v1';
const SESSION_KEY = 'fucustomer.session.v1';

export const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

function read<T>(key: string): T | null {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full / private mode */ }
}

export function defaultSettings(touch = isTouch): Settings {
  return {
    name: '', sensitivity: 1, invertY: false, quality: touch ? 'low' : 'high', volume: 0.7, music: 0.5, serverUrl: '', showFps: false, fov: 75, fpsCap: touch ? 30 : 0, adaptive: true,
    master: 1, padSens: 1, padInvertY: false, rumble: true, renderScale: 1, fullscreen: true, shake: true, reduceMotion: false,
  };
}
/** Defaults + whitelisted, range-clamped stored values (a hand-edited or old settings blob can't break the game). */
export function sanitizeSettings(raw: unknown, touch = isTouch): Settings {
  const d = defaultSettings(touch);
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const url = typeof r.serverUrl === 'string' && /^wss?:\/\/[^\s]{1,200}$/.test(r.serverUrl.trim()) ? r.serverUrl.trim() : '';
  return { ...d, ...(cleanSettings(r) as Partial<Settings>), serverUrl: url };
}
export function loadSettings(): Settings { return sanitizeSettings(read<unknown>(SETTINGS_KEY)); }
export function saveSettings(s: Settings) { write(SETTINGS_KEY, s); }

/** Free-play saves: one per map (the 便利商店 keeps the original key so old saves still load). */
const soloKey = (map: string) => (map === 'convenience' ? SOLO_KEY : `fucustomer.store.solo.${map}.v1`);
export function loadSoloSave(map = 'convenience'): StoreSave | null { return read<StoreSave>(soloKey(map)); }
export function saveSoloSave(s: StoreSave, map = 'convenience') { write(soloKey(map), s); }
export function clearSoloSave(map = 'convenience') { try { localStorage.removeItem(soloKey(map)); } catch { /* ignore */ } }
/** 自由營業: whether 小陳 is hired, per store save (map id). */
const HIRE_KEY = 'fucustomer.freeplay.staff.v1';
export function loadFreeplayHires(): Record<string, boolean> {
  const v = read<Record<string, unknown>>(HIRE_KEY) ?? {};
  return Object.fromEntries(Object.entries(v).filter(([, b]) => b === true)) as Record<string, boolean>;
}
export function saveFreeplayHire(map: string, hired: boolean) {
  const v = loadFreeplayHires();
  if (hired) v[map] = true; else delete v[map];
  write(HIRE_KEY, v);
}
export function loadCoopSave(): StoreSave | null { return read<StoreSave>(COOP_KEY); }
export function saveCoopSave(s: StoreSave) { write(COOP_KEY, s); }

/** Last multiplayer session so a relaunched app (or a killed mobile tab) can rejoin. */
export interface LastSession { code: string; token: string; name: string; url: string; at: number }
export function loadLastSession(): LastSession | null { return read<LastSession>(SESSION_KEY); }
export function saveLastSession(s: LastSession | null) {
  if (!s) { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } return; }
  write(SESSION_KEY, s);
}

export function detectPlatform(): string {
  const w = window as unknown as { Capacitor?: { getPlatform?: () => string }; electronAPI?: unknown };
  const cap = w.Capacitor?.getPlatform?.();
  if (cap === 'ios' || cap === 'android') return cap;
  if (navigator.userAgent.includes('Electron')) return 'steam-pc';
  return isTouch ? 'web-mobile' : 'web';
}

export function defaultServerUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  // Inside the iOS/Android app the page origin is the app itself, not a game server.
  if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return 'ws://localhost:8787/ws';
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    if (location.port === '5173') return `ws://${location.hostname}:8787/ws`; // vite dev server
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  return 'ws://localhost:8787/ws';
}

/** One-time UI flags: tutorial finished/skipped and which karen intro cards were already shown. */
export interface Flags { tutorialDone: boolean; seenKarens: string[]; seenMaps: string[]; shelfTipDone?: boolean }
const FLAGS_KEY = 'fucustomer.flags.v1';
export function loadFlags(): Flags {
  const f = read<Partial<Flags>>(FLAGS_KEY) ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, 64) : []);
  return { tutorialDone: f.tutorialDone === true, seenKarens: list(f.seenKarens), seenMaps: list(f.seenMaps), shelfTipDone: f.shelfTipDone === true };
}
export function saveFlags(f: Flags) { write(FLAGS_KEY, f); }
