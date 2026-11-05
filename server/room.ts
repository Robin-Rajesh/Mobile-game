import type { WebSocket } from 'ws';
import { BotBrain, randomBotName } from '../shared/bot';
import { encodeCore, encodeDust, encodeFreeMoon } from '../shared/codec';
import { NAME_MAX_LEN, ROOM_CAPACITY, ROOM_TARGET_POPULATION, SERVER_TICK_RATE, SNAPSHOT_EVERY_N_TICKS } from '../shared/constants';
import { Rng, clamp } from '../shared/math';
import { PROTOCOL_VERSION, isNameAllowed, sanitizeName } from '../shared/protocol';
import type { BoardTuple, ClientMsg, PlayerTuple, ServerMsg } from '../shared/protocol';
import { BOT_SKIN_POOL, isValidSkin } from '../shared/skins';
import { isPowerId } from '../shared/powers';
import { World } from '../shared/world';
import type { Core } from '../shared/world';

export interface Client {
  ws: WebSocket;
  name: string;
  skin: number;
  coreId: number | null;
  joined: boolean;
  msgBudget: number;
  lastSeen: number;
}

const DT = 1 / SERVER_TICK_RATE;
const rng = new Rng();

export class Room {
  readonly world = new World();
  readonly clients = new Set<Client>();
  private timer: NodeJS.Timeout | null = null;
  private lastLeaderboard = 0;
  private lastPopulation = 0;
  private emptySince = Date.now();

  constructor(readonly id: string) {
    this.world.botFactory = () => new BotBrain();
    this.balanceBots(true);
  }

  get humans(): number {
    return this.clients.size;
  }

  get hasSpace(): boolean {
    return this.clients.size < ROOM_CAPACITY - 2;
  }

  get idleMs(): number {
    return this.clients.size === 0 ? Date.now() - this.emptySince : 0;
  }

