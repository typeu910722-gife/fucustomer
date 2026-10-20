// Performance budget (software-rendered Chromium, so only budgets that don't depend on the GPU / machine speed):
//  1. the main menu loads without the 3D game: its static JS (entry + modulepreloads) stays under a size budget and
//     doesn't include three.js / the game chunk;
//  2. a low-quality phone-sized shift stays under a draw-call / triangle budget;
//  3. no leak while customers come and go: GPU geometries stay bounded and the JS heap (after GC) doesn't keep growing.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const BASE = process.env.GAME_URL ?? 'http://localhost:8787/';
const URL = BASE + (BASE.includes('?') ? '&' : '?') + 'devshop=1';
const BUDGET = {
  menuJsKB: Number(process.env.PERF_MENU_JS_KB ?? 180), // compressed bytes of JS the menu needs (was ~360 KB before code splitting)
  drawCalls: 75, // low quality, 844x390, busy convenience store (≈ 45–55 measured)
  triangles: 120000,
  geometryGrowth: 40, // renderer geometries after ~3 in-game hours of customers coming and going
  heapGrowMB: 6, // JS heap after GC, over that same stretch
};
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// ---------- 1. main-menu JS ----------
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
const sizes = new Map(), urls = new Map();
cdp.on('Network.responseReceived', e => urls.set(e.requestId, e.response.url));
cdp.on('Network.loadingFinished', e => { const u = urls.get(e.requestId); if (u) sizes.set(u.replace(/\?.*$/, ''), e.encodedDataLength); });
await page.goto(URL);
await page.waitForSelector('#m-career', { state: 'visible' });
await page.waitForLoadState('networkidle');
const html = await (await page.request.get(BASE)).text();
const statics = [...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*rel="modulepreload"[^>]*\bhref)="([^"]+\.js)"/g)].map(m => new globalThis.URL(m[1], BASE).href);
const menuJs = statics.reduce((a, u) => a + (sizes.get(u) ?? 0), 0) / 1024;
const heavyInMenu = statics.filter(u => /\/(three|game)-[\w-]+\.js$/.test(u));
check(statics.length > 0, 'no entry script found in index.html');
check(menuJs <= BUDGET.menuJsKB, `menu JS ${menuJs.toFixed(0)} KB > ${BUDGET.menuJsKB} KB`);
check(heavyInMenu.length === 0, `menu statically loads ${heavyInMenu.join(', ')}`);

// ---------- 2. draw calls / triangles (low quality, busy store) ----------
await page.evaluate(() => { localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明', fpsCap: 0, adaptive: false })); localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] })); });
await page.reload();
await page.click('#m-career'); await page.click('[data-tab="free"]'); await page.waitForSelector('.mapcard');
await page.click('[data-map="convenience"]');
await page.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 60000 });
await page.evaluate(() => { const r = window.__game.conn.room; r.world.phaseLeft = 0.1; for (let i = 0; i < 20 * 40; i++) r.update(0.05); });
await page.evaluate(() => { const g = window.__game; g.pos = { x: 12, z: 15.2 }; g.yaw = Math.PI; g.pitch = -0.22; });
await page.waitForTimeout(1500);
const draw = await page.evaluate(() => new Promise(res => {
  const g = window.__game, info = g.view.renderer.info.render; let n = 0, calls = 0, tris = 0, maxCalls = 0;
  const t0 = performance.now();
  const tick = () => { n++; calls += info.calls; tris += info.triangles; maxCalls = Math.max(maxCalls, info.calls); g.yaw = Math.PI + Math.sin((performance.now() - t0) / 900) * 1.2; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res({ frames: n, calls: Math.round(calls / n), maxCalls, tris: Math.round(tris / n), customers: g.snap.customers.length }); };
  requestAnimationFrame(tick);
}));
check(draw.calls <= BUDGET.drawCalls, `draw calls ${draw.calls} > ${BUDGET.drawCalls}`);
check(draw.tris <= BUDGET.triangles, `triangles ${draw.tris} > ${BUDGET.triangles}`);

// ---------- 3. leaks while customers come and go ----------
const mem = () => page.evaluate(() => { window.gc?.(); return { heap: performance.memory.usedJSHeapSize, geos: window.__game.view.renderer.info.memory.geometries, textures: window.__game.view.renderer.info.memory.textures }; });
const m0 = await mem();
// fast-forward the shift while the store keeps rendering: lots of customers arrive, shop and leave
const served = await page.evaluate(() => new Promise(res => {
  const g = window.__game, r = g.conn.room; const seen = new Set(); let frames = 0;
  const tick = () => {
    for (let i = 0; i < 12; i++) { r.update(0.05); if (r.world.phaseLeft !== undefined && r.world.phase === 'closing') r.world.phaseLeft = Math.max(r.world.phaseLeft, 60); }
    for (const c of g.snap.customers) seen.add(c.id);
    if (++frames < 600) requestAnimationFrame(tick); else res({ frames, customers: seen.size });
  };
  requestAnimationFrame(tick);
}));
await page.waitForTimeout(500);
const m1 = await mem();
const heapGrowMB = (m1.heap - m0.heap) / 1048576;
check(m1.geos - m0.geos <= BUDGET.geometryGrowth, `geometries grew ${m0.geos} → ${m1.geos} over ${served.customers} customers`);
check(heapGrowMB <= BUDGET.heapGrowMB, `JS heap grew ${heapGrowMB.toFixed(1)} MB`);
check(errors.length === 0, `page errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ menuJsKB: +menuJs.toFixed(1), statics: statics.map(u => u.split('/').pop()), draw, leak: { served, geos: [m0.geos, m1.geos], textures: [m0.textures, m1.textures], heapGrowMB: +heapGrowMB.toFixed(2) }, budget: BUDGET, fails }, null, 1));
if (fails.length) process.exitCode = 1;
await browser.close();
