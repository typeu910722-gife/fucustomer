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
    [K.settings]: JSON.stringify({ name: '阿明', sensitivity: 1.4, quality: 'medium', volume: 0.3, music: 0.2, serverUrl: 'wss://evil.example/ws', fov: 80, fpsCap: 30, adaptive: false, invertY: true, showFps: true }),
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
});

test('size limit: input over ~200KB is rejected before decoding', () => {
  const huge = 'FUC1-' + 'A'.repeat(MAX_CODE_LEN) + '-00000000';
  const r = parseSaveCode(huge); assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /200KB/);
  // a real code with lots of progress stays far below the limit
  assert.ok(exportSaveCode(sampleStore()).length < 20_000);
});
