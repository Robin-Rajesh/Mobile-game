import {
  ARENA_RADIUS,
  DEATH_DROP_RATIO,
  DUST_GRID_CELL,
  DUST_SPAWN_PER_SEC,
  DUST_TARGET,
  EXCESS_MOON_DECAY_SECS,
  FREE_MOON_DROP_RATIO,
  FREE_MOON_LIFETIME,
  KILL_BONUS_FLAT,
  KILL_BONUS_RATIO,
  MAX_MOONS,
  MOON_LINEAR_SPEED,
  SPAWN_SHIELD_SECS,
  START_MASS,
  STARFALL_DURATION,
  STARFALL_DUST_COUNT,
  STARFALL_FIRST_DELAY,
  STARFALL_INTERVAL,
  STARFALL_RADIUS,
  STARFALL_WARNING_SECS,
  SURGE_DRAIN_FRACTION,
  SURGE_DRAIN_MIN,
  SURGE_DROP_RATIO,
  SURGE_MIN_MASS,
  SURGE_ORBIT_MULT,
  SURGE_SPEED_MULT,
  SURGE_SPIN_MULT,
  baseOrbitRadius,
  baseSpeed,
  coreRadius,
  dustRadius,
  moonRadius,
  moonRegenInterval,
  targetMoons,
  turnRate,
} from './constants';
import { BloodMoon } from './bloodmoon';
import { POWER_IDS, Powers, decoyWander } from './powers';
import type { PowerId } from './powers';
import { Rng, TAU, angleDiff, damp } from './math';

export interface Dust {
  id: number;
  x: number;
  y: number;
  /** Mass value */
  v: number;
  /** Palette index 0..5 (6 = gold) */
  c: number;
  /** Origin point for a fly-out animation (client only cosmetic). */
  fx?: number;
  fy?: number;
  /** Grid bookkeeping */
  cell: number;
  ci: number;
}

export interface FreeMoon {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  skin: number;
}

export interface CoreInput {
  angle: number;
  surge: boolean;
}

export type DeathCause = 'bite' | 'rim' | 'wraith';

export type GameEvent =
  | { t: 'kill'; killer: number | null; victim: number; x: number; y: number; kname: string; vname: string; streak: number; vmass: number; vskin: number; cause: DeathCause }
  | { t: 'clash'; x: number; y: number; a: number; b: number }
  | { t: 'capture'; core: number; x: number; y: number }
  | { t: 'starfallWarn'; x: number; y: number; r: number; at: number }
  | { t: 'starfall'; x: number; y: number; r: number }
  | { t: 'spawn'; core: number }
  | { t: 'bloodWarn'; at: number }
  | { t: 'bloodStart'; until: number }
  | { t: 'bloodEnd'; survivors: number[]; wraiths: [number, number][] }
  | { t: 'wraithSpawn'; x: number; y: number; target: number }
  | { t: 'ward'; core: number; x: number; y: number }
  | { t: 'banish'; x: number; y: number; by: number; name: string }
  | { t: 'sunstone'; core: number; x: number; y: number }
  | { t: 'power'; core: number; kind: PowerId; phase: 'use' | 'armed' | 'expire'; cd: number }
  | { t: 'warp'; core: number; fx: number; fy: number; x: number; y: number }
  | { t: 'decoy'; core: number; decoy: number }
  | { t: 'decoyPop'; id: number; owner: number; x: number; y: number; by: number | null; byName: string }
  | { t: 'snared'; core: number; x: number; y: number; by: number }
  | { t: 'disguise'; core: number; name: string; skin: number; on: boolean };

export class Core {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  heading = 0;
  mass = START_MASS;
  /** Angular offsets (relative to orbitAngle), kept in angular order. */
  moons: number[] = [];
  orbitAngle = 0;
  orbitR = 0;
  spin: 1 | -1 = 1;
  surging = false;
  /** Seconds of Blood Moon radiance left (sunstone power-up). */
  radiant = 0;

