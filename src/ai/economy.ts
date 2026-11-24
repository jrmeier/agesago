import { BUILDINGS, MAX_POP, TERRITORY } from '../core/buildings';
import { MAP_SIZES } from '../core/maps';
import { CIVS } from '../core/civilizations';
import { TECHS, type TechId } from '../core/techs';
import { UNITS } from '../core/units';
import type { Building, BuildingKind, EntityId, ResourceNode, ResourceType, Unit, UnitState, Vec2 } from '../core/types';
import { heldBack, canAfford, dist, dropsFor, nearestSiteDist, type Ctx, type Snapshot } from './context';
import { findSpot, type SpotQuery } from './placement';
import { ageLocked } from '../sim/systems/build';

const TYPES: ResourceType[] = ['food', 'wood', 'gold', 'stone'];
const WORKING: ReadonlySet<UnitState> = new Set(['toNode', 'gathering', 'toDrop']);
/** Building or repairing: the economy leaves them to it. */
const BUILDING: ReadonlySet<UnitState> = new Set(['toBuild', 'building', 'toRepair', 'repairing']);
/** Gatherers per node before the AI looks elsewhere. */
const MAX_LOAD: Record<ResourceType, number> = { wood: 2, food: 3, gold: 4, stone: 4 };
/** Drop site that serves each resource. */
const DROP_KIND: Record<ResourceType, BuildingKind> = { wood: 'storehouse', food: 'granary', gold: 'miningCamp', stone: 'miningCamp' };
/** Gatherers working far from a drop site before one is built next to them. */
const DROP_AFTER: Record<ResourceType, number> = { wood: 3, food: 3, gold: 2, stone: 2 };
/** A node this far (beyond the site's radius) from the nearest drop site counts as far. */
const FAR_FROM_DROP = 8;
/** Berry bushes further than this from a food drop site aren't worth walking to. */
const BERRY_RANGE = 30;
/** Berries this close to the Town Center are the home berries. */
const HOME_BERRIES = 40;
/** Home berry food left below which the AI waits for the bushes instead of laying a field. */
const BERRIES_NEARLY_GONE = 200;
/** A gold mine still holding this much seeds an expansion site on its own (M16-10). */
const GOLD_SITE = 300;
/** Wood an expansion site's score counts at most: a forest is worth a lumber camp, not a town. */
const WOOD_SITE_CAP = 2000;
/** Buildings that go up even while saving for a new Town Center. */
const ESSENTIAL: ReadonlySet<BuildingKind> = new Set(['house', 'farm', 'storehouse', 'granary', 'miningCamp', 'townCenter']);
/** Seconds a spot whose build order was rejected stays off the search. */
const REJECTED_FOR = 120;
/** One short opening-game pause to fund the civilization tech once its forge stands. */
const CIV_FOOD_HOLD = 60;
const CIV_FOOD_CALM = 30;
export const PRODUCTION: BuildingKind[] = ['barracks', 'archeryRange', 'stable'];

type Source = { id: EntityId; pos: Vec2 };

/**
 * Villager production, job allocation by a target ratio that shifts over the game, houses,
 * drop sites, farms, production buildings, and scouting.
 */
export class Economy {
  /** Food-hungry villagers that found nothing to gather on the last pass (→ build farms). */
  foodShort = 0;
  /** Food workers wanted minus food workers working, as of the last pass. */
  foodGap = 0;
  /** Sim time the last production building was started. */
  lastProduction = -Infinity;
  private readonly regions = new Map<EntityId, number>();
  /** Node → sim time until which it is skipped (an order to it failed). */
  private readonly skip = new Map<EntityId, number>();
  private readonly scoutTargets = new Map<EntityId, Vec2>();
  /** Spots a build order was rejected at, kept clear until `until` (sim time). */
  private rejected: { pos: Vec2; until: number }[] = [];
  /** Where the next Town Center goes, and when to look again. */
  private site: Vec2 | null = null;
  private nextSite = 0;
  /** Clusters where no Town Center would fit, skipped until `until`. */
  private failedSites: { pos: Vec2; until: number }[] = [];
  private readonly briefed = new Set<EntityId>();
  /** Per pass: gatherers per node / farm, and node shortlists by type. */
  private load = new Map<EntityId, number>();
  private shortlists = new Map<ResourceType, { n: ResourceNode; d: number }[]>();

  private civFoodHoldRemaining: number;
  private civFoodHoldStarted: number | null = null;
  private lastAttacked = -Infinity;

