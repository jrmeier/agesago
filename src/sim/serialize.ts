import type { MapOptions } from '../core/maps';
import { civFor } from '../core/civilizations';
import { BUILDINGS, MARKET, nextUpgrade } from '../core/buildings';
import { packs, UNITS } from '../core/units';
import { TECHS } from '../core/techs';
import type { Age, Building, EntityId, Heightfield, MarketResource, Player, PlayerId, ResourceNode, Stockpile, TechId, Unit } from '../core/types';
import { generateMap } from './mapgen';
import { World } from './World';
import type { CombatState, FleeState, PendingHit } from './systems/combat';
import type { DamageShare } from './systems/veterancy';
import type { ExploreState } from './systems/explore';
import type { GatherState } from './systems/gather';
import { clearStatCache } from './systems/research';
import { recomputeAllAuras } from './systems/auras';
import { buildingRect } from './systems/sites';
import { removeProduction } from './productionQueue';
import type { NavalJob, Landing } from './systems/naval';
import type { ExplorationSite, PriestOrder } from './systems/explorationRewards';
import { normalizeWonderRules, type GameResult, type WonderCountdown, type WonderRules } from './systems/victory';

/**
 * 11: M17-2 patrol routes on units (Unit.patrol); older saves have none.
 * 10: M17-1 group formations (Unit.formation: id, shared speed cap, arrival facing, slot).
 * 9: M16-2 siege engines (Unit.deployed, Unit.packTimer, 'packing'/'unpacking' states). Older
 *    saves hold no siege, so they load with no pack state.
 * 8: M16-7 wonder victory (match wonderRules, systems.wonder countdown, Building.completedAt).
 *    Older saves load with the default rules (on, 300 s) and no countdown.
 * 7: M15-5 loot totals per player (PlayerState.looted; older saves load with zero).
 * 6: M14-5 repair (toRepair/repairing unit states, per-player fractional repair debt).
 * 5: M14-2 upgrade chains. The academy's Guard/Fortress Tower techs became per-building tiers:
 *    older saves that researched them load with every watch tower at the matching tier.
 * 4: M15-1 veterancy (unit xp/rank, damage log). Older saves load with every unit at rank 0, xp 0.
 * 3: M14-1 in-place building upgrades (Building.tier, Building.upgrading).
 * 2: M8 research (researched techs, ages, market prices, building research queues).
 */
export const SAVE_VERSION = 11;
/** Oldest version that still loads; v2 buildings load at tier 0 with no upgrade running, v2–9 units out of formation. */
export const MIN_SAVE_VERSION = 2;

/** Plain JSON, with ordered entries: iteration order affects scans, training and exploration. */
export interface SaveData {
  version: number;
  seed: number;
  playerCount: number;
  mapOptions?: MapOptions;
  /** Wonder victory match option; absent before v8 (loads with the defaults). */
  wonderRules?: WonderRules;
  width: number;
  depth: number;
  players: {
    player: Player;
    stock: Stockpile;
    visibility: { version: number; runs: number[] };
    /** Finished techs, in completion order. */
    researched: TechId[];
    age: Age;
    prices: Record<MarketResource, number>;
    /** Loot taken so far (absent before v7). */
    looted?: Stockpile;
  }[];
  units: Unit[];
  nodes: ResourceNode[];
  buildings: Building[];
  time: number;
  clocks: { fogClock: number; nextId: number };
  systems: {
    navalJobs?: [EntityId, NavalJob][];
    boarding?: [EntityId, EntityId][];
    landings?: [EntityId, Landing][];
    waterNavExpanded?: number;
    waterNavVersion?: number;
    exploration?: [string, ExplorationSite][];
    priests?: [EntityId, PriestOrder][];
    gather: [EntityId, GatherState][];
    build: [EntityId, EntityId][];
    explore: [EntityId, ExploreState][];
    exploreQueue: EntityId[];
    combat: [EntityId, CombatState][];
    flee: [EntityId, FleeState][];
    farmers: [EntityId, EntityId][];
    /** Fractional repair cost owed per player (whole units are charged as they accrue); absent before v6. */
    repairDebt?: [PlayerId, Partial<Stockpile>][];
    projectiles: PendingHit[];
    /** Absent before version 4. */
    damageLog?: [EntityId, DamageShare[]][];
    lastAlert: [PlayerId, number][];
    combatTicks: number;
    navVersion: number;
    navExpanded: number;
    victoryClock: number;
    defeated: PlayerId[];
    gameOver: GameResult | null;
    /** Running wonder countdown (absent before v8). */
    wonder?: WonderCountdown | null;
  };
}

