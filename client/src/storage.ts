// Local persistence. Store progress and player settings are kept under separate keys.
import type { StoreSave } from '../../shared/protocol.ts';

export type Quality = 'low' | 'medium' | 'high';
export interface Settings {
  name: string; sensitivity: number; invertY: boolean; quality: Quality; volume: number; serverUrl: string; showFps: boolean; fov: number;
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

export function loadSettings(): Settings {
  const d: Settings = {
    name: '', sensitivity: 1, invertY: false, quality: isTouch ? 'low' : 'high', volume: 0.7, serverUrl: '', showFps: false, fov: 75,
  };
  return { ...d, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}
export function saveSettings(s: Settings) { write(SETTINGS_KEY, s); }

export function loadSoloSave(): StoreSave | null { return read<StoreSave>(SOLO_KEY); }
export function saveSoloSave(s: StoreSave) { write(SOLO_KEY, s); }
export function clearSoloSave() { try { localStorage.removeItem(SOLO_KEY); } catch { /* ignore */ } }
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
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    if (location.port === '5173') return `ws://${location.hostname}:8787/ws`; // vite dev server
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  return 'ws://localhost:8787/ws';
}