  constructor(private readonly c: Ctx) {
    // Reattaching an AI (including loading a save) must not grant another opening pause.
    this.civFoodHoldRemaining = c.world.time > 0 ? 0 : CIV_FOOD_HOLD;
  }

  /** Attacks cancel the one-off food hold immediately; defence keeps its existing priority. */
  onAttacked(): void {
    this.lastAttacked = this.c.world.time;
    this.pauseCivFoodHold(this.lastAttacked);
    this.c.openingCivFood = 0;
  }

  private pauseCivFoodHold(now: number): void {
    if (this.civFoodHoldStarted === null) return;
    this.civFoodHoldRemaining = Math.max(0, this.civFoodHoldRemaining - (now - this.civFoodHoldStarted));
    this.civFoodHoldStarted = null;
  }

  /** Resources needed for the opening civilization technology while the town is stable. */
  openingCivTech(s: Snapshot): TechId | null {
    const { world, player, profile } = this.c;
    const p = profile.research;
    const state = world.players.get(player)!;
    const civ = state.player.civ;
    if (!p || p.weights.civ <= 0 || !civ || state.age !== 1 || !s.count.forge) return null;
    // The existing Town Age villager threshold protects the minimum opening economy.
    if (s.villagers.length < p.townAgeAt) return null;
    const tech = CIVS[civ].tech;
    return state.researched.has(tech) || s.buildings.some((b) => b.research?.includes(tech)) ? null : tech;
  }

  private civFoodReserve(s: Snapshot, tech: TechId | null): number {
    const { world, player, profile } = this.c;
    // The general army-first policy stays active for two minutes after a raid.
    // The opening research window can use a quiet stretch without borrowing from an active defence.
    const armyNeedsFood = profile.research?.deferOpeningCivFoodForArmy
      && (this.c.armyFirst || s.army.length < profile.firstWave);
    if (!tech || this.c.defenceHold > 0 || this.c.sheltered.size > 0
      || this.c.outgunned || armyNeedsFood || world.time - this.lastAttacked < CIV_FOOD_CALM) {
      this.pauseCivFoodHold(world.time);
      return 0;
    }
    // Begin saving during construction. Starting only after completion leaves the
    // full price to raise at the point the next enemy wave can interrupt.
    const stock = world.stockOf(player);
    const cost = TECHS[tech].cost;
    const waitingForForge = !s.buildings.some((b) => b.kind === 'forge' && !b.research?.length && !b.upgrading);
    const missingOtherMaterials = Object.entries(cost).some(([r, n]) => r !== 'food' && stock[r as ResourceType] < n);
    if (waitingForForge || missingOtherMaterials) {
      this.pauseCivFoodHold(world.time);
      return 0;
    }
    this.civFoodHoldStarted ??= world.time;
    if (world.time - this.civFoodHoldStarted >= this.civFoodHoldRemaining) {
      this.pauseCivFoodHold(world.time);
      return 0;
    }
    return (cost.food ?? 0) + (UNITS.villager.cost.food ?? 0);
  }

  /** Target share of workers per resource right now. */
  ratios(s: Snapshot, civTech: TechId | null): Record<ResourceType, number> {
    const production = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
    let r: Record<ResourceType, number>;
    if (!production && s.villagers.length < this.c.profile.barracksAt) r = { food: 0.6, wood: 0.4, gold: 0, stone: 0 };
    else if (s.villagers.length < 25) r = { food: 0.45, wood: 0.32, gold: 0.18, stone: 0.05 };
    else r = { food: 0.4, wood: 0.27, gold: 0.25, stone: 0.08 };
    const stock = this.c.world.stockOf(this.c.player);
    // Everything being saved for (the age-up, a new Town Center, a building) steers the split.
    const reserve = heldBack(this.c);
    const preparingForge = !s.count.forge && this.c.profile.research?.weights.civ
      && (this.c.saving?.kind === 'forge' || s.tc?.research?.includes('townAge'));
    const forgeWood = preparingForge ? BUILDINGS.forge.cost.wood ?? 0 : 0;
    let sum = 0;
    for (const t of TYPES) {
      // Saving up (an age-up): lean toward what is still missing.
      const missing = (reserve[t] ?? 0) - stock[t];
      if (missing > 0) r[t] = Math.max(r[t], 0.1) * (1 + Math.min(0.6, missing / 1000));
      // Forge technologies need less stock than an age-up and compete with continuous
      // food spending. Staff their missing resources once the forge foundation is funded.
      const civCost = civTech ? TECHS[civTech].cost[t] ?? 0 : 0;
      const civTarget = civCost && t === 'food' ? civCost + 50 + (this.c.profile.research?.villagerReserve ?? 0) : civCost;
      const civMissing = Math.max(civTarget, t === 'wood' ? forgeWood : 0) - stock[t];
      if (civMissing > 0) r[t] = Math.max(r[t], 0.1) * (1 + Math.min(0.8, civMissing / 250));
      // Stockpiling more than it spends: move workers elsewhere.
      const plenty = (t === 'food' || t === 'wood' ? 400 : 300) + (reserve[t] ?? 0);
      if (stock[t] > plenty) r[t] *= plenty / stock[t];
      if (t !== 'food' && !this.c.intel.nodes[t].length) r[t] = 0;
      sum += r[t];
    }
    for (const t of TYPES) r[t] = sum > 0 ? r[t] / sum : 0;
    return r;
  }

