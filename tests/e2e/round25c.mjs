// Round 25c: the first 10 minutes (docs/FTUE.md). From fresh storage: 開始第一天 → playing within seconds (the
// chapter-1 opening plays as bubbles in the store, no modal cards), walking to the till opens the store, the first
// checkout, the tutorial's 插隊 karen gets the 退散 stamp, the goal cheer, the result-screen hook, the controls
// strip only lists usable keys, the tutorial / dialogue skips work, and on a phone (844x390, touch) the key HUD
// pieces don't overlap. One browser, solo career (the simulation runs in the page); an automated newcomer, not a person.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);
const check = (cond, msg, extra = '') => (cond ? ok(msg) : fail(`${msg} ${extra}`));

// limits (software rendering in CI is slow to build the 3D store; a phone/PC is faster)
const MAX_CONTROL_S = 12;     // click 開始第一天 → the player can move
const MAX_MODALS = 0;         // story / intro cards that block before the first action
const MAX_FIRST_SERVE_S = 12; // in-game seconds from opening (= reaching the till) to the first checkout

/** Runs the solo store at wall-clock speed (headless rendering is slow; each solo tick is capped at 0.1 s). */
const realtime = pg => pg.evaluate(() => {
  const c = window.__game.conn; clearInterval(c.timer); c.last = performance.now();
  c.timer = setInterval(() => { const t = performance.now(); let dt = (t - c.last) / 1000; c.last = t; if (window.__hold) return; while (dt > 0.0001) { const s = Math.min(0.05, dt); c.room.update(s); dt -= s; } }, 50);
});
/** Screenshot with the store held still (a software-rendered screenshot can take seconds; the shift shouldn't move on). */
async function shot(pg, path) {
  await pg.evaluate(() => { window.__hold = true; });
  await pg.screenshot({ path, timeout: 120000 });
  await pg.evaluate(() => { window.__hold = false; });
}
const simT = pg => pg.evaluate(() => window.__game.conn.room.world.time);
/** Stand where the client would target `kind` (optionally a filter on the target/label), face it and press interact. */
async function act(pg, kind, filter, tap) {
  const spot = await pg.evaluate(([kind, filter]) => {
    const g = window.__game, s = g.snap;
    const cands = g.candidates(s).filter(c => c.primary === kind && (!filter || (JSON.stringify(c.target) + c.label).includes(filter)));
    let best = null;
    const boxes = g.candidates(s).filter(c => c.box).map(c => c.box);
    const walkable = (x, z) => x > 0.6 && x < 23.4 && z > 0.6 && z < 14.8 && !boxes.some(b => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3);
    const tryAt = (c, x, z, cx, cz) => {
      if (!walkable(x, z)) return;
      const yaw = Math.atan2(cx - x, cz - z), pitch = c.point && c.point.h === 0 ? -0.5 : -0.15;
      const o = [g.pos, g.yaw, g.pitch]; g.pos = { x, z }; g.yaw = yaw; g.pitch = pitch;
      const t = g.pickTarget(s); [g.pos, g.yaw, g.pitch] = o;
      if (t && t.primary === kind && JSON.stringify(t.target) === JSON.stringify(c.target)) { const d = Math.hypot(x - g.pos.x, z - g.pos.z); if (!best || d < best.d) best = { x, z, yaw, pitch, d }; }
    };
    for (const c of cands) {
      if (c.box) { const b = c.box; for (const f of [0.15, 0.5, 0.85]) for (const d of [0.5, 0.8, 1.1]) { const x = b.x0 + (b.x1 - b.x0) * f, z = b.z0 + (b.z1 - b.z0) * f; tryAt(c, x, b.z0 - d, x, b.z0 + 0.05); tryAt(c, x, b.z1 + d, x, b.z1 - 0.05); tryAt(c, b.x0 - d, z, b.x0 + 0.05, z); tryAt(c, b.x1 + d, z, b.x1 - 0.05, z); } }
      else for (const r of [0.9, 1.2, 0.7, 1.5]) for (let a = 0; a < 16; a++) tryAt(c, c.point.x + Math.sin(a / 8 * Math.PI) * r, c.point.z + Math.cos(a / 8 * Math.PI) * r, c.point.x, c.point.z);
    }
    return best;
  }, [kind, filter ?? null]);
  if (!spot) return false;
  await pg.evaluate(sp => { const g = window.__game, me = [...g.conn.room.world.players.values()][0]; g.pos = { x: sp.x, z: sp.z }; g.yaw = sp.yaw; g.pitch = sp.pitch; me.x = sp.x; me.z = sp.z; me.yaw = sp.yaw; }, spot);
  await pg.waitForTimeout(250);
  if (tap) await pg.tap('#t-interact'); else await pg.keyboard.press('KeyE');
  return true;
}
/** Key HUD pieces that are on screen, and every pair whose boxes overlap (by more than a few pixels). */
const overlaps = pg => pg.evaluate(() => {
  const ids = ['minimap', 'shiftbar', 'rightinfo', 'hintbar', 'tutskip', 'prompt', 'phasebanner', 'aftermath', 'introcard', 'alert', 'stamina',
    't-interact', 't-item', 't-alt', 't-run', 't-ping', 't-menu', 't-chat', 't-shop', 't-grab', 't-hit', 't-spin', 't-ult'];
  const boxes = [];
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue;
    const cs = getComputedStyle(el); if (el.classList.contains('hidden') || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (!el.childElementCount && !el.textContent.trim() && el.tagName !== 'CANVAS' && !id.startsWith('t-') && id !== 'stamina') continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    boxes.push({ id, l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (w > 4 && h > 4) bad.push(`${a.id}×${b.id} (${Math.round(w)}x${Math.round(h)})`);
  }
  const off = boxes.filter(b => b.l < -2 || b.t < -2 || b.r > innerWidth + 2 || b.b > innerHeight + 2).map(b => b.id);
  return { on: boxes.map(b => b.id), bad, off };
});

for (const mode of ['desktop', 'phone']) {
  const phone = mode === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`${mode}: ${e}`));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(`${mode}: ${m.text()}`); });
  await pg.goto(URL);
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' })); });
  await pg.reload();
  await pg.waitForSelector('#m-first');
  console.log(`--- ${mode} ---`);

  // (1) 開始第一天 → control, counting blocking cards on the way
  const t0 = Date.now();
  await pg.click('#m-first');
  let modals = 0;
  for (;;) {
    const st = await pg.waitForFunction(() => document.getElementById('sc-next') ? 'card' : window.__game?.started ? 'game' : null, null, { timeout: 30000 }).then(h => h.jsonValue());
    if (st !== 'card') break;
    modals++; await pg.click('#sc-next');
  }
  const control = (Date.now() - t0) / 1000;
  await realtime(pg);
  check(control <= MAX_CONTROL_S, `player controls the character ${control.toFixed(1)} s after clicking start (≤ ${MAX_CONTROL_S})`);
  check(modals <= MAX_MODALS, `${modals} blocking story card(s) before the first action (≤ ${MAX_MODALS})`);
  const sim0 = await simT(pg);
  // the opening scene plays as bubbles while the objective line says where to go
  await pg.waitForFunction(() => !document.getElementById('aftermath').classList.contains('hidden') && document.getElementById('aftermath').textContent.length > 4, null, { timeout: 6000 }).then(() => ok('opening story plays as an in-store bubble')).catch(() => fail('no in-store story bubble'));
  if (phone) {
    await pg.waitForFunction(() => { const el = document.getElementById('aftermath'); return !el.classList.contains('fade') && +getComputedStyle(el).opacity > 0.9; }, null, { timeout: 6000 }).catch(() => {});
    const o = await overlaps(pg);
    check(o.on.includes('aftermath') && !o.bad.length && !o.off.length, `phone prep HUD with the story bubble: no overlaps (${o.on.join(', ')})`, JSON.stringify(o));
  }
  const prep = await pg.evaluate(() => ({ phase: window.__game.snap.phase, hint: document.getElementById('hintbar').innerText, pb: document.getElementById('phasebanner').innerText, keys: document.getElementById('helpkeys').innerText }));
  check(prep.phase === 'prep' && /教學 1\/6/.test(prep.hint) && /收銀機/.test(prep.hint), 'one objective line during the prep seconds', JSON.stringify(prep));
  check(!prep.pb.trim(), 'no competing start button while the tutorial leads', prep.pb);
  if (!phone) check(/WASD/.test(prep.keys) && /E 互動/.test(prep.keys) && !/抓\/丟|出手|旋風|全店退散|採購|標記|訊息|次要/.test(prep.keys), `controls strip lists only usable keys: ${prep.keys}`);
  if (phone) {
    await shot(pg, `${OUT}/r25c-phone-prep.png`);
  } else await shot(pg, `${OUT}/r25c-desktop-prep.png`);

  // (2) walking to the till opens the store (no button), the express customer is served soon after
  await pg.waitForFunction(() => { const g = window.__game, tg = g.tut?.target; if (!tg) return false; if (g.snap.phase === 'open') return true; const w = g.conn.room.world, me = [...w.players.values()][0]; window.__tp ??= w.time; g.pos = { x: tg.x, z: tg.z }; g.yaw = 0; g.pitch = -0.15; me.x = tg.x; me.z = tg.z; return false; }, null, { timeout: 8000, polling: 100 })
    .then(() => ok('reaching the till opened the store')).catch(() => fail('store did not open on reaching the till'));
  const { simOpen, arrived } = await pg.evaluate(() => ({ simOpen: window.__game.conn.room.world.openTime, arrived: window.__tp }));
  check(arrived != null && simOpen - arrived < 1.5, `store opened ${(simOpen - (arrived ?? 0)).toFixed(1)} in-game s after reaching the till (no button, no countdown)`);
  await pg.waitForFunction(() => window.__game.snap.customers.some(c => c.state === 'atRegister'), null, { timeout: 15000 }).catch(() => {});
  // A player who sees no reaction presses again right away; a 4 s wait per miss made this check depend on luck.
  for (let i = 0; i < 16 && !(await pg.evaluate(() => window.__game.snap.dayStats.served)); i++) {
    await act(pg, 'checkout', null, phone);
    await pg.waitForFunction(() => window.__game.snap.dayStats.served >= 1, null, { timeout: 1200 }).catch(() => {});
  }
  const served = await simT(pg) - simOpen;
  check(await pg.evaluate(() => window.__game.snap.dayStats.served >= 1) && served <= MAX_FIRST_SERVE_S, `first checkout ${served.toFixed(1)} in-game s after opening (≤ ${MAX_FIRST_SERVE_S})`);

  // (3) the tutorial's 插隊 karen: urgent line, no blocking card, 退散 stamp
  await pg.evaluate(() => {
    window.__stamps = [];
    new MutationObserver(() => { const el = document.getElementById('stamp'); if (!el.classList.contains('hidden') && el.textContent) window.__stamps.push(el.textContent); }).observe(document.getElementById('stamp'), { attributes: true, childList: true, subtree: true, characterData: true });
    const w = window.__game.conn.room.world; w.karenTimer = Math.min(w.karenTimer, 0.5);
  });
  await pg.waitForFunction(() => window.__game.tut?.urgent && /插隊/.test(document.getElementById('hintbar').innerText), null, { timeout: 40000 })
    .then(() => ok('tutorial points at the 插隊 karen')).catch(() => fail('no urgent tutorial line for the karen'));
  const card = await pg.evaluate(() => ({ hidden: document.getElementById('introcard').classList.contains('hidden'), paused: window.__game.conn.room.paused }));
  check(card.hidden && !card.paused, 'no karen intro card / pause during the tutorial', JSON.stringify(card));
  if (phone) { const o = await overlaps(pg); check(!o.bad.length && !o.off.length, `phone karen HUD: no overlaps (${o.on.join(', ')})`, JSON.stringify(o)); }
  await shot(pg, `${OUT}/r25c-${mode}-karen.png`);
  for (let i = 0; i < 12 && !(await pg.evaluate(() => window.__game.snap.dayStats.karensResolved)); i++) {
    if (!(await act(pg, 'askQueue', null, phone))) await pg.waitForTimeout(600);
    else await pg.waitForTimeout(500);
  }
  await pg.waitForFunction(() => window.__stamps.some(t => /退散/.test(t)), null, { timeout: 5000 }).catch(() => {});
  const st = await pg.evaluate(() => ({ resolved: window.__game.snap.dayStats.karensResolved, stamps: window.__stamps }));
  check(st.resolved >= 1 && st.stamps.some(t => /退散/.test(t)), 'first karen handled → 退散 stamp', JSON.stringify(st));

  if (!phone) {
    // (4) goal cheer, then K skips the rest of the tutorial
    await pg.evaluate(() => { window.__game.conn.room.world.dayStats.revenue = window.__game.snap.shift.goal; });
    await pg.waitForFunction(() => window.__stamps.some(t => /達標/.test(t)), null, { timeout: 5000 }).then(() => ok('★ 達標 stamp when the goal is reached')).catch(() => fail('no goal cheer'));
    await pg.waitForFunction(() => !document.getElementById('tutskip').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
    await pg.keyboard.press('KeyK');
    await pg.waitForTimeout(400);
    const sk = await pg.evaluate(() => ({ tut: window.__game.tut, done: JSON.parse(localStorage.getItem('fucustomer.flags.v1') ?? '{}').tutorialDone }));
    check(!sk.tut && sk.done, 'K skips the tutorial', JSON.stringify(sk));
  } else {
    // phone: the 跳過教學 button
    await pg.waitForFunction(() => !document.getElementById('tutskip').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
    if (await pg.locator('#tutskip:not(.hidden)').count()) await pg.tap('#tutskip');
    await pg.waitForTimeout(400);
    const sk = await pg.evaluate(() => ({ tut: window.__game.tut, done: JSON.parse(localStorage.getItem('fucustomer.flags.v1') ?? '{}').tutorialDone }));
    check(!sk.tut && sk.done, 'tapping 跳過教學 skips the tutorial', JSON.stringify(sk));
    const o = await overlaps(pg); check(!o.bad.length && !o.off.length, `phone playing HUD: no overlaps (${o.on.join(', ')})`, JSON.stringify(o));
  }

  // (5) result: won → tomorrow hook naming the next shift
  await pg.evaluate(() => { const r = window.__game.conn.room; r.world.dayStats.revenue = Math.max(r.world.dayStats.revenue, r.world.cfg.goal + 10); r.world.phaseLeft = 0.1; });
  await pg.waitForSelector('.result', { timeout: 30000 });
  await pg.waitForTimeout(1500);
  const res = await pg.evaluate(() => ({ won: !!document.querySelector('.result.won'), hook: document.querySelector('.result .hook')?.innerText ?? '' }));
  check(res.won && /明天見/.test(res.hook) && /1-2/.test(res.hook), `result hook: ${res.hook.replace(/\s+/g, ' ')}`);
  await shot(pg, `${OUT}/r25c-${mode}-result.png`);
  if (phone) {
    const fit = await pg.evaluate(() => { const c = document.querySelector('.result'); const b = c.getBoundingClientRect(); return { inside: b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1, hscroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
    check(fit.inside && !fit.hscroll, 'phone result card fits the screen', JSON.stringify(fit));
  }

  // (6) career screen for a new player: the chapter list comes first, 1-2 is the highlighted next shift
  await pg.click('#r-career');
  await pg.waitForSelector('[data-play="1-2"]');
  const car = await pg.evaluate(() => ({ first: document.querySelector('#c-body .chapter')?.innerText.slice(0, 20) ?? '', next: document.querySelector('.shiftbtn.next')?.dataset.play }));
  check(/第 1 章/.test(car.first) && car.next === '1-2', 'career screen opens on chapter 1 with 1-2 next', JSON.stringify(car));
  await ctx.close();
}

// (7) dialogue skip: a modal chapter scene (2-1's opening) advances with a click on the dialogue, Esc skips the rest
{
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pg.on('pageerror', e => errors.push(`skip: ${e}`));
  await pg.goto(URL);
  await pg.evaluate(() => {
    localStorage.clear();
    const stars = {}; for (let i = 1; i <= 5; i++) stars[`1-${i}`] = 2;
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low' }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager'], seenMaps: ['convenience'] }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 8, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 6, wins: 6 }, story: ['ch1-intro', 'ch1-outro'] }));
  });
  await pg.reload();
  await pg.click('#m-career'); await pg.click('[data-play="2-1"]');
  await pg.waitForSelector('#sc-next');
  const a = await pg.evaluate(() => document.querySelector('.scene .muted:last-child')?.textContent ?? '');
  await pg.click('.scene .dialog');
  const b = await pg.evaluate(() => document.querySelector('.scene .muted:last-child')?.textContent ?? '');
  check(/^1 \//.test(a) && /^2 \//.test(b), `a click on the dialogue moves on (${a} → ${b})`);
  await pg.keyboard.press('Escape');
  await pg.waitForFunction(() => !document.getElementById('sc-next') && window.__game, null, { timeout: 15000 }).then(() => ok('Esc skips the rest of the scene')).catch(() => fail('Esc did not skip the scene'));
  await pg.close();
}

check(!errors.length, 'no page errors', JSON.stringify(errors));
await browser.close();
