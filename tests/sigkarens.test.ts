// Store-signature karens (shared/sigkarens.ts, 第 8–10 章): every store type has one; each template behaves as designed,
// is settled by its own action, costs the store when ignored, and the simulated worker knows how to handle every one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, buildShiftConfig, chapterUnlocked, newProfile, shiftUnlocked } from '../shared/career.ts';
import { addPlayer, createWorld, defaultSave, requestAct, snapshot, tick, World, Customer, PlayerState } from '../shared/sim.ts';
import { CAMP_SPOTS, COFFEE_PICKUP, COMPLAINT_SPOT, REGISTERS, applyMap } from '../shared/map.ts';
import { MAPS } from '../shared/maps/index.ts';
import { KAREN_INFO } from '../shared/constants.ts';
import { SIG_KARENS, SIG_KINDS, SigKind, sigWaitReason } from '../shared/sigkarens.ts';
import { SCENES, sceneAfter, sceneBefore } from '../shared/story.ts';
import { Room } from '../shared/room.ts';
import { Bot, botMessages } from '../shared/bot.ts';

/** The store each signature karen belongs to. */
const home = (k: SigKind) => MAPS.find(m => m.karens?.includes(k))!;

function world(map: string, karens: SigKind[] = []) {
  const p = newProfile(); p.level = 5; // no grabbing: karens must be handled the proper way
  const cfg = buildShiftConfig(p, '1-1');
  cfg.map = map; cfg.foods = ['coffee', 'meal']; cfg.karens = karens; cfg.firstKaren = 1e9;
  const w = createWorld(defaultSave(), 9, cfg);
  w.phase = 'open'; w.phaseLeft = 999; w.spawnTimer = 1e9;
  return w;
}
function cust(w: World, kind: Customer['kind'], x: number, z: number, extra: Partial<Customer> = {}): Customer {
  const c: Customer = {
    id: w.nextId++, kind, x, z, yaw: 0, state: 'wander', path: [], speed: 0, shopping: [], items: [], want: null, foodDone: false,
    foodFailed: false, patience: 400, patienceMax: 400, mood: 80, timer: 0, register: -1, anger: 0, resolved: false, hits: 0,
    eaten: [], eatShelf: null, life: 60, lifeMax: 60, look: 1, angry: false, moving: false, knockTimer: 4, gone: false, heldBy: null, fly: null, phase: 0, minions: [], ...extra,
  };
  w.customers.push(c); return c;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) tick(w, 0.05); };
const near = (p: PlayerState, c: Customer) => { p.x = c.x; p.z = c.z - 0.8; };

/** Puts a signature karen straight into the state where he is being a nuisance. */
function placed(w: World, k: SigKind): Customer {
  const d = SIG_KARENS[k];
  const reg = REGISTERS[0];
  switch (d.tpl) {
    case 'till': case 'haggle': {
      const c = cust(w, k, reg.customer.x, reg.customer.z, { state: 'atRegister', items: ['drinks'], anger: d.heat ?? 0, lifeMax: d.tpl === 'till' ? 40 : undefined, life: 40 });
      w.registers[0] = c.id; return c;
    }
    case 'camp': case 'sneak': { const s = d.spot === 'shelf' ? { x: 11, z: 9 } : CAMP_SPOTS[0]; return cust(w, k, s.x, s.z, { state: 'camp', eatShelf: 'snacks', knockTimer: d.every ?? 5 }); }
    case 'roam': return cust(w, k, 11, 9.5, { state: 'wander', knockTimer: d.every ?? 5 });
    case 'redo': return cust(w, k, COFFEE_PICKUP.x, COFFEE_PICKUP.z, { state: 'waitFood', want: d.food ?? 'coffee', timer: 50, patienceMax: 50 });
    case 'refund': return cust(w, k, COMPLAINT_SPOT.x, COMPLAINT_SPOT.z, { state: 'complain', life: 40 });
  }
}
/** Hands the worker whatever the action needs. */
function equip(p: PlayerState, k: SigKind) {
  const n = SIG_KARENS[k].need;
  p.held = n === 'box' ? { kind: 'box', product: 'snacks', qty: 6 } : n === 'mop' ? { kind: 'mop' } : n ? { kind: n } : null;
}

