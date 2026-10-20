// Round 21: controller (gamepad) + PC settings, at the Steam Deck resolution (1280×800).
// A FAKE standard-mapping gamepad is injected by replacing navigator.getGamepads in the page — this checks the
// game's gamepad code paths in a browser, NOT a real controller or a real Steam Deck.
//  (1) main menu: pad input switches to pad mode, focus ring appears, D-pad reaches 設定
//  (2) settings: sliders change with left/right, checkboxes toggle with A, B saves and goes back; values persist
//  (3) D-pad + A: 開工 → 自由營業 tab (RB) → 便利商店 starts a solo shift
//  (4) in the shift: left stick moves, right stick turns, A takes a crate box (prompt shows the A glyph), B drops it,
//      Start opens the pause menu (B closes it), D-pad ↓ opens the shop, rumble fires on an ultimate, PS glyphs for a
//      DualSense id, a keyboard key switches the hints back to the keyboard.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m, JSON.stringify(errors)); process.exitCode = 1; };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  window.__rumbles = [];
  window.__pad = {
    id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0],
    vibrationActuator: { type: 'dual-rumble', playEffect: (t, p) => { window.__rumbles.push({ t, ...p }); return Promise.resolve('complete'); } },
  };
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
const pg = await ctx.newPage();
pg.on('pageerror', e => errors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DIRS = { up: B.UP, down: B.DOWN, left: B.LEFT, right: B.RIGHT };
/** Wait at least `ms` AND `n` animation frames, so the game's per-frame gamepad polling sees the state (slow software GL). */
const frames = (n, ms) => pg.evaluate(([n, ms]) => new Promise(r => { const t0 = performance.now(); let k = 0; const f = () => { if (++k >= n && performance.now() - t0 >= ms) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), [n, ms]);
const press = async (i, ms = 150) => {
  await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = true; b.value = 1; window.__pad.timestamp++; }, i);
  await frames(3, ms);
  await pg.evaluate(i => { const b = window.__pad.buttons[i]; b.pressed = false; b.value = 0; window.__pad.timestamp++; }, i);
  await frames(3, 120);
};
const stick = async (axes, ms, n = 4) => {
  await pg.evaluate(a => { window.__pad.axes = a; }, axes);
  await frames(n, ms);
  await pg.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
  await frames(3, 100);
};
const focused = () => pg.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.id || a.dataset.tab || a.dataset.map || a.textContent.trim().slice(0, 12)) : null; });
/** Drive the D-pad toward `sel` the way a player would (look where it is, press toward it). */
async function navTo(sel, max = 30) {
  let lastKey = '', stuck = 0;
  for (let n = 0; n < max; n++) {
    const st = await pg.evaluate(sel => {
      const t = document.querySelector(sel); if (!t) return { err: 'no ' + sel };
      const a = document.activeElement;
      if (a === t) return { done: true };
      if (!a || a === document.body) return { dir: 'down', key: 'none' };
      const tr = t.getBoundingClientRect(), ar = a.getBoundingClientRect();
      const sameRow = tr.top < ar.bottom && tr.bottom > ar.top;
      const dx = tr.left + tr.width / 2 - (ar.left + ar.width / 2), dy = tr.top + tr.height / 2 - (ar.top + ar.height / 2);
      const v = dy > 0 ? 'down' : 'up', h = dx > 0 ? 'right' : 'left';
      return { dir: sameRow ? h : v, alt: h, key: a.id + a.textContent.slice(0, 8) };
    }, sel);
    if (st.err) throw new Error(st.err);
    if (st.done) return;
    stuck = st.key === lastKey ? stuck + 1 : 0; lastKey = st.key;
    await press(DIRS[stuck % 2 ? st.alt : st.dir], 150);
  }
  throw new Error(`could not reach ${sel} with the D-pad (focus: ${await focused()})`);
}

await pg.goto(URL);
await pg.evaluate(() => {
  localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name: '手把店員' }));
  localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'wiper'], seenMaps: ['convenience'] }));
});
await pg.reload();
await pg.waitForSelector('#m-career');
await pg.waitForTimeout(1500); // the software-GL test browser runs few frames right after load; a 0.2 s press could fall between two

// ---------- (1) main menu ----------
await press(B.DOWN);
const mm = await pg.evaluate(() => ({ pad: document.body.classList.contains('pad-mode'), ring: document.querySelectorAll('.padfocus').length, focus: document.activeElement?.id }));
console.log('main menu after D-pad:', JSON.stringify(mm));
if (!mm.pad) fail('pad mode not switched on'); if (mm.ring !== 1) fail('no focus ring');
await pg.screenshot({ path: `${OUT}/r21-deck-mainmenu.png` });
await navTo('#m-settings');
await press(B.A);
await pg.waitForSelector('#s-pad');

