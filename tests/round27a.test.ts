// Round 27a: four general karens (發票對獎魔人, 找零計較姐, 免費袋子阿伯, 借廁所大隊), each handled its own way, and the
// 特殊營業日 (颱風夜 / 跨年夜) as daily / weekly modifiers and a free-play option with a reward.
// Simulation-level tests (the authoritative sim, no browser); the bot test drives the real protocol through a Room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createWorld, dayConfig, defaultSave, requestAct, snapshot, tick, World, Customer, PlayerState } from '../shared/sim.ts';
import { buildShiftConfig, buildDailyConfig, dailyPlan, newProfile, sanitizeProfile, ROUND27_DATE, DAILY_MODS, type ShiftResult } from '../shared/career.ts';
import { GEN_KINDS, KAREN_INFO, type GenKind } from '../shared/constants.ts';
import { DEX, DEX_ORDER, GEN_AFTERMATH, addHandled, aftermathLine, dexCount, sanitizeDex } from '../shared/karendex.ts';
import { ENTRANCE, KIOSK_SPOT, REGISTERS, STORE_D, TOILET_SPOT, applyMap } from '../shared/map.ts';
import { GEN_TUNE, SPECIAL_CLOCK, SPECIAL_DAYS, SPECIAL_IDS, changeAnswer, changeDue, changeOptions, coinTotal, bagmanAtDoor } from '../shared/genkarens.ts';
import { applySpecialResult, buildSpecialConfig, specialOfShift, specialShiftId, SPECIAL_FIRST_BONUS } from '../shared/specialdays.ts';
import { ROUND27_WEEK, TWIST_IDS, buildWeeklyConfig, weeklyPlan } from '../shared/weekly.ts';
import { Room } from '../shared/room.ts';
import { Bot, botMessages } from '../shared/bot.ts';
import { unlockedAchievements } from '../shared/achievements.ts';

function world(karens: GenKind[] = [], patch: Record<string, unknown> = {}) {
  const p = newProfile(); p.level = 5; // no grabbing: every karen must be handled the proper way
  const cfg = buildShiftConfig(p, '1-1');
  Object.assign(cfg, { karens, firstKaren: 1e9, ...patch });
  const w = createWorld(defaultSave(), 9, cfg);
  w.phase = 'open'; w.phaseLeft = 999; w.spawnTimer = 1e9;
  return w;
}
function cust(w: World, kind: Customer['kind'], x: number, z: number, extra: Partial<Customer> = {}): Customer {
  const c: Customer = {
    id: w.nextId++, kind, x, z, yaw: 0, state: 'wander', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false,
    foodFailed: false, patience: 400, patienceMax: 400, mood: 80, timer: 0, register: -1, anger: 0, resolved: false, hits: 0,
    eaten: [], eatShelf: null, life: 40, lifeMax: 40, look: 5, angry: false, moving: false, knockTimer: 4, gone: false, heldBy: null, fly: null, phase: 0, minions: [], ...extra,
  };
  w.customers.push(c); return c;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) tick(w, 0.05); };
let rid = 0;
const act = (w: World, p: PlayerState, kind: Parameters<typeof requestAct>[3], c: Customer, opt?: number) => {
  w.results = [];
  requestAct(w, p.id, 'r' + rid++, kind, { t: 'customer', id: c.id }, opt);
  return w.results[w.results.length - 1];
};
/** A general karen standing at the first till, blocking it. */
function atTill(w: World, kind: GenKind, extra: Partial<Customer> = {}) {
  const r = REGISTERS[0];
  const c = cust(w, kind, r.customer.x, r.customer.z, { state: 'atRegister', items: ['drinks'], register: 0, ...extra });
  w.registers[0] = c.id; return c;
}
const cashier = (w: World) => { const p = addPlayer(w, 'a', 'A', 1); p.x = REGISTERS[0].cashier.x; p.z = REGISTERS[0].cashier.z; return p; };

