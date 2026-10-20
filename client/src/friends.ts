// Friend-store API (talks to the game server's /api/stores). Prototype: needs a running game server.
import type { OwnStore } from '../../shared/ownstore.ts';
import type { FriendStoreView } from '../../shared/raid.ts';
import { defaultServerUrl, loadSettings } from './storage.ts';

export interface RaidReport { at: number; raider: string; score: number; outside: boolean; money: number; rating: number }
type R<T> = { ok: true; data: T } | { ok: false; error: string };

function base() {
  const ws = loadSettings().serverUrl || defaultServerUrl();
  return ws.replace(/^ws/, 'http').replace(/\/ws$/, '');
}
async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<R<T>> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['x-owner-token'] = token;
    const res = await fetch(base() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `伺服器錯誤 ${res.status}` };
    return { ok: true, data: data as T };
  } catch { return { ok: false, error: '連不上遊戲伺服器（好友功能需要本機或公開的遊戲伺服器）' }; }
}
const snapshotOf = (st: OwnStore, locked: boolean) => ({ name: st.name, map: st.map, money: st.save.money, rating: st.save.rating, shelves: st.save.shelves, locked });

export const uploadStore = (st: OwnStore) => call<{ code: string; token: string }>('POST', '/api/stores', snapshotOf(st, false));
export const syncStore = (st: OwnStore) => (st.online ? call<FriendStoreView>('PUT', `/api/stores/${st.online.code}`, snapshotOf(st, st.online.locked), st.online.token) : Promise.resolve({ ok: false, error: '還沒上傳' } as R<FriendStoreView>));
export const getStore = (code: string) => call<FriendStoreView>('GET', `/api/stores/${encodeURIComponent(code)}`);
export const sendRaid = (code: string, raider: string, score: number, outside: boolean) => call<RaidReport>('POST', `/api/stores/${encodeURIComponent(code)}/raid`, { raider, score, outside });
export const takeReports = (st: OwnStore) => (st.online ? call<RaidReport[]>('GET', `/api/stores/${st.online.code}/reports`, undefined, st.online.token) : Promise.resolve({ ok: true, data: [] } as R<RaidReport[]>));
