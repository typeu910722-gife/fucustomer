// 打擊感 (round 24): hit-stop / slow-mo clock, effect profiles, settings gating, rate limiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimit, TimeWarp, falloff, juiceProfile, stampText, throwStrength } from '../client/src/juice.ts';

const ON = { shake: true, reduceMotion: false };

test('TimeWarp: hit-stop freezes, slow-mo follows the freeze, then back to normal', () => {
  const w = new TimeWarp();
  assert.equal(w.scale(0), 1);
  w.stop(80, 1000);
  assert.equal(w.scale(1000), 0); assert.equal(w.scale(1079), 0); assert.equal(w.scale(1080), 1);
  w.stop(80, 2000); w.slow(400, 0.3, 2000);
  assert.equal(w.scale(2050), 0);       // frozen first
  assert.equal(w.scale(2100), 0.3);     // then slow-mo
  assert.equal(w.scale(2479), 0.3);
  assert.equal(w.scale(2480), 1);       // 80 + 400 ms later: normal
  // caps: a bogus huge value can never lock the screen
  w.stop(99999, 5000); assert.equal(w.scale(5201), 1);
  w.slow(99999, 0.001, 6000); assert.equal(w.scale(6001), 0.05); assert.equal(w.scale(6801), 1);
  // a shorter effect doesn't cut a longer one short
  w.stop(150, 7000); w.stop(40, 7010); assert.equal(w.scale(7100), 0);
  w.reset(); assert.equal(w.scale(7100), 1);
});

test('juiceProfile: own actions full strength; hit is heavier than throw; ultimate has slow-mo + flash', () => {
  const thr = juiceProfile('throw', 0, true, ON), hit = juiceProfile('hit', 0, true, ON), ult = juiceProfile('ultimate', 0, true, ON);
  assert.ok(thr.hitStop >= 40 && thr.hitStop <= 80, 'throw hit-stop 40–80 ms');
  assert.ok(hit.hitStop > thr.hitStop, 'hit has the heavier hit-stop');
  assert.ok(ult.slowMo > 0 && ult.slowScale < 1 && ult.flash === 1);
  assert.equal(juiceProfile('mistake', 0, true, ON).flash, 2);
  assert.ok(juiceProfile('grab', 0, true, ON).dip > 0, 'grab dips the camera');
  assert.equal(thr.k, 1);
});

test('juiceProfile: other players far away → scaled down, no freeze/shake; ultimate is store-wide', () => {
  const far = juiceProfile('eject', 14, false, ON);
  assert.equal(far.hitStop, 0); assert.equal(far.shake, 0); assert.equal(far.kick, 0);
  assert.deepEqual(far.rumble, [0, 0, 0]);
  assert.ok(far.k < 0.5 && far.k >= 0.2);
  const near = juiceProfile('eject', 2, false, ON);
  assert.equal(near.k, 1); assert.ok(near.shake > 0 && near.hitStop > 0);
  const ultFar = juiceProfile('ultimate', 30, false, ON);
  assert.ok(ultFar.slowMo > 0 && ultFar.k === 1);
  assert.equal(falloff(0), 1); assert.equal(falloff(3), 1); assert.equal(falloff(100), 0.2); assert.equal(falloff(NaN), 1);
  assert.ok(falloff(6) > falloff(9));
});

test('juiceProfile: 畫面震動 off kills shake only; 減少動態效果 kills shake, hit-stop, slow-mo, flash, kick', () => {
  const noShake = juiceProfile('hit', 0, true, { shake: false, reduceMotion: false });
  assert.equal(noShake.shake, 0); assert.ok(noShake.hitStop > 0);
  for (const kind of ['grab', 'throw', 'eject', 'spin', 'ultimate', 'hit', 'mistake', 'shove'] as const) {
    const p = juiceProfile(kind, 0, true, { shake: true, reduceMotion: true });
    assert.equal(p.shake, 0, kind); assert.equal(p.hitStop, 0, kind); assert.equal(p.slowMo, 0, kind);
    assert.equal(p.flash, 0, kind); assert.equal(p.kick, 0, kind); assert.equal(p.dip, 0, kind);
    // sounds (k) and rumble stay
    assert.equal(p.k, 1, kind);
  }
  assert.ok(juiceProfile('ultimate', 0, true, { shake: true, reduceMotion: true }).rumble[0] > 0);
});

test('throwStrength follows the sim lift clamp; stamp texts; rate limit', () => {
  assert.equal(throwStrength(-1), 0.6); assert.equal(throwStrength(1), 1.4);
  assert.ok(throwStrength(0.2) > throwStrength(0)); assert.equal(throwStrength(NaN), throwStrength(0));
  assert.equal(stampText('eject', 1), '退散！'); assert.equal(stampText('eject', 6), '神手退散！');
  assert.equal(stampText('ultimate'), '全店退散！！'); assert.equal(stampText('hit'), '啪！');
  const r = new RateLimit(2500);
  assert.ok(r.ok('sad', 0)); assert.ok(!r.ok('sad', 2000)); assert.ok(r.ok('other', 2000)); assert.ok(r.ok('sad', 2600));
});