// ---------------- data, 圖鑑 and save compatibility ----------------
test('the four general karens are described everywhere: intro card, 圖鑑, after-story lines', () => {
  assert.deepEqual([...GEN_KINDS].sort(), ['bagman', 'change', 'lottery', 'toilet']);
  for (const k of GEN_KINDS) {
    assert.ok(KAREN_INFO[k].name && KAREN_INFO[k].hint.length > 10 && KAREN_INFO[k].how.length > 10, k);
    assert.ok(DEX_ORDER.includes(k) && DEX[k].note.length >= 20, k);
    assert.ok(GEN_AFTERMATH[k].ok.length >= 2 && GEN_AFTERMATH[k].fail.text, k);
    assert.ok(aftermathLine(k, true, 3) && aftermathLine(k, false), k);
  }
  assert.equal(aftermathLine('cutter', true), null, 'the classic karens still have no after-story line');
});

test('save compat: 圖鑑 counts keep old kinds, accept the new kinds, and old profiles load unchanged', () => {
  const old = { cutter: 2, wiper: 1, bogus: 4 };
  assert.deepEqual(sanitizeDex(old), { cutter: 2, wiper: 1 });
  const p = newProfile();
  addHandled(p.dex, { cutter: 1, lottery: 2, toilet: 1, nope: 9 });
  assert.deepEqual(p.dex, { cutter: 1, lottery: 2, toilet: 1 });
  assert.equal(dexCount(p.dex), 3); assert.equal(dexCount(p.dex, true), 0, 'general karens are not store-signature karens');
  assert.ok(!unlockedAchievements(p).includes('DEX_ALL'));
  const back = sanitizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(back.dex, p.dex);
  // a profile saved before round 27: no `special` record, dex without the new kinds
  const before = JSON.parse(JSON.stringify(p)); delete before.special; before.dex = { cutter: 5 };
  const s = sanitizeProfile(before);
  assert.deepEqual(s.special, {}); assert.deepEqual(s.dex, { cutter: 5 }); assert.equal(dexCount(s.dex), 1);
  // junk in the special record is dropped
  assert.deepEqual(sanitizeProfile({ ...before, special: { typhoon: { date: 'x', best: -3, wins: 2, rewarded: true }, mars: { wins: 1 } } }).special,
    { typhoon: { date: '', best: 0, rewarded: false, wins: 2 } });
});

// ---------------- 發票對獎魔人 ----------------
test('發票對獎魔人 blocks the till; walked to the 對獎機 he is handled, then pays like everyone else', () => {
  const w = world(['lottery']);
  const c = atTill(w, 'lottery', { life: 45, lifeMax: 45 });
  const p = cashier(w);
  w.results = []; requestAct(w, p.id, 'co', 'checkout', { t: 'register', idx: 0 });
  assert.equal(w.results[0].ok, false); assert.match(w.results[0].reason!, /對獎機/);
  p.x = c.x; p.z = c.z - 0.8;
  assert.equal(act(w, p, 'escort', c).ok, true);
  run(w, 1);
  assert.equal(c.state, 'toKiosk'); assert.equal(w.registers[0], null, 'the till is free again');
  // walk along with him (a worker within 3 m)
  for (let i = 0; i < 400 && c.state === 'toKiosk'; i++) { p.x = c.x + 0.8; p.z = c.z; tick(w, 0.05); }
  assert.equal(c.state, 'kiosk'); assert.equal(c.resolved, true);
  assert.ok(Math.hypot(c.x - KIOSK_SPOT.x, c.z - KIOSK_SPOT.z) < 0.3);
  assert.equal(w.handled.lottery, 1);
  run(w, 8);
  assert.ok(['queue', 'toRegister', 'atRegister'].includes(c.state), 'back in line to pay: ' + c.state);
  applyMap();
});

test('發票對獎魔人 left alone stops, then runs back to cut in at the till; ignored he cashes a prize from the till', () => {
  const w = world(['lottery']);
  const c = atTill(w, 'lottery', { life: 45, lifeMax: 45 });
  const p = cashier(w); p.x = c.x; p.z = c.z - 0.8;
  act(w, p, 'escort', c);
  run(w, 0.9);
  p.x = 22; p.z = 2; // the worker walks off
  const at = { x: c.x, z: c.z };
  run(w, 2);
  assert.ok(Math.hypot(c.x - at.x, c.z - at.z) < 0.6, 'he waits for an escort');
  run(w, 3);
  assert.ok(['queue', 'toRegister', 'atRegister'].includes(c.state), 'back to the till: ' + c.state);
  assert.equal(c.resolved, false);
  const w2 = world(['lottery']);
  const c2 = atTill(w2, 'lottery', { life: 2, lifeMax: 45 });
  const money = w2.money;
  run(w2, 3);
  assert.equal(c2.resolved, true); assert.equal(w2.dayStats.karensFailed, 1); assert.equal(w2.money, money - 20);
  applyMap();
});

