// Round 22: 店面升級 bought between days in free play (saved at once, 3D prop appears the next morning),
// the 每週挑戰 card on the main menu (and starting it), and a 常客奧客 arc dialogue + in-shift speech bubble.
// One browser, solo play only (simulation runs in the page). Not a cross-device test.
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

const stars = {}; for (let i = 1; i <= 5; i++) stars[`1-${i}`] = 2;
const prime = ([stars, extra]) => {
  localStorage.clear();
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], seenMaps: ['convenience'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 8, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 6, wins: 6 }, story: ['ch1-intro', 'ch1-outro', 'ch2-intro'], ...extra }));
};
async function page(extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
  await pg.goto(URL);
  await pg.evaluate(prime, [stars, extra]);
  await pg.reload();
  await pg.waitForSelector('#m-career');
  return { ctx, pg };
}

// ---------- (1) free play: buy 防滑地墊 at the nightly settlement ----------
{
  const { ctx, pg } = await page();
  await pg.click('#m-career'); await pg.click('[data-tab="free"]');
  await pg.click('[data-map="convenience"]');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  await pg.evaluate(() => {
    const r = window.__game.conn.room;
    r.world.money = 2000;
    for (let k = 0; k < 600 && r.world.phase !== 'summary'; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); for (let i = 0; i < 20; i++) r.update(0.05); }
  });
  await pg.waitForSelector('#sum-shop #upg-panel', { timeout: 10000 });
  const cards = await pg.locator('#sum-shop [data-upg-card]').count();
  if (cards < 11) fail('upgrade panel has ' + cards + ' lines'); else ok(`upgrade panel: ${cards} lines`);
  await pg.locator('#sum-shop [data-upg-card="mat"]').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${OUT}/r22-upgrade-panel.png` });
  const money0 = await pg.evaluate(() => window.__game.snap.money);
  await pg.click('#sum-shop [data-upg="mat"]');
  await pg.waitForFunction(() => window.__game.snap.upgrades.mat === 1, null, { timeout: 5000 }).catch(() => fail('mat not bought'));
  await pg.waitForFunction(() => /Lv 1\/2/.test(document.querySelector('#sum-shop [data-upg-card="mat"]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => fail('card not updated'));
  const money1 = await pg.evaluate(() => window.__game.snap.money);
  if (money0 - money1 !== 150) fail(`paid ${money0 - money1}`); else ok('paid $150 from the store money');
  await pg.waitForTimeout(300);
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.store.solo.v1') ?? 'null'));
  if (saved?.upgrades?.mat !== 1) fail('purchase not saved right away: ' + JSON.stringify(saved?.upgrades)); else ok('purchase saved at once (day ' + saved.day + ')');
  await pg.locator('#sum-shop [data-upg-card="mat"]').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${OUT}/r22-upgrade-bought.png` });
  // next morning: the mat is in the store
  await pg.click('#sum-ready');
  await pg.waitForFunction(() => window.__game.snap.phase === 'prep', null, { timeout: 10000 }).catch(() => fail('next day did not start'));
  const vis = await pg.evaluate(() => ({ mat: window.__game.view.upgProps.mat?.visible, bell: window.__game.view.upgProps.doorbell?.visible }));
  if (!vis.mat || vis.bell) fail('3D props ' + JSON.stringify(vis)); else ok('防滑地墊 visible in the store, 自動門鈴 not');
  // look at the door
  await pg.evaluate(() => { const g = window.__game, p = [...g.conn.room.world.players.values()][0]; p.x = 12; p.z = 12.4; g.pos = { x: 12, z: 12.4 }; g.yaw = 0; g.pitch = -0.55; });
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: `${OUT}/r22-mat-3d.png` });
  await pg.evaluate(() => window.__game.exit());
  await ctx.close();
}

