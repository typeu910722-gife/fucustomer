// Round 12: friend stores (server registry) and the raid round (sim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreRegistry, RAID_COOLDOWN_MS } from '../server/stores.ts';
import { addPlayer, createWorld, defaultSave, requestAct, requestDrop, tick, snapshot } from '../shared/sim.ts';
import { buildRaidConfig, raidReward } from '../shared/raid.ts';
import { applyMap, CURRENT_MAP, SHELVES } from '../shared/map.ts';
import { sanitizeProfile } from '../shared/career.ts';

test('store registry: owner token, lock, raids, cooldown and reports', () => {
  let now = 1_000_000;
  const saved: string[] = [];
  const reg = new StoreRegistry(s => saved.push(s.code), () => now);
  const c = reg.create({ name: '阿明的店', map: 'boba', money: 1000, rating: 3, shelves: { drinks: 5, snacks: 50, bento: -3 } });
  assert.ok(c.ok); if (!c.ok) return;
  assert.match(c.value.code, /^[A-Z0-9]{6}$/);
  assert.ok(!JSON.stringify([...reg.stores.values()]).includes(c.value.token), 'only the token hash is stored');
  const v = reg.get(c.value.code); assert.ok(v.ok);
  if (v.ok) { assert.equal(v.value.map, 'boba'); assert.deepEqual(v.value.shelves, { drinks: 5, snacks: 50, bento: 0 }); assert.ok(!('money' in v.value)); }
  // only the owner can update
  assert.equal((reg.update(c.value.code, 'nope', { locked: true }) as { status: number }).status, 403);
  assert.ok(reg.update(c.value.code, c.value.token, { locked: true }).ok);
  // locked: walking in fails, trash at the door works but is tiny
  assert.equal((reg.raid(c.value.code, 'ip1', { score: 500 }) as { status: number }).status, 423);
  const out = reg.raid(c.value.code, 'ip1', { score: 999, outside: true, raider: '小華' });
  assert.ok(out.ok); if (out.ok) { assert.equal(out.value.score, 30); assert.ok(out.value.money <= 15); }
  // cooldown per raider
  reg.update(c.value.code, c.value.token, { locked: false });
  assert.equal((reg.raid(c.value.code, 'ip1', { score: 100 }) as { status: number }).status, 429);
  now += RAID_COOLDOWN_MS + 1;
  const big = reg.raid(c.value.code, 'ip1', { score: 1e9 });
  assert.ok(big.ok); if (big.ok) { assert.equal(big.value.score, 2000); assert.ok(big.value.money <= 300); assert.ok(big.value.rating <= 0.3); }
  // reports go to the owner once
  assert.equal((reg.takeReports(c.value.code, 'x') as { status: number }).status, 403);
  const reps = reg.takeReports(c.value.code, c.value.token);
  assert.ok(reps.ok); if (reps.ok) assert.equal(reps.value.length, 2);
  const again = reg.takeReports(c.value.code, c.value.token); assert.ok(again.ok && again.value.length === 0);
  assert.equal(reg.get('ZZZZZZ').ok, false);
  assert.ok(saved.length >= 5);
});

test('raid round: the troublemaker knocks stock, heckles, litters and gets thrown out when watched', () => {
  const cfg = buildRaidConfig({ code: 'ABCDEF', name: '測試店', map: 'breakfast', rating: 4, locked: false, shelves: { drinks: 6, snacks: 6, bento: 6 } });
  const w = createWorld(defaultSave(), 3, cfg);
  assert.equal(CURRENT_MAP.id, 'breakfast');
  const r = addPlayer(w, 'r', '搗蛋鬼', 0xff0000);
  const clerk = addPlayer(w, 'c', '店員', 0x00ff00);
  assert.equal(r.raider, true); assert.ok(!clerk.raider);
  w.phase = 'open'; w.phaseLeft = 90;
  // the clerk can't make trouble, the raider can't work
  const sh = SHELVES[0];
  r.x = (sh.box.x0 + sh.box.x1) / 2; r.z = sh.box.z1 + 0.6;
  clerk.x = 20; clerk.z = 3;
  requestAct(w, 'c', 'a', 'knock', { t: 'shelf', product: sh.product });
  for (let t = 0; t < 0.8; t += 0.05) tick(w, 0.05);
  assert.equal(w.raid!.knocked, 0);
  const before = w.shelves[sh.product];
  requestAct(w, 'r', 'b', 'knock', { t: 'shelf', product: sh.product });
  for (let t = 0; t < 0.8; t += 0.05) tick(w, 0.05);
  assert.equal(w.raid!.knocked, 1); assert.ok(w.shelves[sh.product] < before);
  requestDrop(w, 'r', 'd1'); requestDrop(w, 'r', 'd2'); // second one is on cooldown
  assert.equal(w.raid!.litter, 1);
  const s = snapshot(w, 0);
  assert.ok(s.raid && s.raid.score >= 17); assert.ok(s.players.find(p => p.id === 'r')?.raider);
  // the clerk stands next to the raider long enough: thrown out, round over (still counts as played)
  clerk.x = r.x + 0.5; clerk.z = r.z;
  for (let t = 0; t < 4 && !w.result; t += 0.05) { clerk.x = r.x + 0.5; clerk.z = r.z; tick(w, 0.05); }
  assert.ok(w.raid!.caught); assert.ok(w.result); assert.equal(w.result!.won, true);
  assert.equal(w.result!.score, w.raid!.score);
  assert.equal(raidReward(w.raid!.score), Math.min(80, Math.round(w.raid!.score * 0.1)));
  applyMap();
});

test('raid round ends on the timer and the online store info survives a save round-trip', () => {
  const w = createWorld(defaultSave(), 4, buildRaidConfig({ code: 'ABCDEF', name: 'x', map: 'convenience', rating: 3, locked: false, shelves: {} }));
  addPlayer(w, 'r', 'r', 1);
  w.phase = 'open'; w.phaseLeft = 1;
  for (let t = 0; t < 5 && !w.result; t += 0.05) tick(w, 0.05);
  assert.ok(w.result); assert.equal(w.raid!.caught, false);
  const p = sanitizeProfile({ store: { name: 'a', invested: 2500, save: defaultSave(), days: 1, negDays: 0, staff: { name: 'x', mood: 50, quit: false }, wage: 'fair', bestDay: 0, withdrawn: 0, map: 'boba', online: { code: 'ABC123', token: 't'.repeat(24), locked: true } } });
  assert.deepEqual(p.store?.online, { code: 'ABC123', token: 't'.repeat(24), locked: true });
  const bad = sanitizeProfile({ store: { name: 'a', invested: 2500, save: defaultSave(), days: 1, negDays: 0, staff: { name: 'x', mood: 50, quit: false }, wage: 'fair', bestDay: 0, withdrawn: 0, map: 'boba', online: { code: '<script>', token: 1 } } });
  assert.equal(bad.store?.online, undefined);
  applyMap();
});
