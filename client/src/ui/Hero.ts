import { TAU } from '../../../shared/math';
import type { Skin } from '../../../shared/skins';
import { MOON_SPRITE_SCALE, drawCoreBody, moonSprite } from '../render/art';

/** The big animated character on the main menu — doubles as the skin preview. */
export class Hero {
  private ctx: CanvasRenderingContext2D;
  private t = 0;
  private blink = 0;
  private nextBlink = 2;
  private bounce = 0;
  private look = 0;
  locked = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  poke(): void {
    this.bounce = 1;
  }

  draw(skin: Skin, dt: number): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.t += dt;
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 2 + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    this.bounce = Math.max(0, this.bounce - dt * 2.5);
    this.look = Math.sin(this.t * 0.7) * 1.2 + Math.PI / 2;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2 + 4;
    const r = Math.min(w, h) * 0.2;
    const orbitRx = Math.min(w * 0.42, r * 2.6);
    const orbitRy = orbitRx * 0.36;
    const tilt = -0.18;
    const moons = 5;
    const spin = this.t * 1.1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);

    // orbit ellipse
    ctx.strokeStyle = 'rgba(255,244,224,0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.ellipse(0, 0, orbitRx, orbitRy, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    const positions: { x: number; y: number; z: number; a: number }[] = [];
    for (let i = 0; i < moons; i++) {
      const a = spin + (i / moons) * TAU;
      positions.push({ x: Math.cos(a) * orbitRx, y: Math.sin(a) * orbitRy, z: Math.sin(a), a });
    }
    const sprite = moonSprite(skin, this.t);
    const drawMoon = (p: { x: number; y: number; z: number; a: number }) => {
      const s = r * 0.42 * (0.8 + 0.25 * (p.z + 1) / 2) * MOON_SPRITE_SCALE;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a + Math.PI / 2 - tilt);
      ctx.globalAlpha = this.locked ? 0.5 : 1;
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    };
    // back moons
    for (const p of positions) if (p.z < 0) drawMoon(p);
    ctx.restore();

    // body
    ctx.save();
    const sq = 1 + Math.sin(this.t * 3) * 0.025 + this.bounce * Math.sin(this.bounce * 14) * 0.12;
    ctx.translate(cx, cy + Math.sin(this.t * 1.6) * 3);
    ctx.scale(sq, 1 / sq);
    if (this.locked) ctx.filter = 'grayscale(0.85) brightness(0.65)';
    drawCoreBody(ctx, r, skin, { look: this.look, blink: this.blink, mood: this.bounce > 0.5 ? 'happy' : 'idle', chomp: 0 }, this.t, 1);
    ctx.filter = 'none';
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    for (const p of positions) if (p.z >= 0) drawMoon(p);
    ctx.restore();

    if (this.locked) {
      // padlock
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#FFF4E0';
      ctx.strokeStyle = '#120B1F';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, -8, 11, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-16, -8, 32, 26, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#120B1F';
      ctx.beginPath();
      ctx.arc(0, 3, 4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}
