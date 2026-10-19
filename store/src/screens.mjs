// Store screenshots (1920×1080, landscape) taken from the real game running in headless Chromium.
// Needs the game served at GAME_URL (default http://localhost:8787/ — `npm run build && npm start`).
// Usage: node store/src/screens.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const GAME = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(level, cleared, touch = false, extra = []) {
  // phone: 960×480 CSS px at 2× = 1920×960 (2:1, accepted by Google Play / App Store landscape)
  const ctx = await browser.newContext(touch ? { viewport: { width: 960, height: 480 }, deviceScaleFactor: 2, hasTouch: true } : { viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('page error', String(e)));
  await page.goto(GAME);
  const stars = {}, clears = {};
  for (let c = 1; c <= cleared; c++) for (let i = 1; i <= 5; i++) { stars[`${c}-${i}`] = 2 + ((c + i) % 2); clears[`${c}-${i}`] = 1; }
  for (const id of extra) { stars[id] = 2; clears[id] = 1; }
  await page.evaluate(([level, stars, clears]) => {
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'high', name: '阿明', fpsCap: 0, adaptive: false })); localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level, exp: 40, wallet: 1860, skillPoints: 2, skills: { service: 6, body: 7, crisis: 5 }, gear: { shoes: 2, mop: 2, machine: 1, cleaner: 1, guard: 1 }, stars, clears, stats: { shifts: 60, wins: 52, served: 1400, ejected: 120, karens: 180, revenue: 18000 }, endlessBest: 1240, title: '' }));
  }, [level, stars, clears]);
  await page.reload();
  return { ctx, page };
}

async function startShift(page, id, warm) {
  await page.click('#m-career');
  await page.click('[data-tab="chapters"]');
  await page.click(`[data-play="${id}"]`);
  await page.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 }); if (await page.locator('#sc-skip').count()) await page.click('#sc-skip'); // chapter intro scene
  await page.waitForFunction(() => window.__game?.started, null, { timeout: 30000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 30000 });
  const st = await page.evaluate(n => {
    const g = window.__game, r = g.conn.room;
    const was = r.paused; r.paused = false;
    for (let i = 0; i < n; i++) r.update(0.05);
    return { was, t: r.world.timeLeft ?? r.world.t, customers: r.world.customers.length, overlay: g.overlay };
  }, warm);
  console.log(id, st);
}
const look = (page, x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => {
  const g = window.__game, me = [...g.conn.room.world.players.values()][0];
  g.pos = { x, z }; g.yaw = yaw; g.pitch = pitch; me.x = x; me.z = z;
}, [x, z, yaw, pitch]);
const shot = async (page, name) => { await page.waitForTimeout(1600); await page.screenshot({ path: path.join(OUT, name) }); console.log('wrote', name); };

// 1. career screen
{
  const { ctx, page } = await open(22, 4);
  await page.click('#m-career');
  await page.waitForSelector('.rankcard');
  await shot(page, '01-career.png');
  await page.click('[data-tab="skills"]');
  await shot(page, '02-skills.png');
  await ctx.close();
}
// 2. busy store during a shift
{
  const { ctx, page } = await open(16, 3);
  await startShift(page, '4-1', 700);
  await look(page, 21, 2.6, -0.76, -0.16);
  await shot(page, '03-business.png');
  // 3. grabbing a karen and aiming for the door
  await page.evaluate(() => {
    const w = window.__game.conn.room.world;
    w.customers.push({ id: 9999, kind: 'rager', x: 12, z: 13.4, yaw: Math.PI, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 60, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: true, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null });
  });
  await look(page, 12, 12.2, 0, 0.05);
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.snap.players[0].grabbing === 9999, null, { timeout: 20000 }).catch(() => {});
  await shot(page, '04-grab-karen.png');
  await ctx.close();
}
// 4. boss fight
{
  const { ctx, page } = await open(29, 5, false, ['6-1', '6-2']);
  await startShift(page, '6-3', 900);
  const boss = await page.evaluate(() => { const b = window.__game.conn.room.world.customers.find(c => c.kind === 'boss'); return b ? { x: b.x, z: b.z } : null; });
  if (boss) {
    // stand 4.5 m from the boss on the store-centre side and face it (yaw 0 looks toward +z)
    const dx = 12 - boss.x, dz = 8 - boss.z, d = Math.hypot(dx, dz) || 1;
    const cx = Math.min(22.5, Math.max(1.5, boss.x + dx / d * 4.5)), cz = Math.min(14.5, Math.max(1.5, boss.z + dz / d * 4.5));
    await look(page, cx, cz, Math.atan2(boss.x - cx, boss.z - cz), -0.05);
  }
  await shot(page, '05-boss.png');
  await ctx.close();
}
// 5. phone-style touch controls
{
  const { ctx, page } = await open(12, 2, true);
  await startShift(page, '3-1', 500);
  await look(page, 21, 2.6, -0.76, -0.16);
  await shot(page, '06-touch.png');
  await ctx.close();
}
await browser.close();
