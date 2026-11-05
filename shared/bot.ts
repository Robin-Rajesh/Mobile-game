import { SURGE_ORBIT_MULT, dustRadius } from './constants';
import { Rng, TAU, angleDiff, clamp } from './math';
import type { BotController, Core, World } from './world';

export interface Personality {
  /** 0..1 — how eagerly it picks fights */
  aggression: number;
  /** 0..1 — how early it runs from threats */
  caution: number;
  /** 0..1 — reaction speed and aim quality */
  skill: number;
  /** 0..1 — surges for dust / chases */
  greed: number;
}

type Mode = 'farm' | 'hunt' | 'flee';

const rng = new Rng();

export function randomPersonality(r: Rng = rng): Personality {
  // Skew the population: most bots are mediocre, a few are sharks.
  const tier = r.next();
  const skill = tier < 0.45 ? r.range(0.15, 0.45) : tier < 0.85 ? r.range(0.45, 0.75) : r.range(0.75, 0.98);
  return {
    aggression: tier > 0.85 ? r.range(0.6, 0.95) : r.range(0.05, 0.7),
    caution: r.range(0.2, 0.9),
    skill,
    greed: r.range(0.1, 0.8),
  };
}

/**
 * Utility-style bot: every "reaction" it re-scores farm / hunt / flee and writes a steering
 * angle + surge flag into the core's input, exactly like a human client would.
 */
export class BotBrain implements BotController {
  readonly p: Personality;
  private mode: Mode = 'farm';
  private thinkIn = 0;
  private targetId = -1;
  private wander: number;
  private aimNoise = 0;
  private surgeHold = 0;
  private modeLock = 0;
  private huntCooldown = 0;

  constructor(p?: Personality) {
    this.p = p ?? randomPersonality();
    this.wander = rng.next() * TAU;
  }

  get currentMode(): Mode {
    return this.mode;
  }

  think(world: World, me: Core, dt: number): void {
    this.surgeHold -= dt;
    this.modeLock -= dt;
    this.huntCooldown -= dt;
    this.thinkIn -= dt;
    if (this.thinkIn > 0) {
      if (this.surgeHold <= 0) me.input.surge = false;
      return;
    }
    // slower brains react later
    this.thinkIn = 0.08 + (1 - this.p.skill) * 0.32 + rng.range(0, 0.08);
    this.aimNoise = (rng.next() - 0.5) * (1 - this.p.skill) * 0.9;

    const R = world.arenaRadius;
    let gx = 0;
    let gy = 0;
    let surge = false;

    // ── threat assessment
    let dangerX = 0;
    let dangerY = 0;
    let danger = 0;
    let bestPrey: Core | null = null;
    let bestPreyScore = 0;
    const myReach = me.orbitR * (me.canSurge ? SURGE_ORBIT_MULT : 1) + me.moonR;

    for (const o of world.cores.values()) {
      if (o === me || !o.alive) continue;
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 1300) continue;

      const theirReach = o.orbitR * (o.canSurge ? (o.surging ? 1 : SURGE_ORBIT_MULT) : 1) + o.moonR + me.r;
      const margin = 60 + this.p.caution * 220;
      if (d < theirReach + margin && o.shield <= 0) {
        // closer and bigger orbit = scarier; their surging is extra scary
        const w = (1 - (d - theirReach * 0.6) / (theirReach + margin)) * (o.surging ? 1.6 : 1) * (o.moons.length / Math.max(3, me.moons.length));
        if (w > 0) {
          dangerX -= (dx / d) * w;
          dangerY -= (dy / d) * w;
          danger += w;
        }
      }

      // prey: something whose core we can sweep with our moons before theirs reach us
      if (o.shield <= 0 && me.shield <= 0 && this.huntCooldown <= 0) {
        const advantage = myReach - (o.orbitR + o.moonR + me.r * 0.5);
        // only the sharks take even fights
        if (advantage <= 0 && this.p.aggression < 0.75) continue;
        const sizeAppeal = Math.sqrt(o.mass) / (d * 0.004 + 1);
        const moonEdge = me.moons.length / Math.max(1, o.moons.length);
        const score = sizeAppeal * (advantage > 0 ? 1.4 : 0.5) * clamp(moonEdge, 0.4, 2) * this.p.aggression;
        if (score > bestPreyScore && d < 700 + this.p.aggression * 500) {
          bestPreyScore = score;
          bestPrey = o;
        }
      }
    }

