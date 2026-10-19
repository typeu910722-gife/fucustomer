// Desktop shell smoke test (Linux Electron under a virtual display; same main/preload code as the Windows build).
// Run: cd desktop && npm run copy-web && xvfb-run -a node ../tests/e2e/electron.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const DESKTOP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../desktop');
const app = await pw._electron.launch({
  executablePath: path.join(DESKTOP, 'node_modules/electron/dist/electron'),
  args: [DESKTOP, '--windowed', '--no-sandbox', '--use-angle=swiftshader', '+join', 'ABCDE'], cwd: DESKTOP,
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.waitForSelector('#m-career', { timeout: 20000 });
const info = await page.evaluate(() => ({ bridge: typeof window.fuDesktop?.achieve, quit: !!document.getElementById('m-quit'), url: location.protocol }));
console.log('bridge', info);
if (info.bridge !== 'function' || !info.quit || info.url !== 'file:') throw new Error('desktop bridge missing');
// +join ABCDE on the command line → tries to join that room (no server here, so it ends with an error message, not a crash)
await page.waitForFunction(() => /連線|伺服器|房間/.test(document.body.innerText), null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' })));
await page.reload();
await page.waitForSelector('#m-career');
await page.click('#m-career');
await page.waitForSelector('.rankcard');
await page.click('[data-tab="chapters"]');
await page.click('[data-play="1-1"]');
await page.waitForFunction(() => window.__game?.started, null, { timeout: 25000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: process.env.SHOT ?? '/tmp/electron.png' });
console.log('in shift:', await page.evaluate(() => !!window.__game?.snap));
await app.close();
if (errors.length) { console.error(errors); process.exit(1); }
console.log('ELECTRON OK');
