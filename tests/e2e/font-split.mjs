// Round 27: the UI font is split (scripts/font-subset.py). The main menu (fresh and with progress), the licence card,
// settings, the friend-licence and invite screens must render with only the small menu file: every character they show
// is inside its unicode-range, and the game file is never fetched while the menu's idle warm-up is held back. Once the
// warm-up runs, both files load (so game screens / 3D labels don't flash the fallback font).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '';
if (OUT) try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const fails = [];
const check = (ok, msg) => { console.log(ok ? 'ok' : 'FAIL', msg); if (!ok) fails.push(msg); };
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** Characters on screen (text, input values / placeholders, <option>s) that the menu font face doesn't cover. */
const uncovered = pg => pg.evaluate(() => {
  const faces = []; document.fonts.forEach(f => { if (f.family.replace(/"/g, '') === 'Huninn') faces.push(f); });
  const parse = f => f.unicodeRange.split(',').map(r => r.trim().replace(/^U\+/i, '').split('-').map(h => parseInt(h, 16)));
  const has = (ranges, cp) => ranges.some(([a, b]) => cp >= a && cp <= (b ?? a));
  const menu = faces.map(parse).find(r => has(r, 0x41)); // the menu file is the face that has ASCII
  const inMenu = cp => has(menu, cp);
  const skip = cp => cp <= 0x7f || (cp >= 0x1f000 && cp <= 0x1ffff) || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0xfe0f || cp === 0x200d;
  const text = document.body.innerText + [...document.querySelectorAll('input')].map(i => i.value + i.placeholder).join('') + [...document.querySelectorAll('option')].map(o => o.textContent).join('');
  return [...new Set(text)].filter(c => !skip(c.codePointAt(0)) && !inMenu(c.codePointAt(0))).join('');
});

// ---------- 1. menu screens with the warm-up held back ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.requestIdleCallback = () => 0; }); // the menu's idle warm-up never runs
  const pg = await ctx.newPage();
  const fontReqs = [];
  pg.on('request', r => { if (/\.woff2/.test(r.url())) fontReqs.push(r.url().split('/').pop()); });
  const errors = []; pg.on('pageerror', e => errors.push(String(e)));
  const screens = [];
  const visit = async (name, go) => {
    await go(); await pg.waitForTimeout(400); await pg.evaluate(() => document.fonts.ready);
    const miss = await uncovered(pg);
    check(miss === '', `${name}: every character is in the menu font file${miss ? ` (outside: ${miss})` : ''}`);
    if (OUT) await pg.screenshot({ path: `${OUT}/font-${name}.png` });
    screens.push(name);
  };
  await visit('menu-fresh', async () => { await pg.goto(URL); await pg.waitForSelector('#m-career', { state: 'visible' }); });
  const faces = await pg.evaluate(() => { const r = []; document.fonts.forEach(f => r.push({ family: f.family, status: f.status, range: f.unicodeRange.length })); return r; });
  check(faces.length >= 2 && faces[0].status === 'loaded', `Huninn faces: ${JSON.stringify(faces)}`);
  await visit('menu-progress', async () => {
    await pg.evaluate(() => {
      const k = 'fucustomer.career.v1'; const p = JSON.parse(localStorage.getItem(k) ?? 'null') ?? {};
      const stars = {}; for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5', '2-1']) stars[id] = 3;
      Object.assign(p, { level: 12, title: '奧客剋星', stars, stats: { shifts: 6, wins: 6, served: 80, ejected: 9, karens: 9, revenue: 9000 } });
      p.weekly = { ...(p.weekly ?? {}), badges: ['2026-W40', '2026-W41'] };
      localStorage.setItem(k, JSON.stringify(p));
    });
    await pg.reload(); await pg.waitForSelector('#m-career', { state: 'visible' });
  });
  check(await pg.locator('#m-next').count() === 1 && await pg.locator('#m-daily').count() === 1, 'progressed menu shows the next shift and the daily challenge');
  for (let i = 0; i < 6; i++) await pg.click('#m-quote'); // a few random title quotes
  await visit('menu-quotes', async () => {});
  await visit('settings', async () => { await pg.click('#m-settings'); await pg.waitForSelector('#s-ok'); });
  await visit('friend-licence', async () => { await pg.click('#s-ok'); await pg.waitForSelector('#m-friend'); await pg.click('#m-friend'); await pg.waitForSelector('#fl-no'); });
  await visit('invite', async () => { await pg.goto(URL + (URL.includes('?') ? '&' : '?') + 'join=ABCD'); await pg.waitForTimeout(300); });
  check(fontReqs.some(u => /^huninn-menu\.woff2/.test(u)), `menu font fetched (${fontReqs.join(', ')})`);
  check(!fontReqs.some(u => /^huninn-game\.woff2/.test(u)), `game font not fetched on ${screens.join(', ')} (${fontReqs.join(', ') || 'none'})`);
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// ---------- 2. normal load: the warm-up fetches the game file too ----------
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const pg = await ctx.newPage();
  await pg.goto(URL);
  await pg.waitForSelector('#m-career', { state: 'visible' });
  const loaded = await pg.waitForFunction(() => { let n = 0, ok = 0; document.fonts.forEach(f => { if (f.family.replace(/"/g, '') === 'Huninn') { n++; if (f.status === 'loaded') ok++; } }); return n >= 2 && n === ok; }, null, { timeout: 30000 }).then(() => true, () => false);
  check(loaded, 'after the idle warm-up both font files are loaded');
  // the service worker precaches both font files (offline play)
  const sw = await pg.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 }).then(() => true, () => false);
  if (sw) {
    const cached = await pg.waitForFunction(async () => { for (const n of await caches.keys()) { const k = (await (await caches.open(n)).keys()).map(r => r.url); if (k.some(u => /huninn-menu\.woff2\?v=/.test(u)) && k.some(u => /huninn-game\.woff2\?v=/.test(u))) return true; } return false; }, null, { timeout: 20000, polling: 500 }).then(() => true, () => false);
    check(cached, 'service worker cache holds both font files');
  } else console.log('note: no service worker on this origin; precache not checked');
  await pg.click('#m-career'); await pg.waitForTimeout(800);
  const gameChars = await pg.evaluate(() => document.body.innerText);
  const ok = await pg.evaluate(t => document.fonts.check('16px Huninn', t), gameChars);
  check(ok, 'career screen text is fully available in Huninn');
  if (OUT) await pg.screenshot({ path: `${OUT}/font-career.png` });
  await ctx.close();
}

await browser.close();
if (fails.length) { console.log(`FAIL ${fails.length}`); process.exitCode = 1; } else console.log('font-split OK');