  // ── powers
  power: PowerId = 'bubble';
  powerCd = 0;
  worm: { x: number; y: number; ttl: number } | null = null;
  disguise = 0;
  realName = '';
  realSkin = 0;
  snared = 0;
  blind = 0;
  /** If non-zero this core is a Phantom decoy belonging to that core id. */
  decoyOf = 0;
  decoyLife = 0;
  shield = SPAWN_SHIELD_SECS;
  alive = true;
  input: CoreInput = { angle: 0, surge: false };

  // timers
  regen = 0;
  surgeDrop = 0;
  excessDecay = 0;

  // stats
  kills = 0;
  streak = 0;
  moonsBroken = 0;
  banished = 0;
  dustEaten = 0;
  peakMass = START_MASS;
  spawnTime = 0;
  killedBy: string | null = null;

  /** Scratch: world-space moon positions for this tick. */
  mx: number[] = [];
  my: number[] = [];

  constructor(
    public readonly id: number,
    public name: string,
    public skin: number,
    public readonly isBot: boolean,
  ) {}

  get r(): number {
    return coreRadius(this.mass);
  }
  get moonR(): number {
    return moonRadius(this.mass);
  }
  get canSurge(): boolean {
    return this.mass > SURGE_MIN_MASS;
  }
}

export interface Starfall {
  x: number;
  y: number;
  r: number;
  /** World time it lands */
  at: number;
  landed: boolean;
  spawned: number;
}

export interface BotController {
  think(world: World, core: Core, dt: number): void;
}

export interface WorldOptions {
  seed?: number;
  arenaRadius?: number;
  dustTarget?: number;
}

const GRID_SIZE = Math.ceil((ARENA_RADIUS * 2 + 400) / DUST_GRID_CELL);

class DustGrid {
  readonly cells: Dust[][] = [];
  readonly offset: number;
  constructor(readonly size: number, readonly cell: number) {
    for (let i = 0; i < size * size; i++) this.cells.push([]);
    this.offset = (size * cell) / 2;
  }
  cellOf(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.size - 1, Math.floor((x + this.offset) / this.cell)));
    const cy = Math.max(0, Math.min(this.size - 1, Math.floor((y + this.offset) / this.cell)));
    return cy * this.size + cx;
  }
  insert(d: Dust): void {
    d.cell = this.cellOf(d.x, d.y);
    const arr = this.cells[d.cell];
    d.ci = arr.length;
    arr.push(d);
  }
  remove(d: Dust): void {
    const arr = this.cells[d.cell];
    const last = arr.pop()!;
    if (last !== d) {
      arr[d.ci] = last;
      last.ci = d.ci;
    }
  }
  /** Visit dust in all cells overlapping the square around (x,y). */
  query(x: number, y: number, radius: number, fn: (d: Dust) => void): void {
    const o = this.offset;
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - radius + o) / c));
    const x1 = Math.min(this.size - 1, Math.floor((x + radius + o) / c));
    const y0 = Math.max(0, Math.floor((y - radius + o) / c));
    const y1 = Math.min(this.size - 1, Math.floor((y + radius + o) / c));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[cy * this.size + cx];
        // iterate backwards so callbacks may remove the current item safely
        for (let i = arr.length - 1; i >= 0; i--) {
          if (i < arr.length) fn(arr[i]);
        }
      }
    }
  }
}

/**
 * Authoritative game simulation. Runs identically in the browser (offline / attract mode)
 * and on the server (online rooms). Rendering never mutates it.
 */
export class World {
  readonly rng: Rng;
  readonly arenaRadius: number;
  readonly dustTarget: number;
  time = 0;
  tick = 0;

  readonly cores = new Map<number, Core>();
  readonly dust = new Map<number, Dust>();
  freeMoons: FreeMoon[] = [];
  readonly grid = new DustGrid(GRID_SIZE, DUST_GRID_CELL);

