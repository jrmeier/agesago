import type { BuildingKind, ResourceType, Stockpile, UnitKind } from './types';
import { UNITS, type UnitClass } from './units';

/**
 * Technology data table (M8) — ages, economy, military, building and market upgrades.
 * Single source of truth for sim, AI and HUD. FROZEN contract (integrator-owned): lanes
 * may tune numbers, but adding/removing ids or fields goes through the integrator.
 *
 * Effects are modifiers resolved by statOf(): value = (base + Σadd) × Πmul.
 */

/** 0 Village · 1 Town · 2 City · 3 Empire. */
export type Age = 0 | 1 | 2 | 3;
export const AGE_NAMES = ['Village Age', 'Town Age', 'City Age', 'Empire Age'] as const;

/**
 * Stats a tech can change. Unit stats apply per unit kind; building stats per building kind;
 * 'player' stats are economy-wide knobs.
 * - gather.X: multiplier on gather speed for resource X (base 1); gather.farm for farms only.
 * - carry.X: carry capacity for resource X (base BALANCE.carryCap).
 * - buildRate: multiplier on construction speed of that building kind (base 1).
 * - farmFood: food a new or reseeded farm holds (base FARM_FOOD).
 */
export type Stat =
  | 'hp'
  | 'speed'
  | 'sight'
  | 'attack.melee'
  | 'attack.pierce'
  | 'armor.melee'
  | 'armor.pierce'
  | 'range'
  | 'trainTime'
  | 'arrows'
  | 'garrison'
  | 'buildRate'
  | `gather.${ResourceType}`
  | 'gather.farm'
  | `carry.${ResourceType}`
  | 'farmFood'
  /** Player: fraction of a tribute lost as a fee (base MARKET.tributeFee). */
  | 'tributeFee'
  /** Player: price change per market trade (base MARKET.priceStep). */
  | 'priceStep';

/** Who a modifier applies to. */
export type ModTarget =
  | UnitKind
  | BuildingKind
  | `class:${UnitClass}`
  | 'allUnits'
  | 'allBuildings'
  | 'player';

export interface Modifier {
  target: ModTarget;
  stat: Stat;
  op: 'add' | 'mul';
  value: number;
}

/** Special behaviours that aren't a number (checked with hasFlag()). */
export type TechFlag =
  /** Archers, slingers and towers lead moving targets. */
  | 'ballistics'
  /** Towers and the Town Center have no minimum range. */
  | 'machicolations';

export interface TechSpec {
  name: string;
  /** One line for tooltips, in plain words. */
  description: string;
  /** Building kind that researches it. */
  at: BuildingKind;
  cost: Partial<Stockpile>;
  /** Seconds to research. */
  time: number;
  /** Minimum age to start it. */
  age: Age;
  requires?: TechId[];
  effects: Modifier[];
  /** Researching this advances the player to that age. */
  ageUp?: Age;
  /** A unit-line upgrade: units of `unit` are now called `title` (tier counts from 1). */
  line?: { unit: UnitKind; tier: number; title: string };
  /** A building upgrade: buildings of `kind` are now called `title` and render at `tier`. */
  upgrade?: { kind: BuildingKind; tier: number; title: string };
  flags?: TechFlag[];
}

const add = (target: ModTarget, stat: Stat, value: number): Modifier => ({ target, stat, op: 'add', value });
const mul = (target: ModTarget, stat: Stat, value: number): Modifier => ({ target, stat, op: 'mul', value });
/** +melee/+pierce armour for a target. */
const armor = (target: ModTarget, m: number, p: number): Modifier[] => [add(target, 'armor.melee', m), add(target, 'armor.pierce', p)];
const DEFENCES: BuildingKind[] = ['watchTower', 'townCenter'];

