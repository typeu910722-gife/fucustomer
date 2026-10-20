// 存檔備份: FUC1- codes round-trip progress, reject tampering / garbage / oversized input, never carry the account
// or paid-pack entitlements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { K, MAX_CODE_LEN, SAVE_PREFIX, applySave, checksum, exportSaveCode, parseSaveCode, summarizeStore } from '../shared/savecode.ts';
import { CHAPTERS, newProfile } from '../shared/career.ts';
import { defaultSave } from '../shared/sim.ts';

const [S1, S2] = CHAPTERS[0].shifts.map(x => x.id);
function sampleStore(): Record<string, string> {
  const p = newProfile();
  p.level = 12; p.exp = 40; p.wallet = 3456; p.stars = { [S1]: 3, [S2]: 2 }; p.clears = { [S1]: 4 };
  p.stats.shifts = 9; p.achievements = ['FIRST_DAY']; p.story = ['c1-intro'];
  p.shop.owned = ['hat_cap', 'uni_pink'];
  p.shop.entitlements = ['pack_supporter', 'pack_nightlife'];
  p.shop.equipped = { hat: 'hat_gold', uniform: 'uni_pink', tag: 'tag_gold' };
  const solo = defaultSave(); solo.day = 7; solo.money = 999;
  const cafe = defaultSave(); cafe.day = 3;
  return {
    [K.career]: JSON.stringify(p),
    [K.settings]: JSON.stringify({ name: '阿明', sensitivity: 1.4, quality: 'medium', volume: 0.3, music: 0.2, serverUrl: 'wss://evil.example/ws', fov: 80, fpsCap: 30, adaptive: false, invertY: true, showFps: true, master: 0.8, padSens: 1.7, padInvertY: true, rumble: false, renderScale: 0.75, fullscreen: false, shake: false, reduceMotion: true, colorblind: 'rg', textScale: 1.3, captions: true }),
    [K.flags]: JSON.stringify({ tutorialDone: true, seenKarens: ['loud'], seenMaps: ['cafe'] }),
    [K.avatar]: '🐱',
    [K.soloConv]: JSON.stringify(solo),
    'fucustomer.store.solo.cafe.v1': JSON.stringify(cafe),
    [K.coop]: JSON.stringify(defaultSave()),
    [K.account]: JSON.stringify({ no: 'A123', session: 'SECRET-SESSION-TOKEN', name: 'x' }),
    [K.session]: JSON.stringify({ code: 'ABCD', token: 'REJOIN-TOKEN', name: 'x', url: '', at: 1 }),
  };
}

test('round trip: export → parse → apply restores progress on an empty device', () => {
  const src = sampleStore();
  const code = exportSaveCode(src, 1_700_000_000_000);
  assert.ok(code.startsWith(SAVE_PREFIX));
  assert.match(code, /^FUC1-[A-Za-z0-9_-]+-[0-9a-f]{8}$/);
  // chat apps may wrap the code: whitespace / newlines are ignored
  const r = parseSaveCode(`  ${code.slice(0, 40)}\n${code.slice(40)}  `);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  assert.equal(r.summary.level, 12); assert.equal(r.summary.stars, 5); assert.equal(r.summary.wallet, 3456);
  assert.equal(r.summary.soloSaves, 2); assert.equal(r.summary.at, 1_700_000_000_000);
  const { set, remove } = applySave(r.payload, {});
  assert.deepEqual(remove, []);
  const p = JSON.parse(set[K.career]);
  assert.equal(p.level, 12); assert.equal(p.wallet, 3456); assert.deepEqual(p.stars, { [S1]: 3, [S2]: 2 });
  assert.deepEqual(p.shop.owned, ['hat_cap', 'uni_pink']);
  assert.equal(JSON.parse(set[K.soloConv]).day, 7);
  assert.equal(JSON.parse(set['fucustomer.store.solo.cafe.v1']).day, 3);
  assert.equal(set[K.avatar], '🐱');
  assert.deepEqual(JSON.parse(set[K.flags]), { tutorialDone: true, seenKarens: ['loud'], seenMaps: ['cafe'] });
  const st = JSON.parse(set[K.settings]);
  assert.equal(st.name, '阿明'); assert.equal(st.quality, 'medium'); assert.equal(st.fpsCap, 30);
  // controller / PC settings (round 21) travel too
  assert.equal(st.master, 0.8); assert.equal(st.padSens, 1.7); assert.equal(st.padInvertY, true); assert.equal(st.rumble, false);
  assert.equal(st.renderScale, 0.75); assert.equal(st.fullscreen, false);
  // 打擊感 accessibility settings (round 24)
  assert.equal(st.shake, false); assert.equal(st.reduceMotion, true);
  // accessibility (round 26)
  assert.equal(st.colorblind, 'rg'); assert.equal(st.textScale, 1.3); assert.equal(st.captions, true);
  assert.equal(summarizeStore(set).level, 12);
});

