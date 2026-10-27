// Round 30c: the new 常客奧客. One browser, solo play, software WebGL on one machine (not a cross-device test).
//  (1) 網紅情侶 (一杯坐整天, chapter 8): their first card in the café before 8-6 筆電森林, their speech bubble when they
//      sit down, and the stage's ending on the result screen (progress saved)
//  (2) 對獎阿公 on the 特殊營業日「跨年夜」: card in the store and his bubble (a general karen, no main-story shift has him)
//  (3) the career page's 常客奧客 section lists eight regulars with a 完結 n/8 count
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

// chapters 1–7 and 8-1…8-5 cleared (8-6 is next), every chapter's scenes seen
const stars = {};
for (let c = 1; c <= 7; c++) for (let i = 1; i <= 6; i++) stars[`${c}-${i}`] = 2;
for (let i = 1; i <= 5; i++) stars[`8-${i}`] = 2;
const story = []; for (let c = 1; c <= 10; c++) story.push(`ch${c}-intro`, `ch${c}-outro`);
const done = { stage: 4, seen: 4, at: 0 };
const prime = ([stars, story, extra]) => {
  localStorage.clear();
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({
    tutorialDone: true, shelfTipDone: true,
    seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'custom', 'fickle', 'tryhard', 'squatter', 'lottery', 'change', 'bagman', 'toilet'],
    seenMaps: ['convenience', 'cafe', 'breakfast', 'boba', 'clothing', 'chicken', 'drugstore', 'bookstore', 'bakery', 'supermarket', 'petshop'],
  }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 29, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 60, wins: 60 }, story, ...extra }));
};
async function page(extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
  await pg.goto(URL);
  await pg.evaluate(prime, [stars, story, extra]);
  await pg.reload();
  await pg.waitForSelector('#m-career');
  return { ctx, pg };
}
/** Run the sim until a karen of `kind` is in the store (skips the prep, karens come at once). */
const bringIn = (pg, kind) => pg.evaluate(kind => {
  const r = window.__game.conn.room;
  for (let i = 0; i < 600 && !r.world.customers.some(c => c.kind === kind); i++) { if (r.world.phase === 'prep') r.world.phaseLeft = 0; if (r.world.phase === 'open') r.world.karenTimer = 0; r.update(0.05); }
  return r.world.customers.some(c => c.kind === kind);
}, kind);

