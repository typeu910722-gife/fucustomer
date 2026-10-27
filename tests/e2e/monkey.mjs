// Monkey test (round 28): seeded random action sequences per mode, looking for crashes, soft-locks and layout breakage.
// NOT part of `npm run test:e2e` (it is long): run it with `npm run test:monkey` against a running server (GAME_URL).
//
// What it does, per viewport (1280x720 desktop with mouse + keyboard, 844x390 phone with touch) and per scenario:
//   menu       — main menu: every button / tab / screen and back (profile fresh, mid or late, by seed)
//   settings   — every option incl. 字級 130 % and both colour-blind modes, then random settings changes, reload
//   shop       — 商城 browsing (late profile)
//   freeplay   — a random store from 自由營業, random keys (WASD/E/F/G/Space/Q/R/X/1-8/B/Esc/Enter/T/V/K) + mouse,
//                between-day summary (the day is fast-forwarded through the in-page simulation hook)
//   story      — 主線 1-1 (fresh), 1-2 (mid) or a later unlocked shift (late, seeded save)
//   challenge  — 今日挑戰 / 每週挑戰 / 特殊營業日 (late profile)
//   ownstore   — 自己的店 tab, between-days screens, upgrades, branches (late profile with an own store + branch)
//   backup     — 存檔備份 screens (no real cloud: not signed in; save-code import with junk)
//   multi      — two browser contexts: create + join a room, lobby controls, shift with emote wheel / team panel /
//                kick / host transfer
//   (round 30b)
//   special    — 特殊營業日 (颱風夜 / 跨年夜) from 自由營業 at a seeded 字級 (100–130 %) / colour-blind mode
//   karens     — the four general karens (and old ones) spawned through the in-page room (test hook); the exact-change
//                prompt opened with F / touch 次要 / the game's method and answered with 1–3, click, tap, Esc or not at all
//   pad        — a FAKE gamepad (navigator.getGamepads replaced, as in round21.mjs): menus, a shift, View wheel, by pad
//   cloud      — 存檔備份 with a fake (junk-session) sign-in; /api/cloudsave answers 401 / offline / 500 / slow / ok /
//                broken / 404 / 429 / a 200 HTML page at random (page.route) — no real login or cloud is touched
// Detectors: page errors, console errors, unhandled rejections, NaN/undefined/Infinity in HUD or menu text, frozen
// render loop (no rAF for > 10 s; the shared test machine can drop to ~1 fps) or game loop (Game.last / snapshot time not moving for > 10–12 s while not paused), blank
// screen, soft-lock (an overlay with no usable control where Esc does nothing), controls that can't be reached or
// clicked (outside the viewport without a scroll container / covered), horizontal page overflow, overlapping or
// off-screen key HUD pieces (only when the same pair persists across two checks), and localStorage that the game's own
// sanitizers would change on the next load (career profile, settings) plus a reload that loses progress.
//
// Every finding is logged with viewport, scenario, seed and step plus the last actions. Replays use the same seed
// (MONKEY_SEED=<n> MONKEY_SCENARIOS=<s> MONKEY_VIEWPORTS=<WxH>), but the sequence also depends on timing (the game
// runs in real time), so a replay is "the same kind of walk", not a byte-exact one.
//
// Env: GAME_URL (default http://localhost:8787/), MONKEY_MINUTES (wall time per viewport, default 10), MONKEY_SEED
// (first seed; default time-based), MONKEY_SCENARIOS (comma list), MONKEY_VIEWPORTS (default 1280x720,844x390), OUT.
// One browser, software WebGL, one machine: automated random testing — not a device test.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { newProfile, allShifts, sanitizeProfile } from '../../shared/career.ts';
import { openStore } from '../../shared/ownstore.ts';
import { openBranch, newProg } from '../../shared/progression.ts';
import { defaultSave } from '../../shared/sim.ts';
import { sanitizeSettings } from '../../client/src/storage.ts';
import { GEN_KINDS } from '../../shared/constants.ts';
import { exportSaveCode, summarizeStore } from '../../shared/savecode.ts';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const MINUTES = Number(process.env.MONKEY_MINUTES ?? 10);
const ALL = ['menu', 'settings', 'shop', 'freeplay', 'story', 'challenge', 'ownstore', 'backup', 'multi', 'special', 'karens', 'pad', 'cloud'];
const SCENARIOS = (process.env.MONKEY_SCENARIOS ?? ALL.join(',')).split(',').map(s => s.trim()).filter(s => ALL.includes(s));
const VIEWPORTS = (process.env.MONKEY_VIEWPORTS ?? '1280x720,844x390').split(',').map(v => { const [w, h] = v.split('x').map(Number); return { w, h }; });
let seed0 = Number(process.env.MONKEY_SEED ?? (Date.now() % 100000));
try { mkdirSync(OUT, { recursive: true }); } catch { /* ignore */ }

// ---------------- seeded rng ----------------
function rngOf(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: arr => arr[Math.floor(next() * arr.length)], chance: p => next() < p };
}

// ---------------- seeded saves ----------------
const SHIFTS = allShifts();
function midProfile() {
  const p = newProfile();
  p.level = 8; p.exp = 10; p.wallet = 900; p.skillPoints = 7;
  for (const s of SHIFTS.filter(s => s.chapter === 1)) { p.stars[s.id] = 2; p.clears[s.id] = 1; }
  p.stats = { shifts: 6, wins: 6, served: 80, ejected: 4, karens: 12, revenue: 3000 };
  p.story = ['ch1-intro', 'ch1-outro'];
  return sanitizeProfile(p);
}
function lateProfile(withStore) {
  const p = newProfile();
  p.level = 34; p.exp = 0; p.wallet = 900000; p.skillPoints = 33;
  for (const s of SHIFTS) { p.stars[s.id] = 3; p.clears[s.id] = 2; }
  p.stats = { shifts: 60, wins: 58, served: 1500, ejected: 120, karens: 400, revenue: 90000 };
  p.story = ['ch1-intro', 'ch1-outro', 'ch2-intro', 'ch2-outro', 'ch3-intro', 'ch3-outro', 'ch4-intro'];
  if (withStore) {
    openStore(p, '猴子小舖', 20000, defaultSave(), 'convenience');
    p.store.prog = { ...newProg(), xp: 99999, days: 40 };
    openBranch(p, 'cafe', '猴子咖啡', defaultSave());
  }
  return sanitizeProfile(p);
}
const BASE_SETTINGS = { quality: 'low', renderScale: 0.5, fpsCap: 30, name: '猴子', captions: true };
/** Round 30: in-shift accessibility — 字級 130 % and the colour-blind palettes, chosen by seed. */
function a11ySettings(rng) {
  return { ...BASE_SETTINGS, textScale: rng.pick([1, 1.3, 1.3, 1.15]), colorblind: rng.pick(['off', 'rg', 'by']) };
}
function storageFor(kind, rng, settings = BASE_SETTINGS) {
  const ls = { 'fucustomer.settings.v1': JSON.stringify(settings) };
  if (kind === 'fresh') return ls;
  ls['fucustomer.flags.v1'] = JSON.stringify({ tutorialDone: rng.chance(0.7), seenKarens: [], seenMaps: ['convenience'] });
  const prof = kind === 'mid' ? midProfile() : lateProfile(kind === 'store');
  ls['fucustomer.career.v1'] = JSON.stringify(prof);
  return ls;
}

