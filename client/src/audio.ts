// Procedural sound effects (WebAudio, no asset downloads) with simple distance attenuation.
//
// Mix (measured offline with scripts/audio-qa.mjs, see docs/AUDIO.md), at the default settings
// (音效 0.7, 主音量 1, 音樂 0.5):
//   each SFX → its own instance gain (per-sound trim `TRIM`, overlap ducking) → `master` (音效音量) → `out` (主音量)
//   music → musicGain → `out`
//   store ambience → ambience gain → 45 Hz high-pass → 5.5 kHz low-pass → `out`
//   `out` → 28 Hz high-pass (DC / sub rumble) → 15 kHz low-pass → limiter (DynamicsCompressor) → soft-clip ceiling → speakers
// Targets: important feedback ≈ −18 LUFS (400 ms momentary max), minor foley −24…−34, music ≈ −28 LUFS,
// store ambience ≈ −42 LUFS; nothing above −1 dBFS even when everything fires at once.
const dbToGain = (db: number) => Math.pow(10, db / 20);
/** Per-sound level trim in dB (gain staging), measured against the targets above. */
const TRIM: Record<string, number> = {
  grab: 15.5, hit: 12, throw: 14.5, eject: 16.5, impact: 11.5, mistake: 13.5, spin: 15, ultimate: 11.5,
  outage: 16, unplug: 16.5, levelup: 13.5, achievement: 12, win: 13, lose: 15, cash: 12.5, door: 11.5,
  splat: 21.5, angry: 16, crash: 7, knock: 15, pickup: 15.5, drop: 14.5, stock: 14, brew: 17, deliver: 12,
  clean: 14, calm: 12.5, ping: 10, buy: 15.5, upgrade: 13.5, open: 12, karen: 14, error: 19.5, step: 36,
  quick: 15, heave: 19, whoosh: 16, ding: 13, ooh: 22.5, stamp: 12.5, star: 16.5, dust: 28, rise: 18.5,
  bassdrop: 3.5, slap: 10.5, siren: 19.5, chime: 16, trombone: 26,
};
/** Long or loud one-shots allowed only one voice at a time; everything else at most `MAX_VOICES`. */
const SOLO = new Set(['ultimate', 'bassdrop', 'trombone', 'siren', 'achievement', 'levelup', 'win', 'lose', 'ooh', 'outage', 'open', 'door', 'brew']);
const MAX_VOICES = 3;

export class Audio {
  ctx: AudioContext | null = null;
  /** Sound-effects bus (音效音量). Music and store ambience bypass it and go straight to `out`. */
  master: GainNode | null = null;
  /** Master output (主音量) → filters → limiter → speakers. */
  out: GainNode | null = null;
  volume = 0.7;
  masterVolume = 1;
  listener = { x: 0, z: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private ambient: { stop(): void } | null = null;
  /** Where the SFX helpers connect (the current sound's instance gain). */
  private dest: AudioNode | null = null;
  /** Latest end time scheduled by the helpers during the current `play` call. */
  private endAt = 0;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.out = c.createGain();
    this.out.gain.value = this.masterVolume;
    this.master.connect(this.out);
    // master bus: strip DC / sub rumble and fizz, then a limiter, then a soft ceiling so stacked effects never clip
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.7;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 15000; lp.Q.value = 0.5;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    const trim = c.createGain(); trim.gain.value = dbToGain(-2.3); // cancels the compressor's automatic make-up gain (unity below −4 dBFS)
    const clip = c.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = 'none';
    this.out.connect(hp); hp.connect(lp); lp.connect(lim); lim.connect(trim); trim.connect(clip); clip.connect(c.destination);
    const len = c.sampleRate * 0.6;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private ramp(p: AudioParam | undefined, v: number) { const c = this.ctx; if (!c || !p) return; p.cancelScheduledValues(c.currentTime); p.setTargetAtTime(v, c.currentTime, 0.015); }
  setVolume(v: number) { this.volume = v; this.ramp(this.master?.gain, v); }
  setMaster(v: number) { this.masterVolume = v; this.ramp(this.out?.gain, v); }
  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }

  private gainFor(x?: number, z?: number) {
    if (x === undefined || z === undefined) return 1;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    return Math.max(0.08, 1 / (1 + d * 0.18));
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const c = this.ctx; const out = this.dest; if (!c || !out) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
    this.endAt = Math.max(this.endAt, t + dur);
  }

