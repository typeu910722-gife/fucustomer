// Round 24: 打擊感 — grab squash + 嘿咻, throw hit-stop / camera kick, 退散！ stamp, combo pop, impact star,
// 旋風 speed lines, 全店退散 stamp, 出手 啪！ stamp — and the 減少動態效果 setting turning shake / hit-stop / flash off.
// One browser, solo career play with real key presses (simulation runs in the page). Sounds are generated but
// nobody listens to them here: this only checks that nothing throws and the visual/DOM effects fire.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);

const pg = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
await pg.goto(URL);
await pg.evaluate(() => {
  localStorage.clear();
  const stars = {}; for (const c of [1, 2]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], seenMaps: ['convenience'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 12, exp: 10, wallet: 500, skillPoints: 11, skills: {}, gear: {}, stars, clears: { ...stars }, stats: { shifts: 10, wins: 10 }, story: ['ch1-intro', 'ch1-outro', 'ch2-intro', 'ch2-outro', 'ch3-intro'] }));
});
await pg.reload();

// ---------- settings screen has the two new toggles ----------
await pg.waitForSelector('#m-settings');
await pg.click('#m-settings');
const toggles = await pg.evaluate(() => ({ shake: document.getElementById('s-shake')?.checked, rm: document.getElementById('s-rmotion')?.checked }));
if (toggles.shake !== true || toggles.rm !== false) fail('settings toggles missing / wrong defaults ' + JSON.stringify(toggles)); else ok('settings: 畫面震動 on, 減少動態效果 off by default');
await pg.screenshot({ path: `${OUT}/r24-settings.png` });
await pg.click('#s-ok');

await pg.waitForSelector('#m-career');
await pg.click('#m-career');
await pg.click('[data-play="3-1"]');
await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 });
if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 15000 });

