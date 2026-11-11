import type { CivId } from './civilizations';
import type { AuraId } from './auras';
import type { Age, BuildingKind, ProjectileKind, Stockpile, UnitKind } from './types';

/**
 * Unit data table — stats, costs and counters for every unit kind. Single source of truth
 * for sim, AI, render sizing and HUD. FROZEN contract (integrator-owned).
 */
export type UnitClass = 'villager' | 'infantry' | 'archer' | 'cavalry' | 'wildlife' | 'ship' | 'siege';

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
  /** Crush (siege) attack defaults to 0; soldiers and villagers carry a little to pull down buildings. */
  attack: DamageTypes;
  /** Crush armour defaults to UNIT_CRUSH_ARMOR. */
  armor: DamageTypes;
  /** Attack range in world units measured edge to edge; ~0.5 for melee. */
  range: number;
  /** Seconds between attacks. */
  reload: number;
  /** Extra damage against these classes (rock–paper–scissors counters). */
  bonus: Partial<Record<UnitClass, number>>;
  /** Ranged units fire this projectile. */
  projectile?: ProjectileKind;
  /** Population slots it takes (default 1). */
  pop?: number;
  /** Siege that must unpack (this many seconds) before shooting and pack again before moving. */
  packTime?: number;
  /** Cannot shoot targets closer than this (edge to edge). */
  minRange?: number;
  /** Shots land as an area blow of this radius, hurting everyone in it (own units too), with falloff. */
  splash?: number;
  /** Shots fly on through a line of units, hitting up to this many in all. */
  pierceTargets?: number;
  /** Battering rams: may only attack buildings and siege engines. */
  siegeTargetsOnly?: boolean;
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
  /** Auras it emits while alive (M16-4; heroes use these). */
  auras?: AuraId[];
  /**
   * Champion (M16-5): an elite, gold-heavy fortress unit. Champions never gather, build or
   * tend (see canWork) and are capped per player only by the fortress limit.
   */
  champion?: boolean;
}

/** Hack (melee), pierce and crush (siege) amounts; crush is optional (see crushOf). */
export interface DamageTypes {
  melee: number;
  pierce: number;
  crush?: number;
}

/**
 * Crush armour of a unit whose table row leaves it out: at least the small crush attack of any
 * soldier or villager, so those blows hurt units exactly as before and only siege crushes them.
 */
export const UNIT_CRUSH_ARMOR = 2;

/** Crush part of an attack or armour (missing = `fallback`). */
export function crushOf(v: DamageTypes, fallback = 0): number {
  return v.crush ?? fallback;
}

/** Σ over damage types of max(0, attack − armour), before the minimum and class bonus. */
export function rawDamage(attack: DamageTypes, armor: DamageTypes): number {
  return Math.max(0, attack.melee - armor.melee) + Math.max(0, attack.pierce - armor.pierce)
    + Math.max(0, crushOf(attack) - crushOf(armor));
}

/*
 * Champions (M16-5). Every infantry champion shares one stat block and every cavalry champion
 * another, so the civs stay even; only names and kit differ. Balance (src/sim/champions.test.ts):
 * an infantry champion (240 res) beats 3 swordsmen and a cavalry champion (300 res) beats
 * 2 horsemen, but each loses cost for cost to its counter (4 slingers / 3.75 hoplites).
 */
const CHAMPION_INFANTRY = {
  // Crush 2 and +8 vs siege like every melee infantry (M16-1, M16-2); unit crush armour soaks the crush.
  unitClass: 'infantry', hp: 170, speed: 2.4, sight: 7, attack: { melee: 14, pierce: 0, crush: 2 },
  armor: { melee: 4, pierce: 1 }, range: 0.6, reload: 1.6, bonus: { siege: 8 }, cost: { food: 90, gold: 150 },
  trainTime: 24, trainedAt: 'fortress', radius: 0.34, age: 2, champion: true,
} as const satisfies Omit<UnitSpec, 'name' | 'civ'>;
const CHAMPION_CAVALRY = {
  // Crush 1 and +10 vs siege like the horseman line (M16-1, M16-2).
  unitClass: 'cavalry', hp: 220, speed: 4.6, sight: 9, attack: { melee: 14, pierce: 0, crush: 1 },
  armor: { melee: 3, pierce: 3 }, range: 0.7, reload: 1.8, bonus: { archer: 6, siege: 10 }, cost: { food: 100, gold: 200 },
  trainTime: 28, trainedAt: 'fortress', radius: 0.58, age: 2, champion: true,
} as const satisfies Omit<UnitSpec, 'name' | 'civ'>;

