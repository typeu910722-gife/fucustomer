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
await pg.waitForTimeout(2400);
// put him at register 1 and stand in front of him
await pg.evaluate(() => {
  const g = window.__game, w = g.conn.room.world, me = [...w.players.values()][0];
  const c = w.customers.find(k => k.kind === 'custom');
  for (const o of w.customers) if (o !== c && Math.hypot(o.x - 16.5, o.z - 12.5) < 2.5) o.gone = true;
  c.x = 16.5; c.z = 12.5; c.state = 'atRegister'; c.path = []; c.items = ['drinks']; c.shopping = []; c.life = 999; w.registers[0] = c.id;
  g.pos = { x: 16.5, z: 13.6 }; g.yaw = Math.PI; g.pitch = 0.05; me.x = 16.5; me.z = 13.6;
});
await pg.waitForFunction(() => /複誦/.test(document.getElementById('prompt')?.innerText ?? ''), null, { timeout: 4000 }).catch(() => {});
out.prompt = await pg.evaluate(() => document.getElementById('prompt')?.innerText ?? '');
await pg.screenshot({ path: `${OUT}/r11-custom.png` });
await pg.keyboard.down('e');
await pg.waitForFunction(() => window.__game.conn.room.world.customers.find(k => k.kind === 'custom')?.resolved, null, { timeout: 10000 }).catch(() => {});
await pg.keyboard.up('e');
out.resolved = await pg.evaluate(() => window.__game.conn.room.world.customers.find(k => k.kind === 'custom')?.resolved ?? null);
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
if (errors.length || !/轉職/.test(out.scene) || !/早餐/.test(out.title) || !/客製魔人/.test(out.card) || !/複誦/.test(out.prompt) || out.resolved !== true) process.exitCode = 1;
await browser.close();
