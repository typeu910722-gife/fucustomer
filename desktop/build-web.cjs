// Builds the game client for the desktop (Steam) app straight into desktop/web, without touching ../dist.
//   - multiplayer points at the production server (override with VITE_SERVER_URL)
//   - VITE_NO_DEVSHOP=1: the QA-only ?devshop flag is disabled in store builds
//   - steam.config.json includeStorePacks → VITE_ALL_STORE_PACKS=1 (paid edition: store packs included)
//   - the service worker is removed (pages load from file://, nothing to cache)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'web');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'steam.config.json'), 'utf8')); } catch { /* defaults */ }
const env = {
  ...process.env,
  VITE_ALL_STORE_PACKS: process.env.VITE_ALL_STORE_PACKS || (cfg.includeStorePacks ? '1' : ''),
  VITE_SERVER_URL: process.env.VITE_SERVER_URL || 'wss://fucustomer-game.typeu910722.workers.dev/ws',
  VITE_NO_DEVSHOP: '1',
};
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build', '--outDir', OUT, '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });
fs.rmSync(path.join(OUT, 'sw.js'), { force: true });
const js = fs.readdirSync(path.join(OUT, 'assets')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(OUT, 'assets', f), 'utf8')).join('\n');
if (!js.includes(env.VITE_SERVER_URL)) throw new Error('server URL missing from desktop build');
console.log('desktop web build ready:', OUT, '→', env.VITE_SERVER_URL, env.VITE_ALL_STORE_PACKS ? '(store packs included)' : '');
