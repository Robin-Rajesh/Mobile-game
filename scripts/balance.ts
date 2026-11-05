/** Headless balance probe: run a bot-only arena and print fight statistics. */
import { BotBrain, randomBotName } from '../shared/bot';
import { World } from '../shared/world';

const secs = Number(process.argv[2] ?? 300);
const w = new World({ seed: 7 });
w.botFactory = () => new BotBrain();
for (let i = 0; i < 18; i++) w.addCore(randomBotName(), i % 13, true, new BotBrain());
const count: Record<string, number> = {};
const bump = (k: string) => (count[k] = (count[k] ?? 0) + 1);
const lifetimes: number[] = [];
const spawnAt = new Map<number, number>();
const dt = 1 / 30;
for (let t = 0; t < secs * 30; t++) {
  w.step(dt);
  for (const e of w.events) {
    if (e.t === 'spawn') spawnAt.set(e.core, w.time);
    if (e.t === 'kill') {
      bump(`death:${e.cause}`);
      lifetimes.push(w.time - (spawnAt.get(e.victim) ?? 0));
    } else bump(e.t);
  }
  w.flush();
}
lifetimes.sort((a, b) => a - b);
console.log({ secs, ...count, dust: w.dust.size, medianLife: lifetimes[lifetimes.length >> 1]?.toFixed(1) });
console.log(
  w
    .ranking()
    .slice(0, 8)
    .map((c) => `${c.name}:${Math.round(c.mass)}/${c.moons.length}m/${c.kills}k`)
    .join('  '),
);
