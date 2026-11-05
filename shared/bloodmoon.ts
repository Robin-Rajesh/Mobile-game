import {
  BANISH_DUST,
  BANISH_MASS_REWARD,
  BLOODMOON_DURATION,
  BLOODMOON_FIRST_DELAY,
  BLOODMOON_INTERVAL_MAX,
  BLOODMOON_INTERVAL_MIN,
  BLOODMOON_WARNING_SECS,
  DAWN_SURVIVAL_BONUS,
  RADIANT_SECS,
  SUNSTONE_MAX,
  SUNSTONE_RADIUS,
  SUNSTONE_SPAWN_EVERY,
  WRAITH_FLEE_SPEED,
  WRAITH_MAX,
  WRAITH_PER_CORE,
  WRAITH_RADIUS,
  WRAITH_SPAWN_EVERY,
  WRAITH_SPEED,
  WRAITH_STAGGER_SECS,
} from './constants';
import { TAU, damp } from './math';
import type { Core, World } from './world';

export type BloodPhase = 'calm' | 'warn' | 'dark';

export interface Wraith {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: number;
  stagger: number;
  scared: boolean;
  /** seconds since it crawled out of the dark (spawn animation) */
  age: number;
}

export interface Sunstone {
  id: number;
  x: number;
  y: number;
}

/**
 * The Blood Moon: a timed horror event. The arena goes dark, wraiths crawl out and hunt
 * cores, and sunstones let you turn Radiant and banish them. Runs inside World.step().
 */
export class BloodMoon {
  phase: BloodPhase = 'calm';
  /** World time when the current phase ends */
  phaseEnds: number;
  wraiths: Wraith[] = [];
  sunstones: Sunstone[] = [];
  private spawnTimer = 0;
  private sunTimer = 0;
  private retarget = 0;

  constructor(private w: World) {
    this.phaseEnds = BLOODMOON_FIRST_DELAY;
  }

  get dark(): boolean {
    return this.phase === 'dark';
  }

  /** Seconds until the next phase change. */
  get remaining(): number {
    return this.phaseEnds - this.w.time;
  }

  /** Force the event to begin soon (debug / tests). */
  trigger(inSecs = BLOODMOON_WARNING_SECS): void {
    if (this.phase !== 'calm') return;
    this.phaseEnds = this.w.time + inSecs;
  }

  step(dt: number): void {
    const w = this.w;
    if (this.phase === 'calm') {
      if (w.time >= this.phaseEnds - BLOODMOON_WARNING_SECS) {
        this.phase = 'warn';
        w.events.push({ t: 'bloodWarn', at: this.phaseEnds });
      }
      return;
    }
    if (this.phase === 'warn') {
      if (w.time >= this.phaseEnds) this.begin();
      return;
    }
    if (w.time >= this.phaseEnds) {
      this.end();
      return;
    }
    this.spawnTimer -= dt;
    this.sunTimer -= dt;
    this.retarget -= dt;
    this.spawn();
    this.updateWraiths(dt);
    this.collide();
  }

  private begin(): void {
    const w = this.w;
    this.phase = 'dark';
    this.phaseEnds = w.time + BLOODMOON_DURATION;
    this.spawnTimer = 1.2; // a breath of silence before the first one appears
    this.sunTimer = 0;
    w.events.push({ t: 'bloodStart', until: this.phaseEnds });
    for (let i = 0; i < 3; i++) this.spawnSunstone();
  }

  private end(): void {
    const w = this.w;
    const survivors: number[] = [];
    for (const c of w.cores.values()) {
      if (!c.alive) continue;
      survivors.push(c.id);
      c.mass += DAWN_SURVIVAL_BONUS;
    }
    w.events.push({ t: 'bloodEnd', survivors, wraiths: this.wraiths.map((x) => [Math.round(x.x), Math.round(x.y)] as [number, number]) });
    this.wraiths = [];
    this.sunstones = [];
    this.phase = 'calm';
    this.phaseEnds = w.time + w.rng.range(BLOODMOON_INTERVAL_MIN, BLOODMOON_INTERVAL_MAX);
  }

  // ───────────────────────────────────── spawning