    // ── choose mode (with a little hysteresis so bots don't flicker)
    const fleeThreshold = 0.3 + (1 - this.p.caution) * 0.7;
    if (this.modeLock <= 0) {
      const wasHunting = this.mode === 'hunt';
      if (danger > fleeThreshold) {
        this.mode = 'flee';
        this.modeLock = 0.6;
      } else if (!wasHunting && bestPrey && bestPreyScore > 1.1 - this.p.aggression * 0.5 && rng.chance(0.15 + this.p.aggression * 0.35)) {
        this.mode = 'hunt';
        this.targetId = bestPrey.id;
        this.modeLock = 1.5 + this.p.aggression * 2.5;
      } else {
        this.mode = 'farm';
      }
      if (wasHunting && this.mode !== 'hunt') this.huntCooldown = rng.range(4, 12) * (1.3 - this.p.aggression);
    }

    const target = this.mode === 'hunt' ? world.cores.get(this.targetId) : undefined;
    if (this.mode === 'hunt' && (!target || !target.alive)) this.mode = 'farm';

    if (this.mode === 'flee') {
      const dl = Math.hypot(dangerX, dangerY) || 1;
      gx = dangerX / dl;
      gy = dangerY / dl;
      // dodge sideways a little — running straight is predictable
      const side = me.spin * 0.35;
      const tx = -gy * side;
      const ty = gx * side;
      gx += tx;
      gy += ty;
      surge = me.mass > 60 && danger > fleeThreshold * 1.6 && rng.chance(0.3 + this.p.skill * 0.6);
    } else if (this.mode === 'hunt' && target) {
      // lead the target
      const lead = 0.25 + this.p.skill * 0.35;
      const tx = target.x + target.vx * lead;
      const ty = target.y + target.vy * lead;
      const dx = tx - me.x;
      const dy = ty - me.y;
      const d = Math.hypot(dx, dy) || 1;
      const toward = Math.atan2(dy, dx);
      const surgeR = me.orbitR * (me.canSurge ? SURGE_ORBIT_MULT : 1);
      const ideal = Math.max(target.orbitR + target.moonR + me.r + 20, Math.min(surgeR, me.orbitR * 1.25) + target.r * 0.4);
      let a: number;
      if (d > ideal * 1.5) {
        a = toward;
      } else {
        // circle-strafe: tangent with radial correction
        const radial = clamp((d - ideal) / ideal, -1, 1);
        a = toward + me.spin * (Math.PI / 2 - radial * 1.1);
      }
      gx = Math.cos(a);
      gy = Math.sin(a);
      // swell the orbit through them when they are in the band
      const inBand = Math.abs(d - surgeR) < target.r + me.moonR + 40 + this.p.skill * 30;
      surge = me.canSurge && inBand && rng.chance(0.45 + this.p.skill * 0.5);
      if (surge) this.surgeHold = 0.25 + this.p.skill * 0.35;
      // the more desperate, the more likely to give up
      if (danger > fleeThreshold * 0.8) this.modeLock = 0;
    } else {
      // farm: best dust cluster, starfall magnet, gentle wander
      let best = -1;
      let bx = 0;
      let by = 0;
      const look = 520;
      world.queryDust(me.x, me.y, look, (d) => {
        const dx = d.x - me.x;
        const dy = d.y - me.y;
        const dist = Math.hypot(dx, dy);
        if (dist > look) return;
        // prefer dust ahead of us (cheaper to turn to)
        const ahead = Math.cos(angleDiff(me.heading, Math.atan2(dy, dx)));
        const s = (d.v * (1.6 + ahead)) / (dist + 60) + dustRadius(d.v) * 0.0005;
        if (s > best) {
          best = s;
          bx = dx;
          by = dy;
        }
      });
      if (best > 0) {
        const l = Math.hypot(bx, by) || 1;
        gx = bx / l;
        gy = by / l;
        surge = this.p.greed > 0.6 && me.mass > 120 && best > 0.05 && rng.chance(0.1);
      } else {
        this.wander += rng.range(-0.6, 0.6);
        gx = Math.cos(this.wander);
        gy = Math.sin(this.wander);
      }
      const sf = world.starfall;
      if (sf) {
        const dx = sf.x - me.x;
        const dy = sf.y - me.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = (d < 2200 ? 1.4 : 0) * this.p.greed * (1 - danger);
        if (pull > 0 && d > sf.r * 0.5) {
          gx += (dx / d) * pull;
          gy += (dy / d) * pull;
          surge = surge || (me.mass > 80 && sf.landed && this.p.greed > 0.5);
        }
      }
      // mild repulsion from anyone nearby, scaled by danger
      if (danger > 0) {
        gx += dangerX * 0.8;
        gy += dangerY * 0.8;
      }
    }

