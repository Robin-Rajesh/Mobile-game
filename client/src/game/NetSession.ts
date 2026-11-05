import { decodeCore } from '../../../shared/codec';
import type { DecodedCore } from '../../../shared/codec';
import { SURGE_SPEED_MULT, baseSpeed, coreRadius, moonRadius, turnRate } from '../../../shared/constants';
import { angleDiff, damp, lerp, lerpAngle } from '../../../shared/math';
import { PROTOCOL_VERSION } from '../../../shared/protocol';
import type { ClientMsg, DustTuple, ServerMsg } from '../../../shared/protocol';
import { insertMoonOffset, spreadMoonOffsets } from '../../../shared/world';
import type { GameEvent } from '../../../shared/world';
import type { PowerId } from '../../../shared/powers';
import type { ViewBlackout, ViewTrap, ViewWorm } from './session';
import type { BloodState, BoardEntry, FrameOutput, PlayerInput, Session, ViewCore, ViewDust, ViewFreeMoon, ViewSunstone, ViewWraith } from './session';

/** Render remote entities this far in the past so we always have two snapshots to blend. */
const INTERP_DELAY = 0.11;

class NetCore implements ViewCore {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  heading = 0;
  mass = 20;
  moons: number[] = [];
  orbitAngle = 0;
  orbitR = 60;
  surging = false;
  shield = 0;
  radiant = 0;
  snared = 0;
  spin: 1 | -1 = 1;
  /** Count the server says we should have; offsets ease toward it. */
  moonTarget = 0;
  constructor(
    readonly id: number,
    public name: string,
    public skin: number,
    readonly isBot: boolean,
  ) {}
  get r(): number {
    return coreRadius(this.mass);
  }
  get moonR(): number {
    return moonRadius(this.mass);
  }
}

interface Snapshot {
  time: number;
  cores: Map<number, DecodedCore>;
  fm: ViewFreeMoon[];
  sf: { x: number; y: number; r: number; in: number } | null;
  wr: Map<number, [number, number, number, number]>;
  ss: ViewSunstone[];
  bm: { p: 1 | 2; in: number } | null;
  tr: ViewTrap[];
  wh: ViewWorm[];
  bo: ViewBlackout[];
}

interface Pending {
  time: number;
  events: GameEvent[];
  added: DustTuple[];
  removed: number[];
}

export class NetSession implements Session {
  readonly kind = 'online' as const;
  arenaRadius = 3000;
  meId: number | null = null;
  readonly cores = new Map<number, NetCore>();
  readonly dust = new Map<number, ViewDust>();
  freeMoons: ViewFreeMoon[] = [];
  starfall: { x: number; y: number; r: number; in: number } | null = null;
  wraiths: ViewWraith[] = [];
  sunstones: ViewSunstone[] = [];
  blood: BloodState = { phase: 'calm', in: 999 };
  traps: ViewTrap[] = [];
  worms: ViewWorm[] = [];
  blackouts: ViewBlackout[] = [];
  private wraithMap = new Map<number, ViewWraith>();
  rtt = 80;
  lost = false;

