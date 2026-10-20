// Home-screen web app (iOS profile web clip): Google's popup sign-in can't return there, so the licence card must
// offer "sign in with the browser" (link code flow) instead. A normal browser tab keeps Google's own button.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(standalone) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  if (standalone) await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL);
  return page;
}
// 1) web clip: the browser sign-in button shows, starts a link and opens the browser at …#link=CODE
const clip = await open(true);
await clip.waitForSelector('#m-applink', { timeout: 20000 });
await clip.click('#m-applink');
await clip.waitForFunction(() => window.__opened.length > 0, null, { timeout: 20000 });
const opened = await clip.evaluate(() => window.__opened[0]);
if (!/#link=[A-Z0-9-]{6,8}$/.test(opened)) throw new Error('web clip did not open the link URL: ' + opened);
await clip.screenshot({ path: `${OUT}/standalone-link.png` });
// 2) normal tab: no browser-link button
const tab = await open(false);
await tab.waitForTimeout(3000);
if (await tab.locator('#m-applink').count()) throw new Error('normal browser tab should keep Google sign-in, not the link button');
console.log(JSON.stringify({ opened, errors }, null, 1));
await browser.close();
if (errors.length) { console.error('page errors', errors); process.exit(1); }
console.log('standalone OK');