  start(): void {
    let last = performance.now();
    let acc = 0;
    // setInterval drifts; accumulate real time and step a fixed DT.
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= DT) {
        acc -= DT;
        this.world.step(DT);
        if (this.world.tick % SNAPSHOT_EVERY_N_TICKS === 0) this.broadcastSnapshot();
      }
    }, 1000 / SERVER_TICK_RATE / 2);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ───────────────────────────────────────── clients

  add(client: Client): void {
    this.clients.add(client);
  }

  remove(client: Client): void {
    this.clients.delete(client);
    if (client.coreId !== null) {
      this.world.removeCore(client.coreId);
      this.broadcast({ t: 'pl', id: client.coreId });
      client.coreId = null;
    }
    if (this.clients.size === 0) this.emptySince = Date.now();
    this.balanceBots(false);
  }

  handle(client: Client, msg: ClientMsg): void {
    switch (msg.t) {
      case 'join': {
        if (msg.v !== PROTOCOL_VERSION) {
          this.send(client, { t: 'error', msg: 'outdated' });
          client.ws.close(4000, 'outdated client');
          return;
        }
        if (client.coreId !== null && this.world.cores.get(client.coreId)?.alive) return;
        let name = sanitizeName(msg.name, NAME_MAX_LEN);
        if (!name || !isNameAllowed(name)) name = 'moonling';
        client.name = name;
        client.skin = isValidSkin(msg.skin) ? msg.skin : 0;
        // NOTE: power unlocks are client-side progression; a hardened deployment should verify them server-side.
        const core = this.world.addCore(client.name, client.skin, false, undefined, isPowerId(msg.power) ? msg.power : 'bubble');
        client.coreId = core.id;
        if (!client.joined) {
          client.joined = true;
          this.send(client, this.welcome(core.id));
        } else {
          this.send(client, { t: 'you', id: core.id });
        }
        this.balanceBots(false);
        break;
      }
      case 'in': {
        const core = client.coreId !== null ? this.world.cores.get(client.coreId) : undefined;
        if (core) {
          core.input.angle = msg.a;
          core.input.surge = msg.s === 1;
        }
        break;
      }
      case 'pw': {
        const core = client.coreId !== null ? this.world.cores.get(client.coreId) : undefined;
        if (core) this.world.powers.use(core);
        break;
      }
      case 'ping':
        this.send(client, { t: 'pong', c: msg.c, s: Date.now() });
        break;
      case 'leave':
        if (client.coreId !== null) {
          this.world.removeCore(client.coreId);
          this.broadcast({ t: 'pl', id: client.coreId });
          client.coreId = null;
        }
        break;
    }
  }

  private welcome(id: number): ServerMsg {
    const players: PlayerTuple[] = [];
    for (const c of this.world.cores.values()) players.push([c.id, c.name, c.skin, c.isBot ? 1 : 0]);
    const dust = [];
    for (const d of this.world.dust.values()) dust.push(encodeDust(d));
    return { t: 'welcome', v: PROTOCOL_VERSION, id, arena: this.world.arenaRadius, time: this.world.time, dust, players };
  }

  // ───────────────────────────────────────── bots

  /** Keep the arena lively: bots fill the room up to the target population. */
  private balanceBots(initial: boolean): void {
    const w = this.world;
    const desired = Math.max(4, ROOM_TARGET_POPULATION - this.clients.size);
    let bots = w.bots.size + w.pendingBotRespawns;
    const taken = new Set<string>();
    for (const c of w.cores.values()) taken.add(c.name);
    while (bots < desired) {
      const core = w.addCore(randomBotName(rng, taken), rng.pick(BOT_SKIN_POOL), true, new BotBrain());
      taken.add(core.name);
      if (initial) {
        // stagger initial sizes so the leaderboard looks lived-in
        core.mass = rng.range(20, 300) * (rng.chance(0.15) ? 4 : 1);
        core.shield = 0;
      }
      bots++;
    }
    if (bots > desired) {
      bots -= w.cancelBotRespawns(bots - desired);
      // retire the smallest bots first so nobody sees a leader vanish
      const living = [...w.bots.keys()].map((id) => w.cores.get(id)).filter((c): c is Core => !!c).sort((a, b) => a.mass - b.mass);
      while (bots > desired && living.length) {
        const c = living.shift()!;
        w.removeCore(c.id);
        this.broadcast({ t: 'pl', id: c.id });
        bots--;
      }
    }
  }

  // ───────────────────────────────────────── broadcast

  private broadcastSnapshot(): void {
    const w = this.world;
    const now = Date.now();

    // newly spawned cores → player info first so clients can label them
    for (const e of w.events) {
      if (e.t === 'spawn') {
        const c = w.cores.get(e.core);
        if (c) this.broadcast({ t: 'pj', p: [c.id, c.name, c.skin, c.isBot ? 1 : 0] });
      }
    }

    const cores = [];
    for (const c of w.cores.values()) if (c.alive) cores.push(encodeCore(c));
    const sf = w.starfall;
    const events = w.events.filter((e) => e.t !== 'spawn');
    const snap: ServerMsg = {
      t: 's',
      k: w.tick,
      time: Math.round(w.time * 1000) / 1000,
      c: cores,
      fm: w.freeMoons.map(encodeFreeMoon),
      da: w.addedDust.map(encodeDust),
      dr: w.removedDust.map((d) => d.id),
      e: events,
      bm: w.bloodMoon.phase === 'calm' ? null : { p: w.bloodMoon.phase === 'warn' ? 1 : 2, in: Math.round(w.bloodMoon.remaining * 100) / 100 },
      wr: w.bloodMoon.wraiths.map((x) => [x.id, Math.round(x.x), Math.round(x.y), (x.scared ? 1 : 0) | (x.stagger > 0 ? 2 : 0)]),
      ss: w.bloodMoon.sunstones.map((x) => [x.id, Math.round(x.x), Math.round(x.y)]),
      tr: w.powers.traps.map((x) => [x.id, Math.round(x.x), Math.round(x.y), x.owner]),
      wh: [...w.cores.values()].filter((c) => c.worm).map((c) => [c.id, Math.round(c.worm!.x), Math.round(c.worm!.y)]),
      bo: w.powers.blackouts.map((b) => [b.owner, Math.round(b.x), Math.round(b.y), b.r, Math.round((b.until - w.time) * 10) / 10]),
      sf: sf ? { x: Math.round(sf.x), y: Math.round(sf.y), r: sf.r, in: Math.round((sf.at - w.time) * 100) / 100 } : null,
    };

    // a human whose core died is now waiting to respawn
    for (const e of events) {
      if (e.t !== 'kill') continue;
      for (const cl of this.clients) if (cl.coreId === e.victim) cl.coreId = null;
    }
    this.broadcastRaw(JSON.stringify(snap));
    w.flush();

    if (now - this.lastLeaderboard > 1000) {
      this.lastLeaderboard = now;
      const ranking = w.ranking();
      const l: BoardTuple[] = ranking.slice(0, 10).map((c) => [c.id, Math.round(c.mass), c.kills]);
      this.broadcast({ t: 'lb', l, n: ranking.length });
    }
    if (now - this.lastPopulation > 2000) {
      this.lastPopulation = now;
      this.balanceBots(false);
    }
  }

  send(client: Client, msg: ServerMsg): void {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg): void {
    this.broadcastRaw(JSON.stringify(msg));
  }

  private broadcastRaw(data: string): void {
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      // back-pressure: skip a frame for clients whose socket is congested
      if (c.ws.bufferedAmount > 256 * 1024) continue;
      c.ws.send(data);
    }
  }

  /** Inbound rate limiting: token bucket refilled each second. */
  static allowMessage(client: Client): boolean {
    const now = Date.now();
    const elapsed = (now - client.lastSeen) / 1000;
    client.lastSeen = now;
    client.msgBudget = clamp(client.msgBudget + elapsed * 40, 0, 80);
    if (client.msgBudget < 1) return false;
    client.msgBudget -= 1;
    return true;
  }
}
