import { FLAG_RADIANT, FLAG_SHIELD, FLAG_SNARED, FLAG_SURGE, q, q100 } from './protocol';
import type { CoreTuple, DustTuple, FreeMoonTuple } from './protocol';
import type { Core, Dust, FreeMoon } from './world';

export function encodeCore(c: Core): CoreTuple {
  return [
    c.id,
    q(c.x),
    q(c.y),
    q100(c.heading),
    Math.round(c.mass * 10),
    c.moons.length,
    q100(c.orbitAngle),
    q(c.orbitR),
    (c.surging ? FLAG_SURGE : 0) | (c.shield > 0 ? FLAG_SHIELD : 0) | (c.radiant > 0 ? FLAG_RADIANT : 0) | (c.snared > 0 ? FLAG_SNARED : 0),
    c.spin,
  ];
}

export interface DecodedCore {
  id: number;
  x: number;
  y: number;
  heading: number;
  mass: number;
  moons: number;
  orbitAngle: number;
  orbitR: number;
  surging: boolean;
  shield: boolean;
  radiant: boolean;
  snared: boolean;
  spin: 1 | -1;
}

export function decodeCore(t: CoreTuple): DecodedCore {
  return {
    id: t[0],
    x: t[1],
    y: t[2],
    heading: t[3] / 100,
    mass: t[4] / 10,
    moons: t[5],
    orbitAngle: t[6] / 100,
    orbitR: t[7],
    surging: (t[8] & FLAG_SURGE) !== 0,
    shield: (t[8] & FLAG_SHIELD) !== 0,
    radiant: (t[8] & FLAG_RADIANT) !== 0,
    snared: (t[8] & FLAG_SNARED) !== 0,
    spin: t[9],
  };
}

export function encodeDust(d: Dust): DustTuple {
  return d.fx !== undefined && d.fy !== undefined ? [d.id, q(d.x), q(d.y), d.v, d.c, q(d.fx), q(d.fy)] : [d.id, q(d.x), q(d.y), d.v, d.c];
}

export function encodeFreeMoon(m: FreeMoon): FreeMoonTuple {
  return [m.id, q(m.x), q(m.y), m.skin];
}