/** Normalize optional fields as JSON does and detach every nested object from the live sim. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Alternating byte, count pairs; no browser/Node base64 dependency. */
function encode(grid: Uint8Array): number[] {
  const runs: number[] = [];
  for (const byte of grid) {
    if (runs.length && runs[runs.length - 2] === byte) runs[runs.length - 1]++;
    else runs.push(byte, 1);
  }
  return runs;
}

function decode(runs: number[], grid: Uint8Array): void {
  if (!Array.isArray(runs) || runs.length % 2) throw new Error('Invalid save: visibility runs');
  let offset = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const byte = runs[i];
    const count = runs[i + 1];
    if (!Number.isInteger(byte) || byte < 0 || byte > 2 || !Number.isSafeInteger(count) || count <= 0 || offset + count > grid.length) {
      throw new Error('Invalid save: visibility runs');
    }
    grid.fill(byte, offset, offset + count);
    offset += count;
  }
  if (offset !== grid.length) throw new Error('Invalid save: visibility length');
}

/**
 * Save at a tick boundary. Set world.seed to the original generateMap seed first.
 * Captures every World-owned system state. Formation speed caps and facings live on Unit.formation;
 * exact continuation of jam re-pathing and post-arrival slot keeping still requires snapshot/restore
 * exports from movement.ts's private WeakMaps (another lane).
 * explore.ts's private empty-frontier cache also affects its per-tick work budget and must
 * be restored for exact continuation on fully explored regions. See the contract-gap tests.
 */
export function serializeWorld(world: World): SaveData {
  if (world.seed === null || !Number.isSafeInteger(world.seed)) {
    throw new Error('Cannot save: set world.seed to the seed used by generateMap');
  }
  return copy({
    version: SAVE_VERSION,
    seed: world.seed,
    playerCount: world.players.size,
    mapOptions: world.mapOptions,
    wonderRules: world.wonderRules,
    width: world.hf.width,
    depth: world.hf.depth,
    players: [...world.players.values()].map(({ player, stock, visibility, researched, age, prices, looted }) => ({
      player, stock, visibility: { version: visibility.version, runs: encode(visibility.state) },
      researched: [...researched], age, prices, looted: { ...looted },
    })),
    units: [...world.units.values()],
    nodes: [...world.nodes.values()],
    buildings: [...world.buildings.values()],
    time: world.time,
    clocks: world.saveClocks,
    systems: {
      navalJobs: [...world.navalJobs], boarding: [...world.boarding], landings: [...world.landings],
      waterNavExpanded: world.waterNav.expanded, waterNavVersion: world.waterNav.version,
      exploration: [...world.exploration],
      priests: [...world.priestOrders],
      gather: [...world.gatherState],
      build: [...world.buildState],
      explore: [...world.exploreState],
      exploreQueue: [...world.exploreQueue],
      combat: [...world.combatState],
      flee: [...world.fleeState],
      farmers: [...world.farmers],
      repairDebt: [...world.repairDebt],
      projectiles: world.projectiles,
      damageLog: [...world.damageLog],
      lastAlert: [...world.lastAlert],
      combatTicks: world.combatTicks,
      navVersion: world.nav.version,
      navExpanded: world.nav.expanded,
      victoryClock: world.victoryClock,
      defeated: [...world.defeatedPlayers],
      gameOver: world.gameOver,
      wonder: world.wonder,
    },
  });
}

