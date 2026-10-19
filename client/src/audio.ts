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
    this.master.connect(this.ctx.destination);
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

  play(name: string, x?: number, z?: number) {
    if (!this.ctx) return;
    const v = this.gainFor(x, z);
    switch (name) {
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
export const audio = new Audio();
