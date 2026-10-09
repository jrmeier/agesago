import type { Stockpile } from '../core/types';

export type Difficulty = 'easy' | 'moderate' | 'hard' | 'hardest';
export type Personality = 'rusher' | 'boomer' | 'turtle';

export interface AIOptions {
  difficulty: Difficulty;
  /** Omitted: a balanced player (between boomer and rusher). */
  personality?: Personality;
  /** Seeds the AI's own choices (unit picks, placement ties). Default 1. */
  seed?: number;
}

/**
 * Every tunable that difficulty and personality change. Times are sim seconds.
 * Plain data so tests can inspect and compare profiles.
 */
export interface Profile {
  /** Seconds between economy passes (idle villagers wait up to this long). */
  econInterval: number;
  /** Seconds between construction passes. */
  buildInterval: number;
  /** Seconds between military passes (training, waves, defence). */
  militaryInterval: number;
  /** Seconds between noticing a threat at home and responding to it. */
  reaction: number;
  /** Villager count the TC trains up to. */
  targetVillagers: number;
  /** Villagers kept queued at the TC (1 = trains one at a time, re-queued on the next pass). */
  tcQueue: number;
  /** Military units kept queued per production building. */
  militaryQueue: number;
  /** Production buildings (barracks / range / stable, repeats allowed) it may own. */
  maxProduction: number;
  /** Villagers before the first barracks. */
  barracksAt: number;
  /** Seconds after the first barracks before each extra production building may start. */
  productionSpacing: number;
  /** Earliest first attack. */
  firstAttack: number;
  /** Units in the first wave; each later wave adds waveGrowth, up to maxWave. */
  firstWave: number;
  waveGrowth: number;
  maxWave: number;
  /** Minimum seconds between waves. */
  waveGap: number;
  /** An attacking army that falls below this fraction of its starting hp (and is losing) retreats. 0 = never. */
  retreatAt: number;
  /** Picks units to counter what it has seen (else a random mix). */
  counters: boolean;
  /** Villagers sent to a military building / drop site. */
  builders: number;
  /** Pull villagers into the Town Center when raided. */
  shelter: boolean;
  /** Light cheats for 'hardest': resources per sim second and full map knowledge. */
  cheat: { trickle: Partial<Stockpile>; fullMap: boolean } | null;
}

const BASE: Record<Difficulty, Profile> = {
  easy: {
    econInterval: 4,
    buildInterval: 5,
    militaryInterval: 4,
    reaction: 10,
    targetVillagers: 22,
    tcQueue: 1,
    militaryQueue: 1,
    maxProduction: 2,
    barracksAt: 14,
    productionSpacing: 300,
    firstAttack: 15 * 60,
    firstWave: 5,
    waveGrowth: 1,
    maxWave: 9,
    waveGap: 240,
    retreatAt: 0,
    counters: false,
    builders: 1,
    shelter: false,
    cheat: null,
  },
  moderate: {
    econInterval: 2,
    buildInterval: 3,
    militaryInterval: 2.5,
    reaction: 5,
    targetVillagers: 36,
    tcQueue: 2,
    militaryQueue: 2,
    maxProduction: 4,
    barracksAt: 14,
    productionSpacing: 150,
    firstAttack: 10 * 60,
    firstWave: 9,
    waveGrowth: 3,
    maxWave: 24,
    waveGap: 120,
    retreatAt: 0.3,
    counters: true,
    builders: 2,
    shelter: true,
    cheat: null,
  },
  hard: {
    econInterval: 1,
    buildInterval: 2,
    militaryInterval: 1.5,
    reaction: 2.5,
    targetVillagers: 48,
    tcQueue: 2,
    militaryQueue: 3,
    maxProduction: 6,
    barracksAt: 13,
    productionSpacing: 100,
    firstAttack: 8.5 * 60,
    firstWave: 12,
    waveGrowth: 4,
    maxWave: 36,
    waveGap: 90,
    retreatAt: 0.35,
    counters: true,
    builders: 3,
    shelter: true,
    cheat: null,
  },
  hardest: {
    econInterval: 0.6,
    buildInterval: 1.5,
    militaryInterval: 1,
    reaction: 1,
    targetVillagers: 56,
    tcQueue: 2,
    militaryQueue: 3,
    maxProduction: 8,
    barracksAt: 13,
    productionSpacing: 80,
    firstAttack: 8 * 60,
    firstWave: 14,
    waveGrowth: 5,
    maxWave: 45,
    waveGap: 75,
    retreatAt: 0.4,
    counters: true,
    builders: 3,
    shelter: true,
    cheat: { trickle: { food: 0.35, wood: 0.35, gold: 0.25, stone: 0.1 }, fullMap: true },
  },
};

/** The tuned profile for a difficulty and personality. */
export function makeProfile(difficulty: Difficulty, personality?: Personality): Profile {
  const p: Profile = { ...BASE[difficulty] };
  switch (personality) {
    case 'rusher':
      // Early barracks, a small early wave, then steady pressure; a leaner economy.
      p.barracksAt = Math.max(8, p.barracksAt - 5);
      p.firstAttack *= 0.5;
      p.firstWave = Math.max(4, Math.round(p.firstWave * 0.5));
      p.waveGap *= 0.75;
      p.targetVillagers = Math.round(p.targetVillagers * 0.8);
      break;
    case 'boomer':
      // Big economy first, then large waves.
      p.barracksAt += 6;
      p.firstAttack *= 1.4;
      p.firstWave = Math.round(p.firstWave * 1.4);
      p.targetVillagers = Math.round(p.targetVillagers * 1.2);
      p.maxProduction += 1;
      break;
    case 'turtle':
      // Defends at home and attacks late with a big army.
      p.firstAttack *= 1.8;
      p.firstWave = Math.round(p.firstWave * 1.7);
      p.maxWave = Math.round(p.maxWave * 1.3);
      p.waveGap *= 1.5;
      p.reaction *= 0.6;
      break;
  }
  return p;
}
