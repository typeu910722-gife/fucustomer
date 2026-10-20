// Round 23: the lively opening (first customer goes straight to the till, delivery box by the door) and the
// empty-shelf warning (flashing stock bar, toast naming the product, guide arrow to the crate, one-time tip).
// One browser, solo career play (simulation runs in the page). Not a cross-device test.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
await pg.goto(URL);
await pg.evaluate(() => {
  localStorage.clear();
  const stars = {}; for (let i = 1; i <= 5; i++) stars[`1-${i}`] = 2;
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], seenMaps: ['convenience'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 8, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 6, wins: 6 }, story: ['ch1-intro', 'ch1-outro', 'ch2-intro'] }));
});
await pg.reload();
await pg.waitForSelector('#m-career');
await pg.click('#m-career');
await pg.click('[data-play="2-1"]');
await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 });
if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
await pg.keyboard.press('Enter'); // ready → open
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 15000 });
await pg.waitForFunction(() => /早班進貨/.test(document.getElementById('toasts')?.textContent ?? ''), null, { timeout: 4000 }).then(() => ok('delivery toast shown')).catch(() => fail('no delivery toast'));

// ---------- (1) opening: express customer + delivery box ----------
{
  const st = await pg.evaluate(() => {
    const w = window.__game.conn.room.world;
    const c = w.customers[0];
    return { n: w.customers.length, items: c?.items.length ?? 0, state: c?.state, box: w.items.find(i => i.held.kind === 'box') ?? null };
  });
  if (!st.n || st.items < 1) fail('no express customer at opening ' + JSON.stringify(st)); else ok(`first customer already holds ${st.items} item(s), state ${st.state}`);
  if (!st.box || Math.hypot(st.box.x - 12, st.box.z - 15.4) > 2) fail('no delivery box by the door ' + JSON.stringify(st.box)); else ok(`delivery box by the door: ${st.box.held.product} ×${st.box.held.qty}`);
  const atReg = await pg.waitForFunction(() => {
    const w = window.__game.conn.room.world;
    return w.customers.some(c => c.state === 'atRegister') ? w.time - w.openTime : null;
  }, null, { timeout: 20000, polling: 50 }).then(h => h.jsonValue()).catch(() => null);
  if (atReg == null || atReg > 8) fail('first customer at the till after ' + atReg + ' s'); else ok(`first customer at the till ${atReg.toFixed(1)} s after opening`);
  // look at the door: the box and the customer at the till
  await pg.evaluate(() => { const g = window.__game, p = [...g.conn.room.world.players.values()][0]; p.x = 12; p.z = 10.5; g.pos = { x: 12, z: 10.5 }; g.yaw = 0; g.pitch = -0.35; });
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: `${OUT}/r23-opening.png` });
}

// ---------- (2) shelf runs low, then empty: warning, guide arrow, one-time tip ----------
{
  // keep customers from refilling/emptying shelves under us: clear the store for a clean check
  await pg.evaluate(() => {
    const g = window.__game, w = g.conn.room.world, p = [...w.players.values()][0];
    w.customers = []; w.queue = []; w.registers = [null, null]; w.spawnTimer = 999; w.items = []; // (the delivery box too: the arrow should lead to the crate)
    p.x = 12; p.z = 8; g.pos = { x: 12, z: 8 }; g.yaw = Math.PI; g.pitch = -0.1;
    w.shelves.drinks = 2;
  });
  await pg.waitForFunction(() => /飲料貨架快空了/.test(document.getElementById('toasts')?.textContent ?? ''), null, { timeout: 5000 }).then(() => ok('low-shelf toast')).catch(() => fail('no low-shelf toast'));
  const flashing = await pg.evaluate(() => [...document.querySelectorAll('#h-stock .bar.warn')].map(b => getComputedStyle(b).animationName));
  if (!flashing.includes('shelfflash')) fail('stock bar not flashing ' + JSON.stringify(flashing)); else ok('stock bar flashes when low');
  await pg.evaluate(() => { window.__game.conn.room.world.shelves.drinks = 0; });
  await pg.waitForFunction(() => /飲料貨架空了/.test(document.getElementById('toasts')?.textContent ?? ''), null, { timeout: 5000 }).then(() => ok('empty-shelf toast names the product')).catch(() => fail('no empty-shelf toast'));
  await pg.waitForFunction(() => window.__game.view.guide.visible, null, { timeout: 3000 }).catch(() => {});
  const hud = await pg.evaluate(() => ({
    tag: document.querySelector('#h-stock .shelfwarn')?.textContent ?? '',
    hint: document.getElementById('hintbar')?.classList.contains('hidden') ? '' : document.getElementById('hintbar')?.textContent ?? '',
    guide: window.__game.view.guide.visible, shelfGuide: window.__game.shelfGuide,
    flag: JSON.parse(localStorage.getItem('fucustomer.flags.v1') ?? '{}').shelfTipDone,
  }));
  if (!/空了！\d+s/.test(hud.tag)) fail('no grace countdown on the stock row: ' + hud.tag); else ok('stock row: ' + hud.tag);
  if (!/貨架空了/.test(hud.hint)) fail('no first-time tip: ' + hud.hint); else ok('first-time tip: ' + hud.hint);
  if (hud.flag !== true) fail('tip flag not saved'); else ok('tip shown once (flag saved)');
  if (!hud.guide || !hud.shelfGuide || hud.shelfGuide.z > 2.5) fail('guide arrow not on the crate ' + JSON.stringify(hud)); else ok(`guide arrow → drinks crate (${hud.shelfGuide.x.toFixed(1)}, ${hud.shelfGuide.z.toFixed(1)})`);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${OUT}/r23-empty-shelf.png` });
  // look toward the stockroom so the arrow over the crate is in view
  await pg.evaluate(() => { const g = window.__game, p = [...g.conn.room.world.players.values()][0]; p.x = 4; p.z = 7.5; g.pos = { x: 4, z: 7.5 }; g.yaw = Math.PI; g.pitch = -0.15; });
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${OUT}/r23-guide-crate.png` });
  // restocking clears the warning
  await pg.evaluate(() => { window.__game.conn.room.world.shelves.drinks = 8; });
  await pg.waitForFunction(() => !document.querySelector('#h-stock .shelfwarn') && !document.querySelector('#h-stock .bar.warn'), null, { timeout: 4000 }).then(() => ok('warning clears after restocking')).catch(() => fail('warning stays after restocking'));
}

await pg.evaluate(() => window.__game.exit());
await ctx.close();
await browser.close();
if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | ')); else ok('no page errors');
