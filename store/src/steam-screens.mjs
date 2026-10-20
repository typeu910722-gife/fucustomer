// Steam store screenshots (1920×1080) from the real game in headless Chromium (software WebGL, quality "high").
// Needs the game server (solo shots run offline in the page; the co-op shot uses real rooms on this server):
//   npx vite build && npm run build:server && PORT=8899 node dist-server/index.js
// Usage: GAME_URL=http://127.0.0.1:8899/ node store/src/steam-screens.mjs   → store/steam/screenshots/
//        ONLY=01,05 … to retake some of them.
// Shots use the same debug hooks as the e2e tests (window.__game, the local Room): the camera is placed, a karen is
// spawned where needed and the local simulation is stepped by hand so the moment can be frozen; grabbing and throwing
// are done with the real Space key. The key-help line at the bottom of the screen is hidden.
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const GAME = process.env.GAME_URL ?? 'http://127.0.0.1:8899/';
const OUT = process.env.OUT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../steam/screenshots');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(OUT, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ALL_KARENS = ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'custom', 'fickle', 'tryhard', 'boss', 'sampler', 'reader', 'toucher', 'taster', 'dogfeed', 'squatter', 'kicker', 'packer', 'wiper', 'benchhog', 'doneness', 'refry', 'unboxer', 'photo', 'coins', 'rx', 'upgrader'];
const MAPS = ['convenience', 'bakery', 'boba', 'bookstore', 'breakfast', 'cafe', 'chicken', 'cinema', 'clothing', 'drugstore', 'electronics', 'gas', 'gym', 'hotel', 'hotpot', 'petshop', 'pharmacy', 'post', 'salon', 'steak', 'supermarket'];
const want = name => !ONLY || ONLY.some(o => name.startsWith(o));
const HIDE_CSS = '#helpkeys, .ts-foot .muted { display: none !important; }'; // key-help line; server address on the title screen

/** A fresh browser profile: career level, stars and seen-karens set so no tutorial or intro cards get in the way. */
async function open(level, cleared, { extra = [], name = '阿明', fov = 80, viewport = { width: 1280, height: 720 }, scale = 1.5, profile = {}, seed = 7, quality = 'high', clock = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale }); // 1280×720 × 1.5 = 1920×1080, UI at a readable size
  // seeded Math.random: the same customers/karens every run (the sim's world seed comes from it too)
  await ctx.addInitScript(seed => { let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, seed);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('page error', String(e)));
  if (clock) await page.clock.install(); // time flows normally until a shot pauses it (frame-exact animation)
  await page.goto(GAME);
  const stars = {}, clears = {};
  for (let c = 1; c <= cleared; c++) for (let i = 1; i <= 5; i++) { stars[`${c}-${i}`] = 2 + ((c + i) % 2); clears[`${c}-${i}`] = 1; }
  for (const id of extra) { stars[id] = 2; clears[id] = 1; }
  await page.evaluate(([level, stars, clears, karens, maps, name, fov, profile, quality]) => {
    localStorage.clear();
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality, name, fov, fpsCap: 0, adaptive: false, volume: 0, music: 0 }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: karens, seenMaps: maps }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level, exp: 40, wallet: 1860, skillPoints: 2, skills: { service: 6, body: 7, crisis: 5 }, gear: { shoes: 2, mop: 2, machine: 1, cleaner: 1, guard: 1 }, stars, clears, stats: { shifts: 60, wins: 52, served: 1400, ejected: 120, karens: 180, revenue: 18000 }, endlessBest: 1240, title: '', achievements: ['FIRST_SHIFT', 'FIRST_THROW', 'CH1', 'CH2', 'CH3', 'LV10', 'LV20', 'KARENS_100', 'SERVED_1000', 'STARS_60', 'COMBO_5', 'DAILY_FIRST'], story: ['ch1-intro', 'ch2-intro', 'ch3-intro', 'ch4-intro', 'ch5-intro', 'ch6-intro', 'ch7-intro', 'ch8-intro', 'first-court'], ...profile }));
  }, [level, stars, clears, ALL_KARENS, MAPS, name, fov, profile, quality]);
  await page.reload();
  await page.addStyleTag({ content: HIDE_CSS });
  return { ctx, page };
}
const shot = async (page, name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(OUT, name), timeout: 120000 }); console.log('wrote', name); };

