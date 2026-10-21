// Round 28c: regression checks for the bugs the monkey test (tests/e2e/monkey.mjs) found. One browser, software WebGL,
// one machine — targeted replays of the failing paths, not a device test.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);

async function page(storage, vp = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI|WebSocket/.test(m.text())) errors.push(m.text()); });
  await pg.goto(URL);
  await pg.evaluate(ls => { localStorage.clear(); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, { 'fucustomer.settings.v1': JSON.stringify({ quality: 'low', renderScale: 0.5, name: '回歸' }), ...storage });
  await pg.reload();
  await pg.waitForSelector('#m-settings', { timeout: 20000 });
  return { ctx, pg, errors };
}

// ---------- (1) 設定 → 存檔備份 → ← 返回設定 threw (the settings form was read after it was gone) ----------
{
  const { ctx, pg, errors } = await page({});
  await pg.click('#m-settings');
  await pg.selectOption('#s-text', '1.15');
  await pg.click('#s-backup');
  await pg.waitForSelector('#bk-back');
  await pg.click('#bk-back');
  const back = await pg.waitForSelector('#s-text', { timeout: 5000 }).then(() => true, () => false);
  if (!back) fail('← 返回設定 did not bring the settings back');
  const kept = await pg.inputValue('#s-text').catch(() => '');
  if (kept !== '1.15') fail(`unsaved settings change lost on the way back (${kept})`);
  if (errors.length) fail(`errors: ${errors.join(' | ')}`);
  if (back && kept === '1.15' && !errors.length) ok('settings → backup → back: no error, unsaved choice kept');
  await ctx.close();
}

// ---------- (2) 自訂伺服器 junk was saved and only dropped on the next load (meanwhile 多人 tried to connect to it) ----------
{
  const { ctx, pg, errors } = await page({});
  await pg.click('#m-settings');
  await pg.fill('#s-url', 'xxxxxxxx not a server');
  await pg.click('#s-ok');
  await pg.waitForSelector('#m-settings');
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.settings.v1')).serverUrl);
  await pg.click('#m-settings');
  await pg.fill('#s-url', ' wss://example.com/ws ');
  await pg.click('#s-ok');
  const good = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.settings.v1')).serverUrl);
  if (saved !== '' || good !== 'wss://example.com/ws' || errors.length) fail(`server url: junk saved as ${JSON.stringify(saved)}, valid saved as ${JSON.stringify(good)} ${errors.join(' | ')}`);
  else ok('custom server field: junk is not saved, a wss:// address is (trimmed)');
  await ctx.close();
}

// ---------- (3) after the game's own 全螢幕, the web menu offered the app's "用瀏覽器登入 Google" flow ----------
{
  const { ctx, pg, errors } = await page({});
  await pg.click('#m-settings');
  await pg.check('#s-full');
  await pg.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 }).catch(() => {});
  const fs = await pg.evaluate(() => ({ el: !!document.fullscreenElement, mq: matchMedia('(display-mode: fullscreen)').matches }));
  await pg.click('#s-ok');
  await pg.waitForSelector('#m-settings');
  await pg.waitForTimeout(800);
  const appLink = await pg.$('#m-applink');
  if (!fs.el) console.log('note: fullscreen not granted in this browser; check is weaker', JSON.stringify(fs));
  if (appLink || errors.length) fail(`web page in full screen shows the app-link sign-in (${JSON.stringify(fs)}) ${errors.join(' | ')}`);
  else ok(`web page in full screen keeps the normal sign-in (${JSON.stringify(fs)})`);
  await ctx.close();
}

