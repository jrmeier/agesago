import { BUILDINGS } from '../core/buildings';
import { CHAINS, TECHS, TECH_IDS, type TechId } from '../core/techs';
import type { Age, Building, BuildingKind, MarketResource, ResourceType, Stockpile, UnitKind, UnitState, Vec2 } from '../core/types';
import { isAnimal, UNITS, type UnitClass } from '../core/units';
import { buyCost, LOT, sellGain } from '../sim/systems/market';
import { ageBuildingsNeeded, ageBuildings, ageOf, isQueued, researchBlock } from '../sim/systems/research';
import { canAfford, dist, type Ctx, type Snapshot } from './context';
import { norm, type Economy } from './economy';
import type { ResearchProfile, TechGroup } from './profile';

const TYPES: ResourceType[] = ['food', 'wood', 'gold', 'stone'];
const WORKING: ReadonlySet<UnitState> = new Set(['toNode', 'gathering', 'toDrop']);
/** Kinds that don't count toward the two-buildings rule for aging up (mirrors research.ts). */
const NOT_AGE_BUILDINGS = new Set<BuildingKind>(['townCenter', 'house', 'farm', 'palisade', 'stoneWall', 'gate']);
/** Buildings the AI adds to qualify for the next age, in order of preference, by current age. */
const AGE_PICKS: Record<number, BuildingKind[]> = {
  0: ['storehouse', 'granary', 'barracks', 'miningCamp'],
  1: ['forge', 'market', 'archeryRange'],
};
const AGE_UP: Partial<Record<Age, TechId>> = { 0: 'townAge', 1: 'cityAge' };
/** Seconds the Town Center rests between villager-blocking techs while the economy still grows. */
const TC_REST = 45;
/** Longest villager-training pause (sim seconds) to afford one economy tech. */
const MAX_HOLD = 30;
/** Most market trades per pass. */
const TRADES_PER_PASS = 3;

/** What the priority table's conditions look at, gathered once per pass. */
export interface Facts {
  age: Age;
  villagers: number;
  /** Villagers working each resource (food includes farms). */
  workers: Record<ResourceType, number>;
  farmers: number;
  /** Army units by class and by kind. */
  classes: Record<UnitClass, number>;
  units: Partial<Record<UnitKind, number>>;
  army: number;
  /** Completed buildings by kind. */
  built: Partial<Record<BuildingKind, number>>;
  /** Hit in the last two minutes. */
  raided: boolean;
  p: ResearchProfile;
}

export interface Rule {
  tech: TechId;
  group: TechGroup;
  /** Base priority (higher first), multiplied by the profile's group weight. */
  base: number;
  /** Worth researching now (age, requirements and cost are checked separately). */
  when: (f: Facts) => boolean;
}

const share = (f: Facts, ...cs: UnitClass[]) => {
  const n = cs.reduce((a, c) => a + f.classes[c], 0);
  return { n, share: f.army ? n / f.army : 0 };
};
/** A forge line fits the army: at least 3 such units making up a quarter of it. */
const fits = (f: Facts, ...cs: UnitClass[]) => {
  const { n, share: sh } = share(f, ...cs);
  return n >= 3 && sh >= 0.25;
};

function chain(ids: readonly TechId[], group: TechGroup, bases: number[], when: (f: Facts) => boolean): Rule[] {
  return ids.map((tech, i) => ({ tech, group, base: bases[i] ?? bases[bases.length - 1], when }));
}

/**
 * The research priority table. Each rule says when a tech is worth it; the profile weights each
 * group (0 = never). Chain order and age gates come from researchBlock().
 */