// ---- in-page helpers (solo: the whole simulation runs in the page) ----
/** Places the first-person camera (and the player it belongs to). */
const look = (page, x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => {
  const g = window.__game, me = g.conn.room.world.players.get(g.selfId);
  g.pos = { x, z }; g.yaw = yaw; g.pitch = pitch; me.x = x; me.z = z; me.yaw = yaw;
}, [x, z, yaw, pitch]);
/** Looks from (x, z) at the point (tx, tz), aiming at height ty. */
const lookAt = (page, x, z, tx, tz, ty = 1.2) => look(page, x, z, Math.atan2(tx - x, tz - z), Math.atan2(ty - 1.62, Math.hypot(tx - x, tz - z)));
/** Stops the local simulation clock: from now on the world only moves when step() is called. */
const freeze = page => page.evaluate(() => clearInterval(window.__game.conn.timer));
/** Advances the local simulation n ticks of 50 ms and sends a fresh snapshot to the renderer. */
const step = (page, n) => page.evaluate(n => {
  const r = window.__game.conn.room;
  for (let i = 0; i < n; i++) r.update(0.05);
  for (const m of r.members.values()) r.sendSnapshotTo(m);
}, n);
/** A karen standing at (x, z) (same shape the sim uses; extra overrides). */
const spawn = (page, id, kind, x, z, extra = {}) => page.evaluate(([id, kind, x, z, extra]) => {
  window.__game.conn.room.world.customers.push({ id, kind, x, z, yaw: Math.PI, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 60, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: true, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null, phase: 0, minions: [], ...extra });
}, [id, kind, x, z, extra]);
/** A co-worker standing in the store (a second clerk in the same simulation; shown like any other player). */
const coworker = (page, id, name, color, x, z, yaw) => page.evaluate(([id, name, color, x, z, yaw]) => {
  const w = window.__game.conn.room.world, me = w.players.get(window.__game.selfId);
  w.players.set(id, { ...me, id, name, color, x, z, yaw, held: null, held2: null, grabbing: null, busy: null, recent: new Map(), stats: { served: 0, karens: 0, cleaned: 0, restocked: 0, ejected: 0 } });
}, [id, name, color, x, z, yaw]);
/** Moves customers out of a rectangle (so nobody stands in front of the camera). */
const clearArea = (page, x0, z0, x1, z1, keep = []) => page.evaluate(([x0, z0, x1, z1, keep]) => {
  const w = window.__game.conn.room.world;
  w.customers = w.customers.filter(c => keep.includes(c.id) || !(c.x > x0 && c.x < x1 && c.z > z0 && c.z < z1));
}, [x0, z0, x1, z1, keep]);

async function freePlay(page, id, secs) {
  await page.click('#m-career'); await page.click('[data-tab="free"]'); await page.waitForSelector('.mapcard');
  await page.click(`[data-map="${id}"]`);
  await page.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
  await page.evaluate(n => { const r = window.__game.conn.room; r.world.phaseLeft = 0.1; for (let i = 0; i < n; i++) r.update(0.05); }, secs * 20);
}
async function startShift(page, id, warm) {
  await page.click('#m-career');
  await page.click('[data-tab="chapters"]');
  await page.click(`[data-play="${id}"]`);
  await page.waitForFunction(() => document.querySelector('.scene') || window.__game?.started, null, { timeout: 30000 });
  for (let i = 0; i < 10 && await page.locator('.scene').count(); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
  await page.waitForFunction(() => window.__game?.started, null, { timeout: 30000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 30000 });
  await page.evaluate(n => { const r = window.__game.conn.room; r.paused = false; for (let i = 0; i < n; i++) r.update(0.05); }, warm);
}

// 01 — a karen thrown out the front door, mid-air (grab and throw with the real Space key)
if (want('01')) {
  const { ctx, page } = await open(18, 3, { clock: true });
  await freePlay(page, 'convenience', 40);
  await freeze(page);
  await clearArea(page, 3, 4, 21, 16.5);
  await spawn(page, 9001, 'rager', 12, 10.0, { anger: 85 });
  await look(page, 12, 9.0, 0, 0.0);
  await step(page, 2);
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await step(page, 2);
  await page.waitForFunction(() => window.__game.snap.players.find(p => p.id === window.__game.selfId).grabbing === 9001, null, { timeout: 10000 });
  await look(page, 12, 9.0, 0, 0.45); // aim up a little: a higher arc
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.conn.room.world.customers.find(c => c.id === 9001)?.fly, null, { timeout: 30000 });
  // the thrower stays where he was; the camera steps aside to watch him
  await coworker(page, 'pX', '阿傑', 0x48a6ff, 12, 9.0, 0);
  await lookAt(page, Number(process.env.CX ?? 14.2), Number(process.env.CZ ?? 14.8), Number(process.env.TX ?? 11.6), Number(process.env.TZ ?? 11.6), 1.4);
  await page.waitForTimeout(1500);
  // from here the page clock runs only as far as the flight: every tick is 50 ms of game time and of animation
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 100);
  for (let i = 0; i < Number(process.env.FLY ?? 4); i++) { await step(page, 1); await page.clock.runFor(50); }
  await shot(page, '01-throw.png', 0);
  await ctx.close();
}

