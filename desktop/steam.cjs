// Steam integration points. Inactive until BOTH are true:
//   1. `npm i steamworks.js` has been run in desktop/ (not installed by default), and
//   2. a Steam App ID is supplied via the STEAM_APP_ID environment variable or a steam_appid.txt next to the exe.
// The App ID is not a secret, but it only exists after paying the Steam Direct fee, so none is included here.
const fs = require('node:fs');
const path = require('node:path');

let client = null;
function appId() {
  if (process.env.STEAM_APP_ID) return Number(process.env.STEAM_APP_ID);
  for (const dir of [path.dirname(process.execPath), process.cwd()]) {
    try { return Number(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8').trim()); } catch { /* not found */ }
  }
  return 0;
}

module.exports = {
  init() {
    const id = appId();
    if (!id) return;
    try { client = require('steamworks.js').init(id); console.log('Steam ready for', client.localplayer.getName()); }
    catch (e) { client = null; console.log('Steam not available:', e && e.message); }
  },
  /** Achievement API names are listed in shared/achievements.ts (create the same IDs on the Steamworks site). */
  achieve(id) {
    if (!client) return;
    try { if (!client.achievement.isActivated(id)) client.achievement.activate(id); } catch { /* unknown id */ }
  },
  /** Lets friends click "Join Game" in Steam: Steam relaunches us with `+join CODE`. */
  setPresence(code) {
    if (!client) return;
    try {
      client.localplayer.setRichPresence('connect', code ? `+join ${code}` : null);
      client.localplayer.setRichPresence('status', code ? `房間 ${code}` : '職涯模式');
    } catch { /* ignore */ }
  },
};