// ---------- (2) settings ----------
await pg.waitForTimeout(150);
if (!(await pg.evaluate(() => document.activeElement?.closest('.settings')))) fail('settings opened without focus');
await navTo('#s-pad');
await press(B.RIGHT); await press(B.RIGHT);
const padSens = await pg.inputValue('#s-pad');
if (padSens !== '1.2') fail('pad sensitivity slider via D-pad: ' + padSens);
await navTo('#s-pinv'); await press(B.A);
if (!(await pg.isChecked('#s-pinv'))) fail('A did not toggle 手把反轉 Y 軸');
await navTo('#s-master'); await press(B.LEFT); await press(B.LEFT);
await navTo('#s-fps-cap'); await press(B.RIGHT); // 不限制 → 144
await pg.screenshot({ path: `${OUT}/r21-deck-settings.png` });
const fit = await pg.evaluate(() => { const c = document.querySelector('.card.settings'); return { h: c.scrollHeight, vh: innerHeight, ok: document.getElementById('s-ok').getBoundingClientRect().bottom <= innerHeight }; });
console.log('settings card at 1280x800:', JSON.stringify(fit));
await press(B.B); // B = 完成 (saves)
await pg.waitForSelector('#m-career');
const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.settings.v1')));
console.log('saved settings:', JSON.stringify({ padSens: saved.padSens, padInvertY: saved.padInvertY, master: saved.master, fpsCap: saved.fpsCap, rumble: saved.rumble }));
if (saved.padSens !== 1.2 || saved.padInvertY !== true || saved.master !== 0.9 || saved.fpsCap !== 144) fail('settings not saved by B');
// put pad invert back so the look test below is predictable
await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('fucustomer.settings.v1')); s.padInvertY = false; localStorage.setItem('fucustomer.settings.v1', JSON.stringify(s)); });
await pg.reload(); await pg.waitForSelector('#m-career'); await pg.waitForTimeout(1500);

// ---------- (3) start a solo shift with the pad ----------
await press(B.DOWN);
await navTo('#m-career'); await press(B.A);
await pg.waitForSelector('[data-tab="free"]');
await pg.waitForTimeout(200);
for (let i = 0; i < 6 && !(await pg.locator('[data-map="convenience"]').count()); i++) await press(B.RB); // RB pages tabs
if (!(await pg.locator('[data-map="convenience"]').count())) fail('RB never reached the 自由營業 tab');
await navTo('[data-map="convenience"]'); await press(B.A);
await pg.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 30000 });
await pg.waitForTimeout(800);
const hk = await pg.textContent('#helpkeys');
console.log('HUD controls line:', hk);
if (!/A 互動/.test(hk) || !/B 放下/.test(hk)) fail('HUD line not showing pad glyphs');
// a pad press is not a "user gesture": the game must not ask for pointer lock (a refusal would switch the mouse to drag-look)
if (/鎖定滑鼠/.test(await pg.textContent('#hintbar'))) fail('pointer-lock refusal hint shown for a controller player');

// ---------- (4) in the shift ----------
const pose = () => pg.evaluate(() => ({ x: window.__game.pos.x, z: window.__game.pos.z, yaw: window.__game.yaw, pitch: window.__game.pitch }));
await pg.evaluate(() => { // open floor in front of the counter, facing the door
  const g = window.__game, me = [...g.conn.room.world.players.values()].find(p => p.id === g.selfId);
  g.pos = { x: 12, z: 9.5 }; g.yaw = 0; g.pitch = 0; me.x = 12; me.z = 9.5; me.yaw = 0;
});
await frames(4, 300);
const p0 = await pose();
await stick([0, -1, 0, 0], 1200, 10); // left stick forward
const p1 = await pose();
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
await stick([0, 0, 1, 0], 500); // right stick right
const p2 = await pose();
await stick([0, 0, 0, -1], 400); // right stick up → look up
const p3 = await pose();
await stick([0, 0.1, 0.1, 0], 400); // drift inside the deadzone: nothing happens
const p4 = await pose();
console.log('stick:', JSON.stringify({ moved: +moved.toFixed(2), yawDelta: +(p2.yaw - p1.yaw).toFixed(3), pitchDelta: +(p3.pitch - p2.pitch).toFixed(3), drift: +Math.hypot(p4.x - p3.x, p4.z - p3.z, p4.yaw - p3.yaw).toFixed(4) }));
if (moved < 0.5) fail('left stick did not move the player ' + JSON.stringify([p0, p1]));
if (!(p2.yaw < p1.yaw - 0.1)) fail('right stick did not turn right');
if (!(p3.pitch > p2.pitch + 0.05)) fail('right stick up did not look up');
if (Math.hypot(p4.x - p3.x, p4.z - p3.z, p4.yaw - p3.yaw) > 1e-6) fail('deadzone let drift through');