/** Removed academy techs (M14-2) and the watch-tower tier each one now means; queued ones refund. */
const LEGACY_TOWER_TECHS: Record<string, { tier: number; cost: Partial<Stockpile> }> = {
  guardTower: { tier: 1, cost: { food: 100, wood: 250 } },
  fortressTower: { tier: 2, cost: { food: 300, stone: 250 } },
};

/**
 * v4 → v5: a player who researched Guard/Fortress Tower gets every watch tower (foundations too)
 * at that tier, and the techs leave `researched`. A legacy tech still queued is dropped and refunded.
 */
function migrateTowerTechs(saved: SaveData): void {
  const legacy = (t: string): boolean => Object.hasOwn(LEGACY_TOWER_TECHS, t);
  for (const p of saved.players) {
    if (!Array.isArray(p.researched)) continue;
    const tier = Math.max(0, ...p.researched.filter(legacy).map((t) => LEGACY_TOWER_TECHS[t].tier));
    p.researched = p.researched.filter((t) => !legacy(t));
    if (!tier) continue;
    for (const b of saved.buildings) {
      if (b.owner === p.player.id && b.kind === 'watchTower') b.tier = Math.max(b.tier ?? 0, tier);
    }
  }
  for (const b of saved.buildings) {
    if (!b.research?.some(legacy)) continue;
    const owner = saved.players.find((p) => p.player.id === b.owner);
    for (let i = b.research.length - 1; i >= 0; i--) {
      const t = b.research[i];
      if (!legacy(t)) continue;
      removeProduction(b, 'research', i);
      b.research.splice(i, 1);
      if (i === 0) b.researchProgress = 0;
      if (owner) for (const [r, n] of Object.entries(LEGACY_TOWER_TECHS[t].cost)) owner.stock[r as keyof Stockpile] += n;
    }
    if (b.research.length === 0) {
      delete b.research;
      delete b.researchProgress;
    }
  }
}

function validPatrol(p: Unit['patrol']): boolean {
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return !!p && Array.isArray(p.route) && p.route.length >= 2 && p.route.every((q) => !!q && finite(q.x) && finite(q.z))
    && Number.isInteger(p.index) && p.index >= 0 && p.index < p.route.length;
}

function restoreMap<K, V>(map: Map<K, V>, entries: [K, V][]): void {
  map.clear();
  for (const [key, value] of entries) map.set(key, value);
}

