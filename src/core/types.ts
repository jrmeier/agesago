/**
 * Shared contract between every module. FROZEN after T1: lanes must not edit this
 * file — request changes from the integrator instead.
 *
 * World frame: ground coordinates are (x, z) in world units (≈ metres),
 * x ∈ [0, MAP_W], z ∈ [0, MAP_D]. Y is up; sea level is y = 0.
 */

export const MAP_W = 176;
export const MAP_D = 176;
export const SEA_LEVEL = 0;
export const DEFAULT_SEED = 1;

export type EntityId = number;

/** 0 is gaia (neutral: resources, wildlife); players are 1..4. */
export type PlayerId = number;
export const GAIA: PlayerId = 0;

export interface Player {
  id: PlayerId;
  name: string;
  /** Cloth/banner colour. */
  color: number;
  /** Players on the same team are allies. */
  team: number;
  /** Who issues this player's commands. */
  control: 'human' | 'ai';
}

/** How a unit reacts to enemies it can see. */
export type Stance = 'aggressive' | 'defensive' | 'standGround' | 'passive';

export interface Vec2 {
  x: number;
  z: number;
}

export type ResourceType = 'wood' | 'food' | 'gold' | 'stone';
export type Stockpile = Record<ResourceType, number>;

export type NodeKind = 'tree' | 'berry' | 'gold' | 'stone';
/**
 * Player unit types. Villagers gather and build; scouts are fast, far-sighted explorers that
 * cannot gather; the rest are military. Stats live in core/units.ts.
 */
export type UnitKind = 'villager' | 'scout' | 'hoplite' | 'swordsman' | 'slinger' | 'archer' | 'horseman';
/** Everything a player can build. Data (sizes, costs, build times) lives in core/buildings.ts. */
export type BuildingKind =
  | 'townCenter'
  | 'house'
  | 'storehouse'
  | 'granary'
  | 'miningCamp'
  | 'farm'
  | 'barracks'
  | 'archeryRange'
  | 'stable';
export type EntityKind = UnitKind | NodeKind | BuildingKind;

export const NODE_RESOURCE: Record<NodeKind, ResourceType> = {
  tree: 'wood',
  berry: 'food',
  gold: 'gold',
  stone: 'stone',
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
  /**
   * What the ground surface is made of at (x, z), for texturing and ground cover.
   * Weights are 0..1 and roughly sum to 1. Cheap enough to call per render vertex.
   */
  ground(x: number, z: number): GroundWeights;
}

/** Surface material blend. Renderers splat textures and scatter grass/flowers from these. */
export interface GroundWeights {
  /** Short green grass. */
  grass: number;
  /** Tall grass with wildflowers. */
  meadow: number;
  /** Forest floor: leaf litter, moss. */
  forest: number;
  /** Bare earth, steep slopes, around buildings. */
  dirt: number;
  /** Exposed stone on cliffs and outcrops. */
  rock: number;
  /** Beaches, river and lake shores, and underwater beds. */
  sand: number;
  /** Trodden dirt roads and tracks. */
  path: number;
}

/** Plain short grass everywhere — handy for hand-built test heightfields. */
export const GRASS_ONLY: GroundWeights = { grass: 1, meadow: 0, forest: 0, dirt: 0, rock: 0, sand: 0, path: 0 };

/** Decorative, non-harvestable scenery placed by map generation. */
export type PropKind =
  | 'boulder'
  | 'rocks'
  | 'standingStone'
  | 'ruinColumn'
  | 'ruinWall'
  | 'fence'
  | 'hayBale'
  | 'wheatField'
  | 'well'
  | 'house'
  | 'cart'
  | 'reeds'
  | 'bush'
  | 'log';

export interface PropPlacement {
  kind: PropKind;
  pos: Vec2;
  /** Yaw in radians around +Y. */
  rot: number;
  /** Uniform scale multiplier (≈ 0.7–1.4). */
  scale: number;
  /** If > 0, units path around a disc of this radius. 0 = walk-through (reeds, flowers, fields). */
  blockRadius: number;
}

/** One player's starting Town Center, villagers and scouts. */
export interface StartLayout {
  townCenter: Vec2;
  villagers: Vec2[];
  scouts: Vec2[];
}

/** Plain-data starting layout produced by map generation and consumed by World. */
export interface MapLayout {
  townCenter: Vec2;
  villagers: Vec2[];
  /** Starting scouts (usually one), placed just outside the Town Center. */
  scouts: Vec2[];
  /** Opponents' starting positions (players 2, 3, …). Empty or absent for a solo map. */
  extraStarts?: StartLayout[];
  nodes: { kind: NodeKind; pos: Vec2; amount: number }[];
  /** Scenery: ruins, rocks, fences, fields, houses… */
  props: PropPlacement[];
}

