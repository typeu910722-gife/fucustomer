// Round 29c: the three leftovers from the monkey report (docs/QA-MONKEY.md) — one browser, software WebGL, one
// machine; the "app" is a normal Chromium page with a window.Capacitor stub and the controller is a navigator.getGamepads
// stub, not a phone or a real pad.
//  (1) phone 844x390: a long 每週挑戰 title no longer makes the shift bar's timer row run into 「開始上班」 (100 % and 130 %)
//  (2) the app's 「用瀏覽器登入」 link card closes with Esc and with pad B; Esc / B work on the other menu cards too
//  (3) 自己的店: leaving the career screen while upload / lock / 搗亂報告 (and the 「店門還沒鎖」 card) wait for the
//      server doesn't pull the player back when the reply lands (replies are delayed with page.route); the reply is saved
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KAREN_SEEN = ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'wiper'];

async function open(storage, { vp = { width: 1280, height: 720 }, touch = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: vp, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  if (init) await ctx.addInitScript(init);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  await pg.evaluate(ls => { localStorage.clear(); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, storage);
  await pg.reload();
  await pg.waitForSelector('#m-settings', { timeout: 20000 });
  return { ctx, pg, errors };
}
const settings = (extra = {}) => JSON.stringify({ quality: 'low', renderScale: 0.5, fpsCap: 30, name: '回歸', ...extra });
const flags = JSON.stringify({ tutorialDone: true, seenKarens: KAREN_SEEN, seenMaps: ['convenience', 'boba', 'chicken', 'drugstore', 'bento', 'electronics', 'bookstore'] });
const stars = {}; for (let c = 1; c <= 6; c++) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
const profile = store => JSON.stringify({ version: 1, level: 28, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 40, wins: 40 }, store });

// ---------- (1) phone: long weekly title vs 「開始上班」 ----------
// The longest real title today is 每週挑戰・<twist>・<store>・<special day>; the test forces an even longer one onto
// #sb-title (the HUD rewrites it every frame, so the element's textContent setter is pinned) to keep the check
// independent of this week's draw.
const LONG = '每週挑戰・🥶寒流來襲・🧋手搖飲料店・🎆跨年夜・🌀颱風夜加班到天亮';
for (const ts of [1, 1.3]) {
  const { ctx, pg, errors } = await open({ 'fucustomer.settings.v1': settings({ textScale: ts }), 'fucustomer.flags.v1': flags, 'fucustomer.career.v1': profile(null) }, { vp: { width: 844, height: 390 }, touch: true });
  await pg.click('#m-weekly');
  const up = await pg.waitForSelector('#pb-ready', { timeout: 60000 }).then(() => true, () => false);
  if (!up) { fail(`phone ${ts * 100}%: weekly shift never showed 開始上班`); await ctx.close(); continue; }
  const measure = () => pg.evaluate(long => {
    const t = document.getElementById('sb-title');
    if (!t.dataset.pinned) {
      const d = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(t, 'textContent', { configurable: true, get() { return d.get.call(this); }, set() { d.set.call(this, long); } });
      t.textContent = ''; t.dataset.pinned = '1';
    }
    const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    return { bar: r('shiftbar'), time: r('sb-time'), row: document.querySelector('.sb-row').getBoundingClientRect().height, btn: r('pb-ready'), cut: t.scrollWidth > t.clientWidth + 1, title: t.textContent };
  }, LONG);
  await measure(); await sleep(600);
  const m = await measure();
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const overlap = hit(m.time, m.btn) || hit(m.bar, m.btn);
  if (overlap || m.title !== LONG || errors.length) fail(`phone ${ts * 100}%: shift bar ${JSON.stringify(m.bar)} / timer ${JSON.stringify(m.time)} vs 開始上班 ${JSON.stringify(m.btn)} ${errors.join(' | ')}`);
  else ok(`phone ${ts * 100}%: long weekly title stays on one line (${m.cut ? 'cut with …' : 'fits'}, row ${Math.round(m.row)}px); bar bottom ${Math.round(m.bar.b)} ≤ 開始上班 top ${Math.round(m.btn.t)}`);
  await pg.screenshot({ path: `${OUT}/r29c-weekly-title-${ts}.png` });
  // control: with the old wrapping the same title does run into the button (proves the check can fail)
  if (ts === 1) {
    await pg.addStyleTag({ content: '.sb-row > * { white-space: normal !important; overflow: visible !important; }' });
    await sleep(300);
    const c = await measure();
    console.log(`note: control with the old wrapping: bar bottom ${Math.round(c.bar.b)}, button top ${Math.round(c.btn.t)} → ${hit(c.time, c.btn) || hit(c.bar, c.btn) ? 'overlaps (as reported)' : 'no overlap'}`);
  }
  await pg.evaluate(() => window.__game?.exit());
  await ctx.close();
}

// ---------- (2) app sign-in link card: Esc and pad B close it; Esc / B on the other menu cards ----------
{
  const init = () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const mk = () => ({ pressed: false, touched: false, value: 0 });
    window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad, null, null, null];
    window.open = () => null; // the system browser would open here
  };
  const { ctx, pg, errors } = await open({ 'fucustomer.settings.v1': settings(), 'fucustomer.flags.v1': flags }, { init });
  let polls = 0;
  await pg.route(/\/api\/auth\/link\/start/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'K7Q-4MZ', pollToken: 'poll-secret', expiresIn: 600 }) }));
  await pg.route(/\/api\/auth\/link\/poll/, r => { polls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pending: true, expiresIn: 600 }) }); });
  const btn = await pg.waitForSelector('#m-applink', { timeout: 15000 }).then(() => true, () => false);
  if (!btn) fail('Capacitor stub: no 用瀏覽器登入 button on the menu');
  else {
    const pressB = async () => {
      await pg.evaluate(() => { window.__pad.buttons[1] = { pressed: true, touched: true, value: 1 }; });
      await sleep(250);
      await pg.evaluate(() => { window.__pad.buttons[1] = { pressed: false, touched: false, value: 0 }; });
      await sleep(250);
    };
    const gone = () => pg.waitForFunction(() => !document.getElementById('applink'), null, { timeout: 4000 }).then(() => true, () => false);
    // Esc
    await pg.click('#m-applink');
    await pg.waitForSelector('#al-code', { timeout: 8000 });
    await pg.keyboard.press('Escape');
    const escClosed = await gone();
    const stillMenu = !!(await pg.$('#m-settings'));
    if (!escClosed || !stillMenu) fail(`Esc on the app-link card: closed=${escClosed}, menu still there=${stillMenu}`);
    else ok('app-link card: Esc closes it (the menu underneath stays)');
    const pollsAfter = polls; await sleep(3000);
    if (polls !== pollsAfter) fail(`app-link card closed with Esc but polling continued (${pollsAfter} → ${polls})`);
    else ok('app-link card: closing it with Esc stops the polling');
    // pad B
    await pg.click('#m-applink');
    await pg.waitForSelector('#al-code', { timeout: 8000 });
    await pressB();
    const bClosed = await gone();
    if (!bClosed || !(await pg.$('#m-settings'))) fail(`pad B on the app-link card: closed=${bClosed}`);
    else ok('app-link card: pad B closes it');
    // Esc while it is still 「準備中…」 (start request slow)
    await pg.unroute(/\/api\/auth\/link\/start/);
    await pg.route(/\/api\/auth\/link\/start/, async r => { await sleep(1500); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'K7Q-4MZ', pollToken: 'poll-secret', expiresIn: 600 }) }).catch(() => {}); });
    await pg.click('#m-applink');
    await pg.waitForSelector('#applink #al-cancel');
    await pg.keyboard.press('Escape');
    const early = await gone(); await sleep(2000);
    if (!early || (await pg.$('#applink'))) fail('Esc during 準備中… did not close the card for good');
    else ok('app-link card: Esc during 準備中… closes it and the late reply does not reopen it');
  }
  // the other menu cards: Esc = their back button
  const back = async (openSel, onSel, label) => {
    await pg.click(openSel);
    await pg.waitForSelector(onSel, { timeout: 8000 });
    await pg.keyboard.press('Escape');
    const home = await pg.waitForSelector('#m-settings', { timeout: 5000 }).then(() => true, () => false);
    if (!home) fail(`Esc on ${label} did not go back to the menu`); else ok(`Esc on ${label} → back to the menu`);
  };
  await back('#m-friend', '#fl-back', '查好友證照');
  await back('#m-mp', '#mp-back', '打工人的號角');
  await back('#m-career', '#c-back', '職涯');
  await back('#m-settings', '#s-ok2', '設定');
  if (errors.filter(e => !/capacitor|Capacitor|not implemented/i.test(e)).length) fail('page errors: ' + errors.join(' | '));
  else if (errors.length) console.log('note: Capacitor plugin stubs on the web build:', errors.join(' | '));
  await ctx.close();
}

