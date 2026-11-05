/**
 * Everything that belongs to one life of the local player. A fresh Round is created on
 * every spawn, so nothing leaks between lives.
 */
export class Round {
  // stats banked into the profile when the round ends
  kills = 0;
  moonsBroken = 0;
  peak = 0;
  captures = 0;
  dust = 0;
  bestRank = 99;
  banished = 0;
  dawns = 0;
  tricks = 0;
  readonly start = performance.now();

  // moment-to-moment state
  streak = 0;
  lastMoons = -1;
  hadCrown = false;
  radiantUntil = 0;
  wasSurging = false;
  wasBlind = false;
  heartbeat = 0;
  bloodHintUntil = 0;
  tutorialClock = 0;

  // powers
  power = { cdUntil: 0, cdTotal: 1, armed: false };
  readonly myDecoys = new Set<number>();
  disguised = false;
  disguiseOffAt = 0;

  get aliveSecs(): number {
    return (performance.now() - this.start) / 1000;
  }
}
