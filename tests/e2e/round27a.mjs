// Round 27a: the four general karens (發票對獎魔人, 找零計較姐, 免費袋子阿伯, 借廁所大隊) spawned in a real solo shift through the
// same debug hooks as the other e2e tests (window.__game.conn.room = the in-page simulation) and handled through the
// real UI (aim + E / F keys, the exact-change prompt), plus the 特殊營業日 (free-play row, 颱風夜 rain, 跨年夜 midnight
// fireworks) and the 圖鑑 section. One browser, software WebGL, one machine — not a device test.
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const pg = await ctx.newPage();
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI|WebSocket/.test(m.text())) errors.push(m.text()); });
await pg.goto(URL);
await pg.evaluate(() => {
  localStorage.clear();
  const stars = {}; for (const c of [1, 2]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明', captions: true }));
  // the new karens' intro cards are left unseen except 找零計較姐 / 免費袋子阿伯 / 借廁所大隊 (only 發票對獎魔人's card shows)
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'change', 'bagman', 'toilet'], seenMaps: ['convenience'] }));
  localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 8, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 10, wins: 10 }, story: ['ch1-intro', 'ch1-outro', 'ch2-intro', 'ch2-outro', 'ch3-intro'] }));
});
await pg.reload();
await pg.waitForSelector('#m-career');

// ---------- start a shift (2-1, convenience store, level 8: no grabbing, so every karen is handled its own way) ----------
await pg.click('#m-career');
await pg.click('[data-play="2-1"]');
await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 });
if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip');
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
await pg.keyboard.press('Enter');
await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 15000 });
// keep every toast (the on-screen ones fade)
await pg.evaluate(() => { const g = window.__game, orig = g.onEvent.bind(g); window.__toastLog = []; g.onEvent = e => { if (e.e === 'toast') window.__toastLog.push(e.text); orig(e); }; });
// the solo store at wall-clock speed, holdable (window.__hold) like round28b, so a slow machine can't let a karen walk on
// while the test waits for the page to show the prompt
await pg.evaluate(() => {
  const c = window.__game.conn; clearInterval(c.timer); c.last = performance.now();
  c.timer = setInterval(() => { const t = performance.now(); let dt = (t - c.last) / 1000; c.last = t; if (window.__hold) return; while (dt > 0.0001) { const s = Math.min(0.05, dt); c.room.update(s); dt -= s; } }, 50);
});

/** Clears the store and spawns one karen of `kind` (featured, right away); returns its id (the leader for a group). */
const spawn = kind => pg.evaluate(kind => {
  const r = window.__game.conn.room, w = r.world;
  w.customers = []; w.queue = []; w.registers = [null, null]; w.spills = []; w.items = [];
  w.spawnTimer = 1e9; w.phaseLeft = 999; w.chaos = 0;
  w.cfg.karens = [kind]; w.cfg.maxKarens = 1; w.lastKaren = ''; w.karenTimer = 0;
  for (let i = 0; i < 40 && !w.customers.some(c => c.kind === kind); i++) r.update(0.05);
  const c = w.customers.find(c => c.kind === kind && c.leader == null);
  w.karenTimer = 1e9;
  return c ? c.id : null;
}, kind);
/**
 * Runs the simulation (in-page) until `pred(customer, world)` holds; returns the customer's state. With `freeze` it stops
 * on a tick that sent the page a snapshot (single player sends one every other tick) and holds the store there
 * (round28b's fastForward), so the page can show exactly that state while the test waits for the prompt.
 */
