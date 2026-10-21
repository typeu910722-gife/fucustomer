// Round 28b: the four general karens on every input device.
//  (A) desktop 1280x720 with a FAKE standard-mapping gamepad (navigator.getGamepads replaced in the page, the round21
//      technique — NOT a real controller): the interaction prompts of 發票對獎魔人 / 找零計較姐 / 免費袋子阿伯 / 借廁所大隊
//      show the keyboard key, the Xbox glyph and the PlayStation glyph as the player switches device; the exact-change
//      prompt is opened with X and answered with the D-pad (glyph badges + timer shown; the stick / D-pad do nothing else
//      while it is open); the 發票對獎魔人 escort cue.
//  (B) phone 844x390 with touch emulation (Playwright hasTouch — emulated, not a real phone): touch button labels in the
//      prompts and on the buttons, the exact-change prompt opened with the on-screen 次要 button and answered by tapping
//      (≥ 48 px targets that sit clear of the joystick corner and the action buttons), the escort cue readable.
// One browser, software WebGL, solo shift (the simulation runs in the page) — not a device test.
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
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const XBOX_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
const PS_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

async function open(phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
  if (!phone) await ctx.addInitScript(id => {
    const mk = () => ({ pressed: false, touched: false, value: 0 });
    window.__pad = { id, index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  }, XBOX_ID);
  const pg = await ctx.newPage();
  const tag = phone ? 'phone' : 'desktop';
  pg.on('pageerror', e => errors.push(`${tag}: ${e}`));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI|WebSocket/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await pg.goto(URL);
  await pg.evaluate(() => {
    localStorage.clear();
    const stars = {}; for (const c of [1, 2]) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '阿明', captions: true }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'lottery', 'change', 'bagman', 'toilet'], seenMaps: ['convenience'] }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 8, wallet: 500, stars, clears: { ...stars }, stats: { shifts: 10, wins: 10 }, story: ['ch1-intro', 'ch1-outro', 'ch2-intro', 'ch2-outro', 'ch3-intro'] }));
  });
  await pg.reload();
  await pg.waitForSelector('#m-career');
  await pg.click('#m-career');
  await pg.click('[data-play="2-1"]');
  await pg.waitForFunction(() => document.getElementById('sc-skip') || window.__game?.started, null, { timeout: 30000 });
  if (await pg.locator('#sc-skip').count()) await pg.click('#sc-skip');
  await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
  await pg.evaluate(() => window.__game.send({ type: 'ready', ready: true }));
  await pg.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 15000 });
  // the solo store at wall-clock speed, and holdable (window.__hold) so slow software screenshots / device switches don't let it run on
  await pg.evaluate(() => {
    const c = window.__game.conn; clearInterval(c.timer); c.last = performance.now();
    c.timer = setInterval(() => { const t = performance.now(); let dt = (t - c.last) / 1000; c.last = t; if (window.__hold) return; while (dt > 0.0001) { const s = Math.min(0.05, dt); c.room.update(s); dt -= s; } }, 50);
    const g = window.__game, orig = g.send.bind(g); window.__sent = []; g.send = m => { window.__sent.push(m.type === 'act' ? `act:${m.kind}` : m.type); orig(m); };
  });
  return { ctx, pg };
}

