// Round 24c: long-term goals. (1) 自由營業 map card shows the store level; one business day → the nightly summary
// shows XP, the level-up (Lv1 → Lv2) and the branch income from an existing 分店; the profile keeps it.
// (2) 我的紀錄 panel (from the map picker button and the 📊 紀錄 tab). (3) 自己開店 at Lv7: the 店面等級 / 連鎖分店
// section, opening a 2nd branch from savings, the BRANCH_1 achievement.
// One browser, solo play (the simulation runs in the page). Not a cross-device test.
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
await pg.goto(URL);
await pg.evaluate(() => {
  localStorage.clear();
  const stars = {}; for (const c of [1, 2, 3, 4, 5, 6]) for (let i = 1; i <= 3; i++) stars[`${c}-${i}`] = 2;
  const save = { version: 1, day: 30, money: 2000, rating: 4, backstock: { drinks: 30, snacks: 30, bento: 20, extra: 30 }, shelves: { drinks: 8, snacks: 8, bento: 6, extra: 8 }, upgrades: {}, totals: { served: 500, karens: 40, revenue: 9000 } };
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], seenMaps: ['convenience', 'cafe'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({
    version: 1, level: 25, exp: 0, wallet: 9000, stars, clears: { ...stars }, stats: { shifts: 40, wins: 40 },
    story: ['ch1-intro', 'store-open', 'first-court'],
    // 自由營業便利商店: 5 XP short of Lv2 after 3 days
    freeProg: { convenience: { xp: 195, days: 3, streak: 1, bestStreak: 2, bestRevenue: 350, bestKarens: 3 } },
    store: {
      name: '阿明商店', invested: 2500, save, days: 30, negDays: 0, staff: { name: '小陳', mood: 70, quit: false }, wage: 'fair', bestDay: 400, withdrawn: 0, map: 'boba',
      prog: { xp: 4500, days: 30, streak: 4, bestStreak: 9, bestRevenue: 820, bestKarens: 11 },
      branches: [{ map: 'cafe', name: '阿明咖啡分店', manager: '小芬', cost: 2000, save: { ...save, money: 400, day: 1 }, prog: { xp: 0, days: 0 }, payDate: '', payCount: 0, earned: 0, log: [] }],
    },
  }));
});
await pg.reload();

// ---------- (1) free play: level bar on the card, a day, the level-up in the nightly summary ----------
await pg.click('#m-career'); await pg.click('[data-tab="free"]');
await pg.waitForSelector('[data-map="convenience"]');
const card = await pg.locator('.mapcard', { has: pg.locator('[data-map="convenience"]') }).innerText();
if (!/Lv1/.test(card) || !/巷口小店/.test(card) || !/195\/200 XP/.test(card)) fail('map card level bar: ' + card.replace(/\s+/g, ' ')); else ok('map card shows Lv1 巷口小店 195/200 XP');
const other = await pg.locator('.mapcard', { has: pg.locator('[data-map="bakery"]') }).innerText();
if (/Lv\d/.test(other)) fail('unplayed store shows a level bar'); else ok('unplayed store has no level bar');
await pg.locator('.mapcard', { has: pg.locator('[data-map="convenience"]') }).scrollIntoViewIfNeeded();
await pg.waitForTimeout(800); // menu fade-in
await pg.screenshot({ path: `${OUT}/r24c-picker.png` });

await pg.click('[data-map="convenience"]');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
await pg.evaluate(() => {
  const r = window.__game.conn.room;
  for (let k = 0; k < 600 && r.world.phase !== 'summary'; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); for (let i = 0; i < 20; i++) r.update(0.05); }
});
await pg.waitForFunction(() => /店面升級！Lv2/.test(document.getElementById('sum-prog')?.innerText ?? ''), null, { timeout: 10000 })
  .then(() => ok('nightly summary: 店面升級！Lv2')).catch(async () => fail('no level-up in the summary: ' + (await pg.evaluate(() => document.getElementById('sum-body')?.innerText ?? 'no summary'))));