    // ── never touch the rim
    const dc = Math.hypot(me.x, me.y);
    const edge = R - (me.r + 260 + me.orbitR * 0.3);
    if (dc > edge) {
      const push = clamp((dc - edge) / 220, 0, 3);
      gx += (-me.x / dc) * push * 2;
      gy += (-me.y / dc) * push * 2;
      if (push > 1.5) surge = false;
    }
    // heading straight at the rim — panic turn
    const lookAhead = me.r + 120 + (me.surging ? 120 : 0);
    const fx = me.x + Math.cos(me.heading) * lookAhead;
    const fy = me.y + Math.sin(me.heading) * lookAhead;
    if (Math.hypot(fx, fy) > R - me.r) {
      gx += -me.x / dc * 3;
      gy += -me.y / dc * 3;
      surge = false;
    }

    me.input.angle = Math.atan2(gy, gx) + this.aimNoise;
    me.input.surge = surge || (this.surgeHold > 0 && me.input.surge);
  }
}

const NAMES = [
  'mochi', 'Kevin', 'orbitz', 'luna', 'xX_moon_Xx', 'dad', 'pls no', 'spinzilla', 'Tomás', 'sakura', 'ghost',
  'big round boi', 'noodle', 'Ava', 'kiwi', 'eclipse', 'ZORP', 'mika', 'Juno', 'lil comet', 'bean', 'Rafa',
  'Moonwalker', 'snacc', 'Pip', 'grumpy', 'nyx', 'Leo', 'satellite', 'chomp', 'meteor_mike', 'Ari', 'yuki',
  'Halo', 'tofu', 'Gus', 'void', 'pebble', 'Zara', 'quasar', 'dumpling', 'Emi', 'oops', 'crater face', 'Milo',
  'Nova', 'biscuit', 'Kai', 'saturn', 'IKE', 'lumen', 'poppy', 'Ozzy', 'stardust', 'Remy', 'frog', 'Indi',
  'spin2win', 'bolt', 'Nina', 'gloop', 'apollo', 'wren', 'jellybean', 'Tito', 'ORBIT GOD', 'momo', 'Sol',
  'cosmo', 'Bea', 'pudding', 'Finn', 'zz', 'mango', 'hehe', 'Rex', 'turnip', 'Lola', 'kraken', 'dot',
];

export function randomBotName(r: Rng = rng, taken?: Set<string>): string {
  for (let i = 0; i < 8; i++) {
    const n = r.pick(NAMES);
    if (!taken || !taken.has(n)) return n;
  }
  return r.pick(NAMES) + r.int(2, 99);
}