test('account, rejoin session and serverUrl are never exported; import keeps the account', () => {
  const code = exportSaveCode(sampleStore());
  const r = parseSaveCode(code); assert.ok(r.ok);
  const json = Buffer.from(code.slice(5, code.lastIndexOf('-')), 'base64url').toString('utf8');
  for (const secret of ['SECRET-SESSION-TOKEN', 'REJOIN-TOKEN', 'A123', 'evil.example', 'serverUrl']) assert.ok(!json.includes(secret), secret);
  if (!r.ok) return;
  const cur = { [K.account]: '{"no":"B9","session":"KEEP"}', [K.session]: '{"token":"t"}', [K.settings]: '{"serverUrl":"wss://mine/ws","name":"old"}', 'fucustomer.store.solo.gym.v1': '{}' };
  const { set, remove } = applySave(r.payload, cur);
  assert.ok(!(K.account in set)); assert.ok(!remove.includes(K.account));
  assert.ok(remove.includes(K.session)); // stale rejoin token from this device is cleared
  assert.ok(remove.includes('fucustomer.store.solo.gym.v1')); // progress not in the code is replaced (removed)
  const st = JSON.parse(set[K.settings]);
  assert.equal(st.serverUrl, 'wss://mine/ws'); assert.equal(st.name, '阿明');
});

test('entitlements: never exported, never granted by an import; the device keeps its own', () => {
  const code = exportSaveCode(sampleStore());
  const r = parseSaveCode(code); assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual(r.payload.career.shop.entitlements, []);
  // on a device without the packs the premium items are unequipped; points-bought ones stay
  const eq = JSON.parse(applySave(r.payload, {}).set[K.career]).shop.equipped;
  assert.deepEqual(eq, { uniform: 'uni_pink' });

  // a hand-crafted code that claims every pack and premium items as owned
  const p = newProfile(); p.shop.entitlements = ['pack_supporter', 'pack_nightlife', 'pack_services'];
  p.shop.owned = ['hat_gold', 'tag_gold', 'uni_neon', 'hat_cap']; p.shop.equipped = { hat: 'hat_gold' };
  const body = Buffer.from(JSON.stringify({ v: 1, at: 1, career: p, settings: {}, flags: {}, avatar: null, solo: {}, coop: null }), 'utf8').toString('base64url');
  const forged = parseSaveCode(`FUC1-${body}-${checksum(body)}`); assert.ok(forged.ok); if (!forged.ok) return;
  assert.deepEqual(forged.payload.career.shop.entitlements, []);
  assert.deepEqual(forged.payload.career.shop.owned, ['hat_cap']);
  // empty device → nothing paid; a device that bought the supporter pack keeps it (and the gold hat can stay equipped)
  assert.deepEqual(JSON.parse(applySave(forged.payload, {}).set[K.career]).shop.entitlements, []);
  const mine = newProfile(); mine.shop.entitlements = ['pack_supporter'];
  const c = JSON.parse(applySave(forged.payload, { [K.career]: JSON.stringify(mine) }).set[K.career]);
  assert.deepEqual(c.shop.entitlements, ['pack_supporter']);
  assert.equal(c.shop.equipped.hat, 'hat_gold');
});

test('tampering, garbage and wrong types are rejected', () => {
  const code = exportSaveCode(sampleStore());
  const body = code.slice(5, code.lastIndexOf('-'));
  const flip = body[20] === 'A' ? 'B' : 'A';
  assert.equal(parseSaveCode(`FUC1-${body.slice(0, 20)}${flip}${body.slice(21)}-${checksum(body)}`).ok, false); // edited body
  assert.equal(parseSaveCode(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')).ok, false); // edited checksum
  assert.equal(parseSaveCode(code.slice(0, code.length - 30)).ok, false); // truncated
  for (const bad of ['', '   ', 'hello', 'FUC1-', 'FUC2-abc-00000000', 'FUC1-!!!-00000000', 'FUC1-abc', null, 42, {}, ['FUC1-']]) {
    const r = parseSaveCode(bad as unknown); assert.equal(r.ok, false, String(bad));
    if (!r.ok) assert.ok(r.error.length > 0);
  }
  const mk = (o: unknown) => { const b = Buffer.from(typeof o === 'string' ? o : JSON.stringify(o), 'utf8').toString('base64url'); return `FUC1-${b}-${checksum(b)}`; };
  const ok = { v: 1, at: 1, career: newProfile(), settings: {}, flags: {}, avatar: null, solo: {}, coop: null };
  assert.equal(parseSaveCode(mk(ok)).ok, true);
  assert.equal(parseSaveCode(mk('not json')).ok, false);
  assert.equal(parseSaveCode(mk([1, 2])).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, v: 2 })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, career: 'x' })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, career: { ...newProfile(), level: '30' } })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, career: { ...newProfile(), stars: [] } })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, career: { ...newProfile(), shop: 'all' } })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, settings: [] })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, avatar: 5 })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, solo: { nowhere: defaultSave() } })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, solo: { cafe: 'x' } })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, coop: 7 })).ok, false);
  assert.equal(parseSaveCode(mk({ ...ok, at: 'now' })).ok, false);
  // out-of-range numbers are clamped by the normal sanitizers
  const big = parseSaveCode(mk({ ...ok, career: { ...newProfile(), level: 9999, wallet: 1e15 }, settings: { volume: 50, quality: 'ultra', serverUrl: 'x' } }));
  assert.ok(big.ok); if (!big.ok) return;
  assert.equal(big.payload.career.level, 30); assert.equal(big.payload.career.wallet, 1e8);
  assert.deepEqual(big.payload.settings, { volume: 1 });
  const odd = parseSaveCode(mk({ ...ok, settings: { master: 9, padSens: 0, renderScale: 3, fpsCap: 75, rumble: 'on', padInvertY: 1, fullscreen: true, shake: 'no', reduceMotion: 1 } }));
  assert.ok(odd.ok); if (!odd.ok) return;
  assert.deepEqual(odd.payload.settings, { master: 1, padSens: 0.2, renderScale: 1, fullscreen: true });
  const deck = parseSaveCode(mk({ ...ok, settings: { fpsCap: 40 } }));
  assert.ok(deck.ok && deck.payload.settings.fpsCap === 40);
});

