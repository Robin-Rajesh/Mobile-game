/**
 * Wire protocol. JSON with positional arrays and quantised numbers keeps snapshots ~1–2 KB
 * without a schema compiler. Bump PROTOCOL_VERSION on any breaking change.
 */
import type { GameEvent } from './world';

export const PROTOCOL_VERSION = 5;

// ── client → server
export type ClientMsg =
  | { t: 'join'; v: number; name: string; skin: number; power?: string }
  | { t: 'pw' }
  | { t: 'in'; a: number; s: 0 | 1 }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

// ── server → client
/** [id, x, y, heading*100, mass*10, moonCount, orbitAngle*100, orbitR, flags, spin] */
export type CoreTuple = [number, number, number, number, number, number, number, number, number, 1 | -1];
/** [id, x, y, value, colour, fromX?, fromY?] */
export type DustTuple = [number, number, number, number, number, number?, number?];
/** [id, x, y, skin] */
export type FreeMoonTuple = [number, number, number, number];
/** [id, name, skin, isBot] */
export type PlayerTuple = [number, string, number, 0 | 1];
/** [id, mass, kills] */
export type BoardTuple = [number, number, number];

export interface StarfallWire {
  x: number;
  y: number;
  r: number;
  /** seconds until it lands (negative = landing) */
  in: number;
}

/** [id, x, y, flags] flags: 1 = scared, 2 = staggered */
export type WraithTuple = [number, number, number, number];
/** [id, x, y] */
export type SunstoneTuple = [number, number, number];
/** [id, x, y, ownerId] */
export type TrapTuple = [number, number, number, number];
/** [ownerId, x, y] */
export type WormTuple = [number, number, number];
/** [ownerId, x, y, radius, secondsLeft] */
export type BlackoutTuple = [number, number, number, number, number];

export interface BloodWire {
  /** 1 = warning, 2 = dark */
  p: 1 | 2;
  /** seconds until the phase changes */
  in: number;
}

export type ServerMsg =
  | { t: 'welcome'; v: number; id: number; arena: number; time: number; dust: DustTuple[]; players: PlayerTuple[] }
  | { t: 's'; k: number; time: number; c: CoreTuple[]; fm: FreeMoonTuple[]; da: DustTuple[]; dr: number[]; e: GameEvent[]; sf: StarfallWire | null; bm: BloodWire | null; wr: WraithTuple[]; ss: SunstoneTuple[]; tr: TrapTuple[]; wh: WormTuple[]; bo: BlackoutTuple[] }
  | { t: 'you'; id: number }
  | { t: 'pj'; p: PlayerTuple }
  | { t: 'pl'; id: number }
  | { t: 'lb'; l: BoardTuple[]; n: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; msg: string };

export const FLAG_SURGE = 1;
export const FLAG_SHIELD = 2;
export const FLAG_RADIANT = 4;
export const FLAG_SNARED = 8;

export const q = (n: number): number => Math.round(n);
export const q100 = (n: number): number => Math.round(n * 100);

export function sanitizeName(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  // strip control chars & zero-width / bidi overrides, collapse whitespace
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return [...cleaned].slice(0, maxLen).join('');
}

/** Tiny blocklist — production deployments should plug in a proper moderation service. */
const BLOCKED = ['nigg', 'fagg', 'kike', 'retard', 'hitler', 'nazi'];
export function isNameAllowed(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  return !BLOCKED.some((b) => n.includes(b));
}

export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > 512) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'join':
      if (typeof o.v !== 'number' || typeof o.skin !== 'number') return null;
      return { t: 'join', v: o.v, name: typeof o.name === 'string' ? o.name : '', skin: o.skin, power: typeof o.power === 'string' ? o.power : undefined };
    case 'pw':
      return { t: 'pw' };
    case 'in':
      if (typeof o.a !== 'number' || !Number.isFinite(o.a)) return null;
      return { t: 'in', a: o.a, s: o.s ? 1 : 0 };
    case 'ping':
      if (typeof o.c !== 'number') return null;
      return { t: 'ping', c: o.c };
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}
