// Chapter 7 in the 早餐店: story scene, first-time intro card for 客製魔人, reading back his order with the real E key.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const out = {};
const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pg.on('pageerror', e => errors.push(String(e)));
await pg.goto(URL);
const stars = {}; for (let c = 1; c <= 6; c++) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
await pg.evaluate(stars => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 28, wallet: 900, stars, clears: { ...stars }, stats: { shifts: 40, wins: 40 } }));
}, stars);
await pg.reload();
await pg.click('#m-career');
await pg.evaluate(() => document.querySelector('[data-play="7-1"]')?.scrollIntoView());
await pg.screenshot({ path: `${OUT}/r11-ch7.png` });
await pg.click('[data-play="7-1"]');
await pg.waitForSelector('.scene');
out.scene = await pg.evaluate(() => document.querySelector('.scene').innerText.slice(0, 40));
await pg.click('#sc-skip');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
out.title = await pg.evaluate(() => window.__game.snap.shift.title);
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 25000 });
// the first 客製魔人 of the career: intro card
await pg.evaluate(() => { const r = window.__game.conn.room; r.world.cfg.karens = ['custom']; r.world.karenTimer = 0; r.update(0.05); });
await pg.waitForFunction(() => !document.getElementById('introcard').classList.contains('hidden'), null, { timeout: 10000 });
out.card = await pg.evaluate(() => document.getElementById('introcard').innerText);
// The card pauses solo play for 2 s with a page timer. While paused the store ignores E and sends no snapshots, so
// wait for it to run again instead of guessing how long that takes on a busy machine (was a fixed 2.4 s wait).
out.unpaused = await pg.waitForFunction(() => !window.__game.conn.room.paused, null, { timeout: 20000 }).then(() => true, () => false);
// put him at register 1 and stand in front of him
await pg.evaluate(() => {
  const g = window.__game, w = g.conn.room.world, me = [...w.players.values()][0];
  const c = w.customers.find(k => k.kind === 'custom'); window.__cid = c.id;
  w.cfg.karens = []; // no more karens after this one, so we always check the same customer
  // nobody else at or on the way to the till: a customer already sent to that register kept walking there and stood on
  // the same spot as him, so the crosshair picked that customer and E did nothing (the round-29 flake under load)
  for (const o of w.customers) if (o !== c && (Math.hypot(o.x - 16.5, o.z - 12.5) < 2.5 || o.register >= 0 || ['toRegister', 'atRegister', 'queue'].includes(o.state))) o.gone = true;
  w.queue = []; w.registers = [c.id, null]; w.spawnTimer = 1e9;
  c.x = 16.5; c.z = 12.5; c.state = 'atRegister'; c.path = []; c.items = ['drinks']; c.shopping = []; c.life = 999; c.patience = c.patienceMax = 999;
  g.pos = { x: 16.5, z: 13.6 }; g.yaw = Math.PI; g.pitch = 0.05; me.x = 16.5; me.z = 13.6;
});
// Like a player looking before pressing (round28b's `seen`): the store sends the page a snapshot only every other
// tick, and the prompt aims at the drawn figure, which glides to where the snapshot has it. Wait until the page's own
// snapshot has him at the till and he is drawn there (the others near the till were sent away), then for the prompt.
out.seen = await pg.waitForFunction(() => {
  const g = window.__game, sc = g.snap?.customers.find(c => c.id === window.__cid);
  if (!sc || sc.state !== 'atRegister' || Math.hypot(sc.x - 16.5, sc.z - 12.5) > 0.05) return false;
  const p = g.view.customerWorldPos(sc.id);
  return !!p && Math.hypot(p.x - sc.x, p.z - sc.z) < 0.1;
}, null, { timeout: 15000 }).then(() => true, () => false);
await pg.waitForFunction(() => /複誦/.test(document.getElementById('prompt')?.innerText ?? ''), null, { timeout: 8000 }).catch(() => {});
out.prompt = await pg.evaluate(() => document.getElementById('prompt')?.innerText ?? '');
await pg.screenshot({ path: `${OUT}/r11-custom.png` });
await pg.keyboard.down('e');
await pg.waitForFunction(() => window.__game.conn.room.world.customers.find(k => k.id === window.__cid)?.resolved, null, { timeout: 10000 }).catch(() => {});
await pg.keyboard.up('e');
out.resolved = await pg.evaluate(() => window.__game.conn.room.world.customers.find(k => k.id === window.__cid)?.resolved ?? null);
if (out.resolved !== true) out.debug = await pg.evaluate(() => { const w = window.__game.conn.room.world; const me = [...w.players.values()][0]; const c = w.customers.find(k => k.id === window.__cid); return { me: { x: me.x, z: me.z, busy: me.busy }, c: c && { state: c.state, x: c.x, z: c.z, gone: c.gone, held: c.heldBy }, paused: window.__game.conn.room.paused, customs: w.customers.filter(k => k.kind === 'custom').map(k => [k.id, k.resolved]), toasts: document.getElementById('toasts').innerText }; });
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
if (errors.length || !out.unpaused || !out.seen || !/轉職/.test(out.scene) || !/早餐/.test(out.title) || !/客製魔人/.test(out.card) || !/複誦/.test(out.prompt) || out.resolved !== true) process.exitCode = 1;
await browser.close();
