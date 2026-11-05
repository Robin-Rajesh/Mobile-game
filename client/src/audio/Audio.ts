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

  private scheduleStep(step: number, t: number, chords: number[][], stepDur: number): void {
    const ctx = this.ctx!;
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
