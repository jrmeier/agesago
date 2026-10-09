import { BUILDINGS } from '../core/buildings';
import type { Building, EntityId, Heightfield, Player, PlayerId, ResourceNode, Stockpile, Unit } from '../core/types';
import { generateMap } from './mapgen';
import { World } from './World';
import type { CombatState, FleeState, PendingHit } from './systems/combat';
import type { ExploreState } from './systems/explore';
import type { GatherState } from './systems/gather';
import { buildingRect } from './systems/sites';
import type { GameResult } from './systems/victory';

export const SAVE_VERSION = 1;

/** Plain JSON, with ordered entries: iteration order affects scans, training and exploration. */
export interface SaveData {
  version: number;
  seed: number;
  playerCount: number;
  width: number;
  depth: number;
  players: {
    player: Player;
    stock: Stockpile;
    visibility: { version: number; runs: number[] };
  }[];
  units: Unit[];
  nodes: ResourceNode[];
  buildings: Building[];
  time: number;
  clocks: { fogClock: number; nextId: number };
  systems: {
    gather: [EntityId, GatherState][];
    build: [EntityId, EntityId][];
    explore: [EntityId, ExploreState][];
    exploreQueue: EntityId[];
    combat: [EntityId, CombatState][];
    flee: [EntityId, FleeState][];
    farmers: [EntityId, EntityId][];
    projectiles: PendingHit[];
    lastAlert: [PlayerId, number][];
    combatTicks: number;
    navVersion: number;
    navExpanded: number;
    victoryClock: number;
    defeated: PlayerId[];
    gameOver: GameResult | null;
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
 * Captures every World-owned system state. Exact continuation of formation/jam steering
 * still requires snapshot/restore exports from movement.ts's private WeakMaps (another lane).
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
    width: world.hf.width,
    depth: world.hf.depth,
    players: [...world.players.values()].map(({ player, stock, visibility }) => ({
      player, stock, visibility: { version: visibility.version, runs: encode(visibility.state) },
    })),
    units: [...world.units.values()],
    nodes: [...world.nodes.values()],
    buildings: [...world.buildings.values()],
    time: world.time,
    clocks: world.saveClocks,
    systems: {
      gather: [...world.gatherState],
      build: [...world.buildState],
      explore: [...world.exploreState],
      exploreQueue: [...world.exploreQueue],
      combat: [...world.combatState],
      flee: [...world.fleeState],
      farmers: [...world.farmers],
      projectiles: world.projectiles,
      lastAlert: [...world.lastAlert],
      combatTicks: world.combatTicks,
      navVersion: world.nav.version,
      navExpanded: world.nav.expanded,
      victoryClock: world.victoryClock,
      defeated: [...world.defeatedPlayers],
      gameOver: world.gameOver,
    },
  });
}

function restoreMap<K, V>(map: Map<K, V>, entries: [K, V][]): void {
  map.clear();
  for (const [key, value] of entries) map.set(key, value);
}

/** Regenerate static scenery from the seed; retain queues, jobs, exact fog and clocks. */
export function deserializeWorld(data: SaveData, hf?: Heightfield): World {
  if (!data || data.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${data?.version}; expected ${SAVE_VERSION}`);
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
  const saved = copy(data);
  const generated = generateMap(saved.seed, saved.playerCount);
  const terrain = hf ?? generated.hf;
  if (terrain.width !== saved.width || terrain.depth !== saved.depth) throw new Error('Invalid save: terrain dimensions differ');
  const world = new World(terrain, generated.layout, saved.players.map((p) => p.player));
  world.seed = saved.seed;
  // Initial entities emit no events; drop their footprints before replacing the maps.
  for (const id of world.buildings.keys()) world.nav.removeRect(id);
  restoreMap(world.units, saved.units.map((u) => [u.id, u]));
  restoreMap(world.nodes, saved.nodes.map((n) => [n.id, n]));
  restoreMap(world.buildings, saved.buildings.map((b) => [b.id, b]));
  for (const b of world.buildings.values()) {
    const spec = BUILDINGS[b.kind];
    // A finished gate is open on the shared grid; its foundation still blocks.
    if (!spec.walkable || (spec.gate && !b.complete)) world.nav.addRect(b.id, buildingRect(b));
  }
  for (const p of saved.players) {
    const state = world.players.get(p.player.id)!;
    Object.assign(state.stock, p.stock);
    decode(p.visibility.runs, state.visibility.state);
    state.visibility.version = p.visibility.version;
  }
  world.time = saved.time;
  world.restoreClocks(saved.clocks);
  const s = saved.systems;
  restoreMap(world.gatherState, s.gather);
  restoreMap(world.buildState, s.build);
  restoreMap(world.exploreState, s.explore);
  for (const id of s.exploreQueue) world.exploreQueue.add(id);
  restoreMap(world.combatState, s.combat);
  restoreMap(world.fleeState, s.flee);
  restoreMap(world.farmers, s.farmers);
  restoreMap(world.lastAlert, s.lastAlert);
  world.projectiles.push(...s.projectiles);
  world.combatTicks = s.combatTicks;
  world.nav.version = s.navVersion;
  world.nav.expanded = s.navExpanded;
  world.victoryClock = s.victoryClock;
  for (const id of s.defeated) world.defeatedPlayers.add(id);
  world.gameOver = s.gameOver;
  return world;
}
