import { TAU, clamp } from '../../../../shared/math';
import { SNARE_RADIUS } from '../../../../shared/powers';
import type { Session, ViewCore } from '../../game/session';
import { INK, glowSprite } from '../art';
import type { LayerHost, RenderOptions } from './host';

/** Powers: wormholes, snares, blackout zones, and per-core power decorations. */
export class PowersLayer {
  private bubbles = new Map<number, number>();

  constructor(private host: LayerHost) {}

  bubble(id: number, secs: number): void {
    this.bubbles.set(id, this.host.time + secs);
  }

  /** Wormholes, snares and blackout zones (world space). */
  drawWorld(ctx: CanvasRenderingContext2D, session: Session, px: number, opts: RenderOptions): void {
    const t = this.host.time;
    const me = opts.meId !== null ? session.cores.get(opts.meId) : undefined;
    for (const wh of session.worms) {
      if (!this.host.isVisible(wh.x, wh.y, 80)) continue;
      const mine = wh.owner === opts.meId;
      const R = 34;
      ctx.drawImage(glowSprite('rgba(124,92,255,0.6)'), wh.x - R * 2.5, wh.y - R * 2.5, R * 5, R * 5);
      ctx.save();
      ctx.translate(wh.x, wh.y);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(t * (2 + i * 0.6) * (i % 2 ? -1 : 1) * 0.6);
        ctx.strokeStyle = i % 2 ? '#62F2FF' : '#7C5CFF';
        ctx.lineWidth = Math.max(4 - i * 0.6, 1.5 * px);
        ctx.beginPath();
        ctx.arc(0, 0, R * (1 - i * 0.2), 0, Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.fillStyle = '#0A0613';
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.32, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (mine && me) {
        ctx.strokeStyle = 'rgba(124,92,255,0.45)';
        ctx.lineWidth = Math.max(2, 1.5 * px);
        ctx.setLineDash([10, 12]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(wh.x, wh.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (const tr of session.traps) {
      const mine = tr.owner === opts.meId;
      let a = mine ? 0.9 : 0;
      if (!mine && me) {
        // others only notice a faint shimmer when they're right on top of it
        const d = Math.hypot(me.x - tr.x, me.y - tr.y);
        a = clamp(1 - d / 260, 0, 1) * 0.28 * (0.6 + 0.4 * Math.sin(t * 9 + tr.id));
      }
      if (a <= 0.01 || !this.host.isVisible(tr.x, tr.y, 40)) continue;
      ctx.save();
      ctx.translate(tr.x, tr.y);
      ctx.rotate(t * 0.8);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#5EE6B0';
      ctx.lineWidth = Math.max(2.5, 1.5 * px);
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * SNARE_RADIUS * 1.3, Math.sin(ang) * SNARE_RADIUS * 1.3);
        ctx.stroke();
      }
      for (const rr of [0.5, 0.95]) {
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const ang = (i / 6) * TAU;
          ctx.lineTo(Math.cos(ang) * SNARE_RADIUS * rr, Math.sin(ang) * SNARE_RADIUS * rr);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const b of session.blackouts) {
      if (b.owner !== opts.meId) continue;
      ctx.strokeStyle = 'rgba(160,120,255,0.5)';
      ctx.lineWidth = Math.max(6, 3 * px);
      ctx.setLineDash([24, 18]);
      ctx.lineDashOffset = t * 30;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(40,20,90,0.12)';
      ctx.fill();
    }
  }

  /**
   * Per-core power decorations drawn after the body: bubble shield, snare web, ghost ring
   * on your own phantoms, mask while disguised. Returns true if a bubble was drawn.
   */
  drawCoreDecor(ctx: CanvasRenderingContext2D, c: ViewCore, r: number, px: number, opts: RenderOptions, myDecoy: boolean): boolean {
    const t = this.host.time;
    let bubbled = false;
    const bub = (this.bubbles.get(c.id) ?? 0) - t;
    if (bub > 0) {
      const br = c.r + 18 + Math.sin(t * 7) * 3;
      ctx.drawImage(glowSprite('rgba(122,211,255,0.35)'), c.x - br * 1.6, c.y - br * 1.6, br * 3.2, br * 3.2);
      ctx.strokeStyle = `rgba(190,235,255,${bub < 0.6 ? 0.4 + 0.4 * Math.sin(t * 40) : 0.85})`;
      ctx.lineWidth = Math.max(3, 2 * px);
      ctx.beginPath();
      ctx.arc(c.x, c.y, br, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(c.x - br * 0.45, c.y - br * 0.5, br * 0.18, br * 0.09, -0.7, 0, TAU);
      ctx.fill();
      bubbled = true;
    }
    if (c.snared > 0) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.strokeStyle = 'rgba(94,230,176,0.9)';
      ctx.lineWidth = Math.max(2, 1.2 * px);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + c.id;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
        ctx.lineTo(Math.cos(a + 2.6) * r * 1.25, Math.sin(a + 2.6) * r * 1.25);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (myDecoy) {
      ctx.strokeStyle = 'rgba(196,155,255,0.8)';
      ctx.lineWidth = Math.max(2, 1.5 * px);
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (c.id === opts.meId && opts.disguised) {
      // a little theatre mask so you remember you're in disguise
      const mx = c.x + r * 0.9;
      const my = c.y - r * 0.95;
      const ms = Math.max(10 * px, r * 0.35);
      ctx.fillStyle = '#FF9F43';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2 * px, ms * 0.15);
      ctx.beginPath();
      ctx.moveTo(mx - ms, my - ms * 0.5);
      ctx.quadraticCurveTo(mx, my - ms * 0.2, mx + ms, my - ms * 0.5);
      ctx.quadraticCurveTo(mx + ms * 0.9, my + ms, mx, my + ms);
      ctx.quadraticCurveTo(mx - ms * 0.9, my + ms, mx - ms, my - ms * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(mx - ms * 0.38, my, ms * 0.2, ms * 0.12, 0.3, 0, TAU);
      ctx.ellipse(mx + ms * 0.38, my, ms * 0.2, ms * 0.12, -0.3, 0, TAU);
      ctx.fill();
    }
    return bubbled;
  }
}