  // ---- Villagers: training and jobs ----

  econPass(s: Snapshot): void {
    const { world, player, profile } = this.c;
    const stock = world.stockOf(player);
    const civTech = this.openingCivTech(s);
    this.c.openingCivFood = this.civFoodReserve(s, civTech);
    const foodHold = Math.max(this.c.villagerHold, this.c.openingCivFood);
    // Every finished Town Center trains villagers (a second one doubles the boom, M18-5), except
    // while it upgrades or is held free for an upgrade (M14-6).
    let queued = 0;
    for (const tc of s.tcs) queued += tc.complete ? tc.queue : 0;
    for (const tc of s.tcs) {
      if (!tc.complete || tc.upgrading || this.c.upgradeHold === tc.id) continue;
      while (
        tc.queue < profile.tcQueue &&
        s.villagers.length + queued < profile.targetVillagers &&
        s.popUsed < s.popCap &&
        stock.food - foodHold - this.c.defenceHold - (this.c.pauseVillagers ? this.c.reserve.food ?? 0 : 0) >= 50
      ) {
        const before = tc.queue;
        this.c.issue({ type: 'train', buildingId: tc.id, unit: 'villager' });
        if (tc.queue === before) break;
        s.popUsed++;
        queued++;
      }
    }

    this.load = new Map();
    this.shortlists = new Map();
    const counts: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
    const byType: Record<ResourceType, Unit[]> = { food: [], wood: [], gold: [], stone: [] };
    const idle: Unit[] = [];
    for (const v of s.villagers) {
      if (this.c.sheltered.has(v.id) || BUILDING.has(v.state)) continue;
      if (WORKING.has(v.state) && v.gatherType) {
        counts[v.gatherType]++;
        byType[v.gatherType].push(v);
        if (v.gatherNode !== null) this.load.set(v.gatherNode, (this.load.get(v.gatherNode) ?? 0) + 1);
      } else if (v.state === 'idle') idle.push(v);
    }
    const workers = idle.length + TYPES.reduce((n, t) => n + counts[t], 0);
    const ratio = this.ratios(s, civTech);
    const want = (t: ResourceType) => ratio[t] * workers - counts[t];
    this.foodShort = 0;

    for (const v of idle) {
      const order = [...TYPES].sort((a, b) => want(b) - want(a));
      // No food to gather: wood (for fields) beats piling up more gold or stone.
      if (want('food') > 0.5 && order.indexOf('wood') > order.indexOf('food')) {
        order.splice(order.indexOf('wood'), 1);
        order.splice(order.indexOf('food') + 1, 0, 'wood');
      }
      for (const t of order) {
        if (this.assign(v, t, s)) {
          counts[t]++;
          break;
        }
        if (t === 'food' && want('food') > 0.5) this.foodShort++;
      }
    }

    // Shift a couple of workers per pass from the most over-staffed resource to the most short-staffed.
    this.foodGap = want('food');
    // A short resource with nothing to gather (no free food before the fields go in) doesn't
    // block the next one: food-short workers otherwise pile onto wood while gold goes unmined.
    const blocked = new Set<ResourceType>();
    for (let moves = 0; moves < 2; moves++) {
      const over = TYPES.reduce((a, b) => (want(a) < want(b) ? a : b));
      const unders = TYPES.filter((t) => !blocked.has(t) && t !== over && want(t) >= 1.5).sort((a, b) => want(b) - want(a));
      if (want(over) > -1.5 || !unders.length) break;
      const pool = byType[over].filter((v) => !(v.gatherNode !== null && world.buildings.has(v.gatherNode)));
      const v = (pool.length ? pool : byType[over]).find((u) => !u.carry || u.carry.amount < 5) ?? (pool[0] ?? byType[over][0]);
      if (!v) break;
      const under = unders.find((t) => {
        if (this.assign(v, t, s)) return true;
        blocked.add(t);
        if (t === 'food') this.foodShort++;
        return false;
      });
      if (!under) break;
      byType[over].splice(byType[over].indexOf(v), 1);
      counts[over]--;
      counts[under]++;
    }

    // Food work still wanted beyond the free farms and berry bushes: fields are needed.
    this.foodGap = want('food');
    let free = 0;
    for (const b of s.buildings) if (b.kind === 'farm' && b.complete && !this.load.get(b.id)) free++;
    for (const { n } of this.shortlist('food', s)) free += Math.max(0, MAX_LOAD.food - (this.load.get(n.id) ?? 0));
    this.foodShort = Math.max(this.foodShort, Math.ceil(this.foodGap - free));
  }

