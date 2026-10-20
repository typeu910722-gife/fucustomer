// Round 26c: co-op team tools mid-shift. THREE browser contexts on ONE machine (same-machine multi-instance, one local
// server) — not three real devices, not a real phone network.
//  (1) the in-shift team list (top right) shows every person's ping (📶 N ms + ▂▄▆ bars: the quality reads from the number
//      of bars, not only colour) and refreshes it without rebuilding the list every frame.
//  (2) a guest's connection drops → the others see 「🔄 重連中…」 on that row; back online → the ping returns.
//  (3) pause menu → 👥 隊友: the host adds / removes a 電腦店員 and asks a player to leave (each needs a second press, and the
//      armed button survives the ping refreshes); the kicked player lands on the main menu with a friendly message;
//      the host hands the role to another player.
//  (4) idle host vote: only when the server runs with a short threshold (env AFK_SHORT=1 and the server started with
//      BK_HOST_AFK_S, e.g. 8); the real game waits HOST_AFK_S = 90 s, so this part is skipped against a normal server.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const AFK = process.env.AFK_SHORT === '1';
const launch = () => pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const browsers = [];
const errors = [];
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const prime = () => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明', renderScale: 0.5 }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'wiper'], seenMaps: ['convenience'] }));
};
const report = {};