const table = {
  // ---- Ages (Town Center) ----
  townAge: {
    name: 'Town Age', description: 'Advance to the Town Age: archery range, stable, towers, forge and market.',
    at: 'townCenter', cost: { food: 500 }, time: 60, age: 0, effects: [], ageUp: 1,
  },
  cityAge: {
    name: 'City Age', description: 'Advance to the City Age: academy, unit upgrades and stronger defences.',
    at: 'townCenter', cost: { food: 800, gold: 200 }, time: 90, age: 1, effects: [], ageUp: 2,
  },
  empireAge: {
    name: 'Empire Age', description: 'Advance to the Empire Age: elite units and the finest techs.',
    at: 'townCenter', cost: { food: 1000, gold: 800, stone: 200 }, time: 120, age: 2, effects: [], ageUp: 3,
  },

  // ---- Town Center ----
  wovenTunics: {
    name: 'Woven Tunics', description: 'Villagers +15 HP, +1 melee and +2 pierce armour.',
    at: 'townCenter', cost: { gold: 50 }, time: 25, age: 0,
    effects: [add('villager', 'hp', 15), ...armor('villager', 1, 2)],
  },
  donkeyPacks: {
    name: 'Donkey Packs', description: 'Villagers walk 10% faster and carry 3 more.',
    at: 'townCenter', cost: { food: 175, wood: 50 }, time: 75, age: 0,
    effects: [mul('villager', 'speed', 1.1), ...(['wood', 'food', 'gold', 'stone'] as const).map((r) => add('villager', `carry.${r}`, 3))],
  },
  oxCarts: {
    name: 'Ox Carts', description: 'Villagers walk another 10% faster and carry 5 more.',
    at: 'townCenter', cost: { food: 300, wood: 200 }, time: 75, age: 2, requires: ['donkeyPacks'],
    effects: [mul('villager', 'speed', 1.1), ...(['wood', 'food', 'gold', 'stone'] as const).map((r) => add('villager', `carry.${r}`, 5))],
  },
  townWatch: {
    name: 'Town Watch', description: 'Town Center, towers and houses see 4 further.',
    at: 'townCenter', cost: { food: 75 }, time: 25, age: 1,
    effects: [add('townCenter', 'sight', 4), add('watchTower', 'sight', 4), add('house', 'sight', 4)],
  },
  townPatrol: {
    name: 'Town Patrol', description: 'Town Center, towers and houses see another 4 further.',
    at: 'townCenter', cost: { food: 300, gold: 100 }, time: 40, age: 2, requires: ['townWatch'],
    effects: [add('townCenter', 'sight', 4), add('watchTower', 'sight', 4), add('house', 'sight', 4)],
  },
  census: {
    name: 'Census', description: 'Villagers train 10% faster.',
    at: 'townCenter', cost: { food: 150, wood: 100 }, time: 40, age: 1,
    effects: [mul('villager', 'trainTime', 1 / 1.1)],
  },
  fortifiedTownCenter: {
    name: 'Fortified Town Center', description: 'Town Center +20% HP, +1 arrow and room for 2 more.',
    at: 'townCenter', cost: { wood: 200, stone: 150 }, time: 60, age: 2,
    effects: [mul('townCenter', 'hp', 1.2), add('townCenter', 'arrows', 1), add('townCenter', 'garrison', 2)],
    upgrade: { kind: 'townCenter', tier: 1, title: 'Fortified Town Center' },
  },

  // ---- Storehouse (wood) ----
  bronzeAxe: {
    name: 'Bronze Axe', description: '+20% wood gathering.',
    at: 'storehouse', cost: { food: 100, wood: 50 }, time: 25, age: 0, effects: [mul('villager', 'gather.wood', 1.2)],
  },
  ironAxe: {
    name: 'Iron Axe', description: 'Another +15% wood gathering.',
    at: 'storehouse', cost: { food: 200, gold: 100 }, time: 50, age: 1, requires: ['bronzeAxe'],
    effects: [mul('villager', 'gather.wood', 1.15)],
  },
  twoManSaw: {
    name: 'Two-Man Saw', description: 'Another +10% wood gathering.',
    at: 'storehouse', cost: { food: 300, gold: 200 }, time: 75, age: 2, requires: ['ironAxe'],
    effects: [mul('villager', 'gather.wood', 1.1)],
  },

  // ---- Mining camp ----
  bronzePicks: {
    name: 'Bronze Picks', description: '+20% gold mining.',
    at: 'miningCamp', cost: { food: 100, wood: 75 }, time: 30, age: 0, effects: [mul('villager', 'gather.gold', 1.2)],
  },
  stoneChisels: {
    name: 'Stone Chisels', description: '+20% stone quarrying.',
    at: 'miningCamp', cost: { food: 100, wood: 75 }, time: 30, age: 0, effects: [mul('villager', 'gather.stone', 1.2)],
  },
  deepShafts: {
    name: 'Deep Shafts', description: 'Another +15% gold and stone mining.',
    at: 'miningCamp', cost: { food: 200, wood: 150 }, time: 50, age: 1, requires: ['bronzePicks'],
    effects: [mul('villager', 'gather.gold', 1.15), mul('villager', 'gather.stone', 1.15)],
  },
  oreSledges: {
    name: 'Ore Sledges', description: 'Villagers carry 3 more gold and stone.',
    at: 'miningCamp', cost: { food: 300, wood: 200 }, time: 60, age: 2, requires: ['deepShafts'],
    effects: [add('villager', 'carry.gold', 3), add('villager', 'carry.stone', 3)],
  },

  // ---- Granary ----
  oxPlough: {
    name: 'Ox Plough', description: 'Farms hold 75 more food and are worked 10% faster.',
    at: 'granary', cost: { food: 75, wood: 75 }, time: 25, age: 0,
    effects: [add('farm', 'farmFood', 75), mul('villager', 'gather.farm', 1.1)],
  },
  ironPloughshare: {
    name: 'Iron Ploughshare', description: 'Farms hold 125 more food and are worked 10% faster.',
    at: 'granary', cost: { food: 250, wood: 125 }, time: 50, age: 1, requires: ['oxPlough'],
    effects: [add('farm', 'farmFood', 125), mul('villager', 'gather.farm', 1.1)],
  },
  cropRotation: {
    name: 'Crop Rotation', description: 'Farms hold 175 more food and are worked 10% faster.',
    at: 'granary', cost: { food: 400, wood: 250 }, time: 70, age: 2, requires: ['ironPloughshare'],
    effects: [add('farm', 'farmFood', 175), mul('villager', 'gather.farm', 1.1)],
  },
  threshingFloor: {
    name: 'Threshing Floor', description: '+20% food from berries, hunting and fishing.',
    at: 'granary', cost: { food: 150, wood: 100 }, time: 40, age: 1,
    effects: [mul('villager', 'gather.food', 1.2)],
  },

  // ---- Forge: melee attack (infantry + cavalry) ----
  bronzeWeapons: {
    name: 'Bronze Weapons', description: 'Infantry and cavalry +1 melee attack.',
    at: 'forge', cost: { food: 150, gold: 50 }, time: 40, age: 1,
    effects: [add('class:infantry', 'attack.melee', 1), add('class:cavalry', 'attack.melee', 1)],
  },
  ironWeapons: {
    name: 'Iron Weapons', description: 'Infantry and cavalry +1 melee attack.',
    at: 'forge', cost: { food: 250, gold: 150 }, time: 60, age: 2, requires: ['bronzeWeapons'],
    effects: [add('class:infantry', 'attack.melee', 1), add('class:cavalry', 'attack.melee', 1)],
  },
  temperedSteel: {
    name: 'Tempered Steel', description: 'Infantry and cavalry +2 melee attack.',
    at: 'forge', cost: { food: 350, gold: 250 }, time: 75, age: 3, requires: ['ironWeapons'],
    effects: [add('class:infantry', 'attack.melee', 2), add('class:cavalry', 'attack.melee', 2)],
  },
  // ---- Forge: infantry armour ----
  linenCorslet: {
    name: 'Linen Corslet', description: 'Infantry +1 melee and +1 pierce armour.',
    at: 'forge', cost: { food: 100 }, time: 40, age: 1, effects: armor('class:infantry', 1, 1),
  },
  bronzeScale: {
    name: 'Bronze Scale', description: 'Infantry +1 melee and +1 pierce armour.',
    at: 'forge', cost: { food: 200, gold: 100 }, time: 60, age: 2, requires: ['linenCorslet'], effects: armor('class:infantry', 1, 1),
  },
  ironLorica: {
    name: 'Iron Lorica', description: 'Infantry +2 melee and +2 pierce armour.',
    at: 'forge', cost: { food: 300, gold: 200 }, time: 75, age: 3, requires: ['bronzeScale'], effects: armor('class:infantry', 2, 2),
  },
  // ---- Forge: archer attack (+ towers) ----
  fletching: {
    name: 'Fletching', description: 'Archers, slingers, towers and the Town Center +1 pierce attack and +1 range.',
    at: 'forge', cost: { food: 100, gold: 50 }, time: 30, age: 1,
    effects: [add('class:archer', 'attack.pierce', 1), add('class:archer', 'range', 1),
      ...DEFENCES.flatMap((k) => [add(k, 'attack.pierce', 1), add(k, 'range', 1)])],
  },
  barbedPoints: {
    name: 'Barbed Points', description: 'Archers, slingers, towers and the Town Center +1 pierce attack and +1 range.',
    at: 'forge', cost: { food: 200, gold: 100 }, time: 50, age: 2, requires: ['fletching'],
    effects: [add('class:archer', 'attack.pierce', 1), add('class:archer', 'range', 1),
      ...DEFENCES.flatMap((k) => [add(k, 'attack.pierce', 1), add(k, 'range', 1)])],
  },
  compositeBows: {
    name: 'Composite Bows', description: 'Archers, slingers, towers and the Town Center +2 pierce attack.',
    at: 'forge', cost: { food: 300, gold: 200 }, time: 70, age: 3, requires: ['barbedPoints'],
    effects: [add('class:archer', 'attack.pierce', 2), ...DEFENCES.map((k) => add(k, 'attack.pierce', 2))],
  },
  // ---- Forge: archer armour ----
  paddedJerkin: {
    name: 'Padded Jerkin', description: 'Archers and slingers +1 melee and +1 pierce armour.',
    at: 'forge', cost: { food: 100 }, time: 40, age: 1, effects: armor('class:archer', 1, 1),
  },
  leatherCuirass: {
    name: 'Leather Cuirass', description: 'Archers and slingers +1 melee and +1 pierce armour.',
    at: 'forge', cost: { food: 150, gold: 150 }, time: 55, age: 2, requires: ['paddedJerkin'], effects: armor('class:archer', 1, 1),
  },
  mail: {
    name: 'Mail Shirts', description: 'Archers and slingers +2 melee and +2 pierce armour.',
    at: 'forge', cost: { food: 250, gold: 250 }, time: 70, age: 3, requires: ['leatherCuirass'], effects: armor('class:archer', 2, 2),
  },
  // ---- Forge: cavalry armour ----
  horseBlankets: {
    name: 'Horse Blankets', description: 'Cavalry +1 melee and +1 pierce armour.',
    at: 'forge', cost: { food: 150 }, time: 40, age: 1, effects: armor('class:cavalry', 1, 1),
  },
  scaleBarding: {
    name: 'Scale Barding', description: 'Cavalry +1 melee and +1 pierce armour.',
    at: 'forge', cost: { food: 250, gold: 150 }, time: 60, age: 2, requires: ['horseBlankets'], effects: armor('class:cavalry', 1, 1),
  },
  cataphractBarding: {
    name: 'Cataphract Barding', description: 'Cavalry +2 melee and +2 pierce armour.',
    at: 'forge', cost: { food: 350, gold: 250 }, time: 75, age: 3, requires: ['scaleBarding'], effects: armor('class:cavalry', 2, 2),
  },

  // ---- Unit lines ----
  veteranHoplite: {
    name: 'Veteran Hoplites', description: 'Hoplites become Veteran Hoplites: +25% HP, +2 attack, +1 armour.',
    at: 'barracks', cost: { food: 200, gold: 100 }, time: 45, age: 2,
    effects: [mul('hoplite', 'hp', 1.25), add('hoplite', 'attack.melee', 2), ...armor('hoplite', 1, 1)],
    line: { unit: 'hoplite', tier: 1, title: 'Veteran Hoplite' },
  },
  phalangite: {
    name: 'Phalangites', description: 'Veteran Hoplites become Phalangites: +25% HP, +3 attack, +1 range.',
    at: 'barracks', cost: { food: 450, gold: 300 }, time: 70, age: 3, requires: ['veteranHoplite'],
    effects: [mul('hoplite', 'hp', 1.25), add('hoplite', 'attack.melee', 3), add('hoplite', 'range', 0.4)],
    line: { unit: 'hoplite', tier: 2, title: 'Phalangite' },
  },
  championSwordsman: {
    name: 'Champion Swordsmen', description: 'Swordsmen become Champions: +30% HP, +2 attack, +1 armour.',
    at: 'barracks', cost: { food: 300, gold: 150 }, time: 55, age: 2,
    effects: [mul('swordsman', 'hp', 1.3), add('swordsman', 'attack.melee', 2), ...armor('swordsman', 1, 1)],
    line: { unit: 'swordsman', tier: 1, title: 'Champion Swordsman' },
  },
  compositeArcher: {
    name: 'Composite Archers', description: 'Archers become Composite Archers: +20% HP, +1 attack, +1 range.',
    at: 'archeryRange', cost: { wood: 200, gold: 150 }, time: 50, age: 2,
    effects: [mul('archer', 'hp', 1.2), add('archer', 'attack.pierce', 1), add('archer', 'range', 1)],
    line: { unit: 'archer', tier: 1, title: 'Composite Archer' },
  },
  balearicSlinger: {
    name: 'Balearic Slingers', description: 'Slingers become Balearic Slingers: +25% HP, +2 attack.',
    at: 'archeryRange', cost: { food: 200, stone: 100 }, time: 45, age: 2,
    effects: [mul('slinger', 'hp', 1.25), add('slinger', 'attack.pierce', 2)],
    line: { unit: 'slinger', tier: 1, title: 'Balearic Slinger' },
  },
  lightCavalry: {
    name: 'Light Cavalry', description: 'Scouts become Light Cavalry: +30% HP, +3 attack, +1 pierce armour.',
    at: 'stable', cost: { food: 150, gold: 50 }, time: 45, age: 1,
    effects: [mul('scout', 'hp', 1.3), add('scout', 'attack.melee', 3), add('scout', 'armor.pierce', 1)],
    line: { unit: 'scout', tier: 1, title: 'Light Cavalry' },
  },
  companionCavalry: {
    name: 'Companion Cavalry', description: 'Horsemen become Companion Cavalry: +25% HP, +2 attack, +1 armour.',
    at: 'stable', cost: { food: 300, gold: 300 }, time: 60, age: 2,
    effects: [mul('horseman', 'hp', 1.25), add('horseman', 'attack.melee', 2), ...armor('horseman', 1, 1)],
    line: { unit: 'horseman', tier: 1, title: 'Companion Cavalry' },
  },
  cataphract: {
    name: 'Cataphracts', description: 'Companion Cavalry become Cataphracts: +25% HP, +2 attack, +2 armour.',
    at: 'stable', cost: { food: 600, gold: 500 }, time: 80, age: 3, requires: ['companionCavalry'],
    effects: [mul('horseman', 'hp', 1.25), add('horseman', 'attack.melee', 2), ...armor('horseman', 2, 2)],
    line: { unit: 'horseman', tier: 2, title: 'Cataphract' },
  },

  // ---- Academy ----
  masonry: {
    name: 'Masonry', description: 'All buildings +10% HP, +1 melee and +1 pierce armour.',
    at: 'academy', cost: { wood: 175, stone: 150 }, time: 50, age: 2,
    effects: [mul('allBuildings', 'hp', 1.1), ...armor('allBuildings', 1, 1)],
  },
  architecture: {
    name: 'Architecture', description: 'All buildings another +10% HP, +1 melee and +1 pierce armour.',
    at: 'academy', cost: { wood: 300, stone: 200 }, time: 70, age: 3, requires: ['masonry'],
    effects: [mul('allBuildings', 'hp', 1.1), ...armor('allBuildings', 1, 1)],
  },
  treadwheelCrane: {
    name: 'Treadwheel Crane', description: 'Villagers build 20% faster.',
    at: 'academy', cost: { food: 300, wood: 200 }, time: 40, age: 2, effects: [mul('allBuildings', 'buildRate', 1.2)],
  },
  surveying: {
    name: 'Surveying', description: 'Farms and drop sites build 50% faster.',
    at: 'academy', cost: { food: 150, wood: 100 }, time: 30, age: 2,
    effects: (['farm', 'storehouse', 'granary', 'miningCamp'] as const).map((k) => mul(k, 'buildRate', 1.5)),
  },
  ballistics: {
    name: 'Ballistics', description: 'Archers, slingers and towers aim ahead of moving targets.',
    at: 'academy', cost: { wood: 300, gold: 175 }, time: 60, age: 2, effects: [], flags: ['ballistics'],
  },
  machicolations: {
    name: 'Machicolations', description: 'Towers and the Town Center can shoot units at their foot.',
    at: 'academy', cost: { food: 200, stone: 100 }, time: 40, age: 2, effects: [], flags: ['machicolations'],
  },
  fortifiedWalls: {
    name: 'Fortified Walls', description: 'Walls and gates +60% HP and +2 armour.',
    at: 'academy', cost: { food: 200, stone: 100 }, time: 50, age: 2,
    effects: (['palisade', 'stoneWall', 'gate'] as const).flatMap((k) => [mul(k, 'hp', 1.6), ...armor(k, 2, 2)]),
  },
  guardTower: {
    name: 'Guard Tower', description: 'Watch Towers become Guard Towers: +40% HP, +1 arrow, +1 range.',
    at: 'academy', cost: { food: 100, wood: 250 }, time: 45, age: 2,
    effects: [mul('watchTower', 'hp', 1.4), add('watchTower', 'arrows', 1), add('watchTower', 'range', 1)],
    upgrade: { kind: 'watchTower', tier: 1, title: 'Guard Tower' },
  },
  fortressTower: {
    name: 'Fortress Tower', description: 'Guard Towers become stone Fortress Towers: +50% HP, +1 arrow, +2 armour.',
    at: 'academy', cost: { food: 300, stone: 250 }, time: 70, age: 3, requires: ['guardTower'],
    effects: [mul('watchTower', 'hp', 1.5), add('watchTower', 'arrows', 1), ...armor('watchTower', 2, 2)],
    upgrade: { kind: 'watchTower', tier: 2, title: 'Fortress Tower' },
  },

  // ---- Market ----
  coinage: {
    name: 'Coinage', description: 'Tribute fee drops to 10%.',
    at: 'market', cost: { food: 200, gold: 100 }, time: 40, age: 2, effects: [add('player', 'tributeFee', -0.2)],
  },
  merchantGuilds: {
    name: 'Merchant Guilds', description: 'Market prices move half as much per trade.',
    at: 'market', cost: { food: 300, gold: 200 }, time: 60, age: 3, effects: [mul('player', 'priceStep', 0.5)],
  },
  caravans: {
    name: 'Caravans', description: 'Trade carts move 50% faster.',
    at: 'market', cost: { food: 200, gold: 200 }, time: 50, age: 2, effects: [mul('tradeCart', 'speed', 1.5)],
  },
} satisfies Record<string, Omit<TechSpec, 'requires'> & { requires?: readonly string[] }>;