function helpers(pg) {
  const frames = (n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), [n, ms]);
  const hold = on => pg.evaluate(on => { window.__hold = on; }, on);
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
   * Runs the store until `pred` holds for the karen, then FREEZES it (window.__hold = true; the caller lets it run
   * again — chips() does). The store only sends the page a snapshot every other tick (TICK_RATE 20 / SNAPSHOT_RATE 12),
   * so it stops on a tick that sent one: the page must SEE the state the test then reads the prompt for. (Stopping on
   * the in-between tick and holding left the page on the previous snapshot — "他還在挑…", the 阿伯 not at the door yet,
   * the 廁所 leader still walking so a member was nearer — whenever the wall-clock timer happened not to fire first.)
   */
  const fastForward = (id, pred, maxS = 60) => pg.evaluate(([id, pred, maxS]) => {
    const r = window.__game.conn.room, w = r.world, f = new Function('c', 'w', 'return ' + pred);
    const every = Math.round(20 / 12);
    for (let i = 0; i < maxS * 20; i++) {
      const c = w.customers.find(x => x.id === id);
      if (!c || (f(c, w) && i > 0 && r.tickCount % every === 0)) break;
      w.phaseLeft = 999; w.chaos = 0; r.update(0.05);
    }
    window.__hold = true;
    const c = w.customers.find(x => x.id === id);
    return c ? { state: c.state, resolved: c.resolved, x: c.x, z: c.z } : null;
  }, [id, pred, maxS]);
  /** Freezes the running store on a tick that sent the page a snapshot (so what the page shows is what the store has). */
  const holdSynced = () => pg.evaluate(() => {
    const r = window.__game.conn.room, every = Math.round(20 / 12);
    window.__hold = true;
    for (let k = 0; k < 4; k++) { r.update(0.05); if (r.tickCount % every === 0) break; }
  });
  /**
   * Like a player looking before pressing: waits until the page's own snapshot has the karen in the state the prompt is
   * for (`pred` over the snapshot's customer) and every customer is drawn where the snapshot has them (the prompt aims
   * at the drawn figure), so the right one is under the crosshair.
   */
  const seen = (id, pred, what) => pg.waitForFunction(([id, pred]) => {
    const g = window.__game, f = new Function('c', 'return ' + pred);
    const sc = g.snap?.customers.find(c => c.id === id);
    if (!sc || !f(sc)) return false;
    return g.snap.customers.every(c => { const p = g.view.customerWorldPos(c.id); return !p || Math.hypot(p.x - c.x, p.z - c.z) < 0.1; });
  }, [id, pred], { timeout: 8000 }).catch(() => fail(`the page never showed ${what ?? pred}`));
  const stand = (x, z, id, pitch = -0.12) => pg.evaluate(([x, z, id, pitch]) => {
    const g = window.__game, w = g.conn.room.world, p = [...w.players.values()][0], c = w.customers.find(c => c.id === id);
    p.x = x; p.z = z; g.pos = { x, z };
    if (c) g.yaw = Math.atan2(c.x - x, c.z - z);
    g.pitch = pitch;
  }, [x, z, id, pitch]);
  const prompt = () => pg.evaluate(() => {
    const p = document.getElementById('prompt');
    return { text: p?.innerText.replace(/\s+/g, ' ') ?? '', keys: [...(p?.querySelectorAll('.key') ?? [])].map(k => k.textContent) };
  });
  const waitPrompt = async re => { await pg.waitForFunction(src => new RegExp(src).test(document.getElementById('prompt')?.innerText ?? ''), re.source, { timeout: 5000 }).catch(() => {}); return prompt(); };
  const cust = id => pg.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return c ? { state: c.state, resolved: c.resolved, x: c.x, z: c.z } : null; }, id);
  const shot = async name => { await hold(true); await pg.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 }); await hold(false); };
  /** The right handful, read from the prompt itself (each coin badge is followed by its "×n"). */
  const rightPick = () => pg.evaluate(() => {
    const due = Number(document.querySelector('#qte .qte-title b').textContent.replace('$', ''));
    const sums = [...document.querySelectorAll('#qte .qte-opt')].map(b => [...b.querySelectorAll('.coin')].reduce((s, c) => s + Number(c.textContent) * Number((c.nextSibling?.textContent ?? '').match(/×(\d+)/)?.[1] ?? 0), 0));
    return { due, sums, idx: sums.indexOf(due) };
  });
  return { frames, hold, spawn, fastForward, holdSynced, seen, stand, prompt, waitPrompt, cust, shot, rightPick };
}

