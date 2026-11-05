import { describe, expect, it } from 'vitest';
import { BotBrain } from '../shared/bot';
import { decodeCore, encodeCore } from '../shared/codec';
import { ARENA_RADIUS, MAX_MOONS, START_MASS, SURGE_MIN_MASS, targetMoons } from '../shared/constants';
import { TAU } from '../shared/math';
import { isNameAllowed, parseClientMsg, sanitizeName } from '../shared/protocol';
import { World, insertMoonOffset, spreadMoonOffsets } from '../shared/world';
import type { Core } from '../shared/world';

const DT = 1 / 30;

function emptyWorld(seed = 1): World {
  const w = new World({ seed, dustTarget: 0 });
  w.nextStarfall = Infinity;
  return w;
}

function place(c: Core, x: number, y: number, heading = 0): void {
  c.x = x;
  c.y = y;
  c.heading = heading;
  c.input.angle = heading;
  c.vx = c.vy = 0;
  c.shield = 0;
}

describe('World basics', () => {
  it('spawns cores with the right starting state', () => {
    const w = emptyWorld();
    const c = w.addCore('a', 0, false);
    expect(c.mass).toBe(START_MASS);
    expect(c.moons.length).toBe(targetMoons(START_MASS));
    expect(Math.hypot(c.x, c.y)).toBeLessThan(ARENA_RADIUS * 0.6 + 1);
    expect(c.shield).toBeGreaterThan(0);
  });

  it('eating dust grows mass and removes the dust', () => {
    const w = emptyWorld();
    const c = w.addCore('a', 0, false);
    place(c, 0, 0);
    const d = w.addDust(c.x + 5, c.y, 3, 0);
    w.step(DT);
    expect(w.dust.has(d.id)).toBe(false);
    expect(c.mass).toBeCloseTo(START_MASS + 3, 5);
    expect(w.removedDust.map((x) => x.id)).toContain(d.id);
  });

  it('regenerates moons toward the mass target', () => {
    const w = emptyWorld();
    const c = w.addCore('a', 0, false);
    place(c, 0, 0);
    c.mass = 500;
    c.input.angle = 0;
    const want = targetMoons(500);
    for (let i = 0; i < 30 * 40 && c.moons.length < want; i++) {
      c.x = 0;
      c.y = 0;
      w.step(DT);
    }
    expect(c.moons.length).toBe(want);
  });

  it('surge drains mass and needs the minimum mass', () => {
    const w = emptyWorld();
    const c = w.addCore('a', 0, false);
    place(c, 0, 0);
    c.input.surge = true;
    w.step(DT);
    expect(c.surging).toBe(false); // too light
    c.mass = 200;
    w.step(DT);
    expect(c.surging).toBe(true);
    expect(c.mass).toBeLessThan(200);
    expect(c.mass).toBeGreaterThan(SURGE_MIN_MASS);
  });
});

