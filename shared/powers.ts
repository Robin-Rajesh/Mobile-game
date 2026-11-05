import { TAU } from './math';
import type { Core, World } from './world';

export type PowerId = 'blink' | 'bubble' | 'decoy' | 'snare' | 'mimic' | 'blackout';

export interface PowerDef {
  id: PowerId;
  name: string;
  /** one-line pitch for the picker */
  blurb: string;
  /** longer how-to */
  how: string;
  cooldown: number;
  unlockLevel: number;
  color: string;
}

export const POWERS: readonly PowerDef[] = [
  { id: 'blink', name: 'Wormhole', blurb: 'Drop a portal. Warp back to it.', how: 'Tap to open a wormhole where you are. Tap again within 10s to warp back to it — anyone can see your portal, so use it to bait.', cooldown: 14, unlockLevel: 1, color: '#7C5CFF' },
  { id: 'bubble', name: 'Bubble', blurb: 'Nothing can bite you for 2.8s.', how: 'Wrap yourself in a bubble: no bites, no wraiths. Your moons can’t bite while it’s up either — it’s for diving through danger.', cooldown: 18, unlockLevel: 1, color: '#7AD3FF' },
  { id: 'decoy', name: 'Phantom', blurb: 'A perfect fake of you runs off.', how: 'Release a phantom with your name, skin and moons. It keeps running the way you were heading. Hunters and wraiths fall for it. One touch pops it.', cooldown: 16, unlockLevel: 2, color: '#C49BFF' },
  { id: 'snare', name: 'Snare', blurb: 'Hidden traps that freeze moons.', how: 'Drop a near-invisible snare (max 2). Whoever touches it is slowed to a crawl and their moons stop spinning for 2s.', cooldown: 8, unlockLevel: 4, color: '#5EE6B0' },
  { id: 'mimic', name: 'Mimic', blurb: 'Steal someone’s face and name.', how: 'Disguise yourself as the nearest player for 8s. Bots think you’re harmless. Biting someone breaks the disguise — make it count.', cooldown: 22, unlockLevel: 6, color: '#FF9F43' },
  { id: 'blackout', name: 'Blackout', blurb: 'Kill the lights around you.', how: 'Everyone within range goes nearly blind for 6s — they can only see what’s right next to them. You see everything.', cooldown: 24, unlockLevel: 9, color: '#3D2B6B' },
];

export const POWER_IDS = POWERS.map((p) => p.id);

export function powerDef(id: PowerId): PowerDef {
  return POWERS.find((p) => p.id === id) ?? POWERS[0];
}

export function isPowerId(v: unknown): v is PowerId {
  return typeof v === 'string' && (POWER_IDS as string[]).includes(v);
}

export const WORMHOLE_TTL = 10;
export const BUBBLE_SECS = 2.8;
export const DECOY_SECS = 7;
export const SNARE_SECS = 2.2;
export const SNARE_LIFETIME = 28;
export const SNARE_RADIUS = 22;
export const SNARE_MAX = 2;
export const MIMIC_SECS = 8;
export const BLACKOUT_SECS = 6;
export const BLACKOUT_RADIUS = 950;

export interface Trap {
  id: number;
  owner: number;
  x: number;
  y: number;
  life: number;
}

export interface Blackout {
  owner: number;
  x: number;
  y: number;
  r: number;
  until: number;
}

/**
 * Role-style abilities. Each core carries one power with a cooldown; pressing the power
 * button calls use(). Everything is simulated here so it is authoritative online.
 */
export class Powers {
  traps: Trap[] = [];
  blackouts: Blackout[] = [];

  constructor(private w: World) {}

