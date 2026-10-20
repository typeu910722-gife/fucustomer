// Controller mapping, deadzones, glyphs, menu navigation geometry (client/src/padmap.ts) and settings sanitizing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BTN, GAME_BINDINGS, KEY_LABEL, NavRepeat, actionGlyph, actionLabel, buttonGlyph, controlsLine, isDown, looksLikeBack, menuDir,
  padStyleOf, pickSpatial, radialDeadzone, stickLook,
} from '../client/src/padmap.ts';
import { defaultSettings, sanitizeSettings } from '../client/src/storage.ts';
import { FPS_CAPS } from '../shared/savecode.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('radial deadzone: drift is ignored, output ramps from 0 at the edge to 1 at full tilt, direction kept', () => {
  assert.deepEqual(radialDeadzone(0.1, 0.1, 0.18), { x: 0, y: 0 }); // |v| ≈ 0.14
  assert.deepEqual(radialDeadzone(0, 0.18, 0.18), { x: 0, y: 0 });
  const edge = radialDeadzone(0, 0.19, 0.18);
  assert.ok(edge.y > 0 && edge.y < 0.02, 'no jump just past the deadzone');
  const full = radialDeadzone(1, 0, 0.18); near(full.x, 1); near(full.y, 0);
  const diag = radialDeadzone(0.9, 0.9, 0.18); near(Math.hypot(diag.x, diag.y), 1); near(diag.x, diag.y); // clamped, 45° kept
  const half = radialDeadzone(-0.59, 0, 0.18); near(half.x, -0.5);
  assert.deepEqual(radialDeadzone(NaN, 0), { x: 0, y: 0 });
});

test('right-stick look: deadzone, curve, sensitivity and invert-Y', () => {
  assert.deepEqual(stickLook(0.1, -0.1, 1 / 60, 1, false), { dx: 0, dy: 0 });
  const a = stickLook(1, 0, 1 / 60, 1, false), b = stickLook(1, 0, 1 / 60, 2, false);
  assert.ok(a.dx > 0); near(b.dx, a.dx * 2);
  const slow = stickLook(0.5, 0, 1 / 60, 1, false);
  assert.ok(slow.dx < a.dx * 0.5, 'curve: half tilt turns less than half as fast (fine aim)');
  const up = stickLook(0, -1, 1 / 60, 1, false), inv = stickLook(0, -1, 1 / 60, 1, true);
  assert.ok(up.dy < 0); near(inv.dy, -up.dy);
});

test('every in-shift action has a pad button, and every bound button is a real standard-mapping index', () => {
  const actions = new Set(GAME_BINDINGS.map(([, a]) => a));
  for (const a of ['interact', 'alt', 'drop', 'grab', 'spin', 'ultimate', 'hit', 'run', 'ping', 'quick', 'shop', 'ready', 'menu', 'skip'] as const) assert.ok(actions.has(a), a);
  for (const [i] of GAME_BINDINGS) assert.ok(i >= 0 && i <= 16);
  const buttons = GAME_BINDINGS.map(([i]) => i);
  assert.equal(new Set(buttons).size, buttons.length, 'one action per button');
  assert.equal(GAME_BINDINGS.find(([i]) => i === BTN.A)![1], 'interact');
  assert.equal(GAME_BINDINGS.find(([i]) => i === BTN.MENU)![1], 'menu');
});