  /** Send `v` to gather `type`; false if there is nothing suitable. */
  private assign(v: Unit, type: ResourceType, s: Snapshot): boolean {
    const src = this.pickSource(v, type, s);
    if (!src) return false;
    this.c.issue({ type: 'gather', unitIds: [v.id], nodeId: src.id });
    if (v.gatherNode !== src.id) {
      // The sim couldn't take the order (unreachable, farm taken): leave it alone for a while.
      this.skip.set(src.id, this.c.world.time + 60);
      return false;
    }
    this.load.set(src.id, (this.load.get(src.id) ?? 0) + 1);
    return true;
  }

  private pickSource(v: Unit, type: ResourceType, s: Snapshot): Source | null {
    if (type === 'food') {
      let best: Building | null = null;
      let bestD = Infinity;
      for (const b of s.buildings) {
        if (b.kind !== 'farm' || !b.complete || (this.load.get(b.id) ?? 0) > 0 || this.skipped(b.id)) continue;
        const d = dist(v.pos, b.pos);
        if (d < bestD) [best, bestD] = [b, d];
      }
      if (best) return best;
      return this.nearestNode(v, 'food', s);
    }
    return this.nearestNode(v, type, s);
  }

  private skipped(id: EntityId): boolean {
    const until = this.skip.get(id);
    if (until === undefined) return false;
    if (until > this.c.world.time) return true;
    this.skip.delete(id);
    return false;
  }

  /** Best node of `type` for `v`: close to a drop site, close to `v`, not crowded. */
  private nearestNode(v: Unit, type: ResourceType, s: Snapshot): Source | null {
    let best: ResourceNode | null = null;
    let bestScore = Infinity;
    for (const { n, d } of this.shortlist(type, s)) {
      const load = this.load.get(n.id) ?? 0;
      if (load >= MAX_LOAD[type] || n.amount <= 0 || this.skipped(n.id)) continue;
      const score = d + 0.35 * dist(v.pos, n.pos) + load * 3;
      if (score < bestScore) [best, bestScore] = [n, score];
    }
    return best;
  }

  /** Up to 40 reachable known nodes of `type` nearest a drop site (computed once per pass). */
  private shortlist(type: ResourceType, s: Snapshot): { n: ResourceNode; d: number }[] {
    const hit = this.shortlists.get(type);
    if (hit) return hit;
    const { world, intel } = this.c;
    let drops = dropsFor(s, type);
    const home = { pos: this.c.home, radius: 0 } as Building;
    if (!drops.length) drops = [home];
    const keep: { n: ResourceNode; d: number }[] = [];
    const K = 40;
    for (const n of intel.nodes[type]) {
      if (n.amount <= 0 || !world.nodes.has(n.id)) continue;
      const d = Math.max(0, nearestSiteDist(n.pos, drops));
      if (type === 'food' && d > BERRY_RANGE) continue;
      if (keep.length === K && d >= keep[K - 1].d) continue;
      if (!this.reachable(n)) continue;
      let i = keep.length;
      if (i === K) keep.pop();
      i = keep.length;
      while (i > 0 && keep[i - 1].d > d) i--;
      keep.splice(i, 0, { n, d });
    }
    this.shortlists.set(type, keep);
    return keep;
  }

  private reachable(n: ResourceNode): boolean {
    let r = this.regions.get(n.id);
    if (r === undefined) {
      r = this.c.world.nav.regionAt(n.pos);
      this.regions.set(n.id, r);
    }
    return r === this.c.region;
  }

  // ---- Construction ----

