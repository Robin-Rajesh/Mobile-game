import { BUBBLE_SECS } from '../../../../shared/powers';
import { audio } from '../../audio/Audio';
import { haptic } from '../../platform/haptics';
import type { Handlers } from './context';

/** Role-style powers: cooldown HUD sync plus the "you got tricked / you tricked them" beats. */
export const powerFeedback: Handlers = {
  power(e, ctx) {
    if (e.kind === 'bubble') ctx.renderer.powers.bubble(e.core, BUBBLE_SECS);
    if (e.core === ctx.meId) {
      const pw = ctx.round.power;
      if (e.phase === 'armed') {
        pw.armed = true;
        const me = ctx.me();
        if (me) ctx.renderer.floatText(me.x, me.y - 50, 'PORTAL SET', '#B9A6FF', 20);
      } else {
        pw.armed = false;
        pw.cdUntil = performance.now() + e.cd * 1000;
        pw.cdTotal = Math.max(0.1, e.cd);
      }
      if (e.phase !== 'expire' && ctx.playing) {
        audio.power(e.kind);
        haptic('light');
      }
      return;
    }
    const c = ctx.session.cores.get(e.core);
    if (ctx.playing && c && e.kind !== 'blackout' && ctx.nearness(c.x, c.y) > 0.5) audio.power(e.kind);
  },

  warp(e, ctx) {
    const fx = ctx.renderer.effects;
    fx.ring(e.fx, e.fy, '#7C5CFF', 90, 4, 0.35, 8);
    fx.ring(e.x, e.y, '#62F2FF', 6, 120, 0.45, 8);
    fx.spark(e.x, e.y, '#B9A6FF', 16, 500, 0.45);
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      fx.dot(e.fx + (e.x - e.fx) * k, e.fy + (e.y - e.fy) * k, 0, 0, 'rgba(124,92,255,0.7)', 8, 0.35 + k * 0.2);
    }
    if (ctx.playing) audio.warp(Math.max(ctx.nearness(e.x, e.y), ctx.nearness(e.fx, e.fy)));
    if (e.core === ctx.meId) {
      haptic('medium');
      ctx.renderer.addShake(0.2);
    }
  },

  decoy(e, ctx) {
    if (e.core !== ctx.meId) return;
    ctx.round.myDecoys.add(e.decoy);
    const me = ctx.me();
    if (me) ctx.renderer.floatText(me.x, me.y - 50, 'PHANTOM!', '#C49BFF', 22);
  },

  decoyPop(e, ctx) {
    ctx.round.myDecoys.delete(e.id);
    const fx = ctx.renderer.effects;
    fx.ring(e.x, e.y, '#C49BFF', 10, 90, 0.4, 6);
    for (let i = 0; i < 10; i++) fx.dot(e.x, e.y, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, 'rgba(196,155,255,0.6)', 12, 0.6);
    if (!ctx.playing) return;
    if (e.owner === ctx.meId && e.by !== null) {
      ctx.round.tricks++;
      ctx.ui.announce('FOOLED!', `${e.byName} bit your phantom`, 'mint');
      audio.fooled();
      haptic('success');
    } else if (e.by === ctx.meId) {
      ctx.renderer.floatText(e.x, e.y - 30, 'DECOY!', '#FF5C8A', 26);
      audio.denied();
    }
  },

  snared(e, ctx) {
    ctx.renderer.effects.ring(e.x, e.y, '#5EE6B0', 8, 70, 0.4, 6);
    ctx.renderer.effects.spark(e.x, e.y, '#5EE6B0', 10, 300, 0.4);
    if (!ctx.playing) return;
    if (e.core === ctx.meId) {
      ctx.ui.announce('SNARED!', 'struggle free…', 'pink');
      audio.snareHit(true);
      haptic('heavy');
    } else if (e.by === ctx.meId) {
      ctx.round.tricks++;
      ctx.renderer.floatText(e.x, e.y - 40, 'GOTCHA!', '#5EE6B0', 28);
      audio.snareHit(false);
      haptic('success');
    }
  },

  disguise(e, ctx) {
    const c = ctx.session.cores.get(e.core);
    if (c) for (let i = 0; i < 12; i++) ctx.renderer.effects.dot(c.x, c.y, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 'rgba(255,159,67,0.55)', c.r * 0.5, 0.7);
    if (e.core !== ctx.meId) return;
    ctx.round.disguised = e.on;
    if (e.on) ctx.ui.announce('MIMIC', `you look like ${e.name}`, 'yellow');
    else ctx.round.disguiseOffAt = performance.now();
  },
};