test('glyphs: Xbox / Steam Deck get A B X Y, PlayStation gets ✕ ○ □ △; keyboard labels on keyboard', () => {
  assert.equal(padStyleOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(padStyleOf('Steam Deck (Vendor: 28de Product: 1205)'), 'xbox');
  assert.equal(padStyleOf('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'ps');
  assert.equal(padStyleOf('Sony PLAYSTATION(R)3 Controller'), 'ps');
  assert.equal(padStyleOf('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), 'ps');
  assert.equal(buttonGlyph(BTN.A, 'xbox'), 'A'); assert.equal(buttonGlyph(BTN.A, 'ps'), '✕');
  assert.equal(buttonGlyph(BTN.Y, 'ps'), '△'); assert.equal(buttonGlyph(BTN.RB, 'ps'), 'R1');
  assert.equal(actionGlyph('interact', 'xbox'), 'A'); assert.equal(actionGlyph('drop', 'xbox'), 'B'); assert.equal(actionGlyph('alt', 'ps'), '□');
  assert.equal(actionLabel('interact', 'kb', 'xbox'), 'E'); assert.equal(actionLabel('drop', 'kb', 'xbox'), 'G');
  assert.equal(actionLabel('interact', 'pad', 'ps'), '✕');
  assert.equal(KEY_LABEL.grab, '空白');
  assert.match(controlsLine('pad', 'xbox'), /A 互動.*B 放下.*Y 抓\/丟/);
  assert.match(controlsLine('kb', 'xbox'), /^WASD/);
});

test('triggers count as pressed past half pull', () => {
  assert.equal(isDown({ pressed: false, value: 0.3 }), false);
  assert.equal(isDown({ pressed: false, value: 0.7 }), true);
  assert.equal(isDown({ pressed: true, value: 0 }), true);
  assert.equal(isDown(undefined), false);
});

test('menu direction: D-pad wins, stick needs a firm push, dominant axis', () => {
  const none: boolean[] = [];
  const dpad = []; dpad[BTN.DOWN] = true;
  assert.equal(menuDir(dpad, 0, -1), 'down');
  assert.equal(menuDir(none, 0.3, 0.3), null);
  assert.equal(menuDir(none, 0.2, 0.9), 'down');
  assert.equal(menuDir(none, -0.9, 0.3), 'left');
  assert.equal(menuDir(none, 0, -0.7), 'up');
});

test('held direction repeats after a delay', () => {
  const r = new NavRepeat(0.4, 0.1);
  assert.equal(r.update('down', 0.016), 'down');
  assert.equal(r.update('down', 0.2), null);
  assert.equal(r.update('down', 0.25), 'down'); // 0.45 s held
  assert.equal(r.update('down', 0.05), null);
  assert.equal(r.update('down', 0.06), 'down');
  assert.equal(r.update(null, 0.016), null);
  assert.equal(r.update('up', 0.016), 'up');
});

test('spatial pick: same column / row first, nothing behind', () => {
  // a vertical button list with two side-by-side buttons at the bottom
  const from = { x: 100, y: 0, w: 200, h: 40 };
  const cands = [
    { x: 100, y: 60, w: 200, h: 40 }, // 0: directly below
    { x: 100, y: -60, w: 200, h: 40 }, // 1: above
    { x: 100, y: 120, w: 95, h: 40 }, // 2: bottom-left
    { x: 205, y: 120, w: 95, h: 40 }, // 3: bottom-right
    { x: 400, y: 10, w: 80, h: 30 }, // 4: to the right
  ];
  assert.equal(pickSpatial(from, cands, 'down'), 0);
  assert.equal(pickSpatial(from, cands, 'up'), 1);
  assert.equal(pickSpatial(from, cands, 'right'), 4);
  assert.equal(pickSpatial(from, cands, 'left'), -1);
  assert.equal(pickSpatial(cands[2], cands, 'right'), 3);
  assert.equal(pickSpatial(cands[3], cands, 'left'), 2);
});

test('back-button detection', () => {
  assert.ok(looksLikeBack('mp-back', '← 主選單'));
  assert.ok(looksLikeBack('shop-close', '關閉 (B)'));
  assert.ok(looksLikeBack('x', '← 返回'));
  assert.ok(looksLikeBack('h-back', '返回'));
  assert.ok(!looksLikeBack('m-career', '🧑‍💼 開工'));
  assert.ok(!looksLikeBack('backup', '💾 存檔備份'));
});

test('stored settings are sanitized: defaults filled in, ranges clamped, junk dropped', () => {
  const d = defaultSettings(false);
  assert.deepEqual(sanitizeSettings(null, false), d);
  assert.deepEqual(sanitizeSettings('garbage', false), d);
  const s = sanitizeSettings({
    sensitivity: 99, padSens: -5, master: 2, volume: -1, music: 0.4, renderScale: 0.1, fov: 500, fpsCap: 75, quality: 'ultra',
    rumble: 'yes', padInvertY: true, fullscreen: false, showFps: 1, serverUrl: 'javascript:alert(1)', name: 'x'.repeat(40), extra: 'hack',
  }, false);
  assert.equal(s.sensitivity, 3); assert.equal(s.padSens, 0.2); assert.equal(s.master, 1); assert.equal(s.volume, 0); assert.equal(s.music, 0.4);
  assert.equal(s.renderScale, 0.5); assert.equal(s.fov, 100); assert.equal(s.fpsCap, d.fpsCap); assert.equal(s.quality, d.quality);
  assert.equal(s.rumble, true); assert.equal(s.padInvertY, true); assert.equal(s.fullscreen, false); assert.equal(s.showFps, false);
  assert.equal(s.serverUrl, ''); assert.equal(s.name.length, 16); assert.ok(!('extra' in s));
  for (const c of FPS_CAPS) assert.equal(sanitizeSettings({ fpsCap: c }, false).fpsCap, c);
  assert.equal(sanitizeSettings({ serverUrl: 'wss://my.server/ws' }, false).serverUrl, 'wss://my.server/ws');
  // settings saved by older versions (no new fields) still load with the new defaults
  const old = sanitizeSettings({ name: '阿明', sensitivity: 1.4, quality: 'medium', volume: 0.3, music: 0.2, fov: 80, fpsCap: 30, adaptive: false, invertY: true, showFps: true }, false);
  assert.equal(old.master, 1); assert.equal(old.padSens, 1); assert.equal(old.rumble, true); assert.equal(old.sensitivity, 1.4); assert.equal(old.fpsCap, 30);
});
