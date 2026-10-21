// 雲端備份 on the Node server: same rules as the Cloudflare LicenseDO (shared/cloudsave.ts). One slot per licence,
// keyed by the licence owner (SHA-256 of the Google account id, the same key as the licence card).
import {
  CLOUD_ERR, CLOUD_MAX_SLOTS, CLOUD_MIN_INTERVAL_MS, CLOUD_RETENTION_MS, CloudOpsCounter, type CloudRecord, type CloudResult, type CloudView,
  applyUpload, checkUploadQuota, prepareUpload, utcDay, viewRecord,
} from '../shared/cloudsave.ts';
import type { SaveSummary } from '../shared/savecode.ts';

export interface CloudSaveOptions {
  /** Resolves a session token to the licence owner (LicenseRegistry.ownerOf). */
  ownerOf: (session: unknown) => string | null;
  /** Persistence hook: called with the new record, or null when the slot is deleted. */
  persist?: (owner: string, rec: CloudRecord | null) => void;
  now?: () => number;
  minIntervalMs?: number;
  maxSlots?: number;
  ops?: CloudOpsCounter;
}

export class CloudSaveStore {
  slots = new Map<string, CloudRecord>();
  private prunedDay = '';
  private ops: CloudOpsCounter;
  constructor(private o: CloudSaveOptions) { this.ops = o.ops ?? new CloudOpsCounter(); }
  private now() { return (this.o.now ?? Date.now)(); }
  load(owner: string, rec: CloudRecord) { if (owner && rec?.latest?.code) this.slots.set(owner, rec); }

  /** Common gate: signed in + server-wide daily budget. */
  private gate(session: unknown): CloudResult<string> {
    const owner = this.o.ownerOf(session);
    if (!owner) return CLOUD_ERR.auth;
    if (!this.ops.take(this.now())) return CLOUD_ERR.busy;
    return { ok: true, value: owner };
  }
  private prune() {
    const t = this.now(), d = utcDay(t);
    if (d === this.prunedDay) return;
    this.prunedDay = d;
    for (const [owner, r] of this.slots) if (r.lastAt < t - CLOUD_RETENTION_MS) { this.slots.delete(owner); this.o.persist?.(owner, null); }
  }

  put(session: unknown, body: unknown): CloudResult<{ at: number; size: number; summary: SaveSummary; used: number; max: number }> {
    // same order as the Cloudflare worker: no session → 401, bad code → 400 (before any storage work), then auth + budget
    if (typeof session !== 'string' || !session) return CLOUD_ERR.auth;
    const p = prepareUpload(body); if (!p.ok) return p;
    const g = this.gate(session); if (!g.ok) return g;
    this.prune();
    const owner = g.value, t = this.now(), rec = this.slots.get(owner) ?? null;
    if (!rec && this.slots.size >= (this.o.maxSlots ?? CLOUD_MAX_SLOTS)) return CLOUD_ERR.full;
    const q = checkUploadQuota(rec, t, this.o.minIntervalMs ?? CLOUD_MIN_INTERVAL_MS); if (!q.ok) return q;
    const next = applyUpload(rec, p.value.code, p.value.summary, t);
    this.slots.set(owner, next); this.o.persist?.(owner, next);
    const v = viewRecord(next, t);
    return { ok: true, value: { at: next.latest.at, size: next.latest.size, summary: next.latest.summary, used: v.quota.used, max: v.quota.max } };
  }
  get(session: unknown): CloudResult<CloudView> {
    const g = this.gate(session); if (!g.ok) return g;
    const rec = this.slots.get(g.value);
    return rec ? { ok: true, value: viewRecord(rec, this.now()) } : CLOUD_ERR.none;
  }
  delete(session: unknown): CloudResult<{ deleted: boolean }> {
    const g = this.gate(session); if (!g.ok) return g;
    const had = this.slots.delete(g.value);
    if (had) this.o.persist?.(g.value, null);
    return { ok: true, value: { deleted: had } };
  }
}
