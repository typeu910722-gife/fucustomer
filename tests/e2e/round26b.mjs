// Round 26b: accessibility. Turns on each option from the settings screen and checks its effect on the page:
//  色盲友善 (palette variables + body flag; stock / chaos / stamina / money bars and toasts carry a symbol or stripes too),
//  字級 130% (zoom variable; at 844x390 phone and 1280x720 the key HUD pieces don't overlap or leave the screen, the settings
//  card scrolls), 音效字幕 (a caption appears for a real in-game sound), 減少動態效果 defaults on when the OS asks
//  (prefers-reduced-motion), keyboard focus ring in menus, aria-labels on icon-only buttons, settings persist, and the new
//  controls work with a (fake, injected) gamepad's D-pad.
// Screenshots + colour-blind simulations go to $OUT (e.g. /tmp/claude-0/shots26). Automated browser checks, not a person.
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
const SET = 'fucustomer.settings.v1';

async function page(opts, settings = { quality: 'low' }) {
  const ctx = await browser.newContext(opts);
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
  await pg.goto(URL);
  await pg.evaluate(([k, s]) => { localStorage.clear(); if (s) localStorage.setItem(k, JSON.stringify(s)); }, [SET, settings]);
  await pg.reload();
  await pg.waitForSelector('#m-settings');
  return { ctx, pg };
}
/** Runs the solo store at wall-clock speed and lets a test hold it still for screenshots. */
const realtime = pg => pg.evaluate(() => {
  const c = window.__game.conn; clearInterval(c.timer); c.last = performance.now();
  c.timer = setInterval(() => { const t = performance.now(); let dt = (t - c.last) / 1000; c.last = t; if (window.__hold) return; while (dt > 0.0001) { const s = Math.min(0.05, dt); c.room.update(s); dt -= s; } }, 50);
});
async function shot(pg, path) {
  await pg.evaluate(() => { window.__hold = true; });
  await pg.screenshot({ path, timeout: 120000 });
  await pg.evaluate(() => { window.__hold = false; });
}
/** Key HUD pieces on screen, overlapping pairs, and pieces that leave the viewport. */
const overlaps = (pg, extra = []) => pg.evaluate(extra => {
  const ids = ['minimap', 'topbar', 'shiftbar', 'rightinfo', 'hintbar', 'tutskip', 'prompt', 'phasebanner', 'aftermath', 'introcard', 'alert', 'stamina', 'toasts', 'captions', 'eventstrip', 'burst',
    't-interact', 't-item', 't-alt', 't-run', 't-ping', 't-menu', 't-chat', 't-shop', 't-grab', 't-hit', 't-spin', 't-ult', ...extra];
  const boxes = [];
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue;
    const cs = getComputedStyle(el); if (el.classList.contains('hidden') || el.closest('.hidden') || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (!el.childElementCount && !el.textContent.trim() && el.tagName !== 'CANVAS' && !id.startsWith('t-') && id !== 'stamina') continue;
    // stacks (toasts, captions) are measured by what they show, not by their full-width container
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
    if (w > 4 && h > 4) bad.push(`${a.id}×${b.id} (${Math.round(w)}x${Math.round(h)})`);
  }
  const off = boxes.filter(b => b.l < -2 || b.t < -2 || b.r > innerWidth + 2 || b.b > innerHeight + 2).map(b => `${b.id}[${Math.round(b.l)},${Math.round(b.t)},${Math.round(b.r)},${Math.round(b.b)}]`);
  return { on: boxes.map(b => b.id), bad, off };
}, extra);
/** Settings: controls inside the card that overlap each other; whether the card scrolls when it doesn't fit. */
const settingsLayout = pg => pg.evaluate(() => {
  const card = document.querySelector('.card.settings');
  const els = [...card.querySelectorAll('label, h3, .btn, h2')].filter(e => e.getClientRects().length);
  const boxes = els.map(e => { const r = e.getBoundingClientRect(); return { n: (e.textContent || '').trim().slice(0, 10), l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (w > 3 && h > 3) bad.push(`${a.n}×${b.n}`);
  }
  const cr = card.getBoundingClientRect();
  const wide = boxes.filter(b => b.r > cr.right + 2 || b.l < cr.left - 2).map(b => b.n);
  return { bad, wide, fits: card.scrollHeight <= card.clientHeight + 1, scrolls: getComputedStyle(card).overflowY !== 'visible' && getComputedStyle(card).overflowY !== 'hidden', cardOnScreen: cr.top >= -1 && cr.bottom <= innerHeight + 1 && cr.left >= -1 && cr.right <= innerWidth + 1, h: card.scrollHeight, ch: card.clientHeight };
});
const sel = (pg, id, v) => pg.selectOption(`#${id}`, v);

// ---------- (1) desktop 1280x720: each option from the settings screen ----------
{
  const { ctx, pg } = await page({ viewport: { width: 1280, height: 720 } });
  check(await pg.evaluate(() => !document.body.dataset.cb && getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim() === '1' && !document.body.classList.contains('reduce-motion')), 'defaults: no palette swap, 100% text, motion on (OS has no preference)');
  // aria-labels on icon-only buttons
  const aria = await pg.evaluate(() => ['t-chat', 't-menu', 't-shop'].map(id => document.getElementById(id)?.getAttribute('aria-label') || ''));
  check(aria.every(Boolean), `icon-only touch buttons have aria-labels: ${aria.join('／')}`);
  await pg.click('#m-settings'); await pg.waitForSelector('#s-cb');
  // keyboard focus ring: Tab onto a control shows an outline (mouse clicks don't)
  await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab');
  const ring = await pg.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { tag: a.tagName, id: a.id, style: cs.outlineStyle, w: parseFloat(cs.outlineWidth), visible: a.matches(':focus-visible') }; });
  check(ring.visible && ring.style !== 'none' && ring.w >= 3, `keyboard focus shows a ring (${ring.tag}#${ring.id}: ${ring.style} ${ring.w}px)`);
  // 色盲友善: each mode swaps the variables and flags the body
  const low = {};
  for (const m of ['off', 'rg', 'by']) {
    await sel(pg, 's-cb', m);
    low[m] = await pg.evaluate(() => ({ cb: document.body.dataset.cb ?? 'off', low: getComputedStyle(document.body).getPropertyValue('--hud-low').trim(), ok: getComputedStyle(document.body).getPropertyValue('--hud-ok').trim() }));
    check(low[m].cb === m, `色盲友善 ${m}: body flag ${low[m].cb}`);
  }
  check(new Set(Object.values(low).map(v => v.low + v.ok)).size === 3, `palette differs per mode: ${JSON.stringify(low)}`);
  // 字級
  await sel(pg, 's-text', '1.3');
  const z = await pg.evaluate(() => ({ v: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(), zoom: getComputedStyle(document.getElementById('ui')).zoom, hud: getComputedStyle(document.getElementById('hud')).zoom }));
  check(z.v === '1.3' && Math.abs(Number(z.zoom) - 1.3) < 1e-6 && Math.abs(Number(z.hud) - 1.3) < 1e-6, `字級 130% zooms menus and HUD (${JSON.stringify(z)})`);
  const lay = await settingsLayout(pg);
  check(!lay.bad.length && !lay.wide.length && lay.cardOnScreen && (lay.fits || lay.scrolls), `1280x720 settings at 130%: no overlapping controls, card on screen, ${lay.fits ? 'fits' : 'scrolls'}`, JSON.stringify(lay));
  await shot(pg, `${OUT}/r26b-desktop-settings-130.png`);
  // 音效字幕
  await pg.check('#s-cap');
  check(await pg.evaluate(() => document.body.classList.contains('captions-on')), '音效字幕 on: body flag');
  await sel(pg, 's-cb', 'rg');
  await pg.click('#s-ok'); await pg.waitForSelector('#m-career');
  const saved = await pg.evaluate(k => JSON.parse(localStorage.getItem(k)), SET);
  check(saved.colorblind === 'rg' && saved.textScale === 1.3 && saved.captions === true, `settings saved: ${JSON.stringify({ colorblind: saved.colorblind, textScale: saved.textScale, captions: saved.captions })}`);
  await pg.reload(); await pg.waitForSelector('#m-career');
  check(await pg.evaluate(() => document.body.dataset.cb === 'rg' && document.body.classList.contains('captions-on') && getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim() === '1.3'), 'settings applied again after a reload');
  const menuLay = await pg.evaluate(() => { const c = document.querySelector('#ui .card'); const r = c.getBoundingClientRect(); return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), on: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1, scroll: c.scrollHeight > c.clientHeight ? getComputedStyle(c).overflowY : 'fits' }; });
  check(menuLay.on && menuLay.scroll !== 'visible', `main menu at 130%: card on screen (${menuLay.scroll})`, JSON.stringify(menuLay));

  // in a free-play day: captions for real sounds, HUD cues, no overlaps at 130%
  await pg.click('#m-career'); await pg.click('[data-tab="free"]'); await pg.click('[data-map="convenience"]');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
  await realtime(pg);
  // record every caption line shown (software rendering can be slow enough to miss a 2.6 s line between polls)
  await pg.evaluate(() => { window.__caps = []; new MutationObserver(() => { const l = document.querySelectorAll('#captions .cap'); window.__capMax = Math.max(window.__capMax ?? 0, l.length); for (const c of l) window.__caps.push(c.textContent); }).observe(document.getElementById('captions'), { childList: true, subtree: true, characterData: true }); });
  await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
  await pg.waitForFunction(() => [...document.querySelectorAll('#captions .cap')].some(c => /\[(開店音樂|門鈴)\]/.test(c.textContent)), null, { timeout: 20000 })
    .then(() => ok('a caption appears for a real in-game sound (開店／門鈴)')).catch(() => fail('no caption for the store opening / door sound'));
  const caps = await pg.evaluate(() => [...document.querySelectorAll('#captions .cap')].map(c => c.textContent));
  console.log('captions:', caps.join(' '));
  check(caps.length <= 3 && new Set(caps.map(c => c.replace(/×\d+$/, ''))).size === caps.length, 'captions are de-duplicated and at most 3 lines');
  // force a low shelf + a toast and look for the non-colour cues
  await pg.waitForFunction(() => { const w = window.__game.conn.room.world; for (const k of Object.keys(w.shelves)) w.shelves[k] = 0; return [...document.querySelectorAll('#h-stock .lvl')].some(e => e.textContent === '✖'); }, null, { timeout: 5000, polling: 100 }).catch(() => {});
  const cues = await pg.evaluate(() => ({
    lvl: [...document.querySelectorAll('#h-stock .lvl')].map(e => e.textContent).join(''),
    lowBar: document.querySelectorAll('#h-stock .bar > i.low').length,
    stripes: [...document.querySelectorAll('#h-stock .bar > i.low')].every(i => getComputedStyle(i).backgroundImage.includes('gradient')),
    ...(() => { window.__game.toast('測試成功', 'good'); window.__game.toast('測試失敗', 'bad'); const t = [...document.querySelectorAll('#toasts .toast')]; return {
      toastGood: (e => (e ? getComputedStyle(e, '::before').content : 'none'))(t.findLast(e => e.classList.contains('good'))),
      toastBad: (e => (e ? getComputedStyle(e, '::before').content : 'none'))(t.findLast(e => e.classList.contains('bad'))) }; })(),
    lowColor: (e => (e ? getComputedStyle(e).backgroundColor : 'none'))(document.querySelector('#h-stock .bar > i.low')),
    stock: document.getElementById('h-stock').innerHTML.slice(0, 300),
  }));
  check(/✖/.test(cues.lvl) && cues.lowBar >= 1 && cues.stripes, `empty / low shelves carry a symbol and stripes (${cues.lvl}, ${cues.lowBar} striped bar(s))`, cues.stock);
  check(/✔/.test(cues.toastGood) && /✖/.test(cues.toastBad), `toasts carry ✔ / ✖ (${cues.toastGood} ${cues.toastBad})`);
  check(cues.lowColor === 'rgb(230, 159, 0)', `紅綠 palette applied to the low-stock bar (${cues.lowColor})`);
  // three more sounds through the simulation's own sound events (as when a customer gets angry, the police come, a shelf crashes)
  await pg.evaluate(() => { const w = window.__game.conn.room.world; w.events.push({ e: 'sfx', name: 'angry' }, { e: 'sfx', name: 'siren' }, { e: 'sfx', name: 'angry' }); });
  await pg.waitForFunction(() => window.__caps.some(c => c.startsWith('[客人生氣]')) && window.__caps.some(c => c.startsWith('[警笛]')), null, { timeout: 8000, polling: 100 })
    .then(() => ok('captions「[客人生氣]」「[警笛]」for the sim sound events')).catch(async () => fail('no captions for angry / siren: ' + (await pg.evaluate(() => [...new Set(window.__caps)].join(' ')))));
  const dup = await pg.evaluate(() => [...new Set(window.__caps)].filter(c => c.startsWith('[客人生氣]')));
  check(dup.some(c => c === '[客人生氣]×2'), `a repeated sound refreshes its caption with a count instead of adding a line (${dup.join(' ')})`);
  check(await pg.evaluate(() => window.__capMax <= 3), `never more than 3 caption lines at once (max ${await pg.evaluate(() => window.__capMax)})`);
  await pg.waitForTimeout(300);
  const o = await overlaps(pg);
  check(o.on.some(i => i.startsWith('captions')), 'captions measured in the HUD overlap check');
  check(!o.bad.length && !o.off.length, `1280x720 HUD at 130% with captions: no overlaps / nothing off screen (${o.on.join(', ')})`, JSON.stringify(o));
  // screenshots for the colour-blind simulation (same moment in each palette): one empty, one low and one full shelf, a karen
  await pg.waitForFunction(() => {
    const g = window.__game, w = g.conn.room.world, ks = Object.keys(w.shelves);
    ks.forEach((k, i) => { w.shelves[k] = [0, 2, 9][i] ?? 9; });
    return document.querySelectorAll('#h-stock .bar > i.low').length >= 2 && document.querySelectorAll('#h-stock .bar > i.ok').length >= 1;
  }, null, { timeout: 5000, polling: 100 }).catch(() => {});
  await pg.evaluate(() => { window.__hold = true; window.__game.toast('✔ 已補貨', 'good'); window.__game.toast('客人等太久走掉了', 'bad'); });
  for (const m of ['off', 'rg', 'by']) {
    await pg.evaluate(m => { if (m === 'off') delete document.body.dataset.cb; else document.body.dataset.cb = m; }, m);
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: `${OUT}/r26b-hud-${m}.png`, timeout: 120000 });
  }
  await pg.evaluate(() => { window.__hold = false; });
  await ctx.close();
}