  buildPass(s: Snapshot): void {
    this.maintainFoundations(s);
    if (!this.wantsTown(s)) this.c.townReserve = {};
    // Farms jump the queue when food is badly short (berries gone, no fields yet).
    const urgent = this.foodShort > 0 && this.foodGap >= 3;
    const needs: (() => boolean | null)[] = urgent
      ? [() => this.house(s), () => this.farm(s), () => this.dropSite(s), () => this.expand(s), () => this.production(s)]
      : [() => this.house(s), () => this.dropSite(s), () => this.farm(s), () => this.expand(s), () => this.production(s)];
    // true: built; false: wanted but not affordable yet (save up for it); null: not needed / no spot.
    for (const need of needs) if (need() !== null) return;
  }

  private house(s: Snapshot): boolean | null {
    if (s.popCap >= MAX_POP) return null;
    const production = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
    // Houses going up, and houses becoming Large Houses, add 5 each.
    let building = s.building.house ?? 0;
    for (const b of s.buildings) if (b.kind === 'house' && b.upgrading) building++;
    const margin = 2 + (s.villagers.length > 8 ? 2 : 0) + production * 2;
    if (s.popCap + building * 5 - s.popUsed > margin || building >= (s.popCap >= 40 ? 2 : 1)) return null;
    return this.place(s, {
      kind: 'house',
      center: this.c.home,
      minR: 7,
      maxR: 24,
      clearOfNodes: 3,
      gap: 1.2,
    }, 1);
  }

  private dropSite(s: Snapshot): boolean | null {
    const { world } = this.c;
    for (const type of ['wood', 'gold', 'stone', 'food'] as ResourceType[]) {
      const kind = DROP_KIND[type];
      if (s.building[kind]) continue;
      const drops = dropsFor(s, type);
      const far: ResourceNode[] = [];
      for (const v of s.villagers) {
        if (v.gatherType !== type || v.gatherNode === null || !WORKING.has(v.state)) continue;
        const n = world.nodes.get(v.gatherNode);
        if (n && nearestSiteDist(n.pos, drops) > FAR_FROM_DROP) far.push(n);
      }
      if (far.length < DROP_AFTER[type]) continue;
      // Centre on the far gatherers' work.
      const c = { x: 0, z: 0 };
      for (const n of far) {
        c.x += n.pos.x / far.length;
        c.z += n.pos.z / far.length;
      }
      const anchor = far.reduce((a, b) => (dist(a.pos, c) < dist(b.pos, c) ? a : b));
      if (this.skipped(-anchor.id)) continue;
      // Work off our land: the camp goes at the edge of our territory on the way there.
      // Too far out to help (the next Town Center will cover it): skip it for a while.
      const edge = this.ownGround(anchor.pos);
      const center = edge && dist(edge, anchor.pos) <= FAR_FROM_DROP ? edge : null;
      const r = center && this.place(s, { kind, center, minR: center === anchor.pos ? 2.5 : 0, maxR: 12, clearOfNodes: 1, gap: 1, maxChecks: 25 }, Math.min(2, this.c.profile.builders), anchor.pos);
      if (r !== null) return r;
      // Nowhere to put it (dense forest, rocks): don't search here again for a while.
      this.skip.set(-anchor.id, world.time + 90);
    }
    return null;
  }

  private farm(s: Snapshot): boolean | null {
    if (this.foodShort <= 0) return null;
    // The last berries near the base are nearly picked: their gatherers move to the first fields
    // in a moment, so don't lay one for a short gap.
    let berries = 0;
    for (const n of this.c.intel.nodes.food) {
      if (n.kind === 'berry' && n.amount > 0 && dist(n.pos, this.c.home) < HOME_BERRIES && this.c.world.nodes.has(n.id)) berries += n.amount;
    }
    if (berries > 0 && berries <= BERRIES_NEARLY_GONE) return null;
    const wood = this.c.world.stockOf(this.c.player).wood;
    if ((s.building.farm ?? 0) >= Math.min(6, Math.max(1, Math.ceil(this.foodGap)), 2 + Math.floor(wood / 150))) return null;
    const center = s.tc?.pos ?? this.c.home;
    // The ring around the Town Center fills up: reach further out as the fields multiply.
    const maxR = Math.min(28, 16 + 1.5 * (s.count.farm ?? 0));
    return this.place(s, { kind: 'farm', center, minR: 4, maxR, clearOfNodes: 1, gap: 0.8 }, 1);
  }

  // ---- Expansion (M18-5) ----

