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
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const MINUTES = Number(process.env.MONKEY_MINUTES ?? 10);
const ALL = ['menu', 'settings', 'shop', 'freeplay', 'story', 'challenge', 'ownstore', 'backup', 'multi'];
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
function storageFor(kind, rng) {
  const ls = { 'fucustomer.settings.v1': JSON.stringify(BASE_SETTINGS) };
  if (kind === 'fresh') return ls;
  ls['fucustomer.flags.v1'] = JSON.stringify({ tutorialDone: rng.chance(0.7), seenKarens: [], seenMaps: ['convenience'] });
  const prof = kind === 'mid' ? midProfile() : lateProfile(kind === 'store');
  ls['fucustomer.career.v1'] = JSON.stringify(prof);
  return ls;
}

// ---------------- findings ----------------
const findings = [];
/** Logged for a human to look at, but not a failure of the run. */
const INFO_KINDS = new Set(['hud-overlap-transient']);
const seen = new Map();
function report(ctx, kind, detail, extra = {}) {
  const sig = `${kind}|${String(detail).replace(/\d+/g, '#').slice(0, 160)}`;
  const n = (seen.get(sig) ?? 0) + 1; seen.set(sig, n);
  const f = { kind, detail: String(detail).slice(0, 600), viewport: ctx.vp, scenario: ctx.scenario, seed: ctx.seed, step: ctx.step, last: ctx.log.slice(-8), ...extra };
  if (n === 1) { findings.push(f); console.log(`FIND ${kind} [${ctx.vp} ${ctx.scenario} seed=${ctx.seed} step=${ctx.step}] ${f.detail}`); if (ctx.shoot) void ctx.shoot(`${kind}-${ctx.seed}-${ctx.step}`); }
  else if (n <= 3) console.log(`  (again) ${kind} [${ctx.scenario} seed=${ctx.seed} step=${ctx.step}]`);
  const last = findings.find(x => `${x.kind}|${x.detail.replace(/\d+/g, '#').slice(0, 160)}` === sig); if (last) last.count = n;
}

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
async function openPage(browser, vp, run, storage, name = 'A') {
  const phone = vp.h < 500;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  // nothing leaves the machine (Google sign-in, LINE share, fonts from a CDN…)
  const local = new globalThis.URL(URL).host;
  await ctx.route('**/*', r => { try { const h = new globalThis.URL(r.request().url()).host; return h === local || r.request().url().startsWith('data:') ? r.continue() : r.abort(); } catch { return r.abort(); } });
  let pg = null;
  ctx.on('page', p => { if (pg && p !== pg) void p.close().catch(() => {}); });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript(`window.__mkF = { PROBE: ${PROBE}, CANDS: ${CANDS}, REACH: ${REACH}, HUDLAY: ${HUDLAY} };`);
  await ctx.addInitScript(ls => { if (!sessionStorage.getItem('__mkInit')) { sessionStorage.setItem('__mkInit', '1'); localStorage.clear(); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); } }, storage);
  pg = await ctx.newPage();
  run.shoot = name => pg.screenshot({ path: `${OUT}/shot-${run.vp}-${name}.png`, timeout: 20000 }).catch(() => {});
  const P = { ctx, pg, name, phone, w: { rafAt: Date.now(), raf: -1, lastAt: Date.now(), last: -1, snapAt: Date.now(), snapT: null, blankAt: 0, noCtlAt: 0, hud: new Map(), escTried: 0 } };
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
  const log = t => { const l = `${P.name}#${run.step} ${t}`; run.log.push(l); run.trace.push(`${Date.now() - run.t0}ms ${l}`); if (run.log.length > 40) run.log.shift(); };
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

/** Health checks after each action. */
async function check(P, run) {
  const { pg, w } = P;
  const s = await pg.evaluate(full => { const f = window.__mkF; const s = f.PROBE(); s.n = s.uiEmpty ? 0 : f.CANDS().filter(c => !c.hud).length; if (s.inGame && s.uiEmpty && s.hudOn) s.lay = f.HUDLAY(); if (full && !s.uiEmpty) s.reach = f.REACH(); return s; }, run.step % 4 === 0).catch(e => { if (!/Execution context was destroyed|navigation/.test(String(e))) report(run, 'probe-failed', `${P.name}: ${String(e).slice(0, 200)}`); return null; });
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
    if (raw && Object.keys(raw).length > Object.keys(BASE_SETTINGS).length) {
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
    for (const o of opts) for (const v of o.vals) { run.step++; run.log.push(`select #${o.id}=${v}`); await pg.selectOption('#' + o.id, v); await check(P, run); }
    for (const id of await pg.evaluate(() => [...document.querySelectorAll('#ui input[type=checkbox]')].map(c => c.id).filter(Boolean))) {
      if (id === 's-full') continue;
      for (let k = 0; k < 2; k++) { run.step++; run.log.push(`toggle #${id}`); await pg.locator('#' + id).click({ timeout: 2000 }).catch(e => report(run, 'unreachable-control', `#${id}: ${String(e.message).split('\n')[0]}`)); await check(P, run); }
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
    const m = rng.pick(maps); run.log.push(`free play ${m}`);
    await click(pg, `[data-map="${m}"]`);
    await pg.waitForFunction(() => window.__game?.started, null, { timeout: 40000 }).catch(() => report(run, 'start-timeout', `free play ${m} did not start`));
    await walk(P, run, rng, 400, until, { avoid: /p-leave|p-end|mp-back|c-back/, prefer: /sum-ready|buy|up-|p-resume|msg-ok/, warp: 0.025 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async story(browser, vp, run, rng, until) {
    const kind = rng.pick(['fresh', 'mid', 'late']);
    const P = await openPage(browser, vp, run, storageFor(kind, rng));
    const { pg } = P;
    if (kind === 'fresh') { run.log.push('1-1'); await click(pg, '#m-first'); }
    else {
      await toCareer(pg);
      const ids = await pg.$$eval('[data-play]:not([disabled])', b => b.map(x => x.dataset.play));
      const id = kind === 'mid' ? (ids.includes('1-2') && rng.chance(0.5) ? '1-2' : rng.pick(ids)) : rng.pick(ids);
      run.log.push(`shift ${id}`); await click(pg, `[data-play="${id}"]`);
    }
    await walk(P, run, rng, 400, until, { avoid: /p-leave|c-back|m-mp/, prefer: /sc-skip|sc-next|msg-ok|p-resume|r-next|r-retry|court|data-play/, warp: 0.02 });
    await storageCheck(P, run); await P.ctx.close();
  },
  async challenge(browser, vp, run, rng, until) {
    const P = await openPage(browser, vp, run, storageFor('late', rng));
    const { pg } = P;
    const which = rng.pick(['daily', 'weekly', 'special']); run.log.push(which);
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
      run.log.push(`B joins ${code}`);
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
          else { run.log.push('A hosts again'); await create().catch(() => {}); }
        }
        await join().catch(() => {});
      }
    }
    await storageCheck(A, run); await A.ctx.close(); await B.ctx.close();
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
