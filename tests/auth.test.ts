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