export const RULES: Rule[] = [
  ...(['hellenicDiscipline','romanEngineering','royalRoads','woodlandCraft'] as TechId[]).map(tech => ({tech,group:'forge' as const,base:30,when:(f:Facts)=>f.army>=5})),
  // Economy: drop-site techs once enough villagers work that resource.
  ...chain(CHAINS.wood, 'eco', [60, 46, 36], (f) => f.workers.wood >= f.p.ecoWorkers),
  ...chain(CHAINS.mining, 'eco', [55, 40, 30], (f) => f.workers.gold + (f.age ? f.workers.stone : 0) >= f.p.ecoWorkers),
  ...chain(CHAINS.farming, 'eco', [58, 46, 36], (f) => f.workers.food >= f.p.ecoWorkers && f.farmers >= 3),
  { tech: 'stoneChisels', group: 'eco', base: 35, when: (f) => f.workers.stone >= f.p.ecoWorkers },
  { tech: 'threshingFloor', group: 'eco', base: 40, when: (f) => f.workers.food - f.farmers >= Math.ceil(f.p.ecoWorkers / 2) || f.workers.food >= f.p.ecoWorkers + 4 },
  // Town Center.
  { tech: 'wovenTunics', group: 'tc', base: 42, when: (f) => f.villagers >= 12 || f.raided },
  { tech: 'donkeyPacks', group: 'tc', base: 50, when: (f) => f.villagers >= 20 },
  { tech: 'census', group: 'tc', base: 44, when: () => true },
  { tech: 'townWatch', group: 'tc', base: 22, when: () => true },
  { tech: 'oxCarts', group: 'tc', base: 44, when: (f) => f.villagers >= 25 },
  { tech: 'townPatrol', group: 'tc', base: 10, when: (f) => f.raided },
  { tech: 'fortifiedTownCenter', group: 'tc', base: 14, when: (f) => f.raided },
  // Forge: lines matched to the army's make-up.
  ...chain(CHAINS.meleeAttack, 'forge', [42, 34, 28], (f) => fits(f, 'infantry', 'cavalry')),
  ...chain(CHAINS.infantryArmor, 'forge', [38, 31, 26], (f) => fits(f, 'infantry')),
  ...chain(CHAINS.archerAttack, 'forge', [42, 34, 28], (f) => fits(f, 'archer')),
  ...chain(CHAINS.archerArmor, 'forge', [34, 28, 24], (f) => fits(f, 'archer')),
  ...chain(CHAINS.cavalryArmor, 'forge', [36, 30, 25], (f) => fits(f, 'cavalry')),
  // Unit lines it has plenty of.
  ...TECH_IDS.filter((t) => TECHS[t].line).map(
    (tech): Rule => ({ tech, group: 'line', base: 40 - 8 * (TECHS[tech].line!.tier - 1), when: (f) => (f.units[TECHS[tech].line!.unit] ?? 0) >= f.p.lineUnits })
  ),
  // Defences.
  { tech: 'guardTower', group: 'defence', base: 30, when: (f) => !!f.built.watchTower },
  { tech: 'fortressTower', group: 'defence', base: 20, when: (f) => !!f.built.watchTower },
  { tech: 'ballistics', group: 'defence', base: 32, when: (f) => f.classes.archer >= f.p.lineUnits },
  { tech: 'masonry', group: 'defence', base: 26, when: (f) => f.classes.archer >= f.p.lineUnits || (f.raided && !!f.built.watchTower) },
];

/**
 * Ages and upgrades (M8-16): saves for and starts age-ups once the villager count and the two
 * current-age buildings are there, adds the buildings it lacks, researches from the priority
 * table within a budget that keeps villagers training, and trades at its market when one
 * resource piles up while another is short. Acts only through Ctx.issue (world.dispatch).
 */
export class Research {
  /** Techs this AI started, in order (tests and debugging). */
  readonly started: { tech: TechId; at: number }[] = [];
  /** Sim time each age was reached. */
  readonly agedAt: number[] = [0];
  /** Market trades made. */
  trades = 0;
  /** The surplus resource it is trading down, if any. */
  private selling: ResourceType | null = null;
  private lastTech = -Infinity;
  private tcFreeAt = -Infinity;
  private lastHit = -Infinity;
  /** Cost of the best tech it wanted but couldn't afford on the last pass (the market tops this up). */
  private wanted: Partial<Stockpile> = {};
  /** The economy tech villager training is paused for, and since when. */
  private hold: { tech: TechId; since: number } | null = null;

  constructor(
    private readonly c: Ctx,
    private readonly econ: Economy
  ) {}

  /** One of ours was hit at `pos`: a raid if an enemy soldier is in sight there (not a wolf, a boar or a scout). */
  onAttacked(pos: Vec2): void {
    const { world, player, intel } = this.c;
    if (world.time - this.lastHit < 5) return;
    for (const u of world.units.values()) {
      if (isAnimal(u.kind) || u.kind === 'scout' || u.kind === 'villager' || !world.areEnemies(player, u.owner) || dist(u.pos, pos) > 12 || !intel.sees(u.pos.x, u.pos.z)) continue;
      this.lastHit = world.time;
      return;
    }
  }