// ---------- (2) OS asks for reduced motion → 減少動態效果 starts on ----------
{
  const { ctx, pg } = await page({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }, null);
  check(await pg.evaluate(() => document.body.classList.contains('reduce-motion')), 'prefers-reduced-motion: reduce → 減少動態效果 on from the first launch');
  await pg.click('#m-settings'); await pg.waitForSelector('#s-rmotion');
  check(await pg.isChecked('#s-rmotion'), 'the setting shows as checked');
  await pg.uncheck('#s-rmotion');
  check(await pg.evaluate(() => !document.body.classList.contains('reduce-motion')), 'the player can still turn it off');
  await ctx.close();
}

// ---------- (3) phone 844x390 at 130%: settings scroll, first shift HUD has no overlaps ----------
{
  const { ctx, pg } = await page({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, { quality: 'low', textScale: 1.3, captions: true, colorblind: 'by' });
  await pg.waitForTimeout(500);
  const menu = await pg.evaluate(() => { const r = document.querySelector('#ui .ts .card').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); });
  check(menu[1] >= -1 && menu[3] <= 391 && menu[2] <= 845, `844x390 main menu at 130%: menu card on screen (${menu.join(',')})`);
  await pg.screenshot({ path: `${OUT}/r26b-phone-menu-130.png` });
  await pg.click('#m-settings'); await pg.waitForSelector('#s-cb');
  const lay = await settingsLayout(pg);
  check(!lay.bad.length && !lay.wide.length && lay.cardOnScreen && (lay.fits || lay.scrolls), `844x390 settings at 130%: no overlapping controls, card on screen, ${lay.fits ? 'fits' : `scrolls (${lay.h}px in ${lay.ch}px)`}`, JSON.stringify(lay));
  await pg.locator('#s-ok').scrollIntoViewIfNeeded();
  const okVis = await pg.evaluate(() => { const r = document.getElementById('s-ok').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; });
  check(okVis, '完成 button reachable by scrolling');
  await shot(pg, `${OUT}/r26b-phone-settings-130.png`);
  await pg.click('#s-ok'); await pg.waitForSelector('#m-first');
  await pg.click('#m-first');
  for (;;) {
    const st = await pg.waitForFunction(() => document.getElementById('sc-next') ? 'card' : window.__game?.started ? 'game' : null, null, { timeout: 30000 }).then(h => h.jsonValue());
    if (st !== 'card') break;
    await pg.click('#sc-next');
  }
  await realtime(pg);
  await pg.waitForTimeout(1500);
  let o = await overlaps(pg);
  check(!o.bad.length && !o.off.length, `phone first shift (prep) at 130%: no overlaps / nothing off screen (${o.on.join(', ')})`, JSON.stringify(o));
  await shot(pg, `${OUT}/r26b-phone-prep-130.png`);
  // open the store (walk to the till), let customers in, check again with captions + toasts showing
  await pg.waitForFunction(() => { const g = window.__game, tg = g.tut?.target; if (!tg) return g.snap.phase === 'open'; if (g.snap.phase === 'open') return true; const me = [...g.conn.room.world.players.values()][0]; g.pos = { x: tg.x, z: tg.z }; me.x = tg.x; me.z = tg.z; return false; }, null, { timeout: 10000, polling: 100 }).catch(() => {});
  await pg.waitForFunction(() => document.querySelectorAll('#captions .cap').length > 0, null, { timeout: 15000 }).then(() => ok('phone: captions show during the shift')).catch(() => fail('phone: no captions during the shift'));
  await pg.evaluate(() => { window.__game.toast('測試訊息', 'bad'); window.__game.conn.room.world.events.push({ e: 'sfx', name: 'angry' }, { e: 'sfx', name: 'crash' }, { e: 'sfx', name: 'siren' }); });
  await pg.waitForTimeout(300);
  o = await overlaps(pg);
  check(!o.bad.length && !o.off.length, `phone open shift at 130% with captions + toast: no overlaps / nothing off screen (${o.on.join(', ')})`, JSON.stringify(o));
  await shot(pg, `${OUT}/r26b-phone-open-130.png`);
  await ctx.close();
}