const fastForward = (id, pred, maxS = 60, freeze = false) => pg.evaluate(([id, pred, maxS, freeze]) => {
  const r = window.__game.conn.room, w = r.world, f = new Function('c', 'w', 'return ' + pred), every = Math.round(20 / 12);
  for (let i = 0; i < maxS * 20; i++) { const c = w.customers.find(x => x.id === id); if (!c || (f(c, w) && (!freeze || (i > 0 && r.tickCount % every === 0)))) break; w.phaseLeft = 999; w.chaos = 0; r.update(0.05); }
  if (freeze) window.__hold = true;
  const c = w.customers.find(x => x.id === id);
  return c ? { state: c.state, resolved: c.resolved, x: c.x, z: c.z, life: c.life } : null;
}, [id, pred, maxS, freeze]);
/** Puts the worker at (x, z) looking at the customer (both in the world and the client, like round23). */
const stand = (x, z, id, pitch = -0.12) => pg.evaluate(([x, z, id, pitch]) => {
  const g = window.__game, w = g.conn.room.world, p = [...w.players.values()][0], c = w.customers.find(c => c.id === id);
  p.x = x; p.z = z; g.pos = { x, z };
  if (c) g.yaw = Math.atan2(c.x - x, c.z - z);
  g.pitch = pitch;
}, [x, z, id, pitch]);
const prompt = () => pg.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ') ?? '');
/** Waits (up to 4 s) for the on-screen prompt to match; returns its text either way. */
const waitPrompt = async re => { await pg.waitForFunction(src => new RegExp(src).test(document.getElementById('prompt')?.innerText ?? ''), re.source, { timeout: 4000 }).catch(() => {}); return prompt(); };
const cust = id => pg.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return c ? { state: c.state, resolved: c.resolved, x: c.x, z: c.z, phase: c.phase, look: c.look, eaten: c.eaten.length, items: c.items.length } : null; }, id);
const handled = k => pg.evaluate(k => window.__game.conn.room.world.handled[k] ?? 0, k);
const frames = ms => pg.waitForTimeout(ms);

// ---------- 發票對獎魔人 ----------
{
  const id = await spawn('lottery');
  if (!id) fail('lottery did not spawn');
  await frames(400);
  const card = await pg.evaluate(() => document.getElementById('introcard')?.classList.contains('hidden') ? '' : document.getElementById('introcard')?.innerText ?? '');
  if (!/發票對獎魔人/.test(card)) fail('no intro card for 發票對獎魔人: ' + card); else ok('intro card: ' + card.replace(/\s+/g, ' ').slice(0, 60));
  await pg.screenshot({ path: `${OUT}/r27a-lottery-intro.png` });
  await frames(2300); // the solo pause for the card ends
  const st = await fastForward(id, "c.state === 'atRegister'");
  if (st?.state !== 'atRegister') fail('lottery never reached the till ' + JSON.stringify(st));
  await stand(st.x, st.z + 1.2, id, 0);
  const pr = await waitPrompt(/帶發票對獎魔人去對獎機/);
  if (!/帶發票對獎魔人去對獎機/.test(pr)) fail('prompt: ' + pr); else ok('prompt at the till: ' + pr);
  await pg.screenshot({ path: `${OUT}/r27a-lottery-till.png` });
  await pg.keyboard.press('KeyE');
  await pg.waitForFunction(id => window.__game.conn.room.world.customers.find(c => c.id === id)?.state === 'toKiosk', id, { timeout: 5000 }).then(() => ok('escorting to the 對獎機')).catch(() => fail('E did not start the escort'));
  // walk next to him
  for (let i = 0; i < 260; i++) {
    const c = await cust(id); if (!c || c.state !== 'toKiosk') break;
    await stand(c.x + 0.9, c.z + 0.4, id, -0.2);
    await frames(120);
  }
  const done = await cust(id);
  if (!done?.resolved || done.state !== 'kiosk') fail('escort did not finish ' + JSON.stringify(done)); else ok('發票對獎魔人 at the 對獎機, handled');
  await stand(4.5, 13.2, id, -0.15);
  await frames(500);
  await pg.screenshot({ path: `${OUT}/r27a-lottery-kiosk.png` });
  if (await handled('lottery') !== 1) fail('lottery not counted');
}

