// First-time experience: welcome button → 1-1, skippable tutorial, one-time karen intro card (pauses solo),
// and phone-size layout of the career screens.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const out = {};

// 1) brand-new player
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' })); });
  await pg.reload();
  await pg.waitForSelector('#m-first');
  await pg.screenshot({ path: `${OUT}/r8-welcome.png` });
  await pg.click('#m-first');
  await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 }); if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip'); // chapter intro scene
  await pg.waitForFunction(() => window.__game?.started, null, { timeout: 25000 });
  out.shift = await pg.evaluate(() => window.__game.snap.shift.id);
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 25000 });
  await pg.waitForFunction(() => !document.getElementById('tutskip').classList.contains('hidden'), null, { timeout: 10000 });
  out.tutorialShown = await pg.evaluate(() => document.getElementById('hintbar').innerText);
  await pg.keyboard.press('KeyK');
  await pg.waitForTimeout(500);
  out.afterSkip = await pg.evaluate(() => ({ skipHidden: document.getElementById('tutskip').classList.contains('hidden'), flags: JSON.parse(localStorage.getItem('fucustomer.flags.v1')) }));
  await pg.close();
}

// 2) first 插隊奧客 of a career: intro card, short pause, never again
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' })); localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 3, stars: { '1-1': 2 }, clears: { '1-1': 1 }, stats: { shifts: 1, wins: 1 } })); });
  await pg.reload();
  await pg.click('#m-career'); await pg.click('[data-play="1-2"]');
  await pg.waitForFunction(() => window.__game?.started, null, { timeout: 25000 });
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 25000 });
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.karenTimer = 0; r.update(0.05); });
  await pg.waitForFunction(() => !document.getElementById('introcard').classList.contains('hidden'), null, { timeout: 10000 });
  out.card = await pg.evaluate(() => document.getElementById('introcard').innerText);
  out.pausedDuringCard = await pg.evaluate(() => window.__game.conn.room.paused);
  await pg.screenshot({ path: `${OUT}/r8-introcard.png` });
  await pg.waitForTimeout(2600);
  out.resumed = await pg.evaluate(() => !window.__game.conn.room.paused);
  out.seen = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.flags.v1')).seenKarens);
  await pg.close();
}

// 3) phone layouts: nothing wider than the screen, tall cards scroll
const layout = [];
for (const [w, h] of [[844, 390], [2400, 1080]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  const stars = {}; for (const c of [1, 2, 3]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
  await pg.evaluate(stars => { localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' })); localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 18, stars, clears: { ...stars }, stats: { shifts: 20, wins: 20 }, achievements: ['FIRST_SHIFT'] })); }, stars);
  await pg.reload();
  const check = async name => {
    const r = await pg.evaluate(() => {
      const card = document.querySelector('.screen .card'); const b = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: innerWidth, vh: innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth + 1, scrolls: card.scrollHeight <= card.clientHeight + 1 || cs.overflowY === 'auto' || cs.overflowY === 'scroll', tooWide: [...card.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length };
    });
    await pg.screenshot({ path: `${OUT}/r8-${w}-${name}.png` });
    const ok = r.left >= -1 && r.right <= r.vw + 1 && r.top >= -1 && r.bottom <= r.vh + 1 && !r.hscroll && r.scrolls && r.tooWide === 0;
    layout.push({ size: `${w}x${h}`, name, ok, ...(!ok ? r : {}) });
  };
  await pg.click('#m-career'); await pg.waitForSelector('.chapter.daily'); await check('career-daily');
  await pg.click('[data-tab="achievements"]'); await check('achievements');
  await pg.click('[data-tab="skills"]'); await check('skills');
  // result screen (daily, so it has every block)
  await pg.click('[data-tab="chapters"]'); await pg.click('[data-play="daily"]');
  await pg.waitForFunction(() => window.__game?.started, null, { timeout: 25000 });
  await pg.evaluate(() => { const r = window.__game.conn.room; r.startGame?.(); });
  await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
  await pg.waitForFunction(() => window.__game.snap?.phase === 'open', null, { timeout: 25000 }).catch(() => {});
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.dayStats.revenue = 3000; for (let i = 0; i < 400 * 20 && !r.world.result; i++) { r.world.chaos = 0; r.world.rating = 4; r.update(0.05); } });
  await pg.waitForSelector('.result', { timeout: 20000 });
  await pg.waitForTimeout(1200);
  await check('result');
  await ctx.close();
}
out.layout = layout;
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
const ok = !errors.length && out.shift === '1-1' && /教學/.test(out.tutorialShown) && out.afterSkip.skipHidden && out.afterSkip.flags.tutorialDone
  && /插隊奧客/.test(out.card) && out.pausedDuringCard && out.resumed && out.seen.includes('cutter') && layout.every(l => l.ok);
if (!ok) process.exitCode = 1;
await browser.close();
