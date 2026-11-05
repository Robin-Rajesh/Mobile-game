/**
 * Every gameplay tuning number lives here so balance passes never touch logic.
 * Units: world units (u), seconds (s). The arena is a disc centred on (0,0).
 */

export const SERVER_TICK_RATE = 30;
export const SNAPSHOT_EVERY_N_TICKS = 2; // 15 Hz snapshots
export const LOCAL_TICK_RATE = 60;

export const ARENA_RADIUS = 3000;
/** Natural dust density: roughly one mote every ~19k u². */
export const DUST_TARGET = 1500;
export const DUST_SPAWN_PER_SEC = 60;
export const DUST_GRID_CELL = 160;

export const ROOM_CAPACITY = 30;
export const ROOM_TARGET_POPULATION = 18; // bots fill up to this

export const START_MASS = 20;
export const MAX_MOONS = 30;
export const SPAWN_SHIELD_SECS = 3;

/** Moons orbit at roughly this tangential speed so small and big orbits both feel snappy. */
export const MOON_LINEAR_SPEED = 250;

export const SURGE_SPEED_MULT = 1.6;
export const SURGE_ORBIT_MULT = 1.7;
export const SURGE_SPIN_MULT = 1.45;
export const SURGE_MIN_MASS = 30;
export const SURGE_DRAIN_FRACTION = 0.02; // of mass per second
export const SURGE_DRAIN_MIN = 2; // mass per second
export const SURGE_DROP_RATIO = 0.7; // drained mass that becomes dust behind you

export const DEATH_DROP_RATIO = 0.75;
export const KILL_BONUS_FLAT = 6;
export const KILL_BONUS_RATIO = 0.08;
export const FREE_MOON_LIFETIME = 14;
export const FREE_MOON_DROP_RATIO = 0.6;

/** Moons above your natural target slowly fade, so stolen moons are a temporary edge. */
export const EXCESS_MOON_DECAY_SECS = 9;

export const STARFALL_INTERVAL = 48;
export const STARFALL_FIRST_DELAY = 25;
export const STARFALL_WARNING_SECS = 6;
export const STARFALL_RADIUS = 260;
export const STARFALL_DUST_COUNT = 70;
export const STARFALL_DURATION = 1.6;

export const NAME_MAX_LEN = 14;

export function coreRadius(mass: number): number {
  return 16 + Math.sqrt(mass) * 1.6;
}

export function moonRadius(mass: number): number {
  return 8 + Math.sqrt(mass) * 0.12;
}

export function targetMoons(mass: number): number {
  return Math.min(MAX_MOONS, 3 + Math.floor(Math.sqrt(mass / 8)));
}

export function baseOrbitRadius(mass: number, moons: number): number {
  return coreRadius(mass) + 30 + moons * 2.2;
}

export function baseSpeed(mass: number): number {
  return 205 + 115 / (1 + mass / 260);
}

export function turnRate(mass: number): number {
  return 3.4 + 4.6 / (1 + mass / 600);
}

export function moonRegenInterval(current: number): number {
  return 1.4 + current * 0.07;
}

export function dustRadius(value: number): number {
  return 3.5 + Math.sqrt(value) * 2.2;
}
