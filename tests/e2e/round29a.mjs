// Round 29a: in-shift HUD layering on a phone. A burst of everything at once — 5 karens walking in (new ones, so the
// 新奧客 cards queue up), the 常客 card, several toasts, sound captions, the 發票對獎魔人 escort cue, a team quick-chat
// line and a story bubble — then for ~10 s, every 250 ms: no visible overlay (or HUD piece) covers a touch button or the
// interaction prompt by more than 2 px, and nothing leaves the screen. 844x390 with touch emulation (Playwright hasTouch,
// not a real phone) at 字級 100 % and 130 %, plus a 1280x720 desktop sanity pass (prompt never covered, all on screen).
// The interaction prompt is held at its worst case (three lines: action + reason + second action) by replacing the game's
// target picker in the page — the text is real game text, the target is injected so it doesn't depend on aim.
// Also: the phone 新奧客 card is short and expands on tap; cards wait in one queue (never two at once).
// Screenshots to $OUT (e.g. /tmp/claude-0/shots29). One browser, software WebGL; an automated check, not a person.
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
const KINDS = ['cutter', 'rager', 'streamer', 'hog', 'lottery'];

async function open(phone, textScale) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  const tag = `${phone ? 'phone' : 'desktop'} ${textScale * 100}%`;
  pg.on('pageerror', e => errors.push(`${tag}: ${e}`));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI|WebSocket/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await pg.goto(URL);
  await pg.evaluate(([ts, kinds]) => {
    localStorage.clear();
    const stars = {}; for (const c of [1, 2]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5, name: '阿明', captions: true, textScale: ts }));
    // the five burst karens are "new": each one brings its 新奧客 card
    const seen = ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'lottery', 'change', 'bagman', 'toilet'].filter(k => !kinds.includes(k));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: seen, seenMaps: ['convenience'] }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 8, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 10, wins: 10 }, story: ['ch1-intro', 'ch1-outro', 'ch2-intro', 'ch2-outro', 'ch3-intro'] }));
  }, [textScale, KINDS]);
  await pg.reload();
  await pg.waitForSelector('#m-career');
  await pg.click('#m-career');
  await pg.click('[data-play="2-1"]');
  await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 });
  if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 15000 });
  // the solo store at wall-clock speed (holdable for slow software screenshots)
  await pg.evaluate(() => {
    const c = window.__game.conn; clearInterval(c.timer); c.last = performance.now();
    c.timer = setInterval(() => { const t = performance.now(); let dt = (t - c.last) / 1000; c.last = t; if (window.__hold) return; while (dt > 0.0001) { const s = Math.min(0.05, dt); c.room.update(s); dt -= s; } }, 50);
  });
  return { ctx, pg, tag };
}

