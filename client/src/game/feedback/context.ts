import type { GameEvent } from '../../../../shared/world';
import type { ProfileStore } from '../../meta/profile';
import type { CineSpec } from '../../render/Cinematic';
import type { Renderer } from '../../render/Renderer';
import type { UI } from '../../ui/UI';
import type { Round } from '../round';
import type { Session, ViewCore } from '../session';
import { audio } from '../../audio/Audio';

/**
 * What a feedback handler may touch. Handlers turn simulation events into effects,
 * sound, haptics, UI and round stats. They never mutate the simulation.
 */
export interface FeedbackContext {
  readonly renderer: Renderer;
  readonly ui: UI;
  readonly profile: ProfileStore;
  readonly session: Session;
  readonly round: Round;
  readonly meId: number | null;
  /** the player is alive and in control */
  readonly playing: boolean;
  /** playing, or watching their own death */
  readonly inMatch: boolean;
  readonly inMenu: boolean;
  me(): ViewCore | undefined;
  /** 1 = at the centre of the screen, 0 = well off-screen */
  nearness(x: number, y: number): number;
  hitstop(secs: number): void;
  died(cause: 'bite' | 'rim' | 'wraith', killer: string, killerSkin: number | null): void;
}

type EventOf<K extends GameEvent['t']> = Extract<GameEvent, { t: K }>;

/** A feature's handlers, keyed by event type and typed per event. */
export type Handlers = { [K in GameEvent['t']]?: (e: EventOf<K>, ctx: FeedbackContext) => void };

/** Start a kill-cam unless one is already playing. */
export function killCam(ctx: FeedbackContext, spec: CineSpec): boolean {
  if (ctx.renderer.cinematic.active) return false;
  ctx.renderer.cinematic.play(spec);
  audio.cine('', 'start');
  return true;
}

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