// ---------------- 找零計較姐 ----------------
test('找零計較姐: the exact-change prompt has one right handful; right = handled and paid at once, wrong = she recounts', () => {
  for (let look = 0; look < 60; look++) {
    const o = changeOptions(look);
    assert.equal(o.length, 3);
    assert.equal(o.filter(x => x.ok).length, 1);
    assert.equal(o.findIndex(x => x.ok), changeAnswer(look));
    assert.equal(o[changeAnswer(look)].total, changeDue(look));
    assert.equal(new Set(o.map(x => x.total)).size, 3, 'three different amounts');
    for (const x of o) assert.equal(coinTotal(x.counts), x.total);
  }
  const w = world(['change']);
  const c = atTill(w, 'change', { look: 7, life: 40 });
  const p = cashier(w);
  w.results = []; requestAct(w, p.id, 'co', 'checkout', { t: 'register', idx: 0 });
  assert.equal(w.results[0].ok, false);
  p.x = c.x; p.z = c.z - 0.8;
  assert.equal(act(w, p, 'exactChange', c).ok, false, 'needs a choice');
  assert.equal(act(w, p, 'exactChange', c, 7).ok, false, 'choice out of range');
  const wrong = (changeAnswer(7) + 1) % 3;
  assert.equal(act(w, p, 'exactChange', c, wrong).ok, true);
  assert.equal(c.resolved, false); assert.equal(c.life, 40 - GEN_TUNE.change.wrongCost); assert.equal(c.hits, 1);
  const rev = w.dayStats.revenue;
  assert.equal(act(w, p, 'exactChange', c, changeAnswer(7)).ok, true);
  assert.equal(c.resolved, true); assert.equal(c.state, 'leaving');
  assert.ok(w.dayStats.revenue > rev, 'she paid on the spot'); assert.equal(w.handled.change, 1);
  applyMap();
});

test('找零計較姐: counting along with her is the slow way (a long action, then a normal checkout); ignored she walks off', () => {
  const w = world(['change']);
  const c = atTill(w, 'change', { life: 40 });
  const p = cashier(w); p.x = c.x; p.z = c.z - 0.8;
  assert.equal(act(w, p, 'countChange', c).ok, true);
  assert.ok(p.busy && p.busy.dur >= 3, 'a long action');
  run(w, 1.5); assert.equal(c.resolved, false);
  run(w, 2.2); assert.equal(c.resolved, true); assert.equal(c.state, 'atRegister', 'still has to pay at the till');
  p.x = REGISTERS[0].cashier.x; p.z = REGISTERS[0].cashier.z;
  w.results = []; requestAct(w, p.id, 'co2', 'checkout', { t: 'register', idx: 0 });
  assert.equal(w.results[0].ok, true);
  const w2 = world(['change']);
  atTill(w2, 'change', { life: 1 });
  run(w2, 2);
  assert.equal(w2.dayStats.karensFailed, 1);
  applyMap();
});

