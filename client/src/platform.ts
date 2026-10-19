// Thin bridge to the native shell the game runs in: Capacitor (iOS/Android), Electron (Windows/Steam) or a browser.
// Everything here is optional: missing plugins or a plain browser simply skip the native calls.

type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string };
/** Exposed by electron/preload.cjs. Steam calls are no-ops until a Steam App ID is configured there. */
export interface DesktopBridge {
  achieve(id: string): void;
  setPresence(roomCode: string | null): void;
  onJoinRequest(cb: (code: string) => void): void;
  setFullscreen(on: boolean): void;
  quit(): void;
}

const w = window as unknown as { Capacitor?: Cap; fuDesktop?: DesktopBridge };
export const isNative = !!w.Capacitor?.isNativePlatform?.();
export const desktop: DesktopBridge | null = w.fuDesktop ?? null;
export const isApp = isNative || !!desktop;

let backHandler: () => void = () => {};
let pauseHandler: () => void = () => {};
/** Android back button / Esc-equivalent. */
export function onBack(cb: () => void) { backHandler = cb; }
/** App moved to the background (phone home button, incoming call). */
export function onAppPause(cb: () => void) { pauseHandler = cb; }

export async function initPlatform() {
  if (!isNative) return;
  // Plugins are loaded only inside the native app, so the web build never downloads them.
  try {
    const [{ App }, { StatusBar }, { ScreenOrientation }, { SplashScreen }] = await Promise.all([
      import('@capacitor/app'), import('@capacitor/status-bar'), import('@capacitor/screen-orientation'), import('@capacitor/splash-screen'),
    ]);
    void StatusBar.hide().catch(() => {});
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    void ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
    void App.addListener('backButton', () => backHandler());
    void App.addListener('appStateChange', s => { if (!s.isActive) pauseHandler(); });
    void SplashScreen.hide().catch(() => {});
    exitApp = () => { void App.exitApp(); };
  } catch { /* plugin missing: keep web behaviour */ }
}

let exitApp: () => void = () => desktop?.quit();
export function quitApp() { exitApp(); }
export const canQuit = () => isApp;

/** Report achievements to the platform (Steam via Electron today; Game Center / Play Games later). */
export function reportAchievements(ids: string[]) {
  if (desktop) for (const id of ids) desktop.achieve(id);
}
