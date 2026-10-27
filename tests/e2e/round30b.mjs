// Round 30b: regressions for what the round-30 monkey sweep (tests/e2e/monkey.mjs, scenario "pad") found.
// A FAKE standard-mapping gamepad (navigator.getGamepads replaced in the page, the tests/e2e/round21.mjs technique) —
// NOT a real controller. One browser, software WebGL, solo shift (the simulation runs in the page).
//  (1) In-shift shop with the pad: D-pad ↓ opens it; ↓ again moves the focus inside it instead of closing it.
//  (2) The shop is redrawn whenever money / stock changes: the focused 買一箱 button keeps the focus (and its ring)
//      across a redraw instead of the next D-pad press jumping back to 關閉. B still closes; keyboard B still toggles.
//  (3) 存檔備份 ☁ with a (fake) signed-in account: /api/cloudsave answers 200 with an HTML page (captive portal) or `{}`
//      → an error line, no exception, the buttons usable again. (page.route stubs; nothing reaches a real login.)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);
const check = (c, m, extra = '') => (c ? ok(m) : fail(`${m} ${extra}`));
const B = { A: 0, B: 1, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0] };
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
const pg = await ctx.newPage();
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI|WebSocket/.test(m.text())) errors.push(m.text()); });
await pg.goto(URL);
await pg.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '手把店員' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: [], seenMaps: ['convenience'] }));
});
await pg.reload();
const frames = (n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), [n, ms]);
const press = async (i, ms = 150) => {
  await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = true; b.value = 1; window.__pad.timestamp++; }, i);
  await frames(3, ms);
  await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = false; b.value = 0; window.__pad.timestamp++; }, i);
  await frames(3, 120);
};
const state = () => pg.evaluate(() => {
  const a = document.activeElement, f = document.querySelector('.padfocus');
  const key = e => (e ? e.dataset.buy ? `buy:${e.dataset.buy}` : e.dataset.upg ? `upg:${e.dataset.upg}` : e.id || e.tagName : null);
  return { overlay: window.__game.overlay, active: key(a), ring: key(f), same: !!f && f === a };
});

await pg.click('#m-career'); await pg.click('[data-tab="free"]'); await pg.click('[data-map="convenience"]');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 40000 });
await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 20000 });
await frames(5, 500);

// ---- (1) ↓ opens, ↓ again stays open ----
await press(B.DOWN);
await pg.waitForFunction(() => window.__game.overlay === 'shop', null, { timeout: 5000 }).catch(() => {});
let s = await state();
check(s.overlay === 'shop' && s.active === 'shop-close', 'D-pad ↓ opened the shop, focus on 關閉', JSON.stringify(s));
await press(B.DOWN);
await frames(3, 300);
s = await state();
check(s.overlay === 'shop', 'D-pad ↓ inside the shop did not close it', JSON.stringify(s));
await press(B.RIGHT); await press(B.LEFT); await press(B.UP);
s = await state();
check(s.overlay === 'shop', 'D-pad → / ← / ↑ inside the shop did not act in the shift (overlay still shop)', JSON.stringify(s));

// ---- (2) focus survives a redraw ----
// walk up until a 買一箱 button has the focus
for (let i = 0; i < 6 && !/^buy:/.test((await state()).active ?? ''); i++) await press(B.UP);
s = await state();
check(/^buy:/.test(s.active ?? '') && s.same, 'D-pad ↑ reached a 買一箱 button with the focus ring', JSON.stringify(s));
const before = s.active;
const redraws = await pg.evaluate(async () => {
  const body = document.getElementById('shop-body'); let n = 0;
  const mo = new MutationObserver(() => { n++; }); mo.observe(body, { childList: true });
  const w = window.__game.conn.room.world; w.money += 7; // money changed → the shop redraws
  await new Promise(r => setTimeout(r, 1200));
  mo.disconnect(); return n;
});
s = await state();
check(redraws > 0, `the shop redrew (${redraws}×)`);
check(s.active === before && s.same && s.overlay === 'shop', `focus kept on ${before} across the redraw`, JSON.stringify(s));
// A buys it (the button disables, the stock changes, the shop redraws): the focus stays in the shop, not on <body>
const stock0 = await pg.evaluate(() => JSON.stringify(window.__game.snap.backstock));
await press(B.A);
await pg.waitForFunction(s0 => JSON.stringify(window.__game.snap.backstock) !== s0, stock0, { timeout: 5000 }).catch(() => {});
await frames(4, 500);
s = await state();
check(s.overlay === 'shop' && s.active && s.active !== 'BODY' && s.same, 'after buying with A the focus is still in the shop', JSON.stringify(s));
await press(B.B);
await pg.waitForFunction(() => window.__game.overlay === 'none', null, { timeout: 5000 }).then(() => ok('B closed the shop')).catch(() => fail('B did not close the shop'));

// ---- keyboard B still toggles the shop ----
await pg.keyboard.press('KeyB');
await pg.waitForFunction(() => window.__game.overlay === 'shop', null, { timeout: 5000 }).then(() => ok('keyboard B opened the shop')).catch(() => fail('keyboard B did not open the shop'));
await pg.keyboard.press('KeyB');
await pg.waitForFunction(() => window.__game.overlay === 'none', null, { timeout: 5000 }).then(() => ok('keyboard B closed the shop')).catch(() => fail('keyboard B did not close the shop'));

await ctx.close();

// ---- (3) cloud save: a 200 that isn't ours ----
{
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await c2.route('**/api/**', r => {
    const u = r.request().url();
    if (!/\/api\/cloudsave/.test(u)) return r.abort('internetdisconnected'); // licence sync offline (keeps the fake sign-in)
    return r.request().method() === 'PUT'
      ? r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Wi-Fi login</body></html>' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p2 = await c2.newPage();
  const errs = [];
  p2.on('pageerror', e => errs.push(String(e)));
  await p2.addInitScript(() => { window.__rej = []; addEventListener('unhandledrejection', e => window.__rej.push(String(e.reason))); });
  await p2.goto(URL);
  await p2.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '雲端' }));
    localStorage.setItem('fucustomer.account.v1', JSON.stringify({ no: 'FU-TEST-0001', session: 'not-a-real-session' }));
  });
  await p2.reload();
  await p2.click('#m-settings'); await p2.click('#s-backup');
  await p2.waitForSelector('#bk-up', { timeout: 8000 });
  for (const [btn, what] of [['#bk-up', 'upload → 200 HTML page'], ['#bk-down', 'restore → 200 {}']]) {
    await p2.click(btn, { timeout: 5000 }).catch(() => fail(`${btn} could not be pressed`));
    await p2.waitForFunction(() => /❌/.test(document.getElementById('bk-cres')?.innerText ?? ''), null, { timeout: 8000 }).catch(() => {});
    const st = await p2.evaluate(() => ({ msg: document.getElementById('bk-cres')?.innerText ?? '', disabled: ['bk-up', 'bk-down', 'bk-del'].filter(id => document.getElementById(id)?.disabled), rej: window.__rej }));
    check(/❌.*連不上雲端/.test(st.msg) && !st.disabled.length && !st.rej.length, `cloud ${what}: error shown, buttons usable`, JSON.stringify(st));
  }
  check(!errs.length, 'cloud: no page errors', JSON.stringify(errs));
  await c2.close();
}

check(!errors.length, 'no page errors', JSON.stringify(errors));
await browser.close();