/** Everything at once (see the header). */
const burst = (pg, wave) => pg.evaluate(([kinds, wave]) => {
  const g = window.__game, r = g.conn.room, w = r.world;
  if (wave === 0) {
    // five karens: let the store spawn them (karen events → 新奧客 cards, alerts, stings)
    w.cfg.karens = kinds; w.cfg.maxKarens = 5; w.phaseLeft = 999;
    for (let i = 0; i < 1200 && kinds.some(k => !w.customers.some(c => c.kind === k)); i++) { w.karenTimer = 0; w.lastKaren = ''; w.cfg.karens = kinds.filter(k => !w.customers.some(c => c.kind === k)); r.update(0.05); }
    w.karenTimer = 1e9;
    for (const c of w.customers) if (c.kind !== 'normal') c.revealed = true;
    // 發票對獎魔人 on his way to the 對獎機 with nobody near him: the escort cue says 跟上
    const lot = w.customers.find(c => c.kind === 'lottery');
    if (lot) { lot.state = 'toKiosk'; lot.timer = 0; }
    // the 常客 card (the shift's regular, if any; otherwise the same card with a stand-in chapter)
    if (document.getElementById('arccard').classList.contains('hidden')) {
      const pre = { title: '常客奧客・王太太（第 2 話）', lines: [{ icon: '👵', name: '王太太', text: '上次你們店員對我很不客氣，今天我要找店長！' }, { icon: '🧑‍💼', name: '店長', text: '她來的時候先招呼她，別讓她排隊排到發火。' }] };
      try { g.showArcCard(pre); } catch { /* older build */ }
      const ac = document.getElementById('arccard');
      if (ac.classList.contains('hidden')) { ac.innerHTML = `<div class="ac-title">${pre.title}</div>` + pre.lines.map(l => `<p>${l.icon} <b>${l.name}</b>：${l.text}</p>`).join(''); ac.className = ''; }
    }
    // the interaction prompt at its worst case: three lines
    const lotId = lot?.id ?? 0;
    g.pickTarget = () => ({ label: '帶發票對獎魔人去對獎機', primary: 'escort', target: { t: 'customer', id: lotId }, reason: '跟在他旁邊走到對獎機就好', alt: 'countChange', altLabel: '陪找零計較姐數零錢' });
    // a story bubble + a teammate's quick-chat line
    try { g.bubble('🧓', '阿芬姐', '那個插隊的又來了，這次換你處理喔！', false, 0); } catch { /* ignore */ }
    w.events.push({ e: 'quick', from: '阿華', text: '我去倉庫補貨', msg: 0, id: 'bot-x' });
  }
  // toasts + sounds (captions) every wave
  g.toast(`⚠ 飲料貨架快空了（剩 2），去倉庫拿飲料貨箱 #${wave}`, 'info', 3000);
  g.toast('客人等太久走掉了（口碑 -0.1）', 'bad', 3000);
  g.toast('✔ 已補貨：零食 +12', 'good', 3000);
  g.toast('奧客退散！營業額 +$120', 'good', 3000);
  w.events.push({ e: 'sfx', name: 'angry' }, { e: 'sfx', name: 'crash' }, { e: 'sfx', name: 'siren' }, { e: 'sfx', name: 'karen' });
  return { karens: w.customers.filter(c => c.kind !== 'normal').map(c => c.kind) };
}, [KINDS, wave]);

/** Protected boxes (touch buttons, the prompt) vs every visible overlay / HUD piece; and anything off screen. */
const measure = pg => pg.evaluate(() => {
  const W = innerWidth, H = innerHeight;
  const shown = el => {
    let op = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (e.classList.contains('hidden') || cs.display === 'none' || cs.visibility === 'hidden') return false;
      op *= +cs.opacity;
    }
    return op > 0.05;
  };
  // what is actually painted: the box cut by any ancestor that clips its overflow
  const box = el => {
    const q = el.getBoundingClientRect(); let l = q.left, t = q.top, r = q.right, b = q.bottom;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) { const p = e.getBoundingClientRect(); l = Math.max(l, p.left); t = Math.max(t, p.top); r = Math.min(r, p.right); b = Math.min(b, p.bottom); }
    }
    return r - l >= 2 && b - t >= 2 ? { l, t, r, b } : null;
  };
  const name = el => el.id || `${el.parentElement?.id}>.${[...el.classList].join('.')}`;
  const prot = [];
  for (const el of document.querySelectorAll('#touch .tbtn')) if (shown(el)) { const b = box(el); if (b) prot.push({ id: el.id, ...b }); }
  const pr = document.getElementById('prompt');
  const promptOn = !!pr && pr.textContent.trim() !== '' && shown(pr);
  const sel = ['#toasts .toast', '#alert', '#hintbar', '#tutskip', '#introcard', '#arccard', '#aftermath', '#captions .cap', '#escortcue', '#qte', '#feed .feedline', '#eventstrip',
    '#stamp', '#combo', '#netstatus', '#minimap', '#rightinfo', '#shiftbar', '#topbar', '#phasebanner .btn', '#burst', '#stamina', '#progress'];
  const over = [];
  for (const s of sel) for (const el of document.querySelectorAll(s)) {
    if (!shown(el) || (!el.childElementCount && !el.textContent.trim() && el.tagName !== 'CANVAS' && el.id !== 'stamina' && el.id !== 'progress')) continue;
    const b = box(el); if (b) over.push({ id: name(el), ...b });
  }
  const bad = [];
  const hit = (a, b) => { const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t); return w > 2 && h > 2 ? `${Math.round(w)}x${Math.round(h)}` : ''; };
  let pb = null;
  if (promptOn) {
    // the prompt's painted lines (its box is as wide as its widest line)
    pb = box(pr);
    if (pb) for (const o of over) { const x = hit(pb, o); if (x) bad.push(`prompt×${o.id} ${x}`); }
    if (pb) for (const p of prot) { const x = hit(pb, p); if (x) bad.push(`prompt×${p.id} ${x}`); }
  }
  for (const p of prot) for (const o of over) { const x = hit(p, o); if (x) bad.push(`${p.id}×${o.id} ${x}`); }
  const off = [...over, ...(pb ? [{ id: 'prompt', ...pb }] : [])].filter(b => b.l < -2 || b.t < -2 || b.r > W + 2 || b.b > H + 2).map(b => `${b.id}[${[b.l, b.t, b.r, b.b].map(Math.round)}]`);
  return { bad, off, promptOn, on: over.map(o => o.id), cards: ['introcard', 'arccard'].filter(id => shown(document.getElementById(id))) };
});

