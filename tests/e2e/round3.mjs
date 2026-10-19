// Tutorial guide (1-1), boss fight (6-3) and endless mode in a real browser.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function page(profile) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  await pg.evaluate(p => { localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'medium', name: '測試' })); localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] })); if (p) localStorage.setItem('fucustomer.career.v1', JSON.stringify(p)); }, profile);
  await pg.reload();
  return pg;
}
const ff = (pg, sec) => pg.evaluate(s => { const r = window.__game.conn.room; for (let i = 0; i < s * 20 && !r.world.result; i++) r.update(0.05); }, sec);
// 1) tutorial
let pg = await page(null);
await pg.click('#m-career'); await pg.click('[data-play="1-1"]');
await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 }); if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip'); // chapter intro scene
await pg.waitForFunction(() => window.__game?.started);
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 20000 });
await pg.waitForTimeout(1500);
const tut1 = await pg.evaluate(() => window.__game.tut);
await pg.screenshot({ path: `${OUT}/tutorial-1.png` });
// walk the player behind the counter → step 2
await pg.evaluate(() => { const g = window.__game; g.pos = { x: 16.5, z: 10.2 }; g.yaw = 0; });
await pg.waitForFunction(() => window.__game.tut?.step === 2, null, { timeout: 20000 });
await pg.screenshot({ path: `${OUT}/tutorial-2.png` });
await pg.close();
// 2) boss
const stars = {}; for (const c of [1, 2, 3, 4, 5]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2; stars['6-1'] = 1; stars['6-2'] = 1;
pg = await page({ version: 1, level: 27, exp: 0, wallet: 900, skillPoints: 26, stars });
await pg.click('#m-career'); await pg.click('[data-play="6-3"]');
await pg.waitForFunction(() => window.__game?.started);
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 20000 });
await ff(pg, 52);
await pg.evaluate(() => { const g = window.__game; const b = g.conn.room.world.customers.find(c => c.kind === 'boss'); g.pos = { x: b.x, z: b.z - 1.6 }; g.yaw = 0; });
await pg.waitForTimeout(1500);
const boss = await pg.evaluate(() => window.__game.snap.customers.filter(c => c.kind === 'boss').map(c => ({ phase: c.phase, state: c.state })));
await pg.screenshot({ path: `${OUT}/boss.png` });
await pg.close();
// 3) endless unlocked + result
stars['6-3'] = 2;
pg = await page({ version: 1, level: 30, exp: 0, wallet: 900, skillPoints: 29, stars, endlessBest: 1200 });
await pg.click('#m-career');
await pg.screenshot({ path: `${OUT}/career-endless.png`, fullPage: false });
await pg.evaluate(() => document.querySelector('.chapter.endless')?.scrollIntoView());
await pg.screenshot({ path: `${OUT}/career-endless2.png` });
await pg.click('[data-play="endless"]');
await pg.waitForFunction(() => window.__game?.started);
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 20000 });
await ff(pg, 60);
await pg.waitForTimeout(800);
await pg.screenshot({ path: `${OUT}/endless-hud.png` });
await pg.evaluate(() => window.__game.send({ type: 'endShift' }));
await pg.waitForSelector('.result', { timeout: 15000 });
await pg.screenshot({ path: `${OUT}/endless-result.png` });
const prof = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
console.log(JSON.stringify({ tut1, boss, endlessBest: prof.endlessBest, errors }, null, 1));
if (errors.length || !tut1 || !boss.length) process.exitCode = 1;
await browser.close();