  /**
   * Found another Town Center toward the richest known resource cluster: on medium or larger
   * maps, in the Town Age, once it has `expandAt` villagers and fewer than `towns` Town Centers.
   */
  private expand(s: Snapshot): boolean | null {
    this.c.townReserve = {};
    if (!this.wantsTown(s)) return null;
    const { world } = this.c;
    if (world.time >= this.nextSite) {
      this.nextSite = world.time + 30;
      this.site = this.expansionSite(s);
    }
    if (!this.site) return null;
    const toward = norm({ x: this.c.home.x - this.site.x, z: this.c.home.z - this.site.z });
    // Clusters sit in forests and rocks, where most spots fail the full check: look harder than
    // for a house (this runs rarely, once the Town Center is affordable).
    const q: SpotQuery = { kind: 'townCenter', center: this.site, minR: 3, maxR: 16, clearOfNodes: 1, gap: 2, maxChecks: 200, toward, bias: 6 };
    const r = this.place(s, q, this.c.profile.builders + 1, this.site);
    // Save for it (army, research and other buildings leave the cost alone).
    if (r === false) this.c.townReserve = { ...BUILDINGS.townCenter.cost };
    // No room there after all (or no builder free): try another cluster on the next pass.
    if (r === null) {
      this.failedSites.push({ pos: this.site, until: world.time + 300 });
      [this.site, this.nextSite] = [null, 0];
    }
    return r;
  }

  /** Time for another Town Center (profile, map size, age, villagers, none going up). */
  wantsTown(s: Snapshot): boolean {
    const { world, player, profile } = this.c;
    if (profile.expandAt === null || s.tcs.length >= profile.towns || s.villagers.length < profile.expandAt) return false;
    return world.hf.width >= MAP_SIZES.medium && !ageLocked(world, 'townCenter', player);
  }

  /**
   * The best known resource cluster for a new Town Center: reachable, on neutral or own land,
   * clear of every known Town Center by the spacing rule, nearer home than the enemy. Scored by
   * resources within reach (gold and stone count most) less the walk from home.
   */
  expansionSite(s: Snapshot): Vec2 | null {
    const { world, intel } = this.c;
    this.failedSites = this.failedSites.filter((f) => f.until > world.time);
    const all: ResourceNode[] = [];
    for (const t of TYPES) for (const n of intel.nodes[t]) if (n.amount > 0 && world.nodes.has(n.id)) all.push(n);
    // Untouched gold first (M16-10): a mine still holding GOLD_SITE seeds a site, so a forest next
    // door never outbids fresh gold. Only when no such site qualifies do other mines and every 8th
    // tree seed one.
    for (const goldOnly of [true, false]) {
      const site = this.bestSite(s, all, goldOnly ? (n) => n.type === 'gold' && n.amount >= GOLD_SITE : (n) => n.type !== 'food' && (n.type !== 'wood' || n.id % 8 === 0));
      if (site) return site;
    }
    return null;
  }

  private bestSite(s: Snapshot, all: ResourceNode[], seeds: (n: ResourceNode) => boolean): Vec2 | null {
    const { world, player, intel } = this.c;
    const home = this.c.home;
    const tcs: Vec2[] = s.tcs.map((b) => b.pos);
    for (const b of intel.buildings.values()) if (b.kind === 'townCenter') tcs.push(b.pos);
    const enemy = intel.enemyStart;
    const spacing = TERRITORY.townCenterSpacing + 4;
    const WEIGHT: Record<ResourceType, number> = { gold: 1.5, stone: 1.2, wood: 0.4, food: 0.8 };
    let best: Vec2 | null = null;
    let bestScore = 0;
    for (const seed of all) {
      if (!seeds(seed)) continue;
      const p = seed.pos;
      const dHome = dist(p, home);
      if (dHome < spacing || dHome > 90) continue;
      if (enemy && dist(p, enemy) < dHome * 1.2) continue;
      if (tcs.some((t) => dist(t, p) < spacing) || this.failedSites.some((f) => dist(f.pos, p) < 12)) continue;
      const owner = world.territoryOwner(p);
      if (owner !== 0 && owner !== player) continue;
      if (world.nav.regionOfCell(p) !== this.c.region) continue;
      let value = 0, wood = 0;
      for (const n of all) {
        if (Math.abs(n.pos.x - p.x) >= 14 || Math.abs(n.pos.z - p.z) >= 14) continue;
        if (n.type === 'wood') wood += n.amount;
        else value += Math.min(n.amount, 800) * WEIGHT[n.type];
      }
      value += Math.min(wood, WOOD_SITE_CAP) * WEIGHT.wood;
      const score = value - dHome * 40;
      if (score > bestScore) [best, bestScore] = [p, score];
    }
    return best && { ...best };
  }

  /** Military buildings in build order: the barracks, the profile's second choice, then the other. */
  productionOrder(): BuildingKind[] {
    const second = this.c.profile.secondProduction;
    return ['barracks', second, second === 'stable' ? 'archeryRange' : 'stable'];
  }

