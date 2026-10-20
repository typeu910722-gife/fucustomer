// 打擊感 ("juice"): pure timing/strength logic for hit-stop, slow-mo, camera kick, shake and rumble.
// No DOM / three.js here so it can be unit-tested (tests/juice.test.ts). game.ts turns profiles into effects.

export type JuiceKind = 'grab' | 'throw' | 'eject' | 'spin' | 'ultimate' | 'hit' | 'mistake' | 'shove' | 'calm' | 'fail';

export interface JuicePrefs {
  /** 畫面震動 */
  shake: boolean;
  /** 減少動態效果: no shake, no slow-mo / hit-stop, no full-screen flash. */
  reduceMotion: boolean;
}

export interface JuiceProfile {
  /** World freeze (ms) — the classic "hit-stop". */
  hitStop: number;
  /** Slow-motion duration (ms) and time scale while it lasts. */
  slowMo: number; slowScale: number;
  /** Camera shake (StoreView.shake seconds-ish units), pitch kick (rad) and vertical dip (m). */
  shake: number; kick: number; dip: number;
  /** Full-screen flash: 0 none, 1 light, 2 red. */
  flash: 0 | 1 | 2;
  /** Gamepad rumble [strong, weak, ms] (all 0 = none). */
  rumble: [number, number, number];
  /** 0–1 overall strength (distance falloff for other players' actions); sounds/particles scale with it. */
  k: number;
}

const BASE: Record<JuiceKind, Omit<JuiceProfile, 'k'>> = {
  grab:     { hitStop: 0,   slowMo: 0,   slowScale: 1,    shake: 0.06, kick: 0,      dip: 0.06, flash: 0, rumble: [0.25, 0.35, 90] },
  throw:    { hitStop: 60,  slowMo: 0,   slowScale: 1,    shake: 0.15, kick: 0.035,  dip: 0,    flash: 0, rumble: [0.3, 0.5, 120] },
  eject:    { hitStop: 50,  slowMo: 0,   slowScale: 1,    shake: 0.25, kick: 0.02,   dip: 0,    flash: 0, rumble: [0.4, 0.7, 160] },
  spin:     { hitStop: 0,   slowMo: 0,   slowScale: 1,    shake: 0.2,  kick: 0,      dip: 0.03, flash: 0, rumble: [0.3, 0.6, 200] },
  ultimate: { hitStop: 80,  slowMo: 420, slowScale: 0.3,  shake: 0.65, kick: 0.05,   dip: 0.05, flash: 1, rumble: [1, 1, 450] },
  hit:      { hitStop: 110, slowMo: 0,   slowScale: 1,    shake: 0.22, kick: 0.045,  dip: 0.02, flash: 0, rumble: [0.6, 0.4, 120] },
  mistake:  { hitStop: 0,   slowMo: 0,   slowScale: 1,    shake: 0.4,  kick: 0,      dip: 0,    flash: 2, rumble: [0.7, 0.5, 220] },
  shove:    { hitStop: 0,   slowMo: 0,   slowScale: 1,    shake: 0.45, kick: -0.04,  dip: 0.04, flash: 2, rumble: [0.9, 0.6, 260] },
  calm:     { hitStop: 0,   slowMo: 0,   slowScale: 1,    shake: 0,    kick: 0,      dip: 0,    flash: 0, rumble: [0, 0, 0] },
  fail:     { hitStop: 0,   slowMo: 0,   slowScale: 1,    shake: 0,    kick: 0,      dip: 0,    flash: 0, rumble: [0, 0, 0] },
};

/** Distance falloff for effects of other players' actions: full within 3 m, fading to 0.2 at 15 m+. */
export function falloff(dist: number): number {
  if (!Number.isFinite(dist) || dist <= 3) return 1;
  return Math.max(0.2, 1 - (dist - 3) / 15);
}

/**
 * What an action should feel like. `mine` = done by this player (always full strength);
 * otherwise scaled by distance, and only nearby actions (k ≥ 0.75) freeze or shake your screen.
 */
export function juiceProfile(kind: JuiceKind, dist: number, mine: boolean, prefs: JuicePrefs): JuiceProfile {
  const b = BASE[kind];
  const k = mine ? 1 : falloff(dist);
  // ultimate is store-wide: everyone feels it in full
  const near = mine || kind === 'ultimate' || k >= 0.75;
  const motion = !prefs.reduceMotion;
  const shakeOn = motion && prefs.shake;
  return {
    hitStop: motion && near ? b.hitStop : 0,
    slowMo: motion && near ? b.slowMo : 0,
    slowScale: b.slowScale,
    shake: shakeOn && near ? b.shake * k : 0,
    kick: motion && near ? b.kick * k : 0,
    dip: motion && near ? b.dip * k : 0,
    flash: motion && near ? b.flash : 0,
    rumble: near ? [b.rumble[0] * k, b.rumble[1] * k, b.rumble[2]] : [0, 0, 0],
    k: kind === 'ultimate' ? 1 : k,
  };
}

/** Hit-stop / slow-mo clock. Times are ms (performance.now()); the longest pending effect wins. */
export class TimeWarp {
  private stopUntil = 0;
  private slowUntil = 0;
  private slowScale = 1;
  /** Freeze the world for `ms` starting at `now`. */
  stop(ms: number, now: number) { if (ms > 0) this.stopUntil = Math.max(this.stopUntil, now + Math.min(ms, 200)); }
  /** Slow the world to `scale` for `ms` (after any freeze). */
  slow(ms: number, scale: number, now: number) {
    if (ms <= 0) return;
    const until = Math.max(now, this.stopUntil) + Math.min(ms, 800);
    if (until > this.slowUntil) { this.slowUntil = until; this.slowScale = Math.max(0.05, Math.min(1, scale)); }
  }
  /** Time scale for visuals at `now`: 0 frozen, 0.05–1 slow-mo, 1 normal. */
  scale(now: number): number {
    if (now < this.stopUntil) return 0;
    if (now < this.slowUntil) return this.slowScale;
    return 1;
  }
  reset() { this.stopUntil = 0; this.slowUntil = 0; this.slowScale = 1; }
}

/** Throw strength 0.6–1.4 from the look pitch (the sim lobs higher when you look up: vy = 3.6 + lift × 5). */
export function throwStrength(pitch: number): number {
  const lift = Math.max(-0.25, Math.min(0.55, Number.isFinite(pitch) ? pitch : 0));
  return 0.6 + (lift + 0.25) / 0.8 * 0.8;
}

/** Simple per-key rate limiter (e.g. the sad-trombone sting must not spam). */
export class RateLimit {
  private last = new Map<string, number>();
  constructor(private gapMs: number) {}
  ok(key: string, now: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t < this.gapMs) return false;
    this.last.set(key, now);
    return true;
  }
}

/** Stamp text (the combo count has its own counter): 退散！, 神手退散！ from a 5-combo, 全店退散！！, 啪！ */
export function stampText(kind: 'eject' | 'ultimate' | 'hit', combo = 0): string {
  if (kind === 'ultimate') return '全店退散！！';
  if (kind === 'hit') return '啪！';
  return combo >= 5 ? '神手退散！' : '退散！';
}
