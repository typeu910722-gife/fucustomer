// 商城: catalog, profile sanitize, buying with 薪資點數, equipping, paid-pack gating, outfits over the wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COSMETICS, FREE_STORES, PACKS, buyCosmetic, effectiveLoadout, equipCosmetic, getCosmetic, isSupporter, outfitOf, ownsCosmetic,
  packForStore, sanitizeOutfit, sanitizeShop, storeLocked,
} from '../shared/shop.ts';
import { CHAPTERS, newProfile, sanitizeProfile } from '../shared/career.ts';
import { MAPS } from '../shared/maps/index.ts';
import { Room, Conn } from '../shared/room.ts';
import { defaultSave } from '../shared/sim.ts';
import type { ServerMsg, Snapshot, LobbyState } from '../shared/protocol.ts';
import { PendingAdapter, NOT_YET, devShop } from '../client/src/billing.ts';

test('catalog: unique ids, priced in points XOR premium, packs reference real items and stores', () => {
  const ids = COSMETICS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of COSMETICS) {
    assert.ok((c.price !== undefined) !== (c.pack !== undefined), `${c.id}: price xor pack`);
    if (c.price !== undefined) assert.ok(c.price > 0 && Number.isInteger(c.price));
    if (c.pack) assert.ok(PACKS.some(k => k.id === c.pack && k.items.includes(c.id)), `${c.id} listed in its pack`);
    assert.ok(c.name && c.icon && c.desc);
  }
  for (const k of PACKS) {
    assert.match(k.price, /以上架平台為準/); // real prices are TBD
    for (const id of k.items) assert.equal(getCosmetic(id)?.pack, k.id);
  }
  // every store is either free or in exactly one pack; the original five + chapter-8 stores are free
  for (const m of MAPS) {
    const inPacks = PACKS.filter(k => k.stores.includes(m.id)).length;
    assert.equal(inPacks + (FREE_STORES.includes(m.id) ? 1 : 0), 1, m.id);
  }
  for (const id of ['convenience', 'breakfast', 'boba', 'clothing', 'chicken']) assert.equal(packForStore(id), null);
  for (const s of CHAPTERS.find(c => c.n === 8)!.shifts) assert.equal(packForStore(s.map ?? 'convenience'), null);
  assert.deepEqual(packForStore('cinema')?.id, 'pack_nightlife');
  assert.deepEqual(packForStore('hotel')?.id, 'pack_services');
});

test('profile: old saves get an empty shop; tampered shop data is cleaned', () => {
  const old = JSON.parse(JSON.stringify(newProfile())); delete old.shop;
  const p = sanitizeProfile(old);
  assert.deepEqual(p.shop, { owned: [], equipped: {}, entitlements: [] });
  const t = sanitizeProfile({
    ...newProfile(),
    shop: {
      owned: ['hat_cap', 'hat_cap', 'hat_gold', 'nope', 42],
      equipped: { hat: 'hat_cap', uniform: 'hat_crown', tag: 'tag_gold', mascot: 'x' },
      entitlements: ['pack_supporter', 'pack_free_money', null],
    },
  });
  assert.deepEqual(t.shop.owned, ['hat_cap']); // premium items can't be "owned" with points
  assert.deepEqual(t.shop.entitlements, ['pack_supporter']);
  assert.deepEqual(t.shop.equipped, { hat: 'hat_cap', tag: 'tag_gold' }); // wrong-slot / unknown dropped
  assert.deepEqual(sanitizeShop('garbage'), { owned: [], equipped: {}, entitlements: [] });
  // survives a JSON round trip unchanged
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(t))).shop, t.shop);
});

test('buy with 薪資點數: pays once, refuses when poor, owned or premium', () => {
  const p = newProfile(); p.wallet = 350;
  assert.deepEqual(buyCosmetic(p, 'hat_crown'), { ok: false, why: 'poor' });
  assert.equal(p.wallet, 350);
  assert.deepEqual(buyCosmetic(p, 'hat_cap'), { ok: true });
  assert.equal(p.wallet, 50); assert.ok(ownsCosmetic(p, 'hat_cap'));
  assert.deepEqual(buyCosmetic(p, 'hat_cap'), { ok: false, why: 'owned' });
  p.wallet = 1e6;
  assert.deepEqual(buyCosmetic(p, 'hat_gold'), { ok: false, why: 'premium' });
  assert.deepEqual(buyCosmetic(p, 'nope'), { ok: false, why: 'unknown' });
  assert.equal(p.wallet, 1e6);
});