  starfall: Starfall | null = null;
  nextStarfall: number;
  readonly bloodMoon: BloodMoon;
  readonly powers: Powers;

  /** Drained by the consumer (renderer / network layer) each frame. */
  events: GameEvent[] = [];
  addedDust: Dust[] = [];
  removedDust: Dust[] = [];

  readonly bots = new Map<number, BotController>();
  /** Creates brains for respawning bots. Set by whoever hosts the world. */
  botFactory: (() => BotController) | null = null;
  private botRespawns: { at: number; name: string; skin: number }[] = [];

  private nextId = 1;
  private dustBudget = 0;

  constructor(opts: WorldOptions = {}) {
    this.rng = new Rng(opts.seed);
    this.arenaRadius = opts.arenaRadius ?? ARENA_RADIUS;
    this.dustTarget = opts.dustTarget ?? DUST_TARGET;
    this.nextStarfall = STARFALL_FIRST_DELAY;
    this.bloodMoon = new BloodMoon(this);
    this.powers = new Powers(this);
    for (let i = 0; i < this.dustTarget; i++) this.spawnNaturalDust();
    // initial dust shouldn't be reported as "added" — consumers take a full snapshot on join.
    this.addedDust.length = 0;
  }

  // ───────────────────────────────────────────── entities

  allocId(): number {
    return this.nextId++;
  }

  addCore(name: string, skin: number, isBot: boolean, bot?: BotController, power?: PowerId): Core {
    const core = new Core(this.allocId(), name, skin, isBot);
    if (power) core.power = power;
    else if (isBot) core.power = this.rng.pick(POWER_IDS);
    // humans start in the inner arena so a fresh spawn never begins next to the rim
    const p = this.findSpawnPoint(isBot ? 0.82 : 0.6);
    core.x = p.x;
    core.y = p.y;
    core.heading = Math.atan2(-p.y, -p.x) + this.rng.range(-0.8, 0.8);
    core.input.angle = core.heading;
    core.spin = this.rng.chance(0.5) ? 1 : -1;
    core.orbitAngle = this.rng.next() * TAU;
    core.spawnTime = this.time;
    const n = targetMoons(core.mass);
    for (let i = 0; i < n; i++) core.moons.push((i / n) * TAU);
    core.orbitR = baseOrbitRadius(core.mass, n);
    this.cores.set(core.id, core);
    if (bot) this.bots.set(core.id, bot);
    this.events.push({ t: 'spawn', core: core.id });
    return core;
  }

  removeCore(id: number): void {
    this.cores.delete(id);
    this.powers.forget(id);
    for (const c of this.cores.values()) if (c.decoyOf === id) this.cores.delete(c.id);
    this.bots.delete(id);
  }

  scheduleBotRespawn(name: string, skin: number, delay: number): void {
    this.botRespawns.push({ at: this.time + delay, name, skin });
  }

  cancelBotRespawns(count: number): number {
    const n = Math.min(count, this.botRespawns.length);
    this.botRespawns.splice(0, n);
    return n;
  }

  get pendingBotRespawns(): number {
    return this.botRespawns.length;
  }

  findSpawnPoint(maxRadiusFraction = 0.82): { x: number; y: number } {
    let best = { x: 0, y: 0 };
    let bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const p = this.rng.inDisc(this.arenaRadius * maxRadiusFraction);
      let score = 1e9;
      for (const c of this.cores.values()) {
        const d = Math.hypot(c.x - p.x, c.y - p.y) - (c.orbitR * SURGE_ORBIT_MULT + 260);
        if (d < score) score = d;
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
      if (score > 900) break;
    }
    return best;
  }

  addDust(x: number, y: number, v: number, c: number, fx?: number, fy?: number): Dust {
    // keep dust inside the arena
    const rr = Math.hypot(x, y);
    const lim = this.arenaRadius - 30;
    if (rr > lim) {
      x = (x / rr) * lim;
      y = (y / rr) * lim;
    }
    const d: Dust = { id: this.allocId(), x, y, v, c, fx, fy, cell: 0, ci: 0 };
    this.dust.set(d.id, d);
    this.grid.insert(d);
    this.addedDust.push(d);
    return d;
  }

