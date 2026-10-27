// Round 30b: regressions for what the round-30 monkey sweep (tests/e2e/monkey.mjs) found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BTN, GAME_BINDINGS, menuSwallowsBinding } from '../client/src/padmap.ts';

test('pad: while a menu has the pad, only the D-pad (menu navigation) is held back from its in-shift action', () => {
  // ↓ is 採購 in a shift: in the shop it must move the focus, not close the shop
  for (const b of [BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT]) assert.equal(menuSwallowsBinding(b), true);
  // Start (pause toggle), View (emote wheel), A / B (wheel send / cancel) keep working while an overlay is open
  for (const b of [BTN.MENU, BTN.VIEW, BTN.A, BTN.B, BTN.X, BTN.Y, BTN.LB, BTN.RB]) assert.equal(menuSwallowsBinding(b), false);
  const shop = GAME_BINDINGS.find(([, a]) => a === 'shop');
  assert.ok(shop && menuSwallowsBinding(shop[0]), 'the shop button is one the menu swallows');
});

test('雲端備份: a 200 answer that is not the game server\'s (portal page, {}) is rejected before use', async () => {
  const { isUploadAnswer, isCloudView, isDeleteAnswer } = await import('../shared/cloudsave.ts');
  const summary = { level: 12, rank: '店長', stars: 3, wallet: 1, shifts: 1, achievements: 0, cosmetics: 0, soloSaves: 0, ownStore: false, at: 1, storeLevel: 0, branches: 0 };
  const entry = { code: 'FUC1-x', at: 1, size: 6, summary };
  assert.equal(isUploadAnswer({ at: 1, size: 9, summary, used: 1, max: 20 }), true);
  assert.equal(isCloudView({ latest: entry, prev: null, quota: { used: 1, max: 20, resetsAt: 2 } }), true);
  assert.equal(isCloudView({ latest: entry, prev: entry }), true);
  assert.equal(isDeleteAnswer({ deleted: false }), true);
  for (const junk of [{}, null, [], 'html', { what: 1 }, { at: 1, summary: {} }, { latest: {} }, { latest: entry, prev: { code: 1 } }, { deleted: 'yes' }]) {
    assert.equal(isUploadAnswer(junk), false, JSON.stringify(junk));
    assert.equal(isCloudView(junk), false, JSON.stringify(junk));
    if (!(junk && typeof junk === 'object' && 'deleted' in junk && typeof (junk as { deleted: unknown }).deleted === 'boolean')) assert.equal(isDeleteAnswer(junk), false, JSON.stringify(junk));
  }
});