  onAgedUp(age: Age): void {
    this.agedAt[age] = this.c.world.time;
  }

  pass(s: Snapshot): void {
    const p = this.c.profile.research;
    if (!p) return;
    const f = this.facts(s, p);
    this.c.armyFirst = f.raided || this.c.intel.enemyArmy() > f.army * 1.3 + 5;
    this.ageUp(s, f, p);
    this.buildings(s, f, p);
    this.research(s, f, p);
    this.market(s, p);
  }

  facts(s: Snapshot, p: ResearchProfile): Facts {
    const { world, player } = this.c;
    const workers: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
    let farmers = 0;
    for (const v of s.villagers) {
      if (!v.gatherType || !WORKING.has(v.state)) continue;
      workers[v.gatherType]++;
      if (v.gatherNode !== null && world.buildings.has(v.gatherNode)) farmers++;
    }
    const classes: Record<UnitClass, number> = { villager: 0, infantry: 0, archer: 0, cavalry: 0, wildlife: 0 };
    const units: Partial<Record<UnitKind, number>> = {};
    for (const u of s.army) {
      classes[UNITS[u.kind].unitClass]++;
      units[u.kind] = (units[u.kind] ?? 0) + 1;
    }
    const built: Partial<Record<BuildingKind, number>> = {};
    for (const b of s.buildings) if (b.complete) built[b.kind] = (built[b.kind] ?? 0) + 1;
    return {
      age: ageOf(world, player),
      villagers: s.villagers.length,
      workers,
      farmers,
      classes,
      units,
      army: s.army.length,
      built,
      raided: world.time - this.lastHit < 120,
      p,
    };
  }

  // ---- Ages ----

  /** Is the AI close enough to its next age that the Town Center should stay free for it? */
  private nearAge(f: Facts, p: ResearchProfile): boolean {
    if (!AGE_UP[f.age]) return false;
    const need = f.age === 0 ? p.townAgeAt : p.cityAgeAt;
    return f.villagers >= need - 2;
  }

  private ageUp(s: Snapshot, f: Facts, p: ResearchProfile): void {
    const { world, player } = this.c;
    const tech = AGE_UP[f.age];
    this.c.reserve = {};
    this.c.aging = false;
    this.c.pauseVillagers = false;
    if (!tech) return;
    if (isQueued(world, player, tech)) {
      this.c.aging = true;
      return;
    }
    const need = f.age === 0 ? p.townAgeAt : p.cityAgeAt;
    const earliest = f.age === 0 ? p.townAgeTime : p.cityAgeTime;
    if (f.villagers < need - 3 || world.time < earliest - 90) return;

    // The two current-age buildings: add one if it lacks them (counting ones going up).
    const have = new Set(ageBuildings(world, player, f.age));
    for (const b of s.buildings) if (!b.complete && !NOT_AGE_BUILDINGS.has(b.kind) && (BUILDINGS[b.kind].age ?? 0) === f.age) have.add(b.kind);
    if (have.size < ageBuildingsNeeded(f.age)) this.addAgeBuilding(s, f.age, have);

    if (f.villagers < need || world.time < earliest || have.size < ageBuildingsNeeded(f.age)) return;
    // Save for it: villagers, army, buildings and other research leave this alone.
    this.c.reserve = { ...TECHS[tech].cost };
    this.c.aging = true;
    // Village Age: stop villagers briefly to click up (food can't fund both); later ages keep booming.
    this.c.pauseVillagers = f.age === 0 && !this.c.armyFirst;
    const tc = s.tc;
    if (tc?.complete && researchBlock(world, player, tech) === null) this.start(tc, tech);
  }

  private addAgeBuilding(s: Snapshot, age: Age, have: Set<BuildingKind>): void {
    for (const kind of AGE_PICKS[age] ?? []) {
      if (have.has(kind)) continue;
      const r = this.place(s, kind);
      if (r !== null) return;
    }
  }

  /** Lay a `kind` where it belongs: drop sites by their resource, the rest near the base. */
  private place(s: Snapshot, kind: BuildingKind): boolean | null {
    const home = s.tc?.pos ?? this.c.home;
    const builders = Math.min(2, this.c.profile.builders);
    const res: ResourceType | null = kind === 'storehouse' ? 'wood' : kind === 'miningCamp' ? 'gold' : null;
    if (res) {
      const at = this.nearestNode(res, home) ?? (kind === 'miningCamp' ? this.nearestNode('stone', home) : null);
      if (!at) return null;
      return this.econ.buildAt(s, kind, at, 2.5, 12, builders, at);
    }
    if (kind === 'granary') return this.econ.buildAt(s, kind, home, 5, 18, builders);
    return this.econ.buildAt(s, kind, home, 9, 28, this.c.profile.builders);
  }

