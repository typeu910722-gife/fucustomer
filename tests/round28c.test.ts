// Round 28c: regressions for what the monkey test (tests/e2e/monkey.mjs) found in stored data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanServerUrl, sanitizeSettings } from '../client/src/storage.ts';
import { newProfile, allShifts, sanitizeProfile } from '../shared/career.ts';
import { openStore } from '../shared/ownstore.ts';
import { openBranch } from '../shared/progression.ts';
import { defaultSave } from '../shared/sim.ts';

test('自訂伺服器: only ws:// / wss:// addresses are kept (what the settings screen now saves)', () => {
  assert.equal(cleanServerUrl(' wss://example.com/ws '), 'wss://example.com/ws');
  assert.equal(cleanServerUrl('ws://192.168.0.2:8787/ws'), 'ws://192.168.0.2:8787/ws');
  for (const junk of ['xxxxxxxx', 'https://example.com', 'FUC1-eyJ2Ijox', 'wss://has space', '', 42, null]) assert.equal(cleanServerUrl(junk), '');
});

test('settings survive their own sanitizer unchanged (what is saved is what loads)', () => {
  const s = sanitizeSettings({ quality: 'medium', textScale: 1.3, colorblind: 'by', serverUrl: 'junk', fpsCap: 30, name: '阿明' }, false, false);
  assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(s)), false, false), s);
});

test('a late profile with an own store and a branch is stable under sanitizeProfile', () => {
  const p = newProfile();
  p.level = 34; p.wallet = 900000;
  for (const s of allShifts()) { p.stars[s.id] = 3; p.clears[s.id] = 1; }
  openStore(p, '猴子小舖', 20000, defaultSave(), 'convenience');
  p.store!.prog = { xp: 99999, days: 40, streak: 0, bestStreak: 0, bestRevenue: 0, bestKarens: 0 };
  assert.ok(openBranch(p, 'cafe', '猴子咖啡', defaultSave()));
  const once = sanitizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(once))), once);
});
