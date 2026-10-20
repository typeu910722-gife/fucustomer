// Google sign-in for the Cloudflare worker: the same checks as server/auth.ts (verifyGoogleIdToken), ported to
// WebCrypto. No secrets involved: the ID token is checked against Google's public keys and the public OAuth client ID.
// Pure WebCrypto + fetch, so it also runs under Node 20+ (the tests import it directly with a stand-in key).

export interface GoogleClaims { sub: string; aud: string; iss: string; exp: number; name?: string }
export type Jwk = JsonWebKey & { kid?: string };
export type KeyFetcher = () => Promise<Jwk[]>;

export const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

const certCache = new Map<string, { keys: Jwk[]; until: number }>();
/** Fetches (and caches per isolate, honouring Cache-Control max-age) the JWKS at `url`. */
export function jwksFetcher(url = GOOGLE_CERTS): KeyFetcher {
  return async () => {
    const c = certCache.get(url);
    if (c && c.until > Date.now()) return c.keys;
    const res = await fetch(url);
    if (!res.ok) throw new Error('google certs ' + res.status);
    const age = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    const keys = ((await res.json()) as { keys: Jwk[] }).keys;
    certCache.set(url, { keys, until: Date.now() + age * 1000 });
    return keys;
  };
}

function b64urlBytes(s: string) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/** Returns the verified claims, or null when the token is not a valid Google ID token for our client. */
export async function verifyGoogleIdToken(token: unknown, clientId: string, keys: KeyFetcher = jwksFetcher(), now = Date.now()): Promise<GoogleClaims | null> {
  if (typeof token !== 'string' || token.length > 4096 || !clientId) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = b64urlJson(parts[0]) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256') return null;
    const jwk = (await keys()).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const { kty, n, e } = jwk; // import only the public parts (some JWKS entries carry alg/use/key_ops)
    const key = await crypto.subtle.importKey('jwk', { kty, n, e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const c = b64urlJson(parts[1]) as GoogleClaims;
    if (c.aud !== clientId) return null;
    if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') return null;
    if (typeof c.exp !== 'number' || c.exp * 1000 < now) return null;
    if (typeof c.sub !== 'string' || !c.sub) return null;
    return c;
  } catch { return null; }
}

export async function sha256Hex(t: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes: number) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