  private spawn(): void {
    const w = this.w;
    const alive = [...w.cores.values()].filter((c) => c.alive);
    const want = Math.min(WRAITH_MAX, Math.ceil(alive.length * WRAITH_PER_CORE));
    if (this.spawnTimer <= 0 && this.wraiths.length < want && alive.length) {
      this.spawnTimer = WRAITH_SPAWN_EVERY * w.rng.range(0.6, 1.3);
      // haunt humans more often — it's their nightmare
      const humans = alive.filter((c) => !c.isBot);
      const victim = humans.length && w.rng.chance(0.6) ? w.rng.pick(humans) : w.rng.pick(alive);
      const R = w.arenaRadius - 80;
      for (let tries = 0; tries < 8; tries++) {
        const a = w.rng.next() * TAU;
        const d = w.rng.range(720, 980);
        const x = victim.x + Math.cos(a) * d;
        const y = victim.y + Math.sin(a) * d;
        if (Math.hypot(x, y) > R) continue;
        const wr: Wraith = { id: w.allocId(), x, y, vx: 0, vy: 0, target: victim.id, stagger: 0, scared: false, age: 0 };
        this.wraiths.push(wr);
        w.events.push({ t: 'wraithSpawn', x, y, target: victim.id });
        break;
      }
    }
    if (this.sunTimer <= 0 && this.sunstones.length < SUNSTONE_MAX) {
      this.sunTimer = SUNSTONE_SPAWN_EVERY;
      this.spawnSunstone();
    }
  }

  private spawnSunstone(): void {
    const w = this.w;
    const p = w.rng.inDisc(w.arenaRadius * 0.8);
    this.sunstones.push({ id: w.allocId(), x: p.x, y: p.y });
  }

  // ───────────────────────────────────── AI

  private updateWraiths(dt: number): void {
    const w = this.w;
    const R = w.arenaRadius - 40;
    const retarget = this.retarget <= 0;
    if (retarget) this.retarget = 0.5;
    for (const wr of this.wraiths) {
      wr.age += dt;
      wr.stagger = Math.max(0, wr.stagger - dt);

      // anything Radiant nearby terrifies it
      let fx = 0;
      let fy = 0;
      for (const c of w.cores.values()) {
        if (!c.alive || c.radiant <= 0) continue;
        const dx = wr.x - c.x;
        const dy = wr.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 700) {
          fx += (dx / d) * (1 - d / 700);
          fy += (dy / d) * (1 - d / 700);
        }
      }
      wr.scared = fx !== 0 || fy !== 0;

      let dirX = 0;
      let dirY = 0;
      let speed = WRAITH_SPEED;
      if (wr.scared) {
        const l = Math.hypot(fx, fy) || 1;
        dirX = fx / l;
        dirY = fy / l;
        speed = WRAITH_FLEE_SPEED;
      } else {
        if (retarget) wr.target = this.pickTarget(wr);
        const t = w.cores.get(wr.target);
        if (t && t.alive) {
          // aim slightly ahead of the prey
          const tx = t.x + t.vx * 0.35;
          const ty = t.y + t.vy * 0.35;
          const dx = tx - wr.x;
          const dy = ty - wr.y;
          const l = Math.hypot(dx, dy) || 1;
          dirX = dx / l;
          dirY = dy / l;
          // lunge when close
          if (l < 260) speed *= 1.25;
        } else {
          dirX = -wr.x / (Math.hypot(wr.x, wr.y) || 1);
          dirY = -wr.y / (Math.hypot(wr.x, wr.y) || 1);
          speed *= 0.5;
        }
      }
      // emerging from the dark: slow at first
      if (wr.age < 1) speed *= 0.35 + wr.age * 0.65;
      if (wr.stagger > 0) speed *= 0.15;
      const k = damp(wr.stagger > 0 ? 1.5 : 3.2, dt);
      wr.vx += (dirX * speed - wr.vx) * k;
      wr.vy += (dirY * speed - wr.vy) * k;
      wr.x += wr.vx * dt;
      wr.y += wr.vy * dt;
      const d = Math.hypot(wr.x, wr.y);
      if (d > R) {
        wr.x *= R / d;
        wr.y *= R / d;
      }
    }
    // wraiths keep a little personal space so they come as a pack, not a blob
    for (let i = 0; i < this.wraiths.length; i++) {
      for (let j = i + 1; j < this.wraiths.length; j++) {
        const a = this.wraiths[i];
        const b = this.wraiths[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = WRAITH_RADIUS * 2.2;
        if (d < min) {
          const p = (min - d) / 2;
          a.x -= (dx / d) * p;
          a.y -= (dy / d) * p;
          b.x += (dx / d) * p;
          b.y += (dy / d) * p;
        }
      }
    }
  }

