// Round 25c (docs/FTUE.md): first-shift data the newcomer flow relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterControls } from '../client/src/padmap.ts';
import { SCENES, SHIFT_HOOKS } from '../shared/story.ts';
import { buildShiftConfig, newProfile } from '../shared/career.ts';

test('controls strip only lists what the shift can use', () => {
  const full = 'WASD 移動・Shift 跑・滑鼠 視角・E 互動・F 次要・G 放下・空白 抓/丟・X 出手・Q 旋風・R 全店退散・V 標記・T 訊息・B 採購・Esc 選單';
  assert.equal(filterControls(full, null), full);
  assert.equal(filterControls(full, { abilities: [], alt: false, social: false, shop: false, ready: false }), 'WASD 移動・Shift 跑・滑鼠 視角・E 互動・G 放下・Esc 選單');
  assert.match(filterControls(full, { abilities: ['hit', 'grab'], alt: true, social: false, shop: false, ready: false }), /F 次要.*空白 抓\/丟・X 出手・Esc/);
});

test('the first chapter opens in the store with three short lines', () => {
  const sc = SCENES['ch1-intro'];
  assert.equal(sc.inStore, true);
  assert.ok(sc.lines.length <= 3);
  for (const l of sc.lines) assert.ok(l.text.length <= 32, `short line: ${l.text}`);
});

test('1-1 has exactly one early 插隊 karen (the first 退散) and tomorrow hooks exist', () => {
  const cfg = buildShiftConfig(newProfile(), '1-1');
  assert.deepEqual(cfg.karens, ['cutter']);
  assert.ok(cfg.firstKaren <= 20 && cfg.karenEvery > cfg.length, 'one karen, early');
  assert.ok(cfg.abilities.length === 0, 'no grab / hit at Lv.1');
  for (const id of ['1-1', '1-2']) assert.match(SHIFT_HOOKS[id].bye, /明天見/);
});
