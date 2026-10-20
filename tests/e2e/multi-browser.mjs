// Two independent browser contexts (separate storage = separate players) create/join a room via the UI,
// start the game and verify each client renders the other. This is a multi-instance test on ONE machine.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function client(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e));
  await page.goto(URL);
  await page.fill('#m-name', name);
  return page;
}
const host = await client('房主A');
await host.click('#m-mp'); await host.click('#m-create');
await host.waitForSelector('#l-code');
const code = (await host.textContent('#l-code')).trim();
// second player uses a phone-sized touch context
const phone = await client('手機B', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await phone.click('#m-mp'); await phone.fill('#m-code', code);
await phone.click('#m-join');
await phone.waitForSelector('#l-ready');
// the host switches the store type and difficulty in the lobby; the phone's lobby (and 3D store) follow
await host.selectOption('#l-map', 'boba');
await host.selectOption('#l-diff', 'hard');
await phone.waitForFunction(() => /手搖飲店/.test(document.querySelector('.lobbycfg')?.textContent ?? '') && /血汗/.test(document.querySelector('.lobbycfg')?.textContent ?? ''), null, { timeout: 10000 });
await phone.waitForSelector('#l-ready');
await phone.click('#l-ready');
await host.waitForSelector('#l-start:not([disabled])');
await host.screenshot({ path: `${OUT}/mp-lobby.png` });
await host.click('#l-start');
for (const p of [host, phone]) await p.waitForFunction(() => window.__game?.started && window.__game.snap?.players.length === 2, null, { timeout: 40000 }).catch(async () => { console.log('STUCK', JSON.stringify(errors), await p.evaluate(() => ({ started: window.__game?.started, snap: !!window.__game?.snap, n: window.__game?.snap?.players.length, ui: document.getElementById('ui').innerText.slice(0, 200) }))); process.exit(1); });
// host looks toward the phone player's spawn and walks a bit
await host.keyboard.down('KeyA'); await host.waitForTimeout(400); await host.keyboard.up('KeyA');
await host.waitForTimeout(800);
const view = await phone.evaluate(() => { const g = window.__game; return { players: g.snap.players.map(p => p.name), phase: g.snap.phase, code: g.code, foods: g.snap.shift.foods }; });
await host.screenshot({ path: `${OUT}/mp-host.png` });
await phone.screenshot({ path: `${OUT}/mp-phone.png` });
console.log(JSON.stringify({ code, view, errors }, null, 1));
if (view.players.length !== 2 || errors.length) process.exitCode = 1;
await browser.close();
