import { TAU } from '../../../shared/math';
import { skinById } from '../../../shared/skins';
import type { Session } from '../game/session';
import { drawStar } from '../render/art';

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private t = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(session: Session, meId: number | null, crownId: number | null, dt: number): void {
    this.t += dt;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = c.clientWidth;
    if (!size) return;
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const R = size / 2 - 3;
    const k = R / session.arenaRadius;
    ctx.translate(size / 2, size / 2);

    ctx.fillStyle = 'rgba(18,11,31,0.66)';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,77,109,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.5, 0, TAU);
    ctx.moveTo(-R, 0);
    ctx.lineTo(R, 0);
    ctx.moveTo(0, -R);
    ctx.lineTo(0, R);
    ctx.stroke();

    const sf = session.starfall;
    if (sf) {
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 8);
      ctx.fillStyle = `rgba(255,228,92,${0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(sf.x * k, sf.y * k, Math.max(6, sf.r * k), 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#FFE45C';
      drawStar(ctx, sf.x * k, sf.y * k, 6, 2.2, this.t * 2);
    }

    for (const st of session.sunstones) {
      ctx.fillStyle = '#FFD84D';
      drawStar(ctx, st.x * k, st.y * k, 4.5, 1.8, this.t * 3, 6);
    }
    const meCore = meId !== null ? session.cores.get(meId) : undefined;
    for (const wr of session.wraiths) {
      // you only sense the ones close to you
      if (meCore && Math.hypot(wr.x - meCore.x, wr.y - meCore.y) > 1300) continue;
      ctx.fillStyle = wr.scared ? '#A8D8FF' : `rgba(255,43,74,${0.6 + 0.4 * Math.sin(this.t * 10 + wr.id)})`;
      ctx.beginPath();
      ctx.arc(wr.x * k, wr.y * k, 2.6, 0, TAU);
      ctx.fill();
    }

    let me: { x: number; y: number } | null = null;
    for (const core of session.cores.values()) {
      if (core.id === meId) {
        me = core;
        continue;
      }
      const big = core.mass > 600;
      const r = Math.min(5, 1.6 + Math.sqrt(core.mass) * 0.06);
      ctx.fillStyle = big ? skinById(core.skin).body : 'rgba(255,244,224,0.45)';
      ctx.beginPath();
      ctx.arc(core.x * k, core.y * k, r, 0, TAU);
      ctx.fill();
      if (core.id === crownId) {
        ctx.fillStyle = '#FFD84D';
        drawStar(ctx, core.x * k, core.y * k - 7, 4.5, 2, -Math.PI / 2, 5);
      }
    }
    if (me) {
      ctx.fillStyle = '#FFE45C';
      ctx.strokeStyle = '#120B1F';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(me.x * k, me.y * k, 4.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,228,92,${0.5 + 0.5 * Math.sin(this.t * 5)})`;
      ctx.beginPath();
      ctx.arc(me.x * k, me.y * k, 8, 0, TAU);
      ctx.stroke();
    }
  }
}
