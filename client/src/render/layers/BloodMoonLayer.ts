import { WRAITH_RADIUS } from '../../../../shared/constants';
import { TAU, clamp, damp } from '../../../../shared/math';
import type { Session } from '../../game/session';
import { drawSunstone, drawWraith, glowSprite } from '../art';
import type { LayerHost, RenderOptions, ViewRect } from './host';

/** Blood Moon: red sky + rising moon, sunstones, wraiths, the hunted-heartbeat overlay. */
export class BloodMoonLayer {
  /** 0..1 event blend (smoothed); other layers read it (spooky faces, darkness). */
  horror = 0;
  /** 0..1 how close the nearest hunting wraith is to the player */
  fear = 0;
  private bolt = 0;
  private wraithSeen = new Map<number, number>();

  constructor(private host: LayerHost) {}

  update(session: Session, dt: number): void {
    const bl = session.blood;
    const target = bl.phase === 'dark' ? Math.min(1, bl.in / 3) : bl.phase === 'warn' ? 0.5 * clamp(1 - bl.in / 6, 0, 1) : 0;
    this.horror += (target - this.horror) * damp(bl.phase === 'dark' ? 3 : 1.2, dt);
    if (this.horror < 0.002) this.horror = 0;
    if (bl.phase === 'dark' && Math.random() < dt * 0.22) this.bolt = 1;
    this.bolt = Math.max(0, this.bolt - dt * 5);
  }

  drawSky(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.host;
    const k = this.horror;
    ctx.fillStyle = `rgba(60,0,12,${0.6 * k})`;
    ctx.fillRect(0, 0, w, h);
    // the moon rises as the event takes hold
    const R = Math.min(w, h) * 0.34;
    const x = w * 0.7 - this.host.cam.x * 0.01;
    const y = h * 0.28 + (1 - k) * h * 0.7 - this.host.cam.y * 0.01;
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

  drawSunstones(ctx: CanvasRenderingContext2D, session: Session, view: ViewRect, px: number): void {
    const t = this.host.time;
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

  drawWraiths(ctx: CanvasRenderingContext2D, session: Session, view: ViewRect, px: number, opts: RenderOptions, dt: number): void {
    const t = this.host.time;
    const me = opts.meId !== null ? session.cores.get(opts.meId) : undefined;
    const alive = new Set<number>();
    for (const wr of session.wraiths) {
      alive.add(wr.id);
      if (!this.wraithSeen.has(wr.id)) {
        this.wraithSeen.set(wr.id, t);
        if (this.host.isVisible(wr.x, wr.y, 50)) this.host.effects.ring(wr.x, wr.y + WRAITH_RADIUS, '#8E0F24', 10, 90, 0.6, 8);
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
      if (this.host.quality === 'high' && Math.random() < dt * 30) {
        this.host.effects.dot(wr.x + (Math.random() - 0.5) * 30, wr.y + WRAITH_RADIUS * 0.6, -wr.vx * 0.2, -wr.vy * 0.2 - 20, wr.scared ? 'rgba(170,220,255,0.5)' : 'rgba(60,0,20,0.7)', 9, 0.7);
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

  /** Screen space: heartbeat vignette while hunted, lightning flicker during the dark. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.host;
    // heartbeat vignette when something is hunting you
    if (this.fear > 0.02) {
      const beat = Math.pow(Math.max(0, Math.sin(this.host.time * (5 + this.fear * 6))), 6);
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
  }
}