// ---------------- 免費袋子阿伯 ----------------
test('免費袋子阿伯 bags goods, heads out, and can only be stopped at the door', () => {
  const w = world(['bagman']);
  const c = cust(w, 'bagman', 11, 9, { state: 'wander', life: 9, lifeMax: 28, knockTimer: 1, speed: 1.5 });
  const stock = Object.values(w.shelves).reduce((a, b) => a + b, 0);
  const p = addPlayer(w, 'a', 'A', 1); p.x = 22; p.z = 2;
  run(w, 3.6);
  assert.ok(c.eaten.length >= 1, 'something went into the bag');
  assert.equal(Object.values(w.shelves).reduce((a, b) => a + b, 0), stock - c.eaten.length);
  p.x = c.x; p.z = c.z - 0.8;
  const r = act(w, p, 'stopBag', c);
  assert.equal(r.ok, false); assert.match(r.reason!, /門口/);
  p.x = 22; p.z = 2;
  for (let i = 0; i < 400 && c.state !== 'toExit'; i++) tick(w, 0.05);
  assert.equal(c.state, 'toExit');
  for (let i = 0; i < 600 && !bagmanAtDoor(c); i++) tick(w, 0.05);
  assert.ok(bagmanAtDoor(c), 'reached the door zone');
  p.x = c.x; p.z = c.z - 1;
  assert.equal(act(w, p, 'stopBag', c).ok, true);
  run(w, 0.7);
  assert.equal(c.resolved, true); assert.ok(c.items.length >= 1); assert.equal(c.eaten.length, 0);
  assert.ok(['queue', 'toRegister', 'atRegister'].includes(c.state), c.state); assert.equal(w.handled.bagman, 1);
  applyMap();
});

test('免費袋子阿伯 who makes it out costs the store what he took', () => {
  const w = world(['bagman']);
  const c = cust(w, 'bagman', ENTRANCE.x, STORE_D - 1, { state: 'toExit', eaten: ['drinks', 'snacks'], speed: 1.2 });
  c.path = [{ x: ENTRANCE.x, z: STORE_D + 1.2 }];
  const money = w.money;
  run(w, 6);
  assert.equal(c.resolved, true); assert.equal(w.dayStats.karensFailed, 1);
  assert.ok(w.money < money - 10, `lost ${money - w.money}`);
  applyMap();
});

// ---------------- 借廁所大隊 ----------------
test('借廁所大隊: one alarm for a group of three; the toilet floods; a follower leaves alone, the leader takes everyone', () => {
  const w = world(['toilet'], { firstKaren: 0.5, karenEvery: 1e9 });
  run(w, 1);
  const group = w.customers.filter(c => c.kind === 'toilet');
  assert.equal(group.length, 3);
  const leader = group.find(c => c.leader == null)!;
  assert.equal(leader.phase, 1); assert.equal(leader.minions.length, 2);
  assert.equal(group.filter(c => c.phase === 2 && c.leader === leader.id).length, 2);
  assert.equal(w.events.filter(e => e.e === 'karen').length, 1, 'one alarm for the whole group');
  for (let i = 0; i < 400 && leader.state !== 'toilet'; i++) tick(w, 0.05);
  assert.equal(leader.state, 'toilet');
  assert.ok(Math.hypot(leader.x - TOILET_SPOT.x, leader.z - TOILET_SPOT.z) < 0.3);
  const spills = w.spills.length;
  run(w, 6);
  assert.ok(w.spills.length > spills, 'water comes out');
  const p = addPlayer(w, 'a', 'A', 1);
  const f = group.find(c => c.leader != null)!;
  p.x = f.x; p.z = f.z + 0.8;
  assert.equal(act(w, p, 'toiletRule', f).ok, true);
  run(w, 1);
  assert.equal(f.resolved, true); assert.equal(leader.resolved, false); assert.equal(w.handled.toilet ?? 0, 0, 'a follower is not a karen of his own');
  p.x = leader.x; p.z = leader.z + 0.8;
  assert.equal(act(w, p, 'toiletRule', leader).ok, true);
  run(w, 1);
  assert.equal(leader.resolved, true); assert.equal(w.handled.toilet, 1);
  assert.ok(group.every(c => c.resolved), 'the whole group is settled');
  assert.ok(group.filter(c => c !== f).every(c => c.state !== 'toilet'), 'they go shopping');
  applyMap();
});

test('借廁所大隊 ignored: the restroom floods and the plumber costs $20; a thrown-out follower does not count as a karen', () => {
  const w = world(['toilet'], { firstKaren: 0.5, karenEvery: 1e9 });
  run(w, 1);
  const leader = w.customers.find(c => c.kind === 'toilet' && c.leader == null)!;
  for (let i = 0; i < 400 && leader.state !== 'toilet'; i++) tick(w, 0.05);
  leader.life = 0.5;
  const money = w.money;
  run(w, 1);
  assert.equal(w.dayStats.karensFailed, 1); assert.equal(w.money, money - 20);
  assert.ok(w.customers.filter(c => c.kind === 'toilet').every(c => c.resolved));
  const snap = snapshot(w, 0);
  assert.ok(snap.customers.filter(c => c.kind === 'toilet').every(c => c.phase === 1 || c.phase === 2));
  applyMap();
});

