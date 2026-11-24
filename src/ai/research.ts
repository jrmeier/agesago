import { BUILDINGS } from '../core/buildings';
import { CIVS, CIV_IDS } from '../core/civilizations';
import { CHAINS, TECHS, TECH_IDS, type TechId } from '../core/techs';
import type { Age, Building, BuildingKind, MarketResource, ResourceType, Stockpile, UnitKind, UnitState, Vec2 } from '../core/types';
import { isAnimal, UNITS, type UnitClass } from '../core/units';
import { buyCost, LOT, sellGain } from '../sim/systems/market';
import { ageBuildingsNeeded, ageBuildings, ageOf, isQueued, researchBlock } from '../sim/systems/research';
import { canAfford, dist, heldBack, type Ctx, type Snapshot } from './context';
import { norm, PRODUCTION, type Economy } from './economy';
import type { ResearchProfile, TechGroup } from './profile';

const TYPES: ResourceType[] = ['food', 'wood', 'gold', 'stone'];
const WORKING: ReadonlySet<UnitState> = new Set(['toNode', 'gathering', 'toDrop']);
/** Kinds that don't count toward the two-buildings rule for aging up (mirrors research.ts). */
const NOT_AGE_BUILDINGS = new Set<BuildingKind>(['townCenter', 'house', 'farm', 'palisade', 'stoneWall', 'gate', 'fortress']);
/** Buildings the AI adds to qualify for the next age, in order of preference, by current age. */
const AGE_PICKS: Record<number, BuildingKind[]> = {
  0: ['storehouse', 'granary', 'barracks', 'miningCamp'],
  1: ['forge', 'market'],
  2: ['academy', 'siegeWorkshop'],
};
const AGE_UP: Partial<Record<Age, TechId>> = { 0: 'townAge', 1: 'cityAge', 2: 'empireAge' };
/** Seconds in the City Age (workshop, tier-2 lines, upgrades) before it saves for the Empire Age. */
const EMPIRE_SETTLE = 240;
/** Seconds the Town Center rests between villager-blocking techs while the economy still grows. */
const TC_REST = 45;
/** Longest villager-training pause (sim seconds) to afford one economy tech. */
const MAX_HOLD = 30;
/** Longest (sim seconds, per age) cheaper techs wait while it saves for the age's unit line. */
const LINE_HOLD = 150;
/** Seconds of saving for the Town or City Age that hold attack waves, at most (M16-10). */
const AGE_WAVE_HOLD = 180;
/** With the gold mines dry, stock beyond what is held back plus this much is sold for gold (M16-10). */
const DRY_CUSHION = 300;
/** Base priority of the civilization's forge tech: above every other rule (T121). */
const CIV_BASE = 80;
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
  /** Unit-line techs researched or under way, by tier (index 1–3). */
  lines: number[];
  p: ResearchProfile;
}

export interface Rule {
  tech: TechId;
  group: TechGroup;
  /** Base priority (higher first), multiplied by the profile's group weight. */
  base: number;
  /** Worth researching now (age, requirements and cost are checked separately). */
  when: (f: Facts) => boolean;
  /** Extra priority right now (added to `base` before the weight). */
  bonus?: (f: Facts) => number;
  /** Must-have now: while it can't be afforded, cheaper techs wait instead of jumping ahead. */
  urgent?: (f: Facts) => boolean;
  /**
   * A cheap one-off that makes the civilization what it is (T121): paid out of what is saved for
   * the age-up, a new Town Center or a key building (only the villager food is kept back).
   */
  fromReserve?: boolean;
}

/**
 * The age's unit-line tier is still missing and `unit` is fielded: research a line as each age
 * opens (tier 1 in the Town Age, tier 2 in the City Age; an earlier tier it skipped counts too,
 * as the way to the current one).
 */