// ======================= (A) desktop: keyboard / Xbox / PlayStation =======================
{
  const { ctx, pg } = await open(false);
  const h = helpers(pg);
  const press = async (i, ms = 150) => {
    await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = true; b.value = 1; window.__pad.timestamp++; }, i);
    await h.frames(3, ms);
    await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = false; b.value = 0; window.__pad.timestamp++; }, i);
    await h.frames(3, 120);
  };
  /** Switch the device the prompts are for: a keyboard key (Shift = run, harmless) or the pad's LT (run, harmless). */
  const device = async d => {
    if (d === 'kb') await pg.keyboard.press('ShiftLeft');
    else { await pg.evaluate(id => { window.__pad.id = id; }, d === 'ps' ? PS_ID : XBOX_ID); await press(B.LT); }
    await h.frames(3, 250); // the HUD refreshes every 0.1 s
  };
  const EXPECT = { kb: ['E', 'F'], xbox: ['A', 'X'], ps: ['✕', '□'] };
  /** The prompt for the held-still karen, in all three devices: the key chip(s) must be the device's. */
  const chips = async (who, re, withAlt) => {
    await h.hold(true);
    for (const d of ['kb', 'xbox', 'ps']) {
      await device(d);
      const p = await h.waitPrompt(re);
      const want = withAlt ? EXPECT[d] : [EXPECT[d][0]];
      check(re.test(p.text) && JSON.stringify(p.keys) === JSON.stringify(want), `${who} prompt on ${d}: [${p.keys.join('][')}] ${p.text}`, `want ${want}`);
    }
    await h.hold(false);
  };

  await h.frames(10, 1200); // (the software-GL page runs few frames right after load)

  // ---- 發票對獎魔人: till prompt, then the escort cue ----
  {
    const id = await h.spawn('lottery');
    const st = await h.fastForward(id, "c.state === 'atRegister'");
    if (st?.state !== 'atRegister') fail('lottery never reached the till ' + JSON.stringify(st));
    await h.stand(st.x, st.z + 1.2, id, 0);
    await h.seen(id, "c.state === 'atRegister'", 'the 發票對獎魔人 at the till');
    await chips('發票對獎魔人', /帶發票對獎魔人去對獎機/, false);
    await device('xbox');
    await h.waitPrompt(/帶發票對獎魔人去對獎機/);
    await press(B.A);
    await pg.waitForFunction(id => window.__game.conn.room.world.customers.find(c => c.id === id)?.state === 'toKiosk', id, { timeout: 5000 }).then(() => ok('A started the escort')).catch(() => fail('A did not start the escort'));
    await h.holdSynced();
    const c = await h.cust(id);
    await h.stand(c.x + 0.9, c.z + 0.4, id, -0.2);
    await h.seen(id, "c.state === 'toKiosk'", 'the escort under way');
    await pg.waitForFunction(() => /陪著走/.test(document.getElementById('escortcue')?.innerText ?? ''), null, { timeout: 4000 }).catch(() => {});
    const near = await pg.evaluate(() => { const e = document.getElementById('escortcue'); return e && !e.classList.contains('hidden') ? { text: e.innerText, state: e.dataset.state } : null; });
    check(near?.state === 'ok' && /陪著走/.test(near.text), 'escort cue next to him: ' + near?.text);
    // walk away (behind him): the cue says 跟上 and its arrow points back at him
    await pg.evaluate(id => { const g = window.__game, c = g.conn.room.world.customers.find(c => c.id === id), p = [...g.conn.room.world.players.values()][0]; p.x = c.x - 5; p.z = c.z; g.pos = { x: c.x - 5, z: c.z }; g.yaw = Math.atan2(-1, 0); }, id);
    await pg.waitForFunction(() => /跟上/.test(document.getElementById('escortcue')?.innerText ?? ''), null, { timeout: 4000 }).catch(() => {});
    const far = await pg.evaluate(() => { const e = document.getElementById('escortcue'); return e ? { text: e.innerText, state: e.dataset.state, rot: e.querySelector('.ec-arrow')?.style.transform } : null; });
    check(far?.state === 'far' && /跟上！離他 \d+ 公尺/.test(far.text) && /180deg/.test(far.rot ?? ''), `escort cue when left behind: ${far?.text} (${far?.rot})`);
    await pg.screenshot({ path: `${OUT}/r28b-desktop-escort-far.png` });
    await h.hold(false);
  }

  // ---- 找零計較姐: prompt chips, then the exact-change prompt with the pad ----
  {
    const id = await h.spawn('change');
    const st = await h.fastForward(id, "c.state === 'atRegister'");
    if (st?.state !== 'atRegister') fail('change never reached the till ' + JSON.stringify(st));
    await h.stand(st.x, st.z + 1.2, id, 0);
    await h.seen(id, "c.state === 'atRegister'", 'the 找零計較姐 at the till');
    await chips('找零計較姐', /陪找零計較姐數零錢.*找剛好的零錢/, true);
    // keyboard first: F opens it, badges are 1 / 2 / 3
    await device('kb');
    await pg.keyboard.press('KeyF');
    await pg.waitForSelector('#qte', { timeout: 3000 }).catch(() => fail('F did not open the prompt'));
    await pg.evaluate(() => { const q = window.__game.qte; if (q) q.until = performance.now() + 60000; });
    await h.frames(3, 200);
    const kbBadges = await pg.evaluate(() => [...document.querySelectorAll('#qte .qte-key')].map(k => k.textContent));
    check(JSON.stringify(kbBadges) === '["1","2","3"]', 'keyboard badges ' + kbBadges);
    await h.shot('r28b-desktop-qte-keyboard');
    // the player picks up the pad while it is open: badges switch to the D-pad
    await device('xbox');
    await pg.waitForFunction(() => document.querySelector('#qte')?.dataset.dev === 'pad', null, { timeout: 3000 }).catch(() => {});
    const padUi = await pg.evaluate(() => ({
      badges: [...document.querySelectorAll('#qte .qte-key')].map(k => k.textContent),
      help: document.querySelector('#qte .qte-help')?.textContent, time: document.querySelector('#qte .qte-time')?.textContent,
      aria: [...document.querySelectorAll('#qte .qte-opt')].map(b => b.getAttribute('aria-label')), role: document.querySelector('#qte')?.getAttribute('role'),
      bar: document.querySelector('#qte .qte-bar')?.getAttribute('role'),
    }));
    check(JSON.stringify(padUi.badges) === '["十字←","十字↑","十字→"]', 'pad badges ' + padUi.badges);
    check(/十字 ←／↑／→/.test(padUi.help ?? ''), 'pad help line: ' + padUi.help);
    check(/⏱ \d+\.\d 秒/.test(padUi.time ?? ''), 'timer text: ' + padUi.time);
    check(padUi.role === 'dialog' && padUi.bar === 'progressbar' && padUi.aria.every(a => /^第 \d 把：.*元 \d+ 個/.test(a ?? '')), 'aria: dialog + progressbar + option labels', JSON.stringify(padUi.aria));
    await h.shot('r28b-desktop-qte-pad');
    // the pad does nothing but answer while it is open: stick doesn't walk, ↓ doesn't open the shop, A doesn't act
    const before = await pg.evaluate(() => ({ ...window.__game.pos, sent: window.__sent.length }));
    await pg.evaluate(() => { window.__pad.axes = [0, -1, 0, 0]; });
    await h.frames(6, 500);
    await pg.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
    await press(B.DOWN); await press(B.A); await press(B.Y); await press(B.B);
    const after = await pg.evaluate(() => ({ ...window.__game.pos, overlay: window.__game.overlay, qte: !!window.__game.qte, sent: window.__sent.slice(-12) }));
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    const acts = after.sent.filter(t => t !== 'input');
    check(moved < 0.01 && after.overlay === 'none' && after.qte && !acts.length, `pad swallowed while open (moved ${moved.toFixed(3)} m, overlay ${after.overlay}, sent ${JSON.stringify(acts)})`);
    const pick = await h.rightPick();
    if (pick.idx < 0) fail('no option adds up ' + JSON.stringify(pick));
    const rev0 = await pg.evaluate(() => window.__game.conn.room.world.dayStats.revenue);
    await press([B.LEFT, B.UP, B.RIGHT][pick.idx]);
    await pg.waitForFunction(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return !c || c.resolved; }, id, { timeout: 4000 }).catch(() => {});
    const res = await h.cust(id);
    const rev1 = await pg.evaluate(() => window.__game.conn.room.world.dayStats.revenue);
    const sent = await pg.evaluate(() => window.__sent.filter(t => t !== 'input').slice(-4));
    check(res?.resolved && rev1 > rev0 && !(await pg.locator('#qte').count()), `answered with D-pad ${['←', '↑', '→'][pick.idx]}: settled (+$${rev1 - rev0})`, JSON.stringify(res));
    check(!sent.includes('ping') && !sent.includes('ready'), 'the D-pad press did not also ping / ready: ' + JSON.stringify(sent));
    // after the prompt the pad is back to normal (the stick walks again)
    const p0 = await pg.evaluate(() => ({ ...window.__game.pos }));
    await pg.evaluate(() => { window.__pad.axes = [0, -1, 0, 0]; });
    await h.frames(6, 500);
    await pg.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
    const p1 = await pg.evaluate(() => ({ ...window.__game.pos }));
    check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.2, 'stick walks again after the prompt');
  }

  // ---- 免費袋子阿伯: the "wait at the door" hint in every device, then the door prompt ----
  {
    const id = await h.spawn('bagman');
    await h.fastForward(id, "c.state === 'wander' && c.eaten.length >= 1", 20);
    const c0 = await h.cust(id);
    await h.stand(c0.x, c0.z + 1.2, id, 0);
    await h.seen(id, "c.state === 'wander'", 'the 阿伯 inside');
    for (const d of ['kb', 'xbox', 'ps']) {
      await device(d);
      const p = await h.waitPrompt(/門口/);
      const al = await pg.evaluate(() => document.getElementById('alert')?.innerText ?? '');
      check(/門口/.test(p.text) && /門口/.test(al), `bagman inside, ${d}: "${p.text}" / alert "${al.replace(/\s+/g, ' ').slice(0, 40)}"`);
    }
    await h.hold(false);
    await pg.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); c.life = 0.1; }, id);
    const st = await h.fastForward(id, "c.state === 'toExit' && c.z > 12.8 && Math.abs(c.x - 12) < 3.2", 40);
    await h.stand(st.x - 0.4, st.z - 1.3, id, -0.05);
    await h.seen(id, "c.state === 'toExit' && c.z > 12.8", 'the 阿伯 at the door');
    await chips('免費袋子阿伯 at the door', /在門口攔下免費袋子阿伯/, false);
    await pg.screenshot({ path: `${OUT}/r28b-desktop-bagman-door-ps.png` });
  }

  // ---- 借廁所大隊: the leader prompt ----
  {
    const id = await h.spawn('toilet');
    const st = await h.fastForward(id, "c.state === 'toilet'", 40);
    await pg.evaluate(() => { const w = window.__game.conn.room.world; w.spills = []; for (const c of w.customers) if (c.kind === 'toilet' && c.leader == null) c.knockTimer = 99; });
    await h.stand(st.x, st.z + 1.0, id, 0.05);
    await h.seen(id, "c.state === 'toilet'", 'the 借廁所大隊 leader in the restroom line');
    await chips('借廁所大隊 leader', /領隊/, false);
  }
  await ctx.close();
}