test('equip: only what you own; premium items need their pack; loadout ignores the rest', () => {
  const p = newProfile(); p.wallet = 1000;
  assert.equal(equipCosmetic(p, 'uni_pink'), false);
  buyCosmetic(p, 'uni_pink');
  assert.equal(equipCosmetic(p, 'uni_pink'), true);
  assert.equal(p.shop.equipped.uniform, 'uni_pink');
  assert.equal(equipCosmetic(p, 'tag_gold'), false);
  assert.equal(equipCosmetic(p, 'tag_gold', undefined, ['pack_supporter']), true); // e.g. a QA unlock
  assert.deepEqual(effectiveLoadout(p), { uniform: 'uni_pink' }); // without the pack the gold tag isn't shown
  assert.deepEqual(effectiveLoadout(p, ['pack_supporter']), { uniform: 'uni_pink', tag: 'tag_gold' });
  assert.equal(equipCosmetic(p, null, 'uniform'), true);
  assert.equal(p.shop.equipped.uniform, undefined);
  buyCosmetic(p, 'mascot_duck'); equipCosmetic(p, 'mascot_duck');
  assert.deepEqual(outfitOf(effectiveLoadout(p)), {}); // decorations are not worn
  assert.equal(isSupporter([]), false); assert.equal(isSupporter(['pack_supporter']), true);
});

test('paid packs gate free play / own store / hosting only — the career story stays free', () => {
  for (const mode of ['free', 'own', 'host'] as const) {
    assert.equal(storeLocked('cinema', mode, [])?.id, 'pack_nightlife');
    assert.equal(storeLocked('salon', mode, [])?.id, 'pack_services');
    assert.equal(storeLocked('cinema', mode, ['pack_nightlife']), null);
    assert.equal(storeLocked('salon', mode, ['pack_nightlife'])?.id, 'pack_services');
    assert.equal(storeLocked('convenience', mode, []), null);
    assert.equal(storeLocked('cafe', mode, []), null);
  }
  for (const mode of ['story', 'daily', 'joinRoom', 'raid'] as const) for (const m of MAPS) assert.equal(storeLocked(m.id, mode, []), null, `${mode} ${m.id}`);
  // every story shift in a premium store is still playable without buying anything
  const premiumShifts = CHAPTERS.flatMap(c => c.shifts).filter(s => s.map && packForStore(s.map));
  assert.ok(premiumShifts.length >= 10);
  for (const s of premiumShifts) assert.equal(storeLocked(s.map!, 'story', []), null);
});

test('payments: placeholder adapter never charges; ?devshop=1 is the only QA unlock', async () => {
  const a = new PendingAdapter('android');
  assert.equal(a.available(), false);
  const r = await a.purchase('pack_nightlife');
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.reason, 'unavailable'); assert.ok(r.message.startsWith(NOT_YET)); }
  assert.equal((await a.restore()).ok, false);
  assert.equal(devShop('?devshop=1'), true);
  assert.equal(devShop('?a=b&devshop=1'), true);
  for (const q of ['', '?devshop=0', '?devshop=true', '?devshop', '?xdevshop=1', '#devshop=1']) assert.equal(devShop(q), false, q);
});

class FakeConn implements Conn {
  snap: Snapshot | null = null; lobby: LobbyState | null = null;
  send(m: ServerMsg) { if (m.type === 'snap') this.snap = m.s; if (m.type === 'lobby') this.lobby = m.lobby; }
  close() {}
}

test('outfits travel with join/create and show up in the lobby and snapshots (old clients still work)', () => {
  assert.equal(sanitizeOutfit(null), undefined);
  assert.equal(sanitizeOutfit({ hat: 'uni_pink', foo: 'hat_cap' }), undefined);
  assert.deepEqual(sanitizeOutfit({ hat: 'hat_cap', uniform: 'uni_neon', tag: 'tag_star', mascot: 'mascot_cat' }), { hat: 'hat_cap', uniform: 'uni_neon', tag: 'tag_star' });
  let t = 1_000_000;
  const room = new Room('SHOP1', defaultSave(), { now: () => t });
  const a = new FakeConn(), b = new FakeConn();
  const ra = room.join(a, 'A', undefined, 'web', { hat: 'hat_crown', tag: 'tag_heart' });
  const rb = room.join(b, 'B', undefined, 'web'); // an older client sends no outfit
  assert.ok(ra.ok && rb.ok);
  assert.deepEqual(b.lobby!.players.find(p => p.name === 'A')!.outfit, { hat: 'hat_crown', tag: 'tag_heart' });
  assert.equal(b.lobby!.players.find(p => p.name === 'B')!.outfit, undefined);
  room.startGame();
  for (let i = 0; i < 10; i++) { t += 50; room.update(0.05); }
  const snapA = b.snap!.players.find(p => p.name === 'A')!;
  assert.deepEqual(snapA.outfit, { hat: 'hat_crown', tag: 'tag_heart' });
  assert.equal(b.snap!.players.find(p => p.name === 'B')!.outfit, undefined);
  // the checkpoint keeps it (server restart) and a restore re-sanitizes it
  const cp = JSON.parse(JSON.stringify(room.checkpoint()));
  cp.members[1].outfit = { hat: '<script>' };
  const back = Room.restore(cp);
  assert.deepEqual(back.lobbyState().players.map(p => p.outfit), [{ hat: 'hat_crown', tag: 'tag_heart' }, undefined]);
});