  /**
   * Lay the next military building. The second follows the barracks quickly so it stands before
   * the Town Age (M13-6); later ones wait for more villagers and `productionSpacing`. `force`
   * skips those waits (the research planner uses it to get the second one up before aging).
   */
  production(s: Snapshot, force = false): boolean | null {
    const { world, profile } = this.c;
    const have = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
    if (have >= profile.maxProduction) return null;
    if (!force) {
      if (s.villagers.length < profile.barracksAt + (have === 1 ? 2 : Math.min(have, 3) * 3)) return null;
      const spacing = have === 0 ? 0 : have === 1 ? 30 : have < 3 ? profile.productionSpacing * 0.5 : profile.productionSpacing;
      if (world.time - this.lastProduction < spacing) return null;
    }
    // The kind it has fewest of, in build order, among those our age allows.
    let kind: BuildingKind | null = null;
    for (const k of this.productionOrder()) {
      if (ageLocked(world, k, this.c.player)) continue;
      if (kind === null || (s.count[k] ?? 0) < (s.count[kind] ?? 0)) kind = k;
    }
    if (!kind) return null;
    const enemy = this.c.intel.enemyStart;
    const toward = enemy ? norm({ x: enemy.x - this.c.home.x, z: enemy.z - this.c.home.z }) : undefined;
    const r = this.place(s, { kind, center: this.c.home, minR: 9, maxR: 28, clearOfNodes: 3, gap: 1.5, toward, bias: 8 }, profile.builders);
    if (r) this.lastProduction = world.time;
    return r;
  }

  /**
   * Build one `kind` around `center` (between minR and maxR from it) with `n` builders. Used by
   * the research planner for age buildings, the forge, market and academy.
   * true: laid; false: can't afford yet; null: no spot or no builder.
   */
  buildAt(s: Snapshot, kind: BuildingKind, center: Vec2, minR: number, maxR: number, n: number, near?: Vec2, toward?: Vec2): boolean | null {
    const big = BUILDINGS[kind].size.w > 3;
    const q: SpotQuery = { kind, center, minR, maxR, clearOfNodes: big ? 3 : 1, gap: big ? 1.5 : 1, maxChecks: 40, toward, bias: toward ? 10 : undefined };
    return this.place(s, q, n, near);
  }

  /** Lay a foundation found by `q` and send `n` builders. */
  private place(s: Snapshot, q: SpotQuery, n: number, near?: Vec2): boolean | null {
    const { world, player, intel } = this.c;
    if (ageLocked(world, q.kind, player)) return null;
    // Fund the first civilization-tech forge before a second Town Center. Hard reaches
    // its expansion threshold as Town Age opens; holding both costs delays the forge.
    const firstForge = q.kind === 'forge' && (this.c.profile.research?.weights.civ ?? 0) > 0 && !s.count.forge;
    const openingMarket = q.kind === 'market' && this.c.saving?.kind === 'market';
    const reserve = ESSENTIAL.has(q.kind) || firstForge || openingMarket ? this.c.reserve : heldBack(this.c, q.kind);
    if (!canAfford(world.stockOf(player), BUILDINGS[q.kind].cost, reserve)) return false;
    const builders = this.builders(s, near ?? q.center, n, q.kind === 'farm');
    if (!builders.length) return null;
    // A rejected spot (territory changed hands, the site got blocked) is remembered and the
    // search moves on to the next one, so one bad spot never stalls construction (M18-5).
    for (let attempt = 0; attempt < 3; attempt++) {
      const pos = findSpot(world, intel, player, { ...q, region: this.c.region, avoid: this.badSpots() });
      if (!pos) return null;
      const before = world.buildings.size;
      this.c.issue({ type: 'build', unitIds: builders.map((u) => u.id), kind: q.kind, pos, rot: 0 });
      if (world.buildings.size > before) return true;
      const why = this.c.lastReject;
      if (why !== 'territory' && why !== 'blocked-site') return null;
      this.rejected.push({ pos, until: world.time + REJECTED_FOR });
    }
    return null;
  }

  /** Spots rejected recently (expired ones dropped). */
  private badSpots(): Vec2[] {
    const now = this.c.world.time;
    this.rejected = this.rejected.filter((r) => r.until > now);
    return this.rejected.map((r) => r.pos);
  }