  removeDust(d: Dust): void {
    if (!this.dust.delete(d.id)) return;
    this.grid.remove(d);
    this.removedDust.push(d);
  }

  private spawnNaturalDust(): void {
    const p = this.rng.inDisc(this.arenaRadius - 60);
    const roll = this.rng.next();
    const v = roll < 0.008 ? 12 : roll < 0.12 ? 3 : roll < 0.4 ? 2 : 1;
    this.addDust(p.x, p.y, v, v === 12 ? 6 : this.rng.int(0, 5));
  }

  /** Clears per-frame outputs. Call after the consumer has read them. */
  flush(): void {
    this.events.length = 0;
    this.addedDust.length = 0;
    this.removedDust.length = 0;
  }

  // ───────────────────────────────────────────── simulation

  step(dt: number): void {
    this.time += dt;
    this.tick++;

    for (const [id, bot] of this.bots) {
      const core = this.cores.get(id);
      if (core && core.alive) bot.think(this, core, dt);
    }

    this.powers.step(dt);
    for (const core of this.cores.values()) {
      if (core.alive) this.updateCore(core, dt);
    }

    this.eatDust();
    this.updateFreeMoons(dt);
    this.resolveCombat();
    this.bloodMoon.step(dt);
    this.maintainDust(dt);
    this.updateStarfall(dt);
    this.processBotRespawns();
  }

  private updateCore(c: Core, dt: number): void {
    if (c.decoyOf) {
      c.decoyLife -= dt;
      if (c.decoyLife <= 0) {
        this.popDecoy(c, null);
        return;
      }
      decoyWander(c, this.rng.next());
    }
    // steering
    const turn = turnRate(c.mass) * dt;
    const d = angleDiff(c.heading, c.input.angle);
    c.heading += Math.max(-turn, Math.min(turn, d));

    c.surging = c.input.surge && c.canSurge && c.snared <= 0 && !c.decoyOf;
    const speed = baseSpeed(c.mass) * (c.surging ? SURGE_SPEED_MULT : 1) * (c.snared > 0 ? 0.3 : 1);
    const k = damp(7, dt);
    c.vx += (Math.cos(c.heading) * speed - c.vx) * k;
    c.vy += (Math.sin(c.heading) * speed - c.vy) * k;
    c.x += c.vx * dt;
    c.y += c.vy * dt;

    if (c.surging) {
      const drain = Math.max(SURGE_DRAIN_MIN, c.mass * SURGE_DRAIN_FRACTION) * dt;
      c.mass = Math.max(SURGE_MIN_MASS * 0.9, c.mass - drain);
      c.surgeDrop += drain * SURGE_DROP_RATIO;
      if (c.surgeDrop >= 2) {
        const v = Math.floor(c.surgeDrop);
        c.surgeDrop -= v;
        const back = c.r + 10;
        this.addDust(
          c.x - Math.cos(c.heading) * back + this.rng.range(-8, 8),
          c.y - Math.sin(c.heading) * back + this.rng.range(-8, 8),
          v,
          this.rng.int(0, 5),
        );
      }
    }

    if (c.shield > 0) c.shield -= dt;
    if (c.radiant > 0) c.radiant -= dt;
    if (c.mass > c.peakMass) c.peakMass = c.mass;

    // moons: regen toward target, slow decay of stolen extras
    const target = targetMoons(c.mass);
    const n = c.moons.length;
    if (c.decoyOf) {
      // phantoms don't grow
    } else if (n < target) {
      c.regen += dt;
      c.excessDecay = 0;
      if (c.regen >= moonRegenInterval(n)) {
        c.regen = 0;
        this.insertMoon(c);
      }
    } else if (n > target) {
      c.regen = 0;
      c.excessDecay += dt;
      if (c.excessDecay >= EXCESS_MOON_DECAY_SECS) {
        c.excessDecay = 0;
        c.moons.pop();
      }
    } else {
      c.regen = 0;
      c.excessDecay = 0;
    }

    // orbit
    const targetR = baseOrbitRadius(c.mass, c.moons.length) * (c.surging ? SURGE_ORBIT_MULT : 1);
    c.orbitR += (targetR - c.orbitR) * damp(c.surging ? 7 : 5, dt);
    const omega = ((MOON_LINEAR_SPEED * (c.surging ? SURGE_SPIN_MULT : 1) * (c.snared > 0 ? 0.08 : 1)) / Math.max(30, c.orbitR)) * c.spin;
    c.orbitAngle = (c.orbitAngle + omega * dt) % TAU;
    this.spreadMoons(c, dt);
    this.computeMoonPositions(c);
  }

