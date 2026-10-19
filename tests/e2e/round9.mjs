// Story scene, hitting with the real X key (illegal hit + heavy karen), police → court → pay slip with the boss's cut.
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
const stars = {}; for (const c of [1, 2]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
await pg.evaluate(stars => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 12, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 10, wins: 10 } }));
}, stars);
await pg.reload();
await pg.click('#m-career'); await pg.click('[data-play="3-1"]');
// 1) chapter 3 intro scene, advanced with Enter
await pg.waitForSelector('.scene');
out.scene = await pg.evaluate(() => document.querySelector('.scene').innerText);
await pg.screenshot({ path: `${OUT}/r9-scene.png` });
for (let i = 0; i < 6 && await pg.locator('.scene').count(); i++) { await pg.keyboard.press('Enter'); await pg.waitForTimeout(150); }
await pg.waitForFunction(() => window.__game?.started, null, { timeout: 25000 });
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 25000 });
// 2) a calm 退貨大鬧 right in front: hitting first is NOT self-defence
const spawn = (id, kind, extra) => pg.evaluate(([id, kind, extra]) => {
  const g = window.__game, w = g.conn.room.world, me = [...w.players.values()][0];
  w.customers = w.customers.filter(c => Math.hypot(c.x - 12, c.z - 13) > 3);
  w.customers.push({ id, kind, x: 12, z: 13.6, yaw: Math.PI, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 30, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: false, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null, phase: 0, minions: [], ...extra });
  g.pos = { x: 12, z: 12.6 }; g.yaw = 0; g.pitch = 0.1; me.x = 12; me.z = 12.6;
}, [id, kind, extra]);
await spawn(9001, 'rager', {});
await pg.waitForFunction(() => window.__game.snap.customers.some(c => c.id === 9001), null, { timeout: 20000 });
await pg.waitForTimeout(300);
await pg.keyboard.press('KeyX');
await pg.waitForFunction(() => window.__game.conn.room.world.incidents.length > 0, null, { timeout: 10000 });
out.incident = await pg.evaluate(() => window.__game.conn.room.world.incidents[0]);
// 3) a heavy karen: grab fails, hit (makes him dazed), then the grab works
await pg.evaluate(() => { const w = window.__game.conn.room.world; w.customers = w.customers.filter(c => c.id !== 9001); });
await spawn(9002, 'hog', { heavy: true, state: 'eat', eatShelf: 'snacks', timer: 99 });
await pg.waitForFunction(() => window.__game.snap.customers.some(c => c.id === 9002 && c.heavy), null, { timeout: 20000 });
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}/r9-heavy.png` });
await pg.keyboard.press('Space');
await pg.waitForTimeout(500);
out.grabBeforeHit = await pg.evaluate(() => window.__game.snap.players[0].grabbing);
await pg.keyboard.press('KeyX');
await pg.waitForFunction(() => window.__game.snap.customers.find(c => c.id === 9002)?.stun > 0, null, { timeout: 10000 });
await pg.keyboard.press('Space');
await pg.waitForFunction(() => window.__game.snap.players[0].grabbing === 9002, null, { timeout: 10000 }).catch(() => {});
out.grabAfterHit = await pg.evaluate(() => window.__game.snap.players[0].grabbing);
// 4) end the shift → police → court
await pg.evaluate(() => { const r = window.__game.conn.room; r.world.dayStats.revenue = 900; r.world.dayStats.tips = 70; for (let i = 0; i < 400 * 20 && !r.world.result; i++) { r.world.chaos = 0; r.world.rating = 4; r.update(0.05); } });
await pg.waitForSelector('.scene, .court', { timeout: 20000 });
for (let i = 0; i < 6 && await pg.locator('.scene').count(); i++) { await pg.keyboard.press('Enter'); await pg.waitForTimeout(150); }
await pg.waitForSelector('.court', { timeout: 10000 });
await pg.screenshot({ path: `${OUT}/r9-police.png` });
const judges = [];
for (let step = 0; step < 20; step++) {
  if (await pg.locator('#ct-done').count()) break;
  const head = await pg.evaluate(() => document.querySelector('.court-head b')?.innerText ?? '');
  if (head) judges.push(head);
  if (await pg.locator('[data-p="cctv"]').count()) { await pg.screenshot({ path: `${OUT}/r9-dino.png` }); await pg.click('[data-p="accept"]'); }
  else if (await pg.locator('[data-a]').count()) await pg.click('[data-a="0"]');
  else if (await pg.locator('#ct-accept').count()) await pg.click('#ct-accept');
  else if (await pg.locator('#ct-go').count()) await pg.click('#ct-go');
  else if (await pg.locator('#ct-next').count()) await pg.click('#ct-next');
  await pg.waitForTimeout(200);
}
out.judges = [...new Set(judges)];
out.verdict = await pg.evaluate(() => document.querySelector('.court .verdict')?.innerText ?? '');
await pg.screenshot({ path: `${OUT}/r9-verdict.png` });
await pg.click('#ct-done');
await pg.waitForSelector('.result', { timeout: 10000 });
await pg.waitForTimeout(1000);
await pg.screenshot({ path: `${OUT}/r9-payslip.png` });
out.payslip = await pg.evaluate(() => document.querySelector('.paylist')?.innerText ?? '');
const prof = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
out.court = prof.court; out.story = prof.story;
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
const ok = !errors.length && /阿芬姐|錢董/.test(out.scene) && out.incident?.legal === false && out.grabBeforeHit == null && out.grabAfterHit === 9002
  && /錢董硬凹/.test(out.payslip) && /小費/.test(out.payslip) && /法院罰款/.test(out.payslip) && prof.court.trials === 1 && prof.story.includes('ch3-intro') && prof.story.includes('first-court');
if (!ok) process.exitCode = 1;
await browser.close();