// ---------- 找零計較姐 (exact-change prompt) ----------
{
  const id = await spawn('change');
  const st = await fastForward(id, "c.state === 'atRegister'");
  if (st?.state !== 'atRegister') fail('change never reached the till ' + JSON.stringify(st));
  await stand(st.x, st.z + 1.2, id, 0);
  const pr = await waitPrompt(/陪找零計較姐數零錢/);
  if (!/陪找零計較姐數零錢/.test(pr)) fail('prompt: ' + pr); else ok('prompt: ' + pr);
  await pg.keyboard.press('KeyF');
  // (wall clock: a busy machine has taken 3–4 s to deliver the key and the next snapshot)
  await pg.waitForSelector('#qte', { timeout: 6000 }).then(() => ok('exact-change prompt opened')).catch(() => fail('F did not open the prompt'));
  // the prompt gives 5 s; software-GL screenshots are slow, so stretch the deadline for the test (the timeout path is unit-tested)
  const secs = await pg.evaluate(() => { const q = window.__game.qte; if (!q) return -99; const left = (q.until - performance.now()) / 1000; q.until = performance.now() + 60000; return left; });
  if (!(secs <= 5 && secs > -99)) fail('prompt time limit ' + secs); else ok(`prompt has a time limit (≤ 5 s; ${secs.toFixed(1)} s left when read)`);
  await pg.screenshot({ path: `${OUT}/r27a-change-qte.png` });
  // pick the handful that adds up to what she is owed (read from the prompt itself)
  const pick = await pg.evaluate(() => {
    const due = Number(document.querySelector('#qte .qte-title b').textContent.replace('$', ''));
    // each coin badge is followed by its count text ("×2")
    const sums = [...document.querySelectorAll('#qte .qte-opt')].map(b => [...b.querySelectorAll('.coin')].reduce((s, c) => s + Number(c.textContent) * Number((c.nextSibling?.textContent ?? '').match(/×(\d+)/)?.[1] ?? 0), 0));
    return { due, sums, idx: sums.indexOf(due) };
  });
  if (pick.idx < 0) fail('no option adds up: ' + JSON.stringify(pick)); else ok(`owed $${pick.due}, options ${pick.sums.join('/')}`);
  const rev0 = await pg.evaluate(() => window.__game.conn.room.world.dayStats.revenue);
  await pg.keyboard.press(`Digit${pick.idx + 1}`);
  await pg.waitForFunction(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return !c || c.resolved; }, id, { timeout: 4000 }).catch(() => {});
  const after = await cust(id);
  const rev1 = await pg.evaluate(() => window.__game.conn.room.world.dayStats.revenue);
  if (!after?.resolved || after.state !== 'leaving' || rev1 <= rev0) fail('exact change did not settle + pay ' + JSON.stringify(after) + ` ${rev0}→${rev1}`); else ok(`exact change: handled and paid on the spot (+$${rev1 - rev0})`);
  if (await pg.locator('#qte').count()) fail('prompt still open');
}

// ---------- 免費袋子阿伯 (only at the door) ----------
{
  const id = await spawn('bagman');
  await fastForward(id, "c.state === 'wander' && c.eaten.length >= 1", 20);
  const c0 = await cust(id);
  await stand(c0.x, c0.z + 1.2, id, 0);
  const inside = await waitPrompt(/門口/);
  if (!/門口/.test(inside)) fail('inside the store the prompt should say to wait at the door: ' + inside); else ok('inside: ' + inside);
  await pg.screenshot({ path: `${OUT}/r27a-bagman-inside.png` });
  await pg.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); c.life = 0.1; }, id);
  // (he only dawdles a few seconds at the door: the store is held there while the page catches up, the prompt is read and
  // E is taken — a busy machine used to let him walk out before E landed)
  const st = await fastForward(id, "c.state === 'toExit' && c.z > 12.8 && Math.abs(c.x - 12) < 3.2", 40, true);
  if (st?.state !== 'toExit') fail('bagman never headed out ' + JSON.stringify(st));
  await stand(st.x - 0.4, st.z - 1.3, id, -0.05);
  const atDoor = await waitPrompt(/在門口攔下/);
  if (!/在門口攔下免費袋子阿伯/.test(atDoor)) fail('door prompt: ' + atDoor); else ok('at the door: ' + atDoor);
  // E while the store is still held: the act is taken at once (the worker starts checking the bag), and only then
  // does the store run on — on a slow machine the page's next frame could come after he had already walked out
  await pg.keyboard.down('KeyE');
  await pg.waitForFunction(id => { const w = window.__game.conn.room.world; return !![...w.players.values()][0].busy || w.customers.find(c => c.id === id)?.resolved; }, id, { timeout: 4000 }).catch(() => {});
  await pg.keyboard.up('KeyE');
  // read him the moment he gives in (a watch on the store's own tick) and hold the store there: the test set his time in
  // the store to 0.1 s, so once stopped he is gone within a few ticks — a slow screenshot in between used to read nothing
  await pg.evaluate(id => {
    const r = window.__game.conn.room, up = r.update; window.__bag = null;
    r.update = function (dt) { up.call(this, dt); const c = this.world.customers.find(c => c.id === id); if (c?.resolved && !window.__bag) { window.__bag = { resolved: true, state: c.state, items: c.items.length }; window.__hold = true; this.update = up; } };
    window.__hold = false;
  }, id);
  const after = await pg.waitForFunction(() => window.__bag, null, { timeout: 4000 }).then(h => h.jsonValue(), () => cust(id));
  await pg.screenshot({ path: `${OUT}/r27a-bagman-door.png` });
  await pg.evaluate(() => { window.__hold = false; });
  if (!after?.resolved || !after.items) fail('bagman not stopped ' + JSON.stringify(after)); else ok(`stopped at the door: ${after.items} item(s) go to the till`);
}