// ---------------- the bot handles every one of them ----------------
test('a worker bot that cannot grab handles every general karen with its own action', () => {
  for (const k of GEN_KINDS) {
    const p = newProfile(); p.level = 5;
    const cfg = buildShiftConfig(p, '1-1');
    Object.assign(cfg, { karens: [k], firstKaren: 6, karenEvery: 22, maxKarens: 1, length: 170, spawnEvery: 9 });
    let t = 0;
    const room = new Room('G', null, { solo: true, now: () => t, shift: cfg, seed: 4 });
    const c: any = { snap: null, send(msg: any) { if (msg.type === 'snap') c.snap = msg.s; if (msg.type === 'welcome') c.pid = msg.playerId; }, close() {} };
    room.join(c, 'bot', undefined); room.startGame();
    const bot = new Bot('any', 0.3); let r = 0;
    const seen = new Set<number>(), handled = new Set<number>();
    for (let s = 0; s < 200 && !room.world!.result; s += 0.05) {
      t += 50; room.update(0.05);
      for (const cu of room.world!.customers) if (cu.kind === k && cu.leader == null) { seen.add(cu.id); if (cu.resolved && !cu.ejected && room.world!.phase === 'open') handled.add(cu.id); }
      const sn = c.snap; if (!sn) continue;
      for (const msg of botMessages(bot.update(sn, sn.players[0], 0.05), () => 'r' + r++)) room.handle(c.pid, msg);
    }
    assert.ok(seen.size >= 2, `${k}: ${seen.size} appeared`);
    assert.ok(handled.size >= 1 && room.world!.handled[k] >= 1, `${KAREN_INFO[k].name}: the bot handled ${handled.size} of ${seen.size} (failed ${room.world!.dayStats.karensFailed})`);
  }
  applyMap();
});

// ---------------- 特殊營業日 ----------------
function shiftWorld(cfg: ReturnType<typeof buildSpecialConfig>, seed = 3) {
  const w = createWorld(defaultSave(), seed, cfg);
  addPlayer(w, 'a', 'A', 1);
  return w;
}
const progressed = () => { const p = newProfile(); p.level = 12; for (let c = 1; c <= 3; c++) for (let i = 1; i <= 5; i++) p.stars[`${c}-${i}`] = 1; return p; };

test('颱風夜: fewer customers, wet floors and a leaking roof, short frequent outages, noodle hoarders, the 借廁所大隊', () => {
  const p = progressed();
  const cfg = buildSpecialConfig(p, 'typhoon');
  assert.equal(cfg.id, specialShiftId('typhoon')); assert.equal(specialOfShift(cfg.id), 'typhoon');
  assert.equal(cfg.special, 'typhoon'); assert.ok(cfg.goal > 0); assert.ok((cfg.spillMul ?? 1) >= 1.8);
  assert.ok(cfg.events.includes('outage')); assert.equal(cfg.eventEvery, 24);
  assert.ok(cfg.karens.includes('toilet') && cfg.karens.includes('bagman'));
  const w = shiftWorld(cfg);
  w.phaseLeft = 0; tick(w, 0.05);
  assert.equal(w.phase, 'open'); assert.ok(w.sp);
  let hoarders = 0, outageLen = 0, maxOut = 0;
  const seen = new Set<number>();
  let leaks = 0;
  for (let s = 0; s < 120; s += 0.05) {
    w.chaos = 0; w.rating = 3; // nobody is working: keep the shift from failing
    const n = w.spills.length;
    tick(w, 0.05);
    if (w.spills.length > n) leaks++;
    for (const c of w.customers) if (c.kind === 'normal' && !seen.has(c.id)) { seen.add(c.id); if (c.shopping.length >= 3 && c.shopping.every(x => x === 'snacks')) hoarders++; }
    if (w.power < 1) { outageLen += 0.05; maxOut = Math.max(maxOut, outageLen); } else outageLen = 0;
  }
  assert.ok(hoarders >= 2, `${hoarders} hoarders of ${seen.size}`);
  assert.ok(maxOut > 0 && maxOut <= 4.2, `outages are short flickers (${maxOut.toFixed(1)} s)`);
  assert.ok(leaks >= 4, `the floor gets wet (${leaks} new puddles)`);
  assert.equal(snapshot(w, 0).shift.special, 'typhoon');
  applyMap();
});