test('size limit: input over ~200KB is rejected before decoding', () => {
  const huge = 'FUC1-' + 'A'.repeat(MAX_CODE_LEN) + '-00000000';
  const r = parseSaveCode(huge); assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /200KB/);
  // a real code with lots of progress stays far below the limit
  assert.ok(exportSaveCode(sampleStore()).length < 20_000);
});

test('store levels, personal records and branches travel in the code (re-sanitized), old codes still import', async () => {
  const { newProg, openBranch, LEVEL_XP } = await import('../shared/progression.ts');
  const { openStore } = await import('../shared/ownstore.ts');
  const p = newProfile();
  p.stars['6-3'] = 1; p.wallet = 20_000;
  openStore(p, '阿明商店', 2500, defaultSave(), 'convenience');
  p.store!.prog = { ...newProg(), xp: LEVEL_XP[6], days: 40, bestRevenue: 900, bestKarens: 12, streak: 4, bestStreak: 11 };
  openBranch(p, 'cafe', '貓咪分店', defaultSave());
  p.freeProg = { bakery: { ...newProg(), xp: 777, days: 4, bestRevenue: 600, bestKarens: 8, streak: 2, bestStreak: 3 } };
  const code = exportSaveCode({ [K.career]: JSON.stringify(p) }, 1);
  const r = parseSaveCode(code);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.summary.storeLevel, 7); assert.equal(r.summary.branches, 1);
  const got = JSON.parse(applySave(r.payload, {}).set[K.career]);
  assert.deepEqual(got.freeProg, p.freeProg);
  assert.deepEqual(got.store.prog, p.store!.prog);
  assert.equal(got.store.branches[0].name, '貓咪分店'); assert.equal(got.store.branches[0].map, 'cafe');
  // a tampered code (re-checksummed) can't smuggle absurd values: clamped by the profile sanitizer
  const body = JSON.parse(Buffer.from(code.slice(5, code.lastIndexOf('-')).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  body.career.freeProg = { bakery: { xp: 1e15, days: 'x' }, hacker: { xp: 5 } };
  body.career.store.branches = [...body.career.store.branches, ...['bakery', 'boba', 'chicken', 'cafe', 'gym'].map(m => ({ ...body.career.store.branches[0], map: m }))];
  body.career.store.branches[0].payCount = 999;
  const b64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const t = parseSaveCode(`FUC1-${b64}-${checksum(b64)}`);
  assert.ok(t.ok);
  if (!t.ok) return;
  assert.deepEqual(Object.keys(t.payload.career.freeProg), ['bakery']);
  assert.equal(t.payload.career.freeProg.bakery.xp, 99_999);
  assert.equal(t.payload.career.store!.branches!.length, 3);
  assert.equal(t.payload.career.store!.branches![0].payCount, 3);
  // a code made before this round (no freeProg / prog / branches) imports with everything at Lv1
  const oldP = JSON.parse(JSON.stringify(p)); delete oldP.freeProg; delete oldP.store.prog; delete oldP.store.branches;
  const o = parseSaveCode(exportSaveCode({ [K.career]: JSON.stringify(oldP) }, 1));
  assert.ok(o.ok);
  if (!o.ok) return;
  assert.deepEqual(o.payload.career.freeProg, {}); assert.deepEqual(o.payload.career.store!.branches, []);
  assert.equal(o.summary.storeLevel, 1); assert.equal(o.summary.branches, 0);
});
