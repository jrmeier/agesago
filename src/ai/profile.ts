import type { Difficulty, Stockpile } from '../core/types';

export type { Difficulty } from '../core/types';
export type Personality = 'rusher' | 'boomer' | 'turtle';

export interface AIOptions {
  difficulty: Difficulty;
  /** Omitted: a balanced player (between boomer and rusher). */
  personality?: Personality;
  /** Seeds the AI's own choices (unit picks, placement ties). Default 1. */
  seed?: number;
  /** Overrides applied on top of the tuned profile (tests, tuning; e.g. `{ research: null }`). */
  tune?: Partial<Profile>;
}

/** Groups in the research priority table (see research.ts). */
export type TechGroup = 'eco' | 'tc' | 'forge' | 'line' | 'defence' | 'civ';

/**
 * Research and age timing. `null` turns research and aging off entirely (a control AI for tests).
 */
export interface ResearchProfile {
  /** Villagers before saving for the Town Age / City Age. */
  townAgeAt: number;
  cityAgeAt: number;
  /** Earliest sim second each age-up may start (slows easy down). */
  townAgeTime: number;
  cityAgeTime: number;
  /** Villagers working a resource before its drop-site techs are worth it. */
  ecoWorkers: number;
  /** Units of a kind before its unit-line upgrade. */
  lineUnits: number;
  /** Per-group weight on the priority table's base score; 0 skips the group. */
  weights: Record<TechGroup, number>;
  /** Minimum seconds between starting two (non-age) techs. */
  gap: number;
  /** Extra food (beyond one villager) kept back for villager production while it still booms. */
  villagerReserve: number;
  /** Reserve opening research food and use surplus gold to fund it. Defaults to true. */
  fundOpeningCivTech?: boolean;
  /** Sell or buy at its market when a stock passes this and a needed resource is short. */
  marketExcess: number;
  /** Watch towers it raises toward the enemy from the Town Age (paid mostly in idle stone). */
  towers: number;
  /** Villagers before saving for the Empire Age (M16-8); null = stays in the City Age. */
  empireAgeAt: number | null;
}

/**
 * The late game (M16-8): siege, fortresses, champions, heroes and wonders. Plain data like the
 * rest of the profile.
 */
export interface LateGame {
  /** Siege engines it brings to an attack on a walled or towered base (0 = never builds a workshop). */
  siege: number;
  /** Fortresses it raises in the City Age (the sim allows 2). */
  fortresses: number;
  /** Trains champions at its fortress once it is in the Empire Age, or very rich in gold. */
  champions: boolean;
  /** Trains its civilization's hero in the Empire Age. */
  hero: boolean;
  /** Builds a wonder of its own when far ahead in the Empire Age. */
  wonder: boolean;
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
  /**
   * The second military building, laid soon after the barracks and before the Town Age
   * (archery range: slingers; stable: scouts). The third is the other one.
   */
  secondProduction: 'archeryRange' | 'stable';
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
  /** Preferred unique-unit share, including training queues; hard counters still take priority. */
  uniqueShare: number;
  /** Raw counter value required before the preferred unique-unit share can override a pick. */
  uniqueCounterRatio?: number;
  /** Villagers sent to a military building / drop site. */
  builders: number;
  /** Pull villagers into the Town Center when raided. */
  shelter: boolean;
  /**
   * Villagers before it founds another Town Center toward a resource cluster (M18-5; Town Age,
   * medium or larger maps only). null = never expands.
   */
  expandAt: number | null;
  /** Town Centers it aims to own (the founding one included). */
  towns: number;
  /** Soldiers capture undefended military and economic buildings instead of razing them (M18-5). */
  capture: boolean;
  /** Light cheats for 'hardest': resources per sim second and full map knowledge. */
  cheat: { trickle: Partial<Stockpile>; fullMap: boolean } | null;
  /** Ages and upgrades; null = never researches or ages up. */
  research: ResearchProfile | null;
  /** Siege, fortresses, champions, heroes and wonders (M16-8). */
  late: LateGame;
}