  use(c: Core): boolean {
    if (!c.alive || c.decoyOf) return false;
    const w = this.w;
    // wormhole's second press is allowed while "armed"
    if (c.power === 'blink' && c.worm) {
      const fx = c.x;
      const fy = c.y;
      c.x = c.worm.x;
      c.y = c.worm.y;
      c.worm = null;
      c.powerCd = powerDef('blink').cooldown;
      w.computeMoonPositions(c);
      w.events.push({ t: 'warp', core: c.id, fx, fy, x: c.x, y: c.y });
      w.events.push({ t: 'power', core: c.id, kind: 'blink', phase: 'use', cd: c.powerCd });
      return true;
    }
    if (c.powerCd > 0) return false;
    const def = powerDef(c.power);
    switch (c.power) {
      case 'blink':
        c.worm = { x: c.x, y: c.y, ttl: WORMHOLE_TTL };
        w.events.push({ t: 'power', core: c.id, kind: 'blink', phase: 'armed', cd: 0 });
        return true;
      case 'bubble':
        c.shield = Math.max(c.shield, BUBBLE_SECS);
        break;
      case 'decoy':
        this.spawnDecoy(c);
        break;
      case 'snare': {
        const mine = this.traps.filter((t) => t.owner === c.id);
        if (mine.length >= SNARE_MAX) this.traps.splice(this.traps.indexOf(mine[0]), 1);
        // drop it just behind you, where a chaser will run
        const back = c.r + SNARE_RADIUS + 6;
        this.traps.push({ id: w.allocId(), owner: c.id, x: c.x - Math.cos(c.heading) * back, y: c.y - Math.sin(c.heading) * back, life: SNARE_LIFETIME });
        break;
      }
      case 'mimic': {
        let best: Core | null = null;
        let bd = Infinity;
        for (const o of w.cores.values()) {
          if (o === c || !o.alive || o.decoyOf) continue;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (!best) return false;
        if (c.disguise <= 0) {
          c.realName = c.name;
          c.realSkin = c.skin;
        }
        c.name = best.name;
        c.skin = best.skin;
        c.disguise = MIMIC_SECS;
        w.events.push({ t: 'disguise', core: c.id, name: c.name, skin: c.skin, on: true });
        break;
      }
      case 'blackout':
        this.blackouts.push({ owner: c.id, x: c.x, y: c.y, r: BLACKOUT_RADIUS, until: w.time + BLACKOUT_SECS });
        break;
    }
    c.powerCd = def.cooldown;
    w.events.push({ t: 'power', core: c.id, kind: c.power, phase: 'use', cd: c.powerCd });
    return true;
  }

  endDisguise(c: Core): void {
    if (c.disguise <= 0 && !c.realName) return;
    c.disguise = 0;
    if (c.realName) {
      c.name = c.realName;
      c.skin = c.realSkin;
      c.realName = '';
    }
    this.w.events.push({ t: 'disguise', core: c.id, name: c.name, skin: c.skin, on: false });
  }

  private spawnDecoy(c: Core): void {
    const w = this.w;
    const d = w.addCore(c.name, c.skin, c.isBot);
    d.decoyOf = c.id;
    d.decoyLife = DECOY_SECS;
    d.x = c.x + Math.cos(c.heading + Math.PI / 2) * (c.r * 0.6);
    d.y = c.y + Math.sin(c.heading + Math.PI / 2) * (c.r * 0.6);
    d.vx = c.vx;
    d.vy = c.vy;
    d.heading = c.heading;
    d.input.angle = c.heading + (w.rng.next() - 0.5) * 0.6;
    d.mass = c.mass;
    d.moons = c.moons.slice();
    d.orbitAngle = c.orbitAngle;
    d.orbitR = c.orbitR;
    d.spin = c.spin;
    d.shield = 0;
    w.computeMoonPositions(d);
    w.events.push({ t: 'decoy', core: c.id, decoy: d.id });
  }

  /** Per-tick: cooldowns, timers, traps, blackouts. Called from World.step before combat. */
  step(dt: number): void {
    const w = this.w;
    for (const c of w.cores.values()) {
      if (!c.alive || c.decoyOf) continue;
      if (c.powerCd > 0) c.powerCd = Math.max(0, c.powerCd - dt);
      if (c.worm) {
        c.worm.ttl -= dt;
        if (c.worm.ttl <= 0) {
          c.worm = null;
          c.powerCd = powerDef('blink').cooldown * 0.6;
          w.events.push({ t: 'power', core: c.id, kind: 'blink', phase: 'expire', cd: c.powerCd });
        }
      }
      if (c.disguise > 0) {
        c.disguise -= dt;
        if (c.disguise <= 0) this.endDisguise(c);
      }
      if (c.snared > 0) c.snared = Math.max(0, c.snared - dt);
      c.blind = Math.max(0, c.blind - dt);
    }

    // traps: invisible-ish, single use
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      t.life -= dt;
      if (t.life <= 0 || !w.cores.has(t.owner)) {
        this.traps.splice(i, 1);
        continue;
      }
      for (const c of w.cores.values()) {
        if (!c.alive || c.id === t.owner || c.decoyOf || c.shield > 0) continue;
        const rr = c.r + SNARE_RADIUS;
        if ((c.x - t.x) ** 2 + (c.y - t.y) ** 2 < rr * rr) {
          c.snared = SNARE_SECS;
          c.surging = false;
          this.traps.splice(i, 1);
          w.events.push({ t: 'snared', core: c.id, x: t.x, y: t.y, by: t.owner });
          break;
        }
      }
    }

    // blackouts follow their caster
    for (let i = this.blackouts.length - 1; i >= 0; i--) {
      const b = this.blackouts[i];
      const owner = w.cores.get(b.owner);
      if (w.time >= b.until || !owner) {
        this.blackouts.splice(i, 1);
        continue;
      }
      b.x = owner.x;
      b.y = owner.y;
      for (const c of w.cores.values()) {
        if (c === owner || !c.alive || c.decoyOf) continue;
        if ((c.x - b.x) ** 2 + (c.y - b.y) ** 2 < b.r * b.r) c.blind = Math.max(c.blind, 0.25);
      }
    }
  }

