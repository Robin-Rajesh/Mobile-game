import { BotBrain, randomBotName } from '../../../shared/bot';
import { LOCAL_TICK_RATE } from '../../../shared/constants';
import { Rng } from '../../../shared/math';
import { BOT_SKIN_POOL } from '../../../shared/skins';
import { World } from '../../../shared/world';
import type { BoardEntry, FrameOutput, PlayerInput, Session, ViewCore, ViewDust, ViewFreeMoon } from './session';

const STEP = 1 / LOCAL_TICK_RATE;
const BOT_COUNT = 17;

/**
 * Offline arena: the exact same simulation the server runs, hosted in the browser with bots.
 * Also powers the living background behind the main menu.
 */
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  readonly world: World;
  meId: number | null = null;
  readonly rtt = 0;
  readonly lost = false;
  private acc = 0;
  private rng = new Rng();

  constructor() {
    this.world = new World();
    this.world.botFactory = () => new BotBrain();
    const taken = new Set<string>();
    for (let i = 0; i < BOT_COUNT; i++) {
      const name = randomBotName(this.rng, taken);
      taken.add(name);
      const c = this.world.addCore(name, this.rng.pick(BOT_SKIN_POOL), true, new BotBrain());
      // a lived-in arena: a few chunky leaders and a crowd of small fry
      c.mass = this.rng.range(20, 260) * (this.rng.chance(0.18) ? this.rng.range(3, 7) : 1);
      c.shield = 0;
    }
    // warm up so the first frame already looks mid-match
    for (let i = 0; i < LOCAL_TICK_RATE * 4; i++) this.world.step(STEP);
    this.world.flush();
  }

  get arenaRadius(): number {
    return this.world.arenaRadius;
  }
  get cores(): Map<number, ViewCore> {
    return this.world.cores;
  }
  get dust(): Map<number, ViewDust> {
    return this.world.dust;
  }
  get freeMoons(): ViewFreeMoon[] {
    return this.world.freeMoons;
  }
  get starfall(): { x: number; y: number; r: number; in: number } | null {
    const sf = this.world.starfall;
    return sf ? { x: sf.x, y: sf.y, r: sf.r, in: sf.at - this.world.time } : null;
  }

  update(dt: number, input: PlayerInput | null, timeScale: number): void {
    const me = this.meId !== null ? this.world.cores.get(this.meId) : undefined;
    if (me && input) {
      me.input.angle = input.angle;
      me.input.surge = input.surge;
    }
    this.acc += Math.min(dt, 0.1) * timeScale;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this.acc -= STEP;
      this.world.step(STEP);
      steps++;
    }
  }

  drain(out: FrameOutput): void {
    const w = this.world;
    for (const e of w.events) out.events.push(e);
    for (const d of w.addedDust) out.added.push(d);
    for (const d of w.removedDust) out.removed.push(d);
    w.flush();
  }

  board(): BoardEntry[] {
    return this.world
      .ranking()
      .slice(0, 10)
      .map((c) => ({ id: c.id, name: c.name, mass: Math.round(c.mass), kills: c.kills, skin: c.skin }));
  }

  rankOf(id: number): number {
    const r = this.world.ranking();
    const i = r.findIndex((c) => c.id === id);
    return i < 0 ? r.length + 1 : i + 1;
  }

  population(): number {
    return this.world.cores.size;
  }

  spawn(name: string, skin: number): void {
    const core = this.world.addCore(name, skin, false);
    this.meId = core.id;
    // bots shouldn't feel like they're queueing to eat the newcomer
    core.shield = 3.5;
  }

  leave(): void {
    if (this.meId !== null) this.world.removeCore(this.meId);
    this.meId = null;
  }

  dispose(): void {
    /* nothing to release */
  }
}