// ---------- (1) 網紅情侶 in 8-6 筆電森林 (the other regulars who fit this shift have finished their stories) ----------
{
  const { ctx, pg } = await page({ arcs: { auntie: done, zhang: done } });
  await pg.click('#m-career');
  await pg.click('[data-play="8-6"]');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
  await pg.waitForFunction(() => /網紅情侶/.test(document.getElementById('arccard')?.textContent ?? '') && !document.getElementById('arccard').classList.contains('hidden'), null, { timeout: 10000 }).catch(() => fail('no 網紅情侶 card in the café'));
  const card = (await pg.locator('#arccard').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (!/分手直播/.test(card)) fail('card: ' + card); else ok('arc card: ' + card.slice(0, 80));
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/r30c-couple-card.png` });
  const seen = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).arcs);
  if (seen?.couple?.seen !== 1) fail('pre-card not saved ' + JSON.stringify(seen)); else ok('pre-card recorded');
  if (!(await bringIn(pg, 'squatter'))) fail('no 一杯坐整天 came in');
  await pg.waitForFunction(() => /網紅情侶/.test(document.getElementById('aftermath')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('no regular speech bubble'));
  await pg.waitForTimeout(400);
  ok('bubble: ' + (await pg.locator('#aftermath').innerText().catch(() => '')).replace(/\s+/g, ' '));
  await pg.screenshot({ path: `${OUT}/r30c-couple-bubble.png` });
  // pretend the shift went well and they were dealt with: the stage's ending shows on the result screen
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.handled.squatter = 1; r.world.dayStats.revenue = 9999; for (let k = 0; k < 600 && !r.world.result; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); r.world.chaos = 0; for (let i = 0; i < 20; i++) r.update(0.05); } });
  await pg.waitForSelector('#arc-result', { timeout: 15000 }).catch(() => fail('no arc ending on the result screen'));
  const outro = (await pg.locator('#arc-result').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (!/網紅情侶「分手直播」/.test(outro) || !/用餐限時/.test(outro)) fail('outro: ' + outro); else ok('outro: ' + outro.slice(0, 90));
  const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).arcs.couple);
  if (st?.stage !== 1) fail('stage not advanced ' + JSON.stringify(st)); else ok('網紅情侶 stage 1/4 cleared');
  await pg.locator('#arc-result').scrollIntoViewIfNeeded().catch(() => {});
  await pg.screenshot({ path: `${OUT}/r30c-couple-result.png` });
  await ctx.close();
}

// ---------- (2) 對獎阿公 on the 特殊營業日「跨年夜」 (the others who fit 跨年夜 have finished, so 阿公 is the one who comes) ----------
{
  const { ctx, pg } = await page({ arcs: { auntie: done, kai: done, zhang: done, vicky: done, meiling: done } });
  await pg.click('#m-career'); await pg.click('[data-tab="free"]');
  await pg.locator('[data-special="sp-newyear"]').click({ timeout: 8000 }).catch(() => fail('no 跨年夜 button'));
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
  await pg.waitForFunction(() => /對獎阿公/.test(document.getElementById('arccard')?.textContent ?? '') && !document.getElementById('arccard').classList.contains('hidden'), null, { timeout: 10000 }).catch(() => fail('no 對獎阿公 card'));
  ok('arc card: ' + (await pg.locator('#arccard').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80));
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${OUT}/r30c-lotto-card.png` });
  if (!(await bringIn(pg, 'lottery'))) fail('no 發票對獎魔人 came in');
  await pg.waitForFunction(() => /對獎阿公/.test(document.getElementById('aftermath')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('no 阿公 bubble'));
  await pg.waitForTimeout(400);
  ok('bubble: ' + (await pg.locator('#aftermath').innerText().catch(() => '')).replace(/\s+/g, ' '));
  await pg.screenshot({ path: `${OUT}/r30c-lotto-bubble.png` });
  await pg.evaluate(() => window.__game.exit());
  await ctx.close();
}

// ---------- (3) career page: eight regulars, 完結 count ----------
{
  const { ctx, pg } = await page({ arcs: { auntie: done, kai: done, lotto: { stage: 2, seen: 3, at: 50 }, bags: { stage: 0, seen: 1, at: 0 } } });
  await pg.click('#m-career');
  await pg.waitForSelector('.arc-list');
  const n = await pg.locator('.arc-card').count();
  const head = (await pg.locator('.arcs .chhead').innerText()).replace(/\s+/g, ' ');
  if (n !== 8 || !/完結 2\/8/.test(head)) fail(`arc cards ${n}, head ${head}`); else ok(`career page: ${n} regulars, ${head}`);
  const lotto = (await pg.locator('[data-arc="lotto"]').innerText()).replace(/\s+/g, ' ');
  if (!/對獎阿公/.test(lotto) || !/阿公請客|中了兩百/.test(lotto)) fail('lotto card: ' + lotto); else ok('lotto card: ' + lotto);
  const couple = (await pg.locator('[data-arc="couple"]').innerText()).replace(/\s+/g, ' ');
  if (!/？？？/.test(couple)) fail('unmet couple should be hidden: ' + couple); else ok('unmet regular hidden: ' + couple);
  await pg.locator('.arcs').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${OUT}/r30c-career-arcs.png` });
  await ctx.close();
}

await browser.close();
if (errors.length) { console.log('page errors:', errors); process.exitCode = 1; }
console.log(process.exitCode ? 'round30c FAILED' : 'round30c OK');
