/**
 * Shared contract between every module. FROZEN after T1: lanes must not edit this
 * file — request changes from the integrator instead.
 *
 * World frame: ground coordinates are (x, z) in world units (≈ metres),
 * x ∈ [0, MAP_W], z ∈ [0, MAP_D]. Y is up; sea level is y = 0.
 */

export const MAP_W = 64;
export const MAP_D = 48;
export const SEA_LEVEL = 0;
export const DEFAULT_SEED = 1;

export type EntityId = number;

export interface Vec2 {
  x: number;
  z: number;
}

export type ResourceType = 'wood' | 'food' | 'gold';
export type Stockpile = Record<ResourceType, number>;

export type NodeKind = 'tree' | 'berry' | 'gold';
export type EntityKind = 'villager' | NodeKind | 'townCenter';

export const NODE_RESOURCE: Record<NodeKind, ResourceType> = {
  tree: 'wood',
  berry: 'food',
  gold: 'gold',
};

/** Terrain query surface. Implemented by sim/terrain.ts; read by everything. */
export interface Heightfield {
  readonly width: number;
  readonly depth: number;
  /** Ground height at (x, z), bilinearly interpolated. May be below SEA_LEVEL (lake/river bed). */
  heightAt(x: number, z: number): number;
  /** True where the ground is below sea level (lake, river). */
  isWater(x: number, z: number): boolean;
  /** Land, inside the map, and not too steep to walk. Ignores entities. */
  isWalkable(x: number, z: number): boolean;
  /** 0..1 forest density, used for tree placement and ground tint. */
  forestDensity(x: number, z: number): number;
}

/** Plain-data starting layout produced by map generation and consumed by World. */
export interface MapLayout {
  townCenter: Vec2;
  villagers: Vec2[];
  nodes: { kind: NodeKind; pos: Vec2; amount: number }[];
}

// ---- Entities (plain data; owned and mutated only by the sim) ----

export type UnitState = 'idle' | 'moving' | 'toNode' | 'gathering' | 'toDrop';

export interface Unit {
  id: EntityId;
  kind: 'villager';
  pos: Vec2;
  /** Position at the start of the last sim tick — renderers lerp prevPos → pos. */
  prevPos: Vec2;
  /** Heading in radians around +Y (0 = facing +z). */
  facing: number;
  state: UnitState;
  /** Remaining waypoints, next first. Empty when not travelling. */
  path: Vec2[];
  /** Node being worked, if any. */
  gatherNode: EntityId | null;
  /** Resource type the unit is assigned to (survives node depletion for retargeting). */
  gatherType: ResourceType | null;
  carry: { type: ResourceType; amount: number } | null;
}

export interface ResourceNode {
  id: EntityId;
  kind: NodeKind;
  type: ResourceType;
  pos: Vec2;
  amount: number;
  /** Interaction / blocking radius. */
  radius: number;
}

export interface Building {
  id: EntityId;
  kind: 'townCenter';
  pos: Vec2;
  /** Footprint radius; blocks movement. */
  radius: number;
  /** Villagers queued for training. */
  queue: number;
  /** Seconds of training completed on the current queue head. */
  progress: number;
}

export type Entity = Unit | ResourceNode | Building;

// ---- Commands in, events out ----

export type Command =
  | { type: 'move'; unitIds: EntityId[]; target: Vec2 }
  | { type: 'gather'; unitIds: EntityId[]; nodeId: EntityId }
  | { type: 'train'; buildingId: EntityId };

export type RejectReason = 'insufficient-food' | 'pop-cap' | 'unreachable' | 'invalid-target';

export type SimEvent =
  | { type: 'spawned'; id: EntityId; kind: EntityKind }
  | { type: 'removed'; id: EntityId }
  | { type: 'stockpile'; stock: Stockpile; pop: number }
  | { type: 'unitState'; id: EntityId; state: UnitState }
  | { type: 'trainProgress'; buildingId: EntityId; queue: number; progress: number; total: number }
  | { type: 'rejected'; reason: RejectReason };
