// FTUE audit (docs/FTUE.md): a scripted newcomer from fresh storage plays main menu → 第一天 → 1-1 tutorial →
// result → career screen → 1-2, on desktop 1280x720 and phone landscape 844x390 (touch), and records timings,
// text amounts, modal cards and screenshots. It is an automated newcomer, not a human: moves are teleports
// next to the target after a simulated walking delay (distance / 3.6 m/s), and "reading" waits chars / 7 s.
// Not part of test:e2e (it plays two full shifts in real time per viewport, ~5 min each).
// Usage: GAME_URL=http://localhost:8804/ OUT=docs/ftue LABEL=after node tests/e2e/ftue-audit.mjs [desktop|phone]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const LABEL = process.env.LABEL ?? 'run';
const ONLY = process.argv[2];
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const READ_CPS = 7; // characters per second a newcomer reads (Chinese, casual)
const readMs = chars => Math.max(800, Math.round(chars / READ_CPS * 1000));
const report = {};

for (const mode of ['desktop', 'phone']) {
  if (ONLY && ONLY !== mode) continue;
  const phone = mode === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  const R = { mode, timeline: [], cards: [], hudText: [], tutorial: [], confusions: [], shots: [] };
  let t0 = 0;
  const now = () => (Date.now() - t0) / 1000;
  // wall-clock seconds since the start click, plus in-game seconds (world.time) once the store exists: the
  // harness itself (screenshots, evaluate calls under software rendering) adds wall time a player never sees
  const mark = async (what, extra = {}) => {
    const sim = await pg.evaluate(() => window.__game?.conn?.room?.world ? +window.__game.conn.room.world.time.toFixed(1) : null).catch(() => null);
    R.timeline.push({ t: +now().toFixed(1), sim, what, ...extra }); console.log(mode, now().toFixed(1), sim, what, JSON.stringify(extra).slice(0, 160));
    return sim;
  };
  let shotN = 0;
  const shot = async name => {
    const f = `${OUT}/${LABEL}-${mode}-${String(++shotN).padStart(2, '0')}-${name}.png`;
    await pg.evaluate(() => { window.__hold = true; });
    await pg.screenshot({ path: f }); R.shots.push(f);
    await pg.evaluate(() => { window.__hold = false; });
  };
  const visibleText = () => pg.evaluate(() => {
    const ids = ['hintbar', 'introcard', 'arccard', 'phasebanner', 'helpkeys', 'toasts', 'alert', 'prompt', 'aftermath', 'tutskip', 'objective', 'stamp'];
    const out = {};
    for (const id of ids) { const el = document.getElementById(id); if (!el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || !el.innerText.trim()) continue; out[id] = el.innerText.trim(); }
    return out;
  });
  // headless swiftshader renders slowly and the solo loop caps each tick at 0.1 s, so the simulation would run at
  // ~0.4x; drive it at wall-clock speed instead so timings match what a player on a normal device sees
  const realtime = () => pg.evaluate(() => {
    const c = window.__game.conn; clearInterval(c.timer); c.last = performance.now();
    // window.__hold: the harness is taking a screenshot; the store waits for it (a player never sees that pause)
    c.timer = setInterval(() => { const t = performance.now(); let dt = (t - c.last) / 1000; c.last = t; if (window.__hold) return; while (dt > 0.0001) { const s = Math.min(0.05, dt); c.room.update(s); dt -= s; } }, 50);
  });
  const chars = s => (s ?? '').replace(/\s/g, '').length;

  await pg.goto(URL);
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();
  await pg.waitForSelector('#m-first', { timeout: 20000 });
  await pg.waitForTimeout(1500); // the menu slides in
  R.menuChars = await pg.evaluate(() => document.getElementById('ui').innerText.replace(/\s/g, '').length);
  await shot('menu');
  t0 = Date.now();
  await pg.click('#m-first');
  await mark('click 開始第一天');
  R.clicksToControl = 1;
  // story cards: read each, then continue
  for (let i = 0; i < 20; i++) {
    const st = await pg.waitForFunction(() => document.getElementById('sc-next') ? 'card' : window.__game?.started ? 'game' : null, null, { timeout: 30000 }).then(h => h.jsonValue());
    if (st !== 'card') break;
    const card = await pg.evaluate(() => ({ title: document.querySelector('.scene .muted')?.textContent ?? '', text: document.querySelector('.scene .bubble')?.innerText ?? '', next: document.getElementById('sc-next')?.textContent ?? '' }));
    R.cards.push({ ...card, chars: chars(card.text) });
    if (i === 0) await shot('story');
    await pg.waitForTimeout(readMs(chars(card.text)));
    await pg.click('#sc-next'); R.clicksToControl++;
    await mark('story card', { chars: chars(card.text) });
    await pg.waitForTimeout(150);
  }
  await pg.waitForFunction(() => window.__game?.started, null, { timeout: 30000 });
  await realtime();
  R.tControl = +now().toFixed(1);
  R.simControl = await mark('game started (player can move)');
  await pg.waitForTimeout(400);
  const prepText = await visibleText();
  R.hudText.push({ at: 'start', texts: prepText, chars: Object.values(prepText).reduce((n, s) => n + chars(s), 0) });
  await shot('start');
  // a newcomer reads the instruction (objective line / start button / blocking card; the controls strip and story
  // bubbles are read on the move), then acts: walks to the tutorial target, or presses the start button
  const instr = ['hintbar', 'phasebanner', 'introcard'].reduce((n, k) => n + chars(prepText[k]), 0);
  R.hudText[0].instructionChars = instr;
  await pg.waitForTimeout(readMs(instr));
  for (let i = 0; i < 60; i++) {
    const st = await pg.evaluate(() => ({ phase: window.__game.snap.phase, tut: window.__game.tut }));
    if (st.phase !== 'prep') break;
    if (st.tut?.target && st.tut.step === 1) {
      const d = await pg.evaluate(tg => Math.hypot(window.__game.pos.x - tg.x, window.__game.pos.z - tg.z), st.tut.target);
      await pg.waitForTimeout(Math.min(4000, d / 3.6 * 1000));
      await pg.evaluate(tg => { const g = window.__game, me = [...g.conn.room.world.players.values()][0]; g.pos = { x: tg.x, z: tg.z }; g.yaw = 0; g.pitch = -0.15; me.x = tg.x; me.z = tg.z; }, st.tut.target);
      R.firstMoveAt = R.firstMoveAt ?? await mark('walked to the till (tutorial step 1, during prep)');
      await pg.waitForTimeout(500);
      continue;
    }
    // desktop: the mouse is pointer-locked to the view, so the button's key ([Enter]) is what a player can use
    if (!R.pressedStart && await pg.locator('#pb-ready').count()) { R.pressedStart = true; if (phone) await pg.tap('#pb-ready'); else await pg.keyboard.press('Enter'); R.clicksToControl++; await mark('pressed 開始上班'); }
    await pg.waitForTimeout(500);
  }
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 20000 });
  R.tOpen = +now().toFixed(1);
  R.simOpen = await mark('store open');

  // helpers: stand next to whatever offers `kind`, face it, press interact (E / the 互動 button)
  const approach = async (kind, filter = null) => pg.evaluate(([kind, filter]) => {
    const g = window.__game, s = g.snap;
    const cands = g.candidates(s).filter(c => c.primary === kind && (!filter || (JSON.stringify(c.target) + c.label).includes(filter)));
    if (!cands.length) return null;
    let best = null;
    const boxes = g.candidates(s).filter(c => c.box).map(c => c.box);
    const walkable = (x, z) => x > 0.6 && x < 23.4 && z > 0.6 && z < 14.8 && !boxes.some(b => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3);
    const tryAt = (c, x, z, cx, cz) => {
      if (!walkable(x, z)) return;
      const yaw = Math.atan2(cx - x, cz - z), pitch = c.point && c.point.h === 0 ? -0.5 : -0.15;
      const oldPos = g.pos, oldYaw = g.yaw, oldPitch = g.pitch;
      g.pos = { x, z }; g.yaw = yaw; g.pitch = pitch;
      const t = g.pickTarget(s);
      g.pos = oldPos; g.yaw = oldYaw; g.pitch = oldPitch;
      if (t && t.primary === kind && JSON.stringify(t.target) === JSON.stringify(c.target)) { const d = Math.hypot(x - g.pos.x, z - g.pos.z); if (!best || d < best.d) best = { x, z, yaw, pitch, d }; }
    };
    for (const c of cands) {
      if (c.box) {
        const b = c.box;
        for (const f of [0.15, 0.5, 0.85]) for (const d of [0.5, 0.8, 1.1]) {
          const x = b.x0 + (b.x1 - b.x0) * f, z = b.z0 + (b.z1 - b.z0) * f;
          tryAt(c, x, b.z0 - d, x, b.z0 + 0.05); tryAt(c, x, b.z1 + d, x, b.z1 - 0.05);
          tryAt(c, b.x0 - d, z, b.x0 + 0.05, z); tryAt(c, b.x1 + d, z, b.x1 - 0.05, z);
        }
      } else {
        for (const r of [0.9, 1.2, 0.7, 1.5]) for (let a = 0; a < 16; a++) tryAt(c, c.point.x + Math.sin(a / 8 * Math.PI) * r, c.point.z + Math.cos(a / 8 * Math.PI) * r, c.point.x, c.point.z);
      }
    }
    return best;
  }, [kind, filter]);
  const act = async (kind, filter = null, waitFn = null) => {
    const spot = await approach(kind, filter);
    if (!spot) return false;
    await pg.waitForTimeout(Math.min(4000, spot.d / 3.6 * 1000)); // simulated walk
    await pg.evaluate(sp => { const g = window.__game, me = [...g.conn.room.world.players.values()][0]; g.pos = { x: sp.x, z: sp.z }; g.yaw = sp.yaw; g.pitch = sp.pitch; me.x = sp.x; me.z = sp.z; me.yaw = sp.yaw; }, spot);
    await pg.waitForTimeout(250);
    if (phone) await pg.tap('#t-interact'); else await pg.keyboard.press('KeyE');
    if (waitFn) await pg.waitForFunction(waitFn, null, { timeout: 8000 }).catch(() => {});
    else await pg.waitForTimeout(400);
    return true;
  };
  const busyWait = () => pg.waitForFunction(() => !window.__game.snap.players[0].busy, null, { timeout: 8000 }).catch(() => {});

  // tutorial: follow each objective
  let lastStep = 0, firstServeAt = null, firstStampAt = null;
  pg.exposeFunction && await pg.evaluate(() => {
    window.__ftue = { stamps: [], cards: [] };
    new MutationObserver(() => { const el = document.getElementById('stamp'); if (!el.classList.contains('hidden')) window.__ftue.stamps.push({ t: performance.now(), text: el.textContent }); }).observe(document.getElementById('stamp'), { attributes: true, childList: true, characterData: true, subtree: true });
    new MutationObserver(() => { const el = document.getElementById('introcard'); if (!el.classList.contains('hidden')) window.__ftue.cards.push({ t: performance.now(), text: el.innerText }); }).observe(document.getElementById('introcard'), { attributes: true, childList: true, subtree: true });
  });
  const tutDeadline = Date.now() + 90000;
  while (Date.now() < tutDeadline) {
    const st = await pg.evaluate(() => ({ tut: window.__game.tut, phase: window.__game.snap.phase, served: window.__game.snap.dayStats.served, held: window.__game.snap.players[0].held, atReg: window.__game.snap.customers.some(c => c.state === 'atRegister') }));
    if (st.phase !== 'open') break;
    if (firstServeAt == null && st.served >= 1) { firstServeAt = +now().toFixed(1); R.simFirstServe = await mark('first customer served'); }
    if (!st.tut) break;
    if (st.tut.step !== lastStep) {
      lastStep = st.tut.step;
      const vt = await visibleText();
      R.tutorial.push({ step: st.tut.step, total: st.tut.total, text: st.tut.text, at: +now().toFixed(1), hudChars: Object.values(vt).reduce((n, s) => n + chars(s), 0) });
      await mark(`tutorial step ${st.tut.step}/${st.tut.total}`, { text: st.tut.text });
      await shot(`tut${st.tut.step}`);
      await pg.waitForTimeout(Math.max(0, readMs(chars(st.tut.text)) - 1500)); // reading overlaps the first steps of walking
      if (st.tut.step > st.tut.total) break;
    }
    const step = st.tut.step;
    const text = st.tut.text;
    if (step >= st.tut.total && /完成/.test(text)) break;
    if (/收銀機前|走到/.test(text) && step === 1) {
      const tg = st.tut.target;
      await pg.waitForTimeout(1500);
      await pg.evaluate(tg => { const g = window.__game, me = [...g.conn.room.world.players.values()][0]; g.pos = { x: tg.x, z: tg.z }; g.yaw = 0; g.pitch = -0.15; me.x = tg.x; me.z = tg.z; }, tg);
      await pg.waitForTimeout(300);
    } else if (/結帳/.test(text) || /等顧客/.test(text)) {
      if (st.atReg) { await act('checkout', null, null); await busyWait(); } else await pg.waitForTimeout(300);
    } else if (/貨箱/.test(text) && !st.held) await act('takeBox');
    else if (/上架/.test(text) && st.held?.kind === 'box') { await act('stock', st.held.product); await busyWait(); }
    else if (/拖把/.test(text) && !st.held) await act('takeMop');
    else if (/髒污|拖乾淨/.test(text)) { await act('clean'); await busyWait(); }
    else if (/退散|插隊|排隊/.test(text)) { if (!(await act('askQueue'))) await pg.waitForTimeout(300); }
    else await pg.waitForTimeout(300);
  }
  R.tTutorialDone = +now().toFixed(1);
  await mark('tutorial over');
  // play on: serve, restock, clean, ask cutters to queue (until the shift ends)
  const playOn = async (limitMs) => {
    const end = Date.now() + limitMs;
    while (Date.now() < end) {
      const st = await pg.evaluate(() => { const s = window.__game.snap; return { phase: s.phase, result: !!document.querySelector('.result'), served: s.dayStats.served, held: s.players[0].held, atReg: s.customers.some(c => c.state === 'atRegister'), karen: s.customers.some(c => c.kind === 'cutter' && !c.resolved && c.revealed && ['queue', 'toRegister', 'atRegister'].includes(c.state)), low: Object.entries(s.shelves).filter(([p, n]) => n <= 3 && s.backstock[p] > 0).map(([p]) => p) }; }).catch(() => ({ phase: 'gone' }));
      if (st.phase !== 'open') break;
      if (firstServeAt == null && st.served >= 1) { firstServeAt = +now().toFixed(1); R.simFirstServe = await mark('first customer served'); }
      if (st.karen) { if (await act('askQueue')) { await mark('asked the cutter to queue'); continue; } }
      if (st.held?.kind === 'box') { if (!(await act('stock', st.held.product))) await act('returnBox'); await busyWait(); continue; }
      if (st.held?.kind === 'mop') { if (!(await act('clean'))) await act('returnMop'); await busyWait(); continue; }
      if (st.atReg) { await act('checkout'); await busyWait(); continue; }
      if (st.low.length) { await act('takeBox', st.low[0]); continue; }
      await pg.waitForTimeout(300);
    }
  };
  await playOn(150000);
  const stamps11 = await pg.evaluate(() => window.__ftue.stamps.map(s => s.text));
  R.stamps11 = [...new Set(stamps11)];
  await pg.waitForSelector('.result', { timeout: 30000 }).catch(() => {});
  R.tResult = +now().toFixed(1);
  R.firstServeAt = firstServeAt;
  await mark('result screen');
  await pg.waitForTimeout(1500);
  R.result11 = await pg.evaluate(() => ({ text: document.querySelector('.result')?.innerText ?? '', chars: (document.querySelector('.result')?.innerText ?? '').replace(/\s/g, '').length, won: !!document.querySelector('.result.won'), stars: document.querySelectorAll('.bigstars .on').length, overflow: (() => { const c = document.querySelector('.result'); return c ? c.scrollHeight > c.clientHeight + 2 : false; })() }));
  await shot('result11');
  // the result screen may hold a hook / tease line
  R.hook11 = await pg.evaluate(() => document.querySelector('.result .hook')?.innerText ?? '');
  // to the career screen, then 1-2
  if (await pg.locator('#r-career').count()) {
    await pg.click('#r-career');
    await pg.waitForTimeout(800);
    // outro scene first, if any
    for (let i = 0; i < 10 && await pg.locator('#sc-next').count(); i++) { await pg.click('#sc-next'); await pg.waitForTimeout(150); }
    R.careerChars = await pg.evaluate(() => document.getElementById('ui').innerText.replace(/\s/g, '').length);
    await shot('career');
    await mark('career screen');
    if (await pg.locator('[data-play="1-2"]:not([disabled])').count() === 0 && await pg.locator('[data-play="1-2"]').count()) {
      // the scripted newcomer failed 1-1: a person would retry; the audit unlocks 1-2 instead (recorded)
      R.unlocked12ByHarness = true;
      await pg.evaluate(() => { const p = JSON.parse(localStorage.getItem('fucustomer.career.v1')); p.stars['1-1'] = 1; localStorage.setItem('fucustomer.career.v1', JSON.stringify(p)); });
      await pg.reload(); await pg.click('#m-career'); await pg.waitForTimeout(500);
    }
    if (await pg.locator('[data-play="1-2"]').count()) {
      await pg.click('[data-play="1-2"]');
      for (let i = 0; i < 10; i++) {
        const st = await pg.waitForFunction(() => document.getElementById('sc-next') ? 'card' : window.__game?.started ? 'game' : null, null, { timeout: 30000 }).then(h => h.jsonValue());
        if (st !== 'card') break;
        await pg.click('#sc-next');
      }
      await pg.waitForFunction(() => window.__game?.started, null, { timeout: 30000 });
      await realtime();
      await mark('1-2 started');
      await pg.evaluate(() => {
        window.__ftue = { stamps: [], cards: [] };
        new MutationObserver(() => { const el = document.getElementById('stamp'); if (!el.classList.contains('hidden')) window.__ftue.stamps.push({ t: performance.now(), text: el.textContent }); }).observe(document.getElementById('stamp'), { attributes: true, childList: true, characterData: true, subtree: true });
        new MutationObserver(() => { const el = document.getElementById('introcard'); if (!el.classList.contains('hidden')) window.__ftue.cards.push({ t: performance.now(), text: el.innerText }); }).observe(document.getElementById('introcard'), { attributes: true, childList: true, subtree: true });
      });
      R.hud12 = await visibleText();
      await shot('start12');
      if (!R.pressedStart && await pg.locator('#pb-ready').count()) { R.pressedStart = true; if (phone) await pg.tap('#pb-ready'); else await pg.keyboard.press('Enter'); }
      await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 20000 });
      const open12 = await mark('1-2 open');
      // the first karen (in-game seconds after opening)
      const seen = await pg.waitForFunction(() => window.__game.snap.customers.some(c => c.kind === 'cutter' && c.revealed), null, { timeout: 70000 }).then(() => true).catch(() => false);
      const ks = seen ? await mark('1-2 first karen') : null;
      R.firstKaren12 = ks != null && open12 != null ? +(ks - open12).toFixed(1) : null;
      await pg.waitForTimeout(400);
      await shot('karen12');
      R.karenCard12 = await pg.evaluate(() => window.__ftue.cards.map(c => c.text));
      await playOn(160000);
      R.stamps12 = await pg.evaluate(() => [...new Set(window.__ftue.stamps.map(s => s.text))]);
      await pg.waitForSelector('.result', { timeout: 30000 }).catch(() => {});
      await pg.waitForTimeout(1500);
      R.result12 = await pg.evaluate(() => ({ text: document.querySelector('.result')?.innerText ?? '', won: !!document.querySelector('.result.won'), stars: document.querySelectorAll('.bigstars .on').length }));
      R.hook12 = await pg.evaluate(() => document.querySelector('.result .hook')?.innerText ?? '');
      await shot('result12');
      await mark('1-2 result');
    }
  }
  R.errors = errors;
  report[mode] = R;
  await ctx.close();
}
writeFileSync(`${OUT}/${LABEL}-report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([m, r]) => [m, { menuChars: r.menuChars, cards: r.cards.length, cardChars: r.cards.reduce((n, c) => n + c.chars, 0), clicksToControl: r.clicksToControl, tControl: r.tControl, tOpen: r.tOpen, firstServeAt: r.firstServeAt, tTutorialDone: r.tTutorialDone, tResult: r.tResult, won11: r.result11?.won, stars11: r.result11?.stars, stamps11: r.stamps11, firstKaren12: r.firstKaren12, won12: r.result12?.won, errors: r.errors }])), null, 1));
await browser.close();