  /**
   * `p` if it is on our territory, else the nearest point on the way home that is (drop sites
   * and most buildings need own land, M18-3). Null when nothing on the way is ours.
   */
  ownGround(p: Vec2): Vec2 | null {
    const { world, player } = this.c;
    const home = this.c.home;
    if (world.territoryOwner(p) === player) return p;
    const d = dist(p, home);
    for (let t = 2; t <= d; t += 2) {
      const q = { x: p.x + ((home.x - p.x) * t) / (d || 1), z: p.z + ((home.z - p.z) * t) / (d || 1) };
      if (world.territoryOwner(q) === player) return q;
    }
    return null;
  }

  /** The `n` villagers best placed to build near `p` (idle ones, then non-farmers, nearest first). */
  private builders(s: Snapshot, p: Vec2, n: number, food: boolean): Unit[] {
    const cands = s.villagers.filter((v) => !this.c.sheltered.has(v.id) && !BUILDING.has(v.state) && v.state !== 'moving' && v.state !== 'garrisoned');
    const { world } = this.c;
    const cost = (v: Unit) => {
      let c = dist(v.pos, p);
      if (v.state === 'idle') c -= 20;
      if (v.gatherNode !== null && world.buildings.has(v.gatherNode)) c += 30; // farmer
      if (food && v.gatherType === 'food') c -= 10;
      if (v.gatherType === 'gold' || v.gatherType === 'stone') c += 10;
      return c;
    };
    return cands.sort((a, b) => cost(a) - cost(b)).slice(0, n);
  }

  /** Foundations nobody is working on get a builder (one per pass). */
  private maintainFoundations(s: Snapshot): void {
    const { world } = this.c;
    const worked = new Set<EntityId>();
    for (const [uid, bid] of world.buildState) {
      const u = world.units.get(uid);
      if (u && u.owner === this.c.player && BUILDING.has(u.state)) worked.add(bid);
    }
    for (const b of s.buildings) {
      if (b.complete || worked.has(b.id)) continue;
      const [v] = this.builders(s, b.pos, 1, b.kind === 'farm');
      if (v) this.c.issue({ type: 'construct', unitIds: [v.id], buildingId: b.id });
      return;
    }
  }

  // ---- Scouting ----

  scoutPass(s: Snapshot): void {
    const { world, player } = this.c;
    const vis = world.visibilityOf(player);
    for (const u of s.scouts) {
      if (!this.briefed.has(u.id)) {
        // Scouts look, they don't pick fights.
        this.briefed.add(u.id);
        this.c.issue({ type: 'stance', unitIds: [u.id], stance: 'passive' });
      }
      const t = this.scoutTargets.get(u.id);
      if (t && u.state === 'moving' && dist(u.pos, t) > 3 && !vis.isExplored(t.x, t.z)) continue;
      const next = this.frontier(u) ?? this.patrolPoint(u);
      if (!next) continue;
      this.scoutTargets.set(u.id, next);
      this.c.issue({ type: 'move', unitIds: [u.id], target: next });
    }
    for (const id of this.scoutTargets.keys()) if (!world.units.has(id)) this.scoutTargets.delete(id);
  }

  /** Nearest unexplored, reachable ground, preferring the area around the base. */
  frontier(u: Unit): Vec2 | null {
    const { world, player } = this.c;
    const vis = world.visibilityOf(player);
    const region = world.nav.regionAt(u.pos);
    const step = 8;
    let best: Vec2 | null = null;
    let bestScore = Infinity;
    for (let z = step / 2; z < world.hf.depth; z += step) {
      for (let x = step / 2; x < world.hf.width; x += step) {
        if (vis.isExplored(x, z)) continue;
        const p = { x, z };
        if (world.nav.regionOfCell(p) !== region) continue;
        let taken = false;
        for (const [id, t] of this.scoutTargets) if (id !== u.id && dist(t, p) < 20) taken = true;
        if (taken) continue;
        const score = dist(u.pos, p) + 0.6 * dist(this.c.home, p);
        if (score < bestScore) [best, bestScore] = [p, score];
      }
    }
    return best;
  }

  /** Map explored: look in on a known enemy building or a random spot. */
  private patrolPoint(u: Unit): Vec2 | null {
    const { world, rng, intel } = this.c;
    const region = world.nav.regionAt(u.pos);
    const known = [...intel.buildings.values()];
    for (let tries = 0; tries < 12; tries++) {
      const k = known.length && rng() < 0.5 ? known[Math.floor(rng() * known.length)].pos : null;
      const p = k
        ? { x: k.x + (rng() - 0.5) * 20, z: k.z + (rng() - 0.5) * 20 }
        : { x: 4 + rng() * (world.hf.width - 8), z: 4 + rng() * (world.hf.depth - 8) };
      if (world.nav.regionOfCell(p) === region) return p;
    }
    return null;
  }
}

export function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}
