import { describe, expect, it } from 'vitest';
import { BLOODMOON_DURATION, DAWN_SURVIVAL_BONUS, RADIANT_SECS } from '../shared/constants';
import { World } from '../shared/world';
import type { Core } from '../shared/world';

const DT = 1 / 30;

function world(): World {
  const w = new World({ seed: 5, dustTarget: 0 });
  w.nextStarfall = Infinity;
  return w;
}

function hold(c: Core, x: number, y: number): void {
  c.x = x;
  c.y = y;
  c.vx = c.vy = 0;
  c.input.angle = c.heading = 0;
}

function runUntilDark(w: World): void {
  w.bloodMoon.trigger(0.5);
  for (let i = 0; i < 60 && !w.bloodMoon.dark; i++) w.step(DT);
}

describe('Blood Moon', () => {
  it('goes calm → warn → dark → calm with events and a dawn bonus', () => {
    const w = world();
    const c = w.addCore('a', 0, false);
    c.shield = 9999;
    const seen = new Set<string>();
    w.bloodMoon.trigger(1);
    let massAtDark = 0;
    for (let i = 0; i < 30 * (BLOODMOON_DURATION + 4); i++) {
      hold(c, 0, 0);
      w.step(DT);
      for (const e of w.events) seen.add(e.t);
      if (w.events.some((e) => e.t === 'bloodStart')) massAtDark = c.mass;
      w.flush();
    }
    expect([...seen]).toEqual(expect.arrayContaining(['bloodWarn', 'bloodStart', 'wraithSpawn', 'bloodEnd']));
    expect(w.bloodMoon.phase).toBe('calm');
    expect(w.bloodMoon.wraiths.length).toBe(0);
    expect(c.mass).toBeGreaterThanOrEqual(massAtDark + DAWN_SURVIVAL_BONUS - 1);
  });

  it('a wraith takes an unprotected core with no moons', () => {
    const w = world();
    const c = w.addCore('prey', 0, false);
    runUntilDark(w);
    c.shield = 0;
    c.moons = [];
    hold(c, 0, 0);
    w.bloodMoon.wraiths.push({ id: w.allocId(), x: 10, y: 0, vx: 0, vy: 0, target: c.id, stagger: 0, scared: false, age: 5 });
    w.step(DT);
    expect(w.cores.has(c.id)).toBe(false);
    const kill = w.events.find((e) => e.t === 'kill');
    expect(kill && kill.t === 'kill' && kill.cause).toBe('wraith');
  });

  it('moons ward a wraith off but shatter doing it', () => {
    const w = world();
    const c = w.addCore('guard', 0, false);
    runUntilDark(w);
    hold(c, 0, 0);
    w.step(DT);
    const before = c.moons.length;
    const mx = c.mx[0];
    const my = c.my[0];
    w.bloodMoon.wraiths = [{ id: w.allocId(), x: mx + (mx - c.x) * 0.3, y: my + (my - c.y) * 0.3, vx: 0, vy: 0, target: c.id, stagger: 0, scared: false, age: 5 }];
    hold(c, 0, 0);
    w.step(DT);
    expect(w.events.some((e) => e.t === 'ward')).toBe(true);
    expect(c.moons.length).toBe(before - 1);
    expect(w.cores.has(c.id)).toBe(true);
  });

  it('sunstones make you Radiant, and Radiant cores banish wraiths for a reward', () => {
    const w = world();
    const c = w.addCore('hero', 0, false);
    runUntilDark(w);
    hold(c, 0, 0);
    w.bloodMoon.sunstones = [{ id: w.allocId(), x: 5, y: 0 }];
    w.bloodMoon.wraiths = [];
    w.step(DT);
    expect(c.radiant).toBeGreaterThan(RADIANT_SECS - 0.2);
    expect(w.events.some((e) => e.t === 'sunstone')).toBe(true);
    const mass = c.mass;
    w.bloodMoon.wraiths = [{ id: w.allocId(), x: c.x + 15, y: c.y, vx: 0, vy: 0, target: -1, stagger: 0, scared: true, age: 5 }];
    w.step(DT);
    expect(w.bloodMoon.wraiths.length).toBe(0);
    expect(c.banished).toBe(1);
    expect(c.mass).toBeGreaterThan(mass);
    expect(w.events.some((e) => e.t === 'banish')).toBe(true);
  });

  it('wraiths flee from Radiant cores', () => {
    const w = world();
    const c = w.addCore('hero', 0, false);
    runUntilDark(w);
    c.radiant = 5;
    hold(c, 0, 0);
    const wr = { id: w.allocId(), x: 400, y: 0, vx: 0, vy: 0, target: c.id, stagger: 0, scared: false, age: 5 };
    w.bloodMoon.wraiths = [wr];
    for (let i = 0; i < 20; i++) {
      hold(c, 0, 0);
      w.step(DT);
    }
    expect(wr.scared).toBe(true);
    expect(wr.x).toBeGreaterThan(400);
  });
});
