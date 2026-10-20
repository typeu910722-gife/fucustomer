// 「全台奧客圖鑑」 and the after-story lines (shared/karendex.ts): every karen has an entry, every signature karen has
// after-story lines, handled counts go from the shift result into the career profile, old saves load, achievement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTERMATH, DEX, DEX_ORDER, aftermathLine, addHandled, dexCount, lineText, sanitizeDex } from '../shared/karendex.ts';
import { SIG_KINDS } from '../shared/sigkarens.ts';
import { KAREN_INFO } from '../shared/constants.ts';
import { applyResult, newProfile, sanitizeProfile, type ShiftResult } from '../shared/career.ts';
import { unlockedAchievements, updateAchievements } from '../shared/achievements.ts';
import { buildShiftConfig } from '../shared/career.ts';
import { addPlayer, createWorld, defaultSave, finishShift } from '../shared/sim.ts';

test('every karen kind has a 圖鑑 entry, and every signature karen has 2–3 after-story lines plus a failure line', () => {
  assert.deepEqual([...DEX_ORDER].sort(), Object.keys(KAREN_INFO).sort(), 'the 圖鑑 lists every karen kind once');
  for (const k of DEX_ORDER) assert.ok(DEX[k].note.length >= 20 && DEX[k].icon && DEX[k].where, k);
  assert.deepEqual(Object.keys(AFTERMATH).sort(), [...SIG_KINDS].sort());
  for (const k of SIG_KINDS) {
    const a = AFTERMATH[k];
    assert.ok(a.ok.length >= 2 && a.ok.length <= 3, `${k}: ${a.ok.length} success lines`);
    assert.ok(a.fail.text.length > 5, `${k}: failure line`);
    for (const l of [...a.ok, a.fail]) assert.ok(['boss', 'fen', 'lin'].includes(l.who) && l.text.length <= 60, `${k}: ${l.text}`);
    // the id picks a line deterministically; every line can come up
    const seen = new Set<string>();
    for (let id = 0; id < 60; id++) { const l = aftermathLine(k, true, id)!; assert.equal(aftermathLine(k, true, id), l); seen.add(l.text); }
    assert.equal(seen.size, a.ok.length, `${k}: all success lines are used`);
    assert.equal(aftermathLine(k, false, 3), a.fail);
  }
  assert.equal(aftermathLine('cutter', true, 1), null, 'classic karens have no after-story line');
  assert.match(lineText(AFTERMATH.wiper.fail), /^🤑 錢董：/);
});

const result = (handled?: Record<string, number>): ShiftResult => ({ shiftId: '9-3', won: true, failReason: '', revenue: 500, goal: 420, rating: 3.5, chaos: 10, served: 20, angryLeft: 0, karensResolved: 3, karensFailed: 0, ejected: 0, cleaned: 0, maxCombo: 0, handled });

test('handled counts go from the shift result into the career profile; old saves and junk are sanitized', () => {
  const p = newProfile();
  assert.deepEqual(p.dex, {});
  applyResult(p, result({ wiper: 2, cutter: 1 }));
  applyResult(p, result({ wiper: 1 }));
  applyResult(p, result()); // results from older builds have no tally
  assert.deepEqual(p.dex, { wiper: 3, cutter: 1 });
  assert.equal(dexCount(p.dex), 2); assert.equal(dexCount(p.dex, true), 1);
  // round trip, and a save from before the 圖鑑 existed
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(p))).dex, { wiper: 3, cutter: 1 });
  const old = JSON.parse(JSON.stringify(p)); delete old.dex;
  assert.deepEqual(sanitizeProfile(old).dex, {});
  assert.deepEqual(sanitizeDex({ wiper: 2.7, cutter: -4, nope: 3, __proto__x: 1, coins: 'x', rx: 1e12 }), { wiper: 2, rx: 1e6 });
  assert.deepEqual(sanitizeDex([1, 2]), {}); assert.deepEqual(sanitizeDex('x'), {});
  const d: Record<string, number> = {}; addHandled(d, { evil: 5, reader: 1 } as Record<string, number>); assert.deepEqual(d, { reader: 1 });
});

test('the simulation reports handled karens by kind in the shift result', () => {
  const cfg = buildShiftConfig(newProfile(), '1-1');
  const w = createWorld(defaultSave(), 3, cfg); addPlayer(w, 'a', 'A', 0);
  w.handled = { wiper: 1, boss: 1 };
  finishShift(w, '');
  assert.deepEqual(w.result!.handled, { wiper: 1, boss: 1 });
  const w2 = createWorld(defaultSave(), 3, cfg); finishShift(w2, '');
  assert.equal(w2.result!.handled, undefined, 'no tally when nothing was handled');
});

test('圖鑑全收集: every signature karen handled at least once', () => {
  const p = newProfile();
  const all = Object.fromEntries(SIG_KINDS.map(k => [k, 1]));
  delete all.coins;
  applyResult(p, result(all));
  assert.ok(!unlockedAchievements(p).includes('DEX_ALL'), 'one missing');
  applyResult(p, result({ coins: 1 }));
  assert.ok(updateAchievements(p).some(a => a.id === 'DEX_ALL'));
  assert.ok(p.achievements.includes('DEX_ALL'));
});
