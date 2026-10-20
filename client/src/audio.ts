// Procedural sound effects (WebAudio, no asset downloads) with simple distance attenuation.
export class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  volume = 0.7;
  listener = { x: 0, z: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private ambient: { stop(): void } | null = null;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // gentle limiter so stacked effects (ultimate + crash + eject) never clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.6;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }
  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }

  private gainFor(x?: number, z?: number) {
    if (x === undefined || z === undefined) return 1;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    return Math.max(0.08, 1 / (1 + d * 0.18));
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const c = this.ctx; if (!c || !this.master) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, at = 0, type: BiquadFilterType = 'lowpass') {
    const c = this.ctx; if (!c || !this.master || !this.noiseBuf) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  }

  private lastPlayed = new Map<string, number>();
  private voices = 0;
  /** Minimum gap between two plays of the same effect (ms); loud one-shots get a longer gap. */
  private static GAP: Record<string, number> = { step: 120, knock: 120, cash: 70, impact: 150, crash: 250, karen: 600, ultimate: 800, error: 200, achievement: 400, levelup: 400 };

  play(name: string, x?: number, z?: number) {
    if (!this.ctx) return;
    const now = performance.now();
    const gap = Audio.GAP[name] ?? 50;
    if (now - (this.lastPlayed.get(name) ?? -1e9) < gap) return; // same sound fired twice at once: play it once
    if (this.voices > 24 && name !== 'ultimate' && name !== 'achievement') return; // too busy: drop minor sounds
    this.lastPlayed.set(name, now);
    this.voices++; window.setTimeout(() => { this.voices--; }, 400);
    const v = this.gainFor(x, z);
    switch (name) {
      case 'grab': this.tone(330, 0.12, 'triangle', 0.16 * v, 0, 520); this.noise(0.12, 0.12 * v, 1200); this.tone(260, 0.18, 'sawtooth', 0.05 * v, 0.06, 420); break;
      case 'hit': this.noise(0.12, 0.35 * v, 2500); this.tone(180, 0.12, 'square', 0.14 * v, 0, 70); this.tone(1200, 0.08, 'triangle', 0.06 * v, 0.03); break;
      case 'throw': this.noise(0.35, 0.18 * v, 1800, 0, 'bandpass'); this.tone(700, 0.3, 'sine', 0.1 * v, 0, 240); break;
      case 'eject': this.noise(0.2, 0.25 * v, 900); [659, 880, 1175].forEach((f, i) => this.tone(f, 0.16, 'square', 0.07 * v, 0.08 + i * 0.07)); break;
      case 'impact': this.noise(0.22, 0.32 * v, 600); this.tone(110, 0.22, 'sine', 0.2 * v, 0, 55); break;
      case 'mistake': this.tone(392, 0.18, 'square', 0.09 * v); this.tone(277, 0.3, 'square', 0.09 * v, 0.16); break;
      case 'spin': this.noise(0.5, 0.18 * v, 2200, 0, 'bandpass'); this.tone(300, 0.45, 'triangle', 0.08 * v, 0, 900); break;
      case 'ultimate':
        this.tone(110, 0.9, 'sawtooth', 0.12, 0, 55); this.noise(0.9, 0.3, 1400);
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.35, 'square', 0.06, 0.15 + i * 0.06)); break;
      case 'outage': this.tone(220, 0.6, 'sawtooth', 0.1, 0, 40); this.noise(0.3, 0.15, 300); break;
      case 'unplug': this.tone(1400, 0.05, 'square', 0.1 * v); this.noise(0.08, 0.12 * v, 4000, 0.03, 'highpass'); break;
      case 'levelup': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.11, i * 0.07)); break;
      case 'achievement': [784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.12, i * 0.1)); this.tone(1568, 0.7, 'triangle', 0.08, 0.32); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.12, i * 0.13)); break;
      case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.1, i * 0.16)); break;
      case 'cash': this.tone(1318, 0.12, 'square', 0.12 * v); this.tone(1760, 0.3, 'square', 0.1 * v, 0.08); this.noise(0.15, 0.08 * v, 6000, 0.05, 'highpass'); break;
      case 'door': this.tone(988, 0.35, 'sine', 0.15 * v); this.tone(784, 0.5, 'sine', 0.13 * v, 0.18); break;
      case 'splat': this.noise(0.25, 0.25 * v, 700); break;
      case 'angry': this.tone(160, 0.4, 'sawtooth', 0.12 * v, 0, 90); break;
      case 'crash': this.noise(0.6, 0.45 * v, 2500); this.tone(90, 0.4, 'square', 0.15 * v); break;
      case 'knock': this.noise(0.18, 0.25 * v, 1500); this.tone(220, 0.15, 'triangle', 0.1 * v, 0, 120); break;
      case 'pickup': this.tone(520, 0.08, 'triangle', 0.15 * v, 0, 780); break;
      case 'drop': this.tone(300, 0.12, 'triangle', 0.15 * v, 0, 160); this.noise(0.1, 0.1 * v, 900); break;
      case 'stock': this.tone(660, 0.07, 'triangle', 0.12 * v); this.tone(880, 0.07, 'triangle', 0.12 * v, 0.07); break;
      case 'brew': this.noise(0.8, 0.08 * v, 500); this.tone(1200, 0.15, 'sine', 0.08 * v, 0.7); break;
      case 'deliver': this.tone(784, 0.1, 'sine', 0.14 * v); this.tone(1046, 0.18, 'sine', 0.14 * v, 0.1); break;
      case 'clean': this.noise(0.35, 0.15 * v, 3500, 0, 'bandpass'); this.tone(1568, 0.2, 'sine', 0.06 * v, 0.25); break;
      case 'calm': this.tone(523, 0.3, 'sine', 0.1 * v); this.tone(659, 0.3, 'sine', 0.1 * v, 0.05); this.tone(784, 0.4, 'sine', 0.1 * v, 0.1); break;
      case 'ping': this.tone(1480, 0.12, 'sine', 0.18); this.tone(1975, 0.18, 'sine', 0.14, 0.1); break;
      case 'buy': this.tone(880, 0.08, 'square', 0.08); this.tone(1320, 0.12, 'square', 0.08, 0.08); break;
      case 'upgrade': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, i * 0.08)); break;
      case 'open': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.13, i * 0.12)); break;
      case 'karen': this.tone(700, 0.15, 'square', 0.09); this.tone(500, 0.15, 'square', 0.09, 0.16); this.tone(700, 0.15, 'square', 0.09, 0.32); break;
      case 'error': this.tone(220, 0.15, 'square', 0.07); break;
      case 'step': this.noise(0.05, 0.035, 900); break;
      case 'quick': this.tone(1046, 0.08, 'sine', 0.1); this.tone(1318, 0.1, 'sine', 0.1, 0.07); break;
    }
  }

  // ---------------- procedural background music ----------------
  private musicGain: GainNode | null = null;
  private musicTimer = 0;
  private musicMood = -1;
  private nextBeat = 0;
  private beat = 0;
  musicVolume = 0.5;
  setMusicVolume(v: number) { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v * 0.35; }

  /** mood: 0 co-op, 1–6 chapters, 7 endless, 8 main menu. Different tempo, key and chord loop per mood. */
  startMusic(mood: number) {
    const c = this.ctx; if (!c || !this.master) return;
    if (this.musicMood === mood && this.musicTimer) return;
    this.stopMusic();
    this.musicMood = mood;
    this.musicGain = c.createGain(); this.musicGain.gain.value = this.musicVolume * 0.35; this.musicGain.connect(this.master);
    this.nextBeat = c.currentTime + 0.1; this.beat = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 90);
  }
  stopMusic() {
    clearInterval(this.musicTimer); this.musicTimer = 0; this.musicMood = -1;
    if (this.musicGain) { const g = this.musicGain; try { g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.2); } catch { /* ignore */ } setTimeout(() => g.disconnect(), 800); }
    this.musicGain = null;
  }

  private schedule() {
    const c = this.ctx; if (!c || !this.musicGain) return;
    const M = MOODS[this.musicMood] ?? MOODS[0];
    const spb = 60 / M.bpm / 2; // eighth notes
    while (this.nextBeat < c.currentTime + 0.35) {
      const t = this.nextBeat, b = this.beat;
      const bar = Math.floor(b / 8), step = b % 8;
      const chord = M.prog[bar % M.prog.length].map(n => n + M.root);
      if (step === 0) for (const n of chord) this.note(n + 12, spb * 7.5, M.pad, 0.05, t);       // pad
      if (step === 0 || step === 4) this.note(chord[0] - 12, spb * 3.5, 'triangle', 0.16, t);      // bass
      if (M.drums) {
        if (step === 0 || step === 4) this.kick(t);
        if (step % 2 === 1) this.hat(t, 0.035);
        if (M.bpm > 115 && (step === 2 || step === 6)) this.hat(t, 0.06, 2500);
      }
      // melody: chord tones with a few passing notes, deterministic per bar
      const seed = (bar * 7 + step * 13 + this.musicMood * 31) % 17;
      if (seed % (M.sparse ? 3 : 2) === 0) {
        const tone = chord[seed % chord.length] + 24 + (seed % 5 === 0 ? M.scale[(seed >> 1) % M.scale.length] - chord[0] % 12 : 0);
        this.note(tone, spb * 0.9, M.lead, 0.06, t);
      }
      this.nextBeat += spb; this.beat++;
    }
  }
  private note(midi: number, dur: number, type: OscillatorType, vol: number, t: number) {
    const c = this.ctx!; const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicGain!); o.start(t); o.stop(t + dur + 0.05);
  }
  private kick(t: number) {
    const c = this.ctx!; const o = c.createOscillator(); const g = c.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.musicGain!); o.start(t); o.stop(t + 0.2);
  }
  private hat(t: number, vol: number, freq = 7000) {
    const c = this.ctx!; if (!this.noiseBuf) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.musicGain!); s.start(t); s.stop(t + 0.06);
  }

  // ---------------- per-store ambience (procedural, very quiet) ----------------
  private storeAmb: { timer: number; nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
  /** Background sounds for each kind of store: a steady bed plus occasional little events. */
  startStoreAmbience(mapId: string) {
    this.stopStoreAmbience();
    const c = this.ctx; if (!c || !this.master || !this.noiseBuf) return;
    const p = STORE_AMBIENCE[mapId] ?? STORE_AMBIENCE.convenience;
    const gain = c.createGain(); gain.gain.value = 0.6 * this.musicVolume; gain.connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    if (p.bed) { // looping filtered noise (fridge hum, fryer sizzle, crowd murmur…)
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = p.bed.type; f.frequency.value = p.bed.freq; f.Q.value = p.bed.q ?? 0.7;
      const g = c.createGain(); g.gain.value = p.bed.vol;
      s.connect(f); f.connect(g); g.connect(gain); s.start(); nodes.push(s);
    }
    if (p.hum) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = p.hum; const g = c.createGain(); g.gain.value = 0.012; o.connect(g); g.connect(gain); o.start(); nodes.push(o); }
    const tick = () => {
      if (!this.storeAmb) return;
      for (const e of p.events) if (Math.random() < 1 / e.every) STORE_EVENTS[e.kind]?.(this, gain);
    };
    this.storeAmb = { timer: window.setInterval(tick, 1000), nodes, gain };
  }
  stopStoreAmbience() {
    const a = this.storeAmb; if (!a) return;
    clearInterval(a.timer); this.storeAmb = null;
    try { a.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.2); } catch { /* ignore */ }
    setTimeout(() => { for (const n of a.nodes) { try { n.stop(); } catch { /* ignore */ } } a.gain.disconnect(); }, 600);
  }
  /** A short note burst into a given output (used by the ambience events). */
  blip(out: AudioNode, freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  hiss(out: AudioNode, dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', at = 0) {
    const c = this.ctx; if (!c || !this.noiseBuf) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  }

  /** Entrance sting for a karen: every kind gets its own little 3-note motif (stable per kind). */
  karenSting(kind: string) {
    if (!this.ctx) return;
    let h = 2166136261; for (const ch of kind) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    h >>>= 0;
    const scale = [0, 3, 5, 6, 7, 10, 12];
    const base = 330 + (h % 5) * 40, type: OscillatorType = (['square', 'sawtooth', 'triangle'] as const)[(h >>> 3) % 3];
    for (let i = 0; i < 3; i++) {
      const semi = scale[(h >>> (5 + i * 3)) % scale.length] - (i === 2 ? 12 : 0);
      this.tone(base * Math.pow(2, semi / 12), 0.13, type, 0.07, 0.5 + i * 0.14); // after the generic alarm
    }
  }

  /** Soft store ambience: low pad + occasional chime. */
  startAmbient() {
    const c = this.ctx; if (!c || !this.master || this.ambient) return;
    const g = c.createGain(); g.gain.value = 0.025; g.connect(this.master);
    const oscs = [196, 247, 294].map(f => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(); return o; });
    const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.015; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    this.ambient = { stop: () => { oscs.forEach(o => o.stop()); lfo.stop(); g.disconnect(); } };
  }
  stopAmbient() { this.ambient?.stop(); this.ambient = null; }
}
interface Mood { bpm: number; root: number; prog: number[][]; scale: number[]; pad: OscillatorType; lead: OscillatorType; drums: boolean; sparse?: boolean }
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], PENTA = [0, 2, 4, 7, 9];
const MOODS: Record<number, Mood> = {
  0: { bpm: 92, root: 53, prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], scale: MAJ, pad: 'sine', lead: 'triangle', drums: false, sparse: true },
  1: { bpm: 104, root: 60, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], scale: MAJ, pad: 'sine', lead: 'square', drums: true },        // sunny corner shop
  2: { bpm: 82, root: 57, prog: [[2, 5, 9, 12], [7, 11, 14, 17], [0, 3, 7, 10], [0, 3, 7, 10]], scale: MIN, pad: 'sine', lead: 'triangle', drums: true, sparse: true }, // late-night jazz
  3: { bpm: 122, root: 62, prog: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], scale: MAJ, pad: 'triangle', lead: 'square', drums: true },  // station rush
  4: { bpm: 110, root: 55, prog: [[0, 4, 7], [2, 7, 9], [-3, 0, 4], [4, 7, 11]], scale: PENTA, pad: 'sine', lead: 'triangle', drums: true },   // tourist street
  5: { bpm: 128, root: 60, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], scale: MAJ, pad: 'sawtooth', lead: 'square', drums: true },  // countdown party
  6: { bpm: 140, root: 52, prog: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]], scale: MIN, pad: 'sawtooth', lead: 'square', drums: true }, // boss
  // 8: title theme on the main menu — bouncy, a bit cheeky
  8: { bpm: 118, root: 58, prog: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]], scale: PENTA, pad: 'triangle', lead: 'square', drums: true },
  7: { bpm: 116, root: 50, prog: [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]], scale: MIN, pad: 'sine', lead: 'triangle', drums: true },     // endless night
};