  private pickTarget(wr: Wraith): number {
    let best = -1;
    let bestScore = Infinity;
    for (const c of this.w.cores.values()) {
      if (!c.alive || c.shield > 0 || c.radiant > 0) continue;
      const d = Math.hypot(c.x - wr.x, c.y - wr.y);
      if (d > 1700) continue;
      // humans and the previous target are preferred; big cores are tastier but slower
      const score = d * (c.isBot ? 1 : 0.6) * (c.id === wr.target ? 0.7 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = c.id;
      }
    }
    return best;
  }

  // ───────────────────────────────────── collisions

  private collide(): void {
    const w = this.w;
    const victims: Core[] = [];
    const banished = new Set<Wraith>();
    for (const c of w.cores.values()) {
      if (!c.alive) continue;

      // pick up sunstones (phantoms can't)
      for (let i = this.sunstones.length - 1; !c.decoyOf && i >= 0; i--) {
        const s = this.sunstones[i];
        const rr = c.r + SUNSTONE_RADIUS + 6;
        if ((s.x - c.x) ** 2 + (s.y - c.y) ** 2 < rr * rr) {
          this.sunstones.splice(i, 1);
          c.radiant = RADIANT_SECS;
          w.events.push({ t: 'sunstone', core: c.id, x: s.x, y: s.y });
        }
      }

      for (const wr of this.wraiths) {
        if (banished.has(wr)) continue;
        const dx = wr.x - c.x;
        const dy = wr.y - c.y;
        const reach = c.orbitR + c.moonR + WRAITH_RADIUS;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const d = Math.sqrt(d2) || 1;

        if (c.radiant > 0) {
          // body or burning moons banish it
          let hit = d < c.r + WRAITH_RADIUS;
          for (let i = 0; !hit && i < c.mx.length; i++) {
            hit = (c.mx[i] - wr.x) ** 2 + (c.my[i] - wr.y) ** 2 < (c.moonR + WRAITH_RADIUS) ** 2;
          }
          if (hit) {
            banished.add(wr);
            this.banish(wr, c);
          }
          continue;
        }

        // ordinary moons ward it off — but shatter doing so
        if (wr.stagger <= 0) {
          for (let i = 0; i < c.mx.length; i++) {
            if ((c.mx[i] - wr.x) ** 2 + (c.my[i] - wr.y) ** 2 < (c.moonR + WRAITH_RADIUS * 0.8) ** 2) {
              const mx = c.mx[i];
              const my = c.my[i];
              c.moons.splice(i, 1);
              c.mx.splice(i, 1);
              c.my.splice(i, 1);
              c.regen = 0;
              wr.stagger = WRAITH_STAGGER_SECS;
              wr.vx = (dx / d) * 200;
              wr.vy = (dy / d) * 200;
              w.events.push({ t: 'ward', core: c.id, x: mx, y: my });
              break;
            }
          }
        }

        if (c.shield <= 0 && wr.stagger <= 0 && d < c.r + WRAITH_RADIUS * 0.7) {
          victims.push(c);
          break;
        }
      }
    }
    if (banished.size) this.wraiths = this.wraiths.filter((x) => !banished.has(x));
    for (const v of victims) w.kill(v, null, 'wraith');
  }

  private banish(wr: Wraith, by: Core): void {
    const w = this.w;
    by.mass += BANISH_MASS_REWARD;
    by.banished++;
    for (let i = 0; i < BANISH_DUST; i++) {
      const a = (i / BANISH_DUST) * TAU + w.rng.range(-0.2, 0.2);
      const r = w.rng.range(20, 90);
      w.addDust(wr.x + Math.cos(a) * r, wr.y + Math.sin(a) * r, 3, 6, wr.x, wr.y);
    }
    w.events.push({ t: 'banish', x: wr.x, y: wr.y, by: by.id, name: by.name });
  }
}
