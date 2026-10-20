// Daily challenge, achievements tab/pop-ups and the 充電霸王 karen in a real browser.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(URL);
const stars = {}; for (const c of [1, 2, 3]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
await pg.evaluate(stars => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '測試' })); localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 18, stars, clears: { ...stars }, stats: { shifts: 30, wins: 25, served: 300, ejected: 3, karens: 40, revenue: 5000 } }));
}, stars);
await pg.reload();
await pg.click('#m-career');
await pg.waitForSelector('.chapter.daily');
await pg.screenshot({ path: `${OUT}/r7-career-daily.png` });
// progress made before achievements existed is credited when the career opens
await pg.click('[data-tab="achievements"]');
const got = await pg.locator('.ach.got').count();
await pg.screenshot({ path: `${OUT}/r7-achievements.png` });
await pg.click('[data-tab="chapters"]');
await pg.click('[data-play="daily"]');
await pg.waitForFunction(() => window.__game?.started, null, { timeout: 25000 });
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap?.phase === 'open', null, { timeout: 25000 });
const title = await pg.evaluate(() => window.__game.snap.shift.title);
// a 充電霸王 walks in and sits at the socket by the window
await pg.evaluate(() => {
  const g = window.__game, w = g.conn.room.world, me = [...w.players.values()][0];
  w.customers = w.customers.filter(c => Math.hypot(c.x - 3.2, c.z - 14) > 4);
  w.customers.push({ id: 7777, kind: 'charger', x: 3.2, z: 13, yaw: 0, state: 'enter', path: [], speed: 1.6, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 1, patienceMax: 1, mood: 80, timer: 0, register: -1, anger: 0, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 75, look: 5, angry: false, moving: true, knockTimer: 5, gone: false, heldBy: null, fly: null, phase: 0, minions: [] });
  w.customers[w.customers.length - 1].path = [{ x: 3.2, z: 15.2 }];
  g.pos = { x: 3.2, z: 13.9 }; g.yaw = 0; g.pitch = -0.35; me.x = 3.2; me.z = 13.9;
});
await pg.waitForFunction(() => window.__game.snap.customers.some(c => c.id === 7777 && c.state === 'charge'), null, { timeout: 20000 });
await pg.waitForTimeout(800);
await pg.screenshot({ path: `${OUT}/r7-charger.png` });
const prompt = await pg.evaluate(() => document.getElementById('prompt')?.innerText ?? '');
// unplug twice with the real interact key
for (let i = 0; i < 2; i++) {
  const before = await pg.evaluate(() => window.__game.conn.room.world.customers.find(c => c.id === 7777)?.phase ?? 0);
  await pg.keyboard.down('e');
  await pg.waitForFunction(b => { const c = window.__game.conn.room.world.customers.find(c => c.id === 7777); return !c || c.resolved || c.phase > b; }, before, { timeout: 6000 }).catch(() => {});
  await pg.keyboard.up('e');
  await pg.waitForTimeout(400);
}
const charger = await pg.evaluate(() => window.__game.conn.room.world.customers.find(c => c.id === 7777) ?? null);
// finish the shift: give it enough sales and fast-forward to closing
await pg.evaluate(() => { const r = window.__game.conn.room; r.world.dayStats.revenue = 2000; for (let i = 0; i < 400 * 20 && !r.world.result; i++) { r.world.chaos = 0; r.world.rating = 4; r.update(0.05); } });
await pg.waitForSelector('.result', { timeout: 20000 });
await pg.waitForTimeout(1500);
await pg.screenshot({ path: `${OUT}/r7-daily-result.png` });
const resultText = await pg.evaluate(() => document.querySelector('.result').innerText);
const prof = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
const out = { got, title, prompt, chargerResolved: charger ? charger.resolved : 'gone', daily: prof.daily, achievements: prof.achievements, popup: /解鎖成就/.test(resultText), errors };
console.log(JSON.stringify(out, null, 1));
const ok = !errors.length && got > 0 && /每日挑戰/.test(title) && /插頭/.test(prompt) && (charger === null || charger.resolved) && prof.daily.rewarded && prof.achievements.includes('DAILY_FIRST') && out.popup;
if (!ok) process.exitCode = 1;
await browser.close();
