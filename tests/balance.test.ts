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

// ---------------- round 28 (第五輪): 照規矩處理 (proper) mode ----------------
import { Room } from '../shared/room.ts';
import { Bot, botMessages, type BotStyle } from '../shared/bot.ts';
import { CHAPTERS, buildShiftConfig, newProfile } from '../shared/career.ts';
import { GEN_KINDS, KAREN_INFO, type GenKind } from '../shared/constants.ts';
import { GUARD_SKIP, TYPHOON } from '../shared/genkarens.ts';
import { buildSpecialConfig } from '../shared/specialdays.ts';
import { profileFor } from '../scripts/balance.ts';

/** A chapter-4 shift (grabbing unlocked) whose only karen is `k`; returns how each of them ended. */
function oneKarenShift(k: GenKind, style: BotStyle, seed = 4) {
  const p = profileFor(4, CHAPTERS[3].minLevel, 'strong');
  const cfg = buildShiftConfig(p, '4-3');
  assert.ok(cfg.abilities.includes('grab'), 'chapter 4 can grab');
  Object.assign(cfg, { karens: [k], firstKaren: 6, karenEvery: 22, maxKarens: 1, length: 170, boss: false });
  cfg.mods = { ...cfg.mods, guard: 0 }; // no 保全: every karen is the bot's to deal with
  let t = 0;
  const room = new Room('P', null, { solo: true, now: () => t, shift: cfg, seed });
  const c: any = { snap: null, send(msg: any) { if (msg.type === 'snap') c.snap = msg.s; if (msg.type === 'welcome') c.pid = msg.playerId; }, close() {} };
  room.join(c, 'bot', undefined); room.startGame();
  const bot = new Bot('any', 0.3, style); let r = 0;
  const seen = new Set<number>(), held = new Set<number>(), handled = new Set<number>();
  for (let s = 0; s < 230 && !room.world!.result; s += 0.05) {
    t += 50; room.update(0.05);
    const w = room.world!;
    for (const cu of w.customers) if (cu.kind === k && cu.leader == null) {
      seen.add(cu.id);
      if (cu.heldBy || cu.fly) held.add(cu.id);
      if (cu.resolved && !cu.ejected && w.phase === 'open') handled.add(cu.id);
    }
    const sn = c.snap; if (!sn) continue;
    for (const msg of botMessages(bot.update(sn, sn.players[0], 0.05), () => 'r' + r++)) room.handle(c.pid, msg);
  }
  const w = room.world!;
  return { seen: seen.size, held: held.size, handled: handled.size, byMechanic: w.handled[k] ?? 0, failed: w.dayStats.karensFailed, ejected: w.dayStats.ejected };
}

test('proper-mode bot resolves every general karen by its own mechanic, never by grabbing and throwing', () => {
  for (const k of GEN_KINDS) {
    const r = oneKarenShift(k, { proper: true, changeErr: 0.1, think: 1 });
    assert.ok(r.seen >= 3, `${k}: ${r.seen} appeared`);
    assert.equal(r.held, 0, `${KAREN_INFO[k].name}: proper mode grabbed one`);
    assert.equal(r.ejected, 0, `${KAREN_INFO[k].name}: proper mode threw one out`);
    // escort to the 對獎機 / exact change / stopped at the door / leader persuaded — each counts as handled
    assert.ok(r.handled >= 2 && r.byMechanic >= 2, `${KAREN_INFO[k].name}: handled ${r.handled} of ${r.seen} (failed ${r.failed})`);
  }
  // the default bot, same shift: grabs and throws them out (why the harness needs --proper to measure the mechanics)
  const d = oneKarenShift('lottery', {});
  assert.ok(d.held >= 1 && d.ejected >= 1, `default bot threw out ${d.ejected}`);
  applyMap();
});

test('proper-mode change quick-time: a player who always picks the wrong handful lets 找零計較姐 get away', () => {
  const good = oneKarenShift('change', { proper: true, changeErr: 0, think: 0.5 });
  assert.equal(good.failed, 0);
  const bad = oneKarenShift('change', { proper: true, changeErr: 1, think: 0.5 });
  assert.equal(bad.byMechanic, 0, 'never the right change');
  assert.ok(bad.failed >= 1, `wrong change every time: ${bad.failed} failed`);
  applyMap();
});

test('harness --proper: nobody is thrown out unless violent; 颱風夜 snack pile and the guard leaving the till karens alone', () => {
  const pr = playShift('4-3', 'average', 1000, true), df = playShift('4-3', 'average', 1000);
  const sum = (o: typeof pr.outcomes, f: 'thrown' | 'ok') => Object.values(o).reduce((a, x) => a + x[f], 0);
  assert.equal(sum(pr.outcomes, 'thrown'), 0, 'proper mode threw a karen out');
  assert.ok(sum(pr.outcomes, 'ok') >= 1);
  assert.ok(sum(df.outcomes, 'thrown') >= 1, 'the default bot throws');
  // 颱風夜: noodles piled on the snack shelf before opening (the hoarders empty it otherwise)
  const prof = newProfile(); prof.level = 12; for (let c = 1; c <= 3; c++) for (let i = 1; i <= 5; i++) prof.stars[`${c}-${i}`] = 1;
  const cfg = buildSpecialConfig(prof, 'typhoon');
  assert.equal(cfg.start.shelves.snacks, buildShiftConfig(prof, '4-3').start.shelves.snacks + TYPHOON.prestock);
  assert.ok(TYPHOON.prestock > 0);
  assert.deepEqual([...GUARD_SKIP].sort(), ['change', 'lottery']);
  applyMap();
});
