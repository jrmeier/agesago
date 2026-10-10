import type { Age, BuildingKind, ResourceType, Stockpile } from './types';

/**
 * Building data table — the single source of truth for sizes, costs and roles.
 * FROZEN contract (integrator-owned); request balance changes rather than editing in a lane.
 */
export interface BuildingSpec {
  name: string;
  /** Footprint in world units before rotation (x = width, z = depth). */
  size: { w: number; d: number };
  cost: Partial<Stockpile>;
  /** Seconds for one builder; more builders speed it up with diminishing returns. */
  buildTime: number;
  /** Population capacity provided once complete. */
  popBonus: number;
  /** Resource types villagers may deposit here once complete. */
  drop: ResourceType[];
  /** Units can walk across it (farms). Otherwise it blocks pathing. */
  walkable: boolean;
  /** Shown in the villager build menu. */
  buildable: boolean;
  /** Fog-of-war sight radius once complete. */
  sight: number;
  /** Hit points once complete (foundations scale with buildProgress). */
  hp: number;
  /** Damage reduction against attacks. */
  armor: { melee: number; pierce: number };
  /** Pierce attack once complete. `arrows` fire with nobody inside; each garrisoned villager adds one. */
  attack?: { pierce: number; range: number; reload: number; arrows: number };
  /** Villagers that can shelter here once complete. */
  garrison?: number;
  /** Placed by dragging a line of segments rather than one click. */
  line?: boolean;
  /** A finished gate lets its owner walk through and blocks everyone else. */
  gate?: boolean;
  /** Earliest age it can be placed in (default 0, Village). */
  age?: Age;
}

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  townCenter: {
    name: 'Town Center',
    size: { w: 3.2, d: 3.2 },
    cost: { wood: 275, stone: 100 },
    buildTime: 150,
    popBonus: 5,
    drop: ['wood', 'food', 'gold', 'stone'],
    walkable: false,
    buildable: false,
    sight: 11,
    hp: 2400,
    armor: { melee: 3, pierce: 7 },
    garrison: 10,
    attack: { pierce: 5, range: 6, reload: 2, arrows: 0 },
  },
  house: {
    name: 'House',
    size: { w: 2.6, d: 2.6 },
    cost: { wood: 30 },
    buildTime: 15,
    popBonus: 5,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 4,
    hp: 550,
    armor: { melee: 0, pierce: 7 },
  },
  storehouse: {
    name: 'Storehouse',
    size: { w: 3, d: 3 },
    cost: { wood: 100 },
    buildTime: 25,
    popBonus: 0,
    drop: ['wood'],
    walkable: false,
    buildable: true,
    sight: 5,
    hp: 600,
    armor: { melee: 0, pierce: 7 },
  },
  miningCamp: {
    name: 'Mining Camp',
    size: { w: 3, d: 3 },
    cost: { wood: 100 },
    buildTime: 25,
    popBonus: 0,
    drop: ['gold', 'stone'],
    walkable: false,
    buildable: true,
    sight: 5,
    hp: 600,
    armor: { melee: 0, pierce: 7 },
  },
  granary: {
    name: 'Granary',
    size: { w: 3, d: 3 },
    cost: { wood: 100 },
    buildTime: 25,
    popBonus: 0,
    drop: ['food'],
    walkable: false,
    buildable: true,
    sight: 5,
    hp: 600,
    armor: { melee: 0, pierce: 7 },
  },
  farm: {
    name: 'Farm',
    size: { w: 4, d: 4 },
    cost: { wood: 60 },
    buildTime: 10,
    popBonus: 0,
    drop: [],
    walkable: true,
    buildable: true,
    sight: 2,
    hp: 480,
    armor: { melee: 0, pierce: 0 },
  },
  barracks: {
    name: 'Barracks',
    size: { w: 4, d: 4 },
    cost: { wood: 175 },
    buildTime: 40,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 6,
    hp: 1200,
    armor: { melee: 1, pierce: 7 },
  },
  archeryRange: {
    name: 'Archery Range',
    size: { w: 4, d: 4 },
    cost: { wood: 175 },
    buildTime: 40,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 6,
    hp: 1000,
    armor: { melee: 1, pierce: 7 },
    age: 1,
  },
  stable: {
    name: 'Stable',
    size: { w: 4, d: 4 },
    cost: { wood: 175 },
    buildTime: 40,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 6,
    hp: 1000,
    armor: { melee: 1, pierce: 7 },
    age: 1,
  },
  watchTower: {
    name: 'Watch Tower',
    size: { w: 2.2, d: 2.2 },
    cost: { wood: 80, stone: 50 },
    buildTime: 45,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 14,
    hp: 900,
    armor: { melee: 1, pierce: 7 },
    age: 1,
    garrison: 5,
    attack: { pierce: 6, range: 8, reload: 2, arrows: 1 },
  },
  palisade: {
    name: 'Palisade',
    size: { w: 2, d: 2 },
    cost: { wood: 6 },
    buildTime: 8,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 2,
    hp: 280,
    armor: { melee: 0, pierce: 2 },
    line: true,
  },
  stoneWall: {
    name: 'Stone Wall',
    size: { w: 2, d: 2 },
    cost: { stone: 6 },
    buildTime: 12,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 2,
    hp: 1200,
    armor: { melee: 2, pierce: 8 },
    age: 1,
    line: true,
  },
  gate: {
    name: 'Gate',
    size: { w: 2, d: 2 },
    cost: { wood: 30 },
    buildTime: 18,
    popBonus: 0,
    drop: [],
    walkable: true,
    buildable: true,
    sight: 3,
    hp: 650,
    armor: { melee: 1, pierce: 5 },
    age: 1,
    gate: true,
  },
  forge: {
    name: 'Forge',
    size: { w: 3.4, d: 3.4 },
    cost: { wood: 150 },
    buildTime: 40,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 6,
    hp: 1000,
    armor: { melee: 1, pierce: 7 },
    age: 1,
  },
  market: {
    name: 'Market',
    size: { w: 4.4, d: 4.4 },
    cost: { wood: 175 },
    buildTime: 50,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 6,
    hp: 1400,
    armor: { melee: 1, pierce: 7 },
    age: 1,
  },
  temple: {
    name: 'Temple', size: { w: 4, d: 4 }, cost: { wood: 180, stone: 80 },
    buildTime: 50, popBonus: 0, drop: [], walkable: false, buildable: true,
    sight: 8, hp: 1400, armor: { melee: 1, pierce: 7 }, age: 1,
  },
  academy: {
    name: 'Academy',
    size: { w: 4.4, d: 4.4 },
    cost: { wood: 200, stone: 100 },
    buildTime: 60,
    popBonus: 0,
    drop: [],
    walkable: false,
    buildable: true,
    sight: 6,
    hp: 1600,
    armor: { melee: 2, pierce: 8 },
    age: 2,
  },
};