test('every store type has its own signature karen; at least 20 store types', () => {
  assert.ok(MAPS.length >= 20, `${MAPS.length} store types`);
  for (const m of MAPS) assert.ok((m.karens ?? []).length > 0 || m.id === 'convenience', `${m.name} has no karen of its own`);
  for (const k of SIG_KINDS) {
    const d = SIG_KARENS[k];
    assert.ok(home(k), `${d.name} belongs to no store`);
    assert.ok(KAREN_INFO[k].how.length > 5 && d.act && d.ok && d.fail, `${k} text`);
    if (d.need === 'coffee' || d.need === 'meal' || d.altNeed) assert.ok(home(k)[(d.need ?? d.altNeed) === 'coffee' ? 'coffee' : 'meal'], `${d.name} needs a station its store lacks`);
    if (d.tpl === 'redo') assert.ok(home(k)[d.food === 'meal' ? 'meal' : 'coffee'], `${d.name}'s store makes no ${d.food}`);
    if (d.alt) assert.ok(d.altNeed || d.altCost !== undefined || d.tpl === 'haggle', `${k} alt does something`);
  }
  // no two signature karens are the same template with the same twist
  const sig = (k: SigKind) => { const d = SIG_KARENS[k]; return [d.tpl, d.need ?? '', d.alt ? 'alt' : '', d.relocate ? 'r' : '', d.flee ? 'f' : '', (d.effects ?? []).join('+'), d.presses ?? 1].join('|'); };
  const seen = new Map<string, SigKind>();
  for (const k of SIG_KINDS) { assert.ok(!seen.has(sig(k)), `${k} plays exactly like ${seen.get(sig(k))}`); seen.set(sig(k), k); }
});

for (const k of SIG_KINDS) {
  const d = SIG_KARENS[k];
  test(`${d.icon} ${d.name} (${d.tpl}): spawns in ${home(k).name}, gets in the way, is settled by「${d.act}」`, () => {
    const w = world(home(k).id, [k]);
    const p = addPlayer(w, 'a', 'A', 1);
    // he really spawns and heads where his template says
    w.karenTimer = 0; w.cfg.firstKaren = 0; w.cfg.karenEvery = 1e9; run(w, 0.1);
    const spawned = w.customers.find(c => c.kind === k)!;
    assert.ok(spawned, 'spawned');
    if (d.tpl === 'camp' || d.tpl === 'sneak') assert.equal(spawned.state, 'toCamp');
    if (d.tpl === 'roam') assert.equal(spawned.state, 'wander');
    if (d.tpl === 'refund') assert.equal(spawned.state, 'toComplain');
    if (d.tpl === 'till' || d.tpl === 'haggle') assert.ok(spawned.shopping.length > 0);
    if (d.tpl === 'redo') assert.equal(spawned.want, d.food);
    w.customers = []; w.registers = [null, null];

    const c = placed(w, k);
    // not handled from too early a state
    assert.equal(sigWaitReason(k, c.state), null);
    // gets in the way
    if (d.tpl === 'till' || d.tpl === 'haggle') {
      p.x = REGISTERS[0].cashier.x; p.z = REGISTERS[0].cashier.z;
      requestAct(w, 'a', 'co', 'checkout', { t: 'register', idx: 0 });
      assert.equal(w.results.find(r => r.rid === 'co')?.ok, false, 'register blocked');
    }
    if (d.need) {
      near(p, c); p.held = null;
      requestAct(w, 'a', 'no', 'sigAct', { t: 'customer', id: c.id });
      assert.match(w.results.find(r => r.rid === 'no')?.reason ?? '', /先拿/, 'needs the item first');
    }
    // each press (or delivery for 照片魔人)
    const presses = d.tpl === 'redo' ? 1 : d.presses ?? 1;
    for (let i = 0; i < presses; i++) {
      assert.equal(c.resolved, false, `not settled after ${i} presses`);
      run(w, 0.05); if (c.state === 'toCamp' || c.state === 'wander') { c.x = c.path.at(-1)?.x ?? c.x; c.z = c.path.at(-1)?.z ?? c.z; c.path = []; c.state = d.tpl === 'roam' ? 'wander' : 'camp'; }
      near(p, c); equip(p, k);
      requestAct(w, 'a', 'act' + i, 'sigAct', { t: 'customer', id: c.id });
      assert.equal(w.results.find(r => r.rid === 'act' + i)?.ok, true, w.results.find(r => r.rid === 'act' + i)?.reason ?? '');
      run(w, (d.dur ?? 1.2) + 0.15);
    }
    assert.equal(c.resolved, true, 'settled');
    assert.equal(w.dayStats.karensResolved, 1); assert.equal(w.dayStats.karensFailed, 0);
    assert.equal(w.handled[k], 1, 'counted for the 奧客圖鑑');
    assert.ok(w.events.some(e => e.e === 'toast' && e.karen === k && e.kid === c.id && e.ok === true), 'the success toast names the karen (after-story line)');
    if (d.need === 'coffee' || d.need === 'meal') assert.equal(p.held, null, 'the food was handed over');
    if (d.buys || d.tpl === 'sneak') assert.ok(['queue', 'toRegister', 'atRegister'].includes(c.state), `goes to pay (${c.state})`);
    if (d.tpl === 'till' || d.tpl === 'haggle') {
      p.held = null; p.x = REGISTERS[0].cashier.x; p.z = REGISTERS[0].cashier.z;
      requestAct(w, 'a', 'co2', 'checkout', { t: 'register', idx: 0 }); run(w, 2);
      assert.equal(w.dayStats.served, 1, 'checks out after being handled');
    }

    // ignored: the store pays for it
    const w2 = world(home(k).id, [k]); addPlayer(w2, 'b', 'B', 1); w2.players.get('b')!.x = 1; w2.players.get('b')!.z = 14;
    const c2 = placed(w2, k);
    const money = w2.money, rating = w2.rating;
    if (d.tpl === 'redo') c2.timer = 0.5; else if (d.tpl !== 'haggle') { c2.life = 2; c2.knockTimer = 0.5; }
    w2.shelves = { drinks: 10, snacks: 10, bento: 10 };
    run(w2, d.tpl === 'haggle' ? 60 : 3);
    assert.equal(w2.dayStats.karensFailed, 1, 'fails when ignored'); assert.equal(c2.state, 'leaving');
    assert.equal(w2.handled[k], undefined, 'a failure is not counted as handled');
    assert.ok(w2.events.some(e => e.e === 'toast' && e.karen === k && e.ok === false), 'the failure toast names the karen');
    assert.ok(w2.rating < rating, 'rating drops');
    if (d.failMoney || d.tpl === 'sneak' || d.effects?.includes('money')) assert.ok(w2.money < money, 'costs money');
    if (d.effects?.includes('stock')) assert.ok(w2.shelves.drinks + w2.shelves.snacks + w2.shelves.bento < 30, 'took goods off the shelves');
    applyMap();
  });
}

