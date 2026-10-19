// Own store: open it from the career screen, play a business day with the employee, then go bankrupt.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const out = {};
const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(URL);
const stars = {}; for (let c = 1; c <= 6; c++) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
await pg.evaluate(stars => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 30, wallet: 3200, stars, clears: { ...stars }, stats: { shifts: 40, wins: 40 }, story: ['ch1-intro'] }));
}, stars);
await pg.reload();
await pg.click('#m-career'); await pg.click('[data-tab="store"]');
await pg.fill('#st-name', '阿明商店');
await pg.screenshot({ path: `${OUT}/r10-open.png` });
await pg.click('#st-open');
await pg.waitForSelector('.scene');
for (let i = 0; i < 8 && await pg.locator('.scene').count(); i++) { await pg.keyboard.press('Enter'); await pg.waitForTimeout(120); }
await pg.waitForSelector('#st-enter');
await pg.click('input[name="st-wage"][value="kind"]');
await pg.screenshot({ path: `${OUT}/r10-store.png` });
out.wallet = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).wallet);
// one business day with the employee
await pg.click('#st-enter');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
out.players = await pg.evaluate(() => window.__game.snap.players.map(p => p.name));
await pg.evaluate(() => { const r = window.__game.conn.room; for (let i = 0; i < 20 * 900 && r.world.phase !== 'summary'; i++) { if (r.world.phase === 'prep') r.world.phaseLeft = 0; r.world.rating = 4; r.world.chaos = 0; r.update(0.05); } });
await pg.waitForTimeout(800);
out.dbg = await pg.evaluate(() => ({ h: JSON.parse(localStorage.getItem('fucustomer.career.v1')).storeHistory, w: { money: window.__game.conn.room.world.money, rating: window.__game.conn.room.world.rating, day: window.__game.conn.room.world.day } })); console.log(JSON.stringify(out.dbg));
out.afterDay = await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('fucustomer.career.v1')).store; return { days: s.days, day: s.save.day, mood: s.staff.mood }; });
await pg.screenshot({ path: `${OUT}/r10-summary.png` });
await pg.evaluate(() => window.__game.exit());
await pg.waitForSelector('#st-enter');
// already two nights in the red: one more and it's over
await pg.evaluate(() => { const p = JSON.parse(localStorage.getItem('fucustomer.career.v1')); p.store.negDays = 2; localStorage.setItem('fucustomer.career.v1', JSON.stringify(p)); });
await pg.click('[data-tab="chapters"]'); await pg.click('[data-tab="store"]');
await pg.click('#st-enter');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
await pg.evaluate(() => { const r = window.__game.conn.room; r.world.money = -5000; for (let i = 0; i < 20 * 900 && r.world.phase !== 'summary'; i++) { if (r.world.phase === 'prep') r.world.phaseLeft = 0; r.update(0.05); } });
await pg.waitForSelector('.scene', { timeout: 20000 });
out.bankruptScene = await pg.evaluate(() => document.querySelector('.scene').innerText);
await pg.screenshot({ path: `${OUT}/r10-bankrupt.png` });
const prof = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
out.store = prof.store; out.history = prof.storeHistory; out.errors = errors;
console.log(JSON.stringify(out, null, 1));
const ok = !errors.length && out.wallet === 3200 - 2500 && out.players.length === 2 && out.afterDay.days === 1 && out.afterDay.day === 2 && out.afterDay.mood > 70
  && /倒閉/.test(out.bankruptScene) && prof.store === null && prof.storeHistory.lost === 2500;
if (!ok) process.exitCode = 1;
await browser.close();
