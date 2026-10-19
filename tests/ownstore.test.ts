// Round 10: your own store — opening, staff wages and mood, bankruptcy, withdrawing and closing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, sanitizeProfile } from '../shared/career.ts';
import { STORE_FUND, STORE_RESERVE, canOpenStore, closeStore, hireStaff, openStore, ownStoreConfig, settleStoreDay, staffPace, withdraw } from '../shared/ownstore.ts';
import { createWorld, dayConfig, defaultSave, tick } from '../shared/sim.ts';

function graduate(wallet: number) { const p = newProfile(); p.level = 30; p.stars['6-3'] = 2; p.wallet = wallet; return p; }

test('opening needs the main story finished and the fund; capital moves from savings into the till', () => {
  const p = newProfile(); p.wallet = 9999;
  assert.equal(canOpenStore(p).ok, false);
  const poor = graduate(STORE_FUND - 1);
  assert.match(canOpenStore(poor).why ?? '', /差 \$1/);
  const g = graduate(4000);
  const st = openStore(g, '阿明商店', STORE_FUND, defaultSave())!;
  assert.equal(g.wallet, 4000 - STORE_FUND); assert.equal(st.save.money, STORE_FUND); assert.equal(st.name, '阿明商店');
  assert.equal(canOpenStore(g).ok, false, 'one store at a time');
  const all = graduate(4000); openStore(all, '', 4000, defaultSave());
  assert.equal(all.wallet, 0); assert.equal(all.store!.save.money, 4000); assert.equal(all.store!.name, '我的便利商店');
});

test('the staff wage is charged by the nightly settlement in the simulation', () => {
  const g = graduate(3000); openStore(g, 'x', STORE_FUND, defaultSave());
  g.store!.wage = 'kind';
  const cfg = ownStoreConfig(g, dayConfig());
  assert.equal(cfg.staffWage, 140); assert.ok(cfg.abilities.includes('hit'));
  const w = createWorld(g.store!.save, 1, cfg);
  w.phase = 'closing'; w.phaseLeft = 0.01; w.customers = [];
  const before = w.money;
  tick(w, 0.05);
  assert.equal(w.phase, 'summary');
  assert.equal(w.saveOut!.money, before + w.dayStats.bonus - 60 - 140);
});

test('stingy pay drags the employee down until they quit; kind pay speeds them up', () => {
  const g = graduate(3000); openStore(g, 'x', STORE_FUND, defaultSave());
  g.store!.wage = 'stingy';
  let quit = false;
  for (let d = 0; d < 6 && !quit; d++) quit = settleStoreDay(g, { ...g.store!.save, money: g.store!.save.money + 50 }).quit;
  assert.equal(quit, true); assert.equal(g.store!.staff.quit, true);
  assert.equal(hireStaff(g), true); assert.equal(g.store!.staff.quit, false);
  assert.ok(staffPace(90) > staffPace(50) && staffPace(50) > staffPace(10));
});

test('three nights in the red (or zero rating) close the store and the investment is lost', () => {
  const g = graduate(3000); openStore(g, 'x', STORE_FUND, defaultSave());
  const red = { ...g.store!.save, money: -50 };
  assert.equal(settleStoreDay(g, red).bankrupt, false);
  assert.equal(settleStoreDay(g, { ...red, money: 20 }).bankrupt, false, 'a good night resets the streak');
  settleStoreDay(g, red); settleStoreDay(g, red);
  const out = settleStoreDay(g, red);
  assert.equal(out.bankrupt, true); assert.match(out.reason, /3 天/);
  assert.equal(g.store, null); assert.equal(g.storeHistory.lost, STORE_FUND); assert.equal(g.wallet, 3000 - STORE_FUND);

  const h = graduate(3000); openStore(h, 'x', STORE_FUND, defaultSave());
  for (let i = 0; i < 2; i++) assert.equal(settleStoreDay(h, { ...h.store!.save, rating: 0 }).bankrupt, false);
  assert.equal(settleStoreDay(h, { ...h.store!.save, rating: 0 }).bankrupt, true);
});

test('withdraw keeps a reserve; closing returns the cash; the store survives save/load', () => {
  const g = graduate(3000); openStore(g, '小店', STORE_FUND, defaultSave());
  g.store!.save = { ...g.store!.save, money: 1000 };
  assert.equal(withdraw(g), 1000 - STORE_RESERVE); assert.equal(g.store!.save.money, STORE_RESERVE);
  const back = sanitizeProfile(JSON.parse(JSON.stringify(g)));
  assert.equal(back.store!.name, '小店'); assert.equal(back.store!.save.money, STORE_RESERVE);
  assert.equal(sanitizeProfile({ ...JSON.parse(JSON.stringify(g)), store: { name: 'x' } }).store, null, 'broken store data is dropped');
  const wallet = g.wallet;
  assert.equal(closeStore(g), STORE_RESERVE); assert.equal(g.wallet, wallet + STORE_RESERVE); assert.equal(g.store, null);
});
