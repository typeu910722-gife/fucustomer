// Round 25: co-op feel. TWO browser contexts on ONE machine (same-machine multi-instance, one local server) —
// not two real devices, not a real phone network.
//  (1) lobby: each player's ping (📶 N ms) and a clear ready tag; the host's 「請他離開」 needs a second press and stays
//      armed through the lobby's ping refreshes; 「交給他」 is there for the host.
//  (2) emote wheel: T opens the 8-slot wheel, a number key sends; the other player sees a speech bubble over the sender
//      and a feed line. A FAKE gamepad (navigator.getGamepads replaced): hold View, push the stick, let go → sent.
//  (3) reconnect: the guest's connection drops mid-shift (socket closed, new sockets fail — stubbed in the page) → 「重新連線中…」 with a
//      countdown → back online → 「已回到店裡」, same character, the box still in hand, about the same spot.
//  (4) the host leaves → the guest is told they took over as host.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m, JSON.stringify(errors)); process.exitCode = 1; };
const prime = () => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'wiper'], seenMaps: ['convenience'] }));
};
const report = {};

async function player(name, pad = false) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (pad) await ctx.addInitScript(() => {
    const mk = () => ({ pressed: false, touched: false, value: 0 });
    window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(name + ': ' + e));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|WebSocket/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await pg.goto(URL);
  await pg.evaluate(prime); await pg.reload();
  await pg.fill('#m-name', name);
  return { ctx, pg };
}
const frames = (pg, n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), [n, ms]);

const A = await player('房主阿明');
const B = await player('店員小美', true);
const host = A.pg, guest = B.pg;