// face the snacks crate in the stockroom and take a box with A
await pg.evaluate(() => {
  const g = window.__game, me = [...g.conn.room.world.players.values()].find(p => p.id === g.selfId);
  g.pos = { x: 3.2, z: 2.4 }; g.yaw = Math.PI; g.pitch = -0.3; me.x = 3.2; me.z = 2.4; me.yaw = Math.PI;
});
await pg.waitForFunction(() => window.__game.target?.primary === 'takeBox', null, { timeout: 10000 }).catch(() => fail('no crate target'));
await pg.waitForTimeout(250);
const prompt = await pg.innerHTML('#prompt');
console.log('prompt:', prompt.slice(0, 120));
if (!/<span class="key">A<\/span>/.test(prompt)) fail('interaction prompt does not show the A button');
await pg.screenshot({ path: `${OUT}/r21-deck-hud.png` });
const holding = () => pg.evaluate(() => { const g = window.__game; return g.snap.players.find(p => p.id === g.selfId)?.held?.kind === 'box'; });
let tries = 0;
for (; tries < 3 && !(await holding()); tries++) { await press(B.A); await frames(6, 600); }
console.log('A presses to take the box:', tries);
if (!(await holding())) fail('A did not take a box');
await pg.waitForTimeout(300);
const heldPrompt = await pg.innerHTML('#prompt');
await press(B.B);
await pg.waitForFunction(() => { const g = window.__game; return !g.snap.players.find(p => p.id === g.selfId)?.held; }, null, { timeout: 8000 }).catch(() => fail('B did not drop the box'));
console.log('held prompt:', heldPrompt.replace(/<[^>]+>/g, ' ').slice(0, 80));

// Start → pause (focus on 回到遊戲), B closes; D-pad ↓ → shop, B closes
await press(B.START);
await pg.waitForSelector('#p-resume');
await pg.waitForTimeout(200);
const pf = await focused();
if (pf !== 'p-resume') fail('pause menu focus: ' + pf);
await pg.screenshot({ path: `${OUT}/r21-deck-pause.png` });
await press(B.B);
await pg.waitForFunction(() => window.__game.overlay === 'none', null, { timeout: 5000 }).catch(() => fail('B did not close the pause menu'));
await press(B.DOWN);
await pg.waitForFunction(() => window.__game.overlay === 'shop', null, { timeout: 5000 }).catch(() => fail('D-pad down did not open the shop'));
await press(B.B);
await pg.waitForFunction(() => window.__game.overlay === 'none', null, { timeout: 5000 }).catch(() => fail('B did not close the shop'));
// closing a menu with A must not also fire an interaction (held button is ignored until released)
await press(B.START); await pg.waitForSelector('#p-resume'); await pg.waitForTimeout(150);
await pg.evaluate(() => { window.__sent = []; const g = window.__game, send = g.conn.send.bind(g.conn); g.conn.send = m => { if (m.type !== 'input') window.__sent.push(m.type); send(m); }; });
await press(B.A, 900);
const after = await pg.evaluate(() => ({ overlay: window.__game.overlay, sent: window.__sent }));
console.log('A on 回到遊戲:', JSON.stringify(after));
if (after.overlay !== 'none') fail('A did not press 回到遊戲');
if (after.sent.includes('act')) fail('holding A after closing the menu fired an interaction');

// rumble on big moments
await pg.evaluate(() => window.__game.onEvent({ e: 'fx', name: 'ultimate', x: 3, z: 3 }));
const rum = await pg.evaluate(() => window.__rumbles);
console.log('rumble:', JSON.stringify(rum));
if (!rum.length || rum[0].t !== 'dual-rumble') fail('no rumble on ultimate');

// PlayStation glyphs
await pg.evaluate(() => { window.__pad.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'; });
await stick([0, -0.8, 0, 0], 300);
const psLine = await pg.textContent('#helpkeys');
console.log('PS line:', psLine.slice(0, 60));
if (!/✕ 互動/.test(psLine)) fail('PlayStation glyphs not shown');
// keyboard input switches hints back
await pg.keyboard.down('KeyW'); await pg.waitForTimeout(150); await pg.keyboard.up('KeyW'); await pg.waitForTimeout(200);
const kbLine = await pg.textContent('#helpkeys');
if (!/^WASD/.test(kbLine)) fail('keyboard did not switch hints back: ' + kbLine.slice(0, 30));
if (await pg.evaluate(() => document.body.classList.contains('pad-mode'))) fail('pad-mode class stayed on');

await pg.evaluate(() => window.__game.exit());
if (errors.length) fail('page errors');
console.log(process.exitCode ? 'round21 FAILED' : 'round21 OK', JSON.stringify(errors));
await browser.close();
