import { WRAITH_RADIUS } from '../../../../shared/constants';
import { clamp } from '../../../../shared/math';
import type { Session } from '../../game/session';
import { drawStar, drawWraithEyes, glowSprite } from '../art';
import type { LayerHost, RenderOptions } from './host';

/**
 * Flashlight darkness, shared by the Blood Moon and the Blackout power. Light sources cut
 * holes in an offscreen mask; wraith eyes and sunstone glints are drawn above it.
 */
export class DarknessLayer {
  /** 0..1 caught in someone's Blackout */
  blind = 0;
  private dark: HTMLCanvasElement = document.createElement('canvas');

  constructor(private host: LayerHost) {}

  active(horror: number): boolean {
    return horror > 0.05 || this.blind > 0.02;
  }

  /** Flashlight darkness: only light sources cut through. Eyes glow on top. */
  draw(ctx: CanvasRenderingContext2D, session: Session, opts: RenderOptions, horror: number): void {
    const level = Math.max(clamp((horror - 0.25) / 0.75, 0, 1), this.blind);
    if (level <= 0) return;
    const blindMix = this.blind > 0 ? this.blind : 0;
    const { w, h } = this.host;
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
    g.fillStyle = blindMix > 0.5 ? `rgba(10,2,26,${0.97 * level})` : `rgba(4,0,6,${0.95 * level})`;
    g.fillRect(0, 0, dw, dh);
    g.globalCompositeOperation = 'destination-out';
    const light = glowSprite('rgba(255,255,255,1)');
    const z = this.host.cam.zoom;
    const hole = (x: number, y: number, r: number) => {
      const sp = this.host.worldToScreen(x, y);
      const rr = r * z * scale * 2;
      g.drawImage(light, sp.x * scale - rr / 2, sp.y * scale - rr / 2, rr, rr);
    };
    const me = opts.meId !== null ? session.cores.get(opts.meId) : undefined;
    if (me) {
      const flick = 1 + Math.sin(this.host.time * 17) * 0.02 + (Math.random() - 0.5) * 0.03;
      const full = (me.orbitR * 1.35 + 240) * (me.radiant > 0 ? 1.8 : 1);
      const r = (full + (me.orbitR + 90 - full) * blindMix) * flick;
      hole(me.x, me.y, r);
      hole(me.x, me.y, r * 0.6);
    }
    for (const s of session.sunstones) hole(s.x, s.y, 170);
    for (const c2 of session.cores.values()) if (c2.radiant > 0 && c2 !== me) hole(c2.x, c2.y, 300);
    ctx.drawImage(c, 0, 0, w, h);

    // eyes and sunstone glints pierce the dark
    this.host.applyWorldTransform(ctx);
    const t = this.host.time;
    for (const wr of session.wraiths) {
      if (!this.host.isVisible(wr.x, wr.y, 40)) continue;
      ctx.save();
      ctx.translate(wr.x, wr.y + Math.sin(t * 4 + wr.id) * 4);
      ctx.globalAlpha = level;
      drawWraithEyes(ctx, WRAITH_RADIUS, { dir: Math.atan2(wr.vy, wr.vx), scared: wr.scared, maw: 0, rise: 1, t: t + wr.id, eyes: true });
      ctx.restore();
    }
    for (const s of session.sunstones) {
      if (!this.host.isVisible(s.x, s.y, 40)) continue;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 6 + s.id);
      ctx.fillStyle = '#FFE45C';
      drawStar(ctx, s.x, s.y, 14, 4, t);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(this.host.dpr, 0, 0, this.host.dpr, 0, 0);
  }
}