// ---------- (1) lobby ----------
await host.click('#m-mp'); await host.click('#m-create');
await host.waitForSelector('#l-code');
const code = (await host.textContent('#l-code')).trim();
await guest.click('#m-mp'); await guest.fill('#m-code', code); await guest.click('#m-join');
await guest.waitForSelector('#l-ready');
await host.waitForFunction(() => document.querySelectorAll('.players .lp').length === 2, null, { timeout: 8000 });
// pings arrive with the first heartbeat echo (sent right after joining) and are refreshed every few seconds
await host.waitForFunction(() => [...document.querySelectorAll('.players .tag.ping')].filter(t => /\d+ ms/.test(t.textContent)).length === 2, null, { timeout: 12000 }).catch(() => fail('pings not shown in the host lobby'));
report.lobbyPings = await host.$$eval('.players .lp', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
if (!(await host.$('[data-kick]')) || !(await host.$('[data-mkhost]'))) fail('host has no kick / transfer buttons');
if (await guest.$('[data-kick]')) fail('guest sees kick buttons');
if (!/未準備/.test(await host.innerText('.players'))) fail('guest not shown as 未準備');
// 請他離開: first press only arms it, and the arming survives the ping refreshes
await host.click('[data-kick]');
if (!/再按一次/.test(await host.innerText('[data-kick]'))) fail('kick did not ask for confirmation');
await host.waitForTimeout(2600);
if (!/再按一次/.test(await host.innerText('[data-kick]'))) fail('kick confirmation lost on a lobby redraw');
await host.screenshot({ path: `${OUT}/r25-lobby-host.png` });
await host.waitForTimeout(1700); // let the confirmation time out (we don't kick here)
await guest.click('#l-ready');
await host.waitForFunction(() => /已準備/.test(document.querySelector('.players')?.innerText ?? '') && /全員準備好了/.test(document.getElementById('l-readysum')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => fail('ready state not clear'));
await guest.screenshot({ path: `${OUT}/r25-lobby-guest.png` });
await host.click('#l-start');
for (const p of [host, guest]) await p.waitForFunction(() => window.__game?.started && window.__game.snap?.players.length === 2, null, { timeout: 40000 });
const ids = await host.evaluate(() => ({ host: window.__game.selfId, guest: window.__game.snap.players.find(p => p.id !== window.__game.selfId).id }));

// face each other so the bubble is on screen
async function lookAt(pg, otherId) {
  await pg.evaluate(id => { const g = window.__game; const o = g.snap.players.find(p => p.id === id); g.yaw = Math.atan2(o.x - g.pos.x, o.z - g.pos.z); g.pitch = -0.05; }, otherId);
}

// ---------- (2) emote wheel ----------
await lookAt(guest, ids.host);
report.hostOverlayBeforeT = await host.evaluate(() => window.__game.overlay);
if (report.hostOverlayBeforeT !== 'none') { await host.keyboard.press('Escape'); await host.waitForTimeout(300); }
await host.keyboard.press('KeyT');
await host.waitForSelector('#emotewheel:not(.hidden)', { timeout: 12000 }).catch(async () => fail('T did not open the wheel: ' + JSON.stringify(await host.evaluate(() => ({ ov: window.__game.overlay, ew: [...document.querySelectorAll('#emotewheel')].map(e => e.className + ':' + getComputedStyle(e).display), wo: window.__game.wheel.isOpen, ui: document.getElementById('ui').innerText.slice(0, 80), act: document.activeElement?.tagName + '#' + document.activeElement?.id, lock: !!document.pointerLockElement })))));
report.wheelSlots = await host.$$eval('#emotewheel .ew-slot', b => b.map(x => x.innerText.replace(/\s+/g, ' ')));
if (report.wheelSlots.length !== 8) fail('wheel slots ' + report.wheelSlots.length);
await host.screenshot({ path: `${OUT}/r25-wheel.png` });
await host.keyboard.press('Digit6');
await host.waitForSelector('#emotewheel.hidden', { state: 'attached', timeout: 6000 }).catch(() => fail('wheel stayed open after sending'));
await guest.waitForFunction(id => window.__game.quickLog.some(q => q.id === id && /讚/.test(q.text)), ids.host, { timeout: 15000 }).catch(() => fail('guest never received the emote'));
await guest.waitForFunction(id => /讚/.test(window.__game.view.sayingOf(id)), ids.host, { timeout: 10000 }).catch(async () => fail('guest: no bubble over the host; host feed: ' + await host.evaluate(() => document.getElementById('feed').innerText + ' / hint ' + document.getElementById('hintbar').innerText + ' ov ' + window.__game.overlay)));
await guest.waitForFunction(() => /房主阿明：讚/.test(document.getElementById('feed').innerText), null, { timeout: 6000 }).catch(() => fail('guest: no feed line'));
await frames(guest, 4, 300);
await guest.screenshot({ path: `${OUT}/r25-bubble-guest.png` });
// controller: hold View → wheel; stick right → slot 3 (奧客在門口！); let go of View → sent
await guest.waitForTimeout(700);
const setBtn = (i, v) => guest.evaluate(([i, v]) => { const b = window.__pad.buttons[i]; b.pressed = v; b.value = v ? 1 : 0; window.__pad.timestamp++; }, [i, v]);
await setBtn(8, true); await frames(guest, 4, 200);
if (!(await guest.$('#emotewheel:not(.hidden)'))) fail('View did not open the wheel');
await guest.evaluate(() => { window.__pad.axes[0] = 0.95; window.__pad.timestamp++; }); await frames(guest, 4, 200);
const padSel = await guest.evaluate(() => document.getElementById('ew-pick').textContent);
await guest.screenshot({ path: `${OUT}/r25-wheel-pad.png` });
await setBtn(8, false); await guest.evaluate(() => { window.__pad.axes[0] = 0; window.__pad.timestamp++; }); await frames(guest, 4, 200);
if (await guest.$('#emotewheel:not(.hidden)')) fail('wheel still open after releasing View');
await host.waitForFunction(id => window.__game.quickLog.some(q => q.id === id && /奧客在門口/.test(q.text)), ids.guest, { timeout: 15000 }).catch(() => fail('host: no bubble from the pad emote (picked ' + padSel + ')'));
report.padPick = padSel;

// ---------- (3) reconnect ----------
// the guest walks into the stockroom and takes a box of snacks (client-side walking, server-checked)
await guest.evaluate(async () => {
  const g = window.__game, way = [{ x: 9, z: 9.5 }, { x: 3.4, z: 8.5 }, { x: 3.4, z: 6 }, { x: 3.2, z: 2.4 }];
  for (const w of way) for (let k = 0; k < 150 && Math.hypot(g.pos.x - w.x, g.pos.z - w.z) > 0.15; k++) {
    const dx = w.x - g.pos.x, dz = w.z - g.pos.z, d = Math.hypot(dx, dz), s = Math.min(d, 0.25);
    g.pos = { x: g.pos.x + dx / d * s, z: g.pos.z + dz / d * s };
    await new Promise(r => setTimeout(r, 70));
  }
});
// wait until the server has us at the crate (slow software-GL frames under load)
await guest.waitForFunction(() => { const g = window.__game, me = g.snap.players.find(p => p.id === g.selfId); return Math.hypot(me.x - 3.2, me.z - 2.4) < 0.6; }, null, { timeout: 15000 }).catch(() => fail('guest never reached the crate'));
await guest.evaluate(() => window.__game.send({ type: 'act', rid: 'r25box', kind: 'takeBox', target: { t: 'crate', product: 'snacks' } }));
await guest.waitForFunction(() => window.__game.snap.players.find(p => p.id === window.__game.selfId)?.held?.kind === 'box', null, { timeout: 6000 }).catch(() => fail('guest could not take a box'));
const before = await guest.evaluate(() => { const g = window.__game, me = g.snap.players.find(p => p.id === g.selfId); return { id: g.selfId, x: me.x, z: me.z }; });
// "No network" is simulated in the page: Chromium's offline emulation doesn't stop WebSockets to localhost (and it stalls
// the close handshake), so the socket is closed and new WebSocket() fails until the network is back. The game's real
// reconnect code runs; only the socket constructor is stubbed.
await guest.evaluate(() => { window.__RealWS = window.WebSocket; window.WebSocket = function () { throw new Error('offline (test stub)'); }; window.WebSocket.OPEN = 1; window.__game.conn.ws?.close(); });
await guest.waitForFunction(() => /重新連線中/.test(document.getElementById('netstatus').textContent) && !document.getElementById('netstatus').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => fail('no reconnecting overlay'));
await host.waitForFunction(id => window.__game.snap.players.find(p => p.id === id)?.connected === false, before.id, { timeout: 15000 }).catch(() => fail('host never saw the guest drop'));
const cd1 = await guest.evaluate(() => document.getElementById('netstatus').textContent);
const secsOf = t => Number((t.match(/保留 (\d+) 秒/) ?? [])[1]);
await guest.waitForFunction(n => { const m = document.getElementById('netstatus').textContent.match(/保留 (\d+) 秒/); return m && Number(m[1]) <= n - 2; }, secsOf(cd1), { timeout: 10000 }).catch(() => {});
const cd2 = await guest.evaluate(() => document.getElementById('netstatus').textContent);
const secs = t => Number((t.match(/保留 (\d+) 秒/) ?? [])[1]);
if (!(secs(cd1) > secs(cd2))) fail(`countdown not running: "${cd1}" → "${cd2}"`);
await guest.screenshot({ path: `${OUT}/r25-reconnecting.png` });
const hostSaw = await host.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | '));
const t0 = Date.now();
await guest.evaluate(() => { window.WebSocket = window.__RealWS; window.dispatchEvent(new Event('online')); });
await guest.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(t => /已回到店裡/.test(t.textContent)), null, { timeout: 15000 }).catch(() => fail('no 已回到店裡 toast'));
report.rejoinAfterNetworkBackMs = Date.now() - t0;
const after = await guest.evaluate(() => { const g = window.__game, me = g.snap.players.find(p => p.id === g.selfId); return { id: g.selfId, x: me.x, z: me.z, held: me.held?.kind, connected: me.connected, hidden: document.getElementById('netstatus').classList.contains('hidden'), toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ') }; });
if (after.id !== before.id) fail('came back as a different player');
if (after.held !== 'box') fail('box lost on reconnect');
if (Math.hypot(after.x - before.x, after.z - before.z) > 0.8) fail('moved during the outage');
if (!after.hidden) fail('reconnect overlay still shown');
await host.waitForFunction(id => window.__game.snap.players.find(p => p.id === id)?.connected === true, before.id, { timeout: 10000 }).catch(() => fail('host still sees the guest as disconnected'));
await frames(guest, 4, 300);
await guest.screenshot({ path: `${OUT}/r25-back-in-store.png` });
report.reconnect = { countdown: [cd1, cd2], hostToasts: hostSaw, after };

// ---------- (4) host leaves ----------
await host.evaluate(() => window.__game.exit());
await guest.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(t => /接任房主/.test(t.textContent)) , null, { timeout: 15000 }).catch(() => fail('guest not told about the host change'));
report.hostChange = await guest.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | '));
await guest.screenshot({ path: `${OUT}/r25-host-left.png` });

console.log(JSON.stringify({ code, ...report, errors }, null, 1));
if (errors.length) process.exitCode = 1;
if (process.exitCode) console.log('ROUND25 FAILED'); else console.log('ROUND25 OK');
await browser.close();