describe('Combat', () => {
  it("a moon touching another core bites it and credits the killer", () => {
    const w = emptyWorld();
    const a = w.addCore('hunter', 0, false);
    const b = w.addCore('prey', 1, false);
    place(a, 0, 0);
    a.mass = 400;
    a.moons = [0];
    a.orbitAngle = 0;
    // put the prey exactly where a's moon will be next tick
    w.step(DT);
    const mx = a.x + Math.cos(a.orbitAngle) * a.orbitR;
    const my = a.y + Math.sin(a.orbitAngle) * a.orbitR;
    place(b, mx, my, Math.PI);
    b.moons = [];
    w.step(DT);
    expect(w.cores.has(b.id)).toBe(false);
    expect(a.kills).toBe(1);
    const kill = w.events.find((e) => e.t === 'kill');
    expect(kill && kill.t === 'kill' && kill.killer).toBe(a.id);
    // victim mass is scattered as dust
    expect(w.dust.size).toBeGreaterThan(5);
  });

  it('spawn shield makes a core immune', () => {
    const w = emptyWorld();
    const a = w.addCore('a', 0, false);
    const b = w.addCore('b', 1, false);
    place(a, 0, 0);
    a.moons = [0];
    w.step(DT);
    place(b, a.x + a.orbitR, a.y, 0);
    b.shield = 2;
    for (let i = 0; i < 10; i++) w.step(DT);
    expect(w.cores.has(b.id)).toBe(true);
  });

  it('colliding moons shatter on both sides', () => {
    const w = emptyWorld();
    const a = w.addCore('a', 0, false);
    const b = w.addCore('b', 1, false);
    place(a, -100, 0, 0);
    place(b, 100, 0, Math.PI);
    a.input.angle = Math.PI / 2;
    b.input.angle = Math.PI / 2;
    let clashes = 0;
    for (let i = 0; i < 60 && clashes === 0; i++) {
      w.step(DT);
      clashes += w.events.filter((e) => e.t === 'clash').length;
      w.flush();
      if (!w.cores.has(a.id) || !w.cores.has(b.id)) break;
    }
    expect(clashes).toBeGreaterThan(0);
  });

  it('the rim is lethal once unshielded, and a wall while shielded', () => {
    const w = emptyWorld();
    const a = w.addCore('a', 0, false);
    place(a, ARENA_RADIUS - 5, 0, 0);
    a.shield = 1;
    w.step(DT);
    expect(w.cores.has(a.id)).toBe(true);
    expect(Math.hypot(a.x, a.y)).toBeLessThan(ARENA_RADIUS);
    a.shield = 0;
    a.x = ARENA_RADIUS;
    w.step(DT);
    expect(w.cores.has(a.id)).toBe(false);
    const kill = w.events.find((e) => e.t === 'kill');
    expect(kill && kill.t === 'kill' && kill.cause).toBe('rim');
  });

  it('loose moons from a death can be captured', () => {
    const w = emptyWorld();
    const a = w.addCore('a', 0, false);
    place(a, 0, 0);
    const before = a.moons.length;
    w.freeMoons.push({ id: w.allocId(), x: 5, y: 0, vx: 0, vy: 0, life: 5, skin: 2 });
    w.step(DT);
    expect(a.moons.length).toBe(before + 1);
    expect(w.events.some((e) => e.t === 'capture')).toBe(true);
  });
});

describe('Moon spacing helpers', () => {
  it('inserts into the widest gap and spreads evenly', () => {
    const moons = [0, 0.1];
    insertMoonOffset(moons);
    expect(moons.length).toBe(3);
    for (let i = 0; i < 300; i++) spreadMoonOffsets(moons, 1 / 30);
    const gaps = [moons[1] - moons[0], moons[2] - moons[1]];
    for (const g of gaps) expect(Math.abs(g - TAU / 3)).toBeLessThan(0.02);
  });

  it('caps at MAX_MOONS', () => {
    const moons: number[] = [];
    for (let i = 0; i < MAX_MOONS + 5; i++) insertMoonOffset(moons);
    expect(moons.length).toBe(MAX_MOONS);
  });
});

describe('Full arena soak', () => {
  it('runs 3 minutes of bots without errors, with fights and respawns', () => {
    const w = new World({ seed: 99 });
    w.botFactory = () => new BotBrain();
    for (let i = 0; i < 18; i++) w.addCore(`bot${i}`, i % 13, true, new BotBrain());
    let kills = 0;
    let starfalls = 0;
    for (let t = 0; t < 30 * 180; t++) {
      w.step(DT);
      for (const e of w.events) {
        if (e.t === 'kill') kills++;
        if (e.t === 'starfall') starfalls++;
      }
      w.flush();
      for (const c of w.cores.values()) {
        expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.mass)).toBe(true);
      }
    }
    expect(kills).toBeGreaterThan(5);
    expect(starfalls).toBeGreaterThan(1);
    // population is maintained by respawns
    expect(w.cores.size + w.pendingBotRespawns).toBe(18);
  });
});

describe('Protocol', () => {
  it('round-trips a core through the wire codec', () => {
    const w = emptyWorld();
    const c = w.addCore('a', 3, false);
    c.mass = 123.4;
    c.surging = true;
    const d = decodeCore(encodeCore(c));
    expect(d.id).toBe(c.id);
    expect(d.mass).toBeCloseTo(123.4, 1);
    expect(d.moons).toBe(c.moons.length);
    expect(d.surging).toBe(true);
    expect(d.shield).toBe(true);
  });

  it('rejects malformed client messages', () => {
    expect(parseClientMsg('nope')).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'in', a: 'x' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'in', a: Infinity }))).toBeNull();
    expect(parseClientMsg('x'.repeat(600))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'in', a: 1.2, s: 1 }))).toEqual({ t: 'in', a: 1.2, s: 1 });
  });

  it('sanitises player names', () => {
    expect(sanitizeName('  hi\u0000‮there  ', 14)).toBe('hithere');
    expect(sanitizeName('a'.repeat(40), 14).length).toBe(14);
    expect(sanitizeName(42, 14)).toBe('');
    expect(isNameAllowed('friendly')).toBe(true);
  });
});
