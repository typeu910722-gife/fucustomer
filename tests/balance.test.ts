// The main-story balance harness (scripts/balance.ts) runs end to end on two shifts.
// It drives a simulated player bot (模擬玩家), not a human; this only checks the harness works, not the balance itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainShiftIds, report, runAll, playShift } from '../scripts/balance.ts';
import { applyMap } from '../shared/map.ts';

test('balance harness plays two shifts and renders a markdown report', () => {
  const ids = mainShiftIds('1-2,6-3');
  assert.deepEqual(ids, ['1-2', '6-3']);
  const rows = runAll(ids, 1, ['average']);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.n, 1);
    assert.ok(r.revRatio > 0, `${r.id} earned something`);
    assert.ok(r.idlePct >= 0 && r.idlePct <= 1);
  }
  // 1-2 is the cutter tutorial: the first (and every) karen is the featured one
  assert.ok(rows[0].kinds.cutter >= 1);
  // the boss shift spawns the boss
  assert.equal(rows[1].kinds.boss, 1);
  const md = report(rows, 1);
  assert.match(md, /\| 1-2 \| 插隊阿伯 \|/);
  assert.match(md, /一般玩家細節/);
  applyMap();
});

test('featured karen comes first and the same kind is not spawned twice in a row', () => {
  const r = playShift('4-1', 'strong', 3);
  assert.equal(r.karens[0], 'hog');
  assert.equal(r.repeats, 0);
  applyMap();
});
