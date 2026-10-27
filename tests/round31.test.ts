// Round 31: the first checkout of 1-1 is quick on the game's side. round25c (browser) allows 12 in-game seconds from
// opening to the first checkout and missed it once at 12.7 s under load; with a player who is at the till and presses
// as soon as the customer arrives, the game itself takes under 6 s for every seed (the rest is the page round trip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createWorld, defaultSave, requestAct, setReady, tick } from '../shared/sim.ts';
import { buildShiftConfig, newProfile } from '../shared/career.ts';
import { COUNTER, REGISTERS } from '../shared/map.ts';

test('1-1: the express customer is checked out within 6 in-game s of opening (30 seeds)', () => {
  const slow: string[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const w = createWorld(defaultSave(), seed, buildShiftConfig(newProfile(), '1-1'));
    addPlayer(w, 'p1', 'P1', 0xff0000); setReady(w, 'p1', true);
    for (let i = 0; i < 2000 && w.phase === 'prep'; i++) tick(w, 0.05);
    assert.equal(w.phase, 'open');
    const p = w.players.get('p1')!, t0 = w.time;
    for (let i = 0; i < 400 && !w.dayStats.served; i++) {
      p.x = REGISTERS[0].x; p.z = COUNTER.z0 - 0.4;
      if (w.customers.some(c => c.state === 'atRegister')) requestAct(w, 'p1', `r${i}`, 'checkout', { t: 'register', idx: 0 });
      tick(w, 0.05);
    }
    const t = w.time - t0;
    if (!w.dayStats.served || t > 6) slow.push(`seed ${seed}: ${w.dayStats.served ? t.toFixed(1) + ' s' : 'never'}`);
  }
  assert.deepEqual(slow, []);
});