function champion(base: typeof CHAMPION_INFANTRY | typeof CHAMPION_CAVALRY, name: string, civ: CivId): UnitSpec {
  return { ...base, name, civ, attack: { ...base.attack }, armor: { ...base.armor }, bonus: { ...base.bonus }, cost: { ...base.cost } };
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  phalangiteGuard: {name:'Phalangite Guard',civ:'hellenes',unitClass:'infantry',hp:65,speed:2.1,sight:6,attack:{melee:6,pierce:0,crush:2},armor:{melee:1,pierce:1},range:.9,reload:2,bonus:{cavalry:12,siege:8},cost:{food:60,wood:35},trainTime:14,trainedAt:'barracks',radius:.32,age:1},
  legionary: {name:'Legionary',civ:'romans',unitClass:'infantry',hp:65,speed:2.3,sight:6,attack:{melee:8,pierce:0,crush:2},armor:{melee:2,pierce:1},range:.5,reload:2,bonus:{siege:8},cost:{food:65,gold:25},trainTime:15,trainedAt:'barracks',radius:.32,age:1},
  immortal: {name:'Immortal',civ:'persians',unitClass:'archer',hp:40,speed:2.3,sight:8,attack:{melee:0,pierce:5},armor:{melee:0,pierce:1},range:7,reload:2,bonus:{archer:3},projectile:'arrow',cost:{wood:35,gold:55},trainTime:15,trainedAt:'archeryRange',radius:.3,age:1},
  raider: {name:'Raider',civ:'celts',unitClass:'infantry',hp:55,speed:2.7,sight:7,attack:{melee:8,pierce:0,crush:2},armor:{melee:1,pierce:1},range:.5,reload:2,bonus:{siege:8},cost:{food:60,gold:20},trainTime:14,trainedAt:'barracks',radius:.32,age:1},
  spartanHoplite: champion(CHAMPION_INFANTRY, 'Spartan Hoplite', 'hellenes'),
  agema: champion(CHAMPION_CAVALRY, 'Agema Rider', 'hellenes'),
  praetorian: champion(CHAMPION_INFANTRY, 'Praetorian', 'romans'),
  equites: champion(CHAMPION_CAVALRY, 'Equites', 'romans'),
  appleBearer: champion(CHAMPION_INFANTRY, 'Apple Bearer', 'persians'),
  savaran: champion(CHAMPION_CAVALRY, 'Savar', 'persians'),
  gaesatae: champion(CHAMPION_INFANTRY, 'Gaesatae', 'celts'),
  nobleRider: champion(CHAMPION_CAVALRY, 'Noble Rider', 'celts'),
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
    attack: { melee: 3, pierce: 0, crush: 1 },
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
    attack: { melee: 3, pierce: 0, crush: 1 },
    armor: { melee: 0, pierce: 2 },
    range: 0.6,
    reload: 2,
    bonus: { siege: 4 },
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
    attack: { melee: 5, pierce: 0, crush: 2 },
    armor: { melee: 1, pierce: 1 },
    range: 0.7,
    reload: 2,
    bonus: { cavalry: 12, siege: 8 },
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
    attack: { melee: 8, pierce: 0, crush: 2 },
    armor: { melee: 1, pierce: 1 },
    range: 0.5,
    reload: 2,
    bonus: { siege: 8 },
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
    attack: { melee: 8, pierce: 0, crush: 1 },
    armor: { melee: 1, pierce: 2 },
    range: 0.7,
    reload: 1.9,
    bonus: { archer: 6, siege: 10 },
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
    attack: { melee: 0, pierce: 9, crush: 2 }, armor: { melee: 2, pierce: 3 }, range: 6, reload: 2,
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
  // ---- Siege (M16-2): City Age, siege workshop. Heavy crush; weak to melee infantry and cavalry. ----
  ram: {
    name: 'Battering Ram', unitClass: 'siege', hp: 350, speed: 1.6, sight: 6,
    attack: { melee: 0, pierce: 0, crush: 50 }, armor: { melee: 1, pierce: 12, crush: 4 },
    range: 0.6, reload: 2, bonus: {}, cost: { wood: 300, gold: 150 }, trainTime: 30,
    trainedAt: 'siegeWorkshop', radius: 0.7, age: 2, pop: 3, siegeTargetsOnly: true,
  },
  catapult: {
    name: 'Catapult', unitClass: 'siege', hp: 180, speed: 1.4, sight: 10,
    attack: { melee: 0, pierce: 0, crush: 40 }, armor: { melee: 1, pierce: 6, crush: 4 },
    range: 16, reload: 5, bonus: {}, projectile: 'boulder', cost: { wood: 300, stone: 200 }, trainTime: 40,
    trainedAt: 'siegeWorkshop', radius: 0.75, age: 2, pop: 3, packTime: 3, minRange: 5, splash: 2,
  },
  boltShooter: {
    name: 'Bolt Shooter', unitClass: 'siege', hp: 150, speed: 1.6, sight: 10,
    attack: { melee: 0, pierce: 25 }, armor: { melee: 1, pierce: 6, crush: 4 },
    range: 14, reload: 4, bonus: {}, projectile: 'bolt', cost: { wood: 250, gold: 150 }, trainTime: 30,
    trainedAt: 'siegeWorkshop', radius: 0.6, age: 2, pop: 2, packTime: 3, pierceTargets: 3,
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

/** Population slots a `kind` takes (UnitSpec.pop, default 1; wildlife takes none). */
export function popCost(kind: UnitKind): number {
  return isAnimal(kind) ? 0 : (UNITS[kind].pop ?? 1);
}

/** Siege engines that pack up to move and unpack to shoot. */
export function packs(kind: UnitKind): boolean {
  return (UNITS[kind].packTime ?? 0) > 0;
}

export function isAnimal(kind: UnitKind): kind is 'deer' | 'boar' | 'sheep' {
  return kind === 'deer' || kind === 'boar' || kind === 'sheep';
}

/** Champions fielded by players without a civilization (legacy saves), so their fortress still trains. */
export const DEFAULT_CHAMPION_CIV: CivId = 'hellenes';

/**
 * Units a building can train, in menu order. Unique units need their civ; champions fall back to
 * DEFAULT_CHAMPION_CIV's when `civ` is absent.
 */
export function trainable(building: BuildingKind, civ?: CivId): UnitKind[] {
  return (Object.keys(UNITS) as UnitKind[]).filter((k) => {
    const u = UNITS[k];
    if (u.trainedAt !== building) return false;
    if (!u.civ) return true;
    return u.civ === (civ ?? (u.champion ? DEFAULT_CHAMPION_CIV : undefined));
  });
}

/**
 * Damage dealt by one attack on a unit of `defenderClass`: (attack − armour) per type (melee,
 * pierce, crush), at least 1 in total, plus class bonus. Missing crush armour is the unit
 * default (UNIT_CRUSH_ARMOR). Buildings: see damageTo in sim/systems/stats.
 */
export function damage(attacker: UnitKind, defenderClass: UnitClass, armor: DamageTypes): number {
  const a = UNITS[attacker];
  const arm = { ...armor, crush: crushOf(armor, UNIT_CRUSH_ARMOR) };
  return Math.max(1, rawDamage(a.attack, arm)) + (a.bonus[defenderClass] ?? 0);
}

/** A unit kind's table armour with its default crush armour filled in. */
export function unitArmor(kind: UnitKind): Required<DamageTypes> {
  const a = UNITS[kind].armor;
  return { melee: a.melee, pierce: a.pierce, crush: crushOf(a, UNIT_CRUSH_ARMOR) };
}

/** Elite fortress units (M16-5). */
export function isChampion(kind: UnitKind): boolean {
  return UNITS[kind].champion === true;
}

/**
 * Trained land units can take explicit economy orders; idle units never seek work.
 * Champions are soldiers only: they never gather, build or tend.
 */
export function canWork(kind: UnitKind): boolean {
  return UNITS[kind].trainedAt !== null && !isAnimal(kind) && !isShip(kind) && UNITS[kind].unitClass !== 'siege' && !isChampion(kind);
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
