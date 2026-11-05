import { describe, expect, it } from 'vitest';
import { BLACKOUT_RADIUS, SNARE_SECS, powerDef } from '../shared/powers';
import type { PowerId } from '../shared/powers';
import { World } from '../shared/world';
import type { Core } from '../shared/world';

const DT = 1 / 30;

function setup(power: PowerId): { w: World; me: Core; foe: Core } {
  const w = new World({ seed: 11, dustTarget: 0 });
  w.nextStarfall = Infinity;
  w.bloodMoon.phaseEnds = Infinity;
  const me = w.addCore('me', 0, false, undefined, power);
  const foe = w.addCore('foe', 3, false, undefined, 'bubble');
  for (const c of [me, foe]) {
    c.shield = 0;
    c.vx = c.vy = 0;
  }
  me.x = me.y = 0;
  foe.x = 1500;
  foe.y = 0;
  return { w, me, foe };
}

describe('Powers', () => {
  it('Wormhole: first press arms a portal, second press warps back and starts cooldown', () => {
    const { w, me } = setup('blink');
    expect(w.powers.use(me)).toBe(true);
    expect(me.worm).not.toBeNull();
    for (let i = 0; i < 30; i++) w.step(DT);
    expect(Math.hypot(me.x, me.y)).toBeGreaterThan(100);
    expect(w.powers.use(me)).toBe(true);
    expect(Math.hypot(me.x, me.y)).toBeLessThan(1);
    expect(me.powerCd).toBe(powerDef('blink').cooldown);
    expect(w.powers.use(me)).toBe(false); // on cooldown
    expect(w.events.some((e) => e.t === 'warp')).toBe(true);
  });

  it('Bubble: blocks a bite', () => {
    const { w, me, foe } = setup('bubble');
    w.powers.use(me);
    w.step(DT);
    foe.mass = 400;
    foe.moons = [0];
    foe.x = me.x - foe.orbitR;
    foe.y = me.y;
    foe.orbitAngle = 0;
    for (let i = 0; i < 5; i++) w.step(DT);
    expect(w.cores.has(me.id)).toBe(true);
  });

  it('Phantom: spawns a fake that looks like you, pops on contact, and never counts as a player', () => {
    const { w, me, foe } = setup('decoy');
    w.powers.use(me);
    const decoyEvt = w.events.find((e) => e.t === 'decoy');
    expect(decoyEvt).toBeTruthy();
    const decoy = w.cores.get(decoyEvt && decoyEvt.t === 'decoy' ? decoyEvt.decoy : -1)!;
    expect(decoy.name).toBe(me.name);
    expect(decoy.skin).toBe(me.skin);
    expect(w.ranking().some((c) => c.id === decoy.id)).toBe(false);
    // ram it
    foe.x = decoy.x + 5;
    foe.y = decoy.y;
    w.flush();
    w.step(DT);
    expect(w.cores.has(decoy.id)).toBe(false);
    const pop = w.events.find((e) => e.t === 'decoyPop');
    expect(pop && pop.t === 'decoyPop' && pop.by).toBe(foe.id);
    expect(w.cores.has(foe.id)).toBe(true);
  });

  it('Snare: catches someone else, slows them and freezes their moons', () => {
    const { w, me, foe } = setup('snare');
    me.heading = 0;
    w.powers.use(me);
    const trap = w.powers.traps[0];
    expect(trap).toBeTruthy();
    // the owner is immune to their own trap
    w.step(DT);
    expect(me.snared).toBe(0);
    foe.x = trap.x;
    foe.y = trap.y;
    w.step(DT);
    expect(foe.snared).toBeGreaterThan(SNARE_SECS - 0.2);
    expect(w.powers.traps.length).toBe(0);
    const a0 = foe.orbitAngle;
    w.step(DT);
    expect(Math.abs(foe.orbitAngle - a0)).toBeLessThan(0.05);
  });

  it('Mimic: copies the nearest core and a bite gives it away', () => {
    const { w, me, foe } = setup('mimic');
    foe.x = 300;
    w.powers.use(me);
    expect(me.name).toBe('foe');
    expect(me.skin).toBe(3);
    expect(me.disguise).toBeGreaterThan(0);
    const victim = w.addCore('victim', 5, false);
    victim.shield = 0;
    w.kill(victim, me);
    expect(me.name).toBe('me');
    expect(me.skin).toBe(0);
  });

  it('Blackout: blinds others in range but not the caster', () => {
    const { w, me, foe } = setup('blackout');
    foe.x = BLACKOUT_RADIUS * 0.5;
    w.powers.use(me);
    w.step(DT);
    expect(foe.blind).toBeGreaterThan(0);
    expect(me.blind).toBe(0);
  });
});