test('跨年夜: clock 21:00 → 00:30, a countdown rush from 23:50, fireworks at midnight, drunk karens', () => {
  const p = progressed();
  const cfg = buildSpecialConfig(p, 'newyear');
  assert.equal(cfg.special, 'newyear'); assert.ok(!cfg.events.includes('rush'));
  assert.ok(cfg.karens.includes('lottery') && cfg.karens.includes('change'));
  const w = shiftWorld(cfg, 5);
  w.phaseLeft = 0; tick(w, 0.05);
  assert.ok(Math.abs(w.clock - SPECIAL_CLOCK.from) < 1);
  const fx: string[] = [], toasts: string[] = [];
  let before = 0, during = 0, drunkSeen = false, maxClock = 0;
  const rushAt = w.openTime + cfg.length * (SPECIAL_CLOCK.rush - SPECIAL_CLOCK.from) / (SPECIAL_CLOCK.to - SPECIAL_CLOCK.from);
  const ids = new Set<number>();
  while (w.phase === 'open') {
    w.chaos = 0; w.rating = 3;
    tick(w, 0.05);
    maxClock = Math.max(maxClock, w.clock);
    for (const e of w.events) { if (e.e === 'fx') fx.push(e.name); if (e.e === 'toast') toasts.push(e.text); }
    w.events = [];
    for (const c of w.customers) if (!ids.has(c.id)) { ids.add(c.id); if (c.kind === 'normal') { if (w.time < rushAt - 15 && w.time > rushAt - 45) before++; if (w.time >= rushAt && w.time < rushAt + 30) during++; } }
    if (snapshot(w, 0).customers.some(c => c.drunk)) drunkSeen = true;
  }
  assert.ok(maxClock > 24 * 60 + 20, 'the clock runs past midnight: ' + maxClock);
  assert.ok(during > before, `countdown rush: ${during} arrivals in 30 s vs ${before} before`);
  assert.ok(toasts.some(t => /23:50/.test(t)) && toasts.some(t => /倒數 10 秒/.test(t)) && toasts.some(t => /新年快樂/.test(t)), toasts.join('|'));
  assert.ok(fx.includes('fireworks'));
  assert.ok(drunkSeen, 'karens are drunk');
  // a drunk karen takes longer to get through to
  const w2 = world(['change'], { special: 'newyear' });
  const c = atTill(w2, 'change'); c.drunk = true;
  const q = addPlayer(w2, 'b', 'B', 1); q.x = c.x; q.z = c.z - 0.8;
  act(w2, q, 'countChange', c);
  assert.ok(Math.abs(q.busy!.dur - 3.2 * 1.3) < 1e-6);
  applyMap();
});

test('special days pay on the first win of each day, the very first win pays a bonus; a loss pays nothing', () => {
  const p = progressed();
  const res = (won: boolean, id = specialShiftId('typhoon')): ShiftResult => ({ shiftId: id, won, failReason: '', revenue: won ? 400 : 90, goal: 300, rating: 3, chaos: 10, served: 20, angryLeft: 0, karensResolved: 2, karensFailed: 0, ejected: 0, cleaned: 3, maxCombo: 0, handled: { toilet: 1 } });
  const lost = applySpecialResult(p, res(false), '2026-10-25');
  assert.equal(lost.wallet, 0); assert.equal(lost.exp, 0);
  const w0 = p.wallet;
  const r1 = applySpecialResult(p, res(true), '2026-10-25');
  assert.ok(r1.exp > 0 && r1.wallet > SPECIAL_FIRST_BONUS); assert.equal(r1.firstClear, true); assert.equal(p.wallet, w0 + r1.wallet);
  const r2 = applySpecialResult(p, res(true), '2026-10-25');
  assert.equal(r2.wallet, 0); assert.equal(r2.exp, 0); assert.equal(r2.daily?.already, true);
  const r3 = applySpecialResult(p, res(true), '2026-10-26');
  assert.ok(r3.wallet > 0 && r3.wallet < SPECIAL_FIRST_BONUS + 400, 'next day: the daily reward again, no first-win bonus'); assert.equal(r3.firstClear, false);
  const r4 = applySpecialResult(p, res(true, specialShiftId('newyear')), '2026-10-26');
  assert.equal(r4.firstClear, true);
  assert.equal(p.special.typhoon.wins, 3); assert.equal(p.dex.toilet, 5);
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(p))).special, p.special);
});

