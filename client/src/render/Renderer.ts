import { dustRadius } from '../../../shared/constants';
import { TAU, clamp, damp } from '../../../shared/math';
import { skinById } from '../../../shared/skins';
import type { Session, ViewCore, ViewDust } from '../game/session';
import { WRAITH_RADIUS } from '../../../shared/constants';
import { DUST_COLORS, DUST_CORE_FRACTION, INK, MOON_SPRITE_SCALE, drawCoreBody, drawStar, drawSunstone, drawWraith, drawWraithEyes, dustSprite, glowSprite, moonSprite, prismColor } from './art';
import { Cinematic } from './Cinematic';
import type { Mood } from './art';
import { Effects } from './effects';

interface CoreVisual {
  blink: number;
  nextBlink: number;
  chomp: number;
  wobble: number;
  happy: number;
  lastMoons: number;
  pulse: number;
  seen: number;
  /** 0..1 fade-in */
  appear: number;
}

interface DustAnim {
  t0: number;
  fx: number;
  fy: number;
  delay: number;
}

export interface RenderOptions {
  meId: number | null;
  crownId: number | null;
  /** Attract mode: hide HUD-ish world overlays (pointer chevron etc.) */
  attract: boolean;
}

export const FONT_DISPLAY = '"Lilita One", "Fredoka", system-ui, sans-serif';
export const FONT_BODY = '"Fredoka", system-ui, sans-serif';

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly effects = new Effects();
  dpr = 1;
  w = 0;
  h = 0;
  time = 0;
  quality: 'high' | 'low' = 'high';

  cam = { x: 0, y: 0, zoom: 0.6, targetZoom: 0.6 };
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private rimDanger = 0;

  /** 0..1 Blood Moon blend (smoothed) */
  horror = 0;
  /** 0..1 how close the nearest hunting wraith is to you */
  fear = 0;
  readonly cinematic = new Cinematic();
  private dark: HTMLCanvasElement = document.createElement('canvas');
  private wraithSeen = new Map<number, number>();
  private bolt = 0;

  private visuals = new Map<number, CoreVisual>();
  private dustAnim = new Map<number, DustAnim>();
  private starTiles: HTMLCanvasElement[] = [];
  private nebula!: HTMLCanvasElement;
  private gridPattern: CanvasPattern | null = null;
  private frame = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.buildBackground();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: 'high' | 'low'): void {
    this.quality = q;
    this.effects.maxParticles = q === 'high' ? 900 : 300;
    this.resize();
  }

  resize(): void {
    const maxDpr = this.quality === 'high' ? 2 : 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  // ───────────────────────────────────────── background assets

  private buildBackground(): void {
    const tints = ['#FFFFFF', '#FFE6F0', '#D8E4FF', '#FFF3C9'];
    for (let layer = 0; layer < 3; layer++) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d')!;
      const n = [90, 45, 18][layer];
      for (let i = 0; i < n; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = [0.7, 1.2, 1.9][layer] * (0.6 + Math.random() * 0.7);
        g.globalAlpha = [0.35, 0.55, 0.85][layer] * (0.5 + Math.random() * 0.5);
        g.fillStyle = tints[Math.floor(Math.random() * tints.length)];
        if (layer === 2 && Math.random() < 0.5) {
          drawStar(g, x, y, s * 2.4, s * 0.6, 0);
        } else {
          g.beginPath();
          g.arc(x, y, s, 0, TAU);
          g.fill();
        }
      }
      this.starTiles.push(c);
    }

    // nebula: soft overlapping blobs in the brand palette
    const n = document.createElement('canvas');
    n.width = n.height = 512;
    const g = n.getContext('2d')!;
    g.fillStyle = '#120B1F';
    g.fillRect(0, 0, 512, 512);
    const blobs: [number, number, number, string][] = [
      [120, 140, 220, 'rgba(120,60,200,0.22)'],
      [400, 360, 260, 'rgba(255,90,150,0.12)'],
      [380, 90, 180, 'rgba(60,170,220,0.12)'],
      [90, 430, 200, 'rgba(255,170,80,0.08)'],
      [260, 260, 160, 'rgba(90,70,220,0.16)'],
    ];
    for (const [x, y, r, col] of blobs) {
      for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
        const rg = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        rg.addColorStop(0, col);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg;
        g.fillRect(0, 0, 512, 512);
      }
    }
    this.nebula = n;

    const grid = document.createElement('canvas');
    grid.width = grid.height = 90;
    const gg = grid.getContext('2d')!;
    gg.fillStyle = 'rgba(200,180,255,0.10)';
    gg.beginPath();
    gg.arc(45, 45, 2.6, 0, TAU);
    gg.fill();
    this.gridPattern = this.ctx.createPattern(grid, 'repeat');
  }

  // ───────────────────────────────────────── camera & juice

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  addFlash(amount: number, color = '#ffffff'): void {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  setRimDanger(v: number): void {
    this.rimDanger = v;
  }

  /** Visible world span grows with your orbit so big players see the field they control. */
  follow(x: number, y: number, orbitR: number, vx: number, vy: number, dt: number, snap = false): void {
    const area = Math.sqrt(this.w * this.h);
    const screenBoost = clamp(area / 700, 1, 1.7);
    const span = (820 + orbitR * 3.1) * screenBoost;
    this.cam.targetZoom = area / span;
    const lead = 0.18;
    const tx = x + vx * lead;
    const ty = y + vy * lead;
    if (snap) {
      this.cam.x = tx;
      this.cam.y = ty;
      this.cam.zoom = this.cam.targetZoom;
    } else {
      const k = damp(7, dt);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
      this.cam.zoom += (this.cam.targetZoom - this.cam.zoom) * damp(2.2, dt);
    }
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.cam.x) * this.cam.zoom + this.w / 2, y: (y - this.cam.y) * this.cam.zoom + this.h / 2 };
  }

  // ───────────────────────────────────────── event-driven effects

  onDustAdded(d: ViewDust, starfall: { x: number; y: number; r: number; in: number } | null): void {
    if (this.dustAnim.size > 600) return;
    let delay = 0;
    if (starfall && starfall.in <= 0.05 && (d.x - starfall.x) ** 2 + (d.y - starfall.y) ** 2 < (starfall.r + 30) ** 2) {
      delay = 0.3;
      this.effects.meteor(d.x, d.y, DUST_COLORS[d.c] ?? '#fff');
    }
    this.dustAnim.set(d.id, { t0: this.time, fx: d.fx ?? d.x, fy: d.fy ?? d.y, delay });
  }

  /** Returns the core that ate it (if any). */
  onDustRemoved(d: ViewDust, cores: Map<number, ViewCore>): ViewCore | null {
    this.dustAnim.delete(d.id);
    let best: ViewCore | null = null;
    let bestD = Infinity;
    for (const c of cores.values()) {
      const dd = (c.x - d.x) ** 2 + (c.y - d.y) ** 2;
      const reach = c.r + 70;
      if (dd < reach * reach && dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    if (best && this.isVisible(d.x, d.y, 40)) {
      this.effects.suck(d.x, d.y, best.x, best.y, DUST_COLORS[d.c] ?? '#fff', dustRadius(d.v));
      const v = this.visuals.get(best.id);
      if (v) v.chomp = Math.min(1, v.chomp + 0.35 + d.v * 0.05);
    }
    return best;
  }

  clashAt(x: number, y: number, colorA: string, colorB: string, near: boolean): void {
    this.effects.shards(x, y, colorA, 5, 260, 7);
    this.effects.shards(x, y, colorB, 5, 260, 7);
    this.effects.spark(x, y, '#FFFFFF', 10, 520, 0.3);
    this.effects.ring(x, y, '#FFFFFF', 4, 46, 0.3, 5);
    if (near) this.addShake(0.22);
  }

  killAt(x: number, y: number, skinId: number, radius: number, near: boolean, byMe: boolean): void {
    const s = skinById(skinId);
    const body = s.animated ? prismColor(this.time) : s.body;
    this.effects.ring(x, y, body, radius * 0.6, radius * 4.5, 0.55, 10);
    this.effects.ring(x, y, '#FFFFFF', radius * 0.4, radius * 2.6, 0.35, 6);
    this.effects.chunks(x, y, body, 14, 420 + radius * 3, Math.max(7, radius * 0.32));
    this.effects.chunks(x, y, s.dark, 6, 300, Math.max(5, radius * 0.25));
    this.effects.spark(x, y, s.light, 18, 700, 0.5);
    if (byMe) {
      this.addShake(0.55);
      this.addFlash(0.18, '#FFFFFF');
    } else if (near) {
      this.addShake(0.3);
    }
  }

  moonGained(core: ViewCore): void {
    const v = this.visuals.get(core.id);
    if (v) v.pulse = 1;
  }

  coreHappy(id: number): void {
    const v = this.visuals.get(id);
    if (v) v.happy = 1.4;
  }

  floatText(x: number, y: number, text: string, color: string, sizePx: number): void {
    this.effects.text(x, y, text, color, sizePx / this.cam.zoom);
  }

  isVisible(x: number, y: number, pad: number): boolean {
    const hw = this.w / 2 / this.cam.zoom + pad;
    const hh = this.h / 2 / this.cam.zoom + pad;
    return Math.abs(x - this.cam.x) < hw && Math.abs(y - this.cam.y) < hh;
  }

  // ───────────────────────────────────────── frame

  render(session: Session, dt: number, opts: RenderOptions): void {
    this.time += dt;
    this.frame++;
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const z = this.cam.zoom;

    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * this.shake * 18;
    this.shakeX = (Math.random() * 2 - 1) * sh;
    this.shakeY = (Math.random() * 2 - 1) * sh;

    this.effects.update(dt);

    const bl = session.blood;
    const target = bl.phase === 'dark' ? Math.min(1, bl.in / 3) : bl.phase === 'warn' ? 0.5 * clamp(1 - bl.in / 6, 0, 1) : 0;
    this.horror += (target - this.horror) * damp(bl.phase === 'dark' ? 3 : 1.2, dt);
    if (this.horror < 0.002) this.horror = 0;
    if (bl.phase === 'dark' && Math.random() < dt * 0.22) this.bolt = 1;
    this.bolt = Math.max(0, this.bolt - dt * 5);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBackground(ctx);
    if (this.horror > 0) this.drawBloodSky(ctx);

    // world space
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - this.cam.x * z + this.shakeX), dpr * (h / 2 - this.cam.y * z + this.shakeY));
    const px = 1 / z;
    const view = {
      x0: this.cam.x - w / 2 / z - 60,
      y0: this.cam.y - h / 2 / z - 60,
      x1: this.cam.x + w / 2 / z + 60,
      y1: this.cam.y + h / 2 / z + 60,
    };
    this.drawArena(ctx, session.arenaRadius, view, px);
    this.drawStarfall(ctx, session, px);
    this.drawDust(ctx, session, view);
    this.drawFreeMoons(ctx, session, view, px);
    this.drawSunstones(ctx, session, view, px);
    this.drawCores(ctx, session, view, px, opts);
    this.drawWraiths(ctx, session, view, px, opts, dt);
    this.effects.draw(ctx, px, FONT_DISPLAY);

    // screen space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.horror > 0.05 && !opts.attract) this.drawDarkness(ctx, session, opts);
    this.drawOverlays(ctx, session, opts);
    this.cinematic.draw(ctx, w, h);
  }

  private toScreen(ctx: CanvasRenderingContext2D): void {
    const { dpr, w, h } = this;
    const z = this.cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - this.cam.x * z + this.shakeX), dpr * (h / 2 - this.cam.y * z + this.shakeY));
  }

  // ───────────────────────────────────────── Blood Moon

  private drawBloodSky(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this;
    const k = this.horror;
    ctx.fillStyle = `rgba(60,0,12,${0.6 * k})`;
    ctx.fillRect(0, 0, w, h);
    // the moon rises as the event takes hold
    const R = Math.min(w, h) * 0.34;
    const x = w * 0.7 - this.cam.x * 0.01;
    const y = h * 0.28 + (1 - k) * h * 0.7 - this.cam.y * 0.01;
    ctx.globalAlpha = k;
    const halo = R * 3.2;
    ctx.drawImage(glowSprite('rgba(255,30,50,0.55)'), x - halo / 2, y - halo / 2, halo, halo);
    const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
    g.addColorStop(0, '#E0263F');
    g.addColorStop(0.7, '#9C0E25');
    g.addColorStop(1, '#4A0310');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,0,8,0.45)';
    for (const [cx, cy, cr] of [[-0.35, -0.1, 0.2], [0.25, 0.3, 0.16], [0.1, -0.4, 0.12], [-0.1, 0.45, 0.09], [0.45, -0.05, 0.08]]) {
      ctx.beginPath();
      ctx.arc(x + cx * R, y + cy * R, cr * R, 0, TAU);
      ctx.fill();
    }
    // a faint face in the craters — only noticed on a second look
    ctx.fillStyle = `rgba(20,0,4,${0.35 * k})`;
    ctx.beginPath();
    ctx.ellipse(x - R * 0.28, y - R * 0.05, R * 0.09, R * 0.05, 0.3, 0, TAU);
    ctx.ellipse(x + R * 0.22, y - R * 0.1, R * 0.09, R * 0.05, -0.3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawSunstones(ctx: CanvasRenderingContext2D, session: Session, view: { x0: number; y0: number; x1: number; y1: number }, px: number): void {
    const t = this.time;
    for (const s of session.sunstones) {
      if (s.x < view.x0 || s.x > view.x1 || s.y < view.y0 || s.y > view.y1) continue;
      const bob = Math.sin(t * 3 + s.id) * 4;
      const glow = 150 + Math.sin(t * 5 + s.id) * 15;
      ctx.drawImage(glowSprite('rgba(255,200,60,0.7)'), s.x - glow / 2, s.y - glow / 2 + bob, glow, glow);
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      drawSunstone(ctx, 16, t, px);
      ctx.restore();
    }
  }

  private drawWraiths(ctx: CanvasRenderingContext2D, session: Session, view: { x0: number; y0: number; x1: number; y1: number }, px: number, opts: RenderOptions, dt: number): void {
    const t = this.time;
    const me = opts.meId !== null ? session.cores.get(opts.meId) : undefined;
    const alive = new Set<number>();
    for (const wr of session.wraiths) {
      alive.add(wr.id);
      if (!this.wraithSeen.has(wr.id)) {
        this.wraithSeen.set(wr.id, t);
        if (this.isVisible(wr.x, wr.y, 50)) this.effects.ring(wr.x, wr.y + WRAITH_RADIUS, '#8E0F24', 10, 90, 0.6, 8);
      }
      if (wr.x < view.x0 - 60 || wr.x > view.x1 + 60 || wr.y < view.y0 - 60 || wr.y > view.y1 + 60) continue;
      const rise = clamp((t - this.wraithSeen.get(wr.id)!) / 0.9, 0, 1);
      const d = me ? Math.hypot(me.x - wr.x, me.y - wr.y) : 9999;
      const maw = clamp(1 - d / 320, 0, 1);
      const dir = Math.atan2(wr.vy, wr.vx);
      // shadow pool + smoke
      ctx.fillStyle = wr.scared ? 'rgba(120,180,255,0.18)' : 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(wr.x, wr.y + WRAITH_RADIUS * 0.9, WRAITH_RADIUS * 1.1, WRAITH_RADIUS * 0.35, 0, 0, TAU);
      ctx.fill();
      if (this.quality === 'high' && Math.random() < dt * 30) {
        this.effects.dot(wr.x + (Math.random() - 0.5) * 30, wr.y + WRAITH_RADIUS * 0.6, -wr.vx * 0.2, -wr.vy * 0.2 - 20, wr.scared ? 'rgba(170,220,255,0.5)' : 'rgba(60,0,20,0.7)', 9, 0.7);
      }
      const flicker = wr.stagger > 0 ? 0.5 + 0.5 * Math.sin(t * 60) : 1;
      ctx.save();
      ctx.translate(wr.x, wr.y + Math.sin(t * 4 + wr.id) * 4);
      ctx.globalAlpha = flicker;
      drawWraith(ctx, WRAITH_RADIUS, { dir, scared: wr.scared, maw, rise, t: t + wr.id, eyes: true }, px);
      ctx.restore();
    }
    for (const id of this.wraithSeen.keys()) if (!alive.has(id)) this.wraithSeen.delete(id);
  }

  /** Flashlight darkness: only light sources cut through. Eyes glow on top. */
  private drawDarkness(ctx: CanvasRenderingContext2D, session: Session, opts: RenderOptions): void {
    const level = clamp((this.horror - 0.25) / 0.75, 0, 1);
    if (level <= 0) return;
    const { w, h } = this;
    const scale = 0.5;
    const dw = Math.ceil(w * scale);
    const dh = Math.ceil(h * scale);
    const c = this.dark;
    if (c.width !== dw || c.height !== dh) {
      c.width = dw;
      c.height = dh;
    }
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, dw, dh);
    g.fillStyle = `rgba(4,0,6,${0.95 * level})`;
    g.fillRect(0, 0, dw, dh);
    g.globalCompositeOperation = 'destination-out';
    const light = glowSprite('rgba(255,255,255,1)');
    const z = this.cam.zoom;
    const hole = (x: number, y: number, r: number) => {
      const sp = this.worldToScreen(x, y);
      const rr = r * z * scale * 2;
      g.drawImage(light, sp.x * scale - rr / 2, sp.y * scale - rr / 2, rr, rr);
    };
    const me = opts.meId !== null ? session.cores.get(opts.meId) : undefined;
    if (me) {
      const flick = 1 + Math.sin(this.time * 17) * 0.02 + (Math.random() - 0.5) * 0.03;
      const r = (me.orbitR * 1.35 + 240) * (me.radiant > 0 ? 1.8 : 1) * flick;
      hole(me.x, me.y, r);
      hole(me.x, me.y, r * 0.6);
    }
    for (const s of session.sunstones) hole(s.x, s.y, 170);
    for (const c2 of session.cores.values()) if (c2.radiant > 0 && c2 !== me) hole(c2.x, c2.y, 300);
    ctx.drawImage(c, 0, 0, w, h);

    // eyes and sunstone glints pierce the dark
    this.toScreen(ctx);
    const t = this.time;
    for (const wr of session.wraiths) {
      if (!this.isVisible(wr.x, wr.y, 40)) continue;
      ctx.save();
      ctx.translate(wr.x, wr.y + Math.sin(t * 4 + wr.id) * 4);
      ctx.globalAlpha = level;
      drawWraithEyes(ctx, WRAITH_RADIUS, { dir: Math.atan2(wr.vy, wr.vx), scared: wr.scared, maw: 0, rise: 1, t: t + wr.id, eyes: true });
      ctx.restore();
    }
    for (const s of session.sunstones) {
      if (!this.isVisible(s.x, s.y, 40)) continue;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 6 + s.id);
      ctx.fillStyle = '#FFE45C';
      drawStar(ctx, s.x, s.y, 14, 4, t);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this;
    ctx.fillStyle = '#120B1F';
    ctx.fillRect(0, 0, w, h);
    if (this.quality === 'high') {
      // nebula drifts very slowly — sells depth
      const s = Math.max(w, h) * 1.6;
      const ox = (-this.cam.x * 0.03) % s;
      const oy = (-this.cam.y * 0.03) % s;
      ctx.globalAlpha = 1;
      for (const dx of [0, ox > 0 ? -s : s]) {
        for (const dy of [0, oy > 0 ? -s : s]) {
          ctx.drawImage(this.nebula, ox + dx + (w - s) / 2, oy + dy + (h - s) / 2, s, s);
        }
      }
    }
    const par = [0.05, 0.12, 0.22];
    for (let i = 0; i < this.starTiles.length; i++) {
      if (this.quality === 'low' && i === 0) continue;
      const tile = this.starTiles[i];
      const p = par[i];
      const ox = (((-this.cam.x * p) % 512) + 512) % 512;
      const oy = (((-this.cam.y * p) % 512) + 512) % 512;
      for (let x = ox - 512; x < w; x += 512) {
        for (let y = oy - 512; y < h; y += 512) {
          ctx.drawImage(tile, x, y);
        }
      }
    }
  }

  private drawArena(ctx: CanvasRenderingContext2D, R: number, view: { x0: number; y0: number; x1: number; y1: number }, px: number): void {
    // floor dots (only inside the arena)
    if (this.gridPattern) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.clip();
      ctx.fillStyle = this.gridPattern;
      ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
      ctx.restore();
    }

    // is the rim on screen at all?
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const halfDiag = Math.hypot(view.x1 - view.x0, view.y1 - view.y0) / 2;
    const dc = Math.hypot(cx, cy);
    if (dc + halfDiag < R - 40) return;

    // the void beyond the rim
    ctx.fillStyle = 'rgba(255,60,100,0.07)';
    ctx.beginPath();
    ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    ctx.arc(0, 0, R, 0, TAU, true);
    ctx.fill('evenodd');
    // hazard stripes just outside
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R + 70, 0, TAU);
    ctx.arc(0, 0, R, 0, TAU, true);
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(255,77,109,0.18)';
    ctx.lineWidth = 18;
    const a0 = Math.atan2(cy, cx);
    const span = Math.min(Math.PI, (halfDiag / R) * 1.4);
    for (let a = a0 - span; a < a0 + span; a += 60 / R) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.lineTo(Math.cos(a + 40 / R) * (R + 80), Math.sin(a + 40 / R) * (R + 80));
      ctx.stroke();
    }
    ctx.restore();
    // glow + dashed rim
    ctx.strokeStyle = 'rgba(255,77,109,0.15)';
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.arc(0, 0, R + 4, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#FF4D6D';
    ctx.lineWidth = Math.max(8, 3 * px);
    ctx.setLineDash([46, 26]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawStarfall(ctx: CanvasRenderingContext2D, session: Session, px: number): void {
    const sf = session.starfall;
    if (!sf) return;
    const t = this.time;
    const warn = sf.in > 0;
    const pulse = 0.5 + 0.5 * Math.sin(t * (warn ? 6 + 10 / Math.max(0.5, sf.in) : 12));
    ctx.fillStyle = `rgba(255,228,92,${0.05 + pulse * 0.06})`;
    ctx.beginPath();
    ctx.arc(sf.x, sf.y, sf.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#FFE45C';
    ctx.lineWidth = Math.max(5, 2.5 * px);
    ctx.setLineDash([30, 20]);
    ctx.lineDashOffset = t * 50;
    ctx.stroke();
    ctx.setLineDash([]);
    // shrinking target ring = countdown you can read at a glance
    if (warn) {
      const rr = sf.r * (0.2 + 0.8 * Math.min(1, sf.in / 6));
      ctx.strokeStyle = `rgba(255,228,92,${0.4 + pulse * 0.4})`;
      ctx.lineWidth = Math.max(3, 2 * px);
      ctx.beginPath();
      ctx.arc(sf.x, sf.y, rr, 0, TAU);
      ctx.stroke();
      const size = Math.max(60, 26 * px);
      ctx.font = `${size}px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = size * 0.18;
      ctx.strokeStyle = INK;
      ctx.lineJoin = 'round';
      const label = String(Math.ceil(sf.in));
      ctx.strokeText(label, sf.x, sf.y);
      ctx.fillStyle = '#FFE45C';
      ctx.fillText(label, sf.x, sf.y);
    }
  }

  private drawDust(ctx: CanvasRenderingContext2D, session: Session, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const t = this.time;
    const low = this.quality === 'low';
    for (const d of session.dust.values()) {
      if (d.x < view.x0 || d.x > view.x1 || d.y < view.y0 || d.y > view.y1) {
        // still advance fly-out anims off-screen
        continue;
      }
      let x = d.x;
      let y = d.y;
      let scale = 1;
      const anim = this.dustAnim.get(d.id);
      if (anim) {
        const e = clamp((t - anim.t0 - anim.delay) / 0.5, 0, 1);
        if (e >= 1) this.dustAnim.delete(d.id);
        if (t - anim.t0 < anim.delay) continue;
        const ease = 1 - (1 - e) ** 3;
        x = anim.fx + (d.x - anim.fx) * ease;
        y = anim.fy + (d.y - anim.fy) * ease;
        scale = e < 0.7 ? e / 0.7 * 1.25 : 1.25 - (e - 0.7) / 0.3 * 0.25;
      }
      const r = dustRadius(d.v) * 1.25;
      const tw = low ? 1 : 0.85 + 0.15 * Math.sin(t * 3 + d.id * 1.7);
      const size = (r / DUST_CORE_FRACTION) * 2 * scale * tw;
      if (d.c === 6) {
        // gold: slowly spinning star
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 1.5 + d.id);
        ctx.drawImage(dustSprite(6), -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.drawImage(dustSprite(d.c), x - size / 2, y - size / 2, size, size);
      }
    }
  }

  private drawFreeMoons(ctx: CanvasRenderingContext2D, session: Session, view: { x0: number; y0: number; x1: number; y1: number }, px: number): void {
    const t = this.time;
    for (const m of session.freeMoons) {
      if (m.x < view.x0 || m.x > view.x1 || m.y < view.y0 || m.y > view.y1) continue;
      const skin = skinById(m.skin);
      const r = 11;
      const bob = Math.sin(t * 5 + m.id) * 0.12;
      // "grab me" ring
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(2, 1.5 * px);
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -t * 20;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r * (2 + bob * 3), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const s = r * MOON_SPRITE_SCALE * 2 * (1 + bob);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(t * 2 + m.id);
      ctx.drawImage(moonSprite(skin, t), -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  private visual(id: number): CoreVisual {
    let v = this.visuals.get(id);
    if (!v) {
      v = { blink: 0, nextBlink: 1 + Math.random() * 3, chomp: 0, wobble: 0, happy: 0, lastMoons: -1, pulse: 0, seen: this.frame, appear: 0 };
      this.visuals.set(id, v);
    }
    v.seen = this.frame;
    return v;
  }

  private drawCores(ctx: CanvasRenderingContext2D, session: Session, view: { x0: number; y0: number; x1: number; y1: number }, px: number, opts: RenderOptions): void {
    const t = this.time;
    const dt = 1 / 60;
    const visible: ViewCore[] = [];
    for (const c of session.cores.values()) {
      const pad = c.orbitR + c.moonR * 2 + 40;
      if (c.x + pad < view.x0 || c.x - pad > view.x1 || c.y + pad < view.y0 || c.y - pad > view.y1) continue;
      visible.push(c);
    }
    // draw small first so the big ones sit on top
    visible.sort((a, b) => a.mass - b.mass);
    const me = opts.meId !== null ? session.cores.get(opts.meId) : undefined;
    const high = this.quality === 'high';

    // pass 1: orbit guides + moon trails
    for (const c of visible) {
      const skin = skinById(c.skin);
      const isMe = c.id === opts.meId;
      ctx.strokeStyle = skin.animated ? prismColor(t) : skin.light;
      ctx.globalAlpha = (isMe ? 0.22 : 0.1) + (c.surging ? 0.15 : 0);
      ctx.lineWidth = Math.max(1.5 * px, 2);
      ctx.setLineDash([8, 10]);
      ctx.lineDashOffset = -t * 30 * c.spin;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.orbitR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      if (high) {
        const trail = Math.min(1.1, (c.surging ? 120 : 70) / Math.max(30, c.orbitR));
        ctx.strokeStyle = skin.animated ? prismColor(t, 180) : skin.moon;
        ctx.lineCap = 'round';
        ctx.lineWidth = c.moonR * 1.3;
        ctx.globalAlpha = c.surging ? 0.32 : 0.16;
        for (const off of c.moons) {
          const a = c.orbitAngle + off;
          ctx.beginPath();
          if (c.spin > 0) ctx.arc(c.x, c.y, c.orbitR, a - trail, a);
          else ctx.arc(c.x, c.y, c.orbitR, a, a + trail);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // pass 2: bodies
    for (const c of visible) {
      const skin = skinById(c.skin);
      const v = this.visual(c.id);
      v.appear = Math.min(1, v.appear + dt * 4);
      v.nextBlink -= dt;
      if (v.nextBlink <= 0) {
        v.blink = 1;
        v.nextBlink = 2 + Math.random() * 4;
      }
      v.blink = Math.max(0, v.blink - dt * 7);
      v.chomp = Math.max(0, v.chomp - dt * 4);
      v.happy = Math.max(0, v.happy - dt);
      v.pulse = Math.max(0, v.pulse - dt * 2.5);
      v.wobble = Math.max(0, v.wobble - dt * 3);
      if (v.lastMoons >= 0 && c.moons.length > v.lastMoons) v.pulse = 1;
      v.lastMoons = c.moons.length;

      let mood: Mood = 'idle';
      if (v.happy > 0) mood = 'happy';
      else if (c.surging) mood = 'surge';
      else if (v.chomp > 0.4) mood = 'chomp';
      else if (me && me !== c && me.moons.length > c.moons.length * 1.6 && (me.x - c.x) ** 2 + (me.y - c.y) ** 2 < (me.orbitR * 1.8) ** 2) mood = 'scared';

      const r = c.r * (1 + v.pulse * 0.12) * (0.6 + 0.4 * easeOutBack(v.appear));
      const speed = Math.hypot(c.vx, c.vy);
      const stretch = 1 + Math.min(0.07, speed / 6000) + Math.sin(t * 22) * v.chomp * 0.03;
      const dir = Math.atan2(c.vy, c.vx);

      if (c.radiant > 0) {
        const aura = (c.orbitR + 60) * 2.2 * (1 + Math.sin(t * 8) * 0.05);
        ctx.drawImage(glowSprite('rgba(255,200,60,0.55)'), c.x - aura / 2, c.y - aura / 2, aura, aura);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(t * 1.5);
        ctx.fillStyle = 'rgba(255,214,90,0.5)';
        for (let i = 0; i < 10; i++) {
          ctx.rotate(TAU / 10);
          ctx.beginPath();
          ctx.moveTo(r * 1.1, -r * 0.18);
          ctx.lineTo(r * 2.1, 0);
          ctx.lineTo(r * 1.1, r * 0.18);
          ctx.fill();
        }
        ctx.restore();
      }
      const spooky = c.id === opts.meId || c.radiant > 0 ? 0 : this.horror;

      ctx.save();
      ctx.translate(c.x, c.y);
      if (c.shield > 0) ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 14);
      // squash & stretch along travel direction
      ctx.rotate(dir);
      ctx.scale(stretch, 1 / stretch);
      ctx.rotate(-dir);
      drawCoreBody(ctx, r, skin, { look: c.heading, blink: v.blink, mood, chomp: v.chomp, spooky }, t, px);
      ctx.restore();

      if (c.shield > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = Math.max(2, 1.5 * px);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 8 + Math.sin(t * 6) * 2, 0, TAU);
        ctx.stroke();
      }
      if (v.pulse > 0) {
        ctx.strokeStyle = skin.animated ? prismColor(t) : skin.moon;
        ctx.globalAlpha = v.pulse;
        ctx.lineWidth = 4 * v.pulse + px;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.orbitR * (1 + (1 - v.pulse) * 0.25), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // heading chevron for the player
      if (c.id === opts.meId && !opts.attract) {
        const a = c.heading;
        const d0 = r + 10;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * (d0 + 12), c.y + Math.sin(a) * (d0 + 12));
        ctx.lineTo(c.x + Math.cos(a + 0.35) * d0, c.y + Math.sin(a + 0.35) * d0);
        ctx.lineTo(c.x + Math.cos(a - 0.35) * d0, c.y + Math.sin(a - 0.35) * d0);
        ctx.closePath();
        ctx.fill();
      }
    }

    // pass 3: moons (on top, so bites read clearly)
    for (const c of visible) {
      const skin = skinById(c.skin);
      const sprite = moonSprite(skin, t);
      const v = this.visuals.get(c.id);
      const mr = c.moonR * (1 + (v?.pulse ?? 0) * 0.15);
      const size = mr * MOON_SPRITE_SCALE * 2;
      if (c.shield > 0) ctx.globalAlpha = 0.5;
      for (const off of c.moons) {
        const a = c.orbitAngle + off;
        const mx = c.x + Math.cos(a) * c.orbitR;
        const my = c.y + Math.sin(a) * c.orbitR;
        const facing = a + (c.spin * Math.PI) / 2;
        if (c.radiant > 0) {
          const gs = mr * 6;
          ctx.drawImage(glowSprite('rgba(255,180,40,0.8)'), mx - gs / 2, my - gs / 2, gs, gs);
        }
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(facing);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
        if (skin.moonStyle === 'ember' && high && Math.random() < 0.15) {
          this.effects.dot(mx, my, -Math.cos(facing) * 40, -Math.sin(facing) * 40, '#FFB347', mr * 0.4, 0.35);
        }
      }
      ctx.globalAlpha = 1;
    }

    // pass 4: names + crown
    for (const c of visible) {
      const isMe = c.id === opts.meId;
      if (opts.attract && !isMe && c.mass < 200) continue;
      const size = clamp(c.r * 0.5, 13 * px, 30 * px);
      const y = c.y + c.r + size * 0.95;
      ctx.font = `${size}px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.26;
      ctx.strokeStyle = INK;
      ctx.strokeText(c.name, c.x, y);
      ctx.fillStyle = isMe ? '#FFE45C' : '#FFF4E0';
      ctx.fillText(c.name, c.x, y);
      if (c.id === opts.crownId) this.drawCrown(ctx, c.x, c.y - c.r - size * 0.9, size * 1.3, px);
    }

    // forget visuals for cores that left
    if (this.frame % 120 === 0) {
      for (const [id, v] of this.visuals) if (this.frame - v.seen > 240) this.visuals.delete(id);
    }
  }

  private drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, px: number): void {
    const bob = Math.sin(this.time * 3) * s * 0.06;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = '#FFD84D';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2 * px, s * 0.1);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.25);
    ctx.lineTo(-s * 0.55, -s * 0.25);
    ctx.lineTo(-s * 0.25, 0);
    ctx.lineTo(0, -s * 0.35);
    ctx.lineTo(s * 0.25, 0);
    ctx.lineTo(s * 0.55, -s * 0.25);
    ctx.lineTo(s * 0.5, s * 0.25);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = '#FF5C8A';
    ctx.beginPath();
    ctx.arc(0, s * 0.08, s * 0.08, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, session: Session, opts: RenderOptions): void {
    const { w, h } = this;
    // rim danger vignette
    if (this.rimDanger > 0.01) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(255,40,80,0)');
      g.addColorStop(1, `rgba(255,40,80,${0.45 * this.rimDanger * (0.75 + 0.25 * Math.sin(this.time * 10))})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // heartbeat vignette when something is hunting you
    if (this.fear > 0.02) {
      const beat = Math.pow(Math.max(0, Math.sin(this.time * (5 + this.fear * 6))), 6);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(120,0,20,0)');
      g.addColorStop(1, `rgba(150,0,25,${(0.35 + beat * 0.4) * this.fear})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.bolt > 0.01) {
      ctx.fillStyle = `rgba(255,220,230,${this.bolt * 0.22})`;
      ctx.fillRect(0, 0, w, h);
    }
    // starfall pointer when off-screen
    const sf = session.starfall;
    if (sf && !opts.attract && !this.isVisible(sf.x, sf.y, -sf.r * 0.5)) {
      const s = this.worldToScreen(sf.x, sf.y);
      const a = Math.atan2(s.y - h / 2, s.x - w / 2);
      const m = 34;
      const ex = clamp(w / 2 + Math.cos(a) * w, m, w - m);
      const ey = clamp(h / 2 + Math.sin(a) * h, m + 50, h - m);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.fillStyle = '#FFE45C';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, TAU);
      ctx.stroke();
      ctx.fill();
      ctx.fillStyle = INK;
      drawStar(ctx, 0, 0, 10, 3.5, this.time * 2);
      ctx.rotate(a);
      ctx.fillStyle = '#FFE45C';
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(17, -7);
      ctx.lineTo(17, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (this.flash > 0.01) {
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = this.flash;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      this.flash *= 0.85;
    }
  }
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}
