import type { RoomDO } from './room-do.ts';
import type { StoreDO } from './store-do.ts';
import type { LicenseDO } from './license-do.ts';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  STORES: DurableObjectNamespace<StoreDO>;
  LICENSES: DurableObjectNamespace<LicenseDO>;
  /** Public Google OAuth web client ID. Empty = Google sign-in off (GET /api/auth/config returns null). Not a secret. */
  GOOGLE_CLIENT_ID?: string;
  /** Test-only: JWKS URL standing in for Google's keys. Only honoured for http://127.0.0.1 / localhost URLs. */
  GOOGLE_CERTS_URL?: string;
  /** Test-only simulation fast-forward (string from wrangler vars). Keep "1" in production. */
  BK_TIME_SCALE?: string;
}

/** Shared limits (same numbers as server/index.ts). */
export const MAX_MSG_BYTES = 4096;
export const MAX_MSGS_PER_SEC = 80;

/** WebSocket close reasons must fit in 123 UTF-8 bytes; Chinese text sliced by characters can be longer. */
export function closeReason(reason: string) {
  const enc = new TextEncoder();
  let r = reason;
  while (enc.encode(r).length > 120) r = r.slice(0, -1);
  return r;
}