  /** Filtered noise burst; 5 ms attack so even the sharpest hits don't click. */
  private noise(dur: number, vol: number, filterFreq: number, at = 0, type: BiquadFilterType = 'lowpass', q = 1) {
    const c = this.ctx; const out = this.dest; if (!c || !out || !this.noiseBuf) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq; f.Q.value = type === 'lowpass' || type === 'highpass' ? 0.7 : q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
    this.endAt = Math.max(this.endAt, t + dur);
  }

  /** Buzzy "voice": sawtooth through a band-pass (vowel-ish), optional vibrato rate (Hz). */
  private voice(freq: number, slideTo: number, dur: number, vol: number, formant: number, at = 0, startFormant?: number, vib = 0) {
    const c = this.ctx; const out = this.dest; if (!c || !out) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(startFormant ?? formant, t); f.frequency.linearRampToValueAtTime(formant, t + dur * 0.5);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(out);
    let lfo: OscillatorNode | null = null;
    if (vib > 0) { lfo = c.createOscillator(); lfo.frequency.value = vib; const lg = c.createGain(); lg.gain.value = freq * 0.04; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.02); }
    o.start(t); o.stop(t + dur + 0.02);
    this.endAt = Math.max(this.endAt, t + dur);
  }
  /** Filtered-noise sweep (whoosh): band-pass centre glides from f0 to f1. */
  private sweep(dur: number, vol: number, f0: number, f1: number, at = 0) {
    const c = this.ctx; const out = this.dest; if (!c || !out || !this.noiseBuf) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
    this.endAt = Math.max(this.endAt, t + dur);
  }

  private lastPlayed = new Map<string, number>();
  private voices = 0;
  /** End times (AudioContext seconds) of the voices still sounding, per effect name. */
  private live = new Map<string, number[]>();
  /** Minimum gap between two plays of the same effect (ms); loud one-shots get a longer gap. */
  private static GAP: Record<string, number> = { step: 120, knock: 120, cash: 70, impact: 150, crash: 250, karen: 600, ultimate: 800, error: 200, achievement: 400, levelup: 400,
    heave: 200, ooh: 900, ding: 300, trombone: 2500, siren: 1500, bassdrop: 800, stamp: 90, chime: 150, rise: 400, whoosh: 60, slap: 90 };

  /** `k` (0–1.4): strength of the juice layers (throw power, distance falloff for other players' actions). */
  play(name: string, x?: number, z?: number, k = 1) {
    const c = this.ctx; if (!c || !this.master) return;
    const now = performance.now();
    const gap = Audio.GAP[name] ?? 50;
    if (now - (this.lastPlayed.get(name) ?? -1e9) < gap) return; // same sound fired twice at once: play it once
    if (this.voices > 24 && name !== 'ultimate' && name !== 'achievement' && name !== 'bassdrop') return; // too busy: drop minor sounds
    // per-sound voice limit: rapid repeats don't stack into a wall of distortion; overlapping copies are ducked
    const live = (this.live.get(name) ?? []).filter(e => e > c.currentTime + 0.03);
    if (live.length >= (SOLO.has(name) ? 1 : MAX_VOICES)) { this.live.set(name, live); return; }
    this.lastPlayed.set(name, now);
    this.voices++; window.setTimeout(() => { this.voices--; }, 400);
    const inst = c.createGain(); inst.gain.value = dbToGain(TRIM[name] ?? 0) / (1 + 0.45 * live.length);
    inst.connect(this.master);
    this.dest = inst; this.endAt = c.currentTime;
    try { this.sfx(name, x, z, k); } finally { this.dest = null; }
    live.push(this.endAt); this.live.set(name, live);
    window.setTimeout(() => inst.disconnect(), (this.endAt - c.currentTime) * 1000 + 300);
  }

  private sfx(name: string, x: number | undefined, z: number | undefined, k: number) {
    const v = this.gainFor(x, z) * Math.max(0.15, Math.min(1, k));
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
      case 'unplug': this.tone(1400, 0.05, 'square', 0.1 * v); this.noise(0.08, 0.12 * v, 3200, 0.03, 'bandpass', 1.2); break; // spark crackle (band-passed: was a 4 kHz+ hiss)
      case 'levelup': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.11, i * 0.07)); break;
      case 'achievement': [784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.12, i * 0.1)); this.tone(1568, 0.7, 'triangle', 0.08, 0.32); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.12, i * 0.13)); break;
      case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.1, i * 0.16)); break;
      case 'cash': this.tone(1318, 0.12, 'square', 0.12 * v); this.tone(1760, 0.3, 'square', 0.1 * v, 0.08); this.noise(0.15, 0.08 * v, 5000, 0.05, 'bandpass', 1.5); break;
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
      // ---- 打擊感 layers (game.ts juice) ----
      case 'heave': // 「嘿咻」: two short voiced grunts (buzzy saw through a vowel-ish band) + a cloth rustle
        this.voice(190, 150, 0.09, 0.11 * v, 700, 0); this.voice(240, 170, 0.14, 0.12 * v, 1100, 0.11);
        this.noise(0.1, 0.06 * v, 2500, 0.02, 'bandpass'); break;
      case 'whoosh': { // pitch rises with throw strength
        const f = 500 + 900 * Math.max(0.3, Math.min(1.4, k));
        this.sweep(0.32, 0.22 * v * Math.min(1.2, k), f * 0.5, f * 1.6, 0); this.tone(f * 0.6, 0.22, 'sine', 0.05 * v, 0, f * 0.25); break;
      }
      case 'ding': this.tone(1568, 0.5, 'triangle', 0.1 * v); this.tone(2093, 0.6, 'sine', 0.06 * v, 0.02); break;
      case 'ooh': // crowd "ooh": a few detuned voices with a rising-then-falling vowel band
        for (const [f, d] of [[180, 0], [225, 0.02], [270, 0.04], [320, 0.03]] as const) this.voice(f, f * 1.12, 0.7, 0.035 * v, 500, d, f * 0.92);
        break;
      case 'stamp': this.tone(140, 0.14, 'sine', 0.22 * v, 0, 60); this.noise(0.08, 0.2 * v, 900); this.tone(900, 0.05, 'square', 0.04 * v, 0); break;
      case 'star': this.tone(1760, 0.12, 'triangle', 0.07 * v, 0, 2637); this.tone(2637, 0.18, 'sine', 0.05 * v, 0.06); break;
      case 'dust': this.noise(0.3, 0.14 * v, 500); break;
      case 'rise': this.sweep(0.55, 0.2 * v, 300, 3200, 0); this.tone(200, 0.5, 'sawtooth', 0.04 * v, 0, 800); break;
      case 'bassdrop':
        this.tone(160, 1.1, 'sine', 0.35, 0.05, 32); this.tone(80, 1.2, 'triangle', 0.2, 0.05, 30);
        this.sweep(0.25, 0.25, 6000, 300, 0); this.noise(0.6, 0.25, 220, 0.05); break;
      case 'slap': // cartoon 「啪」: sharp crack + quick pitch drop
        this.noise(0.05, 0.5 * v, 2800, 0, 'bandpass', 0.8); this.noise(0.12, 0.25 * v, 1400, 0.005, 'bandpass');
        this.tone(900, 0.07, 'square', 0.08 * v, 0, 180); this.tone(120, 0.12, 'sine', 0.18 * v, 0.01, 60); break;
      case 'siren': // comedic police sting: wee-woo ×2
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 880, 0.22, 'square', 0.05, 0.2 + i * 0.22, i % 2 ? 640 : 900);
        break;
      case 'chime': this.tone(1318, 0.35, 'sine', 0.08 * v); this.tone(1760, 0.45, 'sine', 0.06 * v, 0.07); this.tone(2637, 0.3, 'triangle', 0.025 * v, 0.14); break;
      case 'trombone': // sad "wah wah wah waaah"
        [[392, 0], [370, 0.3], [349, 0.6]].forEach(([f, at]) => this.voice(f / 2, f / 2 * 0.98, 0.28, 0.06, 900, at));
        this.voice(165, 150, 0.8, 0.07, 800, 0.9, undefined, 5.5); break;
    }
  }

  // ---------------- procedural background music ----------------
  private musicGain: GainNode | null = null;
  private musicTimer = 0;
  private musicMood = -1;
  private nextBeat = 0;
  private beat = 0;
  musicVolume = 0.5;
  setMusicVolume(v: number) { this.musicVolume = v; this.ramp(this.musicGain?.gain, v * MUSIC_LEVEL); if (this.storeAmb) this.ramp(this.storeAmb.gain.gain, v * AMB_LEVEL * dbToGain(this.storeAmb.lvl)); }

  /** mood: 0 co-op, 1–6 chapters, 7 endless, 8 main menu. Different tempo, key and chord loop per mood. */
  startMusic(mood: number) {
    const c = this.ctx; if (!c || !this.master) return;
    if (this.musicMood === mood && this.musicTimer) return;
    this.stopMusic();
    this.musicMood = mood;
    this.musicGain = c.createGain(); this.musicGain.gain.value = this.musicVolume * MUSIC_LEVEL; this.musicGain.connect(this.out ?? this.master);
    this.nextBeat = c.currentTime + 0.1; this.beat = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 90);
  }
  stopMusic() {
    clearInterval(this.musicTimer); this.musicTimer = 0; this.musicMood = -1;
    if (this.musicGain) { const g = this.musicGain; try { g.gain.cancelScheduledValues(this.ctx!.currentTime); g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.12); } catch { /* ignore */ } setTimeout(() => g.disconnect(), 900); }
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
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.musicGain!); o.start(t); o.stop(t + 0.2);
  }
  private hat(t: number, vol: number, freq = 7000) {
    const c = this.ctx!; if (!this.noiseBuf) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.musicGain!); s.start(t); s.stop(t + 0.06);
  }

  // ---------------- per-store ambience (procedural, very quiet) ----------------
  private storeAmb: { timer: number; nodes: AudioScheduledSourceNode[]; gain: GainNode; lvl: number } | null = null;
  /** Background sounds for each kind of store: a steady bed plus occasional little events. */
  startStoreAmbience(mapId: string) {
    this.stopStoreAmbience();
    const c = this.ctx; if (!c || !this.master || !this.noiseBuf) return;
    const p = STORE_AMBIENCE[mapId] ?? STORE_AMBIENCE.convenience;
    const lvl = p.lvl ?? 0;
    const gain = c.createGain(); // fade in over ~0.5 s (no click when the bed starts)
    gain.gain.setValueAtTime(0.0001, c.currentTime); gain.gain.setTargetAtTime(AMB_LEVEL * this.musicVolume * dbToGain(lvl), c.currentTime, 0.15);
    // keep the bed out of the sub-bass (speaker rumble) and the fizz range
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5500;
    gain.connect(hp); hp.connect(lp); lp.connect(this.out ?? this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    if (p.bed) { // looping filtered noise (fridge hum, fryer sizzle, crowd murmur…)
      const s = c.createBufferSource(); s.buffer = this.bedNoise(); s.loop = true;
      const f = c.createBiquadFilter(); f.type = p.bed.type; f.frequency.value = p.bed.freq; f.Q.value = p.bed.q ?? 0.7;
      const g = c.createGain(); g.gain.value = p.bed.vol;
      s.connect(f); f.connect(g); g.connect(gain); s.start(); nodes.push(s);
    }
    if (p.hum) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = p.hum; const g = c.createGain(); g.gain.value = 0.012; o.connect(g); g.connect(gain); o.start(); nodes.push(o); }
    const tick = () => {
      if (!this.storeAmb) return;
      for (const e of p.events) if (Math.random() < 1 / e.every) STORE_EVENTS[e.kind]?.(this, gain);
    };
    this.storeAmb = { timer: window.setInterval(tick, 1000), nodes, gain, lvl };
  }
  stopStoreAmbience() {
    const a = this.storeAmb; if (!a) return;
    clearInterval(a.timer); this.storeAmb = null;
    try { a.gain.gain.cancelScheduledValues(this.ctx!.currentTime); a.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.1); } catch { /* ignore */ }
    setTimeout(() => { for (const n of a.nodes) { try { n.stop(); } catch { /* ignore */ } } a.gain.disconnect(); }, 600);
  }
  private bedBuf: AudioBuffer | null = null;
  /** 3.7 s of noise for looping beds: the 0.6 s SFX buffer repeats audibly when looped. */
  private bedNoise() {
    const c = this.ctx!;
    if (!this.bedBuf) { const n = Math.round(c.sampleRate * 3.7); this.bedBuf = c.createBuffer(1, n, c.sampleRate); const d = this.bedBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    return this.bedBuf;
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
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  }

  /** Entrance sting for a karen: every kind gets its own little 3-note motif (stable per kind). */
  karenSting(kind: string) {
    const c = this.ctx; if (!c || !this.master) return;
    const inst = c.createGain(); inst.gain.value = dbToGain(TRIM.karen); inst.connect(this.master);
    this.dest = inst;
    let h = 2166136261; for (const ch of kind) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    h >>>= 0;
    const scale = [0, 3, 5, 6, 7, 10, 12];
    const base = 330 + (h % 5) * 40, type: OscillatorType = (['square', 'sawtooth', 'triangle'] as const)[(h >>> 3) % 3];
    for (let i = 0; i < 3; i++) {
      const semi = scale[(h >>> (5 + i * 3)) % scale.length] - (i === 2 ? 12 : 0);
      this.tone(base * Math.pow(2, semi / 12), 0.13, type, 0.07, 0.5 + i * 0.14); // after the generic alarm
    }
    this.dest = null;
    window.setTimeout(() => inst.disconnect(), 1300);
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
/** Music and ambience bus levels (× the 音樂 slider). */
const MUSIC_LEVEL = 2.2, AMB_LEVEL = 2.7;
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
/** `lvl`: per-store level trim in dB so every store's ambience sits at about the same loudness. */
interface StoreAmb { lvl?: number; bed?: { type: BiquadFilterType; freq: number; vol: number; q?: number }; hum?: number; events: { kind: AmbEvent; every: number }[] }
const FRIDGE = { type: 'lowpass' as BiquadFilterType, freq: 180, vol: 0.05 };
const MURMUR = { type: 'bandpass' as BiquadFilterType, freq: 520, vol: 0.035, q: 0.6 };
const SIZZLE = { type: 'bandpass' as BiquadFilterType, freq: 3000, vol: 0.02, q: 0.7 }; // was a 3.5 kHz high-pass: constant harsh hiss
const STORE_AMBIENCE: Record<string, StoreAmb> = {
  convenience: { lvl: -3, bed: FRIDGE, hum: 60, events: [{ kind: 'chime', every: 25 }] },
  breakfast: { lvl: -4, bed: SIZZLE, events: [{ kind: 'sizzle', every: 6 }, { kind: 'chime', every: 30 }] },
  boba: { bed: MURMUR, events: [{ kind: 'clink', every: 5 }] },
  clothing: { bed: MURMUR, events: [{ kind: 'chime', every: 30 }] },
  chicken: { lvl: -4, bed: SIZZLE, events: [{ kind: 'sizzle', every: 4 }] },
  drugstore: { bed: MURMUR, events: [{ kind: 'beep', every: 12 }, { kind: 'chime', every: 30 }] },
  bookstore: { lvl: 6, bed: { type: 'lowpass', freq: 120, vol: 0.02 }, events: [{ kind: 'page', every: 6 }] },
  bakery: { lvl: 5, bed: { type: 'lowpass', freq: 220, vol: 0.03 }, events: [{ kind: 'oven', every: 18 }, { kind: 'chime', every: 30 }] },
  supermarket: { lvl: -5, bed: MURMUR, hum: 60, events: [{ kind: 'beep', every: 4 }, { kind: 'pa', every: 45 }] },
  petshop: { bed: MURMUR, events: [{ kind: 'bark', every: 9 }] },
  cafe: { bed: MURMUR, events: [{ kind: 'clink', every: 6 }, { kind: 'dryer', every: 25 }] },
  cinema: { lvl: 6, bed: { type: 'lowpass', freq: 90, vol: 0.06 }, events: [{ kind: 'thump', every: 10 }] },
  hotpot: { bed: { type: 'bandpass', freq: 900, vol: 0.03, q: 0.8 }, events: [{ kind: 'clink', every: 5 }] },
  gas: { lvl: 6, bed: { type: 'lowpass', freq: 140, vol: 0.05 }, events: [{ kind: 'engine', every: 12 }, { kind: 'bell', every: 20 }] },
  gym: { lvl: -3, bed: MURMUR, events: [{ kind: 'thump', every: 3 }] },
  steak: { lvl: -4, bed: SIZZLE, events: [{ kind: 'sizzle', every: 4 }, { kind: 'clink', every: 9 }] },
  electronics: { lvl: 6, bed: { type: 'lowpass', freq: 200, vol: 0.03 }, events: [{ kind: 'beep', every: 5 }] },
  salon: { bed: MURMUR, events: [{ kind: 'dryer', every: 10 }] },
  post: { bed: MURMUR, events: [{ kind: 'ding', every: 12 }] },
  pharmacy: { bed: MURMUR, events: [{ kind: 'ding', every: 15 }] },
  hotel: { lvl: 6, bed: { type: 'lowpass', freq: 160, vol: 0.025 }, events: [{ kind: 'bell', every: 18 }] },
};
const STORE_EVENTS: Record<AmbEvent, (a: Audio, out: AudioNode) => void> = {
  chime: (a, o) => { a.blip(o, 1318, 0.5, 'sine', 0.05); a.blip(o, 1046, 0.6, 'sine', 0.05, 0.25); },
  sizzle: (a, o) => a.hiss(o, 1.2, 0.05, 4000, 'bandpass'),
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

/** Identity up to −3 dBFS, then a tanh knee up to a −1 dBFS ceiling (inputs beyond +/-1 clamp to the ceiling). */
function softClipCurve() {
  const n = 4097, a = 0.7, ceil = 0.891, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, m = Math.abs(x);
    curve[i] = Math.sign(x) * (m <= a ? m : a + (ceil - a) * Math.tanh((m - a) / (ceil - a)));
  }
  return curve;
}
