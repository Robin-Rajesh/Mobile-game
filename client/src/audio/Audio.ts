/**
 * Fully synthesised audio — zero asset downloads, instant start on mobile.
 * Every sound is a tiny WebAudio graph built on demand.
 */

type Wave = OscillatorType;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private surgeNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private lastPickup = 0;
  private pickupCombo = 0;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicIntensity = 0;
  private horror = 0;
  sfxOn = true;
  musicOn = true;

  /** Must be called from a user gesture (iOS requirement). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
    this.musicBus.connect(this.master);

    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    this.startMusic();
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.3);
  }

  /** 0 = menu (sparse), 1 = in-game, 2 = high tension */
  setIntensity(level: number): void {
    this.musicIntensity = level;
  }

  /** 0 = normal soundtrack, 1 = Blood Moon horror score */
  setHorror(v: number): void {
    this.horror = v;
  }

  // ───────────────────────────── primitives

  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; slideTo?: number; attack?: number; delay?: number; bus?: GainNode; detune?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || (!this.sfxOn && !opts.bus)) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.detune) o.detune.value = opts.detune;
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + dur);
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, opts: { gain?: number; freq?: number; q?: number; type?: BiquadFilterType; sweepTo?: number; delay?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.sfxOn) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ───────────────────────────── game sounds

  /** Rising pentatonic blips while you keep eating — the core "one more" loop. */
  pickup(value: number): void {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastPickup < 45) return;
    this.pickupCombo = now - this.lastPickup < 600 ? Math.min(this.pickupCombo + 1, 14) : 0;
    this.lastPickup = now;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33];
    const f = 520 * 2 ** (scale[this.pickupCombo] / 12) * (value >= 6 ? 0.75 : 1);
    this.tone(f, 0.09, { type: 'triangle', gain: 0.05 + Math.min(0.05, value * 0.008) });
    if (value >= 6) this.tone(f * 1.5, 0.12, { type: 'sine', gain: 0.05, delay: 0.03 });
  }

  moonGained(): void {
    this.tone(880, 0.12, { type: 'triangle', gain: 0.09 });
    this.tone(1320, 0.18, { type: 'sine', gain: 0.07, delay: 0.06 });
  }

  capture(): void {
    this.tone(660, 0.1, { type: 'square', gain: 0.04 });
    this.tone(990, 0.1, { type: 'square', gain: 0.04, delay: 0.05 });
    this.tone(1320, 0.2, { type: 'triangle', gain: 0.08, delay: 0.1 });
  }

  clash(near: number): void {
    const g = 0.04 + near * 0.16;
    this.noise(0.12, { gain: g, freq: 3200, q: 3 });
    this.tone(1800 + Math.random() * 600, 0.15, { type: 'square', gain: g * 0.35, slideTo: 900 });
    this.tone(140, 0.12, { type: 'sine', gain: g * 0.8, slideTo: 60 });
  }

  bite(streak: number): void {
    // punchy thump + bright chord that climbs with the streak
    this.tone(160, 0.25, { type: 'sine', gain: 0.4, slideTo: 40 });
    this.noise(0.18, { gain: 0.25, freq: 900, sweepTo: 200, type: 'lowpass' });
    const root = 523.25 * 2 ** (Math.min(streak - 1, 6) / 12);
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone(root * m, 0.35, { type: 'triangle', gain: 0.08, delay: 0.05 + i * 0.045 }));
  }

  remoteKill(near: number): void {
    if (near < 0.05) return;
    this.tone(120, 0.2, { type: 'sine', gain: 0.25 * near, slideTo: 40 });
    this.noise(0.2, { gain: 0.15 * near, freq: 600, type: 'lowpass' });
  }

  death(): void {
    this.tone(440, 0.9, { type: 'sawtooth', gain: 0.12, slideTo: 55 });
    this.tone(220, 1.1, { type: 'square', gain: 0.06, slideTo: 30, delay: 0.05 });
    this.noise(0.8, { gain: 0.3, freq: 2000, sweepTo: 100, type: 'lowpass' });
  }

  starfallWarn(): void {
    for (let i = 0; i < 3; i++) {
      this.tone(784, 0.12, { type: 'triangle', gain: 0.08, delay: i * 0.22 });
      this.tone(1046, 0.12, { type: 'triangle', gain: 0.06, delay: i * 0.22 + 0.1 });
    }
  }

  starfallImpact(near: number): void {
    this.noise(1.2, { gain: 0.1 + near * 0.3, freq: 400, sweepTo: 60, type: 'lowpass' });
    this.tone(90, 0.8, { type: 'sine', gain: 0.1 + near * 0.3, slideTo: 30 });
  }

  click(): void {
    this.tone(1200, 0.04, { type: 'square', gain: 0.03 });
  }

  pop(): void {
    this.tone(500, 0.08, { type: 'sine', gain: 0.12, slideTo: 1100 });
  }

  coin(i: number): void {
    this.tone(1318 + i * 40, 0.08, { type: 'square', gain: 0.025 });
    this.tone(1975 + i * 60, 0.12, { type: 'triangle', gain: 0.04, delay: 0.04 });
  }

  levelUp(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.09, delay: i * 0.07 }));
  }

  surge(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    if (on && !this.surgeNode && this.sfxOn) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 500;
      filter.Q.value = 2;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.12);
      filter.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.4);
      src.connect(filter).connect(gain).connect(this.sfxBus);
      src.start();
      this.surgeNode = { src, gain, filter };
      this.tone(220, 0.25, { type: 'sawtooth', gain: 0.05, slideTo: 440 });
    } else if (!on && this.surgeNode) {
      const n = this.surgeNode;
      this.surgeNode = null;
      n.gain.gain.cancelScheduledValues(ctx.currentTime);
      n.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
      n.src.stop(ctx.currentTime + 0.3);
    }
  }

  // ───────────────────────────── powers

  power(kind: string): void {
    switch (kind) {
      case 'blink':
        this.tone(300, 0.35, { type: 'sine', gain: 0.12, slideTo: 1200 });
        this.tone(450, 0.35, { type: 'triangle', gain: 0.06, slideTo: 1800, delay: 0.03 });
        break;
      case 'bubble':
        this.tone(600, 0.25, { type: 'sine', gain: 0.12, slideTo: 1400 });
        this.tone(1400, 0.4, { type: 'sine', gain: 0.05, delay: 0.1 });
        break;
      case 'decoy':
        this.noise(0.3, { gain: 0.12, freq: 1200, sweepTo: 400, q: 2 });
        this.tone(520, 0.3, { type: 'triangle', gain: 0.08, slideTo: 260 });
        break;
      case 'snare':
        this.tone(180, 0.15, { type: 'square', gain: 0.06 });
        this.tone(140, 0.2, { type: 'square', gain: 0.05, delay: 0.06 });
        break;
      case 'mimic':
        for (let i = 0; i < 5; i++) this.tone(400 + i * 140, 0.12, { type: 'triangle', gain: 0.05, delay: i * 0.04 });
        break;
      case 'blackout':
        this.tone(220, 0.8, { type: 'sawtooth', gain: 0.08, slideTo: 40 });
        this.noise(0.6, { gain: 0.15, freq: 3000, sweepTo: 100, type: 'lowpass' });
        break;
    }
  }

  warp(near: number): void {
    if (near < 0.05) return;
    this.tone(1600, 0.3, { type: 'sine', gain: 0.1 * near, slideTo: 200 });
    this.noise(0.25, { gain: 0.12 * near, freq: 5000, sweepTo: 500, q: 1 });
  }

  denied(): void {
    this.tone(160, 0.12, { type: 'square', gain: 0.05 });
  }

  fooled(): void {
    [659, 523, 784, 1046].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.08, delay: i * 0.07 }));
  }

  snareHit(mine: boolean): void {
    this.tone(mine ? 90 : 300, 0.4, { type: 'sawtooth', gain: 0.1, slideTo: mine ? 50 : 150 });
    this.noise(0.2, { gain: 0.15, freq: 900, q: 3 });
  }

  // ───────────────────────────── Blood Moon

  /** Three slow church-bell tolls. */
  bloodToll(): void {
    for (let i = 0; i < 3; i++) {
      const d = i * 1.1;
      this.tone(98, 2.4, { type: 'sine', gain: 0.22, delay: d });
      this.tone(98 * 2.76, 1.6, { type: 'sine', gain: 0.07, delay: d });
      this.tone(98 * 5.4, 0.9, { type: 'sine', gain: 0.03, delay: d });
    }
  }

  bloodStart(): void {
    this.tone(55, 2.5, { type: 'sawtooth', gain: 0.12, slideTo: 30 });
    this.tone(41, 3, { type: 'sine', gain: 0.4, slideTo: 25 });
    this.noise(2.2, { gain: 0.3, freq: 200, sweepTo: 3000, type: 'bandpass', q: 0.7 });
    this.tone(1661, 1.4, { type: 'sine', gain: 0.03, delay: 0.4, slideTo: 1500 });
  }

  /** A wraith noticed you. */
  screech(near: number): void {
    const g = 0.03 + near * 0.12;
    this.noise(0.5, { gain: g, freq: 2400, sweepTo: 700, q: 6 });
    this.tone(900, 0.45, { type: 'sawtooth', gain: g * 0.4, slideTo: 260, detune: 30 });
    this.tone(940, 0.45, { type: 'sawtooth', gain: g * 0.4, slideTo: 250, detune: -30 });
  }

  ward(): void {
    this.tone(200, 0.2, { type: 'square', gain: 0.06, slideTo: 90 });
    this.noise(0.15, { gain: 0.12, freq: 1500, q: 2 });
  }

  banish(mine: boolean): void {
    const g = mine ? 0.1 : 0.03;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.6, { type: 'triangle', gain: g, delay: i * 0.05 }));
    this.noise(0.6, { gain: g * 1.5, freq: 6000, sweepTo: 2000, type: 'highpass' });
  }

  sunstone(): void {
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', gain: 0.07, delay: i * 0.05 }));
    for (const f of [261, 329, 392]) this.tone(f, 1.6, { type: 'sawtooth', gain: 0.025, attack: 0.3 });
  }

  dawn(): void {
    for (const [f, d] of [[392, 0], [494, 0.08], [587, 0.16], [784, 0.24]] as const) this.tone(f, 2, { type: 'triangle', gain: 0.07, delay: d, attack: 0.2 });
  }

  /** Kill-cam sting: every variant has its own sound. */
  cine(variant: string, phase: 'start' | 'impact'): void {
    if (phase === 'start') {
      this.noise(0.6, { gain: 0.18, freq: 300, sweepTo: 4000, q: 1.2 });
      this.tone(110, 0.7, { type: 'sawtooth', gain: 0.08, slideTo: 220 });
      return;
    }
    switch (variant) {
      case 'maw':
        this.noise(0.25, { gain: 0.5, freq: 900, sweepTo: 150, type: 'lowpass' });
        this.tone(90, 0.4, { type: 'square', gain: 0.25, slideTo: 40 });
        break;
      case 'tendrils':
        this.noise(0.5, { gain: 0.35, freq: 400, sweepTo: 1200, q: 4 });
        this.tone(60, 0.5, { type: 'sine', gain: 0.4, slideTo: 30 });
        break;
      case 'eye':
        this.tone(1244, 0.9, { type: 'sine', gain: 0.1 });
        this.tone(1318, 0.9, { type: 'sine', gain: 0.1 });
        this.noise(0.8, { gain: 0.25, freq: 2000, sweepTo: 80, type: 'lowpass' });
        break;
      case 'impale':
        this.tone(3000, 0.15, { type: 'square', gain: 0.08, slideTo: 600 });
        this.tone(70, 0.6, { type: 'sine', gain: 0.45, slideTo: 30 });
        break;
      case 'drag':
        this.tone(80, 1.2, { type: 'sawtooth', gain: 0.12, slideTo: 30 });
        this.noise(1, { gain: 0.2, freq: 250, type: 'lowpass' });
        break;
      default:
        for (let i = 0; i < 6; i++) this.tone(200 + Math.random() * 2000, 0.05, { type: 'square', gain: 0.07, delay: i * 0.04 });
        this.noise(0.4, { gain: 0.3, freq: 5000, type: 'highpass' });
    }
    this.tone(45, 0.9, { type: 'sine', gain: 0.5, slideTo: 25 });
  }

  // ───────────────────────────── generative music

  /**
   * A small 16-step sequencer: soft pad chords + a plucky arpeggio, Lydian-ish so it
   * feels "space-y" without being moody. Intensity adds a kick and hats.
   */
  private startMusic(): void {
    if (this.musicTimer !== null || !this.ctx) return;
    const bpm = 104;
    const stepDur = 60 / bpm / 4;
    const chords = [
      [261.63, 329.63, 392.0, 493.88], // Cmaj7
      [293.66, 369.99, 440.0, 523.25], // D (lydian II)
      [220.0, 261.63, 329.63, 392.0], // Am7
      [196.0, 246.94, 293.66, 369.99], // G with #4
    ];
    let next = this.ctx.currentTime + 0.1;
    const tick = () => {
      const ctx = this.ctx;
      if (!ctx) return;
      while (next < ctx.currentTime + 0.25) {
        this.scheduleStep(this.musicStep, next, chords, stepDur);
        this.musicStep = (this.musicStep + 1) % 64;
        next += stepDur;
      }
    };
    this.musicTimer = window.setInterval(tick, 60);
  }

  /** Horror score: detuned drone, heartbeat, tritone bells, a whistle that bends. */
  private scheduleHorror(step: number, t: number, stepDur: number): void {
    const ctx = this.ctx!;
    const bus = this.musicBus;
    const osc = (type: OscillatorType, f: number, dur: number, gain: number, attack: number, slide?: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 500;
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(filt).connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    };
    if (step % 16 === 0) {
      osc('sawtooth', 55, stepDur * 17, 0.09, 1.2);
      osc('sawtooth', 58.27, stepDur * 17, 0.07, 1.2);
    }
    // lub-dub
    if (step % 8 === 0) osc('sine', 75, 0.22, 0.6, 0.005, 35);
    if (step % 8 === 2) osc('sine', 65, 0.2, 0.4, 0.005, 32);
    if (step % 32 === 8) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      o.frequency.setValueAtTime(1244, t);
      o.frequency.linearRampToValueAtTime(1175, t + 3);
      lfo.frequency.value = 5.5;
      lg.gain.value = 14;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g).connect(bus);
      o.start(t);
      lfo.start(t);
      o.stop(t + 3.3);
      lfo.stop(t + 3.3);
    }
    if (step % 16 === 12 && Math.random() < 0.6) {
      for (const f of [311.13, 440]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = f * (Math.random() < 0.5 ? 1 : 2);
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + 1.9);
      }
    }
    if (step % 32 === 20 && this.noiseBuf) {
      // whispers
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 8;
      f.frequency.setValueAtTime(700 + Math.random() * 900, t);
      f.frequency.linearRampToValueAtTime(400 + Math.random() * 1400, t + 1.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      src.connect(f).connect(g).connect(bus);
      src.start(t, Math.random() * 0.4);
      src.stop(t + 1.7);
    }
  }

  private scheduleStep(step: number, t: number, chords: number[][], stepDur: number): void {
    const ctx = this.ctx!;
    if (this.horror > 0.5) {
      this.scheduleHorror(step, t, stepDur);
      return;
    }
    const chord = chords[Math.floor(step / 16) % chords.length];
    const bus = this.musicBus;
    const voice = (f: number, dur: number, type: Wave, gain: number, attack: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = type === 'sawtooth' ? 900 : 3000;
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(filt).connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (step % 16 === 0) for (const f of chord) voice(f / 2, stepDur * 16, 'sawtooth', 0.035, 0.6);
    const arp = [0, 2, 1, 3, 2, 0, 3, 1];
    if (step % 2 === 0 && (this.musicIntensity > 0 || step % 4 === 0)) {
      const f = chord[arp[(step / 2) % arp.length]] * (step % 32 < 16 ? 2 : 4);
      voice(f, stepDur * 1.6, 'triangle', 0.05, 0.005);
    }
    if (this.musicIntensity >= 1 && this.noiseBuf) {
      if (step % 4 === 0) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(this.musicIntensity >= 2 ? 0.35 : 0.22, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + 0.25);
      }
      if (step % 4 === 2 || (this.musicIntensity >= 2 && step % 2 === 1)) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(f).connect(g).connect(bus);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.06);
      }
    }
  }
}

export const audio = new AudioEngine();