const ageLine = (f: Facts, unit: UnitKind, tier: number) => tier <= f.age && !f.lines[f.age] && (f.units[unit] ?? 0) >= 2;

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
  // Civilization techs (T121): bought once the forge stands, ahead of everything else; the army saves for it.
  ...CIV_IDS.map((civ): Rule => ({ tech: CIVS[civ].tech, group: 'civ', base: CIV_BASE, when: () => true, fromReserve: true })),
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
  // Unit lines it has plenty of, and one per age for the units it fields (most fielded first).
  ...TECH_IDS.filter((t) => TECHS[t].line).map((tech): Rule => {
    const { unit, tier } = TECHS[tech].line!;
    return {
      tech,
      group: 'line',
      base: 40 - 8 * (tier - 1),
      when: (f) => (f.units[unit] ?? 0) >= f.p.lineUnits || ageLine(f, unit, tier),
      // The age's own tier first; an earlier tier it skipped only as the way there.
      bonus: (f) => (!ageLine(f, unit, tier) ? 0 : tier === f.age ? 8 * tier + Math.min(12, f.units[unit] ?? 0) : 4),
      urgent: (f) => tier === f.age && ageLine(f, unit, tier),
    };
  }),
  // Siege workshop (M16-8): once it fields engines.
  { tech: 'torsionSprings', group: 'line', base: 30, when: (f) => f.classes.siege >= 2 },
  { tech: 'reinforcedFrames', group: 'line', base: 26, when: (f) => f.classes.siege >= 2 },
  { tech: 'quickRigging', group: 'line', base: 20, when: (f) => (f.units.catapult ?? 0) + (f.units.boltShooter ?? 0) >= 2 },
  // Defences.
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
  /** The age-up being saved for, and since when (AGE_WAVE_HOLD). */
  private savingFor: TechId | null = null;
  private savingSince = 0;
  /** The surplus resource it is trading down, if any. */
  private selling: ResourceType | null = null;
  private lastTech = -Infinity;
  private tcFreeAt = -Infinity;
  private lastHit = -Infinity;
  /** Cost of the best tech it wanted but couldn't afford on the last pass (the market tops this up). */
  private wanted: Partial<Stockpile> = {};
  /** The economy tech villager training is paused for, and since when. */
  private hold: { tech: TechId; since: number } | null = null;
  /** When cheaper techs first waited for this age's unit line. */
  private lineHold: { age: Age; since: number } | null = null;

  constructor(
    private readonly c: Ctx,
    private readonly econ: Economy
  ) {
    // A scenario or a loaded save may start past the Village Age: count those ages as reached now.
    for (let a = 1; a <= ageOf(c.world, c.player); a++) this.agedAt[a] = c.world.time;
  }

  /** Confirm a visible enemy raid when one of our units or buildings takes damage. */
  onAttacked(pos: Vec2): boolean {
    const { world, player, intel } = this.c;
    if (world.time - this.lastHit < 5) return true;
    let scouts = 0;
    for (const u of world.units.values()) {
      if (isAnimal(u.kind) || u.kind === 'villager' || !world.areEnemies(player, u.owner) || dist(u.pos, pos) > 12 || !intel.sees(u.pos.x, u.pos.z)) continue;
      if (u.kind === 'scout' && ++scouts < 2) continue;
      this.lastHit = world.time;
      return true;
    }
    return false;
  }

  onAgedUp(age: Age): void {
    this.agedAt[age] = this.c.world.time;
  }

  pass(s: Snapshot): void {
    const p = this.c.profile.research;
    if (!p) return;
    const f = this.facts(s, p);
    // Raided, it spends the reserve on soldiers, unless its army already outnumbers the enemy's
    // (M16-10): a 150-strong army used to spend the City Age's gold on more soldiers for every
    // raid, never aged, and so never attacked (saving for an age holds waves).
    const enemy = this.c.intel.enemyArmy();
    this.c.outgunned = enemy > f.army * 1.3 + 5;
    this.c.armyFirst = (f.raided && f.army < enemy * 1.25 + 10) || this.c.outgunned;
    this.ageUp(s, f, p);
    this.c.saving = null;
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
    const classes: Record<UnitClass, number> = { villager: 0, infantry: 0, archer: 0, cavalry: 0, wildlife: 0, ship: 0, siege: 0 };
    const units: Partial<Record<UnitKind, number>> = {};
    for (const u of s.army) {
      classes[UNITS[u.kind].unitClass]++;
      units[u.kind] = (units[u.kind] ?? 0) + 1;
    }
    const built: Partial<Record<BuildingKind, number>> = {};
    for (const b of s.buildings) if (b.complete) built[b.kind] = (built[b.kind] ?? 0) + 1;
    const lines = [0, 0, 0, 0];
    const researched = world.players.get(player)?.researched;
    const line = (t: TechId) => {
      const l = TECHS[t].line;
      if (l) lines[l.tier]++;
    };
    if (researched) for (const t of researched) line(t);
    for (const b of s.buildings) for (const t of b.research ?? []) line(t);
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
      lines,
      p,
    };
  }

  // ---- Ages ----

  /** Is the AI close enough to its next age that the Town Center should stay free for it? */
  private nearAge(f: Facts, p: ResearchProfile): boolean {
    const need = AGE_UP[f.age] ? ageNeed(f.age, p) : null;
    return need !== null && f.villagers >= need - 2;
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
    const need = ageNeed(f.age, p);
    if (need === null) return;
    const earliest = f.age === 0 ? p.townAgeTime : f.age === 1 ? p.cityAgeTime : (this.agedAt[2] ?? world.time) + EMPIRE_SETTLE;
    if (f.villagers < need - 3 || world.time < earliest - 90) return;
    // The Empire Age waits for the City Age's unit line (its 6,500 food would starve it), for a while.
    if (f.age === 2 && !f.lines[2] && world.time < earliest + EMPIRE_SETTLE) return;

    // Village Age: a second military building (by profile) before the Town Age (M13-6).
    if (f.age === 0 && this.c.profile.maxProduction >= 2) {
      const military = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
      if (military < 2) {
        this.econ.production(s, true);
        return;
      }
    }
    // The two current-age buildings: add one if it lacks them (counting ones going up).
    const have = new Set(ageBuildings(world, player, f.age));
    for (const b of s.buildings) if (!b.complete && !NOT_AGE_BUILDINGS.has(b.kind) && (BUILDINGS[b.kind].age ?? 0) === f.age) have.add(b.kind);
    if (have.size < ageBuildingsNeeded(f.age)) this.addAgeBuilding(s, f.age, have);

    if (f.villagers < need || world.time < earliest || have.size < ageBuildingsNeeded(f.age)) return;
    // Save for it: villagers, army, buildings and other research leave this alone.
    this.c.reserve = { ...TECHS[tech].cost };
    // The Empire Age is a long save (6,500 food): waves go on meanwhile, and only its research holds them.
    // The Town and City Ages hold waves for AGE_WAVE_HOLD of saving at most (M16-10): an economy
    // that can't find the gold used to keep its whole army home for the rest of the game.
    if (this.savingFor !== tech) [this.savingFor, this.savingSince] = [tech, world.time];
    this.c.aging = f.age < 2 && world.time - this.savingSince < AGE_WAVE_HOLD;
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
    const home = s.tc?.pos ?? this.c.home;
    // City Age (M16-8): a siege workshop first, for walled or towered targets.
    if (f.age >= 2 && this.c.profile.late.siege > 0 && !has('siegeWorkshop')) {
      // Out toward the enemy, away from the town's lanes (a 5×5 shed by the Town Center can cut them).
      const r = this.econ.buildAt(s, 'siegeWorkshop', home, 12, 26, this.c.profile.builders, undefined, this.towardEnemy(home));
      // Can't afford it yet: save for it (the army trains whenever it can and would spend the wood).
      if (r === false) this.c.saving = { kind: 'siegeWorkshop', cost: { ...BUILDINGS.siegeWorkshop.cost } };
      if (r !== null) return;
    }
    // T123: the civilization tech needs a forge as Town Age opens. Put it before optional
    // towers/ranges and hold its wood, as for the workshop; otherwise those buildings and
    // army training spend the stock on every pass. Essential economy buildings still go up.
    if (f.age >= 1 && p.weights.civ > 0 && production > 0 && !has('forge')) {
      // ageUp() may have just laid it using the same snapshot. One forge is enough.
      if ([...this.c.world.buildings.values()].some((b) => b.owner === this.c.player && b.kind === 'forge')) return;
      const r = this.place(s, 'forge');
      if (r === false) this.c.saving = { kind: 'forge', cost: { ...BUILDINGS.forge.cost } };
      if (r !== null) return;
    }
    // After funding the forge, a food-poor town can put spare gold to work at the market.
    if (!has('market') && this.openingFoodTrade(s)) {
      this.c.saving = { kind: 'market', cost: { ...BUILDINGS.market.cost } };
      const placed = this.place(s, 'market');
      if (placed !== false) this.c.saving = null;
      if (placed !== null) return;
    }
    // Town Age: an archery range early when gold piles up (archers spend it).
    if (f.age >= 1 && !has('archeryRange') && stock.gold > 300 && production < this.c.profile.maxProduction) {
      if (this.place(s, 'archeryRange') !== null) return;
    }
    // Watch towers toward the enemy: they spend the stone that otherwise piles up, and hold
    // the base while it techs.
    const towers = s.count.watchTower ?? 0;
    if (f.age >= 1 && p.weights.defence > 0 && towers < p.towers && !s.building.watchTower && stock.stone >= 50 + 100 * towers) {
      if (this.econ.buildAt(s, 'watchTower', home, 7, 15, 1, undefined, this.towardEnemy(home)) !== null) return;
    }
    // A forge once it has an army plan in the Town Age.
    if (f.age >= 1 && p.weights.forge > 0 && production > 0 && !has('forge')) {
      if (this.place(s, 'forge') !== null) return;
    }
    // Fortresses by profile, toward the enemy, once the economy is up and stone piles up.
    const late = this.c.profile.late;
    const forts = s.count.fortress ?? 0;
    if (f.age >= 2 && forts < late.fortresses && !s.building.fortress && f.villagers >= this.c.profile.targetVillagers * 0.8 && stock.stone >= BUILDINGS.fortress.cost.stone! + 100) {
      if (this.econ.buildAt(s, 'fortress', home, 10, 22, this.c.profile.builders, undefined, this.towardEnemy(home)) !== null) return;
    }
    // Hardest only: a wonder of its own when far ahead (a big army, a full economy, the cost to spare).
    if (late.wonder && f.age >= 3 && !has('wonder') && !this.c.world.wonder && f.villagers >= this.c.profile.targetVillagers && f.army >= 20 && f.army >= this.c.intel.enemyArmy() * 2) {
      if (this.econ.buildAt(s, 'wonder', home, 10, 26, this.c.profile.builders + 3) !== null) return;
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

  /** Unit direction from `home` toward the enemy's Town Center, once seen. */
  private towardEnemy(home: Vec2): Vec2 | undefined {
    const enemy = this.c.intel.enemyStart;
    return enemy ? norm({ x: enemy.x - home.x, z: enemy.z - home.z }) : undefined;
  }

  // ---- Research ----

  /** The table's best wanted tech that can start now, by weighted priority. */
  choose(s: Snapshot, f: Facts, p: ResearchProfile): { tech: TechId; at: Building } | null {
    const { world, player, profile } = this.c;
    const stock = world.stockOf(player);
    const reserve: Partial<Stockpile> = heldBack(this.c);
    const booming = f.villagers < profile.targetVillagers && !!s.tc;
    if (booming) reserve.food = (reserve.food ?? 0) + 50 + p.villagerReserve;
    const villagerFood: Partial<Stockpile> = booming ? { food: 50 + p.villagerReserve } : {};
    const tcBusy = booming && (world.time < this.tcFreeAt || this.nearAge(f, p));
    const openingCiv = this.c.openingCivFood ? this.econ.openingCivTech(s) : null;
    // Idle research buildings by kind (one tech at a time each, so training never waits long).
    const idle = new Map<BuildingKind, Building>();
    for (const b of s.buildings) {
      if (b.complete && !b.research?.length && !b.upgrading && b.id !== this.c.upgradeHold && !idle.has(b.kind)) idle.set(b.kind, b);
    }
    let best: { tech: TechId; at: Building; score: number } | null = null;
    let want: { tech: TechId; score: number; group: TechGroup; urgent: boolean } | null = null;
    for (const r of RULES) {
      const w = p.weights[r.group];
      if (w <= 0) continue;
      const spec = TECHS[r.tech];
      if (openingCiv && spec.at === 'forge' && r.tech !== openingCiv) continue;
      const at = idle.get(spec.at);
      if (!at || (spec.at === 'townCenter' && tcBusy)) continue;
      const score = (r.base + (r.bonus?.(f) ?? 0)) * w;
      if ((best && score <= best.score) || !r.when(f)) continue;
      if (researchBlock(world, player, r.tech, true) !== null) continue;
      const civVillagerFood = r.tech === openingCiv && booming ? { food: UNITS.villager.cost.food } : villagerFood;
      // The tech villagers are paused for doesn't also keep the villager reserve.
      if (!canAfford(stock, spec.cost, r.fromReserve ? civVillagerFood : this.hold?.tech === r.tech ? this.c.reserve : reserve)) {
        if (!want || score > want.score) want = { tech: r.tech, score, group: r.group, urgent: !!r.urgent?.(f) };
        continue;
      }
      best = { tech: r.tech, at, score };
    }
    // Saving for the age's unit line: cheaper techs don't spend what it needs, for a while (an
    // economy short of that resource still gets its other techs).
    if (best && want?.urgent && want.score > best.score) {
      if (this.lineHold?.age !== f.age) this.lineHold = { age: f.age, since: world.time };
      if (world.time - this.lineHold.since < LINE_HOLD) best = null;
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

  private openingFoodTrade(s: Snapshot): { foodTarget: number; goldFloor: number } | null {
    const { world, player } = this.c;
    const tech = this.econ.openingCivTech(s);
    if (!tech || this.c.outgunned || this.c.defenceHold || this.c.sheltered.size || world.time - this.lastHit < 30) return null;
    const stock = world.stockOf(player);
    const cost = TECHS[tech].cost;
    const foodTarget = (cost.food ?? 0) + (UNITS.villager.cost.food ?? 0);
    const goldFloor = cost.gold ?? 0;
    const price = buyCost(world.players.get(player)!.prices.food);
    return stock.food < foodTarget && price <= 250 && stock.gold - price >= goldFloor
      ? { foodTarget, goldFloor } : null;
  }

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
    const opening = this.openingFoodTrade(s);
    if (opening) {
      for (let i = 0; i < TRADES_PER_PASS && stock.food < opening.foodTarget; i++) {
        if (!this.trade('food', 'buy', prices, opening.goldFloor)) break;
      }
      return;
    }
    const need: Record<ResourceType, number> = { food: 200, wood: 200, gold: 100, stone: 0 };
    // What the age-up, a new Town Center or a building being saved for still needs counts too.
    const held = heldBack(this.c);
    for (const t of TYPES) need[t] = Math.max(need[t], held[t] ?? 0, this.wanted[t] ?? 0);
    const dry = !this.c.intel.nodes.gold.some((n) => n.amount > 0 && world.nodes.has(n.id));
    for (let i = 0; i < TRADES_PER_PASS; i++) {
      const short = TYPES.filter((t) => stock[t] < need[t]).sort((a, b) => stock[a] - need[a] - (stock[b] - need[b]))[0];
      // Trading starts once a stock passes the excess mark and goes on until it is down to half
      // of it (or nothing is short), so a glut is actually put to use.
      // Never sell into a need: a resource saved for the age-up (or a wanted tech) is not surplus,
      // or the AI sells food it is saving and buys it straight back.
      const mark = (t: ResourceType): number => {
        // Gold is the market's money: half the mark beyond what is held back is spare to spend.
        if (t === 'gold') return p.marketExcess / 2 + need.gold;
        // The mines are dry (none known with gold left) and gold is short: the market is the only
        // gold left, so anything beyond what is held back and a cushion is surplus (M16-10).
        if (short === 'gold' && dry) return need[t] + DRY_CUSHION;
        return this.selling === t ? p.marketExcess / 2 : p.marketExcess;
      };
      const rich = TYPES.filter((t) => t !== short && stock[t] > mark(t) && stock[t] - need[t] >= LOT).sort((a, b) => stock[b] - stock[a])[0];
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

  private trade(resource: MarketResource, side: 'buy' | 'sell', prices: Record<MarketResource, number>, goldFloor = heldBack(this.c).gold ?? 0): boolean {
    const { world, player } = this.c;
    const stock = world.stockOf(player);
    // Don't dump at a crashed price or buy at a gouged one.
    if (side === 'sell' && (sellGain(prices[resource]) < 30 || stock[resource] < LOT)) return false;
    // Never buy with the gold the age-up is saving (M16-10): before, the AI sold wood for gold and
    // spent that gold, and the age's own, on the age's food, and the age never came.
    if (side === 'buy' && (buyCost(prices[resource]) > 250 || stock.gold - buyCost(prices[resource]) < goldFloor)) return false;
    const before = stock[resource];
    this.c.issue({ type: 'marketTrade', resource, side });
    if (stock[resource] === before) return false;
    this.trades++;
    return true;
  }
}

/** Villagers before saving for the next age (null: it stays in this one). */
function ageNeed(age: Age, p: ResearchProfile): number | null {
  return age === 0 ? p.townAgeAt : age === 1 ? p.cityAgeAt : age === 2 ? p.empireAgeAt : null;
}
