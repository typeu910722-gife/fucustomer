// Real-money purchases (paid packs) through the store of the platform the game runs on.
// Nothing is wired to a payment provider yet: every adapter reports "not available" with a friendly message.
// When the platform accounts exist (Google Play Console / Apple Developer / Steamworks), each adapter gets its real
// implementation here; the rest of the game only talks to `billing()` and `entitlementsFor()`.
// See docs/MONETIZATION.md. No keys or secrets belong in this file (receipt checks must run on the game server).
import type { CareerProfile } from '../../shared/career.ts';
import { PACKS } from '../../shared/shop.ts';

export type BillingPlatform = 'web' | 'electron' | 'android' | 'ios' | 'steam';
export type PurchaseResult =
  | { ok: true; productId: string; entitlements: string[] }
  | { ok: false; reason: 'unavailable' | 'cancelled' | 'error'; message: string };
export type RestoreResult = { ok: true; entitlements: string[] } | { ok: false; reason: 'unavailable' | 'error'; message: string };

export interface BillingAdapter {
  readonly platform: BillingPlatform;
  /** True once this platform's store can actually take payments. */
  available(): boolean;
  /** productId = a pack id from shared/shop.ts (store product ids will be mapped here later). */
  purchase(productId: string): Promise<PurchaseResult>;
  /** Re-reads what this account already bought (new phone, reinstall). */
  restore(): Promise<RestoreResult>;
}

export const NOT_YET = '付款功能準備中，正式上架後開放';
const WHERE: Record<BillingPlatform, string> = {
  web: '網頁版之後開放，也可以到 App 或 Steam 版購買', electron: '電腦版會透過 Steam 購買', steam: '會透過 Steam 購買',
  android: '會透過 Google Play 購買', ios: '會透過 App Store 購買',
};

/** Placeholder adapter: same shape as the real ones, never charges anything. */
export class PendingAdapter implements BillingAdapter {
  constructor(readonly platform: BillingPlatform) {}
  available() { return false; }
  async purchase(_productId: string): Promise<PurchaseResult> { return { ok: false, reason: 'unavailable', message: `${NOT_YET}（${WHERE[this.platform]}）` }; }
  async restore(): Promise<RestoreResult> { return { ok: false, reason: 'unavailable', message: `${NOT_YET}，目前沒有可恢復的購買` }; }
}

export function detectBillingPlatform(): BillingPlatform {
  const w = window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean }; fuDesktop?: { steam?: boolean } };
  const cap = w.Capacitor?.isNativePlatform?.() ? w.Capacitor.getPlatform?.() : undefined;
  if (cap === 'android') return 'android';
  if (cap === 'ios') return 'ios';
  if (w.fuDesktop) return w.fuDesktop.steam ? 'steam' : 'electron';
  return 'web';
}

let adapter: BillingAdapter | null = null;
export function billing(): BillingAdapter { return (adapter ??= new PendingAdapter(detectBillingPlatform())); }

/**
 * QA only: `?devshop=1` in the page URL unlocks every pack for this page load (never saved to the profile).
 * Nothing else can turn it on; builds made with VITE_NO_DEVSHOP=1 (use this for the real store release) ignore it.
 */
export function devShop(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  if (env.VITE_NO_DEVSHOP === '1') return false;
  return new URLSearchParams(search).get('devshop') === '1';
}

/**
 * Paid-edition builds (e.g. a paid Steam release, see desktop/steam.config.json `includeStorePacks`) are built with
 * VITE_ALL_STORE_PACKS=1: every store-type pack is part of the purchase. The supporter pack is never included.
 */
export function storePacksIncluded(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return env.VITE_ALL_STORE_PACKS === '1';
}

/** Packs this player may use right now: bought ones (from the profile), packs included in a paid edition, plus the QA unlock. */
export function entitlementsFor(p: CareerProfile): string[] {
  if (devShop()) return [...new Set([...p.shop.entitlements, ...PACKS.map(k => k.id)])];
  if (storePacksIncluded()) return [...new Set([...p.shop.entitlements, ...PACKS.filter(k => k.stores.length > 0).map(k => k.id)])];
  return p.shop.entitlements;
}