const sum = await pg.evaluate(() => document.getElementById('sum-prog')?.innerText ?? '');
if (!/\+\d+ XP/.test(sum)) fail('no XP line: ' + sum); else ok('XP gained shown: ' + /\+\d+ XP/.exec(sum)[0]);
if (!/街坊熟面孔/.test(sum)) fail('no new title'); else ok('new title 街坊熟面孔');
if (!/里長來巡店/.test(sum)) fail('no unlock line'); else ok('unlock shown: 每日事件：里長來巡店');
if (!/分店入帳 \+\$24/.test(sum)) fail('no branch income line: ' + sum); else ok('branch income +$24 from 阿明咖啡分店');
const toasts = await pg.evaluate(() => document.getElementById('toasts')?.innerText ?? '');
if (!/店面升級/.test(toasts)) fail('no level-up toast'); else ok('level-up toast');
await pg.locator('#sum-prog').scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${OUT}/r24c-summary-levelup.png` });
const prof = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
const fp = prof.freeProg?.convenience;
if (!fp || fp.days !== 4 || fp.xp < 200) fail('free-play progress not saved ' + JSON.stringify(fp)); else ok(`saved: day 4, ${fp.xp} XP`);
const br = prof.store?.branches?.[0];
if (!br || br.earned !== 24 || br.payCount !== 1 || !br.log.length || prof.wallet !== 9024) fail('branch income not saved ' + JSON.stringify(br) + ' wallet ' + prof.wallet); else ok('branch paid $24 into savings, report logged: ' + br.log[0]);
await pg.evaluate(() => window.__game.exit());

// ---------- (2) 我的紀錄 ----------
await pg.waitForSelector('#mp-records', { timeout: 10000 }).catch(async () => { await pg.click('#m-career'); await pg.click('[data-tab="free"]'); await pg.waitForSelector('#mp-records'); });
const card2 = await pg.locator('.mapcard', { has: pg.locator('[data-map="convenience"]') }).innerText();
if (!/Lv2/.test(card2) || !/街坊熟面孔/.test(card2)) fail('card after the day: ' + card2.replace(/\s+/g, ' ')); else ok('map card now Lv2 街坊熟面孔');
if (!/繼續（第 2 天）/.test(card2)) fail('free-play save not written: ' + card2.replace(/\s+/g, ' ')); else ok('free-play save written (繼續 第 2 天)');
await pg.click('#mp-records');
await pg.waitForSelector('#my-records', { timeout: 5000 }).catch(() => fail('我的紀錄 panel not shown'));
const rec = await pg.locator('#my-records').innerText();
for (const want of ['便利商店', '自由營業', '阿明商店', '我的店', '阿明咖啡分店', '分店', '最佳單日營收', '單日最多奧客', '最長連續好評', '$820', '9 天']) if (!rec.includes(want)) fail(`我的紀錄 missing ${want}`);
if (!/Lv2/.test(rec) || !/Lv7/.test(rec)) fail('records levels: ' + rec.replace(/\s+/g, ' ')); else ok('我的紀錄 lists the free-play store (Lv2), the own store (Lv7) and the branch with their bests');
await pg.locator('#my-records').scrollIntoViewIfNeeded();
await pg.waitForTimeout(500);
await pg.screenshot({ path: `${OUT}/r24c-records.png` });

// ---------- (3) own store: level panel + open a 2nd branch ----------
await pg.click('[data-tab="store"]');
await pg.waitForSelector('#chain');
const chain = await pg.locator('#chain').innerText();
if (!/Lv7/.test(chain) || !/部落客愛店/.test(chain)) fail('own-store level panel: ' + chain.replace(/\s+/g, ' ')); else ok('own store Lv7 部落客愛店');
const open = pg.locator('#br-open');
if (!(await open.count()) || await open.isDisabled()) fail('can not open the 2nd branch at Lv7'); else ok('2nd branch can be opened ($3500)');
await pg.locator('input[name="br-map"][value="bakery"]').check();
await pg.fill('#br-name', '阿明麵包坊');
await open.click();
await pg.waitForFunction(() => document.body.innerText.includes('阿明麵包坊'), null, { timeout: 5000 }).catch(() => fail('new branch not listed'));
const prof2 = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
if (prof2.store.branches.length !== 2 || prof2.wallet !== 9024 - 3500) fail('branch purchase ' + prof2.store.branches.length + ' wallet ' + prof2.wallet); else ok('2nd branch opened, $3500 from savings');
if (!prof2.achievements.includes('BRANCH_1') || !prof2.achievements.includes('STORE_LV5')) fail('achievements ' + prof2.achievements); else ok('achievements BRANCH_1 + STORE_LV5 recorded');
const third = await pg.locator('#branches').innerText();
if (!/Lv9/.test(third)) fail('3rd branch gate text: ' + third.replace(/\s+/g, ' ')); else ok('3rd branch locked until Lv9');
await pg.locator('#chain').scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${OUT}/r24c-chain.png`, fullPage: false });
await pg.locator('[data-branch-play="1"]').scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${OUT}/r24c-branches.png` });

// visit the new branch: it opens as its own store with the manager
await pg.click('[data-branch-play="1"]');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 }).catch(() => fail('branch visit did not start'));
const crew = await pg.evaluate(() => window.__game?.snap?.players.map(p => p.name) ?? []);
if (!crew.some(n => /店長/.test(n))) fail('no manager in the branch: ' + crew); else ok('branch visit: crew ' + crew.join('、'));
await pg.evaluate(() => {
  const r = window.__game.conn.room;
  for (let k = 0; k < 600 && r.world.phase !== 'summary'; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); for (let i = 0; i < 20; i++) r.update(0.05); }
});
await pg.waitForFunction(() => /XP/.test(document.getElementById('sum-prog')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('branch summary without the level panel'));
const prof3 = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
const b2 = prof3.store.branches.find(b => b.map === 'bakery');
if (!b2 || b2.prog.days !== 1 || b2.save.day !== 2 || b2.earned !== 0) fail('branch day not recorded ' + JSON.stringify(b2?.prog) + ' day ' + b2?.save.day + ' earned ' + b2?.earned); else ok('branch day saved (its own day 2, XP, and it did not pay itself)');
await pg.screenshot({ path: `${OUT}/r24c-branch-summary.png` });
await pg.evaluate(() => window.__game.exit());

if (errors.length) fail('page errors: ' + errors.join(' | ')); else ok('no page errors');
await browser.close();