  private nearestNode(type: ResourceType, from: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const n of this.c.intel.nodes[type]) {
      if (n.amount <= 0) continue;
      const d = dist(n.pos, from);
      if (d < bestD) [best, bestD] = [n.pos, d];
    }
    return best;
  }

  // ---- Forge, market, academy ----

  private buildings(s: Snapshot, f: Facts, p: ResearchProfile): void {
    const has = (k: BuildingKind) => (s.count[k] ?? 0) > 0;
    const production = (f.built.barracks ?? 0) + (f.built.archeryRange ?? 0) + (f.built.stable ?? 0);
    const stock = this.c.world.stockOf(this.c.player);
    // Town Age: an archery range early when gold piles up (archers spend it), before the forge.
    if (f.age >= 1 && !has('archeryRange') && stock.gold > 300 && production < this.c.profile.maxProduction) {
      if (this.place(s, 'archeryRange') !== null) return;
    }
    // Watch towers toward the enemy: they spend the stone that otherwise piles up, and hold
    // the base while it techs.
    const towers = s.count.watchTower ?? 0;
    if (f.age >= 1 && p.weights.defence > 0 && towers < p.towers && !s.building.watchTower && stock.stone >= 50 + 100 * towers) {
      const home = s.tc?.pos ?? this.c.home;
      const enemy = this.c.intel.enemyStart;
      const toward = enemy ? norm({ x: enemy.x - home.x, z: enemy.z - home.z }) : undefined;
      if (this.econ.buildAt(s, 'watchTower', home, 7, 15, 1, undefined, toward) !== null) return;
    }
    // A forge once it has an army plan in the Town Age.
    if (f.age >= 1 && p.weights.forge > 0 && production > 0 && !has('forge')) {
      if (this.place(s, 'forge') !== null) return;
    }
    // An academy in the City Age for a ranged army or towers.
    if (f.age >= 2 && p.weights.defence > 0 && !has('academy') && (f.classes.archer >= p.lineUnits || f.built.watchTower)) {
      if (this.place(s, 'academy') !== null) return;
    }
    // A market when a stockpile runs away (to trade it before it passes the excess mark).
    if (f.age >= 1 && !has('market') && TYPES.some((t) => stock[t] > p.marketExcess * 0.6)) {
      this.place(s, 'market');
    }
  }

  // ---- Research ----

  /** The table's best wanted tech that can start now, by weighted priority. */
  choose(s: Snapshot, f: Facts, p: ResearchProfile): { tech: TechId; at: Building } | null {
    const { world, player, profile } = this.c;
    const stock = world.stockOf(player);
    const reserve: Partial<Stockpile> = { ...this.c.reserve };
    const booming = f.villagers < profile.targetVillagers && !!s.tc;
    if (booming) reserve.food = (reserve.food ?? 0) + 50 + p.villagerReserve;
    const tcBusy = booming && (world.time < this.tcFreeAt || this.nearAge(f, p));
    // Idle research buildings by kind (one tech at a time each, so training never waits long).
    const idle = new Map<BuildingKind, Building>();
    for (const b of s.buildings) if (b.complete && !b.research?.length && !idle.has(b.kind)) idle.set(b.kind, b);
    let best: { tech: TechId; at: Building; score: number } | null = null;
    let want: { tech: TechId; score: number; group: TechGroup } | null = null;
    for (const r of RULES) {
      const w = p.weights[r.group];
      if (w <= 0) continue;
      const spec = TECHS[r.tech];
      const at = idle.get(spec.at);
      if (!at || (spec.at === 'townCenter' && tcBusy)) continue;
      const score = r.base * w;
      if ((best && score <= best.score) || !r.when(f)) continue;
      if (researchBlock(world, player, r.tech, true) !== null) continue;
      // The tech villagers are paused for doesn't also keep the villager reserve.
      if (!canAfford(stock, spec.cost, this.hold?.tech === r.tech ? this.c.reserve : reserve)) {
        if (!want || score > want.score) want = { tech: r.tech, score, group: r.group };
        continue;
      }
      best = { tech: r.tech, at, score };
    }
    this.wanted = want && (!best || want.score > best.score) ? { ...TECHS[want.tech].cost } : {};
    // Hold the army back for it (not villagers), unless under attack.
    this.c.techReserve = !best && !this.c.armyFirst ? this.wanted : {};
    // A wanted drop-site tech may pause villager training briefly (not while saving for an age).
    const hold = !best && want && want.group === 'eco' && !this.c.reserve.food && !f.raided ? want.tech : null;
    if (!hold) this.hold = null;
    else if (this.hold?.tech !== hold) this.hold = { tech: hold, since: world.time };
    this.c.villagerHold = this.hold && world.time - this.hold.since < MAX_HOLD ? (TECHS[this.hold.tech].cost.food ?? 0) : 0;
    return best;
  }

  private research(s: Snapshot, f: Facts, p: ResearchProfile): void {
    if (this.c.world.time - this.lastTech < p.gap) {
      this.c.techReserve = {};
      this.c.villagerHold = 0;
      return;
    }
    const pick = this.choose(s, f, p);
    if (pick) this.start(pick.at, pick.tech);
  }

  private start(b: Building, tech: TechId): void {
    const before = b.research?.length ?? 0;
    this.c.issue({ type: 'research', buildingId: b.id, tech });
    if ((b.research?.length ?? 0) <= before) return;
    const t = this.c.world.time;
    this.started.push({ tech, at: t });
    if (TECHS[tech].ageUp === undefined) this.lastTech = t;
    if (b.kind === 'townCenter') this.tcFreeAt = t + TECHS[tech].time + TC_REST;
  }

  // ---- Market ----

  /**
   * With a finished market: when a resource is over the profile's excess while another needed
   * one (for the age-up being saved for, the tech it wants, or simply running dry) is short,
   * sell the surplus and/or buy the shortfall, a few lots per pass.
   */
  private market(s: Snapshot, p: ResearchProfile): void {
    const { world, player } = this.c;
    if (!s.buildings.some((b) => b.kind === 'market' && b.complete)) return;
    const prices = world.players.get(player)?.prices;
    if (!prices) return;
    const stock = world.stockOf(player);
    const need: Record<ResourceType, number> = { food: 200, wood: 200, gold: 100, stone: 0 };
    for (const t of TYPES) need[t] = Math.max(need[t], this.c.reserve[t] ?? 0, this.wanted[t] ?? 0);
    for (let i = 0; i < TRADES_PER_PASS; i++) {
      const short = TYPES.filter((t) => stock[t] < need[t]).sort((a, b) => stock[a] - need[a] - (stock[b] - need[b]))[0];
      // Trading starts once a stock passes the excess mark and goes on until it is down to half
      // of it (or nothing is short), so a glut is actually put to use.
      // Never sell into a need: a resource saved for the age-up (or a wanted tech) is not surplus,
      // or the AI sells food it is saving and buys it straight back.
      const rich = TYPES.filter(
        (t) =>
          t !== short &&
          stock[t] > (this.selling === t ? p.marketExcess / 2 : p.marketExcess) &&
          stock[t] - need[t] >= LOT
      ).sort((a, b) => stock[b] - stock[a])[0];
      this.selling = rich ?? null;
      if (!short || !rich) return;
      if (rich !== 'gold' && short === 'gold') {
        if (!this.trade(rich as MarketResource, 'sell', prices)) return;
      } else if (rich === 'gold') {
        if (!this.trade(short as MarketResource, 'buy', prices)) return;
      } else {
        // Two goods: sell the surplus for gold, then buy what's short with it.
        if (!this.trade(rich as MarketResource, 'sell', prices)) return;
        if (!this.trade(short as MarketResource, 'buy', prices)) return;
      }
    }
  }

  private trade(resource: MarketResource, side: 'buy' | 'sell', prices: Record<MarketResource, number>): boolean {
    const { world, player } = this.c;
    const stock = world.stockOf(player);
    // Don't dump at a crashed price or buy at a gouged one.
    if (side === 'sell' && (sellGain(prices[resource]) < 30 || stock[resource] < LOT)) return false;
    if (side === 'buy' && (buyCost(prices[resource]) > 250 || stock.gold < buyCost(prices[resource]))) return false;
    const before = stock[resource];
    this.c.issue({ type: 'marketTrade', resource, side });
    if (stock[resource] === before) return false;
    this.trades++;
    return true;
  }
}