// ---------- (2) main menu: 每週挑戰 next to the daily, badge on the licence, start it ----------
{
  const { ctx, pg } = await page({ weekly: { week: '2026-W40', done: 7, best: 400, plays: 3, badges: ['2026-W39', '2026-W40'] } });
  const card = await pg.locator('#m-weekly').innerText().catch(() => '');
  if (!/每週挑戰/.test(card)) fail('no weekly card: ' + card); else ok('menu weekly card: ' + card.replace(/\s+/g, ' '));
  if (!(await pg.locator('#m-daily').count())) fail('daily card missing');
  const lic = (await pg.locator('#lic-badges').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (!/週章 ×2/.test(lic)) fail('licence badges: ' + lic); else ok('licence: ' + lic);
  await pg.screenshot({ path: `${OUT}/r22-menu-weekly.png` });
  await pg.click('#m-weekly');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  const sh = await pg.evaluate(() => window.__game.snap.shift);
  if (sh.id !== 'weekly' || !/每週挑戰/.test(sh.title)) fail('weekly shift ' + JSON.stringify(sh)); else ok('weekly started: ' + sh.title);
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}/r22-weekly-shift.png` });
  // finish it right away (lost) → weekly result screen with the goal list
  await pg.evaluate(() => { const r = window.__game.conn.room; for (let k = 0; k < 400 && !r.world.result; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); for (let i = 0; i < 20; i++) r.update(0.05); } });
  await pg.waitForSelector('#weekly-goals', { timeout: 15000 }).catch(() => fail('no weekly result'));
  await pg.screenshot({ path: `${OUT}/r22-weekly-result.png` });
  await pg.click('#r-career');
  await pg.waitForSelector('#weekly-card');
  await pg.locator('#weekly-card').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${OUT}/r22-career-weekly.png` });
  await ctx.close();
}

// ---------- (3) 常客奧客: 集點王阿姨's first card in the store before 1-2, her bubble, and the ending on the result ----------
{
  const { ctx, pg } = await page();
  await pg.click('#m-career');
  await pg.click('[data-play="1-2"]');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  await pg.waitForFunction(() => /集點王阿姨/.test(document.getElementById('arccard')?.textContent ?? '') && !document.getElementById('arccard').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => fail('no arc card in the store'));
  ok('arc card: ' + (await pg.locator('#arccard').innerText()).split('\n').slice(0, 2).join(' / '));
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/r22-arc-card.png` });
  const seen = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).arcs);
  if (seen?.auntie?.seen !== 1) fail('arc seen not saved ' + JSON.stringify(seen)); else ok('pre-card recorded');
  // bring her in now
  await pg.evaluate(() => { const r = window.__game.conn.room; for (let i = 0; i < 400 && !r.world.customers.some(c => c.kind === 'cutter'); i++) { if (r.world.phase === 'prep') r.world.phaseLeft = 0; if (r.world.phase === 'open') r.world.karenTimer = 0; r.update(0.05); } });
  await pg.waitForFunction(() => /集點王阿姨/.test(document.getElementById('aftermath')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => fail('no regular speech bubble'));
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${OUT}/r22-arc-bubble.png` });
  ok('bubble: ' + (await pg.locator('#aftermath').innerText()).replace(/\s+/g, ' '));
  // pretend the shift went well and she was dealt with: the stage's ending shows on the result screen
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.handled.cutter = 1; r.world.dayStats.revenue = 9999; for (let k = 0; k < 600 && !r.world.result; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); r.world.chaos = 0; for (let i = 0; i < 20; i++) r.update(0.05); } });
  await pg.waitForSelector('#arc-result', { timeout: 15000 }).catch(() => fail('no arc ending on the result screen'));
  const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).arcs.auntie);
  if (st?.stage !== 1) fail('stage not advanced ' + JSON.stringify(st)); else ok('stage 1/4 cleared');
  await pg.locator('#arc-result').scrollIntoViewIfNeeded().catch(() => {});
  await pg.screenshot({ path: `${OUT}/r22-arc-result.png` });
  await ctx.close();
}

await browser.close();
if (errors.length) { console.log('page errors:', errors); process.exitCode = 1; }
console.log(process.exitCode ? 'round22 FAILED' : 'round22 OK');
