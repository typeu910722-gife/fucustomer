// PWA: after one online visit the solo game opens and starts with the network cut.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const b = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL);
await pg.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 15000 });
await pg.evaluate(() => navigator.serviceWorker.ready);
await pg.reload(); // now controlled by the service worker; assets get cached
await pg.waitForTimeout(1500);
await ctx.setOffline(true);
await pg.reload();
await pg.waitForSelector('#m-career', { timeout: 15000 });
await pg.click('#m-career'); await pg.click('[data-play="1-1"]');
await pg.waitForFunction(() => window.__game?.started, null, { timeout: 20000 });
const ok = await pg.evaluate(() => !!window.__game.snap && !navigator.onLine);
console.log(JSON.stringify({ offlineSolo: ok, errs }));
if (!ok || errs.length) process.exitCode = 1;
await b.close();
