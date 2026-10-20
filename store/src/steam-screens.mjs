// Steam store screenshots (1920×1080) from the real game in headless Chromium (software WebGL).
// Serve a build first, e.g.  (cd desktop && node build-web.cjs) && python3 -m http.server 8899 -d desktop/web
// Usage: GAME_URL=http://127.0.0.1:8899/ node store/src/steam-screens.mjs   → store/steam/screenshots/
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const GAME = process.env.GAME_URL ?? 'http://127.0.0.1:8899/';
const OUT = process.env.OUT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../steam/screenshots');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(OUT, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ALL_KARENS = ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'custom', 'fickle', 'tryhard', 'boss', 'sampler', 'reader', 'toucher', 'taster', 'dogfeed', 'squatter', 'kicker', 'packer', 'wiper', 'benchhog', 'doneness', 'refry', 'unboxer', 'photo', 'coins', 'rx', 'upgrader'];
const MAPS = ['convenience', 'bakery', 'boba', 'bookstore', 'breakfast', 'cafe', 'chicken', 'cinema', 'clothing', 'drugstore', 'electronics', 'gas', 'gym', 'hotel', 'hotpot', 'petshop', 'pharmacy', 'post', 'salon', 'steak', 'supermarket'];

async function open(level, cleared, extra = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 }) // 1920×1080 output, UI at a readable size;
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('page error', String(e)));
  await page.goto(GAME);
  const stars = {}, clears = {};
  for (let c = 1; c <= cleared; c++) for (let i = 1; i <= 5; i++) { stars[`${c}-${i}`] = 2 + ((c + i) % 2); clears[`${c}-${i}`] = 1; }
  for (const id of extra) { stars[id] = 2; clears[id] = 1; }
  await page.evaluate(([level, stars, clears, karens, maps]) => {
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'high', name: '阿明', fpsCap: 0, adaptive: false }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: karens, seenMaps: maps }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level, exp: 40, wallet: 1860, skillPoints: 2, skills: { service: 6, body: 7, crisis: 5 }, gear: { shoes: 2, mop: 2, machine: 1, cleaner: 1, guard: 1 }, stars, clears, stats: { shifts: 60, wins: 52, served: 1400, ejected: 120, karens: 180, revenue: 18000 }, endlessBest: 1240, title: '' }));
  }, [level, stars, clears, ALL_KARENS, MAPS]);
  await page.reload();
  return { ctx, page };
}
const want = name => !ONLY || ONLY.some(o => name.startsWith(o));
const shot = async (page, name) => { await page.waitForTimeout(1800); await page.screenshot({ path: path.join(OUT, name), timeout: 120000 }); console.log('wrote', name); };
const look = (page, x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => {
  const g = window.__game, me = [...g.conn.room.world.players.values()][0];
  g.pos = { x, z }; g.yaw = yaw; g.pitch = pitch; me.x = x; me.z = z;
}, [x, z, yaw, pitch]);

async function freePlay(page, id, secs) {
  if (!(await page.locator('.mapcard').count())) { await page.click('#m-career'); await page.click('[data-tab="free"]'); await page.waitForSelector('.mapcard'); }
  await page.click(`[data-map="${id}"]`);
  await page.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
  await page.evaluate(n => { const r = window.__game.conn.room; r.world.phaseLeft = 0.1; for (let i = 0; i < n; i++) r.update(0.05); }, secs * 20);
}
async function startShift(page, id, warm) {
  await page.click('#m-career');
  await page.click('[data-tab="chapters"]');
  await page.click(`[data-play="${id}"]`);
  await page.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 });
  if (await page.locator('#sc-skip').count()) await page.click('#sc-skip');
  await page.waitForFunction(() => window.__game?.started, null, { timeout: 30000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 30000 });
  await page.evaluate(n => { const r = window.__game.conn.room; r.paused = false; for (let i = 0; i < n; i++) r.update(0.05); }, warm);
}

