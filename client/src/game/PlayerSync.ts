import { SURGE_MIN_MASS, SURGE_ORBIT_MULT } from '../../../shared/constants';
import { clamp } from '../../../shared/math';
import { audio } from '../audio/Audio';
import type { Input } from '../input/Input';
import { haptic } from '../platform/haptics';
import type { Renderer } from '../render/Renderer';
import type { UI } from '../ui/UI';
import type { Round } from './round';
import type { Session, ViewCore } from './session';

/**
 * Feedback that is derived from the player's *state* every frame (rather than from discrete
 * sim events): moon regen chimes, surge audio, rim warning, music tension, power button,
 * blackout blindness, wraith heartbeat, best rank.
 */
export class PlayerSync {
  private rankTimer = 0;

  constructor(
    private renderer: Renderer,
    private ui: UI,
    private input: Input,
  ) {}

  update(session: Session, me: ViewCore, round: Round, dt: number): void {
    const rend = this.renderer;
    round.peak = Math.max(round.peak, me.mass);

    if (round.lastMoons >= 0 && me.moons.length > round.lastMoons) {
      audio.moonGained();
      haptic('light');
      rend.moonGained(me);
    }
    round.lastMoons = me.moons.length;

    this.input.setSurgeAvailable(me.mass > SURGE_MIN_MASS);
    this.input.setSurgeMeter(clamp((me.mass - SURGE_MIN_MASS) / 200, 0.08, 1));
    if (me.surging !== round.wasSurging) {
      audio.surge(me.surging);
      if (me.surging) haptic('tick');
      round.wasSurging = me.surging;
    }

    const toRim = session.arenaRadius - Math.hypot(me.x, me.y) - me.r;
    rend.setRimDanger(clamp(1 - toRim / 380, 0, 1));

    let danger = me.surging ? 1 : 0;
    for (const c of session.cores.values()) {
      if (c === me) continue;
      const reach = c.orbitR * SURGE_ORBIT_MULT + me.r + 120;
      if ((c.x - me.x) ** 2 + (c.y - me.y) ** 2 < reach * reach) danger = 1;
    }
    audio.setIntensity(rend.blood.horror > 0.6 ? 2 : 1 + danger);

    const pw = round.power;
    const left = Math.max(0, pw.cdUntil - performance.now()) / 1000;
    this.input.setPowerState(pw.armed ? 0 : left / Math.max(0.1, pw.cdTotal), pw.armed);

    let blind = false;
    for (const b of session.blackouts) {
      if (b.owner !== me.id && (me.x - b.x) ** 2 + (me.y - b.y) ** 2 < b.r * b.r) blind = true;
    }
    rend.darkness.blind += ((blind ? 1 : 0) - rend.darkness.blind) * Math.min(1, dt * (blind ? 6 : 2));
    if (blind && !round.wasBlind) {
      this.ui.announce('BLACKOUT!', 'someone cut your lights', 'pink');
      audio.power('blackout');
      haptic('medium');
    }
    round.wasBlind = blind;

    this.rankTimer -= dt;
    if (this.rankTimer <= 0) {
      this.rankTimer = 0.5;
      round.bestRank = Math.min(round.bestRank, session.rankOf(me.id));
    }

    let nearest = Infinity;
    for (const wr of session.wraiths) if (!wr.scared) nearest = Math.min(nearest, Math.hypot(wr.x - me.x, wr.y - me.y));
    const fear = me.radiant > 0 ? 0 : clamp(1 - (nearest - 80) / 650, 0, 1);
    rend.blood.fear += (fear - rend.blood.fear) * Math.min(1, dt * 4);
    round.heartbeat -= dt;
    if (rend.blood.fear > 0.5 && round.heartbeat <= 0) {
      round.heartbeat = 0.9 - rend.blood.fear * 0.45;
      haptic('light');
    }
  }

  /** Let lingering effects fade once the player is gone. */
  relax(dt: number): void {
    this.renderer.darkness.blind = Math.max(0, this.renderer.darkness.blind - dt * 2);
    this.renderer.blood.fear = Math.max(0, this.renderer.blood.fear - dt);
  }
}
