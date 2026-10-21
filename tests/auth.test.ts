// Google sign-in verification (with a locally generated key standing in for Google's) and licence cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LicenseRegistry, normalizeLinkCode, verifyGoogleIdToken } from '../server/auth.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const keys = async () => [jwk];
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, kid = 'k1', key = privateKey) {
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(claims);
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
const now = Date.now();
const good = { sub: '1234567890', aud: 'client-1', iss: 'https://accounts.google.com', exp: Math.floor(now / 1000) + 600, name: '王小明', email: 'x@example.com' };

test('Google ID token: signature, audience, issuer and expiry are all checked', async () => {
  assert.equal((await verifyGoogleIdToken(token(good), 'client-1', keys, now))?.sub, '1234567890');
  assert.equal(await verifyGoogleIdToken(token(good), 'other-client', keys, now), null, 'wrong audience');
  assert.equal(await verifyGoogleIdToken(token({ ...good, iss: 'evil.com' }), 'client-1', keys, now), null, 'wrong issuer');
  assert.equal(await verifyGoogleIdToken(token({ ...good, exp: Math.floor(now / 1000) - 10 }), 'client-1', keys, now), null, 'expired');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await verifyGoogleIdToken(token(good, 'k1', other), 'client-1', keys, now), null, 'signed by someone else');
  assert.equal(await verifyGoogleIdToken(token(good, 'nope'), 'client-1', keys, now), null, 'unknown key id');
  const [h, , s] = token(good).split('.');
  assert.equal(await verifyGoogleIdToken(`${h}.${b64({ ...good, sub: 'hacker' })}.${s}`, 'client-1', keys, now), null, 'tampered payload');
  assert.equal(await verifyGoogleIdToken('garbage', 'client-1', keys, now), null);
  assert.equal(await verifyGoogleIdToken(token(good), '', keys, now), null, 'sign-in off without a client id');
});

test('licence cards: one per Google account, session-protected updates, public lookup without private data', () => {
  const saved: string[] = [];
  const reg = new LicenseRegistry(r => saved.push(r.no));
  const a = reg.login('1234567890', '王小明');
  assert.match(a.no, /^\d{4}-\d{4}$/);
  const again = reg.login('1234567890');
  assert.equal(again.no, a.no, 'same account, same licence');
  assert.notEqual(again.session, a.session);
  assert.equal(reg.update('bad', { level: 9 }).ok, false);
  const u = reg.update(a.session, { name: '社畜<b>', level: 28, rank: '區域督導', stars: 40, achievements: 9, avatar: '🧑‍🍳', quote: '上班好累' });
  assert.ok(u.ok); if (u.ok) { assert.equal(u.value.name, '社畜b'); assert.equal(u.value.level, 28); }
  const pub = reg.get(a.no);
  assert.ok(pub.ok);
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('1234567890') && !text.includes('session') && !text.includes('owner'), 'no account id, no sessions in the public card');
  assert.equal(reg.get('0000-0000').ok, false);
  reg.logout(a.session);
  assert.equal(reg.update(a.session, { level: 1 }).ok, false, 'logged-out session no longer works');
  assert.ok(reg.update(again.session, { level: 30 }).ok, 'other device still signed in');
  const b = reg.login('999', '別人');
  assert.notEqual(b.no, a.no);
  assert.ok(saved.length >= 5);
});

test('licence cards: weekly badges are week ids only, bounded, and old cards still load', () => {
  const reg = new LicenseRegistry();
  const a = reg.login('42', '週章王');
  // a card from before the field existed
  const old = reg.get(a.no); assert.ok(old.ok); if (old.ok) { assert.deepEqual(old.value.weekBadges, []); assert.equal(old.value.weekBadgeCount, 0); }
  const legacy = { ...reg.byNo.get(a.no)! } as Record<string, unknown>; delete legacy.weekBadges; delete legacy.weekBadgeCount;
  assert.deepEqual(reg.view(legacy as never).weekBadges, [], 'stored record without the field');
  const weeks = Array.from({ length: 12 }, (_, i) => `2026-W${String(30 + i).padStart(2, '0')}`);
  const u = reg.update(a.session, { weekBadges: [...weeks, '2026-W31', '<img src=x>', 'evil', 7, '2026-W99'], weekBadgeCount: 12 });
  assert.ok(u.ok); if (u.ok) {
    assert.deepEqual(u.value.weekBadges, weeks.slice(-8), 'valid, de-duplicated, newest 8');
    assert.equal(u.value.weekBadgeCount, 12);
  }
  const pub = reg.get(a.no); assert.ok(pub.ok); if (pub.ok) assert.deepEqual(pub.value.weekBadges, weeks.slice(-8), 'friends see them');
  // bad values are ignored (the card keeps what it had)
  for (const bad of ['2026-W40', { a: 1 }, null, Array(600).fill('2026-W01')]) reg.update(a.session, { weekBadges: bad });
  for (const bad of ['5', NaN, Infinity, null]) reg.update(a.session, { weekBadgeCount: bad });
  const after = reg.get(a.no); assert.ok(after.ok); if (after.ok) { assert.deepEqual(after.value.weekBadges, weeks.slice(-8)); assert.equal(after.value.weekBadgeCount, 12); }
  const big = reg.update(a.session, { weekBadgeCount: 1e9 }); assert.ok(big.ok); if (big.ok) assert.equal(big.value.weekBadgeCount, 520, 'count capped');
  const low = reg.update(a.session, { weekBadgeCount: -3 }); assert.ok(low.ok); if (low.ok) assert.equal(low.value.weekBadgeCount, 8, 'never below the listed badges');
});