// ---------- 借廁所大隊 (find the leader) ----------
{
  const id = await spawn('toilet');
  const group = await pg.evaluate(() => window.__game.conn.room.world.customers.filter(c => c.kind === 'toilet').map(c => ({ id: c.id, leader: c.leader ?? null, phase: c.phase })));
  if (group.length !== 3 || group.filter(g => g.phase === 2).length !== 2) fail('toilet group: ' + JSON.stringify(group)); else ok('借廁所大隊: leader + 2 followers');
  const st = await fastForward(id, "c.state === 'toilet' && w.spills.length >= 2", 40);
  if (st?.state !== 'toilet') fail('leader never reached the restroom ' + JSON.stringify(st));
  await stand(st.x + 0.3, st.z + 2.6, id, -0.18);
  await frames(600);
  await pg.screenshot({ path: `${OUT}/r27a-toilet-flood.png` });
  // (a puddle between you and him would take the crosshair first: mop them away for this check)
  await pg.evaluate(() => { const w = window.__game.conn.room.world; w.spills = []; for (const c of w.customers) if (c.kind === 'toilet' && c.leader == null) c.knockTimer = 99; });
  await stand(st.x, st.z + 1.0, id, 0.05);
  const pr = await waitPrompt(/領隊/);
  if (!/領隊/.test(pr)) fail('leader prompt: ' + pr); else ok('prompt: ' + pr);
  await pg.keyboard.press('KeyE');
  await pg.waitForFunction(() => window.__game.conn.room.world.customers.filter(c => c.kind === 'toilet').every(c => c.resolved), null, { timeout: 4000 }).catch(() => {});
  const res = await pg.evaluate(() => window.__game.conn.room.world.customers.filter(c => c.kind === 'toilet').map(c => c.resolved));
  if (!res.length || !res.every(Boolean) || await handled('toilet') !== 1) fail('group not settled via the leader ' + JSON.stringify(res)); else ok('whole group follows the leader (counted once)');
}
const log = await pg.evaluate(() => window.__toastLog.join(' | '));
for (const re of [/對獎機/, /找剛好/, /門口攔下/, /廁所限消費使用/]) if (!re.test(log)) fail('missing toast ' + re);
const caps = await pg.evaluate(() => document.getElementById('captions')?.innerText ?? '');
ok('captions seen: ' + caps.replace(/\s+/g, ' ').slice(0, 80));
await pg.evaluate(() => window.__game.exit());
await pg.waitForSelector('#m-career', { timeout: 15000 }).catch(() => {});

// ---------- 特殊營業日 in free play ----------
await pg.evaluate(() => { location.hash = ''; });
await pg.goto(URL);
await pg.waitForSelector('#m-career');
await pg.click('#m-career');
await pg.click('[data-tab="free"]');
await pg.waitForSelector('[data-special]', { timeout: 10000 }).then(() => ok('free play shows the 特殊營業日 row')).catch(() => fail('no special-day row'));
await pg.screenshot({ path: `${OUT}/r27a-freeplay-special.png` });