/** Food a new farm holds. */
export const FARM_FOOD = 250;
/** Absolute population ceiling regardless of houses. */
export const MAX_POP = 200;

/** Footprint half-extents after rotation (rot snapped to 90° steps). */
export function footprint(kind: BuildingKind, rot: number): { hw: number; hd: number } {
  const { w, d } = BUILDINGS[kind].size;
  const quarter = Math.round(rot / (Math.PI / 2)) & 1;
  return quarter ? { hw: d / 2, hd: w / 2 } : { hw: w / 2, hd: d / 2 };
}

/** Bounding radius of a footprint (half its diagonal). */
export function footprintRadius(kind: BuildingKind): number {
  const { w, d } = BUILDINGS[kind].size;
  return Math.hypot(w, d) / 2;
}

/** Market tuning (M8-12). Prices are gold per 100 of a resource. */
export const MARKET = {
  /** Starting price of each resource. */
  basePrice: 100,
  /** Each trade moves that resource's price by this fraction (modified by 'priceStep'). */
  priceStep: 0.03,
  /** Prices drift back toward base by this fraction of the gap per second. */
  recovery: 0.004,
  minPrice: 20,
  maxPrice: 300,
  /** Selling gets this fraction of the buy price (the spread). */
  sellFactor: 0.7,
  /** Fraction of a tribute lost in transit (modified by 'tributeFee'). */
  tributeFee: 0.3,
  /**
   * Trade cart gold per trip = goldPerDistance × d² / tradeRefDistance, d = distance between the
   * markets. Quadratic, like AoE, so gold per minute grows with distance (trip time is linear) and
   * long, exposed routes pay; a trip of tradeRefDistance pays goldPerDistance × d.
   */
  goldPerDistance: 0.6,
  tradeRefDistance: 40,
} as const;