test('link via browser (app sign-in): start → complete in the browser → poll once, code alone is useless', () => {
  let t = 1_000_000;
  const reg = new LicenseRegistry(() => {}, () => t);
  const web = reg.login('1234567890', '王小明');
  const s = reg.linkStart('1.2.3.4');
  assert.ok(s.ok); if (!s.ok) return;
  assert.match(s.value.code, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  assert.match(s.value.pollToken, /^[0-9a-f]{64}$/);
  assert.equal(s.value.expiresIn, 600);
  // still waiting
  const p0 = reg.linkPoll(s.value.pollToken);
  assert.ok(p0.ok && 'pending' in p0.value);
  // the code is not a poll token, and a wrong token gets nothing
  assert.equal(reg.linkPoll(s.value.code).ok, false);
  assert.equal(reg.linkPoll('0'.repeat(64)).ok, false);
  assert.equal(reg.linkPoll(undefined).ok, false);
  // completing needs a signed-in browser session
  assert.equal(reg.linkComplete('bad', s.value.code).ok, false);
  assert.equal(reg.linkComplete(web.session, 'ZZZ-ZZZ').ok, false);
  const c = reg.linkComplete(web.session, s.value.code.toLowerCase().replace('-', ' ')); // typed loosely still works
  assert.ok(c.ok); if (c.ok) assert.equal(c.value.no, web.no);
  assert.equal(reg.linkComplete(web.session, s.value.code).ok, false, 'code is single-use');
  const p1 = reg.linkPoll(s.value.pollToken);
  assert.ok(p1.ok && 'session' in p1.value); if (!p1.ok || !('session' in p1.value)) return;
  assert.equal(p1.value.no, web.no);
  assert.notEqual(p1.value.session, web.session, 'the app gets its own new session');
  assert.ok(reg.update(p1.value.session, { level: 3 }).ok, 'app session works');
  assert.ok(reg.update(web.session, { level: 4 }).ok, 'browser session still works');
  assert.equal(reg.linkPoll(s.value.pollToken).ok, false, 'handed out once, then gone');
  assert.equal(reg.links.size, 0);
  assert.equal(normalizeLinkCode('k7q4mz'), 'K7Q-4MZ');
  assert.equal(normalizeLinkCode('K0Q-4MZ'), '', 'ambiguous 0 not in the alphabet');
});

test('link via browser: codes expire after 10 minutes; an uncollected session is revoked', () => {
  let t = 5_000_000;
  const reg = new LicenseRegistry(() => {}, () => t);
  const web = reg.login('42', 'A');
  const s1 = reg.linkStart('ip'); assert.ok(s1.ok); if (!s1.ok) return;
  t += 10 * 60 * 1000 + 1;
  assert.equal(reg.linkComplete(web.session, s1.value.code).ok, false, 'expired code');
  assert.equal(reg.linkPoll(s1.value.pollToken).ok, false, 'expired poll');
  // completed but the app never came back: the parked session dies with the link
  const s2 = reg.linkStart('ip'); assert.ok(s2.ok); if (!s2.ok) return;
  assert.ok(reg.linkComplete(web.session, s2.value.code).ok);
  const r = reg.byOwner.values().next().value!;
  assert.equal(r.sessions.length, 2);
  t += 10 * 60 * 1000 + 1;
  reg.linkStart('other-ip');
  assert.equal(r.sessions.length, 1, 'uncollected app session revoked');
  assert.ok(reg.update(web.session, { level: 2 }).ok);
});

test('link via browser: per-IP start limit, and the app session counts toward the 5-device cap', () => {
  const reg = new LicenseRegistry();
  for (let i = 0; i < 10; i++) assert.ok(reg.linkStart('9.9.9.9').ok);
  const over = reg.linkStart('9.9.9.9');
  assert.equal(over.ok, false); if (!over.ok) assert.equal(over.status, 429);
  assert.ok(reg.linkStart('8.8.8.8').ok, 'other IPs unaffected');
  const first = reg.login('7');
  for (let i = 0; i < 4; i++) reg.login('7');
  const s = reg.linkStart('1.1.1.1'); assert.ok(s.ok); if (!s.ok) return;
  const last = reg.login('7');
  assert.ok(reg.linkComplete(last.session, s.value.code).ok);
  assert.equal(reg.update(first.session, {}).ok, false, 'oldest device dropped when the app session is added');
});

// ---------------- 雲端備份 (cloud save) ----------------
import { CloudSaveStore } from '../server/cloudsave.ts';
import { CLOUD_MAX_CODE, CLOUD_UPLOADS_PER_DAY, CLOUD_RETENTION_MS, CloudOpsCounter, type CloudRecord } from '../shared/cloudsave.ts';
import { K, checksum, parseSaveCode } from '../shared/savecode.ts';
import { newProfile } from '../shared/career.ts';

function forgedCode(level: number, extra: Record<string, unknown> = {}) {
  // hand-made code claiming paid packs (an honest export never contains them)
  const p = newProfile(); p.level = level; p.wallet = 100 * level; p.shop.entitlements = ['pack_supporter', 'pack_nightlife'];
  const body = Buffer.from(JSON.stringify({ v: 1, at: 1000 + level, career: p, settings: { name: '雲端' }, flags: {}, avatar: null, solo: {}, coop: null, ...extra }), 'utf8').toString('base64url');
  return `FUC1-${body}-${checksum(body)}`;
}
function cloudSetup(start = Date.UTC(2026, 9, 20, 3, 0, 0)) {
  let t = start;
  const reg = new LicenseRegistry(() => {}, () => t);
  const writes: [string, CloudRecord | null][] = [];
  const cloud = new CloudSaveStore({ ownerOf: s => reg.ownerOf(s), now: () => t, persist: (o, r) => writes.push([o, r]) });
  return { reg, cloud, writes, tick: (ms: number) => { t += ms; }, now: () => t };
}

test('cloud save: sign-in required; upload, read back, previous version kept; delete', () => {
  const { reg, cloud, writes, tick } = cloudSetup();
  const a = reg.login('cloud-1', '雲端王');
  for (const bad of [undefined, '', 'nope']) {
    const r = cloud.put(bad, { code: forgedCode(3) }); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.status, 401);
    const g = cloud.get(bad); assert.equal(g.ok, false); if (!g.ok) assert.equal(g.status, 401);
    const d = cloud.delete(bad); assert.equal(d.ok, false); if (!d.ok) assert.equal(d.status, 401);
  }
  const none = cloud.get(a.session); assert.equal(none.ok, false); if (!none.ok) assert.equal(none.status, 404);
  const up1 = cloud.put(a.session, { code: forgedCode(5) });
  assert.ok(up1.ok); if (!up1.ok) return;
  assert.equal(up1.value.summary.level, 5); assert.equal(up1.value.used, 1); assert.equal(up1.value.max, CLOUD_UPLOADS_PER_DAY);
  tick(61_000);
  const up2 = cloud.put(a.session, { code: forgedCode(9) }); assert.ok(up2.ok);
  const g = cloud.get(a.session); assert.ok(g.ok); if (!g.ok) return;
  assert.equal(g.value.latest.summary.level, 9); assert.equal(g.value.prev?.summary.level, 5, 'one previous version');
  assert.ok(g.value.latest.at > g.value.prev!.at);
  assert.equal(g.value.quota.used, 2);
  tick(61_000);
  assert.ok(cloud.put(a.session, { code: forgedCode(12) }).ok);
  const g3 = cloud.get(a.session); assert.ok(g3.ok); if (g3.ok) { assert.equal(g3.value.latest.summary.level, 12); assert.equal(g3.value.prev?.summary.level, 9, 'only one previous version'); }
  // another account cannot see it
  const b = reg.login('cloud-2');
  assert.equal(cloud.get(b.session).ok, false);
  // a signed-out session loses access; the other device of the same account still has it
  const a2 = reg.login('cloud-1');
  reg.logout(a.session);
  assert.equal(cloud.get(a.session).ok, false);
  assert.ok(cloud.get(a2.session).ok);
  const d = cloud.delete(a2.session); assert.ok(d.ok); if (d.ok) assert.equal(d.value.deleted, true);
  assert.equal(cloud.get(a2.session).ok, false, 'gone after delete');
  assert.deepEqual(writes.at(-1)?.[1], null, 'persisted as deleted');
  assert.equal(writes.at(-1)?.[0].length, 64, 'keyed by the licence owner hash, not the e-mail or Google id');
  const d2 = cloud.delete(a2.session); assert.ok(d2.ok); if (d2.ok) assert.equal(d2.value.deleted, false);
});