async function backToFree() {
  await pg.waitForFunction(() => document.querySelector('[data-tab="free"], #m-career, .card .btn'), null, { timeout: 15000 });
  if (!(await pg.locator('[data-tab="free"]').count())) { const b = pg.locator('.card .btn').first(); if (await b.count()) await b.click(); }
  if (!(await pg.locator('[data-tab="free"]').count()) && await pg.locator('#m-career').count()) await pg.click('#m-career');
  await pg.click('[data-tab="free"]');
  await pg.waitForSelector('[data-special]', { timeout: 10000 });
}
async function runSpecial(id) {
  await pg.click(`[data-special="sp-${id}"]`);
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 15000 });
  const sp = await pg.evaluate(() => window.__game.snap.shift.special);
  if (sp !== id) fail(`special ${sp} != ${id}`); else ok(`special day running: ${id}`);
}
// 颱風夜: dark sky, rain outside; look out of the door
await runSpecial('typhoon');
await pg.evaluate(() => { const g = window.__game, p = [...g.conn.room.world.players.values()][0]; p.x = 12; p.z = 12.5; g.pos = { x: 12, z: 12.5 }; g.yaw = 0; g.pitch = 0.05; });
await frames(900);
const rain = await pg.evaluate(() => { const v = window.__game.view; return { rain: !!v.rain, bg: v.scene.background.getHexString() }; });
if (!rain.rain) fail('no rain on 颱風夜'); else ok('颱風夜 rain on, sky #' + rain.bg);
await pg.screenshot({ path: `${OUT}/r27a-typhoon.png` });
await pg.evaluate(() => window.__game.exit());
await backToFree();
// 跨年夜: jump to just before midnight, run the countdown, watch the fireworks
await runSpecial('newyear');
// The page learns the shift is open from a snapshot, but #h-clock is rewritten on the next HUD frame, so reading it at
// once could still give 「準備 0:00」 (the round-29 flake): wait for the HUD to show the open-shift clock, then check it.
await pg.waitForFunction(() => /🕒/.test(document.getElementById('h-clock')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const clockStart = await pg.evaluate(() => document.getElementById('h-clock')?.textContent ?? '');
if (!/21:0/.test(clockStart)) fail('跨年夜 clock should start at 21:00: ' + clockStart); else ok('clock: ' + clockStart);
await pg.evaluate(() => {
  const g = window.__game, r = g.conn.room, w = r.world, p = [...w.players.values()][0];
  // 23:59:40 on the shift clock (21:00 → 00:30 over the shift length)
  const frac = (23 * 60 + 59.6 - 21 * 60) / 210;
  w.phaseLeft = w.cfg.length * (1 - frac); w.time = w.openTime + w.cfg.length * frac; w.chaos = 0;
  p.x = 12; p.z = 12.8; g.pos = { x: 12, z: 12.8 }; g.yaw = 0; g.pitch = 0.32;
});
await pg.waitForFunction(() => (window.__toastLog ?? []).length >= 0 && /新年快樂/.test(document.getElementById('toasts')?.innerText ?? ''), null, { timeout: 20000 }).then(() => ok('midnight: 新年快樂 toast')).catch(() => fail('no midnight toast'));
await frames(900);
const fw = await pg.evaluate(() => ({ sparks: window.__game.view.sparks.length, clock: document.getElementById('h-clock')?.textContent ?? '' }));
if (!fw.sparks) fail('no fireworks particles'); else ok(`fireworks: ${fw.sparks} sparks, clock ${fw.clock}`);
if (!/00:0/.test(fw.clock)) fail('clock after midnight should read 00:0x: ' + fw.clock);
await pg.screenshot({ path: `${OUT}/r27a-newyear-fireworks.png` });
await pg.evaluate(() => window.__game.exit());
await pg.waitForTimeout(800);

// ---------- 圖鑑: the new section ----------
await pg.evaluate(() => { const p = JSON.parse(localStorage.getItem('fucustomer.career.v1')); p.dex = { ...(p.dex ?? {}), lottery: 1, toilet: 2 }; localStorage.setItem('fucustomer.career.v1', JSON.stringify(p)); });
await pg.goto(URL);
await pg.waitForSelector('#m-career');
await pg.click('#m-career');
await pg.click('[data-tab="achievements"]');
await pg.click('[data-dex="dex"], [data-tab="dex"], .dexswitch button:last-child').catch(() => {});
await pg.waitForFunction(() => /到處都有的新奧客/.test(document.body.innerText), null, { timeout: 5000 }).then(() => ok('圖鑑 has the general-karen section')).catch(() => fail('no general-karen section in the 圖鑑'));
const dexTxt = await pg.evaluate(() => document.body.innerText);
if (!/發票對獎魔人/.test(dexTxt) || !/借廁所大隊/.test(dexTxt)) fail('圖鑑 entries missing'); else ok('圖鑑 entries unlocked for handled kinds');
await pg.evaluate(() => document.querySelector('h3:last-of-type')?.scrollIntoView());
await pg.screenshot({ path: `${OUT}/r27a-dex.png` });

await ctx.close();
await browser.close();
if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | ')); else ok('no page errors');
