// Round 28b: the 找零計較姐 exact-change prompt on a controller / touch, and device-aware prompt key labels (client/src/padmap.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BTN, GAME_BINDINGS, QTE_PAD, promptDevice, promptKey, qteGlyph, qteHelp, qteKeepsBinding, qtePadPick } from '../client/src/padmap.ts';

const pad = (...down: number[]) => Array.from({ length: 17 }, (_, i) => down.includes(i));

test('D-pad ← ↑ → pick handful 1 / 2 / 3, only on a fresh press', () => {
  assert.deepEqual([...QTE_PAD], [BTN.LEFT, BTN.UP, BTN.RIGHT]);
  assert.equal(qtePadPick(pad(), pad(BTN.LEFT)), 0);
  assert.equal(qtePadPick(pad(), pad(BTN.UP)), 1);
  assert.equal(qtePadPick(pad(), pad(BTN.RIGHT)), 2);
  assert.equal(qtePadPick(pad(BTN.RIGHT), pad(BTN.RIGHT)), -1, 'held from before: no answer');
  assert.equal(qtePadPick(pad(), pad(BTN.DOWN)), -1, '↓ is not an option');
  assert.equal(qtePadPick(pad(), pad(BTN.A, BTN.X, BTN.B, BTN.Y)), -1, 'face buttons do not answer (X opened the prompt)');
  assert.equal(qtePadPick(pad(), pad()), -1);
});

test('while the prompt is open only Menu keeps its in-shift action (no ping / ready / skip / walking off)', () => {
  const kept = GAME_BINDINGS.filter(([b]) => qteKeepsBinding(b)).map(([, a]) => a);
  assert.deepEqual(kept, ['menu']);
  for (const b of QTE_PAD) assert.equal(qteKeepsBinding(b), false, 'the option D-pad directions must not also ping / skip / ready');
});

test('prompt device: pad wins, then touch, else keyboard', () => {
  assert.equal(promptDevice('pad', true), 'pad');
  assert.equal(promptDevice('pad', false), 'pad');
  assert.equal(promptDevice('kb', true), 'touch');
  assert.equal(promptDevice('kb', false), 'kb');
});

test('prompt key chip per device (keyboard keys / Xbox / PlayStation / touch button text)', () => {
  assert.equal(promptKey('interact', 'kb', 'xbox', '攔下'), 'E');
  assert.equal(promptKey('alt', 'kb', 'xbox', '找剛好'), 'F');
  assert.equal(promptKey('interact', 'pad', 'xbox', '攔下'), 'A');
  assert.equal(promptKey('alt', 'pad', 'xbox', '找剛好'), 'X');
  assert.equal(promptKey('interact', 'pad', 'ps', '攔下'), '✕');
  assert.equal(promptKey('alt', 'pad', 'ps', '找剛好'), '□');
  assert.equal(promptKey('interact', 'touch', 'xbox', '帶去對獎'), '帶去對獎');
});

test('handful badges + help line per device', () => {
  assert.deepEqual([0, 1, 2].map(i => qteGlyph(i, 'kb', 'xbox')), ['1', '2', '3']);
  assert.deepEqual([0, 1, 2].map(i => qteGlyph(i, 'touch', 'xbox')), ['1', '2', '3']);
  assert.deepEqual([0, 1, 2].map(i => qteGlyph(i, 'pad', 'xbox')), ['十字←', '十字↑', '十字→']);
  assert.deepEqual([0, 1, 2].map(i => qteGlyph(i, 'pad', 'ps')), ['十字←', '十字↑', '十字→']);
  assert.match(qteHelp('kb', 'xbox'), /1／2／3/);
  assert.match(qteHelp('pad', 'ps'), /十字 ←／↑／→/);
  assert.match(qteHelp('touch', 'xbox'), /點一下/);
  assert.doesNotMatch(qteHelp('touch', 'xbox'), /按 1/, 'no keyboard keys on a phone');
  for (const d of ['kb', 'pad', 'touch'] as const) assert.match(qteHelp(d, 'xbox'), /−8 秒/);
});