  private players = new Map<number, { name: string; skin: number; bot: boolean }>();
  private snaps: Snapshot[] = [];
  private pending: Pending[] = [];
  private out: FrameOutput = { events: [], added: [], removed: [] };
  private lb: BoardEntry[] = [];
  private pop = 0;
  private clockOffset: number | null = null;
  private lastSent = { a: 0, s: 0, at: 0 };
  private pingTimer: number;
  private onReady: ((ok: boolean) => void) | null = null;
  /** Predicted state for our own core — hides round-trip latency. */
  private pred = { x: 0, y: 0, vx: 0, vy: 0, heading: 0, init: false };

  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => this.onMessage(ev.data as string);
    ws.onclose = () => {
      this.lost = true;
      this.onReady?.(false);
    };
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }

  /** Connect and join. Resolves null on failure/timeout so the caller can fall back offline. */
  static connect(url: string, name: string, skin: number, power: PowerId, timeoutMs = 3500): Promise<NetSession | null> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        resolve(null);
        return;
      }
      const s = new NetSession(ws);
      const timer = window.setTimeout(() => {
        s.dispose();
        resolve(null);
      }, timeoutMs);
      s.onReady = (ok) => {
        clearTimeout(timer);
        s.onReady = null;
        if (!ok) s.dispose();
        resolve(ok ? s : null);
      };
      ws.onopen = () => s.send({ t: 'join', v: PROTOCOL_VERSION, name, skin, power });
      ws.onerror = () => s.onReady?.(false);
    });
  }

  /** Quick reachability + latency probe used by the main menu. */
  static probe(url: string, timeoutMs = 2500): Promise<number | null> {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return resolve(null);
      }
      const done = (v: number | null) => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(v);
      };
      const timer = window.setTimeout(() => done(null), timeoutMs);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'ping', c: performance.now() }));
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data as string) as ServerMsg;
          if (m.t === 'pong') done(Math.round(performance.now() - m.c));
        } catch {
          done(null);
        }
      };
      ws.onerror = () => done(null);
    });
  }

  private send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private player(id: number): NetCore | undefined {
    let c = this.cores.get(id);
    if (!c) {
      const p = this.players.get(id);
      if (!p) return undefined;
      c = new NetCore(id, p.name, p.skin, p.bot);
      this.cores.set(id, c);
    }
    return c;
  }

  private onMessage(raw: string): void {
    let m: ServerMsg;
    try {
      m = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome': {
        this.arenaRadius = m.arena;
        this.meId = m.id;
        for (const [id, x, y, v, c] of m.dust) this.dust.set(id, { id, x, y, v, c });
        for (const [id, name, skin, bot] of m.players) this.players.set(id, { name, skin, bot: bot === 1 });
        this.clockOffset = m.time - performance.now() / 1000;
        this.onReady?.(true);
        break;
      }
      case 'you':
        this.meId = m.id;
        this.pred.init = false;
        break;
      case 'pj':
        this.players.set(m.p[0], { name: m.p[1], skin: m.p[2], bot: m.p[3] === 1 });
        break;
      case 'pl':
        this.players.delete(m.id);
        this.cores.delete(m.id);
        break;
      case 'lb':
        this.pop = m.n;
        this.lb = m.l.map(([id, mass, kills]) => {
          const p = this.players.get(id);
          return { id, mass, kills, name: p?.name ?? '?', skin: p?.skin ?? 0 };
        });
        break;
      case 'pong':
        this.rtt = lerp(this.rtt, performance.now() - m.c, 0.3);
        break;
      case 's': {
        const now = performance.now() / 1000;
        const target = m.time - now;
        // smooth the clock, but snap on big discontinuities (tab was backgrounded)
        if (this.clockOffset === null || Math.abs(target - this.clockOffset) > 0.5) this.clockOffset = target;
        else this.clockOffset = lerp(this.clockOffset, target, 0.05);
        const cores = new Map<number, DecodedCore>();
        for (const t of m.c) cores.set(t[0], decodeCore(t));
        const wr = new Map<number, [number, number, number, number]>();
        for (const t of m.wr ?? []) wr.set(t[0], t);
        this.snaps.push({
          time: m.time,
          cores,
          fm: m.fm.map(([id, x, y, skin]) => ({ id, x, y, skin })),
          sf: m.sf,
          wr,
          ss: (m.ss ?? []).map(([id, x, y]) => ({ id, x, y })),
          bm: m.bm ?? null,
          tr: (m.tr ?? []).map(([id, x, y, owner]) => ({ id, x, y, owner })),
          wh: (m.wh ?? []).map(([owner, x, y]) => ({ owner, x, y })),
          bo: (m.bo ?? []).map(([owner, x, y, r]) => ({ owner, x, y, r })),
        });
        if (this.snaps.length > 30) this.snaps.shift();
        this.pending.push({ time: m.time, events: m.e, added: m.da, removed: m.dr });
        break;
      }
      case 'error':
        console.warn('[net] server error', m.msg);
        break;
    }
  }

  update(dt: number, input: PlayerInput | null): void {
    if (this.clockOffset === null || this.snaps.length === 0) return;
    const renderTime = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;

    this.releasePending(renderTime);

    // find the bracketing snapshots
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].time > renderTime) i--;
    const b = this.snaps[i];
    const a = i > 0 ? this.snaps[i - 1] : b;
    const span = b.time - a.time;
    const t = span > 0 ? Math.max(0, Math.min(1.2, (renderTime - a.time) / span)) : 1;

    for (const [id, db] of b.cores) {
      const c = this.player(id);
      if (!c) continue;
      const da = a.cores.get(id) ?? db;
      const px = c.x;
      const py = c.y;
      c.x = lerp(da.x, db.x, t);
      c.y = lerp(da.y, db.y, t);
      if (dt > 0) {
        c.vx = (c.x - px) / dt;
        c.vy = (c.y - py) / dt;
      }
      c.heading = lerpAngle(da.heading, db.heading, t);
      c.mass = lerp(da.mass, db.mass, t);
      c.orbitAngle = lerpAngle(da.orbitAngle, db.orbitAngle, t);
      c.orbitR = lerp(da.orbitR, db.orbitR, t);
      c.surging = db.surging;
      c.shield = db.shield ? 1 : 0;
      c.radiant = db.radiant ? 1 : 0;
      c.snared = db.snared ? 1 : 0;
      c.spin = db.spin;
      c.moonTarget = db.moons;
    }

    // moon offsets: same easing the server uses
    for (const c of this.cores.values()) {
      while (c.moons.length < c.moonTarget) insertMoonOffset(c.moons);
      while (c.moons.length > c.moonTarget) c.moons.pop();
      spreadMoonOffsets(c.moons, dt);
    }

    // drop cores missing from two consecutive snapshots (silently removed, e.g. phantoms)
    for (const id of this.cores.keys()) if (!b.cores.has(id) && !a.cores.has(id)) this.cores.delete(id);
    this.traps = b.tr;
    this.worms = b.wh;
    this.blackouts = b.bo;
    this.freeMoons = b.fm;
    this.sunstones = b.ss;
    this.blood = b.bm ? { phase: b.bm.p === 1 ? 'warn' : 'dark', in: b.bm.in - (renderTime - b.time) } : { phase: 'calm', in: 999 };
    // wraiths interpolate like cores
    const seen = new Set<number>();
    for (const [id, tb] of b.wr) {
      const ta = a.wr.get(id) ?? tb;
      let v = this.wraithMap.get(id);
      if (!v) {
        v = { id, x: tb[1], y: tb[2], vx: 0, vy: 0, scared: false, stagger: 0 };
        this.wraithMap.set(id, v);
      }
      const nx = lerp(ta[1], tb[1], t);
      const ny = lerp(ta[2], tb[2], t);
      if (dt > 0) {
        v.vx = (nx - v.x) / dt;
        v.vy = (ny - v.y) / dt;
      }
      v.x = nx;
      v.y = ny;
      v.scared = (tb[3] & 1) !== 0;
      v.stagger = (tb[3] & 2) !== 0 ? 0.3 : 0;
      seen.add(id);
    }
    for (const id of this.wraithMap.keys()) if (!seen.has(id)) this.wraithMap.delete(id);
    this.wraiths = [...this.wraithMap.values()];
    this.starfall = b.sf ? { ...b.sf, in: b.sf.in - (renderTime - b.time) } : null;

    this.predictSelf(dt, input);
    this.sendInput(input);
  }

  private predictSelf(dt: number, input: PlayerInput | null): void {
    const me = this.meId !== null ? this.cores.get(this.meId) : undefined;
    const latest = this.snaps[this.snaps.length - 1];
    const auth = this.meId !== null ? latest?.cores.get(this.meId) : undefined;
    if (!me || !auth || !input) return;
    const p = this.pred;
    if (!p.init) {
      Object.assign(p, { x: auth.x, y: auth.y, vx: 0, vy: 0, heading: auth.heading, init: true });
    }
    // integrate locally with the same movement model as the server
    const turn = turnRate(me.mass) * dt;
    const d = angleDiff(p.heading, input.angle);
    p.heading += Math.max(-turn, Math.min(turn, d));
    const speed = baseSpeed(me.mass) * (auth.surging ? SURGE_SPEED_MULT : 1);
    const k = damp(7, dt);
    p.vx += (Math.cos(p.heading) * speed - p.vx) * k;
    p.vy += (Math.sin(p.heading) * speed - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // pull toward where the server will have us by now (latest + half RTT of travel)
    const ahead = this.rtt / 2000;
    const tx = auth.x + Math.cos(auth.heading) * speed * ahead;
    const ty = auth.y + Math.sin(auth.heading) * speed * ahead;
    const err = Math.hypot(tx - p.x, ty - p.y);
    const corr = err > 250 ? 1 : damp(3 + err / 40, dt);
    p.x += (tx - p.x) * corr;
    p.y += (ty - p.y) * corr;
    p.heading += angleDiff(p.heading, auth.heading) * damp(1.5, dt);
    me.x = p.x;
    me.y = p.y;
    me.vx = p.vx;
    me.vy = p.vy;
    me.heading = p.heading;
  }

  private sendInput(input: PlayerInput | null): void {
    if (!input || this.meId === null) return;
    const now = performance.now();
    const s = input.surge ? 1 : 0;
    const changed = Math.abs(angleDiff(this.lastSent.a, input.angle)) > 0.03 || s !== this.lastSent.s;
    if ((changed && now - this.lastSent.at > 45) || now - this.lastSent.at > 250) {
      this.lastSent = { a: input.angle, s, at: now };
      this.send({ t: 'in', a: Math.round(input.angle * 1000) / 1000, s: s as 0 | 1 });
    }
  }

  private releasePending(renderTime: number): void {
    while (this.pending.length && this.pending[0].time <= renderTime) {
      const p = this.pending.shift()!;
      for (const [id, x, y, v, c, fx, fy] of p.added) {
        const d: ViewDust = { id, x, y, v, c, fx, fy };
        this.dust.set(id, d);
        this.out.added.push(d);
      }
      for (const id of p.removed) {
        const d = this.dust.get(id);
        if (d) {
          this.dust.delete(id);
          this.out.removed.push(d);
        }
      }
      for (const e of p.events) {
        if (e.t === 'clash') {
          // drop the specific moon nearest the impact so the right one vanishes
          for (const id of [e.a, e.b]) {
            const c = this.cores.get(id);
            if (!c || !c.moons.length) continue;
            let best = 0;
            let bestD = Infinity;
            c.moons.forEach((off, idx) => {
              const a = c.orbitAngle + off;
              const dd = (c.x + Math.cos(a) * c.orbitR - e.x) ** 2 + (c.y + Math.sin(a) * c.orbitR - e.y) ** 2;
              if (dd < bestD) {
                bestD = dd;
                best = idx;
              }
            });
            c.moons.splice(best, 1);
            c.moonTarget = Math.max(0, c.moonTarget - 1);
          }
        } else if (e.t === 'decoyPop') {
          this.cores.delete(e.id);
          this.players.delete(e.id);
        } else if (e.t === 'disguise') {
          const pl = this.players.get(e.core);
          if (pl) {
            pl.name = e.name;
            pl.skin = e.skin;
          }
          const c = this.cores.get(e.core);
          if (c) {
            c.name = e.name;
            c.skin = e.skin;
          }
        } else if (e.t === 'warp') {
          if (e.core === this.meId) this.pred.init = false;
        } else if (e.t === 'ward') {
          const c = this.cores.get(e.core);
          if (c && c.moons.length) {
            c.moons.pop();
            c.moonTarget = Math.max(0, c.moonTarget - 1);
          }
        } else if (e.t === 'kill') {
          this.cores.delete(e.victim);
          this.players.delete(e.victim);
          if (e.victim === this.meId) this.pred.init = false;
        }
        this.out.events.push(e);
      }
    }
  }

  drain(out: FrameOutput): void {
    out.events.push(...this.out.events);
    out.added.push(...this.out.added);
    out.removed.push(...this.out.removed);
    this.out.events.length = 0;
    this.out.added.length = 0;
    this.out.removed.length = 0;
  }

  board(): BoardEntry[] {
    return this.lb;
  }

  rankOf(id: number): number {
    const i = this.lb.findIndex((e) => e.id === id);
    if (i >= 0) return i + 1;
    const me = this.cores.get(id);
    if (!me) return this.pop;
    let above = 0;
    for (const c of this.cores.values()) if (c.mass > me.mass) above++;
    return above + 1;
  }

  population(): number {
    return this.pop || this.cores.size;
  }

  usePower(): void {
    this.send({ t: 'pw' });
  }

  spawn(name: string, skin: number, power: PowerId): void {
    this.pred.init = false;
    this.meId = null; // assigned by the server's 'you' reply
    this.send({ t: 'join', v: PROTOCOL_VERSION, name, skin, power });
  }

  leave(): void {
    this.send({ t: 'leave' });
    this.meId = null;
  }

  dispose(): void {
    clearInterval(this.pingTimer);
    this.ws.onclose = null;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
