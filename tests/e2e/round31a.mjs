// Round 31a: phone HUD sides (844x390, touch emulation — Playwright hasTouch, not a real phone). Free play 雞排店 at
// 字級 130 % + red-green colour-blind, 115 % + red-green, and 100 %:
//  (1) with every shelf empty (the stock rows grow "空架" labels) the stock / team panels end above the 情緒爆發 bar;
//  (2) the top bar (day, clock, money…) keeps off the minimap and the top-right buttons, also when it is made longer
//      than the room between them (an extra pill is added in the page to force the long case);
//  (3) an opened 新奧客 card stays below the top bar when it fits there (it used to always move up over it).
// Screenshots to $OUT. One browser, software WebGL; an automated check, not a person.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { newProfile, allShifts, sanitizeProfile } from '../../shared/career.ts';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);
const check = (cond, msg, extra = '') => (cond ? ok(msg) : fail(`${msg} ${extra}`));

const p = newProfile(); p.level = 34; p.wallet = 900000;
for (const s of allShifts()) { p.stars[s.id] = 3; p.clears[s.id] = 2; }
p.story = ['ch1-intro', 'ch1-outro', 'ch2-intro', 'ch2-outro', 'ch3-intro'];
const PROFILE = sanitizeProfile(p);

/** Page boxes of the side pieces (visible ones only) and their overlaps (> 2 px both ways). */
const boxes = pg => pg.evaluate(() => {
  const ids = ['rightinfo', 'burst', 'minimap', 'topbar', 'introcard'];
  const box = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e || e.classList.contains('hidden') || e.closest('.hidden')) continue;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const b = e.getBoundingClientRect(); if (b.width > 1 && b.height > 1) box[id] = { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }
  const btns = [...document.querySelectorAll('#touch .tbtn')].filter(b => !b.classList.contains('hidden') && b.offsetParent !== null)
    .map(b => { const r = b.getBoundingClientRect(); return { id: b.id, l: r.left, t: r.top, r: r.right, b: r.bottom }; }).filter(b => b.r - b.l > 1);
  return { box, btns, W: innerWidth, H: innerHeight };
});
const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
const fmt = b => b ? `[${Math.round(b.l)},${Math.round(b.t)},${Math.round(b.r)},${Math.round(b.b)}]` : '-';

for (const [ts, cb] of [[1.3, 'rg'], [1.15, 'rg'], [1, 'off']]) {
  const tag = `${Math.round(ts * 100)}% ${cb}`;
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`${tag}: ${e}`));
  await pg.goto(URL);
  await pg.evaluate(([ts, cb, prof]) => {
    localStorage.clear();
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5, name: '猴子', captions: true, textScale: ts, colorblind: cb }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: [], seenMaps: ['convenience', 'chicken'] }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify(prof));
  }, [ts, cb, PROFILE]);
  await pg.reload();
  await pg.click('#m-career'); await pg.click('[data-tab="free"]');
  await pg.waitForSelector('[data-map="chicken"]', { timeout: 10000 });
  await pg.click('[data-map="chicken"]');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 40000 });
  await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 30000 });
  // no karens of its own: the test brings one in for (3)
  await pg.evaluate(() => { const w = window.__game.conn.room.world; w.karenTimer = 1e9; });

  // (1) every shelf empty
  await pg.evaluate(() => { const w = window.__game.conn.room.world; for (const k of Object.keys(w.shelves)) w.shelves[k] = 0; });
  await pg.waitForFunction(() => /0\/|空/.test(document.getElementById('h-stock')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(800);
  let m = await boxes(pg);
  check(m.box.rightinfo && m.box.burst && !hit(m.box.rightinfo, m.box.burst) && m.box.rightinfo.b <= m.box.burst.t, `${tag}: empty shelves — stock/team panels ${fmt(m.box.rightinfo)} end above 情緒爆發 ${fmt(m.box.burst)}`);
  const legible = await pg.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('rightinfo')).transform).a);
  check(legible >= 0.45, `${tag}: the panels shrink no further than 45 % (now ${legible.toFixed(2)})`);
  await pg.screenshot({ path: `${OUT}/r31a-${Math.round(ts * 100)}-${cb}-empty.png` });

  // (2) the top bar
  check(m.box.topbar && m.box.minimap && !hit(m.box.topbar, m.box.minimap), `${tag}: top bar ${fmt(m.box.topbar)} clear of the minimap ${fmt(m.box.minimap)}`);
  check(!m.btns.some(b => hit(m.box.topbar, b)), `${tag}: top bar clear of the top-right buttons`, JSON.stringify(m.btns.filter(b => hit(m.box.topbar, b)).map(b => b.id)));
  await pg.evaluate(() => { const s = document.createElement('div'); s.className = 'pill'; s.id = 'r31-long'; s.textContent = '🏬 店面等級 Lv.10・連鎖第 3 間分店'; document.getElementById('topbar').append(s); });
  await pg.waitForTimeout(600);
  m = await boxes(pg);
  check(m.box.topbar && !hit(m.box.topbar, m.box.minimap) && !m.btns.some(b => hit(m.box.topbar, b)) && m.box.topbar.l >= 0 && m.box.topbar.r <= m.W,
    `${tag}: a longer top bar ${fmt(m.box.topbar)} still sits between the minimap and the buttons`, JSON.stringify(m.btns.map(fmt)));
  await pg.screenshot({ path: `${OUT}/r31a-${Math.round(ts * 100)}-${cb}-longbar.png` });
  await pg.evaluate(() => document.getElementById('r31-long')?.remove());
  await pg.waitForTimeout(400);

  // (3) a new karen; the player opens its card
  await pg.evaluate(() => { const w = window.__game.conn.room.world; w.cfg.karens = ['cutter']; w.karenTimer = 0; });
  await pg.waitForFunction(() => { const e = document.getElementById('introcard'); return e && !e.classList.contains('hidden') && e.innerHTML.trim(); }, null, { timeout: 15000 })
    .catch(() => fail(`${tag}: no 新奧客 card`));
  await pg.waitForTimeout(500);
  await pg.tap('#introcard');
  await pg.waitForFunction(() => document.getElementById('introcard').classList.contains('open'), null, { timeout: 4000 }).catch(() => fail(`${tag}: card did not open on tap`));
  await pg.waitForTimeout(600);
  m = await boxes(pg);
  check(m.box.introcard && m.box.topbar && !hit(m.box.introcard, m.box.topbar), `${tag}: opened card ${fmt(m.box.introcard)} stays below the top bar ${fmt(m.box.topbar)}`);
  check(!m.btns.some(b => hit(m.box.introcard, b)), `${tag}: opened card clear of the touch buttons`);
  await pg.screenshot({ path: `${OUT}/r31a-${Math.round(ts * 100)}-${cb}-card.png` });
  await ctx.close();
}
check(!errors.length, 'no page errors', errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'ROUND 31a: FAILED' : 'ROUND 31a: PASSED');