/** Lets the game's own spawner bring in these karens (sets the day's karen list and fires the karen timer). */
const callKarens = (page, kinds, max = 3) => page.evaluate(([kinds, max]) => {
  const w = window.__game.conn.room.world;
  w.cfg = { ...w.cfg, karens: kinds, maxKarens: max };
  w.karenTimer = 0;
}, [kinds, max]);
/** Runs the simulation until some customer matches (by kind/state), up to `secs` of game time. */
const runUntil = (page, kind, secs = 120, states = null) => page.evaluate(([kind, n, states]) => {
  const r = window.__game.conn.room;
  for (let i = 0; i < n; i++) {
    r.update(0.05);
    const c = r.world.customers.find(c => c.kind === kind && !c.gone && !c.fly && !c.heldBy && (!states || states.includes(c.state)));
    if (c) return { id: c.id, x: c.x, z: c.z, state: c.state };
  }
  return null;
}, [kind, secs * 20, states]);
/** Camera `dist` metres from (x, z), on the side facing the middle of the store, looking at it. */
const faceFrom = async (page, x, z, dist, { side = 0, ty = 1.2, cx = 12, cz = 8 } = {}) => {
  let dx = cx - x, dz = cz - z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const a = Math.atan2(dx, dz) + side;
  const px = Math.min(23, Math.max(1, x + Math.sin(a) * dist)), pz = Math.min(15.3, Math.max(1, z + Math.cos(a) * dist));
  await lookAt(page, px, pz, x, z, ty);
  return [px, pz];
};
/** Shelves stocked, rating decent, at most one spill: the store as a player who keeps up would have it. */
const tidy = page => page.evaluate(() => { const w = window.__game.conn.room.world; for (const k in w.shelves) w.shelves[k] = Math.max(w.shelves[k], 7); w.rating = Math.max(w.rating, 3.4); w.chaos = Math.min(w.chaos, 30); w.spills = w.spills.slice(0, 1); w.event = null; w.power = 1; w.nextEvent = 999; });
/** Removes customers standing between the camera and the target (they'd fill the frame). */
const clearLine = (page, px, pz, x, z, keep = []) => page.evaluate(([px, pz, x, z, keep]) => {
  const w = window.__game.conn.room.world;
  const L = Math.hypot(x - px, z - pz);
  w.customers = w.customers.filter(c => {
    if (keep.includes(c.id)) return true;
    const t = ((c.x - px) * (x - px) + (c.z - pz) * (z - pz)) / (L * L);
    const qx = px + (x - px) * t, qz = pz + (z - pz) * t;
    return !(t > -0.1 && t < 0.92 && Math.hypot(c.x - qx, c.z - qz) < 0.9) && Math.hypot(c.x - px, c.z - pz) > 1.3;
  });
}, [px, pz, x, z, keep]);