test('daily and weekly: plans before round 27 are untouched; later ones rotate in the special days and the general karens', () => {
  const p = progressed();
  for (let d = 1; d <= 21; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    assert.ok(date < ROUND27_DATE);
    const plan = dailyPlan(p, date);
    assert.equal(plan.gen, undefined); assert.ok(plan.mods.every(m => !SPECIAL_IDS.includes(m as never)), date);
  }
  const specials = new Set<string>(), gens = new Set<string>();
  for (let i = 0; i < 120; i++) {
    const t = new Date(Date.UTC(2026, 9, 22 + i)); const date = t.toISOString().slice(0, 10);
    assert.ok(date >= ROUND27_DATE);
    const plan = dailyPlan(p, date), cfg = buildDailyConfig(p, date);
    for (const m of plan.mods) { assert.ok(DAILY_MODS[m].name, m); if (SPECIAL_IDS.includes(m as never)) { specials.add(m); assert.equal(cfg.special, m); } }
    if (plan.gen) { gens.add(plan.gen); if (!plan.mods.includes('streamers') && !plan.mods.includes('chargers')) assert.ok(cfg.karens.includes(plan.gen)); }
    if (plan.mods.includes('chargers')) assert.deepEqual(cfg.karens, ['charger']);
    assert.ok(cfg.goal > 0);
  }
  assert.deepEqual([...specials].sort(), [...SPECIAL_IDS].sort());
  assert.equal(gens.size, GEN_KINDS.length);
  // weekly: ISO weeks before 2026-W44 keep their plan shape; later weeks bring a general karen and sometimes a special day
  for (let k = 1; k <= 43; k++) { const plan = weeklyPlan(`2026-W${String(k).padStart(2, '0')}`); assert.equal(plan.special, undefined); assert.equal(plan.gen, undefined); }
  const wsp = new Set<string>();
  for (let y = 2026; y <= 2028; y++) for (let k = 1; k <= 52; k++) {
    const week = `${y}-W${String(k).padStart(2, '0')}`;
    if (week < ROUND27_WEEK) continue;
    const plan = weeklyPlan(week);
    assert.ok(plan.gen && GEN_KINDS.includes(plan.gen)); assert.ok(TWIST_IDS.includes(plan.twist));
    if (plan.special) {
      wsp.add(plan.special);
      const cfg = buildWeeklyConfig(p, week);
      assert.equal(cfg.special, plan.special); assert.ok(cfg.title.includes(SPECIAL_DAYS[plan.special].name)); assert.ok(cfg.karens.includes(plan.gen!));
    }
  }
  assert.deepEqual([...wsp].sort(), [...SPECIAL_IDS].sort());
});

test('co-op / free-play business days and the endless night can bring the general karens; sims of every special config run', () => {
  const day = dayConfig();
  for (const k of GEN_KINDS) assert.ok(day.karens.includes(k));
  const end = buildShiftConfig(progressed(), 'endless');
  for (const k of GEN_KINDS) assert.ok(end.karens.includes(k));
  for (const id of SPECIAL_IDS) {
    const w = shiftWorld(buildSpecialConfig(progressed(), id), 11);
    for (let i = 0; i < 4000 && !w.result; i++) tick(w, 0.05);
    assert.ok(w.phase !== 'prep');
  }
  applyMap();
});
