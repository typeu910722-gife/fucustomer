// In-page harness for offline audio QA (bundled with esbuild by tests/e2e/audio-lib.mjs).
// Renders the real client/src/audio.ts through an OfflineAudioContext. Timers (setInterval/setTimeout) and
// performance.now() are replaced by a virtual clock that is advanced with OfflineAudioContext.suspend(), so the
// music scheduler and store-ambience events run exactly as they would in real time. Math.random is seeded.
import { Audio } from '../../client/src/audio';
import { SIG_KINDS } from '../../shared/sigkarens';

interface Step { t: number; call: 'play' | 'karen' | 'music' | 'amb' | 'stopMusic' | 'stopAmb'; name?: string; k?: number; x?: number; z?: number; mood?: number }
export interface RenderSpec { dur: number; steps: Step[]; bypassLimiter?: boolean; volume?: number; master?: number; music?: number; sr?: number; seed?: number }

let vnow = 0;
let nextId = 1;
const timers = new Map<number, { fn: () => void; ms: number; due: number; rep: boolean }>();
const w = window as unknown as Record<string, unknown>;
w.setInterval = (fn: () => void, ms = 0) => { const id = nextId++; timers.set(id, { fn, ms: Math.max(1, ms), due: vnow + Math.max(1, ms), rep: true }); return id; };
w.setTimeout = (fn: () => void, ms = 0) => { const id = nextId++; timers.set(id, { fn, ms, due: vnow + ms, rep: false }); return id; };
w.clearInterval = w.clearTimeout = (id: number) => { timers.delete(id); };
performance.now = () => vnow;
function runTimers() {
  for (let guard = 0; guard < 10000; guard++) {
    let best: [number, { fn: () => void; ms: number; due: number; rep: boolean }] | null = null;
    for (const e of timers) if (e[1].due <= vnow && (!best || e[1].due < best[1].due)) best = e;
    if (!best) return;
    const [id, tm] = best;
    if (tm.rep) tm.due += tm.ms; else timers.delete(id);
    tm.fn();
  }
}

async function render(spec: RenderSpec): Promise<string> {
  const sr = spec.sr ?? 48000;
  let seed = spec.seed ?? 12345;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  vnow = 0; timers.clear();
  const ctx = new OfflineAudioContext(1, Math.ceil((spec.dur + 0.3) * sr), sr);
  if (spec.bypassLimiter) (ctx as unknown as { createDynamicsCompressor: () => AudioNode }).createDynamicsCompressor = () => {
    const g = ctx.createGain();
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) Object.defineProperty(g, k, { value: { value: 0, setValueAtTime() { /* bypass */ } } });
    return g;
  };
  w.AudioContext = function () { return ctx; };
  const a = new Audio();
  a.volume = spec.volume ?? 0.7; a.masterVolume = spec.master ?? 1; a.musicVolume = spec.music ?? 0.5;
  a.unlock();
  const doStep = (s: Step) => {
    switch (s.call) {
      case 'play': a.play(s.name!, s.x, s.z, s.k ?? 1); break;
      case 'karen': a.play('karen'); a.karenSting(s.name!); break;
      case 'music': a.startMusic(s.mood ?? 0); break;
      case 'amb': a.startStoreAmbience(s.name!); break;
      case 'stopMusic': a.stopMusic(); break;
      case 'stopAmb': a.stopStoreAmbience(); break;
    }
  };
  const quantum = 128 / sr;
  const tick = 0.02;
  // Lead-in: DynamicsCompressorNode starts out fully compressed and releases over ~release time, so a sound at
  // t=0 of a fresh context would be squashed (never happens in the game, where the context runs long before).
  const lead = 0.3;
  const steps = spec.steps.map(s => ({ ...s, t: s.t + lead })).sort((p, q) => p.t - q.t);
  for (const s of steps.filter(s => s.t <= 0)) doStep(s);
  let si = steps.findIndex(s => s.t > 0); if (si < 0) si = steps.length;
  for (let t = tick; t < spec.dur + lead - 0.01; t += tick) {
    const tq = Math.round(t / quantum) * quantum;
    void ctx.suspend(tq).then(() => {
      vnow = tq * 1000;
      while (si < steps.length && steps[si].t <= tq + 1e-9) doStep(steps[si++]);
      runTimers();
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const bytes = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as unknown as { __audioQA: unknown }).__audioQA = { render, sigKinds: SIG_KINDS };
