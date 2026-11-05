import type { Renderer } from '../render/Renderer';
import type { Session, ViewCore } from './session';

/**
 * Decides where the camera looks: on you while alive, drifting between leaders on the
 * menu (attract mode), and slowly pushing in on the spot where you died.
 */
export class CameraDirector {
  private focus = { x: 0, y: 0, orbitR: 80 };
  private attractId: number | null = null;
  private attractTimer = 0;

  constructor(private renderer: Renderer) {}

  update(session: Session, me: ViewCore | undefined, mode: 'follow' | 'attract' | 'linger', dt: number): void {
    const r = this.renderer;
    if (me && mode === 'follow') {
      this.focus = { x: me.x, y: me.y, orbitR: me.orbitR };
      r.follow(me.x, me.y, me.orbitR, me.vx, me.vy, dt);
      return;
    }
    if (mode === 'attract') {
      this.attractTimer -= dt;
      let target = this.attractId !== null ? session.cores.get(this.attractId) : undefined;
      if (!target || this.attractTimer <= 0) {
        const ranked = [...session.cores.values()].sort((a, b) => b.mass - a.mass).slice(0, 6);
        target = ranked[Math.floor(Math.random() * ranked.length)];
        this.attractId = target?.id ?? null;
        this.attractTimer = 9;
      }
      if (target) {
        const k = Math.min(1, dt * 0.8);
        this.focus.x += (target.x - this.focus.x) * k;
        this.focus.y += (target.y - this.focus.y) * k;
        this.focus.orbitR = target.orbitR * 1.6 + 80;
      }
    } else {
      this.focus.orbitR = Math.max(40, this.focus.orbitR - dt * 30);
    }
    r.follow(this.focus.x, this.focus.y, this.focus.orbitR, 0, 0, dt);
  }
}
