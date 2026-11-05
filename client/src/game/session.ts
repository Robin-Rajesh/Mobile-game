import type { PowerId } from '../../../shared/powers';
import type { GameEvent } from '../../../shared/world';

/** What the renderer needs to know about a core — satisfied by both sim and network cores. */
export interface ViewCore {
  readonly id: number;
  name: string;
  skin: number;
  readonly isBot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  mass: number;
  /** Angular offsets relative to orbitAngle */
  moons: number[];
  orbitAngle: number;
  orbitR: number;
  surging: boolean;
  /** > 0 while spawn-protected */
  shield: number;
  /** > 0 while Radiant (sunstone power) */
  radiant: number;
  /** > 0 while caught in a snare */
  snared: number;
  spin: 1 | -1;
  readonly r: number;
  readonly moonR: number;
}

export interface ViewDust {
  id: number;
  x: number;
  y: number;
  v: number;
  c: number;
  fx?: number;
  fy?: number;
}

export interface ViewFreeMoon {
  id: number;
  x: number;
  y: number;
  skin: number;
}

export interface ViewWraith {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scared: boolean;
  stagger: number;
}

export interface ViewSunstone {
  id: number;
  x: number;
  y: number;
}

export interface ViewTrap {
  id: number;
  x: number;
  y: number;
  owner: number;
}

export interface ViewWorm {
  owner: number;
  x: number;
  y: number;
}

export interface ViewBlackout {
  owner: number;
  x: number;
  y: number;
  r: number;
}

export type BloodPhase = 'calm' | 'warn' | 'dark';

export interface BloodState {
  phase: BloodPhase;
  /** seconds until the phase changes */
  in: number;
}

export interface BoardEntry {
  id: number;
  name: string;
  mass: number;
  kills: number;
  skin: number;
}

export interface FrameOutput {
  events: GameEvent[];
  added: ViewDust[];
  removed: ViewDust[];
}

export interface PlayerInput {
  angle: number;
  surge: boolean;
}

export interface Session {
  readonly kind: 'local' | 'online';
  readonly arenaRadius: number;
  meId: number | null;
  readonly cores: Map<number, ViewCore>;
  readonly dust: Map<number, ViewDust>;
  readonly freeMoons: ViewFreeMoon[];
  readonly starfall: { x: number; y: number; r: number; in: number } | null;
  readonly wraiths: readonly ViewWraith[];
  readonly sunstones: readonly ViewSunstone[];
  readonly blood: BloodState;
  readonly traps: readonly ViewTrap[];
  readonly worms: readonly ViewWorm[];
  readonly blackouts: readonly ViewBlackout[];
  usePower(): void;
  /** Advance by real time. timeScale < 1 is used for hit-stop (offline only). */
  update(dt: number, input: PlayerInput | null, timeScale: number): void;
  drain(out: FrameOutput): void;
  board(): BoardEntry[];
  rankOf(id: number): number;
  population(): number;
  spawn(name: string, skin: number, power: PowerId): void;
  leave(): void;
  dispose(): void;
  /** Round-trip time in ms (online only) */
  readonly rtt: number;
  /** Set when an online session drops */
  readonly lost: boolean;
}