// ---------- (4) controller: the new 輔助功能 controls are reachable and work with the D-pad (fake gamepad, like round21) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    const mk = () => ({ pressed: false, touched: false, value: 0 });
    window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(URL);
  await pg.evaluate(k => { localStorage.clear(); localStorage.setItem(k, JSON.stringify({ quality: 'low', name: '手把店員' })); }, SET);
  await pg.reload(); await pg.waitForSelector('#m-settings');
  const B = { A: 0, B: 1, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const DIRS = { up: B.UP, down: B.DOWN, left: B.LEFT, right: B.RIGHT };
  const frames = (n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), [n, ms]);
  const press = async (i, ms = 150) => {
    await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = true; b.value = 1; window.__pad.timestamp++; }, i); await frames(3, ms);
    await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = false; b.value = 0; window.__pad.timestamp++; }, i); await frames(3, 120);
  };
  async function navTo(sel, max = 60) {
    let lastKey = '', stuck = 0;
    for (let n = 0; n < max; n++) {
      const st = await pg.evaluate(sel => {
        const t = document.querySelector(sel); if (!t) return { err: 'no ' + sel };
        const a = document.activeElement;
        if (a === t) return { done: true };
        if (!a || a === document.body) return { dir: 'down', key: 'none' };
        const tr = t.getBoundingClientRect(), ar = a.getBoundingClientRect();
        const sameRow = tr.top < ar.bottom && tr.bottom > ar.top, sameCol = tr.left < ar.right && tr.right > ar.left;
        const dx = tr.left + tr.width / 2 - (ar.left + ar.width / 2), dy = tr.top + tr.height / 2 - (ar.top + ar.height / 2);
        const horiz = sameRow || (!sameCol && Math.abs(dx) > Math.abs(dy) * 2);
        return { dir: horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'), alt: horiz ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left'), key: a.id + a.textContent.slice(0, 8) };
      }, sel);
      if (st.err) throw new Error(st.err);
      if (st.done) return true;
      stuck = st.key === lastKey ? stuck + 1 : 0; lastKey = st.key;
      await press(DIRS[stuck % 2 ? st.alt : st.dir]);
    }
    return false;
  }
  await press(B.DOWN); await frames(3, 200);
  if (await navTo('#m-settings')) { await press(B.A); await pg.waitForSelector('#s-cb'); await frames(3, 300); }
  const reachCb = await navTo('#s-cb').catch(() => false);
  check(reachCb, 'D-pad reaches 色盲友善');
  await press(B.RIGHT);
  check(await pg.evaluate(() => document.getElementById('s-cb').value === 'rg' && document.body.dataset.cb === 'rg'), 'D-pad → on 色盲友善 picks 紅綠 and applies it');
  const reachText = await navTo('#s-text').catch(() => false);
  await press(B.RIGHT); await press(B.RIGHT);
  check(reachText && await pg.evaluate(() => document.getElementById('s-text').value === '1.3'), 'D-pad sets 字級 to 130%');
  const reachCap = await navTo('#s-cap').catch(() => false);
  await press(B.A);
  check(reachCap && await pg.isChecked('#s-cap'), 'A toggles 音效字幕', JSON.stringify({ reachCap, focus: await pg.evaluate(() => document.activeElement?.id) }));
  const shown = await pg.evaluate(() => document.getElementById('s-cb').value);
  await press(B.B); await pg.waitForSelector('#m-career');
  const saved = await pg.evaluate(k => JSON.parse(localStorage.getItem(k)), SET);
  check(saved.colorblind === shown && shown !== 'off' && saved.textScale === 1.3 && saved.captions === true, `controller: B saves the accessibility settings (${saved.colorblind}, ${saved.textScale}, ${saved.captions})`);
  await ctx.close();
}

await browser.close();
if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | '));
console.log(process.exitCode ? 'ROUND 26b: FAILED' : 'ROUND 26b: all checks passed');