export type TechId = keyof typeof table;
/** Every tech, by id. (`requires` ids are checked by techs.test.ts.) */
export const TECHS = table as Record<TechId, TechSpec>;
export const TECH_IDS = Object.keys(TECHS) as TechId[];

/** Techs researched at a building kind, in table order. */
export function techsAt(kind: BuildingKind): TechId[] {
  return TECH_IDS.filter((t) => TECHS[t].at === kind);
}

/** What a modifier lookup is about. */
export type Subject = { unit: UnitKind } | { building: BuildingKind } | 'player';

function matches(target: ModTarget, subject: Subject): boolean {
  if (subject === 'player') return target === 'player';
  if ('unit' in subject) {
    if (target === subject.unit || target === 'allUnits') return true;
    return target.startsWith('class:') && target.slice(6) === UNITS[subject.unit].unitClass;
  }
  return target === subject.building || target === 'allBuildings';
}

/** Sum of adds and product of muls from `researched` for one stat. */
export function statMods(researched: Iterable<TechId>, subject: Subject, stat: Stat): { add: number; mul: number } {
  let a = 0;
  let m = 1;
  for (const id of researched) {
    for (const e of TECHS[id].effects) {
      if (e.stat !== stat || !matches(e.target, subject)) continue;
      if (e.op === 'add') a += e.value;
      else m *= e.value;
    }
  }
  return { add: a, mul: m };
}