  // ───────────────────────────────────── phantoms (all decoy rules live here)

  /** Per-tick upkeep. Returns false if the phantom expired and was removed. */
  tickPhantom(c: Core, dt: number): boolean {
    c.decoyLife -= dt;
    if (c.decoyLife <= 0) {
      this.popPhantom(c, null);
      return false;
    }
    // gentle wander so it doesn't look like it's on rails
    c.input.angle = (c.input.angle + (this.w.rng.next() - 0.5) * 0.08) % TAU;
    return true;
  }

  /** A real core and a phantom overlap: anything but its owner touching it pops it. */
  phantomContact(a: Core, b: Core): { phantom: Core; by: Core } | null {
    if (a.decoyOf && b.decoyOf) return null;
    const phantom = a.decoyOf ? a : b;
    const real = a.decoyOf ? b : a;
    if (real.id === phantom.decoyOf) return null;
    let hit = Math.hypot(real.x - phantom.x, real.y - phantom.y) < phantom.r + real.r;
    for (let p = 0; !hit && p < real.mx.length; p++) {
      const ed = Math.hypot(real.mx[p] - phantom.x, real.my[p] - phantom.y);
      hit = ed < real.moonR + phantom.r || Math.abs(ed - phantom.orbitR) < real.moonR + phantom.moonR;
    }
    return hit ? { phantom, by: real } : null;
  }

  /** A phantom vanishes — it fooled someone, or simply ran out. */
  popPhantom(d: Core, by: Core | null): void {
    const w = this.w;
    if (!w.cores.has(d.id)) return;
    w.cores.delete(d.id);
    w.events.push({ t: 'decoyPop', id: d.id, owner: d.decoyOf, x: d.x, y: d.y, by: by ? by.id : null, byName: by ? by.name : '' });
  }

  /** Bookkeeping when a real core dies. */
  onKill(victim: Core, killer: Core | null): void {
    // a bite gives a mimic away
    if (killer && killer.disguise > 0) this.endDisguise(killer);
    this.forget(victim.id);
  }

  /** Remove everything a core owned: phantoms, traps, blackouts. */
  forget(id: number): void {
    for (const c of this.w.cores.values()) if (c.decoyOf === id) this.popPhantom(c, null);
    this.traps = this.traps.filter((t) => t.owner !== id);
    this.blackouts = this.blackouts.filter((b) => b.owner !== id);
  }
}
