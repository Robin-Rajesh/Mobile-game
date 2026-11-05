import { TAU, clamp } from '../../../shared/math';
import { skinById } from '../../../shared/skins';
import { INK, drawCoreBody, drawWraith, moonSprite, MOON_SPRITE_SCALE } from './art';
import type { Mood } from './art';

export type CineVariant = 'maw' | 'tendrils' | 'eye' | 'impale' | 'drag' | 'glitch';
const VARIANTS: CineVariant[] = ['maw', 'tendrils', 'eye', 'impale', 'drag', 'glitch'];

export type CineActor = { kind: 'wraith' } | { kind: 'core'; skin: number; spooky?: boolean };

export interface CineSpec {
  /** full-screen (your death) or letterboxed (your kill) */
  full: boolean;
  attacker: CineActor;
  victim: CineActor;
  title: string;
  sub: string;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vr: number;
  color: string;
  life: number;
}

const ease = (x: number) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const easeIn = (x: number) => clamp(x, 0, 1) ** 2;

/**
 * Freaky kill-cam. A short framed scene of the attacker getting the victim, randomised
 * every time (variant, side, tilt, colour accents, timing). Drawn in screen space.
 */
export class Cinematic {
  active = false;
  variant: CineVariant = 'maw';
  private spec!: CineSpec;
  private t = 0;
  private dur = 1;
  private last: CineVariant | null = null;
  private side = 1;
  private tilt = 0;
  private seed = 0;
  private count = 5;
  private accent = '#FF2B4A';
  private bits: Bit[] = [];
  private burst = false;
  onImpact: ((v: CineVariant) => void) | null = null;

  play(spec: CineSpec): CineVariant {
    let v: CineVariant;
    do v = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
    while (v === this.last);
    this.last = v;
    this.variant = v;
    this.spec = spec;
    this.t = 0;
    this.dur = (spec.full ? 2.2 : 1.45) * (0.9 + Math.random() * 0.2);
    this.side = Math.random() < 0.5 ? 1 : -1;
    this.tilt = (Math.random() - 0.5) * 0.14;
    this.seed = Math.random() * 1000;
    this.count = 4 + Math.floor(Math.random() * 4);
    this.accent = ['#FF2B4A', '#C21E56', '#FF5A1F', '#B026FF'][Math.floor(Math.random() * 4)];
    this.bits = [];
    this.burst = false;
    this.active = true;
    return v;
  }

  /** 0..1 progress */
  get progress(): number {
    return this.t / this.dur;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    for (const b of this.bits) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 900 * dt;
      b.rot += b.vr * dt;
      b.life -= dt;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    if (this.t >= this.dur) this.active = false;
  }

