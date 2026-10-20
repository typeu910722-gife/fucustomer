// Google sign-in (Google Identity Services) and the 高級社畜證照 (licence card) friends can look up.
// The OAuth client ID comes from the game server (/api/auth/config) or VITE_GOOGLE_CLIENT_ID; it is public, not a secret.
import { apiBase } from './friends.ts';

export interface LicenseCard {
  no: string; name: string; level: number; rank: string; title: string; avatar: string;
  stars: number; achievements: number; storeName: string; quote: string; updatedAt: number;
  /** 商城: equipped hat id and supporter badge. */
  hat?: string; supporter?: boolean;
}
interface Account { no: string; session: string }
const KEY = 'fucustomer.account.v1';

export function loadAccount(): Account | null {
  try { const a = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return a && typeof a.no === 'string' && typeof a.session === 'string' ? a : null; } catch { return null; }
}
function saveAccount(a: Account | null) { try { if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY); } catch { /* ignore */ } }

type R<T> = { ok: true; data: T } | { ok: false; error: string };
async function call<T>(method: string, path: string, body?: unknown, session?: string): Promise<R<T>> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (session) headers['x-session'] = session;
    const res = await fetch(apiBase() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `伺服器錯誤 ${res.status}` };
    return { ok: true, data: data as T };
  } catch { return { ok: false, error: '連不上遊戲伺服器' }; }
}

let clientIdPromise: Promise<string | null> | null = null;
/** The Google OAuth client ID, or null when sign-in isn't set up yet. */
export function googleClientId(): Promise<string | null> {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  if (env.VITE_GOOGLE_CLIENT_ID) return Promise.resolve(env.VITE_GOOGLE_CLIENT_ID);
  clientIdPromise ??= call<{ googleClientId: string | null }>('GET', '/api/auth/config').then(r => (r.ok ? r.data.googleClientId : null));
  return clientIdPromise;
}

interface Gis { accounts: { id: { initialize(o: object): void; renderButton(el: HTMLElement, o: object): void; disableAutoSelect(): void } } }
let gisPromise: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => { const g = (window as unknown as { google?: Gis }).google; if (g) resolve(g); else reject(new Error('gis')); };
    s.onerror = () => { gisPromise = null; reject(new Error('gis')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Puts Google's own sign-in button into `el`. Resolves to a message when sign-in isn't available.
 *  Inside the iOS/Android app Google refuses to sign in from the WebView, so there it becomes a "sign in with the
 *  browser" button instead (see applink.ts). */
export async function renderGoogleButton(el: HTMLElement, onSignedIn: (card: LicenseCard) => void, onError: (msg: string) => void): Promise<void> {
  if (isNativeApp()) { const { renderAppLinkButton } = await import('./applink.ts'); renderAppLinkButton(el, onSignedIn); return; }
  const id = await googleClientId();
  if (!id) { onError('Google 登入還沒設定（需要遊戲伺服器設定 Google 用戶端 ID）'); return; }
  try {
    const g = await loadGis();
    g.accounts.id.initialize({
      client_id: id, ux_mode: 'popup',
      callback: async (resp: { credential: string }) => {
        const r = await call<{ no: string; session: string; card: LicenseCard }>('POST', '/api/auth/google', { credential: resp.credential });
        if (!r.ok) return onError(r.error);
        saveAccount({ no: r.data.no, session: r.data.session });
        onSignedIn(r.data.card);
      },
    });
    g.accounts.id.renderButton(el, { theme: 'outline', size: 'medium', shape: 'pill', text: 'signin_with', locale: 'zh-TW' });
  } catch { onError('載入 Google 登入失敗，請檢查網路'); }
}

export async function signOut() {
  const a = loadAccount(); saveAccount(null);
  if (a) await call('POST', '/api/auth/logout', {}, a.session);
  try { (window as unknown as { google?: Gis }).google?.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
}

/** Pushes the latest level/rank/stars to the public card (only when signed in). */
export async function syncLicense(card: Partial<LicenseCard>): Promise<R<LicenseCard>> {
  const a = loadAccount(); if (!a) return { ok: false, error: '未登入' };
  const r = await call<LicenseCard>('PUT', '/api/license', card, a.session);
  if (!r.ok && /重新登入/.test(r.error)) saveAccount(null);
  return r;
}
export const getLicense = (no: string) => call<LicenseCard>('GET', `/api/license/${encodeURIComponent(no)}`);

// ---------- link via browser (the app's sign-in; Google blocks its sign-in inside WebViews) ----------
/** Web page the app opens in the system browser: …/#link=CODE (the published test build). */
export const LINK_WEB_BASE = 'https://fucustomer.yzprojecttw.com/beta/';
export const isNativeApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export interface LinkStart { code: string; pollToken: string; expiresIn: number }
export type LinkPoll = { pending: true; expiresIn: number } | { no: string; session: string; card: LicenseCard };
/** App: ask for a code (shown to the player / put in the URL) and a secret poll token (never leaves the app). */
export const startAppLink = () => call<LinkStart>('POST', '/api/auth/link/start', {});
/** App: has the browser finished? On success the account is saved here and the card returned. */
export async function pollAppLink(pollToken: string): Promise<R<LinkPoll>> {
  const r = await call<LinkPoll>('POST', '/api/auth/link/poll', { pollToken });
  if (r.ok && 'session' in r.data) saveAccount({ no: r.data.no, session: r.data.session });
  return r;
}
/** Browser: give the waiting app its own new session for the signed-in licence. */
export async function completeAppLink(code: string): Promise<R<{ no: string }>> {
  const a = loadAccount(); if (!a) return { ok: false, error: '請先登入' };
  const r = await call<{ no: string }>('POST', '/api/auth/link/complete', { code }, a.session);
  if (!r.ok && /重新登入/.test(r.error)) saveAccount(null);
  return r;
}

// A page opened as …/#link=CODE (from the app) shows the "bring the sign-in back to the app" card.
if (typeof window !== 'undefined' && !isNativeApp()) {
  const check = () => { if (/[#&]link=/.test(location.hash)) void import('./applink.ts').then(m => m.checkLinkHash()); };
  window.addEventListener('hashchange', check);
  check();
}