test('alternatives: refund money, a free drink, or giving in also settle them', () => {
  for (const k of SIG_KINDS.filter(k => SIG_KARENS[k].alt)) {
    const d = SIG_KARENS[k];
    const w = world(home(k).id, [k]); const p = addPlayer(w, 'a', 'A', 1);
    const c = placed(w, k); near(p, c);
    if (d.altNeed) p.held = { kind: d.altNeed };
    const money = w.money;
    requestAct(w, 'a', 'alt', 'sigAlt', { t: 'customer', id: c.id }); run(w, 0.4);
    assert.equal(c.resolved, true, `${k} alt`);
    if (d.altCost) assert.equal(w.money, money - d.altCost);
    if (d.altNeed) { assert.equal(p.held, null); assert.equal(c.foodDone, true, 'pays for the drink'); }
  }
  applyMap();
});

test('照片魔人 rejects the first two cuts and accepts the third', () => {
  const w = world('salon', ['photo']); const p = addPlayer(w, 'a', 'A', 1);
  const c = placed(w, 'photo'); near(p, c);
  for (let i = 0; i < 3; i++) {
    assert.equal(c.resolved, false);
    p.held = { kind: 'meal' };
    requestAct(w, 'a', 'd' + i, 'deliver', { t: 'customer', id: c.id }); tick(w, 0.05);
    assert.equal(p.held, null);
  }
  assert.equal(c.resolved, true); assert.equal(c.foodDone, true);
  applyMap();
});

test('aura and queue karens make other customers lose patience faster; hidden ones only show up close', () => {
  const w = world('cinema', ['kicker']); addPlayer(w, 'a', 'A', 1).x = 1;
  const k = cust(w, 'kicker', CAMP_SPOTS[0].x, CAMP_SPOTS[0].z, { state: 'camp', life: 999, knockTimer: 999 });
  const close = cust(w, 'normal', k.x + 1.5, k.z, { state: 'queue', patience: 100, patienceMax: 100 });
  const far = cust(w, 'normal', 22, 3, { state: 'queue', patience: 100, patienceMax: 100 });
  w.queue = []; // keep them in place
  run(w, 1);
  assert.ok(100 - close.patience > (100 - far.patience) * 1.5, `near ${close.patience} far ${far.patience}`);
  applyMap();
  const w2 = world('gym', ['benchhog']); addPlayer(w2, 'a', 'A', 1);
  const q = cust(w2, 'normal', 22, 3, { state: 'queue', patience: 100, patienceMax: 100 }); run(w2, 1); const calm = 100 - q.patience;
  cust(w2, 'benchhog', CAMP_SPOTS[0].x, CAMP_SPOTS[0].z, { state: 'camp', life: 999, knockTimer: 999 });
  const q2 = cust(w2, 'normal', 22, 3.5, { state: 'queue', patience: 100, patienceMax: 100 }); run(w2, 1);
  assert.ok(100 - q2.patience > calm * 1.3);
  applyMap();
  const w3 = world('hotpot', ['packer']); const p3 = addPlayer(w3, 'a', 'A', 1); p3.x = 22; p3.z = 14;
  const pk = cust(w3, 'packer', 11, 9, { state: 'camp', eatShelf: 'snacks' });
  const snap = () => snapshot(w3, 0).customers.find(c => c.id === pk.id)!;
  assert.equal(snap().revealed, false);
  p3.x = 11; p3.z = 10; assert.equal(snap().revealed, true);
  applyMap();
});