  private explode(x: number, y: number, S: number, colors: string[], n = 28): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = S * (3 + Math.random() * 7);
      this.bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - S * 3, r: S * (0.06 + Math.random() * 0.14), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 20, color: colors[i % colors.length], life: 0.6 + Math.random() * 0.6 });
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.active) return;
    const p = this.progress;
    const spec = this.spec;
    const fadeIn = ease(p / 0.08);
    const fadeOut = 1 - easeIn((p - 0.86) / 0.14);
    const alpha = Math.min(fadeIn, fadeOut);
    const impactAt = 0.52;
    const hit = p >= impactAt;
    if (hit && !this.burst) {
      this.burst = true;
      this.onImpact?.(this.variant);
    }

    // ── frame
    const bandH = spec.full ? h : Math.min(h * 0.46, w * 0.62);
    const by = (h - bandH) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (!spec.full) {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.beginPath();
    ctx.rect(0, by, w, bandH);
    ctx.clip();
    const cx = w / 2;
    const cy = by + bandH / 2;
    // shake on impact
    const shake = hit ? Math.max(0, 1 - (p - impactAt) / 0.15) * 14 : 0;
    ctx.translate(cx + (Math.random() - 0.5) * shake, cy + (Math.random() - 0.5) * shake);
    ctx.rotate(this.tilt);
    const W = w * 1.3;
    const H = bandH * 1.3;

    // backdrop: deep red radial + speed lines
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * 0.6);
    g.addColorStop(0, '#3A0711');
    g.addColorStop(1, '#070004');
    ctx.fillStyle = g;
    ctx.fillRect(-W / 2, -H / 2, W, H);
    ctx.strokeStyle = 'rgba(255,43,74,0.12)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + this.seed;
      const r0 = Math.min(W, H) * (0.25 + ((i * 37) % 10) / 40);
      const drift = (p * 400) % 200;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r0 + drift), Math.sin(a) * (r0 + drift));
      ctx.lineTo(Math.cos(a) * (r0 + drift + 120), Math.sin(a) * (r0 + drift + 120));
      ctx.stroke();
    }

    const S = Math.min(bandH * 0.2, w * 0.14);
    const vx = S * 1.15 * this.side;
    const ax = -S * 1.6 * this.side;
    const action = clamp((p - 0.12) / (impactAt - 0.12), 0, 1);
    const after = clamp((p - impactAt) / (1 - impactAt), 0, 1);
    const t = this.t;

    switch (this.variant) {
      case 'maw':
        this.drawMaw(ctx, S, vx, action, after, hit, t, W, H);
        break;
      case 'tendrils':
        this.drawTendrils(ctx, S, vx, ax, action, after, hit, t);
        break;
      case 'eye':
        this.drawEye(ctx, S, vx, action, after, hit, t);
        break;
      case 'impale':
        this.drawImpale(ctx, S, vx, ax, action, after, hit, t);
        break;
      case 'drag':
        this.drawDrag(ctx, S, vx, action, after, hit, t);
        break;
      case 'glitch':
        this.drawGlitch(ctx, S, vx, ax, action, after, hit, t, W, H);
        break;
    }

    // debris
    for (const b of this.bits) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.globalAlpha = alpha * clamp(b.life * 2, 0, 1);
      ctx.fillStyle = b.color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.r, 0);
      ctx.lineTo(-b.r * 0.6, b.r * 0.7);
      ctx.lineTo(-b.r * 0.5, -b.r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = alpha;

    // impact flash
    if (hit) {
      const f = Math.max(0, 1 - (p - impactAt) / 0.1);
      if (f > 0) {
        ctx.fillStyle = `rgba(255,255,255,${f * 0.8})`;
        ctx.fillRect(-W / 2, -H / 2, W, H);
      }
    }

    // film grain + scanlines sell the "found footage" dread
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 40; i++) ctx.fillRect((Math.random() - 0.5) * W, (Math.random() - 0.5) * H, 2 + Math.random() * 3, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = -H / 2; y < H / 2; y += 4) ctx.fillRect(-W / 2, y, W, 1.5);

    ctx.restore();

    // ── title (unrotated, after impact)
    if (hit) {
      ctx.save();
      ctx.globalAlpha = alpha;
      const s = clamp((p - impactAt) / 0.08, 0, 1);
      const size = Math.min(w * 0.15, (spec.full ? 96 : 64)) * (1.6 - 0.6 * ease(s));
      const ty = spec.full ? h * 0.24 : by + bandH * 0.18;
      ctx.translate(w / 2 + (Math.random() - 0.5) * 3, ty);
      ctx.rotate(-0.05);
      ctx.font = `${size}px "Lilita One", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(spec.title, 0, 0);
      ctx.fillStyle = this.accent;
      ctx.fillText(spec.title, 0, 0);
      if (spec.sub) {
        const s2 = size * 0.32;
        ctx.font = `${s2}px "Lilita One", system-ui, sans-serif`;
        ctx.lineWidth = s2 * 0.22;
        ctx.strokeText(spec.sub, 0, size * 0.72);
        ctx.fillStyle = '#FFF4E0';
        ctx.fillText(spec.sub, 0, size * 0.72);
      }
      ctx.restore();
    }
  }

  // ───────────────────────────────────── actors

  private actor(ctx: CanvasRenderingContext2D, a: CineActor, x: number, y: number, S: number, mood: Mood, t: number, look: number, maw = 0): void {
    ctx.save();
    ctx.translate(x, y);
    if (a.kind === 'wraith') {
      drawWraith(ctx, S * 1.15, { dir: look, scared: mood === 'scared' || mood === 'dead', maw, rise: 1, t, eyes: true }, 1);
    } else {
      const skin = skinById(a.skin);
      drawCoreBody(ctx, S, skin, { look, blink: 0, mood, chomp: maw, spooky: a.spooky ? 1 : 0 }, t, 1);
    }
    ctx.restore();
  }

  private victimColors(): string[] {
    const v = this.spec.victim;
    if (v.kind === 'wraith') return ['#0B0410', '#A8D8FF', '#FFFFFF'];
    const s = skinById(v.skin);
    return [s.body, s.dark, s.light, '#8E0F24'];
  }

  private attackerTone(): string {
    const a = this.spec.attacker;
    return a.kind === 'wraith' ? '#0B0410' : skinById(a.skin).dark;
  }

  // ───────────────────────────────────── variants

  /** Giant jaws slam shut on the victim. */
  private drawMaw(ctx: CanvasRenderingContext2D, S: number, vx: number, action: number, after: number, hit: boolean, t: number, W: number, H: number): void {
    const victimLook = -Math.PI / 2;
    if (!hit) this.actor(ctx, this.spec.victim, vx * 0.2, 0, S, 'scared', t, victimLook);
    else if (!this.bits.length && after < 0.02) this.explode(vx * 0.2, 0, S, this.victimColors(), 34);
    const close = hit ? 1 - after * 0.25 : easeIn(action);
    const gap = H * 0.5 * (1 - close) + S * 0.1;
    const toothW = W / (this.count + 6);
    const jaw = (dir: 1 | -1) => {
      const base = dir * (gap + S * 2.2);
      ctx.fillStyle = '#1A0207';
      ctx.fillRect(-W / 2, base, W, dir * H);
      ctx.fillStyle = '#F4EDE1';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      for (let x = -W / 2; x < W / 2; x += toothW) {
        const len = S * (1.6 + 0.8 * Math.sin(x * 0.05 + this.seed));
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + toothW, base);
        ctx.lineTo(x + toothW / 2, base - dir * len);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };
    jaw(-1);
    jaw(1);
    if (hit) {
      // eyes above the closed maw
      for (const s of [-1, 1]) {
        ctx.fillStyle = this.accent;
        ctx.beginPath();
        ctx.ellipse(s * S * 1.4, -gap - S * 4.4, S * 0.45, S * 0.14 * (0.4 + after), s * 0.3, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** Inky tendrils lash out, coil, squeeze, pop. */
  private drawTendrils(ctx: CanvasRenderingContext2D, S: number, vx: number, ax: number, action: number, after: number, hit: boolean, t: number): void {
    const reach = ease(action);
    this.actor(ctx, this.spec.attacker, ax, S * 0.2, S * 0.95, 'surge', t, this.side > 0 ? 0 : Math.PI, 0.8);
    const tone = this.attackerTone();
    for (let i = 0; i < this.count; i++) {
      const a0 = (i / this.count) * TAU + this.seed;
      const sx = ax + Math.cos(a0) * S * 0.6;
      const sy = S * 0.2 + Math.sin(a0) * S * 0.6;
      const wrapA = a0 * 1.7 + t * 6;
      const ex = vx + Math.cos(wrapA) * S * (hit ? 0.3 : 1.05);
      const ey = Math.sin(wrapA) * S * (hit ? 0.3 : 1.05);
      const tx = sx + (ex - sx) * reach;
      const ty = sy + (ey - sy) * reach;
      const wob = Math.sin(t * 11 + i) * S * 1.3;
      ctx.strokeStyle = '#000';
      ctx.lineCap = 'round';
      for (const [lw, col] of [[S * 0.36, '#000'], [S * 0.24, tone]] as const) {
        ctx.lineWidth = lw * (1 - action * 0.3);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo((sx + tx) / 2, (sy + ty) / 2 + wob, tx, ty);
        ctx.stroke();
      }
    }
    if (!hit) {
      const squeeze = 1 - action * 0.35;
      ctx.save();
      ctx.translate(vx, 0);
      ctx.scale(squeeze, 1 / squeeze);
      this.actor(ctx, this.spec.victim, 0, 0, S, 'scared', t, Math.PI * (this.side > 0 ? 1 : 0));
      ctx.restore();
    } else if (after < 0.02 && !this.bits.length) {
      this.explode(vx, 0, S, this.victimColors(), 40);
    }
  }

  /** A huge eye opens in the dark. The victim cracks and crumbles under its gaze. */
  private drawEye(ctx: CanvasRenderingContext2D, S: number, vx: number, action: number, after: number, hit: boolean, t: number): void {
    const open = ease(action * 1.4);
    const ew = S * 5.2;
    const eh = S * 2.4 * open;
    ctx.save();
    ctx.translate(0, -S * 0.6);
    ctx.fillStyle = '#F2E6D8';
    ctx.beginPath();
    ctx.ellipse(0, 0, ew, Math.max(1, eh), 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // bloodshot veins
    ctx.strokeStyle = 'rgba(190,20,40,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + this.seed;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * ew, Math.sin(a) * eh);
      ctx.quadraticCurveTo(Math.cos(a + 0.3) * ew * 0.6, Math.sin(a + 0.3) * eh * 0.6, Math.cos(a) * S * 1.3, Math.sin(a) * S * 1.3);
      ctx.stroke();
    }
    const look = clamp(vx / (S * 4), -0.4, 0.4) * ew * (0.4 + action * 0.6);
    const irisR = S * 1.5;
    ctx.fillStyle = this.accent;
    ctx.beginPath();
    ctx.arc(look, S * 0.4 * action, irisR, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(look, S * 0.4 * action, S * 0.22 * (1.6 - action), irisR * 0.9, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, ew, Math.max(1, eh), 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    const vy = S * 2.1;
    if (!hit) {
      this.actor(ctx, this.spec.victim, vx * 0.5, vy, S * 0.85, 'scared', t + Math.sin(t * 40) * 0.02, -Math.PI / 2);
    } else {
      // crumble: victim splits into falling slabs
      const pieces = 5;
      for (let i = 0; i < pieces; i++) {
        const fall = easeIn(after * 1.6 - i * 0.08) * S * 6;
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx * 0.5 - S, vy - S + (i * 2 * S) / pieces, S * 2, (2 * S) / pieces + 1);
        ctx.clip();
        ctx.translate((i % 2 ? 1 : -1) * after * S * 0.6, fall);
        ctx.globalAlpha *= 1 - after;
        this.actor(ctx, this.spec.victim, vx * 0.5, vy, S * 0.85, 'dead', t, -Math.PI / 2);
        ctx.restore();
      }
      // beam
      if (after < 0.25) {
        ctx.fillStyle = `rgba(255,43,74,${0.6 * (1 - after * 4)})`;
        ctx.beginPath();
        ctx.moveTo(-S * 0.5, -S * 0.2);
        ctx.lineTo(S * 0.5, -S * 0.2);
        ctx.lineTo(vx * 0.5 + S, vy);
        ctx.lineTo(vx * 0.5 - S, vy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** A spike (or a moon lance) skewers the victim; it hangs there, then slides off. */
  private drawImpale(ctx: CanvasRenderingContext2D, S: number, vx: number, ax: number, action: number, after: number, hit: boolean, t: number): void {
    const dir = this.side > 0 ? 0 : Math.PI;
    this.actor(ctx, this.spec.attacker, ax, 0, S, 'surge', t, dir, action);
    const launch = easeIn(action);
    const tipX = ax + (vx + S * 2.4 * this.side - ax) * (hit ? 1 : launch);
    const a = this.spec.attacker;
    ctx.save();
    if (a.kind === 'core') {
      // a lance of the attacker's moons
      const sprite = moonSprite(skinById(a.skin), t);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = ax + (tipX - ax) * ((i + 1) / n);
        const s = S * 0.55 * MOON_SPRITE_SCALE;
        ctx.drawImage(sprite, x - s / 2, -s / 2, s, s);
      }
    } else {
      ctx.fillStyle = '#0B0410';
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ax, -S * 0.3);
      ctx.lineTo(tipX, 0);
      ctx.lineTo(ax, S * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    const slide = hit ? easeIn((after - 0.3) / 0.7) * S * 5 : 0;
    const vmood: Mood = hit ? 'dead' : 'scared';
    ctx.save();
    ctx.translate(0, slide);
    ctx.rotate(hit ? Math.sin(t * 20) * 0.04 * (1 - after) : 0);
    this.actor(ctx, this.spec.victim, vx, 0, S, vmood, t, dir + Math.PI);
    ctx.restore();
    if (hit && after < 0.02 && !this.bits.length) this.explode(vx, 0, S * 0.6, ['#8E0F24', '#FF2B4A', ...this.victimColors()], 22);
    // drips
    if (hit) {
      ctx.fillStyle = '#8E0F24';
      for (let i = 0; i < 4; i++) {
        const dy = ((after * 3 + i * 0.25) % 1) * S * 3;
        ctx.beginPath();
        ctx.arc(vx + (i - 1.5) * S * 0.25, S + dy + slide, S * 0.07, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** Shadow hands rise from a pool and pull the victim under. */
  private drawDrag(ctx: CanvasRenderingContext2D, S: number, vx: number, action: number, after: number, hit: boolean, t: number): void {
    const poolY = S * 1.6;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(vx * 0.3, poolY, S * 3.2, S * 0.7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    const sink = hit ? easeIn(after * 1.4) * S * 3.6 : 0;
    // victim (clipped by the pool surface as it sinks)
    ctx.save();
    ctx.beginPath();
    ctx.rect(-S * 10, -S * 10, S * 20, poolY + S * 10);
    ctx.clip();
    this.actor(ctx, this.spec.victim, vx * 0.3, sink + Math.sin(t * 30) * (hit ? 2 : 0.5), S, hit ? 'dead' : 'scared', t, Math.PI / 2);
    ctx.restore();
    // hands
    const rise = ease(action);
    for (let i = 0; i < this.count; i++) {
      const hx = vx * 0.3 + (i - (this.count - 1) / 2) * S * 0.75;
      const top = poolY - rise * S * (2.2 + Math.sin(i * 2.3 + this.seed) * 0.5) + sink * 0.6;
      const grip = hit ? 1 : 0;
      ctx.fillStyle = '#060008';
      ctx.strokeStyle = '#3A0711';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx - S * 0.18, poolY);
      ctx.lineTo(hx - S * 0.14, top + S * 0.3);
      for (let f = 0; f < 4; f++) {
        const fx = hx - S * 0.18 + f * S * 0.12;
        const curl = grip * S * 0.25 * (f % 2 ? 1 : 0.7);
        ctx.lineTo(fx + curl * 0.5, top - S * 0.35 + curl);
        ctx.lineTo(fx + S * 0.06, top + S * 0.05);
      }
      ctx.lineTo(hx + S * 0.18, poolY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // bubbles after it goes under
    if (hit) {
      ctx.strokeStyle = 'rgba(255,43,74,0.7)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const b = (after * 2 + i * 0.2) % 1;
        ctx.beginPath();
        ctx.arc(vx * 0.3 + (i - 2) * S * 0.4, poolY - b * S, S * 0.08 * (1 - b) + 1, 0, TAU);
        ctx.stroke();
      }
    }
  }

  /** Reality tears: RGB split, the frame slices apart, the victim shreds into strips. */
  private drawGlitch(ctx: CanvasRenderingContext2D, S: number, vx: number, ax: number, action: number, after: number, hit: boolean, t: number, W: number, H: number): void {
    const jitter = action > 0.6 ? (Math.random() - 0.5) * S * 0.4 * action : 0;
    const dir = this.side > 0 ? 0 : Math.PI;
    const ap = ax + (vx - ax) * easeIn(action) * 0.55;
    if (!hit) {
      // chromatic ghosts
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.35;
      this.actor(ctx, this.spec.attacker, ap - S * 0.12 + jitter, 0, S, 'surge', t, dir, 0.7);
      this.actor(ctx, this.spec.victim, vx + S * 0.1 - jitter, 0, S, 'scared', t, dir + Math.PI);
      ctx.restore();
      this.actor(ctx, this.spec.attacker, ap + jitter, 0, S, 'surge', t, dir, 0.7);
      this.actor(ctx, this.spec.victim, vx - jitter, 0, S, 'scared', t, dir + Math.PI);
    } else {
      this.actor(ctx, this.spec.attacker, ap, 0, S, 'happy', t, dir, 0);
      const strips = 9;
      for (let i = 0; i < strips; i++) {
        const y0 = -S + (i * 2 * S) / strips;
        const off = Math.sin(i * 12.9898 + this.seed) * S * 4 * ease(after);
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx - S * 1.2, y0, S * 2.4, (2 * S) / strips + 0.5);
        ctx.clip();
        ctx.translate(off, 0);
        ctx.globalAlpha *= 1 - after;
        this.actor(ctx, this.spec.victim, vx, 0, S, 'dead', t, dir + Math.PI);
        ctx.restore();
      }
    }
    // tearing bands across the whole frame
    if (action > 0.5) {
      for (let i = 0; i < 6; i++) {
        const y = ((Math.sin(t * 13 + i * 7) + 1) / 2) * H - H / 2;
        ctx.fillStyle = i % 2 ? 'rgba(255,0,80,0.18)' : 'rgba(0,255,220,0.12)';
        ctx.fillRect(-W / 2, y, W, 4 + (i % 3) * 5);
      }
    }
  }
}
