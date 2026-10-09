import { BUILDINGS, MAX_POP } from '../core/buildings';
import type { Building, BuildingKind, EntityId, ResourceNode, ResourceType, Unit, UnitState, Vec2 } from '../core/types';
import { canAfford, dist, dropsFor, nearestSiteDist, type Ctx, type Snapshot } from './context';
import { findSpot, type SpotQuery } from './placement';
import { ageLocked } from '../sim/systems/build';

const TYPES: ResourceType[] = ['food', 'wood', 'gold', 'stone'];
const WORKING: ReadonlySet<UnitState> = new Set(['toNode', 'gathering', 'toDrop']);
const BUILDING: ReadonlySet<UnitState> = new Set(['toBuild', 'building']);
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
  private readonly briefed = new Set<EntityId>();
  /** Per pass: gatherers per node / farm, and node shortlists by type. */
  private load = new Map<EntityId, number>();
  private shortlists = new Map<ResourceType, { n: ResourceNode; d: number }[]>();

  constructor(private readonly c: Ctx) {}

  /** Target share of workers per resource right now. */
  ratios(s: Snapshot): Record<ResourceType, number> {
    const production = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
    let r: Record<ResourceType, number>;
    if (!production && s.villagers.length < this.c.profile.barracksAt) r = { food: 0.6, wood: 0.4, gold: 0, stone: 0 };
    else if (s.villagers.length < 25) r = { food: 0.45, wood: 0.32, gold: 0.18, stone: 0.05 };
    else r = { food: 0.4, wood: 0.27, gold: 0.25, stone: 0.08 };
    const stock = this.c.world.stockOf(this.c.player);
    let sum = 0;
    for (const t of TYPES) {
      // Stockpiling more than it spends: move workers elsewhere.
      const plenty = t === 'food' || t === 'wood' ? 400 : 300;
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
    const tc = s.tc;
    if (tc?.complete) {
      while (
        tc.queue < profile.tcQueue &&
        s.villagers.length + tc.queue < profile.targetVillagers &&
        s.popUsed < s.popCap &&
        stock.food >= 50
      ) {
        const before = tc.queue;
        this.c.issue({ type: 'train', buildingId: tc.id, unit: 'villager' });
        if (tc.queue === before) break;
        s.popUsed++;
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
    const ratio = this.ratios(s);
    const want = (t: ResourceType) => ratio[t] * workers - counts[t];
    this.foodShort = 0;

    for (const v of idle) {
      const order = [...TYPES].sort((a, b) => want(b) - want(a));
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
    for (let moves = 0; moves < 2; moves++) {
      const over = TYPES.reduce((a, b) => (want(a) < want(b) ? a : b));
      const under = TYPES.reduce((a, b) => (want(a) > want(b) ? a : b));
      if (want(over) > -1.5 || want(under) < 1.5) break;
      const pool = byType[over].filter((v) => !(v.gatherNode !== null && world.buildings.has(v.gatherNode)));
      const v = (pool.length ? pool : byType[over]).find((u) => !u.carry || u.carry.amount < 5) ?? (pool[0] ?? byType[over][0]);
      if (!v) break;
      if (!this.assign(v, under, s)) {
        if (under === 'food') this.foodShort++;
        break;
      }
      byType[over].splice(byType[over].indexOf(v), 1);
      counts[over]--;
      counts[under]++;
    }

    // Food work still wanted beyond the free farms and berry bushes: fields are needed.
    this.foodGap = want('food');
    let free = 0;
    for (const b of s.buildings) if (b.kind === 'farm' && b.complete && (b.food ?? 0) > 0 && !this.load.get(b.id)) free++;
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
    const { world, player } = this.c;
    if (type === 'food') {
      let best: Building | null = null;
      let bestD = Infinity;
      let fallow: Building | null = null;
      let fallowD = Infinity;
      for (const b of s.buildings) {
        if (b.kind !== 'farm' || !b.complete || (this.load.get(b.id) ?? 0) > 0 || this.skipped(b.id)) continue;
        const d = dist(v.pos, b.pos);
        if ((b.food ?? 0) > 0) {
          if (d < bestD) [best, bestD] = [b, d];
        } else if (d < fallowD) [fallow, fallowD] = [b, d];
      }
      if (best) return best;
      const berry = this.nearestNode(v, 'food', s);
      if (berry) return berry;
      // Reseeding a fallow farm costs a new farm's wood.
      if (fallow && canAfford(world.stockOf(player), BUILDINGS.farm.cost)) return fallow;
      return null;
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
    // Farms jump the queue when food is badly short (berries gone, no fields yet).
    const urgent = this.foodShort > 0 && this.foodGap >= 3;
    const needs: (() => boolean | null)[] = urgent
      ? [() => this.house(s), () => this.farm(s), () => this.dropSite(s), () => this.production(s)]
      : [() => this.house(s), () => this.dropSite(s), () => this.farm(s), () => this.production(s)];
    // true: built; false: wanted but not affordable yet (save up for it); null: not needed / no spot.
    for (const need of needs) if (need() !== null) return;
  }

  private house(s: Snapshot): boolean | null {
    if (s.popCap >= MAX_POP) return null;
    const production = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
    const building = s.building.house ?? 0;
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
      const r = this.place(s, { kind, center: anchor.pos, minR: 2.5, maxR: 12, clearOfNodes: 1, gap: 1, maxChecks: 25 }, Math.min(2, this.c.profile.builders), anchor.pos);
      if (r !== null) return r;
      // Nowhere to put it (dense forest, rocks): don't search here again for a while.
      this.skip.set(-anchor.id, world.time + 90);
    }
    return null;
  }

  private farm(s: Snapshot): boolean | null {
    if (this.foodShort <= 0) return null;
    const wood = this.c.world.stockOf(this.c.player).wood;
    if ((s.building.farm ?? 0) >= Math.min(6, Math.max(1, Math.ceil(this.foodGap)), 2 + Math.floor(wood / 150))) return null;
    const center = s.tc?.pos ?? this.c.home;
    return this.place(s, { kind: 'farm', center, minR: 4, maxR: 16, clearOfNodes: 1, gap: 0.8 }, 1);
  }

  private production(s: Snapshot): boolean | null {
    const { world, profile } = this.c;
    const have = PRODUCTION.reduce((n, k) => n + (s.count[k] ?? 0), 0);
    if (have >= profile.maxProduction) return null;
    if (s.villagers.length < profile.barracksAt + Math.min(have, 3) * 3) return null;
    const spacing = have === 0 ? 0 : have < 3 ? profile.productionSpacing * 0.5 : profile.productionSpacing;
    if (world.time - this.lastProduction < spacing) return null;
    // Only kinds our age allows (the range and stable wait for the Town Age).
    const open = PRODUCTION.filter((k) => !ageLocked(world, k, this.c.player));
    if (!open.length) return null;
    const kind = open[have % open.length];
    const enemy = this.c.intel.enemyStart;
    const toward = enemy ? norm({ x: enemy.x - this.c.home.x, z: enemy.z - this.c.home.z }) : undefined;
    const r = this.place(s, { kind, center: this.c.home, minR: 9, maxR: 28, clearOfNodes: 3, gap: 1.5, toward, bias: 8 }, profile.builders);
    if (r) this.lastProduction = world.time;
    return r;
  }

  /** Lay a foundation found by `q` and send `n` builders. */
  private place(s: Snapshot, q: SpotQuery, n: number, near?: Vec2): boolean | null {
    const { world, player, intel } = this.c;
    if (ageLocked(world, q.kind, player)) return null;
    if (!canAfford(world.stockOf(player), BUILDINGS[q.kind].cost)) return false;
    const builders = this.builders(s, near ?? q.center, n, q.kind === 'farm');
    if (!builders.length) return null;
    const pos = findSpot(world, intel, player, { ...q, region: this.c.region });
    if (!pos) return null;
    const before = world.buildings.size;
    this.c.issue({ type: 'build', unitIds: builders.map((u) => u.id), kind: q.kind, pos, rot: 0 });
    return world.buildings.size > before ? true : null;
  }

  /** The `n` villagers best placed to build near `p` (idle ones, then non-farmers, nearest first). */
  private builders(s: Snapshot, p: Vec2, n: number, food: boolean): Unit[] {
    const cands = s.villagers.filter((v) => !this.c.sheltered.has(v.id) && !BUILDING.has(v.state) && v.state !== 'moving');
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
