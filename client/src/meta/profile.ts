import { Rng, hashString } from '../../../shared/math';
import { POWERS, isPowerId } from '../../../shared/powers';
import type { PowerId } from '../../../shared/powers';
import { SKINS } from '../../../shared/skins';
import type { Skin } from '../../../shared/skins';
import { storage } from './storage';

const KEY = 'moonbite.profile.v1';

export type MissionKind = 'bites' | 'mass' | 'survive' | 'clash' | 'dust' | 'games' | 'top' | 'steal' | 'banish' | 'dawn' | 'trick';

export interface Mission {
  kind: MissionKind;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

export interface Settings {
  sfx: boolean;
  music: boolean;
  haptics: boolean;
  quality: 'high' | 'low';
  leftHanded: boolean;
}

export interface Profile {
  name: string;
  skin: number;
  power: PowerId;
  level: number;
  xp: number;
  coins: number;
  owned: number[];
  best: { mass: number; kills: number; secs: number };
  totals: { games: number; kills: number; secs: number };
  missionDay: string;
  missions: Mission[];
  settings: Settings;
  tutorialSteps: number;
  bloodSeen: boolean;
  streakDay: string;
  dayStreak: number;
}

export interface MatchResult {
  peakMass: number;
  kills: number;
  moonsBroken: number;
  aliveSecs: number;
  bestRank: number;
  captures: number;
  dust: number;
  banished: number;
  dawns: number;
  /** clever power plays: phantom fooled someone, snare caught someone, mimic bite */
  tricks: number;
}

export interface MatchRewards {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  /** 0..1 progress in the level we ended on */
  levelProgress: number;
  levelProgressBefore: number;
  newBest: boolean;
  missionsCompleted: Mission[];
  unlocked: Skin[];
}

export function xpToNext(level: number): number {
  return 100 + (level - 1) * 60;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function defaultProfile(): Profile {
  return {
    name: '',
    skin: 0,
    power: 'bubble',
    level: 1,
    xp: 0,
    coins: 0,
    owned: SKINS.filter((s) => s.unlock.kind === 'free').map((s) => s.id),
    best: { mass: 0, kills: 0, secs: 0 },
    totals: { games: 0, kills: 0, secs: 0 },
    missionDay: '',
    missions: [],
    settings: { sfx: true, music: true, haptics: true, quality: 'high', leftHanded: false },
    tutorialSteps: 0,
    bloodSeen: false,
    streakDay: '',
    dayStreak: 0,
  };
}

const MISSION_POOL: { kind: MissionKind; targets: number[]; reward: number }[] = [
  { kind: 'bites', targets: [3, 5, 8], reward: 60 },
  { kind: 'mass', targets: [400, 800, 1500], reward: 70 },
  { kind: 'survive', targets: [90, 150, 240], reward: 60 },
  { kind: 'clash', targets: [10, 20, 35], reward: 50 },
  { kind: 'dust', targets: [600, 1500, 3000], reward: 50 },
  { kind: 'games', targets: [3, 5], reward: 40 },
  { kind: 'top', targets: [3, 1], reward: 90 },
  { kind: 'steal', targets: [3, 6, 10], reward: 60 },
  { kind: 'banish', targets: [1, 3, 6], reward: 90 },
  { kind: 'dawn', targets: [1, 2], reward: 80 },
  { kind: 'trick', targets: [2, 4, 8], reward: 70 },
];

export function missionText(m: Mission): string {
  switch (m.kind) {
    case 'bites':
      return `Bite ${m.target} cores`;
    case 'mass':
      return `Reach ${m.target} mass in one round`;
    case 'survive':
      return `Survive ${Math.round(m.target / 60) >= 2 ? `${Math.round(m.target / 60)} min` : `${m.target}s`} in one round`;
    case 'clash':
      return `Shatter ${m.target} moons`;
    case 'dust':
      return `Collect ${m.target} stardust`;
    case 'games':
      return `Play ${m.target} rounds`;
    case 'top':
      return m.target === 1 ? 'Take the #1 spot' : `Reach the top ${m.target}`;
    case 'steal':
      return `Steal ${m.target} loose moons`;
    case 'banish':
      return `Banish ${m.target} wraith${m.target > 1 ? 's' : ''}`;
    case 'trick':
      return `Pull off ${m.target} power tricks`;
    case 'dawn':
      return m.target > 1 ? `Survive ${m.target} Blood Moons` : 'Survive a Blood Moon';
  }
}

/** Per-round missions reset progress each game; the rest accumulate through the day. */
const PER_ROUND: ReadonlySet<MissionKind> = new Set(['mass', 'survive', 'top']);

export class ProfileStore {
  data: Profile;
  private listeners = new Set<() => void>();

  constructor() {
    const loaded = storage.get<Partial<Profile>>(KEY, {});
    const d = defaultProfile();
    this.data = { ...d, ...loaded, settings: { ...d.settings, ...(loaded.settings ?? {}) }, best: { ...d.best, ...(loaded.best ?? {}) }, totals: { ...d.totals, ...(loaded.totals ?? {}) } };
    if (!isPowerId(this.data.power)) this.data.power = 'bubble';
    this.refreshDaily();
    this.grantLevelSkins();
  }

  isPowerUnlocked(id: PowerId): boolean {
    const p = POWERS.find((x) => x.id === id);
    return !!p && this.data.level >= p.unlockLevel;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save(): void {
    storage.set(KEY, this.data);
    for (const fn of this.listeners) fn();
  }

  refreshDaily(): void {
    const day = today();
    if (this.data.missionDay === day && this.data.missions.length) return;
    const rng = new Rng(hashString(day));
    const pool = [...MISSION_POOL];
    const missions: Mission[] = [];
    while (missions.length < 3 && pool.length) {
      const i = rng.int(0, pool.length - 1);
      const tpl = pool.splice(i, 1)[0];
      // harder targets for higher levels
      const tierMax = Math.min(tpl.targets.length - 1, Math.floor(this.data.level / 6));
      const tier = rng.int(0, tierMax);
      missions.push({ kind: tpl.kind, target: tpl.targets[tier], progress: 0, reward: tpl.reward + tier * 30, done: false });
    }
    this.data.missionDay = day;
    this.data.missions = missions;

    // daily login streak
    if (this.data.streakDay !== day) {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      this.data.dayStreak = this.data.streakDay === yesterday ? this.data.dayStreak + 1 : 1;
      this.data.streakDay = day;
    }
    this.save();
  }

  isOwned(id: number): boolean {
    return this.data.owned.includes(id);
  }

  buySkin(skin: Skin): boolean {
    if (skin.unlock.kind !== 'coins' || this.isOwned(skin.id) || this.data.coins < skin.unlock.price) return false;
    this.data.coins -= skin.unlock.price;
    this.data.owned.push(skin.id);
    this.data.skin = skin.id;
    this.save();
    return true;
  }

  private grantLevelSkins(): Skin[] {
    const fresh: Skin[] = [];
    for (const s of SKINS) {
      if (s.unlock.kind === 'level' && this.data.level >= s.unlock.level && !this.isOwned(s.id)) {
        this.data.owned.push(s.id);
        fresh.push(s);
      }
    }
    return fresh;
  }

  /** Bank a finished round: XP, coins, bests, mission progress, unlocks. */
  applyMatch(r: MatchResult): MatchRewards {
    this.refreshDaily();
    const d = this.data;
    const levelBefore = d.level;
    const levelProgressBefore = d.xp / xpToNext(d.level);

    const xp = Math.round(r.peakMass / 8 + r.kills * 30 + r.aliveSecs / 3 + (r.bestRank <= 3 ? 40 : 0) + r.banished * 25 + r.dawns * 40 + r.tricks * 15 + 10);
    let coins = Math.round(r.peakMass / 30 + r.kills * 8 + (r.bestRank === 1 ? 25 : 0) + 3);

    const newBest = r.peakMass > d.best.mass && d.totals.games > 0;
    d.best.mass = Math.max(d.best.mass, Math.round(r.peakMass));
    d.best.kills = Math.max(d.best.kills, r.kills);
    d.best.secs = Math.max(d.best.secs, Math.round(r.aliveSecs));
    d.totals.games++;
    d.totals.kills += r.kills;
    d.totals.secs += Math.round(r.aliveSecs);

    const completed: Mission[] = [];
    for (const m of d.missions) {
      if (m.done) continue;
      let value = 0;
      switch (m.kind) {
        case 'bites': value = r.kills; break;
        case 'mass': value = r.peakMass; break;
        case 'survive': value = r.aliveSecs; break;
        case 'clash': value = r.moonsBroken; break;
        case 'dust': value = r.dust; break;
        case 'games': value = 1; break;
        case 'top': value = r.bestRank <= m.target ? m.target : 0; break;
        case 'steal': value = r.captures; break;
        case 'banish': value = r.banished; break;
        case 'dawn': value = r.dawns; break;
        case 'trick': value = r.tricks; break;
      }
      m.progress = PER_ROUND.has(m.kind) ? Math.max(m.progress, Math.min(m.target, Math.round(value))) : Math.min(m.target, m.progress + Math.round(value));
      if (m.progress >= m.target) {
        m.done = true;
        coins += m.reward;
        completed.push(m);
      }
    }

    d.coins += coins;
    d.xp += xp;
    while (d.xp >= xpToNext(d.level)) {
      d.xp -= xpToNext(d.level);
      d.level++;
    }
    const unlocked = this.grantLevelSkins();
    this.save();
    return {
      xp,
      coins,
      levelBefore,
      levelAfter: d.level,
      levelProgress: d.xp / xpToNext(d.level),
      levelProgressBefore,
      newBest,
      missionsCompleted: completed,
      unlocked,
    };
  }
}
