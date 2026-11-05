import type { PowerId } from '../../../shared/powers';

/** Chunky single-colour glyphs; colour comes from `currentColor`. */
export const POWER_ICON: Record<PowerId, string> = {
  blink:
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M16 16m-2 0a2 2 0 1 1 4 0a5 5 0 1 1-10 0a8 8 0 1 1 16 0a11 11 0 1 1-22 0"/></svg>',
  bubble:
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><circle cx="16" cy="16" r="12"/><path d="M10 12a7 7 0 0 1 5-4"/><circle cx="16" cy="17" r="4" fill="currentColor" stroke="none"/></svg>',
  decoy:
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="7"/><circle cx="21" cy="16" r="7" stroke-dasharray="3 3"/><circle cx="10" cy="15" r="1.4" fill="currentColor"/><circle cx="14" cy="15" r="1.4" fill="currentColor"/></svg>',
  snare:
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M16 3v26M3 16h26M7 7l18 18M25 7L7 25"/><path d="M16 9l7 7-7 7-7-7z"/></svg>',
  mimic:
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7c4 2 18 2 22 0 0 10-3 19-11 19S5 17 5 7z"/><path d="M10 13l3 1M22 13l-3 1M12 20c2 2 6 2 8 0"/></svg>',
  blackout:
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M4 16c4-6 20-6 24 0"/><path d="M8 19l-2 3M16 21v4M24 19l2 3"/><path d="M5 5l22 22"/></svg>',
};
