// Free play in every store type: map picker → the store loads with its own layout, signs and products, no errors.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const out = [];
const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(URL);
await pg.evaluate(() => { localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'medium', name: '阿明' })); localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] })); });
await pg.reload();
await pg.click('#m-solo-new');
await pg.waitForSelector('.mapcard');
await pg.screenshot({ path: `${OUT}/maps-picker.png` });
const ids = await pg.evaluate(() => [...document.querySelectorAll('[data-map]')].map(b => b.dataset.map));
for (const id of ids) {
  if (!(await pg.locator('.mapcard').count())) { await pg.click('#m-solo-new'); await pg.waitForSelector('.mapcard'); }
  await pg.click(`[data-map="${id}"]`);
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  // run the morning so customers come in, then look across the store from the back corner
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.phaseLeft = 0.1; for (let i = 0; i < 20 * 40; i++) r.update(0.05); });
  await pg.evaluate(() => { const g = window.__game; g.pos = { x: 12, z: 15.2 }; g.yaw = Math.PI; g.pitch = -0.22; });
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}/map-${id}.png` });
  await pg.evaluate(() => { const g = window.__game; g.pos = { x: 22.6, z: 14.6 }; g.yaw = -2.35; g.pitch = -0.2; });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: `${OUT}/map-${id}-2.png` });
  const info = await pg.evaluate(() => ({ title: document.querySelector('.shelfname, #h-stock')?.innerText?.slice(0, 60) ?? '', customers: window.__game.snap.customers.length }));
  out.push({ id, ...info });
  await pg.evaluate(() => window.__game.exit());
  await pg.waitForSelector('.mapcard', { timeout: 10000 });
}
// each map kept its own save
const saves = await pg.evaluate(ids => ids.map(id => !!localStorage.getItem(id === 'convenience' ? 'fucustomer.store.solo.v1' : `fucustomer.store.solo.${id}.v1`)), ids);
console.log(JSON.stringify({ ids, out, saves, errors }, null, 1));
if (errors.length || ids.length < 4 || out.some(o => o.customers === 0)) process.exitCode = 1; // (saves are written at the first nightly settlement)
await browser.close();
