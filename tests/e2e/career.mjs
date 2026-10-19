// Career flow in a real browser: career screen → shift → grab/throw with real key presses → result → EXP saved.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(URL);
// a Lv.12 profile that has cleared chapters 1-2, so chapter 3 (grab/throw) is open
await page.evaluate(() => {
  const stars = {}; for (const c of [1, 2]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' })); localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 12, exp: 10, wallet: 500, skillPoints: 11, skills: {}, gear: {}, stars, clears: {}, stats: {} }));
});
await page.reload();
await page.fill('#m-name', '測試店員');
await page.click('#m-career');
await page.waitForSelector('.rankcard');
await page.screenshot({ path: `${OUT}/career.png` });
await page.click('[data-tab="skills"]'); await page.click('[data-skill="body"]');
await page.click('[data-tab="chapters"]');
await page.click('[data-play="3-1"]');
await page.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 }); if (await page.locator('#sc-skip').count()) await page.click('#sc-skip'); // chapter intro scene
await page.waitForFunction(() => window.__game?.started);
await page.keyboard.press('Enter'); // start shift
await page.waitForFunction(() => window.__game.snap.phase === 'open');
// put a karen right in front of the player, standing between the player and the door
const info = await page.evaluate(() => {
  const g = window.__game, room = g.conn.room, w = room.world;
  const me = [...w.players.values()][0];
  g.pos = { x: 12, z: 12.6 }; g.yaw = 0; g.pitch = 0.1; me.x = 12; me.z = 12.6; me.yaw = 0;
  // keep the aim clean: other shoppers near the door could be picked as the closer target
  w.customers = w.customers.filter(c => Math.hypot(c.x - 12, c.z - 13) > 3);
  w.customers.push({ id: 9999, kind: 'rager', x: 12, z: 13.6, yaw: 0, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 40, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: false, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null });
  return { ok: true };
});
// the player must actually see the karen (in a received snapshot) before pressing, like a person would
await page.waitForFunction(() => window.__game.snap.customers.some(c => c.id === 9999), null, { timeout: 20000 });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const g = window.__game; window.__dbg = { sent: [], toasts: [] };
  const send = g.conn.send.bind(g.conn); g.conn.send = m => { if (m.type !== 'input' && m.type !== 'move') window.__dbg.sent.push(JSON.stringify(m).slice(0, 120)); send(m); };
  new MutationObserver(() => window.__dbg.toasts.push(document.getElementById('toasts').innerText)).observe(document.getElementById('toasts'), { childList: true, subtree: true });
});
await page.keyboard.press('Space'); // grab
await page.waitForFunction(() => window.__game.snap.players[0].grabbing === 9999, null, { timeout: 20000 }).catch(async e => { console.log('grab debug', await page.evaluate(() => { const g = window.__game, k = g.snap.customers.find(c => c.id === 9999); return { yaw: g.yaw, pitch: g.pitch, dbg: JSON.stringify(window.__dbg).slice(0, 200), feed: document.getElementById('feed')?.innerText, held: g.snap.players[0].held, overlay: g.overlay, grabbing: g.snap.players[0].grabbing, pos: g.pos, k, paused: g.conn.room.paused }; })); throw e; });
await page.screenshot({ path: `${OUT}/grab.png` });
await page.keyboard.press('Space'); // throw toward the door
await page.waitForFunction(() => window.__game.snap.dayStats.ejected >= 1, null, { timeout: 20000 });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/eject.png` });
// fast-forward the rest of the shift
await page.evaluate(() => { const room = window.__game.conn.room; for (let i = 0; i < 3600 && !room.world.result; i++) room.update(0.05); });
await page.waitForSelector('.result', { timeout: 8000 });
await page.screenshot({ path: `${OUT}/result.png` });
const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')));
console.log(JSON.stringify({ level: prof.level, exp: prof.exp, shifts: prof.stats.shifts, ejected: prof.stats.ejected, stars31: prof.stars['3-1'] ?? 0, errors }, null, 1));
if (errors.length || prof.stats.shifts !== 1 || prof.stats.ejected < 1) process.exitCode = 1;
await browser.close();