// ======================= (B) phone 844x390, touch =======================
{
  const { ctx, pg } = await open(true);
  const h = helpers(pg);
  await h.frames(10, 1200);
  const rect = sel => pg.evaluate(sel => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }), sel);
  const visibleButtons = () => pg.evaluate(() => [...document.querySelectorAll('#touch .tbtn')].filter(b => !b.classList.contains('hidden') && b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { id: b.id, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // where the left thumb works the joystick: the bottom of the left touch zone
  const W = 844, H = 390, THUMB = { x: 0, y: H * 0.55, w: W * 0.42, h: H * 0.45 };
  const T = { lottery: '帶去對獎', change: ['陪她數', '找剛好'], bagman: '攔下', toilet: '限消費' };

  // ---- 發票對獎魔人 ----
  {
    const id = await h.spawn('lottery');
    const st = await h.fastForward(id, "c.state === 'atRegister'");
    await h.stand(st.x, st.z + 1.2, id, 0);
    await h.seen(id, "c.state === 'atRegister'", 'the 發票對獎魔人 at the till');
    const p = await h.waitPrompt(/帶發票對獎魔人去對獎機/);
    const btn = await pg.textContent('#t-interact');
    check(JSON.stringify(p.keys) === JSON.stringify([T.lottery]) && btn === T.lottery, `touch: lottery chip [${p.keys}] = button "${btn}"`);
    await h.hold(false);
    await pg.tap('#t-interact');
    await pg.waitForFunction(id => window.__game.conn.room.world.customers.find(c => c.id === id)?.state === 'toKiosk', id, { timeout: 5000 }).then(() => ok('tap 帶去對獎 started the escort')).catch(() => fail('tap did not start the escort'));
    await h.holdSynced();
    await pg.evaluate(id => { const g = window.__game, c = g.conn.room.world.customers.find(c => c.id === id), p = [...g.conn.room.world.players.values()][0]; p.x = c.x - 5; p.z = c.z; g.pos = { x: c.x - 5, z: c.z }; g.yaw = Math.atan2(1, 0) + 0.6; }, id);
    await pg.waitForFunction(() => /跟上/.test(document.getElementById('escortcue')?.innerText ?? ''), null, { timeout: 4000 }).catch(() => {});
    const cue = await pg.evaluate(() => { const e = document.getElementById('escortcue'); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.innerText, x: r.x, y: r.y, w: r.width, h: r.height, fs: parseFloat(getComputedStyle(e).fontSize) }; });
    const btns = await visibleButtons();
    check(cue && /跟上/.test(cue.text) && cue.x >= 0 && cue.x + cue.w <= W && cue.y >= 0 && cue.fs >= 14 && !btns.some(b => hit(cue, b)),
      `phone escort cue readable: "${cue?.text}" ${Math.round(cue?.w)}x${Math.round(cue?.h)} at ${Math.round(cue?.x)},${Math.round(cue?.y)}, ${cue?.fs}px, clear of the buttons`);
    await pg.screenshot({ path: `${OUT}/r28b-phone-escort-far.png` });
    await h.hold(false);
  }

  // ---- 找零計較姐: tap 找剛好, tap the right handful ----
  {
    const id = await h.spawn('change');
    const st = await h.fastForward(id, "c.state === 'atRegister'");
    await h.stand(st.x, st.z + 1.2, id, 0);
    await h.seen(id, "c.state === 'atRegister'", 'the 找零計較姐 at the till');
    const p = await h.waitPrompt(/陪找零計較姐數零錢/);
    const btn = { i: await pg.textContent('#t-interact'), a: await pg.textContent('#t-alt'), altShown: await pg.isVisible('#t-alt') };
    check(JSON.stringify(p.keys) === JSON.stringify(T.change) && btn.i === T.change[0] && btn.a === T.change[1] && btn.altShown, `touch: change chips [${p.keys}] = buttons "${btn.i}" / "${btn.a}"`);
    await h.hold(false);
    await pg.tap('#t-alt');
    await pg.waitForSelector('#qte', { timeout: 3000 }).then(() => ok('tap 找剛好 opened the prompt')).catch(() => fail('tap did not open the prompt'));
    await pg.evaluate(() => { const q = window.__game.qte; if (q) q.until = performance.now() + 60000; });
    await h.frames(3, 300);
    const ui = await pg.evaluate(() => ({ dev: document.querySelector('#qte')?.dataset.dev, badges: [...document.querySelectorAll('#qte .qte-key')].map(k => k.textContent), help: document.querySelector('#qte .qte-help')?.textContent, time: document.querySelector('#qte .qte-time')?.textContent }));
    check(ui.dev === 'touch' && /點一下/.test(ui.help ?? '') && !/按 1/.test(ui.help ?? '') && /⏱/.test(ui.time ?? ''), `touch prompt: badges ${ui.badges}, "${ui.help}", ${ui.time}`);
    const opts = await rect('#qte .qte-opt'), card = (await rect('#qte'))[0], btns = await visibleButtons();
    const big = opts.every(o => o.w >= 48 && o.h >= 48), inView = [card, ...opts].every(o => o.x >= 0 && o.y >= 0 && o.x + o.w <= W && o.y + o.h <= H);
    const clash = btns.filter(b => hit(card, b)).map(b => b.id), thumb = hit(card, THUMB);
    check(big && inView && !clash.length && !thumb, `phone handfuls ${opts.map(o => `${Math.round(o.w)}x${Math.round(o.h)}`).join(', ')}; card ${Math.round(card.x)},${Math.round(card.y)} ${Math.round(card.w)}x${Math.round(card.h)}; overlaps buttons [${clash}] thumb area ${thumb}`);
    const topmost = await pg.evaluate(() => [...document.querySelectorAll('#qte .qte-opt')].every(b => { const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
    check(topmost, 'nothing (touch zones) sits on top of the handfuls');
    await h.shot('r28b-phone-qte');
    const pick = await h.rightPick();
    const rev0 = await pg.evaluate(() => window.__game.conn.room.world.dayStats.revenue);
    await pg.locator('#qte .qte-opt').nth(pick.idx).tap();
    await pg.waitForFunction(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); return !c || c.resolved; }, id, { timeout: 4000 }).catch(() => {});
    const res = await h.cust(id), rev1 = await pg.evaluate(() => window.__game.conn.room.world.dayStats.revenue);
    const exact = await pg.evaluate(() => window.__sent.filter(t => t === 'act:exactChange').length);
    check(res?.resolved && rev1 > rev0 && exact === 1 && !(await pg.locator('#qte').count()), `answered by tap (handful ${pick.idx + 1}): settled +$${rev1 - rev0}, one answer sent`);
  }

  // ---- 免費袋子阿伯 ----
  {
    const id = await h.spawn('bagman');
    await h.fastForward(id, "c.state === 'wander' && c.eaten.length >= 1", 20);
    const c0 = await h.cust(id);
    await h.stand(c0.x, c0.z + 1.2, id, 0);
    await h.seen(id, "c.state === 'wander'", 'the 阿伯 inside');
    const p = await h.waitPrompt(/門口/);
    const al = await pg.evaluate(() => { const a = document.getElementById('alert'); return a && !a.classList.contains('hidden') ? a.innerText : ''; });
    check(/門口/.test(p.text) && /門口/.test(al), `phone bagman inside: "${p.text}" / alert "${al.replace(/\s+/g, ' ').slice(0, 40)}"`);
    await pg.screenshot({ path: `${OUT}/r28b-phone-bagman-inside.png` });
    await h.hold(false);
    await pg.evaluate(id => { const c = window.__game.conn.room.world.customers.find(c => c.id === id); c.life = 0.1; }, id);
    const st = await h.fastForward(id, "c.state === 'toExit' && c.z > 12.8 && Math.abs(c.x - 12) < 3.2", 40);
    await h.stand(st.x - 0.4, st.z - 1.3, id, -0.05);
    await h.seen(id, "c.state === 'toExit' && c.z > 12.8", 'the 阿伯 at the door');
    const d = await h.waitPrompt(/在門口攔下/);
    const btn = await pg.textContent('#t-interact');
    check(JSON.stringify(d.keys) === JSON.stringify([T.bagman]) && btn === T.bagman, `touch: bagman door chip [${d.keys}] = button "${btn}"`);
    await h.hold(false);
  }

  // ---- 借廁所大隊 ----
  {
    const id = await h.spawn('toilet');
    const st = await h.fastForward(id, "c.state === 'toilet'", 40);
    await pg.evaluate(() => { const w = window.__game.conn.room.world; w.spills = []; for (const c of w.customers) if (c.kind === 'toilet' && c.leader == null) c.knockTimer = 99; });
    await h.stand(st.x, st.z + 1.0, id, 0.05);
    await h.seen(id, "c.state === 'toilet'", 'the 借廁所大隊 leader in the restroom line');
    const p = await h.waitPrompt(/領隊/);
    const btn = await pg.textContent('#t-interact');
    const fits = await pg.evaluate(() => { const b = document.getElementById('t-interact'); return b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1; });
    check(JSON.stringify(p.keys) === JSON.stringify([T.toilet]) && btn === T.toilet && fits, `touch: toilet chip [${p.keys}] = button "${btn}" (fits: ${fits})`);
    await pg.screenshot({ path: `${OUT}/r28b-phone-toilet.png` });
    await h.hold(false);
  }
  await ctx.close();
}

await browser.close();
if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | ')); else ok('no page errors');
