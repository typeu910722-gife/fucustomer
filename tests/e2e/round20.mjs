// Round 20: 自動店員.
// (1) 自由營業: hire 小陳 from the store picker; he works the day and his wage shows in the nightly summary; the choice
//     is remembered per store save.
// (2) 打工人的號角 lobby: the host switches on 電腦店員補位, two 🤖 bots appear in both lobbies and then work in the store;
//     the "已複製" note survives a lobby redraw; the read-only lobby shows the store icon once.
// Browser contexts on ONE machine (simulated players + server-run bots) — not real devices.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m, JSON.stringify(errors)); process.exitCode = 1; };
const origin = new globalThis.URL(URL).origin;
const prime = () => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'wiper'], seenMaps: ['convenience', 'supermarket'] }));
};

// ---------- (1) free play with 小陳 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push('solo: ' + e));
  await pg.goto(URL);
  await pg.evaluate(prime);
  await pg.reload();
  await pg.click('#m-career'); await pg.click('[data-tab="free"]');
  await pg.waitForSelector('[data-hire="supermarket"]');
  const label = await pg.locator('label.hirebox').first().innerText();
  if (!/雇用小陳（日薪 \$\d+，從當天營收扣）/.test(label)) fail('hire label: ' + label);
  await pg.check('[data-hire="supermarket"]');
  await pg.locator('[data-hire="supermarket"]').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: `${OUT}/r20-picker-hire.png` });
  await pg.click('[data-map="supermarket"]');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  const crew = await pg.evaluate(() => window.__game.snap.players.map(p => p.name));
  if (!crew.includes('小陳') || crew.length !== 2) fail('crew ' + crew);
  // let the day open and watch 小陳 work for a while (the sim runs faster than real time here)
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.phaseLeft = 0.1; for (let i = 0; i < 20 * 60; i++) { r.update(0.05); window.__game.conn.driveStaff?.(0.05); } });
  await pg.waitForTimeout(1500);
  const work = await pg.evaluate(() => { const p = [...window.__game.conn.room.world.players.values()].find(x => x.name === '小陳'); return p.stats; });
  console.log('小陳 after ~60 s of business:', JSON.stringify(work));
  if (work.restocked + work.served === 0) fail('小陳 did nothing');
  await pg.screenshot({ path: `${OUT}/r20-solo-staff.png` });
  // fast-forward to tonight's settlement
  await pg.evaluate(() => {
    const r = window.__game.conn.room;
    for (let k = 0; k < 400 && r.world.phase !== 'summary'; k++) { r.world.phaseLeft = Math.min(r.world.phaseLeft, 0.1); for (let i = 0; i < 20; i++) r.update(0.05); }
  });
  await pg.waitForFunction(() => /店員日薪/.test(document.getElementById('sum-body')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('summary has no wage line'));
  const wage = await pg.evaluate(() => window.__game.snap.dayStats.wage);
  if (wage !== 90) fail('wage ' + wage);
  await pg.screenshot({ path: `${OUT}/r20-solo-summary.png` });
  await pg.evaluate(() => window.__game.exit());
  await pg.waitForSelector('[data-hire="supermarket"]', { timeout: 10000 }).catch(async () => { await pg.click('#m-career'); await pg.click('[data-tab="free"]'); await pg.waitForSelector('[data-hire="supermarket"]'); });
  if (!(await pg.isChecked('[data-hire="supermarket"]'))) fail('hire choice not remembered for the supermarket');
  if (await pg.isChecked('[data-hire="convenience"]')) fail('hire leaked to another store');
  await ctx.close();
}

// ---------- (2) multiplayer lobby: 電腦店員補位 ----------
{
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const host = await hostCtx.newPage();
  host.on('pageerror', e => errors.push('host: ' + e));
  await host.goto(URL);
  await host.evaluate(prime); await host.reload();
  await host.fill('#m-name', '房主A');
  await host.click('#m-mp'); await host.click('#m-create');
  await host.waitForSelector('#l-code');
  const code = (await host.textContent('#l-code')).trim();
  if (!(await host.$('#l-bots'))) fail('no bot toggle for the host');
  await host.check('#l-bots');
  await host.waitForFunction(() => [...document.querySelectorAll('.players li')].filter(li => li.textContent.includes('電腦店員')).length === 2, null, { timeout: 8000 }).catch(() => fail('host lobby: no bots'));
  if (!(await host.isChecked('#l-bots'))) fail('toggle not kept across redraw');

  const phoneCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', e => errors.push('guest: ' + e));
  await phone.goto(URL);
  await phone.evaluate(prime);
  await phone.goto(`${URL}?join=${code}`);
  await phone.waitForSelector('#iv-join');
  await phone.fill('#iv-name', '手機B'); await phone.click('#iv-join');
  await phone.waitForSelector('#l-ready', { timeout: 20000 });
  const ro = await phone.locator('.lobbycfg.ro').innerText();
  if (/🏪\s*🏪/.test(ro)) fail('duplicated store icon: ' + ro);
  if (!/電腦店員補位/.test(ro)) fail('guest does not see the bot setting: ' + ro);
  const guestBots = await phone.$$eval('.players li', els => els.filter(e => e.textContent.includes('🤖')).length);
  if (guestBots !== 2) fail('guest sees bots: ' + guestBots);
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${OUT}/r20-lobby-guest-phone.png` });

  // copy confirmation survives the redraw caused by the guest getting ready
  await host.click('#l-copy');
  await host.waitForFunction(() => /已複製/.test(document.getElementById('l-sharemsg')?.textContent ?? ''), null, { timeout: 3000 }).catch(() => fail('no copy note'));
  await phone.click('#l-ready');
  await host.waitForFunction(() => document.querySelectorAll('.players .tag.ok').length >= 3, null, { timeout: 5000 }).catch(() => fail('host did not see the guest ready'));
  await host.waitForTimeout(150);
  const afterRedraw = await host.textContent('#l-sharemsg');
  if (!/已複製/.test(afterRedraw)) fail('copy note vanished on redraw: ' + afterRedraw);
  await host.waitForTimeout(600); // the lobby card pops in again on every lobby update
  await host.screenshot({ path: `${OUT}/r20-lobby-host.png` });
  await host.waitForTimeout(2600);
  if (/已複製/.test(await host.textContent('#l-sharemsg'))) fail('copy note never goes away');

  await host.click('#l-start');
  await host.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  await phone.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  const hud = await host.textContent('#h-players');
  if (!/🤖2/.test(hud)) fail('HUD player count: ' + hud);
  const team = await host.textContent('#h-team');
  if ((team.match(/🤖/g) ?? []).length < 2) fail('team list: ' + team);
  // everyone ready → the store opens now; the bots run on the server: wait until they have moved off their spawn spots
  for (const pg of [host, phone]) await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
  const start = await host.evaluate(() => window.__game.snap.players.filter(p => p.bot).map(p => [p.x, p.z]));
  await host.waitForFunction(s0 => window.__game.snap.players.filter(p => p.bot).some((p, i) => Math.hypot(p.x - s0[i][0], p.z - s0[i][1]) > 1), start, { timeout: 90000 }).catch(() => fail('bots never moved'));
  await host.screenshot({ path: `${OUT}/r20-game-host-bots.png` });
  await phone.screenshot({ path: `${OUT}/r20-game-guest-bots.png` });
  await hostCtx.close(); await phoneCtx.close();
}

await browser.close();
if (errors.length) fail('page errors');
if (!process.exitCode) console.log('round20 OK');
