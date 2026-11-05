import { audio } from '../../audio/Audio';
import { haptic } from '../../platform/haptics';
import { killCam, pick } from './context';
import type { Handlers } from './context';

/** The Blood Moon horror event: phases, wraiths, wards, banishing, sunstones. */
export const bloodMoonFeedback: Handlers = {
  bloodWarn(_e, ctx) {
    if (!ctx.playing) return;
    audio.bloodToll();
    ctx.ui.announce('BLOOD MOON', 'something is waking up…', 'pink');
    haptic('medium');
  },

  bloodStart(_e, ctx) {
    ctx.renderer.addShake(0.5);
    if (!ctx.playing) return;
    audio.bloodStart();
    haptic('heavy');
    ctx.ui.announce('THEY’RE HUNTING', 'find a ☀ sunstone', 'pink');
    if (!ctx.profile.data.bloodSeen) {
      ctx.profile.data.bloodSeen = true;
      ctx.profile.save();
      ctx.round.bloodHintUntil = performance.now() + 7000;
    }
  },

  bloodEnd(e, ctx) {
    for (const [x, y] of e.wraiths) {
      ctx.renderer.effects.ring(x, y, '#FFE6A8', 10, 120, 0.8, 6);
      ctx.renderer.effects.spark(x, y, '#A8D8FF', 10, 300, 0.6);
    }
    if (ctx.playing && ctx.meId !== null && e.survivors.includes(ctx.meId)) {
      ctx.round.dawns++;
      audio.dawn();
      haptic('success');
      ctx.ui.announce('DAWN', 'you survived · +40 mass', 'mint');
    }
  },

  wraithSpawn(e, ctx) {
    if (ctx.playing && e.target === ctx.meId) {
      audio.screech(ctx.nearness(e.x, e.y));
      haptic('medium');
    }
  },

  ward(e, ctx) {
    ctx.renderer.effects.shards(e.x, e.y, '#3A0711', 6, 240, 7);
    ctx.renderer.effects.spark(e.x, e.y, '#FF2B4A', 8, 400, 0.3);
    if (e.core === ctx.meId && ctx.playing) {
      audio.ward();
      haptic('medium');
      ctx.renderer.addShake(0.2);
    }
  },

  banish(e, ctx) {
    const rend = ctx.renderer;
    rend.effects.ring(e.x, e.y, '#FFE45C', 10, 180, 0.6, 10);
    rend.effects.spark(e.x, e.y, '#FFFFFF', 22, 700, 0.5);
    rend.effects.chunks(e.x, e.y, '#0B0410', 12, 400, 9);
    const mine = e.by === ctx.meId;
    if (!ctx.playing) return;
    audio.banish(mine);
    ctx.ui.feed(e.name, 'a wraith', mine, false, 'banish');
    if (!mine) return;
    ctx.round.banished++;
    haptic('heavy');
    rend.floatText(e.x, e.y - 30, '+30', '#FFE45C', 30);
    const played =
      Math.random() < 0.6 &&
      killCam(ctx, { full: false, attacker: { kind: 'core', skin: ctx.profile.data.skin }, victim: { kind: 'wraith' }, title: pick(['BANISHED', 'BEGONE', 'PURGED']), sub: 'back into the dark' });
    if (!played) ctx.ui.announce('BANISHED!', '+30 mass', 'yellow');
  },

  sunstone(e, ctx) {
    ctx.renderer.effects.ring(e.x, e.y, '#FFE45C', 10, 220, 0.6, 12);
    ctx.renderer.effects.spark(e.x, e.y, '#FFE45C', 16, 500, 0.5);
    if (e.core !== ctx.meId || !ctx.playing) return;
    ctx.round.radiantUntil = performance.now() + 9000;
    audio.sunstone();
    haptic('success');
    ctx.renderer.addFlash(0.25, '#FFE45C');
    ctx.ui.announce('RADIANT!', 'they fear you now — hunt them', 'yellow');
  },
};