// ---------------- findings ----------------
const findings = [];
/** Logged for a human to look at, but not a failure of the run. */
const INFO_KINDS = new Set(['hud-overlap-transient', 'pad-b-noop']);
const seen = new Map();
function report(ctx, kind, detail, extra = {}) {
  const sig = `${kind}|${String(detail).replace(/\d+/g, '#').slice(0, 160)}`;
  const n = (seen.get(sig) ?? 0) + 1; seen.set(sig, n);
  const f = { kind, detail: String(detail).slice(0, 600), viewport: ctx.vp, scenario: ctx.scenario, seed: ctx.seed, step: ctx.step, last: ctx.log.slice(-8), ...extra };
  if (n === 1) { findings.push(f); console.log(`FIND ${kind} [${ctx.vp} ${ctx.scenario} seed=${ctx.seed} step=${ctx.step}] ${f.detail}`); if (ctx.shoot) void ctx.shoot(`${kind}-${ctx.seed}-${ctx.step}`); }
  else if (n <= 3) console.log(`  (again) ${kind} [${ctx.scenario} seed=${ctx.seed} step=${ctx.step}]`);
  const last = findings.find(x => `${x.kind}|${x.detail.replace(/\d+/g, '#').slice(0, 160)}` === sig); if (last) last.count = n;
}

/** A scenario-level line in both the finding context and the trace file. */
function note(run, t) { run.log.push(t); run.trace.push(`${Date.now() - run.t0}ms ${t}`); if (run.log.length > 40) run.log.shift(); }

// ---------------- in-page helpers ----------------
const INIT = () => {
  window.__mk = { raf: 0, rej: [] };
  const tick = () => { window.__mk.raf++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  addEventListener('unhandledrejection', e => { try { window.__mk.rej.push(String(e.reason?.stack ?? e.reason)); } catch { /* ignore */ } });
};

/** Visible, enabled controls in the menu layer (#ui) and the HUD; tags each with data-mk = index. */
const CANDS = () => {
  document.querySelectorAll('[data-mk]').forEach(e => e.removeAttribute('data-mk'));
  const out = [];
  const els = [...document.querySelectorAll('#ui button, #ui select, #ui input, #ui textarea, #ui a.btn, #ui label.pick, #ui [role=button], #hud button, #touch button, #applink button, #emotewheel button')];
  const menuUp = (document.getElementById('ui')?.childElementCount ?? 0) > 0 || !!document.getElementById('applink') || !!document.querySelector('#emotewheel:not(.hidden)');
  for (const el of els) {
    if (el.disabled || el.closest('.hidden')) continue;
    if (menuUp && el.closest('#hud, #touch')) continue; // under an open menu the HUD / touch buttons are covered on purpose
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || cs.pointerEvents === 'none') continue;
    if (el.tagName === 'A' && (el.target === '_blank' || /^https?:/.test(el.getAttribute('href') ?? ''))) continue;
    if (el.tagName === 'INPUT' && (el.type === 'radio') && el.closest('label.pick')) continue; // the label is the control
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const i = out.length; el.setAttribute('data-mk', String(i));
    const data = Object.keys(el.dataset).filter(k => k !== 'mk' && k !== 'armed' && k !== 'label')[0];
    const key = el.id ? '#' + el.id : data ? `[${data}=${el.dataset[data]}]` : `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 14)}`;
    out.push({ i, key, tag: el.tagName, type: el.type ?? '', hud: !el.closest('#ui, #applink, #emotewheel'), text: (el.textContent ?? '').trim().slice(0, 30) });
  }
  return out;
};