async function run(phone, textScale) {
  const { ctx, pg, tag } = await open(phone, textScale);
  const k = await burst(pg, 0);
  check(k.karens.length >= 5, `${tag}: burst spawned ${k.karens.length} karens (${k.karens.join(', ')})`);
  const bad = new Map(), off = new Map();
  let samples = 0, promptSamples = 0, twoCards = 0, seen = new Set(), cardsSeen = new Set();
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    if (i === 12 || i === 24) await burst(pg, i / 12);
    const m = await measure(pg);
    samples++; if (m.promptOn) promptSamples++;
    for (const b of m.bad) bad.set(b.replace(/ \d+x\d+$/, ''), (bad.get(b.replace(/ \d+x\d+$/, '')) ?? '') || b);
    for (const o of m.off) off.set(o.replace(/\[.*$/, ''), o);
    for (const id of m.on) seen.add(id.replace(/>.*$/, '').replace(/\[.*$/, ''));
    for (const c of m.cards) cardsSeen.add(c);
    if (m.cards.length > 1) twoCards++;
    if (i === 3 || i === 14) { await pg.evaluate(() => { window.__hold = true; }); await pg.screenshot({ path: `${OUT}/r29a-${phone ? 'phone' : 'desktop'}-${textScale * 100}-${i === 3 ? 'a' : 'b'}.png`, timeout: 120000 }); await pg.evaluate(() => { window.__hold = false; }); }
    const wait = 250 - ((Date.now() - t0) % 250);
    await pg.waitForTimeout(wait);
  }
  console.log(`  ${tag}: ${samples} samples over ${((Date.now() - t0) / 1000).toFixed(1)} s, prompt on in ${promptSamples}; pieces seen: ${[...seen].join(', ')}; cards seen: ${[...cardsSeen].join(', ')}`);
  check(promptSamples >= samples * 0.8, `${tag}: the interaction prompt was on screen in ${promptSamples}/${samples} samples`);
  check(!bad.size, `${tag}: no overlay covered a touch button or the prompt (> 2 px) in any sample`, [...bad.values()].join(' | '));
  check(!off.size, `${tag}: nothing left the screen`, [...off.values()].join(' | '));
  check(!twoCards, `${tag}: never two cards at once (${twoCards} samples had both)`);
  if (phone) {
    // the 新奧客 card is short on a phone and opens on tap
    await pg.evaluate(() => {
      const g = window.__game;
      if (!document.getElementById('introcard').classList.contains('hidden')) return;
      g.flags.seenKarens = g.flags.seenKarens.filter(k => k !== 'charger'); g.introduceKaren('charger');
    });
    const card = await pg.waitForSelector('#introcard:not(.hidden)', { timeout: 15000 }).then(() => true, () => false);
    if (card) {
      await pg.waitForTimeout(500);
      const h0 = await pg.evaluate(() => document.getElementById('introcard').getBoundingClientRect().height);
      await pg.tap('#introcard').catch(() => {});
      await pg.waitForTimeout(400);
      const h1 = await pg.evaluate(() => ({ h: document.getElementById('introcard').getBoundingClientRect().height, open: document.getElementById('introcard').classList.contains('open') }));
      check(h0 <= 110 * textScale && h1.open && h1.h > h0, `${tag}: 新奧客 card short on the phone (${Math.round(h0)} px), tap opens it (${Math.round(h1.h)} px)`);
      const m = await measure(pg);
      check(!m.bad.length && !m.off.length, `${tag}: the opened card still keeps off the buttons and the prompt`, [...m.bad, ...m.off].join(' | '));
      await pg.evaluate(() => { window.__hold = true; }); await pg.screenshot({ path: `${OUT}/r29a-phone-${textScale * 100}-open.png`, timeout: 120000 }); await pg.evaluate(() => { window.__hold = false; });
    } else fail(`${tag}: no 新奧客 card for the tap test`);
    // the exact-change mini-game card (找零): on screen, off the buttons, and the stack steps aside while it is up
    const id = await pg.evaluate(() => {
      window.__hold = true;
      const g = window.__game, r = g.conn.room, w = r.world;
      const c = w.customers.find(c => !c.resolved && c.state !== 'leaving'); if (!c) return null;
      c.state = 'atRegister'; c.timer = 0;
      const every = Math.round(20 / 12);
      for (let k = 0; k < 6; k++) { c.state = 'atRegister'; r.update(0.05); if (r.tickCount % every === 0 && k > 0) break; }
      return c.id;
    });
    await pg.waitForFunction(id => window.__game.snap.customers.some(c => c.id === id && c.state === 'atRegister'), id, { timeout: 3000 }).catch(() => {});
    await pg.evaluate(id => window.__game.openChangePrompt(id), id);
    await pg.waitForTimeout(400);
    const q = await pg.evaluate(() => {
      const el = document.getElementById('qte'); if (!el) return null;
      const r = el.getBoundingClientRect();
      const btns = [...document.querySelectorAll('#touch .tbtn')].filter(b => !b.classList.contains('hidden')).map(b => ({ id: b.id, r: b.getBoundingClientRect() }));
      const clash = btns.filter(b => Math.min(r.right, b.r.right) - Math.max(r.left, b.r.left) > 2 && Math.min(r.bottom, b.r.bottom) - Math.max(r.top, b.r.top) > 2).map(b => b.id);
      return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), clash, muted: getComputedStyle(document.getElementById('hq')).visibility === 'hidden' };
    });
    check(q && !q.clash.length && q.r[0] >= 0 && q.r[1] >= 0 && q.r[2] <= 844 && q.r[3] <= 390 && q.muted, `${tag}: 找零 card [${q?.r}] on screen, clear of the buttons [${q?.clash ?? ''}], stack hidden behind it: ${q?.muted}`);
    await pg.screenshot({ path: `${OUT}/r29a-phone-${textScale * 100}-qte.png`, timeout: 120000 });
    await pg.evaluate(() => { window.__hold = false; });
  }
  await ctx.close();
}

await run(true, 1);
await run(true, 1.3);
await run(false, 1);
await browser.close();
if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | '));
console.log(process.exitCode ? 'ROUND 29a: FAILED' : 'ROUND 29a: all checks passed');
