// 雲端備份 (optional, needs Google sign-in): upload / download / delete the one cloud slot of this licence, and the
// optional auto backup after a nightly save (at most every 10 minutes, off by default). Rules: shared/cloudsave.ts.
// Every failure is soft: the progress on this device is never touched by an upload, and a failed auto backup is silent.
import { CLOUD_AUTO_INTERVAL_MS, type CloudView } from '../../shared/cloudsave.ts';
import { exportSaveCode, type SaveSummary } from '../../shared/savecode.ts';
import { loadAccount } from './account.ts';
import { apiBase } from './friends.ts';

/** Per-device cloud settings (not part of a save code). */
interface CloudPrefs { auto: boolean; lastUpload: number; lastAuto: number; lastLevel?: number }
const KEY = 'fucustomer.cloud.v1';
export function loadCloudPrefs(): CloudPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { auto: v.auto === true, lastUpload: Number(v.lastUpload) || 0, lastAuto: Number(v.lastAuto) || 0, lastLevel: Number(v.lastLevel) || undefined };
  } catch { /* ignore */ }
  return { auto: false, lastUpload: 0, lastAuto: 0 };
}
export function saveCloudPrefs(p: Partial<CloudPrefs>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadCloudPrefs(), ...p })); } catch { /* ignore */ }
}

export function snapshotStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fucustomer.')) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch { /* storage blocked */ }
  return out;
}

type R<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const OFFLINE = '連不上雲端（可能沒有網路或伺服器維護中），存檔仍安全地留在這台裝置上';
async function call<T>(method: string, body?: unknown): Promise<R<T>> {
  const a = loadAccount();
  if (!a) return { ok: false, status: 401, error: '雲端備份需要先用 Google 登入' };
  try {
    const res = await fetch(apiBase() + '/api/cloudsave', {
      method, headers: { 'content-type': 'application/json', 'x-session': a.session },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error ?? (res.status >= 500 ? OFFLINE : `雲端備份失敗（${res.status}）`) };
    return { ok: true, data: data as T };
  } catch { return { ok: false, status: 0, error: OFFLINE }; }
}

export interface UploadResult { at: number; size: number; summary: SaveSummary; used: number; max: number }
export async function cloudUpload(): Promise<R<UploadResult>> {
  const r = await call<UploadResult>('PUT', { code: exportSaveCode(snapshotStorage()) });
  if (r.ok) saveCloudPrefs({ lastUpload: r.data.at, lastLevel: r.data.summary.level });
  return r;
}
export async function cloudDownload(): Promise<R<CloudView>> {
  const r = await call<CloudView>('GET');
  if (r.ok) saveCloudPrefs({ lastUpload: r.data.latest.at, lastLevel: r.data.latest.summary.level });
  else if (r.status === 404) saveCloudPrefs({ lastUpload: 0, lastLevel: undefined });
  return r;
}
export async function cloudDelete(): Promise<R<{ deleted: boolean }>> {
  const r = await call<{ deleted: boolean }>('DELETE');
  if (r.ok) saveCloudPrefs({ lastUpload: 0, lastLevel: undefined });
  return r;
}

/** After a nightly save: uploads when the player switched auto backup on, is signed in and 10 minutes have passed. */
export function maybeAutoBackup(now = Date.now()) {
  const p = loadCloudPrefs();
  if (!p.auto || !loadAccount() || now - p.lastAuto < CLOUD_AUTO_INTERVAL_MS) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  saveCloudPrefs({ lastAuto: now }); // counted even if it fails, so a flaky connection never retries in a loop
  // a moment later, so the career profile written at day end is included
  setTimeout(() => { void cloudUpload(); }, 2500);
}