// three software-GL pages share one machine: low quality, half render scale, and smaller windows for the two guests
async function player(name, small = false) {
  // one browser per player: each gets its own (software) GPU process instead of three pages queueing on one
  const browser = await launch(); browsers.push(browser);
  const ctx = await browser.newContext({ viewport: small ? { width: 960, height: 540 } : { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(name + ': ' + e));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|WebSocket/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await pg.goto(URL);
  await pg.evaluate(prime); await pg.reload();
  await pg.fill('#m-name', name);
  return { ctx, pg };
}
const frames = (pg, n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), [n, ms]);
// Overlay buttons are pressed with a DOM click (same handlers): with three software-GL pages on one busy machine Playwright's
// "element is stable" check (two matching animation frames) kept timing out even though the menu was not moving.
// screenshots get a long timeout and never fail the test on their own (three software-GL pages on a busy machine)
const shotErr = [];
const shot = async (pg, name, clip) => {
  const inGame = await pg.evaluate(() => !!window.__game?.view && !window.__game.destroyed).catch(() => false);
  if (inGame) { await gl(pg, true); await frames(pg, 3, 300).catch(() => {}); }
  await pg.screenshot({ path: `${OUT}/${name}`, timeout: 90000, ...(clip ? { clip } : {}) }).catch(e => shotErr.push(name + ': ' + String(e).split('\n')[0]));
  if (inGame) await gl(pg, false).catch(() => {});
};
// The 3D drawing (software WebGL) is what starves a busy machine: the guests skip it entirely, the host draws only around
// its screenshots. Game logic, networking and the HUD / menus run as usual.
const gl = (pg, on) => pg.evaluate(on => { const r = window.__game.view.renderer; if (!r.__draw) r.__draw = r.render; r.render = on ? r.__draw : () => {}; }, on);
const tap = (pg, sel) => pg.$eval(sel, b => b.click()).catch(async e => { console.log('DEBUG tap', sel, JSON.stringify(await pg.evaluate(() => ({ ov: window.__game?.overlay, ui: document.getElementById('ui')?.innerText.slice(0, 300), phase: window.__game?.snap?.phase })))); throw e; });
const toasts = pg => pg.evaluate(() => (window.__toastLog ?? []).filter(t => /房主|接任|投票/.test(t)).join(' | '));
const openTeam = async pg => {
  await pg.evaluate(() => { const g = window.__game; if (g.overlay !== 'none') g.closeOverlay(); g.openOverlay('pause'); });
  await pg.waitForSelector('#p-team', { timeout: 10000 }).catch(async e => { console.log('DEBUG openTeam', JSON.stringify(await pg.evaluate(() => ({ ov: window.__game.overlay, solo: window.__game.conn.solo, lobby: !!window.__game.lobby, ui: document.getElementById('ui')?.innerText.slice(0, 200) })))); throw e; });
  await tap(pg, '#p-team');
  await pg.waitForSelector('.teamcard', { timeout: 5000 });
};

const A = await player('房主阿明'), B = await player('店員小美', true), C = await player('工讀生阿傑', true);
const host = A.pg, b = B.pg, c = C.pg;

await host.click('#m-mp'); await host.click('#m-create');
await host.waitForSelector('#l-code');
const code = (await host.textContent('#l-code')).trim();
for (const g of [b, c]) { await g.click('#m-mp'); await g.fill('#m-code', code); await g.click('#m-join'); await g.waitForSelector('#l-ready'); await g.click('#l-ready'); }
await host.waitForFunction(() => /全員準備好了/.test(document.getElementById('l-readysum')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('not all ready'));
await host.click('#l-start');
for (const p of [host, b, c]) await p.waitForFunction(() => window.__game?.started && window.__game.snap?.players.length === 3, null, { timeout: 40000 });
for (const p of [host, b, c]) await gl(p, false);
// keep every toast text (the on-screen ones fade after a few seconds)
for (const p of [host, b, c]) await p.evaluate(() => { const g = window.__game, orig = g.onEvent.bind(g); window.__toastLog = []; g.onEvent = e => { if (e.e === 'toast') window.__toastLog.push(e.text); orig(e); }; });
const ids = await host.evaluate(() => { const s = window.__game.snap; return Object.fromEntries(s.players.map(p => [p.name, p.id])); });

// ---------- (1) in-shift pings ----------
await host.waitForFunction(() => document.querySelectorAll('#h-team .tping').length === 3, null, { timeout: 15000 }).catch(async () => fail('team list pings: ' + await host.innerText('#h-team')));
report.teamList = await host.$$eval('#h-team .stockrow', r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
const bars = await host.$$eval('#h-team .tping .sigbars', s => s.map(x => x.querySelectorAll('i:not(.off)').length));
if (bars.length !== 3 || bars.some(n => n < 1 || n > 3)) fail('signal bars missing: ' + JSON.stringify(bars));
if (!report.teamList.some(t => /👑/.test(t))) fail('no host crown in the team list');
// no per-frame rebuild: count how often the list is rewritten over 5 s (pings change at most every 2 s)
report.teamRewrites5s = await host.evaluate(() => new Promise(r => {
  let n = 0; const ob = new MutationObserver(m => { n += m.filter(x => x.type === 'childList' && x.target.id === 'h-team').length; });
  ob.observe(document.getElementById('h-team'), { childList: true });
  setTimeout(() => { ob.disconnect(); r(n); }, 5000);
}));
if (report.teamRewrites5s > 4) fail('team list rebuilt too often: ' + report.teamRewrites5s);
await frames(host, 3, 200);
await shot(host, 'r26c-team-pings.png');
await shot(host, 'r26c-team-pings-crop.png', { x: 900, y: 0, width: 380, height: 420 });

// ---------- (2) reconnecting indicator ----------
await c.evaluate(() => { window.__RealWS = window.WebSocket; window.WebSocket = function () { throw new Error('offline (test stub)'); }; window.WebSocket.OPEN = 1; window.__game.conn.ws?.close(); });
await host.waitForFunction(id => /重連中/.test(document.querySelector(`#h-team .stockrow[data-pid="${id}"]`)?.textContent ?? ''), ids['工讀生阿傑'], { timeout: 15000 }).catch(() => fail('host: no 重連中 on the dropped row'));
await c.waitForFunction(() => /重連中/.test(document.getElementById('h-team').textContent), null, { timeout: 8000 }).catch(() => fail('dropped player: own row not marked'));
await shot(host, 'r26c-team-reconnecting.png', { x: 900, y: 0, width: 380, height: 420 });
await c.evaluate(() => { window.WebSocket = window.__RealWS; window.dispatchEvent(new Event('online')); });
await host.waitForFunction(id => /📶\d+ms/.test(document.querySelector(`#h-team .stockrow[data-pid="${id}"]`)?.textContent ?? ''), ids['工讀生阿傑'], { timeout: 15000 }).catch(() => fail('ping not back after reconnect'));

// ---------- (3) 隊友 panel ----------
// On a heavily loaded machine a page can stall for > 9 s; its client then reconnects and the server (correctly) hands the
// host role to the next connected person. That is the existing host-drop behaviour, not what this part tests, so if it
// happened the current host hands the role back first (recorded in the report).
report.hostRestoredAfterStall = 0;
async function ensureHost() {
  const want = ids['房主阿明'];
  const cur = await host.evaluate(() => window.__game.lobby?.hostId);
  if (cur === want) return;
  report.hostRestoredAfterStall++;
  for (const p of [b, c]) {
    const isHost = await p.evaluate(() => !window.__game.destroyed && window.__game.lobby?.hostId === window.__game.selfId).catch(() => false);
    if (isHost) await p.evaluate(id => window.__game.send({ type: 'host', id }), want);
  }
  await host.waitForFunction(id => window.__game.lobby?.hostId === id, want, { timeout: 15000 }).catch(() => fail('could not restore the host'));
  await host.waitForFunction(() => !!document.querySelector('.teamcard [data-kick], .teamcard #t-addbot'), null, { timeout: 8000 }).catch(() => {});
}
await openTeam(host);
await ensureHost();
await openTeam(b);
if (await b.$('[data-kick]')) fail('a guest sees kick buttons');
if (!(await host.$(`[data-kick="${ids['工讀生阿傑']}"]`)) || !(await host.$(`[data-mkhost="${ids['店員小美']}"]`))) fail('host tools missing');
await shot(host, 'r26c-team-panel-host.png');
await shot(b, 'r26c-team-panel-guest.png');
// add a bot (two presses), then remove it (two presses)
await ensureHost();
await tap(host, '#t-addbot');
{ const t = await host.innerText('#t-addbot'); if (!/再按一次/.test(t)) fail('add bot not confirmed: ' + t + ' | ' + await host.evaluate(() => window.__game.overlay + ' ' + document.querySelector('#t-addbot')?.outerHTML)); }
await tap(host, '#t-addbot');
await host.waitForFunction(() => window.__game.snap.players.filter(p => p.bot).length === 1, null, { timeout: 8000 }).catch(() => fail('bot not added mid-shift'));
await host.waitForSelector('[data-rmbot]', { timeout: 5000 }).catch(() => fail('no remove-bot button'));
await shot(host, 'r26c-team-bot.png');
await host.waitForTimeout(700);
await tap(host, '[data-rmbot]'); await tap(host, '[data-rmbot]');
await host.waitForFunction(() => !window.__game.snap.players.some(p => p.bot), null, { timeout: 8000 }).catch(() => fail('bot not removed'));
// ask 阿傑 to leave: the first press arms, survives ping refreshes, the second press kicks
await ensureHost();
const kickSel = `[data-kick="${ids['工讀生阿傑']}"]`;
await host.waitForTimeout(700);
const armedAt = Date.now();
await tap(host, kickSel);
if (!/再按一次/.test(await host.innerText(kickSel))) fail('kick did not ask for confirmation');
// a ping refresh (and with it a lobby update) arrives while the button is armed: it must stay armed
await c.evaluate(() => window.__game.send({ type: 'hb', t: Date.now(), rtt: 333 }));
await host.waitForFunction(sel => /333 ms/.test(document.querySelector(sel)?.closest('.lp')?.textContent ?? ''), kickSel, { timeout: 3500 }).catch(() => {});
const armedFor = Date.now() - armedAt;
const stillArmed = /再按一次/.test(await host.innerText(kickSel).catch(() => ''));
report.kickArmedCheck = { armedFor, stillArmed };
// (the arming lasts 4 s by design; on a stalled machine the refresh can come later than that — only fail inside the window)
if (!stillArmed && Date.now() - armedAt < 3800) fail('kick confirmation lost on a refresh');
if (!stillArmed) await tap(host, kickSel);
await tap(host, kickSel);
await c.waitForSelector('#m-err', { timeout: 10000 }).catch(() => fail('kicked player not back on the main menu'));
report.kickedSees = await c.textContent('#m-err').catch(() => '');
if (!/房主請你先離開/.test(report.kickedSees) || !/日結/.test(report.kickedSees)) fail('kicked message: ' + report.kickedSees);
await shot(c, 'r26c-kicked-menu.png');
await host.waitForFunction(id => !window.__game.snap.players.some(p => p.id === id), ids['工讀生阿傑'], { timeout: 8000 }).catch(() => fail('kicked player still in the store'));
report.othersToast = await toasts(b);
await b.waitForFunction(() => (window.__toastLog ?? []).some(t => /請 工讀生阿傑 離開/.test(t)), null, { timeout: 5000 }).catch(() => {});
report.othersToast = await toasts(b);
if (!/請 工讀生阿傑 離開/.test(report.othersToast)) fail('others not told about the kick');
// hand the host role to 小美
await ensureHost();
await host.waitForTimeout(700);
await host.waitForSelector(`[data-mkhost="${ids['店員小美']}"]`);
await tap(host, `[data-mkhost="${ids['店員小美']}"]`); await tap(host, `[data-mkhost="${ids['店員小美']}"]`);
await b.waitForFunction(() => window.__game.lobby?.hostId === window.__game.selfId, null, { timeout: 8000 }).catch(() => fail('host role not handed over'));
await b.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(t => /你現在是房主/.test(t.textContent)), null, { timeout: 6000 }).catch(() => fail('new host not told'));
await b.waitForSelector('[data-kick]', { timeout: 6000 }).catch(() => fail('new host panel has no tools'));
await host.waitForFunction(() => !document.querySelector('[data-kick]'), null, { timeout: 6000 }).catch(() => fail('ex-host still has tools'));
await shot(b, 'r26c-new-host.png');

// ---------- (4) idle host vote (short threshold only) ----------
if (AFK) {
  // 小美 (now host) does nothing; 阿明 waits for the idle notice and votes from the 隊友 panel (1 of 1 = majority)
  await b.evaluate(() => { const g = window.__game; g.closeOverlay(); g.input.enabled = false; });
  await host.waitForSelector('#t-vote', { timeout: 30000 }).catch(() => fail('no vote button for an idle host'));
  await shot(host, 'r26c-afk-vote.png');
  await tap(host, '#t-vote');
  await host.waitForFunction(() => window.__game.lobby?.hostId === window.__game.selfId, null, { timeout: 8000 }).catch(() => fail('vote did not hand the host role on'));
  await b.waitForFunction(() => (window.__toastLog ?? []).some(t => /投票由/.test(t)), null, { timeout: 5000 }).catch(() => {});
  report.afkToast = await toasts(b);
  if (!/投票由 房主阿明 接任房主/.test(report.afkToast)) fail('vote result not announced');
} else report.afk = 'skipped (needs AFK_SHORT=1 and a server with BK_HOST_AFK_S)';

console.log(JSON.stringify({ code, ...report, shotErr, errors }, null, 1));
if (errors.length) process.exitCode = 1;
if (process.exitCode) console.log('ROUND26C FAILED'); else console.log('ROUND26C OK');
for (const br of browsers) await br.close();