/** One cheap state + health probe. */
const PROBE = () => {
  const g = window.__game, ui = document.getElementById('ui');
  const uiText = ui?.innerText ?? '';
  const hud = document.getElementById('hud');
  const hudOn = hud && !hud.classList.contains('hidden');
  const hudText = hudOn ? hud.innerText : '';
  const bad = /\bNaN\b|\bundefined\b|\[object [A-Z]|Infinity/;
  const badText = [];
  for (const [where, t] of [['ui', uiText], ['hud', hudText], ['captions', document.getElementById('captions')?.innerText ?? '']]) {
    const m = t.match(bad); if (m) { const i = t.indexOf(m[0]); badText.push(`${where}: …${t.slice(Math.max(0, i - 40), i + 30).replace(/\s+/g, ' ')}…`); }
  }
  const card = ui?.querySelector('.card');
  return {
    raf: window.__mk?.raf ?? 0, rej: window.__mk?.rej.splice(0) ?? [],
    inGame: !!g && !!g.started && !g.destroyed, gameExists: !!g, destroyed: !!g?.destroyed,
    overlay: g?.overlay ?? null, solo: !!g?.conn?.solo, status: g?.status ?? null,
    last: g?.last ?? 0, snapT: g?.snap?.t ?? null, phase: g?.snap?.phase ?? null,
    uiEmpty: !ui || ui.childElementCount === 0, uiHead: (card?.querySelector('h2')?.textContent ?? uiText.slice(0, 30)).trim().slice(0, 40),
    loading: /開店準備中|連線中|找店中|載入|重新連線/.test(uiText.slice(0, 200)),
    hudOn, hidden: document.hidden, badText,
    hOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    pageScrollY: scrollY,
  };
};

/** Controls that can't be reached: outside the viewport with no scrollable ancestor that could bring them in. */
const REACH = () => {
  const out = [];
  for (const el of document.querySelectorAll('#ui [data-mk]')) {
    const r = el.getBoundingClientRect();
    const off = r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1;
    if (!off) continue;
    let p = el.parentElement, scrolls = false;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) { scrolls = true; break; }
      p = p.parentElement;
    }
    if (!scrolls && document.scrollingElement && document.scrollingElement.scrollHeight > innerHeight + 1 && getComputedStyle(document.body).overflowY !== 'hidden') scrolls = true;
    if (!scrolls) out.push(`${el.id ? '#' + el.id : (el.textContent ?? '').trim().slice(0, 16)} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
  }
  return out;
};

/** Key HUD pieces: overlapping pairs and pieces off screen (same list as tests/e2e/round26b.mjs). */
const HUDLAY = () => {
  const ids = ['minimap', 'topbar', 'shiftbar', 'rightinfo', 'hintbar', 'tutskip', 'prompt', 'phasebanner', 'aftermath', 'introcard', 'arccard', 'alert', 'stamina', 'toasts', 'captions', 'eventstrip', 'burst', 'combo', 'netstatus',
    't-interact', 't-item', 't-alt', 't-run', 't-ping', 't-menu', 't-chat', 't-shop', 't-grab', 't-hit', 't-spin', 't-ult'];
  const boxes = [];
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue;
    const cs = getComputedStyle(el); if (el.classList.contains('hidden') || el.closest('.hidden') || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    if (!el.childElementCount && !el.textContent.trim() && el.tagName !== 'CANVAS' && !id.startsWith('t-') && id !== 'stamina') continue;
    const parts = id === 'toasts' || id === 'captions' ? [...el.children].filter(c => getComputedStyle(c).display !== 'none') : [el];
    for (const [i, p] of parts.entries()) {
      const r = p.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      boxes.push({ id: parts.length > 1 ? `${id}[${i}]` : id, l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
  }
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.id.split('[')[0] === b.id.split('[')[0]) continue;
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (w > 4 && h > 4) bad.push(`${a.id.split('[')[0]}×${b.id.split('[')[0]}`);
  }
  const off = boxes.filter(b => b.l < -2 || b.t < -2 || b.r > innerWidth + 2 || b.b > innerHeight + 2).map(b => b.id.split('[')[0]);
  return { bad: [...new Set(bad)], off: [...new Set(off)] };
};

// ---------------- one page under test ----------------
const IGNORE_CONSOLE = /favicon|ERR_|Failed to load resource|accounts\.google|GSI|net::|WebSocket connection|the server responded with a status of/;
/** Round 30: a FAKE standard-mapping gamepad (navigator.getGamepads replaced, the tests/e2e/round21.mjs technique). */
const PAD_INIT = id => {
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  window.__pad = { id, index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0],
    vibrationActuator: { type: 'dual-rumble', playEffect: () => Promise.resolve('complete') } };
  navigator.getGamepads = () => [window.__pad, null, null, null];
};
const PAD_IDS = ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'];
const PB = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
/** Waits at least `ms` AND `n` animation frames (the game polls the pad once per frame; 1–5 fps here). */
const frames = (pg, n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(r, Math.max(ms, 6000)); }), [n, ms]).catch(() => {});
async function padPress(pg, i, ms = 150) {
  await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = true; b.value = 1; window.__pad.timestamp++; }, i).catch(() => {});
  await frames(pg, 2, ms);
  await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = false; b.value = 0; window.__pad.timestamp++; }, i).catch(() => {});
  await frames(pg, 2, 100);
}
async function padStick(pg, axes, ms) {
  await pg.evaluate(a => { window.__pad.axes = a; window.__pad.timestamp++; }, axes).catch(() => {});
  await frames(pg, 3, ms);
  await pg.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; window.__pad.timestamp++; }).catch(() => {});
  await frames(pg, 2, 80);
}

async function openPage(browser, vp, run, storage, name = 'A', opts = {}) {
  const phone = vp.h < 500;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  // nothing leaves the machine (Google sign-in, LINE share, fonts from a CDN…)
  const local = new globalThis.URL(URL).host;
  await ctx.route('**/*', r => { try { const h = new globalThis.URL(r.request().url()).host; return h === local || r.request().url().startsWith('data:') ? r.continue() : r.abort(); } catch { return r.abort(); } });
  let pg = null;
  ctx.on('page', p => { if (pg && p !== pg) void p.close().catch(() => {}); });
  if (opts.routes) await opts.routes(ctx);
  if (opts.pad) await ctx.addInitScript(PAD_INIT, opts.pad);
  await ctx.addInitScript(INIT);
  await ctx.addInitScript(`window.__mkF = { PROBE: ${PROBE}, CANDS: ${CANDS}, REACH: ${REACH}, HUDLAY: ${HUDLAY}, QTEBOX: ${QTEBOX} };`);
  await ctx.addInitScript(ls => { if (!sessionStorage.getItem('__mkInit')) { sessionStorage.setItem('__mkInit', '1'); localStorage.clear(); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); } }, storage);
  pg = await ctx.newPage();
  run.shoot = name => pg.screenshot({ path: `${OUT}/shot-${run.vp}-${name}.png`, timeout: 20000 }).catch(() => {});
  const P = { ctx, pg, name, phone, pad: !!opts.pad, w: { rafAt: Date.now(), raf: -1, lastAt: Date.now(), last: -1, snapAt: Date.now(), snapT: null, blankAt: 0, noCtlAt: 0, hud: new Map(), escTried: 0 } };
  pg.on('pageerror', e => report(run, 'pageerror', `${name}: ${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`));
  pg.on('console', m => { if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) report(run, 'console-error', `${name}: ${m.text()}`); });
  pg.on('crash', () => report(run, 'page-crash', name));
  await pg.goto(URL);
  await pg.waitForSelector('#ui .card, #ui .screen', { timeout: 30000 }).catch(() => report(run, 'blank', `${name}: menu never appeared`));
  return P;
}

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'Space', 'KeyQ', 'KeyR', 'KeyX', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'KeyB', 'Escape', 'Enter', 'KeyT', 'KeyV', 'KeyK', 'Tab'];
const TEXTS = ['', 'ABCDE', 'ab12', '阿明', '<img src=x onerror=alert(1)>', 'x'.repeat(60), '  ', '😀😀', 'FUC-0000-JUNK', '{"a":1}'];

/** One random action. `bias` adjusts weights per scenario. */
async function act(P, run, rng, bias = {}) {
  const { pg } = P;
  const s = P.state ?? await pg.evaluate(PROBE).catch(() => null);
  P.state = null;
  if (!s) return;
  const log = t => note(run, `${P.name}#${run.step} ${t}`);
  // scenario-specific actions (debug spawns, the exact-change prompt…) get first say
  if (bias.extra && await bias.extra(P, run, rng, s, log)) return;
  if (P.pad && rng.chance(bias.pad ?? 0)) { await padAct(P, run, rng, s, log); return; }
  // solo shifts: sometimes fast-forward the in-page simulation to the end of the day / shift (test hook)
  if (s.inGame && s.solo && s.overlay === 'none' && rng.chance(bias.warp ?? 0.02)) {
    log('warp to end of phase');
    await pg.evaluate(() => { const r = window.__game?.conn?.room; if (!r?.world) return; const w = r.world; w.phaseLeft = Math.min(w.phaseLeft, 0.5); for (let i = 0; i < 40; i++) r.update(0.05); }).catch(e => report(run, 'warp-error', String(e)));
    return;
  }
  const gameFree = s.inGame && s.overlay === 'none' && s.uiEmpty;
  if (gameFree && !rng.chance(bias.hudClick ?? 0.06)) {
    const r = rng.next();
    if (r < 0.06 && P.phone) {
      const c = (await pg.evaluate(CANDS)).filter(c => c.hud);
      if (c.length) { const t = rng.pick(c); log(`tap ${t.key}`); await pg.locator(`[data-mk="${t.i}"]`).tap({ timeout: 1500 }).catch(() => {}); }
      return;
    }
    if (r < 0.2) { // mouse look / click
      const x = rng.int(0, (pg.viewportSize()?.width ?? 800) - 1), y = rng.int(0, (pg.viewportSize()?.height ?? 600) - 1);
      log(`mouse ${x},${y}`);
      await pg.mouse.move(x, y, { steps: 3 });
      if (rng.chance(0.4)) { const b = rng.pick(['left', 'left', 'right', 'middle']); log(`click ${b}`); await pg.mouse.click(x, y, { button: b }).catch(() => {}); }
      return;
    }
    let key = rng.pick(KEYS);
    if (key === 'Escape' && rng.chance(0.6)) key = 'KeyW';
    const hold = /Key[WASD]/.test(key) ? rng.int(150, 1400) : rng.int(20, 120);
    const run_ = /Key[WASD]/.test(key) && rng.chance(0.3);
    log(`key ${run_ ? 'Shift+' : ''}${key} ${hold}ms`);
    if (run_) await pg.keyboard.down('ShiftLeft');
    await pg.keyboard.down(key); await pg.waitForTimeout(hold); await pg.keyboard.up(key);
    if (run_) await pg.keyboard.up('ShiftLeft');
    if (key === 'KeyT' && rng.chance(0.7)) { // emote wheel: point and send / cancel
      await pg.mouse.move(rng.int(100, 700), rng.int(80, 350), { steps: 2 });
      const k2 = rng.pick(['KeyT', 'Escape', 'Digit3']); log(`wheel ${k2}`); await pg.keyboard.press(k2);
    }
    return;
  }
  // menus / overlays
  const r = rng.next();
  if (r < (bias.esc ?? 0.07)) { log('Escape'); await pg.keyboard.press('Escape'); return; }
  if (r < (bias.esc ?? 0.07) + 0.02) { log('Enter'); await pg.keyboard.press('Enter'); return; }
  const cands = await pg.evaluate(CANDS).catch(() => []);
  if (!cands.length) return;
  const avoid = bias.avoid ?? /^$/;
  const weights = cands.map(c => {
    let w = 1 / (1 + (run.visits.get(c.key) ?? 0));
    if (avoid.test(c.key) || avoid.test(c.text)) w *= 0.08;
    if (bias.prefer && (bias.prefer.test(c.key) || bias.prefer.test(c.text))) w *= 6;
    return w;
  });
  let t = rng.next() * weights.reduce((a, b) => a + b, 0), c = cands[0];
  for (let i = 0; i < cands.length; i++) { t -= weights[i]; if (t <= 0) { c = cands[i]; break; } }
  run.visits.set(c.key, (run.visits.get(c.key) ?? 0) + 1);
  const loc = pg.locator(`[data-mk="${c.i}"]`);
  try {
    if (c.tag === 'SELECT') {
      const vals = await loc.evaluate(el => [...el.options].filter(o => !o.disabled).map(o => o.value));
      const v = rng.pick(vals); log(`select ${c.key}=${v}`); await loc.selectOption(v, { timeout: 1500 });
    } else if (c.tag === 'INPUT' && c.type === 'range') {
      const v = rng.next(); log(`range ${c.key}=${v.toFixed(2)}`);
      await loc.evaluate((el, v) => { const lo = +el.min || 0, hi = +el.max || 1; el.value = String(lo + (hi - lo) * v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    } else if ((c.tag === 'INPUT' && (c.type === 'text' || c.type === '' || c.type === 'search')) || c.tag === 'TEXTAREA') {
      if (await loc.evaluate(el => el.readOnly)) { log(`focus ${c.key}`); await loc.focus(); return; }
      const v = bias.text && rng.chance(0.6) ? bias.text() : rng.pick(TEXTS); log(`fill ${c.key}="${v.slice(0, 20)}"`);
      await loc.fill(v, { timeout: 1500 });
      if (rng.chance(0.5)) await loc.press(rng.pick(['Enter', 'Tab']), { timeout: 1500 });
    } else {
      log(`click ${c.key} "${c.text.slice(0, 16)}"`);
      if (P.phone && rng.chance(0.5)) await loc.tap({ timeout: 2500 });
      else await loc.click({ timeout: 2500 });
    }
  } catch (e) {
    const m = String(e.message ?? e);
    if (/intercepts pointer events/.test(m)) {
      const by = (m.match(/<([^>]{1,120})>[^<]*intercepts pointer events/) ?? [])[1] ?? '?';
      // a control covered for good (not by the next screen fading in) is a layout bug: re-check once after a moment
      await pg.waitForTimeout(400);
      const still = await loc.click({ timeout: 800, trial: true }).then(() => false, () => true);
      // Playwright also gives up on controls that keep moving on a 1–5 fps software renderer: count it only when the
      // browser's own hit test at the control's centre lands on something else
      const hit = still && (await loc.count()) ? await loc.evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !h || el.contains(h) ? '' : (h.id ? '#' + h.id : h.tagName.toLowerCase() + '.' + h.className); }).catch(() => '') : '';
      if (hit) report(run, 'covered-control', `${c.key} "${c.text.slice(0, 20)}" covered by ${hit} <${by.slice(0, 60)}> (s=${s.uiHead})`);
    } else if (/outside of the viewport/.test(m)) report(run, 'unreachable-control', `${c.key} "${c.text.slice(0, 20)}" outside of the viewport (s=${s.uiHead})`);
    // detached / re-rendered elements are normal while screens change
  }
}

/** One random controller input: menus (D-pad / A / B / LB / RB / stick) or a shift (sticks, buttons, View wheel). */
async function padAct(P, run, rng, s, log) {
  const { pg } = P;
  if (rng.chance(0.05)) { const id = rng.pick(PAD_IDS); await pg.evaluate(id => { window.__pad.id = id; }, id).catch(() => {}); }
  const inShift = s.inGame && s.uiEmpty && s.overlay === 'none';
  if (inShift) {
    const r = rng.next();
    if (r < 0.3) { const a = [rng.next() * 2 - 1, rng.next() * 2 - 1, 0, 0]; const ms = rng.int(200, 1500); log(`pad L-stick ${a.slice(0, 2).map(v => v.toFixed(1))} ${ms}ms`); await padStick(pg, a, ms); return; }
    if (r < 0.42) { const a = [0, 0, rng.next() * 2 - 1, rng.next() * 2 - 1]; log('pad R-stick'); await padStick(pg, a, rng.int(150, 700)); return; }
    if (r < 0.5) { // emote wheel: hold View, point, let go (or B to cancel)
      log('pad View wheel');
      await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = true; b.value = 1; }, PB.VIEW).catch(() => {});
      await frames(pg, 2, 200);
      await padStick(pg, [rng.next() * 2 - 1, rng.next() * 2 - 1, 0, 0], 300);
      if (rng.chance(0.3)) await padPress(pg, PB.B);
      await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = false; b.value = 0; }, PB.VIEW).catch(() => {});
      await frames(pg, 2, 100);
      return;
    }
    const b = rng.pick(['A', 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'START']);
    const ms = b === 'A' && rng.chance(0.3) ? rng.int(600, 2500) : rng.int(80, 200);
    log(`pad ${b} ${ms}ms`); await padPress(pg, PB[b], ms); return;
  }
  const b = rng.pick(['UP', 'DOWN', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'A', 'A', 'B', 'LB', 'RB', 'START', 'stick']);
  if (b === 'stick') { log('pad menu stick'); await padStick(pg, [rng.pick([-1, 0, 1]), rng.pick([-1, 0, 1]), 0, 0], 250); return; }
  log(`pad ${b}`);
  const before = s.uiHead;
  await padPress(pg, PB[b]);
  if (/UP|DOWN|LEFT|RIGHT/.test(b) && !s.uiEmpty && s.n > 0) {
    // the D-pad on a menu with controls must leave a visible focus ring somewhere the pad can press
    const FOC = () => { const a = document.activeElement; return { f: !!document.querySelector('.padfocus') || (!!a && a !== document.body), head: (document.querySelector('#ui .card h2')?.textContent ?? '').trim().slice(0, 40) }; };
    let f = await pg.evaluate(FOC).catch(() => null);
    if (f && !f.f) { await frames(pg, 2, 400); f = await pg.evaluate(FOC).catch(() => null); } // (a screen still changing over)
    if (f && !f.f && f.head === before) report(run, 'pad-no-focus', `${P.name}: D-pad on "${s.uiHead}" left no focused control`);
  }
  if (b === 'B') {
    const after = await pg.evaluate(() => (document.querySelector('#ui .card h2')?.textContent ?? '').trim().slice(0, 40)).catch(() => before);
    P.bSame = after === before && before ? (P.bSame ?? 0) + 1 : 0;
    if (P.bSame >= 4) { report(run, 'pad-b-noop', `${P.name}: B pressed 4× on "${before}" without leaving it`); P.bSame = 0; }
  }
}

