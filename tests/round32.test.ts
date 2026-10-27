// Round 32: every achievement has its Steam icons (unlocked + locked) and is in steam/achievements.csv, so a new one
// cannot ship without them (re-run `ONLY=achievements/ node store/src/steam-art.mjs` and `npx tsx steam/achievements.ts`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ACHIEVEMENTS } from '../shared/achievements.ts';

test('every achievement has Steam icons and a row in steam/achievements.csv', () => {
  const csv = readFileSync('steam/achievements.csv', 'utf8');
  const missing = ACHIEVEMENTS.filter(a => !existsSync(`store/steam/achievements/${a.id}.png`) || !existsSync(`store/steam/achievements/${a.id}_locked.png`)).map(a => a.id);
  assert.deepEqual(missing, [], 'icons missing');
  const rows = ACHIEVEMENTS.filter(a => !csv.includes(`"${a.id}"`)).map(a => a.id);
  assert.deepEqual(rows, [], 'not in the CSV');
});
