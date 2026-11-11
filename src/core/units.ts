import type { CivId } from './civilizations';
import type { Age, BuildingKind, Stockpile, UnitKind } from './types';

/**
 * Unit data table — stats, costs and counters for every unit kind. Single source of truth
 * for sim, AI, render sizing and HUD. FROZEN contract (integrator-owned).
 */
export type UnitClass = 'villager' | 'infantry' | 'archer' | 'cavalry' | 'wildlife' | 'ship';

export interface UnitSpec {
  /** Unique to this civilization; hidden and rejected for other rosters. */
  civ?: CivId;
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
  /** Earliest age it can be trained in (default 0, Village). */
  age?: Age;
  /** Experience its killer earns (default: total cost × XP_PER_COST; see xpValue). */
  xp?: number;
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  phalangiteGuard: {name:'Phalangite Guard',civ:'hellenes',unitClass:'infantry',hp:65,speed:2.1,sight:6,attack:{melee:6,pierce:0},armor:{melee:1,pierce:1},range:.9,reload:2,bonus:{cavalry:12},cost:{food:60,wood:35},trainTime:14,trainedAt:'barracks',radius:.32,age:1},
  legionary: {name:'Legionary',civ:'romans',unitClass:'infantry',hp:65,speed:2.3,sight:6,attack:{melee:8,pierce:0},armor:{melee:2,pierce:1},range:.5,reload:2,bonus:{},cost:{food:65,gold:25},trainTime:15,trainedAt:'barracks',radius:.32,age:1},
  immortal: {name:'Immortal',civ:'persians',unitClass:'archer',hp:40,speed:2.3,sight:8,attack:{melee:0,pierce:5},armor:{melee:0,pierce:1},range:7,reload:2,bonus:{archer:3},projectile:'arrow',cost:{wood:35,gold:55},trainTime:15,trainedAt:'archeryRange',radius:.3,age:1},
  raider: {name:'Raider',civ:'celts',unitClass:'infantry',hp:55,speed:2.7,sight:7,attack:{melee:8,pierce:0},armor:{melee:1,pierce:1},range:.5,reload:2,bonus:{},cost:{food:60,gold:20},trainTime:14,trainedAt:'barracks',radius:.32,age:1},
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
    age: 1,
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
    age: 1,
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
    age: 1,
  },
  fishingBoat: {
    name: 'Fishing Boat', unitClass: 'ship', hp: 70, speed: 3.2, sight: 8,
    attack: { melee: 0, pierce: 0 }, armor: { melee: 0, pierce: 1 }, range: 0, reload: 2,
    bonus: {}, cost: { wood: 75 }, trainTime: 20, trainedAt: 'dock', radius: 0.55,
  },
  merchantShip: {
    name: 'Merchant Ship', unitClass: 'ship', hp: 120, speed: 3.4, sight: 8,
    attack: { melee: 0, pierce: 0 }, armor: { melee: 0, pierce: 2 }, range: 0, reload: 2,
    bonus: {}, cost: { wood: 100, gold: 50 }, trainTime: 25, trainedAt: 'dock', radius: 0.65, age: 1,
  },
  trireme: {
    name: 'Trireme', unitClass: 'ship', hp: 180, speed: 3.6, sight: 10,
    attack: { melee: 0, pierce: 9 }, armor: { melee: 2, pierce: 3 }, range: 6, reload: 2,
    bonus: { ship: 5 }, projectile: 'arrow', cost: { wood: 150, gold: 80 }, trainTime: 30,
    trainedAt: 'dock', radius: 0.8, age: 1,
  },
  transport: {
    name: 'Transport', unitClass: 'ship', hp: 140, speed: 3, sight: 8,
    attack: { melee: 0, pierce: 0 }, armor: { melee: 1, pierce: 2 }, range: 0, reload: 2,
    bonus: {}, cost: { wood: 125 }, trainTime: 25, trainedAt: 'dock', radius: 0.7,
  },
  priest: {
    name: 'Priest', unitClass: 'villager', hp: 35, speed: 2.2, sight: 9,
    attack: { melee: 0, pierce: 0 }, armor: { melee: 0, pierce: 0 },
    range: 0, reload: 2, bonus: {}, cost: { gold: 100 }, trainTime: 30,
    trainedAt: 'temple', radius: 0.32, age: 1,
  },
  tradeCart: {
    name: 'Trade Cart',
    unitClass: 'villager',
    hp: 70,
    speed: 2.6,
    sight: 6,
    attack: { melee: 0, pierce: 0 },
    armor: { melee: 0, pierce: 1 },
    range: 0,
    reload: 2,
    bonus: {},
    cost: { wood: 100, food: 50 },
    trainTime: 25,
    trainedAt: 'market',
    radius: 0.55,
    age: 1,
  },
};

export function isShip(kind: UnitKind): boolean {
  return kind === 'fishingBoat' || kind === 'merchantShip' || kind === 'trireme' || kind === 'transport';
}

export function isAnimal(kind: UnitKind): kind is 'deer' | 'boar' | 'sheep' {
  return kind === 'deer' || kind === 'boar' || kind === 'sheep';
}

/** Units a building can train, in menu order. */
export function trainable(building: BuildingKind, civ?: CivId): UnitKind[] {
  return (Object.keys(UNITS) as UnitKind[]).filter((k) => UNITS[k].trainedAt === building && (!UNITS[k].civ || UNITS[k].civ === civ));
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

/** Trained land units can take explicit economy orders; idle units never seek work. */
export function canWork(kind: UnitKind): boolean {
  return UNITS[kind].trainedAt !== null && !isAnimal(kind) && !isShip(kind);
}

// ---- Veterancy (M15-1, after 0 A.D.'s Promotion + Loot) ----

/** Default experience for killing a unit: this much per resource of its cost. */
export const XP_PER_COST = 0.5;

/** Experience a unit of `kind` is worth to whoever kills it (wildlife and free units: 0). */
export function xpValue(kind: UnitKind): number {
  const spec = UNITS[kind];
  if (spec.xp !== undefined) return spec.xp;
  let total = 0;
  for (const v of Object.values(spec.cost)) total += v ?? 0;
  return Math.round(total * XP_PER_COST);
}

export interface RankSpec {
  name: string;
  /** Total experience needed to reach this rank. */
  xp: number;
  /** Max HP multiplier (cumulative from Basic). */
  hp: number;
  /** Added to each attack type the unit actually has (base > 0). */
  attack: number;
  /** Added to melee and pierce armour. */
  armor: number;
  /** Gather and build rate multiplier: veterans are worse labourers. */
  work: number;
}

/** 0 Basic · 1 Advanced · 2 Elite. Bonuses are cumulative totals, applied through statOf. */
export const RANKS: readonly [RankSpec, RankSpec, RankSpec] = [
  { name: 'Basic', xp: 0, hp: 1, attack: 0, armor: 0, work: 1 },
  { name: 'Advanced', xp: 100, hp: 1.1, attack: 1, armor: 1, work: 0.85 },
  { name: 'Elite', xp: 300, hp: 1.1 * 1.1, attack: 2, armor: 2, work: 0.7 },
];

/** Soldiers rank up: infantry, archers and cavalry (scouts included). Villagers, priests, trade carts, ships and wildlife do not. */
export function canRank(kind: UnitKind): boolean {
  const c = UNITS[kind].unitClass;
  return c === 'infantry' || c === 'archer' || c === 'cavalry';
}