/** (base + Σadd) × Πmul. Pure; the sim's statOf() caches this per player. */
export function applyStat(researched: Iterable<TechId>, subject: Subject, stat: Stat, base: number): number {
  const { add: a, mul: m } = statMods(researched, subject, stat);
  return (base + a) * m;
}

export function hasFlag(researched: Iterable<TechId>, flag: TechFlag): boolean {
  for (const id of researched) if ((TECHS[id] as TechSpec).flags?.includes(flag)) return true;
  return false;
}

/** Current unit-line tier (0 = base) and display name for `kind`. */
export function unitLine(researched: ReadonlySet<TechId>, kind: UnitKind): { tier: number; title: string } {
  let best = { tier: 0, title: UNITS[kind].name };
  for (const id of researched) {
    const l = (TECHS[id] as TechSpec).line;
    if (l && l.unit === kind && l.tier > best.tier) best = { tier: l.tier, title: l.title };
  }
  return best;
}

/** Current upgrade tier (0 = base) and display name override for a building kind, if any. */
export function buildingTier(researched: ReadonlySet<TechId>, kind: BuildingKind): { tier: number; title: string | null } {
  let best: { tier: number; title: string | null } = { tier: 0, title: null };
  for (const id of researched) {
    const u = (TECHS[id] as TechSpec).upgrade;
    if (u && u.kind === kind && u.tier > best.tier) best = { tier: u.tier, title: u.title };
  }
  return best;
}

/** Highest tier researched in a chain like bronzeAxe → ironAxe → twoManSaw (0 = none). */
export function chainTier(researched: ReadonlySet<TechId>, chain: readonly TechId[]): number {
  let n = 0;
  chain.forEach((t, i) => { if (researched.has(t)) n = i + 1; });
  return n;
}

/** Tool and armour chains, for renderers that show upgrade tiers. */
export const CHAINS = {
  wood: ['bronzeAxe', 'ironAxe', 'twoManSaw'],
  mining: ['bronzePicks', 'deepShafts', 'oreSledges'],
  farming: ['oxPlough', 'ironPloughshare', 'cropRotation'],
  meleeAttack: ['bronzeWeapons', 'ironWeapons', 'temperedSteel'],
  infantryArmor: ['linenCorslet', 'bronzeScale', 'ironLorica'],
  archerAttack: ['fletching', 'barbedPoints', 'compositeBows'],
  archerArmor: ['paddedJerkin', 'leatherCuirass', 'mail'],
  cavalryArmor: ['horseBlankets', 'scaleBarding', 'cataphractBarding'],
} as const satisfies Record<string, readonly TechId[]>;