  private spreadMoons(c: Core, dt: number): void {
    spreadMoonOffsets(c.moons, dt);
  }

  insertMoon(c: Core): void {
    insertMoonOffset(c.moons);
  }

  computeMoonPositions(c: Core): void {
    const n = c.moons.length;
    c.mx.length = n;
    c.my.length = n;
    for (let i = 0; i < n; i++) {
      const a = c.orbitAngle + c.moons[i];
      c.mx[i] = c.x + Math.cos(a) * c.orbitR;
      c.my[i] = c.y + Math.sin(a) * c.orbitR;
    }
  }

  private eatDust(): void {
    for (const c of this.cores.values()) {
      if (!c.alive || c.decoyOf) continue;
      const r = c.r;
      const reach = r + 22;
      this.grid.query(c.x, c.y, reach, (d) => {
        const rr = r + dustRadius(d.v) + 4;
        const dx = d.x - c.x;
        const dy = d.y - c.y;
        if (dx * dx + dy * dy < rr * rr) {
          c.mass += d.v;
          c.dustEaten += d.v;
          this.removeDust(d);
        }
      });
    }
  }

  private updateFreeMoons(dt: number): void {
    const k = Math.exp(-2.2 * dt);
    for (let i = this.freeMoons.length - 1; i >= 0; i--) {
      const m = this.freeMoons[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vx *= k;
      m.vy *= k;
      m.life -= dt;
      let captured = false;
      for (const c of this.cores.values()) {
        if (!c.alive || c.decoyOf || c.moons.length >= MAX_MOONS) continue;
        const rr = c.r + 14;
        if ((m.x - c.x) ** 2 + (m.y - c.y) ** 2 < rr * rr) {
          this.insertMoon(c);
          this.events.push({ t: 'capture', core: c.id, x: m.x, y: m.y });
          captured = true;
          break;
        }
      }
      if (captured) {
        this.freeMoons.splice(i, 1);
      } else if (m.life <= 0 || Math.hypot(m.x, m.y) > this.arenaRadius) {
        if (m.life <= 0) this.addDust(m.x, m.y, 3, this.rng.int(0, 5));
        this.freeMoons.splice(i, 1);
      }
    }
  }

  private resolveCombat(): void {
    const list: Core[] = [];
    for (const c of this.cores.values()) if (c.alive) list.push(c);

    const deaths = new Map<Core, Core | null>();
    const pops = new Map<Core, Core>();
    const broken = new Map<Core, Set<number>>();
    const markBroken = (c: Core, i: number) => {
      let s = broken.get(c);
      if (!s) broken.set(c, (s = new Set()));
      s.add(i);
    };

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const ar = a.r;
        const br = b.r;
        const broad = a.orbitR + b.orbitR + a.moonR + b.moonR + ar + br;
        if (d2 > broad * broad) continue;

        // phantoms: anything that touches them pops them, and they can't hurt anyone
        if (a.decoyOf || b.decoyOf) {
          if (a.decoyOf && b.decoyOf) continue;
          const decoy = a.decoyOf ? a : b;
          const real = a.decoyOf ? b : a;
          if (real.id === decoy.decoyOf || pops.has(decoy)) continue;
          const dd = Math.sqrt(d2);
          let hit = dd < decoy.r + real.r;
          for (let p = 0; !hit && p < real.mx.length; p++) {
            const ex = real.mx[p] - decoy.x;
            const ey = real.my[p] - decoy.y;
            const ed = Math.sqrt(ex * ex + ey * ey);
            hit = ed < real.moonR + decoy.r || Math.abs(ed - decoy.orbitR) < real.moonR + decoy.moonR;
          }
          if (hit) pops.set(decoy, real);
          continue;
        }

        // body contact: soft push, heavier core moves less
        const d = Math.sqrt(d2) || 0.001;
        const overlap = ar + br - d;
        if (overlap > 0) {
          const nx = dx / d;
          const ny = dy / d;
          const total = a.mass + b.mass;
          const pa = (b.mass / total) * overlap;
          const pb = (a.mass / total) * overlap;
          a.x -= nx * pa;
          a.y -= ny * pa;
          b.x += nx * pb;
          b.y += ny * pb;
          a.vx -= nx * 60;
          a.vy -= ny * 60;
          b.vx += nx * 60;
          b.vy += ny * 60;
        }

        const aGhost = a.shield > 0;
        const bGhost = b.shield > 0;
        if (aGhost || bGhost) continue;

        // moon vs moon — both shatter
        const amr = a.moonR;
        const bmr = b.moonR;
        const mm = (amr + bmr) * (amr + bmr);
        const aBroken = broken.get(a);
        const bBroken = broken.get(b);
        for (let p = 0; p < a.mx.length; p++) {
          if (aBroken?.has(p)) continue;
          // quick reject: moon p must be near b's orbit band
          const pdx = a.mx[p] - b.x;
          const pdy = a.my[p] - b.y;
          const pd = Math.sqrt(pdx * pdx + pdy * pdy);
          if (Math.abs(pd - b.orbitR) < amr + bmr) {
            for (let q = 0; q < b.mx.length; q++) {
              if (broken.get(b)?.has(q)) continue;
              if ((a.mx[p] - b.mx[q]) ** 2 + (a.my[p] - b.my[q]) ** 2 < mm) {
                markBroken(a, p);
                markBroken(b, q);
                a.moonsBroken++;
                b.moonsBroken++;
                const cx = (a.mx[p] + b.mx[q]) / 2;
                const cy = (a.my[p] + b.my[q]) / 2;
                this.events.push({ t: 'clash', x: cx, y: cy, a: a.id, b: b.id });
                this.addDust(cx + this.rng.range(-10, 10), cy + this.rng.range(-10, 10), 2, this.rng.int(0, 5), cx, cy);
                break;
              }
            }
          }
          // moon of A bites core of B
          if (pd < amr + br && !broken.get(a)?.has(p) && !deaths.has(b)) {
            deaths.set(b, a);
          }
        }
        for (let q = 0; q < b.mx.length; q++) {
          if (bBroken?.has(q) || broken.get(b)?.has(q)) continue;
          const qd2 = (b.mx[q] - a.x) ** 2 + (b.my[q] - a.y) ** 2;
          if (qd2 < (bmr + ar) * (bmr + ar) && !deaths.has(a)) {
            deaths.set(a, b);
          }
        }
      }
    }

