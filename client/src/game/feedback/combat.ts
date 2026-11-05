import { coreRadius } from '../../../../shared/constants';
import { skinById } from '../../../../shared/skins';
import { audio } from '../../audio/Audio';
import { haptic } from '../../platform/haptics';
import { killCam, pick } from './context';
import type { Handlers } from './context';

const STREAK_CALLS = ['', 'BITE!', 'DOUBLE BITE!', 'TRIPLE BITE!', 'RAMPAGE!', 'UNSTOPPABLE!', 'MOON LORD!'];

/** Bites, moon clashes, stolen moons, starfall. */
export const combatFeedback: Handlers = {
  kill(e, ctx) {
    const { renderer: rend, meId, playing, round } = ctx;
    const near = ctx.nearness(e.x, e.y);
    const byMe = e.killer !== null && e.killer === meId;
    rend.killAt(e.x, e.y, e.vskin, coreRadius(e.vmass), near > 0.4, byMe);
    if (ctx.inMatch) ctx.ui.feed(e.killer !== null ? e.kname : null, e.vname, byMe, e.victim === meId, e.cause);

    if (byMe && playing) {
      if (ctx.session.blood.phase === 'dark') {
        killCam(ctx, { full: false, attacker: { kind: 'core', skin: ctx.profile.data.skin }, victim: { kind: 'core', skin: e.vskin, spooky: true }, title: pick(['FEAST', 'NO MERCY', 'CRUNCH', 'SAVAGE']), sub: e.vname });
      }
      if (performance.now() - round.disguiseOffAt < 120) {
        round.tricks++;
        rend.floatText(e.x, e.y - 60, 'MIMIC BITE!', '#FF9F43', 26);
      }
      round.kills++;
      round.streak = e.streak;
      const call = STREAK_CALLS[Math.min(e.streak, STREAK_CALLS.length - 1)];
      ctx.ui.announce(call, `${e.vname} · +${Math.round(e.vmass * 0.75)} dust`, e.streak >= 3 ? 'pink' : 'yellow');
      audio.bite(e.streak);
      haptic('heavy');
      if (ctx.session.kind === 'local') ctx.hitstop(0.09);
      rend.coreHappy(meId!);
      rend.floatText(e.x, e.y - 30, 'CHOMP!', '#FFE45C', 34);
    } else if (playing) {
      audio.remoteKill(near);
    }

    if (e.victim === meId && meId !== null) {
      const killerSkin = e.killer !== null ? ctx.session.cores.get(e.killer)?.skin ?? null : null;
      ctx.died(e.cause, e.kname, killerSkin);
    }
  },

  clash(e, ctx) {
    const ca = ctx.session.cores.get(e.a);
    const cb = ctx.session.cores.get(e.b);
    const mine = e.a === ctx.meId || e.b === ctx.meId;
    ctx.renderer.clashAt(e.x, e.y, ca ? skinById(ca.skin).moon : '#FFFFFF', cb ? skinById(cb.skin).moon : '#FFFFFF', mine);
    if (!ctx.inMenu) audio.clash(mine ? 1 : ctx.nearness(e.x, e.y) * 0.5);
    if (mine && ctx.playing) {
      ctx.round.moonsBroken++;
      haptic('medium');
    }
  },

  capture(e, ctx) {
    if (e.core === ctx.meId && ctx.playing) {
      ctx.round.captures++;
      audio.capture();
      haptic('light');
      ctx.renderer.floatText(e.x, e.y - 20, '+1 MOON', '#7CF5C8', 22);
    }
    ctx.renderer.effects.ring(e.x, e.y, '#7CF5C8', 6, 50, 0.35, 4);
  },

  starfallWarn(_e, ctx) {
    if (ctx.playing) audio.starfallWarn();
  },

  starfall(e, ctx) {
    const near = ctx.nearness(e.x, e.y);
    if (ctx.playing) audio.starfallImpact(near);
    if (near > 0.3) ctx.renderer.addShake(0.35 * near);
    ctx.renderer.effects.ring(e.x, e.y, '#FFE45C', e.r * 0.3, e.r * 1.4, 0.8, 12);
  },
};