const ALL_GROUPS: Record<TechGroup, number> = { eco: 1, tc: 1, forge: 1, line: 1, defence: 1, civ: 1 };


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
    secondProduction: 'archeryRange',
    productionSpacing: 300,
    firstAttack: 15 * 60,
    firstWave: 5,
    waveGrowth: 1,
    maxWave: 9,
    waveGap: 240,
    retreatAt: 0,
    counters: false,
    uniqueShare: 0,
    builders: 1,
    shelter: false,
    expandAt: null,
    towns: 1,
    capture: false,
    cheat: null,
    research: {
      townAgeAt: 18,
      cityAgeAt: 22,
      townAgeTime: 8 * 60,
      cityAgeTime: 18 * 60,
      ecoWorkers: 8,
      lineUnits: 8,
      weights: { eco: 0.7, tc: 0.5, forge: 0.4, line: 0.3, defence: 0, civ: 0 },
      gap: 75,
      villagerReserve: 100,
      marketExcess: 1500,
      towers: 1,
      empireAgeAt: null,
    },
    late: { siege: 1, fortresses: 0, champions: false, hero: false, wonder: false },
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
    secondProduction: 'archeryRange',
    productionSpacing: 150,
    firstAttack: 10 * 60,
    firstWave: 9,
    waveGrowth: 3,
    maxWave: 24,
    waveGap: 120,
    retreatAt: 0.3,
    counters: true,
    uniqueShare: 0.3,
    builders: 2,
    shelter: true,
    expandAt: 24,
    towns: 2,
    capture: true,
    cheat: null,
    research: {
      townAgeAt: 20,
      cityAgeAt: 28,
      townAgeTime: 0,
      cityAgeTime: 0,
      ecoWorkers: 6,
      lineUnits: 5,
      weights: ALL_GROUPS,
      gap: 15,
      villagerReserve: 50,
      marketExcess: 1000,
      towers: 3,
      empireAgeAt: 36,
    },
    late: { siege: 2, fortresses: 1, champions: true, hero: true, wonder: false },
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
    secondProduction: 'archeryRange',
    productionSpacing: 100,
    firstAttack: 8.5 * 60,
    firstWave: 12,
    waveGrowth: 4,
    maxWave: 36,
    waveGap: 90,
    retreatAt: 0.35,
    counters: true,
    uniqueShare: 0.35,
    builders: 3,
    shelter: true,
    expandAt: 22,
    towns: 2,
    capture: true,
    cheat: null,
    research: {
      townAgeAt: 19,
      cityAgeAt: 27,
      townAgeTime: 0,
      cityAgeTime: 0,
      ecoWorkers: 5,
      lineUnits: 5,
      weights: { ...ALL_GROUPS, forge: 1.2, line: 1.2 },
      gap: 8,
      villagerReserve: 50,
      marketExcess: 900,
      towers: 3,
      empireAgeAt: 44,
    },
    late: { siege: 3, fortresses: 1, champions: true, hero: true, wonder: false },
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
    secondProduction: 'archeryRange',
    productionSpacing: 80,
    firstAttack: 8 * 60,
    firstWave: 14,
    waveGrowth: 5,
    maxWave: 45,
    waveGap: 75,
    retreatAt: 0.4,
    counters: true,
    uniqueShare: 0.4,
    uniqueCounterRatio: 1,
    builders: 3,
    shelter: true,
    expandAt: 22,
    towns: 3,
    capture: true,
    cheat: { trickle: { food: 0.35, wood: 0.35, gold: 0.25, stone: 0.1 }, fullMap: true },
    research: {
      townAgeAt: 18,
      cityAgeAt: 26,
      townAgeTime: 0,
      cityAgeTime: 0,
      ecoWorkers: 5,
      lineUnits: 4,
      weights: { ...ALL_GROUPS, forge: 1.3, line: 1.3, defence: 1.2 },
      gap: 5,
      villagerReserve: 50,
      fundOpeningCivTech: false,
      marketExcess: 800,
      towers: 4,
      empireAgeAt: 50,
    },
    late: { siege: 4, fortresses: 2, champions: true, hero: true, wonder: true },
  },
};

/** The tuned profile for a difficulty and personality. */
export function makeProfile(difficulty: Difficulty, personality?: Personality, tune?: Partial<Profile>): Profile {
  const base = BASE[difficulty];
  const p: Profile = { ...base, research: base.research && { ...base.research, weights: { ...base.research.weights } }, late: { ...base.late } };
  switch (personality) {
    case 'rusher':
      // Early barracks, a small early wave, then steady pressure; a leaner economy.
      p.barracksAt = Math.max(8, p.barracksAt - 5);
      p.secondProduction = 'stable';
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
      if (p.research) {
        p.research.weights.defence *= 1.5;
        p.research.towers += 2;
      }
      p.late.fortresses = Math.min(2, p.late.fortresses + 1);
      break;
  }
  Object.assign(p, tune);
  // A smaller economy (rusher, easy) still ages up: never wait for more villagers than it trains.
  if (p.research) {
    p.research = { ...p.research, weights: { ...p.research.weights } };
    p.research.cityAgeAt = Math.min(p.research.cityAgeAt, p.targetVillagers);
    p.research.townAgeAt = Math.min(p.research.townAgeAt, p.research.cityAgeAt - 4);
    if (p.research.empireAgeAt !== null) p.research.empireAgeAt = Math.min(p.research.empireAgeAt, p.targetVillagers);
  }
  if (p.expandAt !== null) p.expandAt = Math.min(p.expandAt, p.targetVillagers - 4);
  return p;
}