    // apply broken moons (descending order so indices stay valid)
    for (const [c, set] of broken) {
      const idx = [...set].sort((x, y) => y - x);
      for (const i of idx) c.moons.splice(i, 1);
      c.regen = 0;
    }

    // the rim is lethal
    const R = this.arenaRadius;
    for (const c of list) {
      if (deaths.has(c)) continue;
      const d = Math.hypot(c.x, c.y);
      if (d + c.r * 0.5 <= R) continue;
      if (c.shield > 0) {
        // spawn protection: the rim is a bouncy wall instead of a death sentence
        const nx = c.x / d;
        const ny = c.y / d;
        const lim = R - c.r * 0.5 - 1;
        c.x = nx * lim;
        c.y = ny * lim;
        const vn = c.vx * nx + c.vy * ny;
        if (vn > 0) {
          c.vx -= 2 * vn * nx;
          c.vy -= 2 * vn * ny;
        }
        continue;
      }
      deaths.set(c, null);
    }

    for (const [victim, killer] of deaths) this.kill(victim, killer);
    for (const [decoy, by] of pops) this.popDecoy(decoy, by);
  }

  /** A phantom vanishes — fooled someone, or simply ran out. */
  popDecoy(d: Core, by: Core | null): void {
    if (!this.cores.has(d.id)) return;
    this.cores.delete(d.id);
    this.events.push({ t: 'decoyPop', id: d.id, owner: d.decoyOf, x: d.x, y: d.y, by: by ? by.id : null, byName: by ? by.name : '' });
  }

  kill(victim: Core, killer: Core | null, cause: DeathCause = killer ? 'bite' : 'rim'): void {
    if (!victim.alive) return;
    if (victim.decoyOf) {
      this.popDecoy(victim, killer);
      return;
    }
    // a bite gives the mimic away
    if (killer && killer.disguise > 0) this.powers.endDisguise(killer);
    // your phantoms die with you
    for (const c of this.cores.values()) if (c.decoyOf === victim.id) this.popDecoy(c, null);
    this.powers.forget(victim.id);
    victim.alive = false;
    victim.killedBy = killer ? killer.name : cause === 'wraith' ? 'the dark' : null;

    const R = this.arenaRadius;
    // scatter the victim's mass as dust
    const total = victim.mass * DEATH_DROP_RATIO;
    const pieces = Math.max(6, Math.min(140, Math.round(total / 4)));
    const per = Math.max(1, Math.round(total / pieces));
    const spread = victim.r + victim.orbitR * 0.7;
    for (let i = 0; i < pieces; i++) {
      const a = this.rng.next() * TAU;
      const rr = Math.sqrt(this.rng.next()) * spread;
      let x = victim.x + Math.cos(a) * rr;
      let y = victim.y + Math.sin(a) * rr;
      const dd = Math.hypot(x, y);
      if (dd > R - 40) {
        x *= (R - 40) / dd;
        y *= (R - 40) / dd;
      }
      this.addDust(x, y, per, victim.skin % 6, victim.x, victim.y);
    }

    // a share of the moons break loose — catch them to steal them
    const freeCount = Math.ceil(victim.moons.length * FREE_MOON_DROP_RATIO);
    for (let i = 0; i < freeCount && i < victim.mx.length; i++) {
      const mx = victim.mx[i];
      const my = victim.my[i];
      const a = Math.atan2(my - victim.y, mx - victim.x);
      const sp = this.rng.range(140, 260);
      this.freeMoons.push({ id: this.allocId(), x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: FREE_MOON_LIFETIME, skin: victim.skin });
    }

    let streak = 0;
    if (killer) {
      killer.kills++;
      killer.streak++;
      streak = killer.streak;
      killer.mass += KILL_BONUS_FLAT + victim.mass * KILL_BONUS_RATIO;
    }

    this.events.push({
      t: 'kill',
      killer: killer ? killer.id : null,
      victim: victim.id,
      x: victim.x,
      y: victim.y,
      kname: killer ? killer.name : cause === 'wraith' ? 'the dark' : '',
      vname: victim.name,
      streak,
      vmass: Math.round(victim.mass),
      vskin: victim.skin,
      cause,
    });

    this.cores.delete(victim.id);
    if (this.bots.delete(victim.id) && this.botFactory) {
      // keep the population alive — bots come back with a short delay
      this.scheduleBotRespawn(victim.name, victim.skin, this.rng.range(1.5, 4));
    }
  }

  private maintainDust(dt: number): void {
    if (this.dust.size >= this.dustTarget) return;
    this.dustBudget += DUST_SPAWN_PER_SEC * dt;
    while (this.dustBudget >= 1 && this.dust.size < this.dustTarget) {
      this.dustBudget -= 1;
      this.spawnNaturalDust();
    }
  }

  private updateStarfall(dt: number): void {
    const sf = this.starfall;
    if (!sf && this.bloodMoon.phase !== 'calm') {
      // one spectacle at a time
      this.nextStarfall = Math.max(this.nextStarfall, this.time + STARFALL_WARNING_SECS + 10);
      return;
    }
    if (!sf) {
      if (this.time >= this.nextStarfall - STARFALL_WARNING_SECS) {
        const p = this.rng.inDisc(this.arenaRadius * 0.7);
        this.starfall = { x: p.x, y: p.y, r: STARFALL_RADIUS, at: this.nextStarfall, landed: false, spawned: 0 };
        this.events.push({ t: 'starfallWarn', x: p.x, y: p.y, r: STARFALL_RADIUS, at: this.nextStarfall });
      }
      return;
    }
    if (this.time < sf.at) return;
    if (!sf.landed) {
      sf.landed = true;
      this.events.push({ t: 'starfall', x: sf.x, y: sf.y, r: sf.r });
    }
    const progress = Math.min(1, (this.time - sf.at) / STARFALL_DURATION);
    const want = Math.floor(progress * STARFALL_DUST_COUNT);
    while (sf.spawned < want) {
      sf.spawned++;
      const p = this.rng.inDisc(sf.r);
      const gold = this.rng.chance(0.15);
      this.addDust(sf.x + p.x, sf.y + p.y, gold ? 10 : this.rng.int(3, 6), gold ? 6 : this.rng.int(0, 5));
    }
    if (progress >= 1) {
      this.starfall = null;
      this.nextStarfall = this.time + STARFALL_INTERVAL;
    }
    void dt;
  }

  private processBotRespawns(): void {
    for (let i = this.botRespawns.length - 1; i >= 0; i--) {
      const r = this.botRespawns[i];
      if (this.time >= r.at) {
        this.botRespawns.splice(i, 1);
        if (this.botFactory) this.addCore(r.name, r.skin, true, this.botFactory());
      }
    }
  }

  // ───────────────────────────────────────────── queries

  /** Alive cores sorted by mass, descending. */
  ranking(): Core[] {
    const arr: Core[] = [];
    for (const c of this.cores.values()) if (c.alive && !c.decoyOf) arr.push(c);
    arr.sort((a, b) => b.mass - a.mass);
    return arr;
  }

  queryDust(x: number, y: number, radius: number, fn: (d: Dust) => void): void {
    this.grid.query(x, y, radius, fn);
  }
}

/** Ease moon offsets toward even spacing around a stable circular-mean anchor. */
export function spreadMoonOffsets(moons: number[], dt: number): void {
  const n = moons.length;
  if (n === 0) return;
  const step = TAU / n;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const a = moons[i] - i * step;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const base = Math.atan2(sy, sx);
  const k = damp(4, dt);
  for (let i = 0; i < n; i++) moons[i] += angleDiff(moons[i], base + i * step) * k;
}

/** Insert a moon in the middle of the widest gap (keeps angular order). */
export function insertMoonOffset(moons: number[]): void {
  const n = moons.length;
  if (n >= MAX_MOONS) return;
  if (n === 0) {
    moons.push(0);
    return;
  }
  let bestGap = -1;
  let bestIdx = 0;
  for (let i = 0; i < n; i++) {
    const a = moons[i];
    const b = i + 1 < n ? moons[i + 1] : moons[0] + TAU;
    const gap = ((((b - a) % TAU) + TAU) % TAU) || TAU;
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }
  moons.splice(bestIdx + 1, 0, moons[bestIdx] + bestGap / 2);
}
