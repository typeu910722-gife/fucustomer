import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, unlockedAchievements } from '../shared/achievements.ts';
import { CHAPTERS, newProfile } from '../shared/career.ts';

test('achievement ids are unique Steam-style API names', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9_]+$/);
});

test('fresh profile has no achievements; progress unlocks them', () => {
  const p = newProfile();
  assert.deepEqual(unlockedAchievements(p), []);
  p.stats.wins = 1; p.stats.ejected = 1;
  for (const s of CHAPTERS[0].shifts) p.clears[s.id] = 1;
  const got = unlockedAchievements(p);
  assert.ok(got.includes('FIRST_SHIFT') && got.includes('FIRST_THROW') && got.includes('CH1'));
  assert.ok(!got.includes('CH2') && !got.includes('BOSS'));
  p.clears['6-3'] = 1; p.level = 30;
  assert.ok(unlockedAchievements(p).includes('BOSS') && unlockedAchievements(p).includes('LV30'));
});

test('combo achievement comes from the shift result', () => {
  const p = newProfile();
  const r = { shiftId: '3-1', won: true, failReason: '', revenue: 0, goal: 0, rating: 3, chaos: 0, served: 0, angryLeft: 0, karensResolved: 0, karensFailed: 0, ejected: 5, cleaned: 0, maxCombo: 5 };
  assert.ok(unlockedAchievements(p, r).includes('COMBO_5'));
});
