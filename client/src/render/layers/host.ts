import type { Session } from '../../game/session';
import type { Effects } from '../effects';

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RenderOptions {
  meId: number | null;
  crownId: number | null;
  /** Attract mode: hide HUD-ish world overlays (pointer chevron etc.) */
  attract: boolean;
  /** Phantoms that belong to the player (drawn ghosted for them only) */
  myDecoys?: ReadonlySet<number>;
  /** player is wearing a Mimic disguise */
  disguised?: boolean;
}

/**
 * What a render layer may use from the renderer: the canvas, camera and shared effects.
 * Layers own their own state; the Renderer only sequences them.
 */
export interface LayerHost {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly time: number;
  readonly quality: 'high' | 'low';
  readonly cam: { x: number; y: number; zoom: number };
  readonly effects: Effects;
  isVisible(x: number, y: number, pad: number): boolean;
  worldToScreen(x: number, y: number): { x: number; y: number };
  /** Set the canvas transform to world space (camera + shake). */
  applyWorldTransform(ctx: CanvasRenderingContext2D): void;
}

/** A per-frame drawing pass. Layers draw in world space unless noted. */
export interface FrameArgs {
  session: Session;
  view: ViewRect;
  /** world units per screen pixel */
  px: number;
  opts: RenderOptions;
  dt: number;
}
