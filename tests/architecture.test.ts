import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BotBrain } from '../shared/bot';
import { World } from '../shared/world';
import { handledEvents } from '../client/src/game/feedback';

/** Events that intentionally have no client feedback. */
const SILENT = new Set(['spawn']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architecture guards', () => {
  it('every event the simulation emits has a feedback handler', () => {
    const w = new World({ seed: 3 });
    w.botFactory = () => new BotBrain();
    for (let i = 0; i < 18; i++) w.addCore(`b${i}`, i % 13, true, new BotBrain());
    w.bloodMoon.trigger(5);
    const seen = new Set<string>();
    for (let t = 0; t < 30 * 150; t++) {
      w.step(1 / 30);
      for (const e of w.events) seen.add(e.t);
      w.flush();
    }
    const handled = new Set(handledEvents());
    const missing = [...seen].filter((t) => !handled.has(t) && !SILENT.has(t));
    expect(missing).toEqual([]);
    // sanity: the soak actually exercised the big features
    expect([...seen]).toEqual(expect.arrayContaining(['kill', 'clash', 'bloodStart', 'power', 'decoyPop']));
  });

  it('shared/ stays pure: no DOM, no client or server imports', () => {
    for (const f of walk('shared')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.\/(client|server)/);
      expect(src, f).not.toMatch(/\b(window|document|localStorage)\./);
    }
  });

  it('server/ never imports client code', () => {
    for (const f of walk('server')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/client\//);
  });
});