test('a worker who cannot grab handles every signature karen with its own action', () => {
  for (const k of SIG_KINDS) {
    const m = home(k);
    applyMap(m.id);
    const p = newProfile(); p.level = 5;
    const cfg = buildShiftConfig(p, '1-1');
    Object.assign(cfg, { map: m.id, karens: [k], firstKaren: 6, karenEvery: 22, maxKarens: 1, length: 150, foods: ['coffee', 'meal'], spawnEvery: 9 });
    let t = 0;
    const room = new Room('S', null, { solo: true, now: () => t, shift: cfg, seed: 4 });
    const c: any = { snap: null, send(msg: any) { if (msg.type === 'snap') c.snap = msg.s; if (msg.type === 'welcome') c.pid = msg.playerId; }, close() {} };
    room.join(c, 'bot', undefined); room.startGame();
    const bot = new Bot('any', 0.3); let rid = 0;
    const seen = new Set<number>(), handled = new Set<number>();
    for (let s = 0; s < 200 && !room.world!.result; s += 0.05) {
      t += 50; room.update(0.05);
      for (const cu of room.world!.customers) if (cu.kind === k) { seen.add(cu.id); if (cu.resolved && !cu.ejected && room.world!.phase === 'open') handled.add(cu.id); }
      const sn = c.snap; if (!sn) continue;
      for (const msg of botMessages(bot.update(sn, sn.players[0], 0.05), () => 'r' + rid++)) room.handle(c.pid, msg);
    }
    assert.ok(seen.size >= 2, `${k}: ${seen.size} appeared`);
    assert.ok(handled.size >= 1, `${SIG_KARENS[k].name}: the bot handled ${handled.size} of ${seen.size} (failed ${room.world!.dayStats.karensFailed})`);
  }
  applyMap();
});

test('chapters 8–10 run through every new store, unlock in order, and have story scenes', () => {
  const p = newProfile(); p.level = 30;
  for (const c of CHAPTERS.filter(c => c.n <= 7)) for (const s of c.shifts) p.stars[s.id] = 1;
  assert.equal(chapterUnlocked(p, 8).ok, true); assert.equal(chapterUnlocked(p, 9).ok, false);
  assert.equal(shiftUnlocked(p, '8-2').ok, false);
  const later = CHAPTERS.filter(c => c.n >= 8);
  assert.deepEqual(later.map(c => c.n), [8, 9, 10]);
  const maps = new Set(later.flatMap(c => c.shifts.map(s => s.map ?? 'convenience')));
  for (const k of SIG_KINDS) {
    assert.ok(maps.has(home(k).id), `${home(k).name} is not in the story`);
    assert.ok(later.some(c => c.shifts.some(s => s.karens.includes(k) && (s.map ?? 'convenience') === home(k).id)), `${SIG_KARENS[k].name} has no shift in its own store`);
  }
  for (const c of later) {
    assert.ok(SCENES[`ch${c.n}-intro`] && SCENES[`ch${c.n}-outro`], `scenes for chapter ${c.n}`);
    assert.equal(sceneBefore(c.shifts[0].id), `ch${c.n}-intro`);
    const last: Record<number, string> = { [c.n]: c.shifts.at(-1)!.id };
    assert.equal(sceneAfter(c.shifts.at(-1)!.id, last), `ch${c.n}-outro`);
    for (const s of c.shifts) {
      assert.ok(s.goal > 0, `${s.id} goal`);
      const w = createWorld(defaultSave(), 1, buildShiftConfig(p, s.id));
      assert.equal(w.cfg.map ?? 'convenience', s.map ?? 'convenience');
      // a karen that needs prepared food only appears where it is sold
      for (const k of s.karens) { const d = SIG_KARENS[k as SigKind]; if (d?.need === 'meal' || d?.tpl === 'redo') assert.ok(w.cfg.foods.includes(d.food ?? 'meal'), `${s.id} ${k}`); }
    }
  }
  assert.equal(sceneBefore('10-1'), 'ch10-intro'); assert.equal(sceneBefore('10-2'), null);
  applyMap();
});

test('every signature karen has a small held prop for the 3D model', async () => {
  const { buildKarenProp } = await import('../client/src/karen-props.ts');
  for (const k of SIG_KINDS) {
    const o = buildKarenProp(k);
    assert.ok(o && o.children.length > 0, `${k} prop`);
    let meshes = 0; o!.traverse(x => { if ((x as any).isMesh) meshes++; });
    assert.ok(meshes <= 16, `${k} prop is cheap (${meshes} meshes)`);
  }
  assert.equal(buildKarenProp('cutter'), null);
});