/** Health checks after each action. */
async function check(P, run) {
  const { pg, w } = P;
  const s = await pg.evaluate(full => { const f = window.__mkF; const s = f.PROBE(); s.n = s.uiEmpty ? 0 : f.CANDS().filter(c => !c.hud).length; if (s.inGame && s.uiEmpty && s.hudOn) { s.lay = f.HUDLAY(); s.qte = f.QTEBOX(); } if (full && !s.uiEmpty) s.reach = f.REACH(); return s; }, run.step % 4 === 0).catch(e => { if (!/Execution context was destroyed|navigation/.test(String(e))) report(run, 'probe-failed', `${P.name}: ${String(e).slice(0, 200)}`); return null; });
  if (!s) return null;
  P.state = s;
  const now = Date.now();
  for (const r of s.rej) report(run, 'unhandled-rejection', `${P.name}: ${r.split('\n').slice(0, 3).join(' | ')}`);
  for (const b of s.badText) report(run, 'bad-text', `${P.name}: ${b}`);
  if (s.hOverflow > 2) report(run, 'h-overflow', `${P.name}: page ${s.hOverflow}px wider than the viewport (s=${s.uiHead || (s.inGame ? 'game' : '?')})`);
  // render loop
  if (s.raf !== w.raf) { w.raf = s.raf; w.rafAt = now; } else if (!s.hidden && now - w.rafAt > 10000) report(run, 'frozen-raf', `${P.name}: no animation frame for ${Math.round((now - w.rafAt) / 1000)} s`);
  // game loop: Game.last advances every rendered frame; the snapshot time advances while the shift runs and isn't paused
  if (s.inGame) {
    if (s.last !== w.last) { w.last = s.last; w.lastAt = now; } else if (!s.hidden && now - w.lastAt > 10000) report(run, 'frozen-game-loop', `${P.name}: Game.frame not run for ${Math.round((now - w.lastAt) / 1000)} s (overlay=${s.overlay})`);
    const running = s.overlay === 'none' && s.uiEmpty && (s.status === 'online' || s.solo) && s.phase !== 'summary' && s.phase !== 'over';
    if (s.snapT !== w.snapT || !running) { w.snapT = s.snapT; w.snapAt = now; } else if (now - w.snapAt > 12000) report(run, 'frozen-sim', `${P.name}: snapshot time stuck for ${Math.round((now - w.snapAt) / 1000)} s (phase=${s.phase}, status=${s.status})`);
  } else { w.lastAt = now; w.snapAt = now; w.last = -1; }
  // blank screen: no menu and no running game
  if (s.uiEmpty && !s.inGame) { if (!w.blankAt) w.blankAt = now; else if (now - w.blankAt > (s.gameExists && !s.destroyed ? 30000 : 6000)) report(run, 'blank-screen', `${P.name}: nothing on screen for ${Math.round((now - w.blankAt) / 1000)} s`); }
  else w.blankAt = 0;
  // soft-lock: something in the menu layer, but no usable control (and Esc doesn't change it)
  if (!s.uiEmpty) {
    if (s.n === 0) {
      if (!w.noCtlAt) w.noCtlAt = now;
      const limit = s.loading ? 30000 : 4000;
      if (now - w.noCtlAt > limit) {
        const before = s.uiHead;
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(1500);
        const after = await pg.evaluate(PROBE).catch(() => null);
        const n2 = (await pg.evaluate(CANDS).catch(() => [])).filter(c => !c.hud).length;
        if (after && !after.uiEmpty && n2 === 0 && after.uiHead === before) report(run, 'soft-lock', `${P.name}: "${before}" has no usable control and Esc does nothing (${Math.round((now - w.noCtlAt) / 1000)} s)`);
        w.noCtlAt = 0;
      }
    } else w.noCtlAt = 0;
    for (const u of s.reach ?? []) report(run, 'unreachable-control', `${P.name}: ${u} (s=${s.uiHead})`);
  } else w.noCtlAt = 0;
  // HUD layout while playing (a pair counts when it shows up in two checks in a row, i.e. not a one-frame fade)
  if (s.inGame && s.uiEmpty && s.hudOn) {
    const lay = s.lay ?? { bad: [], off: [] };
    const cur = new Set([...lay.bad.map(b => 'overlap ' + b), ...lay.off.map(o => 'off-screen ' + o)]);
    // short-lived pop-ups (cards, toasts, alerts, hints) passing over other pieces for a few seconds are logged
    // separately ('hud-overlap-transient', not a failure); fixed HUD pieces / touch buttons overlapping each other are not
    const TRANSIENT = /^(introcard|arccard|toasts|alert|hintbar|captions|aftermath|phasebanner|combo|netstatus)$/;
    for (const k of cur) if (w.hud.has(k) && now - w.hud.get(k) > 900) {
      const parts = k.replace(/^(overlap|off-screen) /, '').split('×');
      report(run, k.startsWith('overlap') && parts.some(x => TRANSIENT.test(x)) ? 'hud-overlap-transient' : 'hud-layout', `${P.name}: ${k}`);
    }
    for (const q of s.qte ?? []) report(run, 'qte-layout', `${P.name}: ${q}`);
    for (const k of [...w.hud.keys()]) if (!cur.has(k)) w.hud.delete(k);
    for (const k of cur) if (!w.hud.has(k)) w.hud.set(k, now);
  }
  return s;
}