// ---------- (4) the regular's card (#arccard) covered the karen intro card (#introcard) at shift start ----------
{
  const { ctx, pg } = await page({});
  const op = await pg.evaluate(async () => {
    document.getElementById('hud').classList.remove('hidden');
    const ic = document.getElementById('introcard'), ac = document.getElementById('arccard');
    ic.innerHTML = '<h3>新奧客</h3><p>說明</p>'; ac.innerHTML = '<p>常客</p>';
    ic.classList.remove('hidden'); ac.classList.remove('hidden');
    await new Promise(r => setTimeout(r, 700));
    const both = +getComputedStyle(ac).opacity;
    ic.classList.add('hidden');
    await new Promise(r => setTimeout(r, 700));
    return { both, after: +getComputedStyle(ac).opacity };
  });
  if (op.both > 0.05 || op.after < 0.95) fail(`arccard opacity while the intro card shows ${op.both}, after ${op.after}`);
  else ok('regular card waits while the karen intro card is up, then shows');
  await ctx.close();
}

// ---------- (5) phone 844x390 at 字級 130 %: the title screen's left column (查好友證照) ran off the screen, no scrolling ----------
{
  const stars = {}; for (let i = 1; i <= 5; i++) stars['1-' + i] = 2;
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  await pg.goto(URL);
  await pg.evaluate(c => { localStorage.clear(); localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', textScale: 1.3, name: '猴子' })); localStorage.setItem('fucustomer.career.v1', c); },
    JSON.stringify({ version: 1, level: 8, stars, clears: stars, stats: { shifts: 6, wins: 6 } }));
  await pg.reload(); await pg.waitForSelector('#m-settings'); await pg.waitForTimeout(400);
  const stuck = await pg.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#ui button, #ui input')) {
      if (el.getBoundingClientRect().width < 2) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= innerHeight + 1 && r.top >= -1 && r.right <= innerWidth + 1) continue;
      // off screen: fine only inside a box the player can scroll (overflow auto/scroll with more content than room;
      // scrollIntoView() would also move overflow:hidden boxes, which a finger can't)
      let p = el.parentElement, scrolls = false;
      for (; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) { scrolls = true; break; } }
      if (!scrolls) out.push(`${el.id || el.textContent.trim().slice(0, 10)} [${[r.left, r.top, r.right, r.bottom].map(Math.round)}]`);
    }
    return out;
  });
  if (stuck.length) fail(`phone 130% title screen: controls off screen with nothing to scroll: ${stuck.join(', ')}`);
  else ok('phone 130% title screen: every control is on screen or inside a scrollable box');
  await ctx.close();
}

// ---------- (6) phone 844x390: the first-visit store card (#introcard) ran off the bottom of the screen ----------
for (const ts of [1, 1.3]) {
  const stars = {}; for (let i = 1; i <= 5; i++) stars['1-' + i] = 2;
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  await pg.evaluate(([c, ts]) => {
    localStorage.clear();
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5, fpsCap: 30, textScale: ts, name: '猴子' }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: [], seenMaps: ['convenience'] }));
    localStorage.setItem('fucustomer.career.v1', c);
  }, [JSON.stringify({ version: 1, level: 8, stars, clears: stars, stats: { shifts: 6, wins: 6 } }), ts]);
  await pg.reload(); await pg.waitForSelector('#m-career');
  await pg.click('#m-career'); await pg.click('[data-tab="free"]'); await pg.click('[data-map="chicken"]');
  const shown = await pg.waitForSelector('#introcard:not(.hidden)', { timeout: 60000 }).then(() => true, () => false);
  await pg.waitForTimeout(1200); // the card pops in (scale animation)
  const r = await pg.evaluate(() => { const b = document.getElementById('introcard').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); });
  if (!shown || r[1] < 0 || r[3] > 391 || r[0] < 0 || r[2] > 845 || errors.length) fail(`phone ${ts * 100}%: store intro card ${shown ? 'off screen' : 'never shown'} [${r}] ${errors.join(' | ')}`);
  else ok(`phone ${ts * 100}%: first-visit store card fits the screen [${r}]`);
  await pg.screenshot({ path: `${OUT}/r28c-introcard-${ts}.png` });
  await ctx.close();
}

await browser.close();
