import type { GameEvent } from '../../../../shared/world';
import { bloodMoonFeedback } from './bloodmoon';
import { combatFeedback } from './combat';
import type { FeedbackContext, Handlers } from './context';
import { powerFeedback } from './powers';

export type { FeedbackContext } from './context';

/**
 * One registry for every feature. Adding a feature = add a handler module and spread it
 * here. A duplicate key would be a bug, so registration asserts uniqueness.
 */
function merge(...groups: Handlers[]): Handlers {
  const out: Record<string, unknown> = {};
  for (const g of groups) {
    for (const [k, v] of Object.entries(g)) {
      if (k in out) throw new Error(`feedback: two handlers registered for '${k}'`);
      out[k] = v;
    }
  }
  return out as Handlers;
}

const registry = merge(combatFeedback, bloodMoonFeedback, powerFeedback);

export function dispatchFeedback(e: GameEvent, ctx: FeedbackContext): void {
  const handler = registry[e.t] as ((e: GameEvent, ctx: FeedbackContext) => void) | undefined;
  handler?.(e, ctx);
}

/** Exposed for tests: which event types have feedback. */
export const handledEvents = (): string[] => Object.keys(registry);