// ---------- (3) 自己的店: leaving before the server answers ----------
{
  const save = { day: 3, money: 3000, rating: 4, backstock: { drinks: 20, snacks: 20, bento: 20 }, shelves: { drinks: 8, snacks: 8, bento: 6 }, upgrades: { shelves: 0, register2: 0, coffee: 0, scanner: 0, camera: 0 }, totalRevenue: 0 };
  const store = online => ({ name: '回歸手搖', invested: 2500, save, days: 2, negDays: 0, staff: { name: '小陳', mood: 70, quit: false }, wage: 'fair', bestDay: 0, withdrawn: 0, map: 'boba', ...(online ? { online } : {}) });
  const ONLINE = { code: 'ABC234', token: 'owner-token', locked: false };
  const { ctx, pg, errors } = await open({ 'fucustomer.settings.v1': settings(), 'fucustomer.flags.v1': flags, 'fucustomer.career.v1': profile(store(null)) });
  const DELAY = 2500;
  const seen = [];
  await pg.route(/\/api\/stores/, async r => {
    const req = r.request(), u = new globalThis.URL(req.url());
    seen.push(`${req.method()} ${u.pathname}`);
    await sleep(DELAY);
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    if (req.method() === 'POST' && u.pathname.endsWith('/api/stores')) return json({ code: ONLINE.code, token: ONLINE.token });
    if (req.method() === 'GET' && u.pathname.endsWith('/reports')) return json([{ at: Date.now(), raider: '搗蛋小華', score: 120, outside: false, money: 150, rating: 0.2 }]);
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() ?? '{}'); return json({ name: b.name, map: b.map, locked: !!b.locked, money: b.money, rating: b.rating, shelves: b.shelves }); }
    return json({});
  });
  const prof = () => pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
  const onMenu = () => pg.evaluate(() => !!document.getElementById('m-settings') && !document.getElementById('c-body'));
  const toStore = async () => { await pg.click('#m-career'); await pg.click('[data-tab="store"]'); };

  // upload → leave → reply lands
  await toStore();
  await pg.click('#st-upload');
  await pg.click('#c-back');
  await sleep(DELAY + 1200);
  const p1 = await prof();
  if (!(await onMenu()) || p1.store?.online?.code !== ONLINE.code) fail(`upload: menu=${await onMenu()}, saved code=${p1.store?.online?.code}`);
  else ok('自己的店 upload: left for the menu while waiting → stayed on the menu, store code still saved');

  // lock → leave → reply lands
  await toStore();
  await pg.click('#st-lock');
  await pg.click('#c-back');
  await sleep(DELAY + 1200);
  const p2 = await prof();
  if (!(await onMenu()) || p2.store?.online?.locked !== true) fail(`lock: menu=${await onMenu()}, locked=${p2.store?.online?.locked}`);
  else ok('自己的店 lock: left for the menu while waiting → stayed on the menu, door saved as locked');

  // 搗亂報告 → switch to another career tab → reply lands: stays on that tab, losses applied, message waits for the store tab
  await toStore();
  const money0 = (await prof()).store.save.money;
  // The career screen can redraw itself right after opening (see docs/MILESTONE.md backlog); click once it has settled
  // so the click lands on the live button.
  await sleep(800);
  await pg.click('#st-reports');
  await pg.waitForFunction(() => /查詢中/.test(document.getElementById('st-msg')?.textContent ?? ''), null, { timeout: 3000 }).catch(() => {});
  await pg.click('[data-tab="skills"]');
  await sleep(DELAY + 1200);
  const tab = await pg.evaluate(() => document.querySelector('.tab.on')?.dataset.tab);
  const p3 = await prof();
  if (tab !== 'skills' || p3.store.save.money !== money0 - 150) fail(`reports: tab=${tab}, money ${money0} → ${p3.store.save.money}`);
  else ok('自己的店 搗亂報告: switched tab while waiting → stayed on 技能, the $150 loss was still applied');
  await pg.click('[data-tab="store"]');
  const note = await pg.textContent('#st-msg').catch(() => '');
  if (!/搗蛋小華/.test(note ?? '')) fail(`reports: the report fetched while away was not shown on the store tab (${note})`);
  else ok('自己的店 搗亂報告: the report fetched while away shows when the store tab opens');
  await pg.click('#c-back');
  await pg.waitForSelector('#m-settings');

  // 「店門還沒鎖」 card (main.ts): unlock, play the own store, leave → card → 鎖門再走 → Esc (= 不用) → leave career → reply lands
  await pg.evaluate(() => { const p = JSON.parse(localStorage.getItem('fucustomer.career.v1')); p.store.online.locked = false; localStorage.setItem('fucustomer.career.v1', JSON.stringify(p)); });
  await toStore();
  await pg.click('#st-enter');
  const started = await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 60000 }).then(() => true, () => false);
  if (!started) fail('own store did not start');
  else {
    await pg.evaluate(() => window.__game.exit());
    const card = await pg.waitForSelector('#lk-yes', { timeout: 15000 }).then(() => true, () => false);
    if (!card) fail('no 店門還沒鎖 card after leaving the own store unlocked: ' + (await pg.evaluate(() => document.getElementById('ui').innerText.slice(0, 120))));
    else {
      await pg.click('#lk-yes');
      await pg.keyboard.press('Escape'); // = 不用，就開著 (data-back) → career store tab
      await pg.waitForSelector('#c-back', { timeout: 5000 });
      await pg.click('#c-back');
      await sleep(DELAY + 1200);
      const p4 = await prof();
      if (!(await onMenu()) || p4.store?.online?.locked !== true) fail(`lock card: menu=${await onMenu()}, locked=${p4.store?.online?.locked}`);
      else ok('店門還沒鎖 card: 鎖門再走 → Esc → left career while waiting → stayed on the menu, door saved as locked');
    }
  }
  console.log('requests seen:', seen.join(', '));
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  await ctx.close();
}

await browser.close();
