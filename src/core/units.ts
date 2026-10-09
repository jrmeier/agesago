import type { BuildingKind, Stockpile, UnitKind } from './types';

/**
 * Unit data table — stats, costs and counters for every unit kind. Single source of truth
 * for sim, AI, render sizing and HUD. FROZEN contract (integrator-owned).
 */
export type UnitClass = 'villager' | 'infantry' | 'archer' | 'cavalry' | 'wildlife';

export interface UnitSpec {
  name: string;
  unitClass: UnitClass;
  hp: number;
  /** World units per second. */
  speed: number;
  /** Fog-of-war sight radius. */
  sight: number;
  attack: { melee: number; pierce: number };
  armor: { melee: number; pierce: number };
  /** Attack range in world units measured edge to edge; ~0.5 for melee. */
  range: number;
  /** Seconds between attacks. */
  reload: number;
  /** Extra damage against these classes (rock–paper–scissors counters). */
  bonus: Partial<Record<UnitClass, number>>;
  /** Ranged units fire this projectile. */
  projectile?: 'arrow' | 'stone' | 'javelin';
  cost: Partial<Stockpile>;
  /** Seconds to train. */
  trainTime: number;
  /** Where it is trained; null = not trainable (e.g. wildlife). */
  trainedAt: BuildingKind | null;
  /** Collision/selection radius. */
  radius: number;
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  deer: {
    name: 'Deer', unitClass: 'wildlife', hp: 12, speed: 4, sight: 0,
    attack: { melee: 0, pierce: 0 }, armor: { melee: 0, pierce: 0 },
    range: 0, reload: 2, bonus: {}, cost: {}, trainTime: 0, trainedAt: null, radius: 0.4,
  },
  boar: {
    name: 'Boar', unitClass: 'wildlife', hp: 60, speed: 3, sight: 0,
    attack: { melee: 7, pierce: 0 }, armor: { melee: 0, pierce: 0 },
    range: 0.5, reload: 1.5, bonus: {}, cost: {}, trainTime: 0, trainedAt: null, radius: 0.5,
  },
  sheep: {
    name: 'Sheep', unitClass: 'wildlife', hp: 8, speed: 1.2, sight: 0,
    attack: { melee: 0, pierce: 0 }, armor: { melee: 0, pierce: 0 },
    range: 0, reload: 2, bonus: {}, cost: {}, trainTime: 0, trainedAt: null, radius: 0.35,
  },
  villager: {
    name: 'Villager',
    unitClass: 'villager',
    hp: 25,
    speed: 2.4,
    sight: 7,
    attack: { melee: 3, pierce: 0 },
    armor: { melee: 0, pierce: 1 },
    range: 0.5,
    reload: 2,
    bonus: {},
    cost: { food: 50 },
    trainTime: 8,
    trainedAt: 'townCenter',
    radius: 0.3,
  },
  scout: {
    name: 'Scout',
    unitClass: 'cavalry',
    hp: 45,
    speed: 5.5,
    sight: 15,
    attack: { melee: 3, pierce: 0 },
    armor: { melee: 0, pierce: 2 },
    range: 0.6,
    reload: 2,
    bonus: {},
    cost: { food: 80 },
    trainTime: 14,
    trainedAt: 'stable',
    radius: 0.55,
  },
  hoplite: {
    name: 'Hoplite',
    unitClass: 'infantry',
    hp: 55,
    speed: 2.1,
    sight: 6,
    attack: { melee: 5, pierce: 0 },
    armor: { melee: 1, pierce: 1 },
    range: 0.7,
    reload: 2,
    bonus: { cavalry: 12 },
    cost: { food: 50, wood: 30 },
    trainTime: 12,
    trainedAt: 'barracks',
    radius: 0.32,
  },
  swordsman: {
    name: 'Swordsman',
    unitClass: 'infantry',
    hp: 60,
    speed: 2.3,
    sight: 6,
    attack: { melee: 8, pierce: 0 },
    armor: { melee: 1, pierce: 1 },
    range: 0.5,
    reload: 2,
    bonus: {},
    cost: { food: 60, gold: 20 },
    trainTime: 14,
    trainedAt: 'barracks',
    radius: 0.32,
  },
  slinger: {
    name: 'Slinger',
    unitClass: 'archer',
    hp: 30,
    speed: 2.4,
    sight: 7,
    attack: { melee: 0, pierce: 4 },
    armor: { melee: 0, pierce: 0 },
    range: 5.5,
    reload: 2,
    bonus: { infantry: 3 },
    projectile: 'stone',
    cost: { food: 40, stone: 20 },
    trainTime: 12,
    trainedAt: 'archeryRange',
    radius: 0.3,
  },
  archer: {
    name: 'Archer',
    unitClass: 'archer',
    hp: 30,
    speed: 2.3,
    sight: 8,
    attack: { melee: 0, pierce: 4 },
    armor: { melee: 0, pierce: 0 },
    range: 7,
    reload: 2,
    bonus: { archer: 3 },
    projectile: 'arrow',
    cost: { wood: 25, gold: 45 },
    trainTime: 12,
    trainedAt: 'archeryRange',
    radius: 0.3,
  },
  horseman: {
    name: 'Horseman',
    unitClass: 'cavalry',
    hp: 100,
    speed: 4.4,
    sight: 8,
    attack: { melee: 8, pierce: 0 },
    armor: { melee: 1, pierce: 2 },
    range: 0.7,
    reload: 1.9,
    bonus: { archer: 6 },
    cost: { food: 80, gold: 70 },
    trainTime: 18,
    trainedAt: 'stable',
    radius: 0.55,
  },
};

export function isAnimal(kind: UnitKind): kind is 'deer' | 'boar' | 'sheep' {
  return kind === 'deer' || kind === 'boar' || kind === 'sheep';
}

/** Units a building can train, in menu order. */
export function trainable(building: BuildingKind): UnitKind[] {
  return (Object.keys(UNITS) as UnitKind[]).filter((k) => UNITS[k].trainedAt === building);
}

/**
 * Damage dealt by one attack: (attack − armour) per type, at least 1 in total, plus class bonus.
 * Buildings take melee damage reduced by their own armour (see BUILDINGS[k].armor).
 */
export function damage(attacker: UnitKind, defenderClass: UnitClass, armor: { melee: number; pierce: number }): number {
  const a = UNITS[attacker];
  const base = Math.max(0, a.attack.melee - armor.melee) + Math.max(0, a.attack.pierce - armor.pierce);
  return Math.max(1, base) + (a.bonus[defenderClass] ?? 0);
}