/** localStorage the game wrote must survive its own sanitizers unchanged, and a reload must keep the progress. */
async function storageCheck(P, run) {
  const { pg } = P;
  const ls = await pg.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))).catch(() => null);
  if (!ls) return;
  const diff = (a, b, path = '') => {
    if (isDeepStrictEqual(a, b)) return [];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diff(a[k], b[k], `${path}.${k}`));
    return [`${path}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`];
  };
  if (ls['fucustomer.career.v1']) {
    let raw; try { raw = JSON.parse(ls['fucustomer.career.v1']); } catch { report(run, 'storage', 'career profile is not JSON'); }
    if (raw) {
      const once = sanitizeProfile(raw), twice = sanitizeProfile(JSON.parse(JSON.stringify(once)));
      const d = diff(JSON.parse(JSON.stringify(raw)), JSON.parse(JSON.stringify(once)));
      if (d.length) report(run, 'storage-sanitize', `career profile changes on reload: ${d.slice(0, 4).join('; ')}`);
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(twice)))) report(run, 'storage-sanitize', 'sanitizeProfile is not idempotent');
    }
  }
  if (ls['fucustomer.settings.v1']) {
    let raw; try { raw = JSON.parse(ls['fucustomer.settings.v1']); } catch { report(run, 'storage', 'settings is not JSON'); }
    if (raw && Object.keys(raw).length > 10) { // (written by the game's settings screen, not our seed)
      const d = diff(raw, JSON.parse(JSON.stringify(sanitizeSettings(raw, P.phone, false)))).filter(x => !/^\.reduceMotion/.test(x));
      if (d.length) report(run, 'storage-sanitize', `settings change on reload: ${d.slice(0, 4).join('; ')}`);
    }
  }
  // reload: menu comes back, the profile keeps its level / wallet / stars
  const before = ls['fucustomer.career.v1'] ? sanitizeProfile(JSON.parse(ls['fucustomer.career.v1'])) : null;
  await pg.reload().catch(() => {});
  const okMenu = await pg.waitForSelector('#ui .card', { timeout: 30000 }).then(() => true, () => false);
  if (!okMenu) report(run, 'blank-screen', `${P.name}: nothing after reload`);
  await pg.waitForTimeout(800);
  if (before) {
    const after = await pg.evaluate(() => localStorage.getItem('fucustomer.career.v1')).catch(() => null);
    const a = after ? sanitizeProfile(JSON.parse(after)) : null;
    if (!a || a.level < before.level || a.wallet < before.wallet - 1 || Object.keys(a.stars).length < Object.keys(before.stars).length) report(run, 'storage-reload', `progress lost on reload: level ${before.level}→${a?.level}, wallet ${before.wallet}→${a?.wallet}`);
  }
}

// ---------------- scenarios ----------------
const click = (pg, sel, t = 8000) => pg.locator(sel).first().click({ timeout: t });
async function toCareer(pg) { await click(pg, '#m-career'); await pg.waitForSelector('[data-tab]', { timeout: 10000 }); }
async function tab(pg, t) { await click(pg, `[data-tab="${t}"]`); await pg.waitForTimeout(300); }

/** Runs random steps on one page until `until` (ms timestamp) or `steps` run out. */
async function walk(P, run, rng, steps, until, bias = {}) {
  for (let i = 0; i < steps && Date.now() < until; i++) {
    run.step++;
    await act(P, run, rng, bias);
    await P.pg.waitForTimeout(rng.int(60, 400));
    await check(P, run);
  }
}