// 02 — a busy supermarket seen from the till: a queue, a karen cutting in, one raging about a refund
if (want('02')) {
  const { ctx, page } = await open(18, 3);
  await freePlay(page, 'supermarket', 50);
  await freeze(page);
  await page.evaluate(() => { const w = window.__game.conn.room.world; w.cfg = { ...w.cfg, maxCustomers: 16, spawnEvery: 1.6 }; });
  for (let i = 0; i < 5; i++) {
    await callKarens(page, ['rager', 'cutter', 'streamer'], 3);
    // keep the store tidy and stocked as if the staff were on top of it (no chaos vignette)
    await page.evaluate(() => { const w = window.__game.conn.room.world; for (const k in w.shelves) w.shelves[k] = 10; w.chaos = 25; w.rating = 3.6; w.spills = w.spills.slice(0, 1); });
    await step(page, 160);
  }
  await runUntil(page, 'rager', 60, ['complain']);
  await page.evaluate(() => { const w = window.__game.conn.room.world; for (const k in w.shelves) w.shelves[k] = 9; w.chaos = 30; w.spills = w.spills.slice(0, 1); });
  await lookAt(page, Number(process.env.CX ?? 17.9), Number(process.env.CZ ?? 10.3), Number(process.env.TX ?? 16.0), Number(process.env.TZ ?? 14.5), 1.05);
  await step(page, 1);
  await shot(page, '02-rush.png');
  await ctx.close();
}
// 03 — a store's signature karen: the café's 一杯坐整天, camping at a table with one cup and a laptop
if (want('03')) {
  const { ctx, page } = await open(18, 3);
  await freePlay(page, process.env.MAP3 ?? 'cafe', 40);
  await freeze(page);
  const kind = process.env.KIND3 ?? 'squatter';
  await callKarens(page, [kind], 1);
  let k = null;
  for (let tries = 0; tries < 12; tries++) { // until one camps at one of the tables (not the window bar)
    k = await runUntil(page, kind, 240, (process.env.STATE3 ?? 'camp').split('/'));
    if (k && k.z < 12) break;
    await page.evaluate(id => { const w = window.__game.conn.room.world; w.customers = w.customers.filter(c => c.id !== id); w.karenTimer = 0; }, k?.id);
  }
  console.log('sig karen', JSON.stringify(k));
  await step(page, Number(process.env.WAIT3 ?? 40));
  const c = await page.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return { x: c.x, z: c.z, yaw: c.yaw, state: c.state }; }, k.id);
  console.log('now', JSON.stringify(c));
  // in front of him, across the table: his face, the one cup and the laptop
  const a = c.yaw + Number(process.env.S3 ?? 0.35), d = Number(process.env.D3 ?? 2.9);
  const px = Math.min(23.3, Math.max(0.6, c.x + Math.sin(a) * d)), pz = Math.min(15.3, Math.max(0.6, c.z + Math.cos(a) * d));
  await lookAt(page, px, pz, c.x, c.z, 0.95);
  await tidy(page);
  await clearLine(page, px, pz, c.x, c.z, [k.id]);
  await step(page, 1);
  await shot(page, '03-signature.png', 1000);
  await ctx.close();
}
// 04 — four players in one store: four browser contexts joined to the same room on the game server (GAME_URL)
if (want('04')) {
  const names = ['阿明', '小美', '阿傑', '佳佳'];
  const pages = [];
  // only the host's view is photographed: the others run small and on low quality to keep software rendering fast
  for (const n of names) pages.push(await open(18, 3, pages.length ? { name: n, seed: 11 + pages.length, quality: 'low', viewport: { width: 640, height: 360 }, scale: 1 } : { name: n }));
  const [host, ...guests] = pages.map(p => p.page);
  await host.click('#m-mp'); await host.click('#m-create');
  await host.waitForSelector('#l-code');
  const code = (await host.textContent('#l-code')).trim();
  await host.selectOption('#l-map', process.env.MAP4 ?? 'chicken');
  for (const g of guests) {
    await g.click('#m-mp'); await g.fill('#m-code', code); await g.click('#m-join');
    await g.waitForSelector('#l-ready'); await g.click('#l-ready');
  }
  await host.waitForSelector('#l-start:not([disabled])', { timeout: 20000 }).catch(async () => { console.log(await host.evaluate(() => document.getElementById('ui').innerText)); for (const g of guests) console.log('G', await g.evaluate(() => document.getElementById('ui').innerText.slice(0, 300))); });
  await host.click('#l-start');
  for (const p of [host, ...guests]) await p.waitForFunction(() => window.__game?.started && window.__game.snap?.players.length === 4, null, { timeout: 120000, polling: 500 });
  // software rendering is slow: draw at a fraction of the resolution until the photo, so no client misses its pings
  for (const p of [host, ...guests]) await p.evaluate(() => window.__game.view.setResolutionScale(0.25));
  /** Walks the player through waypoints at running pace (the server clamps speed, so no teleporting). */
  const walk = (page, pts) => page.evaluate(pts => new Promise(done => {
    const g = window.__game; let i = 0;
    const t = setInterval(() => {
      const [x, z] = pts[i], dx = x - g.pos.x, dz = z - g.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.05) { if (++i >= pts.length) { clearInterval(t); done(); } return; }
      const s = Math.min(d, 0.22); g.pos = { x: g.pos.x + dx / d * s, z: g.pos.z + dz / d * s }; g.yaw = Math.atan2(dx, dz);
    }, 80);
  }), pts);
  const t0 = Date.now();
  const spots = [[[14.2, 10.2], [13.2, 12.6], [12.3, 14.3]], [[10.9, 10.3]], [[8, 9.5], [12.2, 9.6]], [[14.2, 9.2], [13.6, 10.4]]];
  await Promise.all([host, ...guests].map((p, i) => walk(p, spots[i])));
  console.log('walked in', Date.now() - t0, 'ms');
  // the three co-workers turn to the camera; the host looks at them
  const cam = spots[0][spots[0].length - 1];
  await Promise.all(guests.map(p => p.evaluate(([cx, cz]) => { const g = window.__game; g.yaw = Math.atan2(cx - g.pos.x, cz - g.pos.z); g.pitch = 0; }, cam)));
  await host.evaluate(() => { const g = window.__game; g.yaw = Math.atan2(12.2 - g.pos.x, 10.0 - g.pos.z); g.pitch = -0.08; });
  // everyone in place before opening (prep time); then all press Enter (ready) and the first customers come in
  for (const p of [host, ...guests]) await p.keyboard.press('Enter');
  await host.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 120000, polling: 500 });
  await host.waitForTimeout(Number(process.env.WAIT4 ?? 9000));
  await walk(host, [cam]); // back on the mark if the server nudged us
  await host.evaluate(() => { const g = window.__game; g.yaw = Math.atan2(12.2 - g.pos.x, 10.0 - g.pos.z); g.pitch = -0.08; });
  console.log('coop', await host.evaluate(() => JSON.stringify({ clock: window.__game.snap.clock, status: document.body.innerText.includes('連線中斷'), players: window.__game.snap.players.map(p => [p.name, +p.x.toFixed(1), +p.z.toFixed(1)]) })));
  await host.evaluate(() => window.__game.view.setResolutionScale(1));
  await shot(host, '04-coop.png', 2500);
  for (const p of pages) await p.ctx.close();
}
// 05 — the boss fight: 奧客之王 (chapter 6-3)
if (want('05')) {
  const { ctx, page } = await open(29, 5, { extra: ['6-1', '6-2'] });
  await startShift(page, '6-3', 10);
  await freeze(page);
  const b = await runUntil(page, 'boss', 200, ['queue', 'atRegister']);
  await step(page, 160); // until he has pushed into the line and stands still
  // phase 1 (插隊霸王): walk up and press E — he moves on to phase 2, 退貨暴君, raging at the service spot
  const bp = await page.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return { x: c.x, z: c.z }; }, b.id);
  await faceFrom(page, bp.x, bp.z, 1.3, { ty: 1.3 });
  await step(page, 2);
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyE');
  // 請排隊 takes a moment: keep the world running until he gives in
  for (let i = 0; i < 80; i++) {
    await step(page, 2);
    if (await page.evaluate(id => window.__game.conn.room.world.customers.find(c => c.id === id)?.phase >= 2, b.id)) break;
    await page.waitForTimeout(60);
  }
  await step(page, Number(process.env.WAIT5 ?? 100));
  const c = await page.evaluate(() => { const c = window.__game.conn.room.world.customers.find(c => c.kind === 'boss'); return c && { id: c.id, x: c.x, z: c.z, yaw: c.yaw, state: c.state, phase: c.phase }; });
  console.log('boss', JSON.stringify(b), JSON.stringify(c));
  // in front of him (he rages facing the door): crown, cape and the angry face, the store behind him
  const a = c.yaw + Number(process.env.S5 ?? 0.45), d = Number(process.env.D5 ?? 3.1);
  const px = Math.min(23.3, Math.max(0.7, c.x + Math.sin(a) * d)), pz = Math.min(15.4, Math.max(0.7, c.z + Math.cos(a) * d));
  await lookAt(page, px, pz, c.x, c.z, 1.3);
  await clearLine(page, px, pz, c.x, c.z, [c.id]);
  await tidy(page);
  await step(page, 1);
  await shot(page, '05-boss.png');
  await ctx.close();
}
// 06 — your own store, with 小陳 the employee at work
if (want('06')) {
  const { ctx, page } = await open(30, 6, { profile: { wallet: 3200 } });
  await page.click('#m-career'); await page.click('[data-tab="store"]');
  await page.fill('#st-name', '阿明商店');
  await page.click('#st-open');
  await page.waitForFunction(() => document.querySelector('.scene') || document.getElementById('st-enter'), null, { timeout: 20000 });
  for (let i = 0; i < 10 && await page.locator('.scene').count(); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
  await page.waitForSelector('#st-enter');
  await page.click('#st-enter');
  await page.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
  await freeze(page);
  await page.evaluate(n => { const c = window.__game.conn, r = c.room; r.world.phaseLeft = 0.1; for (let i = 0; i < n; i++) { r.update(0.05); c.driveStaff(0.05); } }, Number(process.env.WARM6 ?? 1600));
  // keep the day going until 小陳 is ringing someone up at the till
  const st = await page.evaluate(() => {
    const c = window.__game.conn, r = c.room, find = () => [...r.world.players.values()].find(p => p.name.includes('小陳'));
    for (let i = 0; i < 20 * 120 && find()?.busy?.kind !== 'checkout'; i++) { r.update(0.05); c.driveStaff(0.05); }
    const p = find(); return { x: p.x, z: p.z, yaw: p.yaw, busy: p.busy?.kind ?? null };
  });
  console.log('staff', JSON.stringify(st));
  // in front of him, from further along the counter: his face, the till, the customers across the counter
  const a = st.yaw + Number(process.env.S6 ?? 0.35), d = Number(process.env.D6 ?? 2.5);
  const px = st.x + Math.sin(a) * d, pz = st.z + Math.cos(a) * d;
  await lookAt(page, px, pz, st.x, st.z + 0.5, 1.15);
  await clearLine(page, px, pz, st.x, st.z);
  await clearArea(page, 14.6, 8.5, 21.5, 11); // nobody wandering behind the counter
  await tidy(page);
  await step(page, 1);
  await shot(page, '06-ownstore.png');
  await ctx.close();
}
// 07 — hit a customer first and the police come: the court scene (恐龍法官)
if (want('07')) {
  const { ctx, page } = await open(12, 2);
  await startShift(page, '3-1', 20);
  await spawn(page, 9001, 'rager', 12, 13.6, { anger: 30, angry: false });
  await look(page, 12, 12.6, 0, 0.1);
  await page.waitForFunction(() => window.__game.snap.customers.some(c => c.id === 9001), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyX');
  await page.waitForFunction(() => window.__game.conn.room.world.incidents.length > 0, null, { timeout: 30000 });
  await page.evaluate(() => { Math.random = () => 0.6; }); // the court picks 恐龍法官 (deterministic verdict)
  await page.evaluate(() => { const r = window.__game.conn.room; r.world.dayStats.revenue = 900; for (let i = 0; i < 400 * 20 && !r.world.result; i++) { r.world.chaos = 0; r.world.rating = 4; r.update(0.05); } });
  await page.waitForSelector('.court', { timeout: 30000 });
  await page.click('#ct-next');
  await page.click('#ct-go');
  await page.waitForSelector('[data-p]');
  await shot(page, '07-court.png', 800);
  await ctx.close();
}
// 08 — career screen; 09 — the store picker; 10 — title screen with the 社畜證照 licence card
if (want('08') || want('09')) {
  const { ctx, page } = await open(22, 4);
  await page.click('#m-career');
  await page.waitForTimeout(800);
  if (want('08')) await shot(page, '08-career.png', 800);
  await ctx.close();
}
if (want('09')) {
  // a wider page at a smaller scale shows more of the 21 store types at once (still 1920×1080)
  const { ctx, page } = await open(22, 4, { viewport: { width: 1600, height: 900 }, scale: 1.2 });
  await page.click('#m-career'); await page.click('[data-tab="free"]'); await page.waitForSelector('.mapcard');
  await shot(page, '09-maps.png', 800);
  await ctx.close();
}
if (want('10')) {
  const { ctx, page } = await open(22, 4);
  await shot(page, '10-title.png');
  await ctx.close();
}
await browser.close();