test('cloud save: stored copy is re-encoded and never carries paid entitlements, the account or a server URL', () => {
  const { reg, cloud } = cloudSetup();
  const a = reg.login('cloud-3');
  const raw = forgedCode(7, { settings: { name: 'x', serverUrl: 'wss://evil.example/ws' }, [K.account]: { session: 'SECRET' } });
  assert.ok(cloud.put(a.session, { code: raw }).ok);
  const g = cloud.get(a.session); assert.ok(g.ok); if (!g.ok) return;
  assert.notEqual(g.value.latest.code, raw, 'not the uploaded text');
  const back = parseSaveCode(g.value.latest.code); assert.ok(back.ok); if (!back.ok) return;
  assert.deepEqual(back.payload.career.shop.entitlements, []);
  const decoded = Buffer.from(g.value.latest.code.split('-')[1], 'base64url').toString('utf8');
  assert.ok(!decoded.includes('pack_supporter') && !decoded.includes('evil.example') && !decoded.includes('SECRET'));
});

test('cloud save: bad codes, size cap, per-account interval + daily limit, server-wide budget and slot cap', () => {
  const { reg, cloud, tick } = cloudSetup();
  const a = reg.login('cloud-4');
  for (const body of [{}, { code: 42 }, { code: 'hello' }, { code: forgedCode(2).slice(0, -3) + 'abc' }]) {
    const r = cloud.put(a.session, body); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.status, 400);
  }
  const huge = forgedCode(2, { flags: { seenKarens: [], seenMaps: [], pad: 'x'.repeat(CLOUD_MAX_CODE) } });
  const big = cloud.put(a.session, { code: huge }); assert.equal(big.ok, false); if (!big.ok) assert.equal(big.status, 413);
  assert.ok(cloud.put(a.session, { code: forgedCode(2) }).ok);
  const fast = cloud.put(a.session, { code: forgedCode(3) });
  assert.equal(fast.ok, false); if (!fast.ok) { assert.equal(fast.status, 429); assert.match(fast.error, /秒後再試/); }
  for (let i = 1; i < CLOUD_UPLOADS_PER_DAY; i++) { tick(61_000); assert.ok(cloud.put(a.session, { code: forgedCode(3) }).ok, `upload ${i + 1}`); }
  tick(61_000);
  const over = cloud.put(a.session, { code: forgedCode(3) });
  assert.equal(over.ok, false); if (!over.ok) { assert.equal(over.status, 429); assert.match(over.error, /明天/); }
  tick(24 * 3600_000);
  assert.ok(cloud.put(a.session, { code: forgedCode(4) }).ok, 'new UTC day, new quota');

  // server-wide daily budget → 503, the game keeps its local save
  let t = Date.UTC(2026, 9, 21);
  const reg2 = new LicenseRegistry(() => {}, () => t);
  const c2 = new CloudSaveStore({ ownerOf: s => reg2.ownerOf(s), now: () => t, ops: new CloudOpsCounter(3), maxSlots: 1 });
  const x = reg2.login('x'), y = reg2.login('y');
  assert.ok(c2.put(x.session, { code: forgedCode(2) }).ok);
  const full = c2.put(y.session, { code: forgedCode(2) }); assert.equal(full.ok, false); if (!full.ok) assert.equal(full.status, 503, 'slot cap');
  assert.ok(c2.get(x.session).ok);
  const busy = c2.get(x.session); assert.equal(busy.ok, false); if (!busy.ok) { assert.equal(busy.status, 503); assert.match(busy.error, /額度/); }
  t += 24 * 3600_000;
  assert.ok(c2.get(x.session).ok, 'budget resets at 00:00 UTC');
});

test('cloud save: slots without uploads for a year are pruned', () => {
  const { reg, cloud, tick, writes } = cloudSetup();
  const a = reg.login('old'), b = reg.login('new');
  assert.ok(cloud.put(a.session, { code: forgedCode(2) }).ok);
  tick(CLOUD_RETENTION_MS - 3600_000);
  assert.ok(cloud.put(b.session, { code: forgedCode(2) }).ok);
  tick(2 * 3600_000 + 24 * 3600_000);
  assert.ok(cloud.put(b.session, { code: forgedCode(3) }).ok);
  assert.equal(cloud.get(a.session).ok, false, 'old slot pruned');
  assert.ok(writes.some(([, r]) => r === null));
  assert.ok(cloud.get(b.session).ok);
});
