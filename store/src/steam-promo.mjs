// Short promo clip (≈8 s): grab a raging karen with Space, carry him to the glowing exit, throw him out the door.
// Recorded frame by frame from the real game: Playwright's fake clock drives the page (simulation interval and
// requestAnimationFrame), so every frame is exactly 50 ms of game time even with slow software rendering.
// Needs the built game served (see steam-screens.mjs) and ffmpeg.
// Usage: GAME_URL=http://127.0.0.1:8899/ node store/src/steam-promo.mjs   → store/steam/promo/grab-throw.webm (+ .gif)
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const GAME = process.env.GAME_URL ?? 'http://127.0.0.1:8899/';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT ?? path.resolve(HERE, '../steam/promo');
const FRAMES = process.env.FRAMES_DIR ?? path.join(OUT, '.frames');
const FPS = 20;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error', String(e)));
await page.clock.install();
await page.goto(GAME);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'high', name: '阿明', fov: 80, fpsCap: 0, adaptive: false, volume: 0, music: 0 }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], seenMaps: ['convenience'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 18, wallet: 900, stars: { '1-1': 3 }, clears: { '1-1': 1 }, stats: { shifts: 20, wins: 20 }, story: ['ch1-intro', 'ch2-intro', 'ch3-intro', 'ch4-intro'] }));
});
await page.reload();
await page.addStyleTag({ content: '#helpkeys { display: none !important; }' });
await page.click('#m-career'); await page.click('[data-tab="free"]'); await page.waitForSelector('.mapcard');
await page.click('[data-map="convenience"]');
await page.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
// open the store and let a few customers come in
await page.evaluate(() => { const r = window.__game.conn.room; r.world.phaseLeft = 0.1; for (let i = 0; i < 25 * 20; i++) r.update(0.05); });
await page.evaluate(() => {
  const g = window.__game, w = g.conn.room.world;
  w.customers = w.customers.filter(c => !(c.x > 8 && c.x < 16 && c.z > 7.9 && c.z < 16.5)); // a clear aisle to the door
  w.customers.push({ id: 9001, kind: 'rager', x: 12, z: 10.3, yaw: Math.PI, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 78, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: true, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null, phase: 0, minions: [] });
  const me = w.players.get(g.selfId);
  g.pos = { x: 12, z: 8.1 }; g.yaw = 0; g.pitch = -0.02; me.x = 12; me.z = 8.1;
});
// from here on the page only moves when we advance its clock
const now = await page.evaluate(() => Date.now());
await page.clock.pauseAt(now + 200);
await page.clock.runFor(500);

let n = 0;
const frame = async (fn) => {
  if (fn) await page.evaluate(fn);
  await page.clock.runFor(1000 / FPS);
  await page.screenshot({ path: path.join(FRAMES, `f${String(n++).padStart(4, '0')}.png`) });
};
const cam = (x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => { const g = window.__game; g.pos = { x, z }; g.yaw = yaw; g.pitch = pitch; }, [x, z, yaw, pitch]);
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

// 1) a raging karen in front of you (1.2 s), stepping closer
for (let i = 0; i < 24; i++) { const t = ease(i / 23); await cam(12, 8.1 + t * 0.6, Math.sin(i / 6) * 0.03, -0.02 - t * 0.05); await frame(); }
// 2) Space: grab him
await page.keyboard.press('Space');
for (let i = 0; i < 6; i++) await frame();
const grabbed = await page.evaluate(() => window.__game.snap.players.find(p => p.id === window.__game.selfId).grabbing);
console.log('grabbed', grabbed);
// 3) carry him toward the glowing exit (2.2 s)
for (let i = 0; i < 44; i++) { const t = ease(i / 43); await cam(12, 8.7 + t * 2.6, 0, -0.07 + t * 0.12); await frame(); }
// 4) aim a little up and throw (Space)
for (let i = 0; i < 6; i++) { await cam(12, 11.3, 0, 0.05 + i * 0.05); await frame(); }
await page.keyboard.press('Space');
// 5) he sails out of the door; the camera follows a step (3.4 s)
for (let i = 0; i < 68; i++) { const t = ease(Math.min(1, i / 40)); await cam(12, 11.3 + t * 0.8, 0, 0.3 - t * 0.28); await frame(); }
console.log('frames', n);
await browser.close();

const webm = path.join(OUT, 'grab-throw.webm'), gif = path.join(OUT, 'grab-throw.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.png'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-pix_fmt', 'yuv420p', '-row-mt', '1', webm]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.png'), '-vf', 'fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif]);
for (const f of [webm, gif]) console.log(f, (statSync(f).size / 1e6).toFixed(2), 'MB');
if (!process.env.KEEP_FRAMES) rmSync(FRAMES, { recursive: true, force: true });