// per-frame recorder of the juice state (shake, time scale, flash opacity, camera roll/kick)
await pg.evaluate(() => {
  const g = window.__game; window.__rec = [];
  const loop = () => {
    const f = document.getElementById('flash');
    const stp = document.getElementById('stamp'), cb = document.getElementById('combo');
    window.__rec.push({ t: performance.now(), shake: g.view.shake, ts: g.warp.scale(performance.now()), flash: Number(f.style.opacity || 0), kick: g.view.kick,
      stamp: stp.classList.contains('hidden') ? '' : stp.textContent, combo: !cb.classList.contains('hidden') && cb.classList.contains('pop') ? cb.textContent : '',
      stars: g.view.stars.filter(s => s.life > 0).length });
    if (window.__rec.length > 600) window.__rec.shift();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // DOM effects are logged by observers too (frame rate in swiftshader can be very low under load)
  window.__dom = [];
  const log = id => { const el = document.getElementById(id); new MutationObserver(() => { if (!el.classList.contains('hidden')) window.__dom.push(`${id}|${el.className}|${el.textContent}`); }).observe(el, { attributes: true, childList: true, characterData: true, subtree: true }); };
  log('stamp'); log('combo'); log('speedlines');
  // hit-stop / slow-mo requests (the freeze itself can fall between two slow frames)
  const w = g.warp, stop = w.stop.bind(w), slow = w.slow.bind(w);
  window.__warp = [];
  w.stop = (ms, now) => { if (ms > 0) window.__warp.push(['stop', ms]); stop(ms, now); };
  w.slow = (ms, sc, now) => { if (ms > 0) window.__warp.push(['slow', ms, sc]); slow(ms, sc, now); };
  window.__clearRec = () => { window.__rec.length = 0; window.__dom.length = 0; window.__warp.length = 0; };
});

/** Puts a karen right in front of the player (who stands facing the door) and waits until the client sees it. */
async function placeKaren(id, z = 13.6, kind = 'rager') {
  await pg.evaluate(([id, z, kind]) => {
    const g = window.__game, w = g.conn.room.world;
    const me = [...w.players.values()][0];
    g.pos = { x: 12, z: 12.6 }; g.yaw = 0; g.pitch = 0.1; me.x = 12; me.z = 12.6; me.yaw = 0;
    w.customers = w.customers.filter(c => c.id >= 9000 || Math.hypot(c.x - 12, c.z - 13) > 3);
    w.customers.push({ id, kind, x: 12, z, yaw: 0, state: 'complain', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false, foodFailed: false, patience: 100, patienceMax: 100, mood: 80, timer: 0, register: -1, anger: 40, resolved: false, hits: 0, eaten: [], eatShelf: null, life: 999, look: 3, angry: false, moving: false, knockTimer: 99, gone: false, heldBy: null, fly: null });
  }, [id, z, kind]);
  await pg.waitForFunction(id => window.__game.snap.customers.some(c => c.id === id), id, { timeout: 15000 });
  await pg.waitForTimeout(250);
}
async function grabAndThrow(id, shots) {
  await pg.keyboard.press('Space');
  await pg.waitForFunction(id => window.__game.snap.players[0].grabbing === id, id, { timeout: 15000 });
  if (shots) { await pg.waitForTimeout(60); await pg.screenshot({ path: `${OUT}/r24-grab.png` }); }
  await pg.waitForTimeout(350);
  await pg.keyboard.press('Space');
  if (shots) for (let i = 0; i < 8; i++) await pg.screenshot({ path: `${OUT}/r24-throw-seq-${i}.png` }); // frame sequence (each shot ≈ 80–150 ms in swiftshader)
}

// ---------- (1) grab + throw → 退散！ stamp, impact star, hit-stop, shake ----------
await placeKaren(9101);
await pg.evaluate(() => window.__clearRec());
await grabAndThrow(9101, true);
await pg.waitForFunction(() => window.__game.snap.dayStats.ejected >= 1, null, { timeout: 15000 });
const st1 = await pg.waitForFunction(() => window.__dom.find(d => /^stamp\|.*go.*\|.*退散/.test(d)) ?? null, null, { timeout: 3000 }).then(h => h.jsonValue()).catch(() => null);
if (!st1) fail('no 退散 stamp after the eject'); else ok(`stamp shown: ${st1}`);
await pg.waitForTimeout(150);
await pg.screenshot({ path: `${OUT}/r24-eject-stamp.png` });
const r1 = await pg.evaluate(() => ({ maxShake: Math.max(...window.__rec.map(r => r.shake)), froze: window.__rec.filter(r => r.ts === 0).length, stops: window.__warp.filter(w => w[0] === 'stop').map(w => w[1]), maxKick: Math.max(...window.__rec.map(r => Math.abs(r.kick))), stars: Math.max(...window.__rec.map(r => r.stars)) }));
if (r1.maxShake <= 0) fail('no camera shake on throw/eject'); else ok(`camera shake ${r1.maxShake.toFixed(2)}`);
if (!r1.stops.length || r1.stops.some(ms => ms < 40 || ms > 80)) fail('throw/eject hit-stop not 40–80 ms: ' + JSON.stringify(r1.stops)); else ok(`hit-stop requested ${JSON.stringify(r1.stops)} ms; ${r1.froze} frozen frame(s) observed`);
if (r1.maxKick <= 0) fail('no camera kick'); else ok(`camera kick ${r1.maxKick.toFixed(3)} rad`);
if (r1.stars < 1) fail('no impact star'); else ok('impact star popped outside');

// ---------- (2) second karen right away → combo counter pops ----------
// (two ejects back to back within the sim's 5 s combo window; the screenshots above are too slow in swiftshader)
await placeKaren(9102);
await grabAndThrow(9102, false);
await pg.waitForFunction(() => window.__game.snap.dayStats.ejected >= 2, null, { timeout: 15000 });
await placeKaren(9107);
await pg.evaluate(() => window.__clearRec());
await grabAndThrow(9107, false);
const combo = await pg.waitForFunction(() => window.__dom.find(d => /^combo\|.*pop.*\|/.test(d))?.split('|')[2] ?? null, null, { timeout: 6000 }).then(h => h.jsonValue()).catch(() => null);
if (!combo || !/2 連送/.test(combo)) fail('no combo pop: ' + combo); else ok(`combo pop: ${combo}`);
await pg.screenshot({ path: `${OUT}/r24-combo.png` });

// ---------- (3) 出手 (X) → 啪！ stamp + heavier hit-stop ----------
await pg.evaluate(() => { const w = window.__game.conn.room.world; if (!w.cfg.abilities.includes('hit')) w.cfg.abilities.push('hit'); });
await placeKaren(9103, 13.4);
await pg.evaluate(() => window.__clearRec());
await pg.keyboard.press('KeyX');
const st3 = await pg.waitForFunction(() => window.__dom.find(d => /^stamp\|hit/.test(d))?.split('|')[2] ?? null, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => null);
if (st3 !== '啪！') fail('no 啪 stamp after 出手: ' + st3); else ok('出手 → 啪！ stamp');
await pg.waitForTimeout(100);
await pg.screenshot({ path: `${OUT}/r24-hit.png` });
const r3 = await pg.evaluate(() => window.__warp.filter(w => w[0] === 'stop').map(w => w[1]));
if (!r3.length || Math.max(...r3) <= 80) fail('出手 hit-stop not heavier than a throw: ' + JSON.stringify(r3)); else ok(`出手 hit-stop ${Math.max(...r3)} ms`);

// ---------- (4) 旋風 (Q) → speed lines; 全店退散 (R) → big stamp + slow-mo + flash ----------
await pg.evaluate(() => { const w = window.__game.conn.room.world; for (const a of ['spin', 'ultimate']) if (!w.cfg.abilities.includes(a)) w.cfg.abilities.push(a); [...w.players.values()][0].spinReadyAt = 0; });
await placeKaren(9104, 13.5, 'cutter');
await pg.keyboard.press('KeyQ');
const sl = await pg.waitForFunction(() => window.__dom.some(d => /^speedlines\|go/.test(d)), null, { timeout: 4000 }).then(() => true).catch(() => false);
if (!sl) fail('no speed lines on 旋風'); else ok('旋風 → radial speed lines');
await pg.waitForTimeout(120);
await pg.screenshot({ path: `${OUT}/r24-spin.png` });
await placeKaren(9105, 14.2, 'rager');
await pg.evaluate(() => { window.__game.conn.room.world.burst = 100; window.__clearRec(); });
await pg.waitForTimeout(200);
await pg.keyboard.press('KeyR');
const st4 = await pg.waitForFunction(() => window.__dom.find(d => /^stamp\|big/.test(d))?.split('|')[2] ?? null, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => null);
if (!st4 || !/全店退散/.test(st4)) fail('no 全店退散 stamp: ' + st4); else ok(`ultimate stamp: ${st4}`);
await pg.waitForTimeout(150);
await pg.screenshot({ path: `${OUT}/r24-ultimate.png` });
const r4 = await pg.evaluate(() => ({ slow: window.__warp.filter(w => w[0] === 'slow').length + window.__rec.filter(r => r.ts > 0 && r.ts < 1).length, flash: Math.max(...window.__rec.map(r => r.flash)) }));
if (r4.slow < 1) fail('no slow-mo on ultimate'); else ok(`ultimate slow-mo ${r4.slow} frame(s)`);
if (r4.flash <= 0) fail('no flash on ultimate'); else ok('ultimate screen flash');

// ---------- (5) 減少動態效果: same grab + throw, no shake / hit-stop / flash, stamp still shown ----------
await pg.waitForTimeout(1500);
await pg.evaluate(() => { const g = window.__game; g.applySettings({ ...g.settings, reduceMotion: true }); });
await placeKaren(9106);
await pg.evaluate(() => window.__clearRec());
await grabAndThrow(9106, false);
await pg.waitForFunction(() => window.__game.snap.dayStats.ejected >= 4, null, { timeout: 15000 });
await pg.waitForTimeout(600);
const r5 = await pg.evaluate(() => ({ maxShake: Math.max(0, ...window.__rec.map(r => r.shake)), froze: window.__rec.filter(r => r.ts !== 1).length + window.__warp.length, stamp: window.__dom.some(d => /^stamp\|.*退散/.test(d)), flash: Math.max(0, ...window.__rec.map(r => r.flash)), kick: Math.max(0, ...window.__rec.map(r => Math.abs(r.kick))), scale: window.__game.view.shakeScale, frames: window.__rec.length, saved: JSON.parse(localStorage.getItem('fucustomer.settings.v1')).reduceMotion }));
if (r5.maxShake * r5.scale > 0 || r5.froze > 0 || r5.flash > 0 || r5.kick > 1e-4) fail('reduce motion still moves the screen ' + JSON.stringify(r5));
else ok(`減少動態效果: no shake / hit-stop / flash / kick over ${r5.frames} frames`);
if (!r5.stamp) fail('reduce motion should still show the stamp'); else ok('減少動態效果: 退散！ stamp still shown');
if (r5.saved !== true) fail('reduceMotion not saved'); else ok('reduceMotion saved in settings');

if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | ')); else ok('no page errors');
await browser.close();
console.log(process.exitCode ? 'ROUND24 E2E FAILED' : 'ROUND24 E2E PASSED');