// ---------------- round 30: general karens / exact-change prompt ----------------
/** Spawns one karen of `kind` now through the in-page solo room (test hook), optionally runs her to the till. */
const SPAWN = ([kind, toTill]) => {
  const r = window.__game?.conn?.room, w = r?.world;
  if (!w || w.phase !== 'open') return null;
  const keep = w.cfg;
  w.cfg = { ...keep, karens: [kind], maxKarens: 9 }; w.karenTimer = 0; w.lastKaren = '';
  r.update(0.05);
  const ramp = w.cfg; w.cfg = { ...keep, spawnEvery: ramp.spawnEvery, maxKarens: Math.max(keep.maxKarens, Math.min(ramp.maxKarens, 5)), karenEvery: ramp.karenEvery };
  const c = [...w.customers].reverse().find(c => c.kind === kind && c.leader == null && !c.resolved);
  if (!c) return null;
  if (toTill) for (let i = 0; i < 600 && c.state !== 'atRegister' && !c.resolved && w.phase === 'open'; i++) r.update(0.05);
  return { id: c.id, state: c.state };
};
/** Walks the local player up to a customer (in front of them, looking at them). */
const STAND = id => {
  const g = window.__game, w = g?.conn?.room?.world; if (!w) return false;
  const c = w.customers.find(c => c.id === id), p = [...w.players.values()][0]; if (!c || !p) return false;
  p.x = c.x; p.z = c.z + 1.2; g.pos = { x: p.x, z: p.z }; g.yaw = Math.atan2(c.x - p.x, c.z - p.z); g.pitch = -0.1;
  return true;
};
async function karenExtra(P, run, rng, s, log) {
  const { pg } = P;
  if (!(s.inGame && s.solo)) return false;
  const qte = await pg.evaluate(() => { const q = document.getElementById('qte'); return q ? q.querySelectorAll('.qte-opt').length : -1; }).catch(() => -1);
  if (qte >= 0 && rng.chance(0.6)) { // the exact-change prompt is open: answer it some way (or not)
    const how = rng.pick(P.pad ? ['pad', 'pad', 'key', 'click', 'esc', 'wait'] : P.phone ? ['tap', 'tap', 'key', 'esc', 'wait', 'pause-tap'] : ['key', 'key', 'click', 'esc', 'wait', 'other-key']);
    const i = rng.int(0, Math.max(0, qte - 1));
    log(`qte ${how} ${i}`);
    if (how === 'key') await pg.keyboard.press(`Digit${i + 1}`);
    else if (how === 'other-key') await pg.keyboard.press(rng.pick(['Digit4', 'KeyE', 'KeyF', 'Space', 'KeyQ']));
    else if (how === 'click') await pg.locator(`#qte .qte-opt >> nth=${i}`).click({ timeout: 1500 }).catch(() => {});
    else if (how === 'tap') await pg.locator(`#qte .qte-opt >> nth=${i}`).tap({ timeout: 1500 }).catch(() => {});
    else if (how === 'pause-tap') { await pg.locator('#t-menu').tap({ timeout: 1500 }).catch(() => {}); }
    else if (how === 'pad') await padPress(pg, [PB.LEFT, PB.UP, PB.RIGHT][i]);
    else if (how === 'esc') await pg.keyboard.press('Escape');
    else await pg.waitForTimeout(rng.int(500, 3000));
    return true;
  }
  if (s.overlay !== 'none' || !s.uiEmpty || s.phase !== 'open') return false;
  if (rng.chance(0.07)) {
    const kind = rng.chance(0.3) ? 'change' : rng.chance(0.7) ? rng.pick(GEN_KINDS) : rng.pick(['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'wiper']);
    const toTill = kind === 'change' ? rng.chance(0.9) : kind === 'lottery' ? rng.chance(0.6) : false;
    const c = await pg.evaluate(SPAWN, [kind, toTill]).catch(e => { report(run, 'spawn-error', String(e).slice(0, 200)); return null; });
    log(`spawn ${kind}${toTill ? ' →till' : ''} ${c ? c.state : 'none'}`);
    if (c && rng.chance(0.6)) { await pg.evaluate(STAND, c.id).catch(() => {}); log(`stand by ${c.id}`); }
    if (c && kind === 'change' && c.state === 'atRegister' && rng.chance(0.9)) {
      // open the exact-change prompt the way a player would (F / X / 次要) or straight through the game's method
      const how = P.pad ? rng.pick(['pad', 'method']) : P.phone ? rng.pick(['tap', 'method']) : rng.pick(['key', 'method']);
      log(`open qte ${how}`);
      await frames(pg, 3, 300);
      if (how === 'key') await pg.keyboard.press('KeyF');
      else if (how === 'pad') await padPress(pg, PB.X);
      else if (how === 'tap') await pg.locator('#t-alt').tap({ timeout: 1500 }).catch(() => {});
      else await pg.evaluate(id => window.__game.openChangePrompt(id), c.id).catch(e => report(run, 'qte-open-error', String(e).slice(0, 200)));
    }
    return true;
  }
  return false;
}
/** In-shift HUD check at the settings in use: the exact-change prompt must sit inside the screen and clear of the touch buttons. */
const QTEBOX = () => {
  const q = document.getElementById('qte'); if (!q) return null;
  // still popping in (the 0.25 s scale-up can take seconds of wall time at 1–5 fps): not laid out yet
  if (q.getAnimations({ subtree: true }).some(a => a.playState === 'running')) return null;
  const r = q.getBoundingClientRect(), out = [];
  if (r.width < 8 || r.height < 8) return null;
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`qte off-screen [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] in ${innerWidth}x${innerHeight}`);
  for (const b of q.querySelectorAll('.qte-opt')) {
    const br = b.getBoundingClientRect(); if (br.bottom > innerHeight + 1 || br.top < -1) out.push('qte option off-screen');
    const h = document.elementFromPoint((br.left + br.right) / 2, (br.top + br.bottom) / 2);
    if (h && !b.contains(h)) out.push(`qte option covered by ${h.id ? '#' + h.id : h.tagName.toLowerCase() + '.' + h.className}`);
  }
  return out;
};

const SCN = {
  async menu(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor(rng.pick(['fresh', 'mid', 'late', 'store']), rng));
    await walk(P, run, rng, 200, until, { avoid: /m-first|m-next|m-daily|m-weekly|data-play|map-cont|\[map=|special|s-backup/, prefer: /tab=|back|c-back|mp-back|s-ok|msg-ok|返回/, warp: 0.05, esc: 0.1 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async settings(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor(rng.pick(['fresh', 'mid']), rng));
    const { pg } = P;
    await click(pg, '#m-settings'); await pg.waitForSelector('#s-cb');
    // every option, systematically, then a layout probe at the extremes
    const opts = await pg.evaluate(() => [...document.querySelectorAll('#ui select')].map(s => ({ id: s.id, vals: [...s.options].map(o => o.value) })));
    for (const o of opts) for (const v of o.vals) { run.step++; note(run, `select #${o.id}=${v}`); await pg.selectOption('#' + o.id, v); await check(P, run); }
    for (const id of await pg.evaluate(() => [...document.querySelectorAll('#ui input[type=checkbox]')].map(c => c.id).filter(Boolean))) {
      if (id === 's-full') continue;
      for (let k = 0; k < 2; k++) { run.step++; note(run, `toggle #${id}`); await pg.locator('#' + id).click({ timeout: 2000 }).catch(e => report(run, 'unreachable-control', `#${id}: ${String(e.message).split('\n')[0]}`)); await check(P, run); }
    }
    await pg.selectOption('#s-text', '1.3'); await pg.selectOption('#s-cb', rng.pick(['rg', 'by']));
    for (const u of await pg.evaluate(REACH)) report(run, 'unreachable-control', `settings at 130%: ${u}`);
    await pg.locator('#s-ok').click({ timeout: 3000 }).catch(e => report(run, 'unreachable-control', `#s-ok at 130%: ${String(e.message).split('\n')[0]}`));
    await pg.waitForTimeout(300);
    for (const u of await pg.evaluate(REACH)) report(run, 'unreachable-control', `main menu at 130%: ${u}`);
    await walk(P, run, rng, 80, until, { prefer: /m-settings|s-|data-tab/, avoid: /m-first|m-next|m-daily|m-weekly|data-play|m-mp|m-create/ });
    await storageCheck(P, run); await P.ctx.close();
  },
  async shop(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor('late', rng));
    await toCareer(P.pg); await tab(P.pg, 'shop');
    await walk(P, run, rng, 160, until, { avoid: /c-back|data-play|tab=free|tab=chapters/, prefer: /buy|equip|shop|filter|pack|cos|tab=gear|tab=skills/ });
    await storageCheck(P, run); await P.ctx.close();
  },
  async freeplay(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor(rng.pick(['mid', 'late']), rng));
    const { pg } = P;
    await toCareer(pg); await tab(pg, 'free');
    await pg.waitForSelector('[data-map]', { timeout: 10000 });
    if (rng.chance(0.4)) { const h = await pg.$$('[data-hire]'); if (h.length) await rng.pick(h).click().catch(() => {}); }
    const maps = await pg.$$eval('[data-map]', b => b.map(x => x.dataset.map));
    const m = rng.pick(maps); note(run, `free play ${m}`);
    await click(pg, `[data-map="${m}"]`);
    await pg.waitForFunction(() => window.__game?.started, null, { timeout: 40000 }).catch(() => report(run, 'start-timeout', `free play ${m} did not start`));
    await walk(P, run, rng, 400, until, { avoid: /p-leave|p-end|mp-back|c-back/, prefer: /sum-ready|buy|up-|p-resume|msg-ok/, warp: 0.025 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async story(browser, vp, run, rng, until) {
    const kind = rng.pick(['fresh', 'mid', 'late']);
    const P = await openPage(browser, vp, run, storageFor(kind, rng));
    const { pg } = P;
    if (kind === 'fresh') { note(run, '1-1'); await click(pg, '#m-first'); }
    else {
      await toCareer(pg);
      const ids = await pg.$$eval('[data-play]:not([disabled])', b => b.map(x => x.dataset.play));
      const id = kind === 'mid' ? (ids.includes('1-2') && rng.chance(0.5) ? '1-2' : rng.pick(ids)) : rng.pick(ids);
      note(run, `shift ${id}`); await click(pg, `[data-play="${id}"]`);
    }
    await walk(P, run, rng, 400, until, { avoid: /p-leave|c-back|m-mp/, prefer: /sc-skip|sc-next|msg-ok|p-resume|r-next|r-retry|court|data-play/, warp: 0.02 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async challenge(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor('late', rng));
    const { pg } = P;
    const which = rng.pick(['daily', 'weekly', 'special']); note(run, which);
    if (which === 'daily') await click(pg, '#m-daily');
    else if (which === 'weekly') await click(pg, '#m-weekly');
    else { await toCareer(pg); await tab(pg, 'free'); const sp = await pg.$$eval('[data-special]', b => b.map(x => x.dataset.special)); if (sp.length) await click(pg, `[data-special="${rng.pick(sp)}"]`); else report(run, 'missing', 'no 特殊營業日 rows for a late profile'); }
    await walk(P, run, rng, 400, until, { avoid: /p-leave|c-back/, prefer: /sc-skip|msg-ok|p-resume|r-/, warp: 0.03 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async ownstore(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor('store', rng));
    const { pg } = P;
    await toCareer(pg); await tab(pg, 'store');
    await walk(P, run, rng, 400, until, { avoid: /c-back|p-leave|close|sell|tab=chapters/, prefer: /store|branch|enter|up-|sum-ready|buy|wage|hire|withdraw|lounge|msg-ok|p-resume/, warp: 0.04 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async backup(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor(rng.pick(['mid', 'late']), rng));
    const { pg } = P;
    await click(pg, '#m-settings'); await click(pg, '#s-backup'); await pg.waitForSelector('.card.bk', { timeout: 8000 }).catch(() => report(run, 'missing', 'backup screen did not open'));
    const code = await pg.evaluate(() => document.querySelector('#ui textarea, #ui input[readonly]')?.value ?? '').catch(() => '');
    const junk = () => rng.pick([code, code.slice(0, Math.max(1, code.length - 7)), code.replace(/[A-Z]/, 'x'), code + 'A', 'FUC1.' + 'A'.repeat(rng.int(1, 300)), '', '???']);
    await walk(P, run, rng, 140, until, { avoid: /m-mp|m-career|m-first|data-play/, prefer: /bk-|import|code|copy|s-backup/, text: junk });
    await storageCheck(P, run); await P.ctx.close();
  },
  async multi(browser, vp, run, rng, until) {
    const A = await openPage(browser, vp, run, storageFor('mid', rng), 'A');
    const B = await openPage(browser, vp, run, storageFor(rng.pick(['fresh', 'mid']), rng), 'B');
    let code = '';
    const create = async () => {
      await click(A.pg, '#m-mp');
      if (rng.chance(0.5)) { const l = await A.pg.$$('label.pick'); if (l.length) await rng.pick(l.slice(0, 8)).click().catch(() => {}); }
      await click(A.pg, '#m-create');
      code = await A.pg.waitForFunction(() => document.getElementById('l-code')?.textContent, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => '');
      if (!code) report(run, 'missing', 'room was not created');
    };
    const join = async () => {
      if (!code) return;
      const s = await B.pg.evaluate(PROBE).catch(() => null);
      if (!s || s.inGame || !(await B.pg.$('#m-mp'))) return;
      note(run, `B joins ${code}`);
      await click(B.pg, '#m-mp'); await B.pg.fill('#m-code', code); await click(B.pg, '#m-join');
      await B.pg.waitForSelector('#l-leave, #hud:not(.hidden)', { timeout: 20000 }).catch(() => {});
    };
    await create(); await join();
    const lobbyBias = { avoid: /l-leave|p-leave|mp-back|m-settings|data-tab|c-back|m-career/, prefer: /l-ready|l-start|l-copy|l-link|l-map|l-diff|l-bots|mkhost|kick|p-team|t-|addbot|rmbot|p-resume|sum-ready|msg-ok/, text: () => code };
    for (let i = 0; Date.now() < until && i < 600; i++) {
      run.step++;
      const P = rng.chance(0.55) ? A : B;
      await act(P, run, rng, lobbyBias);
      await P.pg.waitForTimeout(rng.int(60, 300));
      await check(A, run); await check(B, run);
      // somebody back at the main menu (kicked, room closed): host again / join again
      if (i % 8 === 0) {
        const a = await A.pg.evaluate(PROBE).catch(() => null), b = await B.pg.evaluate(PROBE).catch(() => null);
        if (a && !a.inGame && await A.pg.$('#m-mp') && !(await A.pg.$('#l-code'))) {
          if (b && (b.inGame || await B.pg.$('#l-code'))) { [A.name, B.name] = ['B', 'A']; const t = { ...A }; Object.assign(A, B); Object.assign(B, t); }
          else { note(run, 'A hosts again'); await create().catch(() => {}); }
        }
        await join().catch(() => {});
      }
    }
    await storageCheck(A, run); await A.ctx.close(); await B.ctx.close();
  },
  // ---- round 30 ----
  /** 特殊營業日 (颱風夜 / 跨年夜) from 自由營業, at a seeded 字級 / colour-blind setting. */
  async special(browser, vp, run, rng, until) {
    const set = a11ySettings(rng);
    const P = await openPage(browser, vp, run, storageFor('late', rng, set));
    const { pg } = P;
    note(run, `settings text=${set.textScale} cb=${set.colorblind}`);
    await toCareer(pg); await tab(pg, 'free');
    const sp = await pg.$$eval('[data-special]', b => b.map(x => x.dataset.special)).catch(() => []);
    if (!sp.length) { report(run, 'missing', 'no 特殊營業日 rows for a late profile'); await P.ctx.close(); return; }
    const id = rng.pick(sp); note(run, `special ${id}`);
    await click(pg, `[data-special="${id}"]`);
    await pg.waitForFunction(() => window.__game?.started || document.getElementById('sc-skip'), null, { timeout: 40000 }).catch(() => report(run, 'start-timeout', `special ${id} did not start`));
    await walk(P, run, rng, 400, until, { avoid: /p-leave|c-back|p-end/, prefer: /sc-skip|msg-ok|p-resume|r-|sum-ready/, warp: 0.02, extra: karenExtra });
    await storageCheck(P, run); await P.ctx.close();
  },
  /** The four general karens (debug spawns) in a free-play store, with the exact-change prompt on keyboard / touch. */
  async karens(browser, vp, run, rng, until) {
    const set = a11ySettings(rng);
    const P = await openPage(browser, vp, run, storageFor('late', rng, set));
    const { pg } = P;
    note(run, `settings text=${set.textScale} cb=${set.colorblind}`);
    await toCareer(pg); await tab(pg, 'free');
    await pg.waitForSelector('[data-map]', { timeout: 10000 });
    const maps = await pg.$$eval('[data-map]', b => b.map(x => x.dataset.map));
    const m = rng.pick(maps); note(run, `free play ${m}`);
    await click(pg, `[data-map="${m}"]`);
    await pg.waitForFunction(() => window.__game?.started, null, { timeout: 40000 }).catch(() => report(run, 'start-timeout', `free play ${m} did not start`));
    await pg.evaluate(() => window.__game?.send({ type: 'ready', ready: true })).catch(() => {});
    await walk(P, run, rng, 400, until, { avoid: /p-leave|p-end|mp-back|c-back/, prefer: /sum-ready|p-resume|msg-ok|qte/, warp: 0.01, extra: karenExtra });
    await storageCheck(P, run); await P.ctx.close();
  },
  /** Controller only (fake gamepad): menus → career → a shift, the exact-change prompt and the View emote wheel by pad. */
  async pad(browser, vp, run, rng, until) {
    const set = a11ySettings(rng);
    const P = await openPage(browser, vp, run, storageFor(rng.pick(['mid', 'late']), rng, set), 'A', { pad: rng.pick(PAD_IDS) });
    note(run, `settings text=${set.textScale} cb=${set.colorblind}`);
    await walk(P, run, rng, 500, until, { pad: 0.9, avoid: /m-mp|p-leave|m-friend|m-google/, prefer: /m-career|tab=free|data-map|sum-ready|p-resume/, warp: 0.015, extra: karenExtra });
    await storageCheck(P, run); await P.ctx.close();
  },
  /** 存檔備份 with a (fake) signed-in account: the cloud buttons against a server that says 401 / is offline / 500 / slow /
   *  answers with a real or a broken save. Nothing reaches a real login (the session is junk; /api/ is intercepted). */
  async cloud(browser, vp, run, rng, until) {
    const st = storageFor(rng.pick(['mid', 'late']), rng);
    st['fucustomer.account.v1'] = JSON.stringify({ no: 'FU-MONKEY-0001', session: 'junk-session-' + run.seed });
    const good = exportSaveCode(storageFor('late', rng));
    const entry = code => ({ code, at: Date.now() - rng.int(0, 9e8), size: code.length, summary: summarizeStore(storageFor('late', rng)) });
    const modes = [];
    const routes = ctx => ctx.route('**/api/**', async r => {
      const url = r.request().url();
      if (!/\/api\/cloudsave/.test(url)) return r.abort('internetdisconnected'); // (licence sync offline: keeps the fake sign-in)
      const mode = rng.pick(['real', 'abort', '500', 'slow', 'ok', 'junk', '404', '429', 'html']);
      modes.push(mode); note(run, `api ${r.request().method()} → ${mode}`);
      if (mode === 'real') return r.continue();
      if (mode === 'abort') return r.abort('internetdisconnected');
      if (mode === 'slow') { await new Promise(res => setTimeout(res, 2500)); return r.continue().catch(() => {}); }
      if (mode === '500') return r.fulfill({ status: 500, body: 'oops' });
      if (mode === 'html') return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>captive portal</html>' });
      if (mode === '404') return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: '雲端上沒有存檔' }) });
      if (mode === '429') return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: '今天上傳次數已用完' }) });
      const m = r.request().method();
      if (mode === 'junk') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m === 'GET' ? { latest: entry('FUC1-broken'), prev: null } : { what: 1 }) });
      const body = m === 'GET' ? { latest: entry(good), prev: rng.chance(0.5) ? entry(good) : null, quota: { used: 1, max: 20, resetsAt: Date.now() + 3600e3 } }
        : m === 'PUT' ? { at: Date.now(), size: 999, summary: summarizeStore(storageFor('mid', rng)), used: 2, max: 20 } : { deleted: rng.chance(0.5) };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const P = await openPage(browser, vp, run, st, 'A', { routes });
    const { pg } = P;
    await click(pg, '#m-settings'); await click(pg, '#s-backup');
    await pg.waitForSelector('#bk-up', { timeout: 8000 }).catch(() => report(run, 'missing', 'cloud buttons not shown for a signed-in profile'));
    await walk(P, run, rng, 160, until, { avoid: /m-mp|m-career|m-first|data-play|m-google|m-signout|m-quit/, prefer: /bk-up|bk-down|bk-del|bk-auto|bk-capply|bk-cprev|bk-back|s-backup/ });
    note(run, `modes ${modes.join(',')}`);
    await storageCheck(P, run); await P.ctx.close();
  },
};

// ---------------- main ----------------
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ran = [];
try {
  for (const vp of VIEWPORTS) {
    const vpName = `${vp.w}x${vp.h}`;
    const end = Date.now() + MINUTES * 60_000;
    const per = Math.max(30_000, (MINUTES * 60_000) / SCENARIOS.length);
    let k = 0;
    while (Date.now() < end) {
      const scenario = SCENARIOS[k % SCENARIOS.length];
      const seed = seed0++;
      const run = { vp: vpName, scenario, seed, step: 0, log: [], trace: [], t0: Date.now(), visits: new Map() };
      const until = Math.min(end, Date.now() + per);
      const t0 = Date.now();
      console.log(`-- ${vpName} ${scenario} seed=${seed}`);
      try { await SCN[scenario](browser, vp, run, rngOf(seed), until); }
      catch (e) { report(run, 'harness', `${String(e.message ?? e).split('\n')[0]}`); }
      try { writeFileSync(`${OUT}/trace-${vpName}-${scenario}-${seed}.log`, run.trace.join('\n') + '\n'); } catch { /* ignore */ }
      ran.push({ vp: vpName, scenario, seed, steps: run.step, s: Math.round((Date.now() - t0) / 1000) });
      k++;
    }
  }
} finally { await browser.close(); }

const out = { url: URL, minutesPerViewport: MINUTES, runs: ran, findings };
writeFileSync(`${OUT}/monkey-report.json`, JSON.stringify(out, null, 2));
console.log(`\nruns: ${ran.length}, steps: ${ran.reduce((a, r) => a + r.steps, 0)}, findings: ${findings.length} (report: ${OUT}/monkey-report.json)`);
for (const f of findings) console.log(`  ${f.kind} ×${f.count ?? 1} [${f.viewport} ${f.scenario} seed=${f.seed} step=${f.step}] ${f.detail.slice(0, 200)}`);
if (findings.some(f => !INFO_KINDS.has(f.kind))) process.exitCode = 1;