/** Regenerate static scenery from the seed; retain queues, jobs, exact fog and clocks. */
export function deserializeWorld(data: SaveData, hf?: Heightfield): World {
  if (!data || typeof data.version !== 'number' || data.version < MIN_SAVE_VERSION || data.version > SAVE_VERSION) {
    const old = typeof data?.version === 'number' && data.version < MIN_SAVE_VERSION;
    throw new Error(
      `Unsupported save version ${data?.version}; expected ${SAVE_VERSION}` +
        (old ? ' (saves from before ages and research can no longer be loaded)' : '')
    );
  }
  if (!Number.isSafeInteger(data.seed) || !Number.isInteger(data.playerCount) || data.playerCount < 1 || data.playerCount > 4
    || data.players.length !== data.playerCount) throw new Error('Invalid save: map identity or player count');
  const ids = data.players.map(({ player }) => player.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !Number.isInteger(id) || id < 1 || id > data.playerCount)) {
    throw new Error('Invalid save: player ids must be 1..playerCount');
  }
  const savedIds = [...data.units, ...data.nodes, ...data.buildings].map((e) => e.id);
  if (!Number.isSafeInteger(data.clocks.nextId) || data.clocks.nextId < 1
    || savedIds.some((id) => !Number.isSafeInteger(id) || id < 1 || id >= data.clocks.nextId)
    || new Set(savedIds).size !== savedIds.length) throw new Error('Invalid save: entity ids or nextId');
  for (const u of data.units) if (u.patrol !== undefined && !validPatrol(u.patrol)) throw new Error('Invalid save: patrol route');
  for (const p of data.players) if(p.player.civ !== undefined && !civFor(p.player.civ)) throw new Error('Invalid save: civilization');
  for (const u of data.units) {
    if (u.rank !== undefined && u.rank !== 0 && u.rank !== 1 && u.rank !== 2) throw new Error('Invalid save: unit rank');
    if (u.xp !== undefined && !(typeof u.xp === 'number' && Number.isFinite(u.xp) && u.xp >= 0)) throw new Error('Invalid save: unit xp');
    if (!Object.hasOwn(UNITS, u.kind)) throw new Error('Invalid save: unit kind');
    const transition = u.state === 'packing' || u.state === 'unpacking';
    if ((u.deployed !== undefined || u.packTimer !== undefined || transition) && !packs(u.kind)) throw new Error('Invalid save: siege pack state');
    if (u.deployed !== undefined && u.deployed !== true) throw new Error('Invalid save: siege pack state');
    if (u.packTimer !== undefined && !(typeof u.packTimer === 'number' && Number.isFinite(u.packTimer) && u.packTimer >= 0)) throw new Error('Invalid save: siege pack state');
    if (transition && u.packTimer === undefined) throw new Error('Invalid save: siege pack state');
  }
  const saved = copy(data);
  const generated = generateMap(saved.seed, saved.playerCount, saved.mapOptions);
  const terrain = hf ?? generated.hf;
  if (terrain.width !== saved.width || terrain.depth !== saved.depth) throw new Error('Invalid save: terrain dimensions differ');
  const world = new World(terrain, generated.layout, saved.players.map((p) => p.player));
  world.seed = saved.seed;
  world.mapOptions = saved.mapOptions ?? {};
  // Pre-wonder saves: default wonder rules, no countdown, no completion stamps.
  if (saved.version < 8) {
    delete saved.wonderRules;
    delete saved.systems.wonder;
    for (const b of saved.buildings) delete b.completedAt;
  }
  world.wonderRules = normalizeWonderRules(saved.wonderRules);
  // Initial entities emit no events; drop their footprints before replacing the maps.
  for (const id of world.buildings.keys()) world.nav.removeRect(id);
  if (saved.version < 4) {
    // Pre-veterancy saves: every unit starts at rank 0 with no xp and no damage history.
    for (const u of saved.units) {
      delete u.rank;
      delete u.xp;
    }
    delete saved.systems.damageLog;
  }
  for (const u of saved.units) {
    const f = u.formation;
    if (saved.version < 10 || (f && !(Number.isFinite(f?.slot?.x) && Number.isFinite(f?.slot?.z)))) delete u.formation;
    // Pre-patrol saves (before v11) carry no patrol route.
    if (saved.version < 11) delete u.patrol;
  }
  restoreMap(world.units, saved.units.map((u) => [u.id, u]));
  restoreMap(world.nodes, saved.nodes.map((n) => [n.id, n]));
  if (saved.version < 3) {
    for (const b of saved.buildings) {
      delete b.tier;
      delete b.upgrading;
    }
  }
  if (saved.version < 5) migrateTowerTechs(saved);
  // Pre-repair saves carry no repair debt (and no toRepair/repairing units).
  if (saved.version < 6) delete saved.systems.repairDebt;
  // Pre-loot saves: every player starts with nothing looted.
  if (saved.version < 7) for (const p of saved.players) delete p.looted;
  // Pre-siege saves: no unit is deployed or mid-pack.
  if (saved.version < 9) {
    for (const u of saved.units) {
      delete u.deployed;
      delete u.packTimer;
    }
  }
  restoreMap(world.buildings, saved.buildings.map((b) => [b.id, b]));
  for (const b of world.buildings.values()) {
    const spec = BUILDINGS[b.kind];
    // A finished gate is open on the shared grid; its foundation still blocks.
    if (b.kind === 'dock') world.waterNav.addRect(b.id, buildingRect(b));
    if (!spec.walkable || (spec.gate && !b.complete)) world.nav.addRect(b.id, buildingRect(b));
  }
  for (const p of saved.players) {
    const state = world.players.get(p.player.id)!;
    Object.assign(state.stock, p.stock);
    decode(p.visibility.runs, state.visibility.state);
    state.visibility.version = p.visibility.version;
    if (!Array.isArray(p.researched) || p.researched.some((t) => !Object.hasOwn(TECHS, t))) throw new Error('Invalid save: researched techs');
    if (![0, 1, 2, 3].includes(p.age)) throw new Error('Invalid save: age');
    state.researched.clear();
    for (const t of p.researched) state.researched.add(t);
    state.age = p.age;
    for (const r of ['wood', 'food', 'stone'] as const) {
      const v = p.prices?.[r];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < MARKET.minPrice || v > MARKET.maxPrice) throw new Error('Invalid save: prices');
      state.prices[r] = v;
    }
    for (const r of ['food', 'wood', 'gold', 'stone'] as const) {
      const v = p.looted?.[r] ?? 0;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('Invalid save: looted');
      state.looted[r] = v;
    }
  }
  for (const b of world.buildings.values()) {
    // A tier must be a step its chain actually reaches (0 always is).
    if (b.tier !== undefined && (!Number.isInteger(b.tier) || b.tier < 0 || (b.tier > 0 && !nextUpgrade(b.kind, b.tier - 1)))) {
      throw new Error('Invalid save: building tier');
    }
    if (b.upgrading !== undefined && (typeof b.upgrading !== 'object' || b.upgrading.to !== (b.tier ?? 0) + 1
      || !nextUpgrade(b.kind, b.tier) || typeof b.upgrading.progress !== 'number' || !Number.isFinite(b.upgrading.progress))) {
      throw new Error('Invalid save: building upgrade');
    }
    if (b.research?.some((t) => !Object.hasOwn(TECHS, t))) throw new Error('Invalid save: research queue');
    if (b.productionQueue !== undefined && (!Array.isArray(b.productionQueue)
      || b.productionQueue.some((k) => k !== 'train' && k !== 'research')
      || b.productionQueue.filter((k) => k === 'train').length !== b.queue
      || b.productionQueue.filter((k) => k === 'research').length !== (b.research?.length ?? 0))) {
      throw new Error('Invalid save: production queue');
    }
  }
  clearStatCache(world);
  world.time = saved.time;
  world.restoreClocks(saved.clocks);
  const s = saved.systems;
  if (s.navalJobs) restoreMap(world.navalJobs, s.navalJobs);
  if (s.boarding) restoreMap(world.boarding, s.boarding);
  if (s.landings) restoreMap(world.landings, s.landings);
  world.waterNav.expanded = s.waterNavExpanded ?? 0; world.waterNav.version = s.waterNavVersion ?? world.waterNav.version;
  if (s.exploration) restoreMap(world.exploration, s.exploration);
  if (s.priests) restoreMap(world.priestOrders, s.priests);
  restoreMap(world.gatherState, s.gather);
  restoreMap(world.buildState, s.build);
  restoreMap(world.exploreState, s.explore);
  for (const id of s.exploreQueue) world.exploreQueue.add(id);
  restoreMap(world.combatState, s.combat);
  restoreMap(world.fleeState, s.flee);
  restoreMap(world.farmers, s.farmers);
  if (s.repairDebt) restoreMap(world.repairDebt, s.repairDebt);
  restoreMap(world.lastAlert, s.lastAlert);
  world.projectiles.push(...s.projectiles);
  if (s.damageLog) restoreMap(world.damageLog, s.damageLog);
  world.combatTicks = s.combatTicks;
  world.nav.version = s.navVersion;
  world.nav.expanded = s.navExpanded;
  world.victoryClock = s.victoryClock;
  for (const id of s.defeated) world.defeatedPlayers.add(id);
  world.gameOver = s.gameOver;
  const w = s.wonder;
  if (w != null) {
    const b = world.buildings.get(w.building);
    if (!b || b.kind !== 'wonder' || b.owner !== w.owner || typeof w.remaining !== 'number' || !Number.isFinite(w.remaining) || w.remaining < 0) {
      throw new Error('Invalid save: wonder countdown');
    }
    world.wonder = { building: w.building, owner: w.owner, pos: { ...b.pos }, remaining: w.remaining };
  }
  // Auras aren't saved: re-derive who stands in which aura from the restored entities.
  recomputeAllAuras(world);
  return world;
}