type AmbEvent = 'chime' | 'sizzle' | 'clink' | 'bark' | 'ding' | 'page' | 'beep' | 'thump' | 'engine' | 'dryer' | 'pa' | 'bell' | 'oven';
interface StoreAmb { bed?: { type: BiquadFilterType; freq: number; vol: number; q?: number }; hum?: number; events: { kind: AmbEvent; every: number }[] }
const FRIDGE = { type: 'lowpass' as BiquadFilterType, freq: 180, vol: 0.05 };
const MURMUR = { type: 'bandpass' as BiquadFilterType, freq: 520, vol: 0.035, q: 0.6 };
const SIZZLE = { type: 'highpass' as BiquadFilterType, freq: 3500, vol: 0.02 };
const STORE_AMBIENCE: Record<string, StoreAmb> = {
  convenience: { bed: FRIDGE, hum: 60, events: [{ kind: 'chime', every: 25 }] },
  breakfast: { bed: SIZZLE, events: [{ kind: 'sizzle', every: 6 }, { kind: 'chime', every: 30 }] },
  boba: { bed: MURMUR, events: [{ kind: 'clink', every: 5 }] },
  clothing: { bed: MURMUR, events: [{ kind: 'chime', every: 30 }] },
  chicken: { bed: SIZZLE, events: [{ kind: 'sizzle', every: 4 }] },
  drugstore: { bed: MURMUR, events: [{ kind: 'beep', every: 12 }, { kind: 'chime', every: 30 }] },
  bookstore: { bed: { type: 'lowpass', freq: 120, vol: 0.02 }, events: [{ kind: 'page', every: 6 }] },
  bakery: { bed: { type: 'lowpass', freq: 220, vol: 0.03 }, events: [{ kind: 'oven', every: 18 }, { kind: 'chime', every: 30 }] },
  supermarket: { bed: MURMUR, hum: 60, events: [{ kind: 'beep', every: 4 }, { kind: 'pa', every: 45 }] },
  petshop: { bed: MURMUR, events: [{ kind: 'bark', every: 9 }] },
  cafe: { bed: MURMUR, events: [{ kind: 'clink', every: 6 }, { kind: 'dryer', every: 25 }] },
  cinema: { bed: { type: 'lowpass', freq: 90, vol: 0.06 }, events: [{ kind: 'thump', every: 10 }] },
  hotpot: { bed: { type: 'bandpass', freq: 900, vol: 0.03, q: 0.8 }, events: [{ kind: 'clink', every: 5 }] },
  gas: { bed: { type: 'lowpass', freq: 140, vol: 0.05 }, events: [{ kind: 'engine', every: 12 }, { kind: 'bell', every: 20 }] },
  gym: { bed: MURMUR, events: [{ kind: 'thump', every: 3 }] },
  steak: { bed: SIZZLE, events: [{ kind: 'sizzle', every: 4 }, { kind: 'clink', every: 9 }] },
  electronics: { bed: { type: 'lowpass', freq: 200, vol: 0.03 }, events: [{ kind: 'beep', every: 5 }] },
  salon: { bed: MURMUR, events: [{ kind: 'dryer', every: 10 }] },
  post: { bed: MURMUR, events: [{ kind: 'ding', every: 12 }] },
  pharmacy: { bed: MURMUR, events: [{ kind: 'ding', every: 15 }] },
  hotel: { bed: { type: 'lowpass', freq: 160, vol: 0.025 }, events: [{ kind: 'bell', every: 18 }] },
};
const STORE_EVENTS: Record<AmbEvent, (a: Audio, out: AudioNode) => void> = {
  chime: (a, o) => { a.blip(o, 1318, 0.5, 'sine', 0.05); a.blip(o, 1046, 0.6, 'sine', 0.05, 0.25); },
  sizzle: (a, o) => a.hiss(o, 1.2, 0.05, 4500, 'highpass'),
  clink: (a, o) => a.blip(o, 2400 + Math.random() * 800, 0.15, 'sine', 0.04),
  bark: (a, o) => { a.blip(o, 520, 0.12, 'square', 0.04, 0, 300); a.blip(o, 560, 0.12, 'square', 0.035, 0.18, 320); },
  ding: (a, o) => a.blip(o, 1568, 0.7, 'triangle', 0.05),
  page: (a, o) => a.hiss(o, 0.25, 0.04, 2500, 'bandpass'),
  beep: (a, o) => a.blip(o, 2093, 0.08, 'square', 0.025),
  thump: (a, o) => a.blip(o, 90, 0.25, 'sine', 0.12, 0, 50),
  engine: (a, o) => a.blip(o, 70, 1.4, 'sawtooth', 0.03, 0, 45),
  dryer: (a, o) => a.hiss(o, 1.8, 0.04, 1800, 'bandpass'),
  pa: (a, o) => { [784, 988, 1175, 1568].forEach((f, i) => a.blip(o, f, 0.3, 'sine', 0.04, i * 0.2)); },
  bell: (a, o) => { a.blip(o, 2637, 0.8, 'sine', 0.04); a.blip(o, 2637, 0.8, 'sine', 0.03, 0.15); },
  oven: (a, o) => { a.blip(o, 1760, 0.15, 'square', 0.03); a.blip(o, 1760, 0.15, 'square', 0.03, 0.3); a.blip(o, 1760, 0.3, 'square', 0.03, 0.6); },
};

export const audio = new Audio();