// ---- Entities (plain data; owned and mutated only by the sim) ----

export type UnitState = 'idle' | 'moving' | 'toNode' | 'gathering' | 'toDrop' | 'exploring' | 'toBuild' | 'building';

export interface Unit {
  id: EntityId;
  kind: UnitKind;
  owner: PlayerId;
  hp: number;
  maxHp: number;
  /** Entity this unit is attacking (or chasing), if any. */
  target: EntityId | null;
  stance: Stance;
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
  kind: BuildingKind;
  owner: PlayerId;
  hp: number;
  maxHp: number;
  /** Footprint centre. */
  pos: Vec2;
  /** Yaw in radians; footprints rotate in 90° steps (0, π/2, π, 3π/2). */
  rot: number;
  /** Footprint bounding radius (≈ half the diagonal of the BUILDINGS size); used for picking and drop-off reach. */
  radius: number;
  /** False while still a foundation under construction. */
  complete: boolean;
  /** Construction progress 0..1 (1 when complete). */
  buildProgress: number;
  /** Units queued for training, in order (head is in progress). */
  queue: number;
  /** Kinds of the queued units, same length as `queue` (head first). */
  queueKinds?: UnitKind[];
  /** Seconds of training completed on the current queue head. */
  progress: number;
  /** Farms only: food remaining in the field. */
  food?: number;
}

export type Entity = Unit | ResourceNode | Building;

// ---- Commands in, events out ----

export type Command =
  | { type: 'move'; unitIds: EntityId[]; target: Vec2 }
  | { type: 'gather'; unitIds: EntityId[]; nodeId: EntityId }
  /** Train one unit (default: the building's first trainable kind, e.g. a villager at the TC). */
  | { type: 'train'; buildingId: EntityId; unit?: UnitKind }
  /** Attack a unit or building. */
  | { type: 'attack'; unitIds: EntityId[]; targetId: EntityId }
  /** Walk to a point, fighting any enemy met on the way. */
  | { type: 'attackMove'; unitIds: EntityId[]; target: Vec2 }
  /** Drop current orders and stand still. */
  | { type: 'stop'; unitIds: EntityId[] }
  | { type: 'stance'; unitIds: EntityId[]; stance: Stance }
  /** Place a foundation (cost is paid now) and send the units to build it. */
  | { type: 'build'; unitIds: EntityId[]; kind: BuildingKind; pos: Vec2; rot: number }
  /** Send units to help construct an existing foundation (or repair later). */
  | { type: 'construct'; unitIds: EntityId[]; buildingId: EntityId }
  /** Cancel an unfinished foundation; refunds the cost. */
  | { type: 'cancelBuild'; buildingId: EntityId }
  /** Auto-explore: units head for the nearest reachable unexplored ground until told otherwise. */
  | { type: 'explore'; unitIds: EntityId[] };

export type RejectReason =
  | 'insufficient-food'
  | 'insufficient-resources'
  | 'pop-cap'
  | 'unreachable'
  | 'invalid-target'
  | 'blocked-site'
  /** A farm (or similar single-worker site) already has its worker. */
  | 'occupied';

/** Result of checking whether a building fits at a spot (World.canPlace). */
export interface PlacementCheck {
  ok: boolean;
  /** Why not, when !ok. */
  reason?: 'water' | 'slope' | 'unexplored' | 'occupied' | 'out-of-bounds' | 'insufficient-resources';
}

export type SimEvent =
  | { type: 'spawned'; id: EntityId; kind: EntityKind }
  | { type: 'removed'; id: EntityId }
  | { type: 'stockpile'; stock: Stockpile; pop: number; popCap: number }
  /** A foundation finished construction. */
  | { type: 'constructed'; id: EntityId }
  /** An entity lost hit points (hp is the new value). */
  | { type: 'damaged'; id: EntityId; hp: number; maxHp: number; by: EntityId | null }
  /** A unit or building was destroyed (followed by 'removed'). */
  | { type: 'died'; id: EntityId; kind: EntityKind; owner: PlayerId; pos: Vec2 }
  /** A ranged attack was launched; renderers draw it flying for `flight` seconds. */
  | { type: 'projectile'; kind: 'arrow' | 'stone' | 'javelin'; from: Vec2; to: Vec2; flight: number; targetId: EntityId }
  /** One of `owner`'s units or buildings was hit by an enemy (for "under attack" alerts). */
  | { type: 'attacked'; owner: PlayerId; id: EntityId; pos: Vec2 }
  /** A farm's remaining food changed (harvest or reseed); 0 = fallow. */
  | { type: 'farmFood'; id: EntityId; food: number }
  | { type: 'unitState'; id: EntityId; state: UnitState }
  | { type: 'trainProgress'; buildingId: EntityId; queue: number; progress: number; total: number }
  | { type: 'rejected'; reason: RejectReason };
