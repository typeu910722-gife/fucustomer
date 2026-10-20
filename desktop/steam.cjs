// Steam integration (steamworks.js, MIT). Everything here is optional: if there is no App ID, Steam is not running,
// or the native module fails to load, every call becomes a no-op and the game plays normally.
//
// App ID lookup order (first non-zero wins):
//   1. steam.config.json `appId` (the one place to set it before a release; see docs/STEAM.md)
//   2. STEAM_APP_ID / SteamAppId environment variable (Steam sets SteamAppId when it launches the game)
//   3. steam_appid.txt next to the exe or in the working directory (developer testing only; gitignored)
const fs = require('node:fs');
const path = require('node:path');

let config = { appId: 0 };
try { config = { ...config, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'steam.config.json'), 'utf8')) }; } catch { /* keep defaults */ }

function appId() {
  const fromConfig = Number(config.appId) || 0;
  if (fromConfig > 0) return fromConfig;
  const fromEnv = Number(process.env.STEAM_APP_ID || process.env.SteamAppId) || 0;
  if (fromEnv > 0) return fromEnv;
  for (const dir of [path.dirname(process.execPath), process.cwd()]) {
    try { const n = Number(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8').trim()); if (n > 0) return n; } catch { /* not found */ }
  }
  return 0;
}

let sw = null;       // the steamworks.js module (loaded lazily)
let client = null;   // initialised Steam client, or null
let status = 'off';  // 'off' (no App ID) | 'ready' | 'unavailable: <reason>'
const pending = new Set(); // achievements that could not be stored yet (stats not loaded / offline) — retried
let retryTimer = null;

function loadModule() {
  if (sw) return sw;
  try { sw = require('steamworks.js'); } catch (e) { status = `unavailable: ${e && e.message}`; sw = null; }
  return sw;
}

function flushPending() {
  if (!client) return;
  for (const id of [...pending]) {
    try {
      if (client.achievement.isActivated(id) || client.achievement.activate(id)) pending.delete(id);
    } catch { pending.delete(id); /* unknown API name: never retry */ }
  }
  if (!pending.size && retryTimer) { clearInterval(retryTimer); retryTimer = null; }
}

module.exports = {
  /** Configured App ID (0 = none). */
  appId,
  /**
   * Must run BEFORE app 'ready': the overlay needs Chromium switches (in-process GPU, no DirectComposition)
   * and a per-frame repaint so Steam's overlay can draw on top of the window. Only enabled when an App ID is set.
   */
  prepareOverlay() {
    if (!appId() || process.argv.includes('--no-steam-overlay')) return false;
    const m = loadModule();
    if (!m) return false;
    try { m.electronEnableSteamOverlay(); return true; } catch (e) { console.log('Steam overlay not enabled:', e && e.message); return false; }
  },
  init() {
    const id = appId();
    if (!id) { status = 'off'; return false; }
    const m = loadModule();
    if (!m) { console.log('Steam not available:', status); return false; }
    try {
      client = m.init(id);
      status = 'ready';
      console.log('Steam ready for app', id, '-', client.localplayer.getName());
      module.exports.setPresence(null);
      return true;
    } catch (e) {
      client = null;
      status = `unavailable: ${e && e.message}`;
      console.log('Steam not available (is the Steam client running?):', e && e.message);
      return false;
    }
  },
  ready: () => !!client,
  status: () => status,
  /** Achievement API names = ids in shared/achievements.ts (create the same names on the Steamworks site). */
  achieve(id) {
    if (!client || !/^[A-Z0-9_]{1,64}$/.test(id)) return;
    pending.add(id);
    flushPending();
    if (pending.size && !retryTimer) retryTimer = setInterval(flushPending, 5000);
  },
  /** Rich presence: friends see the room in their list and can click "Join Game" — Steam relaunches us with `+join CODE`. */
  setPresence(code) {
    if (!client) return;
    try {
      // steam_display tokens are defined in steam/rich_presence_*.vdf (upload them on the Steamworks site)
      client.localplayer.setRichPresence('connect', code ? `+join ${code}` : null);
      client.localplayer.setRichPresence('room', code || null);
      client.localplayer.setRichPresence('steam_display', code ? '#InRoom' : '#Playing');
      client.localplayer.setRichPresence('status', code ? `多人房間 ${code}` : '奧客退散');
    } catch { /* ignore */ }
  },
};
