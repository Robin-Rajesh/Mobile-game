import { TAU } from '../../../shared/math';
import { INK } from './art';

type Kind = 'spark' | 'chunk' | 'ring' | 'dot' | 'text' | 'suck' | 'meteor' | 'shard';

export interface Particle {
  kind: Kind;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  text: string;
  /** suck target */
  tx: number;
  ty: number;
  drag: number;
}

/**
 * Pooled particle system (no per-frame allocations). All coordinates are world space.
 */
export class Effects {
  private pool: Particle[] = [];
  private count = 0;
  maxParticles = 900;

  private make(kind: Kind): Particle | null {
    let p: Particle | undefined;
    if (this.count < this.pool.length) {
      p = this.pool[this.count];
    } else if (this.pool.length < this.maxParticles) {
      p = { kind, alive: true, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, rot: 0, vr: 0, color: '#fff', text: '', tx: 0, ty: 0, drag: 0 };
      this.pool.push(p);
    } else {
      return null;
    }
    this.count++;
    p.kind = kind;
    p.alive = true;
    p.vx = p.vy = p.rot = p.vr = p.drag = 0;
    p.text = '';
    return p;
  }

  spark(x: number, y: number, color: string, n: number, speed: number, life = 0.4): void {
    for (let i = 0; i < n; i++) {
      const p = this.make('spark');
      if (!p) return;
      const a = Math.random() * TAU;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.size = 2 + Math.random() * 2.5;
      p.color = color;
      p.drag = 3;
    }
  }

  chunks(x: number, y: number, color: string, n: number, speed: number, size: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.make('chunk');
      if (!p) return;
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random());
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = 0.6 + Math.random() * 0.6;
      p.size = size * (0.5 + Math.random() * 0.8);
      p.rot = Math.random() * TAU;
      p.vr = (Math.random() - 0.5) * 14;
      p.color = color;
      p.drag = 2.5;
    }
  }

  ring(x: number, y: number, color: string, from: number, to: number, life: number, width = 4): void {
    const p = this.make('ring');
    if (!p) return;
    p.x = x;
    p.y = y;
    p.size = from;
    p.tx = to;
    p.ty = width;
    p.life = p.max = life;
    p.color = color;
  }

  dot(x: number, y: number, vx: number, vy: number, color: string, size: number, life: number): void {
    const p = this.make('dot');
    if (!p) return;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.life = p.max = life;
    p.color = color;
    p.drag = 1.5;
  }

  text(x: number, y: number, text: string, color: string, size: number, life = 1.1): void {
    const p = this.make('text');
    if (!p) return;
    p.x = x;
    p.y = y;
    p.vy = -60;
    p.text = text;
    p.color = color;
    p.size = size;
    p.life = p.max = life;
    p.drag = 2;
  }

  suck(x: number, y: number, tx: number, ty: number, color: string, size: number): void {
    const p = this.make('suck');
    if (!p) return;
    p.x = x;
    p.y = y;
    p.tx = tx;
    p.ty = ty;
    p.color = color;
    p.size = size;
    p.life = p.max = 0.14;
  }

  meteor(tx: number, ty: number, color: string): void {
    const p = this.make('meteor');
    if (!p) return;
    const len = 500 + Math.random() * 300;
    p.x = tx - len * 0.7;
    p.y = ty - len;
    p.tx = tx;
    p.ty = ty;
    p.color = color;
    p.size = 4 + Math.random() * 3;
    p.life = p.max = 0.28 + Math.random() * 0.12;
  }

  shards(x: number, y: number, color: string, n: number, speed: number, size: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.make('shard');
      if (!p) return;
      const a = (i / n) * TAU + Math.random() * 0.4;
      const s = speed * (0.6 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = 0.5 + Math.random() * 0.4;
      p.size = size * (0.6 + Math.random() * 0.6);
      p.rot = a;
      p.vr = (Math.random() - 0.5) * 10;
      p.color = color;
      p.drag = 4;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        // swap-remove
        this.count--;
        this.pool[i] = this.pool[this.count];
        this.pool[this.count] = p;
        i--;
        continue;
      }
      if (p.kind === 'suck' || p.kind === 'meteor') continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  /** ctx is in world space; px = world units per screen pixel. */
  draw(ctx: CanvasRenderingContext2D, px: number, textFont: string): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      const t = p.life / p.max; // 1 → 0
      switch (p.kind) {
        case 'spark': {
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = t;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
          ctx.stroke();
          break;
        }
        case 'chunk':
        case 'shard': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.min(1, t * 2);
          const s = p.size;
          ctx.fillStyle = p.color;
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(1.5 * px, s * 0.22);
          ctx.beginPath();
          if (p.kind === 'shard') {
            ctx.moveTo(s, 0);
            ctx.lineTo(-s * 0.6, s * 0.45);
            ctx.lineTo(-s * 0.4, -s * 0.5);
          } else {
            ctx.moveTo(s * 0.9, -s * 0.2);
            ctx.lineTo(s * 0.1, s * 0.8);
            ctx.lineTo(-s * 0.8, s * 0.3);
            ctx.lineTo(-s * 0.4, -s * 0.7);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'ring': {
          const e = 1 - t;
          const rr = p.size + (p.tx - p.size) * (1 - (1 - e) * (1 - e));
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = t * 0.9;
          ctx.lineWidth = p.ty * t + px;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, TAU);
          ctx.stroke();
          break;
        }
        case 'dot': {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = t;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, TAU);
          ctx.fill();
          break;
        }
        case 'suck': {
          const e = 1 - t;
          const x = p.x + (p.tx - p.x) * e * e;
          const y = p.y + (p.ty - p.y) * e * e;
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.5 + t * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, p.size * (0.3 + t * 0.7), 0, TAU);
          ctx.fill();
          break;
        }
        case 'meteor': {
          const e = 1 - t;
          const x = p.x + (p.tx - p.x) * e;
          const y = p.y + (p.ty - p.y) * e;
          const tailX = x - (p.tx - p.x) * 0.25;
          const tailY = y - (p.ty - p.y) * 0.25;
          const g = ctx.createLinearGradient(tailX, tailY, x, y);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(1, p.color);
          ctx.strokeStyle = g;
          ctx.globalAlpha = 1;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, p.size * 0.8, 0, TAU);
          ctx.fill();
          break;
        }
        case 'text': {
          const pop = t > 0.85 ? 1 + (t - 0.85) * 3 : 1;
          const size = p.size * pop;
          ctx.globalAlpha = Math.min(1, t * 3);
          ctx.font = `${size}px ${textFont}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = size * 0.22;
          ctx.strokeStyle = INK;
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.count = 0;
  }
}
