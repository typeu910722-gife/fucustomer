// Google sign-in verification (with a locally generated key standing in for Google's) and licence cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LicenseRegistry, verifyGoogleIdToken } from '../server/auth.ts';

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