// Free play in several store types (only free stores: paid map packs are not on sale yet)
const STORES = process.env.STORES ? process.env.STORES.split(',').map(id => [`cand-${id}.png`, id, 60, [[12, 15.2, Math.PI, -0.2]]]) : null;
for (const [file, id, secs, views, dist] of STORES ?? [
  ['01-chicken.png', 'chicken', 60, [[22.6, 14.6, -2.35, -0.2]], 7],
  ['02-supermarket.png', 'supermarket', 60, [[12, 15.2, Math.PI, -0.22]], 7],
  ['03-breakfast.png', 'breakfast', 60, [[12, 15.2, Math.PI, -0.2]], 8],
  ['04-cafe.png', 'cafe', 60, [[12, 15.2, Math.PI, -0.2]], 8],
]) {
  if (!want(file)) continue;
  const { ctx, page } = await open(18, 3);
  await freePlay(page, id, secs);
  // stand back from where the customers are and face them
  const cam = await page.evaluate(([dist, fallback]) => {
    const w = window.__game.conn.room.world, cs = w.customers.filter(c => !c.gone);
    if (cs.length < 2) return fallback;
    const tx = cs.reduce((a, c) => a + c.x, 0) / cs.length, tz = cs.reduce((a, c) => a + c.z, 0) / cs.length;
    let dx = 12 - tx, dz = 8 - tz; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const cx = Math.min(22.5, Math.max(1.5, tx + dx * dist)), cz = Math.min(14.8, Math.max(1.5, tz + dz * dist));
    return [cx, cz, Math.atan2(tx - cx, tz - cz), -0.2];
  }, [dist ?? 8, views[0]]);
  await look(page, ...cam);
  await shot(page, file);
  await ctx.close();
}
// Grabbing a karen and carrying him to the door (chapter 4-1)
if (want('05-grab.png')) {
  const { ctx, page } = await open(16, 3);
  await startShift(page, '4-1', 700);
  await page.evaluate(() => {
    const w = window.__game.conn.room.world;
    w.customers.push({ id: 9999, kind: 'rager', x: 12, z: 13.4, yaw: Math.PI, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 60, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: true, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null });
  });
  await look(page, 12, 12.2, 0, 0.05);
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.snap.players[0].grabbing === 9999, null, { timeout: 20000 }).catch(() => console.log('grab not confirmed'));
  await look(page, 12, 9, 0, -0.05);
  await shot(page, '05-grab.png');
  await ctx.close();
}
// Boss fight (chapter 6-3)
if (want('06-boss.png')) {
  const { ctx, page } = await open(29, 5, ['6-1', '6-2']);
  await startShift(page, '6-3', 900);
  const boss = await page.evaluate(() => { const b = window.__game.conn.room.world.customers.find(c => c.kind === 'boss'); return b ? { x: b.x, z: b.z } : null; });
  if (boss) {
    const dx = 12 - boss.x, dz = 8 - boss.z, d = Math.hypot(dx, dz) || 1;
    const cx = Math.min(22.5, Math.max(1.5, boss.x + dx / d * 4.5)), cz = Math.min(14.5, Math.max(1.5, boss.z + dz / d * 4.5));
    await look(page, cx, cz, Math.atan2(boss.x - cx, boss.z - cz), -0.05);
  }
  await shot(page, '06-boss.png');
  await ctx.close();
}
// Career screen + store picker
if (want('07-career.png') || want('08-maps.png')) {
  const { ctx, page } = await open(22, 4);
  await page.click('#m-career');
  await page.waitForTimeout(800);
  await shot(page, '07-career.png');
  await page.click('[data-tab="free"]');
  await page.waitForSelector('.mapcard');
  await shot(page, '08-maps.png');
  await ctx.close();
}
// Title screen
if (want('09-title.png')) {
  const { ctx, page } = await open(22, 4);
  await shot(page, '09-title.png');
  await ctx.close();
}
await browser.close();
