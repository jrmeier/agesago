import type { CivId } from './civilizations';
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

import type { Age, TechId } from './techs';
export type { Age, TechId } from './techs';

export type EntityId = number;

/** 0 is gaia (neutral: resources, wildlife); players are 1..4. */
export type PlayerId = number;
export const GAIA: PlayerId = 0;

export type Difficulty = 'easy' | 'moderate' | 'hard' | 'hardest';
export type StartingResources = 'low' | 'standard' | 'high';
export type TeamSetup = 'ffa' | 'allied-rivals' | 'pairs';

export interface Player {
  id: PlayerId;
  /** Absent in legacy saves: the original neutral roster. */
  civ?: CivId;
  name: string;
  /** Cloth/banner colour. */
  color: number;
  /** Players on the same team are allies. */
  team: number;
  /** Who issues this player's commands. */
  control: 'human' | 'ai';
  /** AI only; absent means moderate. */
  difficulty?: Difficulty;
}

/** How a unit reacts to enemies it can see. */
export type Stance = 'aggressive' | 'defensive' | 'standGround' | 'passive';
/** Group move layout: 'none' = loose ring (old behaviour, own speeds); the rest march at the slowest member's speed. */
export type FormationKind = 'none' | 'line' | 'column' | 'box';
export const FORMATION_KINDS: readonly FormationKind[] = ['none', 'line', 'column', 'box'];

/** A unit's place in a group move in progress (serialized; cleared on arrival, combat or a new order). */
export interface UnitFormation {
  /** Lowest member id of the group that was ordered together. */
  id: EntityId;
  /** Shared speed cap (slowest member); absent for 'none'. */
  speed?: number;
  /** Heading to face on arrival (radians, as Unit.facing). */
  facing?: number;
  /** This unit's slot: the final waypoint of the path it was given. */
  slot: Vec2;
}

export interface Vec2 {
  x: number;
  z: number;
}

export type ResourceType = 'wood' | 'food' | 'gold' | 'stone';
export type Stockpile = Record<ResourceType, number>;

export type NodeKind = 'tree' | 'berry' | 'gold' | 'stone' | 'carcass' | 'fish';
export type AnimalKind = 'deer' | 'boar' | 'sheep';
/**
 * Villagers gather and build; scouts explore; soldiers fight; wildlife starts as Gaia.
 * Stats live in core/units.ts.
 */
export type UnitKind =
  | 'villager'
  | 'scout'
  | 'phalangiteGuard'
  | 'legionary'
  | 'immortal'
  | 'raider'
  | 'hoplite'
  | 'swordsman'
  | 'slinger'
  | 'archer'
  | 'horseman'
  /** Champions (M16-5): trained only at the fortress, one infantry and one cavalry per civ. */
  | 'spartanHoplite'
  | 'agema'
  | 'praetorian'
  | 'equites'
  | 'appleBearer'
  | 'savaran'
  | 'gaesatae'
  | 'nobleRider'
  /** Heroes (M16-6): one named hero per civ, trained at the fortress in the Empire Age; one alive per player. */
  | 'leonidas'
  | 'scipio'
  | 'cyrus'
  | 'vercingetorix'
  /** Walks between markets for gold (M8-12). */
  | 'tradeCart'
  /** Heals allies, converts enemies and carries relics. */
  | 'priest'
  | 'fishingBoat'
  | 'merchantShip'
  | 'trireme'
  | 'transport'
  /** M16-2 siege engines, trained at the siege workshop. */
  | 'ram'
  | 'catapult'
  | 'boltShooter'
  | AnimalKind;
/** Everything a player can build. Data (sizes, costs, build times) lives in core/buildings.ts. */
export type BuildingKind =
  | 'townCenter'
  | 'house'
  | 'storehouse'
  | 'granary'
  | 'miningCamp'
  | 'farm'
  | 'corral'
  | 'barracks'
  | 'archeryRange'
  | 'stable'
  | 'watchTower'
  | 'palisade'
  | 'stoneWall'
  | 'gate'
  /** M8: weapon and armour upgrades. */
  | 'forge'
  /** M8: buy/sell resources, tribute, trade carts. */
  | 'market'
  /** M8: City Age techs (masonry, ballistics, tower upgrades). */
  | 'academy'
  | 'temple'
  | 'dock'
  /** M16-7: Empire Age monument; standing through its countdown wins the match. */
  | 'wonder'
  /** M16-2: City Age siege engines and their techs. */
  | 'siegeWorkshop'
  /** M16-5: City Age stronghold that trains champions; at most BUILDINGS.fortress.limit each. */
  | 'fortress';
export type EntityKind = UnitKind | NodeKind | BuildingKind;

export const NODE_RESOURCE: Record<NodeKind, ResourceType> = {
  tree: 'wood',
  berry: 'food',
  gold: 'gold',
  stone: 'stone',
  carcass: 'food',
  fish: 'food',
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
  /** Neutral wildlife; absent in older layouts. */
  animals?: { kind: AnimalKind; pos: Vec2 }[];
  /** Scenery: ruins, rocks, fences, fields, houses… */
  props: PropPlacement[];
}

// ---- Entities (plain data; owned and mutated only by the sim) ----

export type UnitState =
  | 'idle'
  | 'moving'
  | 'toNode'
  | 'gathering'
  | 'toDrop'
  | 'exploring'
  | 'toTend'
  | 'tending'
  | 'toBuild'
  | 'building'
  /** Walking to a damaged completed building to repair it. */
  | 'toRepair'
  /** Restoring a completed building's hit points (paying as it goes). */
  | 'repairing'
  /** Walking into a Town Center or tower. */
  | 'toShelter'
  /** Inside a building: off the map, untargetable, until ungarrisoned. */
  | 'garrisoned'
  /** Closing on or striking a target (see Unit.target). */
  | 'attacking'
  /** Siege engine folding up to move (Unit.packTimer counts down); it cannot move or shoot. */
  | 'packing'
  /** Siege engine setting up to shoot (Unit.packTimer counts down); it cannot move or shoot. */
  | 'unpacking';

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
  /** Town Center or tower this unit is entering, or inside while garrisoned. */
  shelter?: EntityId | null;
  /** Wildlife's original home, retained through fleeing and save/load. */
  leashAnchor?: Vec2;
  tendingCorral?: EntityId;
  /** Trade carts only: the market this cart trades with (its home is the nearest own market). */
  tradeWith?: EntityId;
  /** Relic carried by a priest; dropped on death. */
  relic?: string;
  /** Transport passengers are garrisoned and travel with this ship. */
  passengers?: EntityId[];
  /** Experience earned from kills (soldiers only; absent = 0). */
  xp?: number;
  /** Veterancy: 0 Basic, 1 Advanced, 2 Elite (absent = 0). See RANKS in core/units.ts. */
  rank?: Rank;
  /** Packing siege engines (UnitSpec.packs): set up to shoot, so it cannot move (absent = packed). */
  deployed?: boolean;
  /** Seconds left of a pack or unpack under way (absent when none). */
  packTimer?: number;
  /** Group move in progress (formation id, shared speed cap, arrival facing). */
  formation?: UnitFormation;
  /** Patrol route (its first point is where the order was given) and the index of the point being walked to. */
  patrol?: PatrolRoute;
}

/** A unit's patrol: it walks `route` in a loop, `route[index]` next, fighting like attack-move. */
export interface PatrolRoute {
  route: Vec2[];
  index: number;
}

/** Veterancy rank: 0 Basic, 1 Advanced, 2 Elite. */
export type Rank = 0 | 1 | 2;

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
  /** Sim time construction finished (wonders only, M16-7: the earliest finished wonder counts). */
  completedAt?: number;
  /** Construction progress 0..1 (1 when complete). */
  buildProgress: number;
  /** Units queued for training, counting every unit of every batch (head is in progress). */
  queue: number;
  /** Kind of each queue entry (batch), head first. */
  queueKinds?: UnitKind[];
  /** Units in each queue entry, parallel to queueKinds; absent (older saves) means 1 each. */
  queueCounts?: number[];
  /** FIFO order across training and research; absent in legacy v2 saves. */
  productionQueue?: ('train' | 'research')[];
  /** Seconds of training completed on the current queue head. */
  progress: number;
  /** Legacy farm capacity metadata; completed farms produce indefinitely while staffed. */
  food?: number;
  /** Gates default to keeping livestock in; people retain owner passage. */
  livestockOpen?: boolean;
  breedProgress?: number;
  harvestProgress?: number;
  /** Where newly trained units go: a point, or an entity (a resource to gather, a building to garrison later). */
  rally?: { pos: Vec2; targetId?: EntityId };
  /** Villagers inside this shelter, in entry order. */
  occupants?: EntityId[];
  /** Seconds until the next defensive volley. */
  cooldown?: number;
  /**
   * Techs queued for research here, head first. productionQueue determines when they run.
   */
  research?: TechId[];
  /** Seconds of research completed on research[0]. */
  researchProgress?: number;
  /** In-place upgrade tier (BUILDING_UPGRADES); absent means 0. */
  tier?: number;
  /** An in-place upgrade under way to tier `to`; blocks training and research. */
  upgrading?: { to: number; progress: number };
  /**
   * Capture points per player id (index 0 = Gaia), summing to maxCapturePoints(kind) (M18-4).
   * Absent while the owner holds them all.
   */
  capture?: number[];
}

export type Entity = Unit | ResourceNode | Building;

// ---- Commands in, events out ----

export type Command =
  | { type: 'tend'; unitIds: EntityId[]; buildingId: EntityId }
  | { type: 'gateLivestock'; buildingId: EntityId; open: boolean }
  /**
   * `formation` defaults to defaultFormation(units); `facing` (radians) overrides the travel direction;
   * `width` (metres, from a right-drag) sets how wide a line or column stands.
   */
  | { type: 'move'; unitIds: EntityId[]; target: Vec2; formation?: FormationKind; facing?: number; width?: number }
  | { type: 'gather'; unitIds: EntityId[]; nodeId: EntityId }
  /** Train one unit (default: the building's first trainable kind, e.g. a villager at the TC). */
  /** Queue `count` (1..MAX_TRAIN_BATCH, default 1) units as one batch; see orderTrain. */
  | { type: 'train'; buildingId: EntityId; unit?: UnitKind; count?: number }
  /** Remove queue entry (batch) `index` (0 = the one in training) and refund its whole cost. */
  | { type: 'cancelTrain'; buildingId: EntityId; index: number }
  /** Attack a unit or building. */
  | { type: 'attack'; unitIds: EntityId[]; targetId: EntityId }
  /**
   * Capture an enemy (or neutral) building (M18-4): units with a capture attack drain its
   * capture points; the rest (siege) attack it. A building that can't be captured is attacked.
   */
  | { type: 'capture'; unitIds: EntityId[]; targetId: EntityId }
  /** Walk to a point, fighting any enemy met on the way. */
  | { type: 'attackMove'; unitIds: EntityId[]; target: Vec2; formation?: FormationKind; facing?: number; width?: number }
  /**
   * Patrol: walk from the current position through `waypoints` and back, again and again,
   * fighting like attack-move. One waypoint = back and forth. Any other unit order ends it.
   */
  | { type: 'patrol'; unitIds: EntityId[]; waypoints: Vec2[] }
  /** Follow an own or allied unit (or stay by a building) and fight whatever damages it. */
  | { type: 'guard'; unitIds: EntityId[]; targetId: EntityId }
  /** Drop current orders and stand still. */
  | { type: 'stop'; unitIds: EntityId[] }
  | { type: 'stance'; unitIds: EntityId[]; stance: Stance }
  /** Give up: all the issuer's units and buildings are removed and they are defeated. */
  | { type: 'resign' }
  /** Set a building's rally point; units it trains walk there (or gather/attack `targetId`). */
  | { type: 'rally'; buildingId: EntityId; pos: Vec2; targetId?: EntityId }
  /** Place a foundation (cost is paid now) and send the units to build it. */
  | { type: 'build'; unitIds: EntityId[]; kind: BuildingKind; pos: Vec2; rot: number }
  /** Send units to help construct an existing foundation. */
  | { type: 'construct'; unitIds: EntityId[]; buildingId: EntityId }
  /** Send workers to repair an own or allied completed building below max hp (paid as it goes). */
  | { type: 'repair'; unitIds: EntityId[]; targetId: EntityId }
  /** Cancel an unfinished foundation; refunds the cost. */
  | { type: 'cancelBuild'; buildingId: EntityId }
  /** Auto-explore: units head for the nearest reachable unexplored ground until told otherwise. */
  | { type: 'explore'; unitIds: EntityId[] }
  /** Walk villagers into a completed Town Center or tower. */
  | { type: 'garrison'; unitIds: EntityId[]; buildingId: EntityId }
  /** Send everyone inside a shelter back outside. */
  | { type: 'ungarrison'; buildingId: EntityId }
  /** Panic: every villager of the issuer runs into the nearest shelter with room. */
  | { type: 'townBell' }
  /** Place a line of wall segments from `from` to `to` (palisade or stone wall). */
  | { type: 'buildWall'; unitIds: EntityId[]; kind: BuildingKind; from: Vec2; to: Vec2 }
  /** Queue a tech (or an age) at a building; pays up front. */
  | { type: 'research'; buildingId: EntityId; tech: TechId }
  /** Remove research queue entry `index` (0 = in progress) and refund it. */
  | { type: 'cancelResearch'; buildingId: EntityId; index: number }
  /** Upgrade a complete, idle building in place to its next tier; pays up front. */
  | { type: 'upgradeBuilding'; buildingId: EntityId }
  /** Stop an in-progress building upgrade and refund it in full. */
  | { type: 'cancelUpgrade'; buildingId: EntityId }
  /** Buy or sell 100 of a resource for gold at the issuer's market prices (needs a finished market). */
  | { type: 'marketTrade'; resource: MarketResource; side: 'buy' | 'sell' }
  /** Send resources to another player; a fee is lost (see MARKET.tributeFee). Needs a finished market. */
  | { type: 'tribute'; to: PlayerId; resource: ResourceType; amount: number }
  /** Trade carts walk between their nearest own market and `marketId` (own or allied) for gold. */
  | { type: 'trade'; unitIds: EntityId[]; marketId: EntityId }
  | { type: 'heal'; unitIds: EntityId[]; targetId: EntityId }
  | { type: 'convert'; unitIds: EntityId[]; targetId: EntityId }
  | { type: 'navalTrade'; unitIds: EntityId[]; dockId: EntityId }
  | { type: 'loadTransport'; unitIds: EntityId[]; transportId: EntityId }
  | { type: 'unloadTransport'; transportId: EntityId; target: Vec2 };

/** Resources traded for gold at the market. */
export type MarketResource = Exclude<ResourceType, 'gold'>;

export type RejectReason =
  | 'insufficient-food'
  | 'insufficient-resources'
  | 'pop-cap'
  | 'unreachable'
  | 'invalid-target'
  | 'blocked-site'
  /** A farm (or similar single-worker site) already has its worker. */
  | 'occupied'
  /** Needs a later age. */
  | 'age'
  /** A prerequisite tech or building is missing. */
  | 'requires'
  /** Already researched or already queued. */
  | 'researched'
  /** The building is busy (e.g. a Town Center aging up can't queue more). */
  | 'busy'
  /** The building has no further upgrade. */
  | 'max-tier'
  /** The player already has the most of this building allowed (BuildingSpec.limit). */
  | 'limit'
  /** Outside the builder's territory, in enemy territory, or too close to another Town Center (M18-3). */
  | 'territory'
  /** A fallen hero cannot be replaced until its retrain cooldown (HERO_COOLDOWN) runs out. */
  | 'hero-cooldown';

/** Result of checking whether a building fits at a spot (World.canPlace). */
export interface PlacementCheck {
  ok: boolean;
  /** Why not, when !ok. */
  reason?: 'water' | 'slope' | 'unexplored' | 'occupied' | 'out-of-bounds' | 'insufficient-resources'
    /** Needs the builder's own territory (M18-3). */
    | 'territory'
    /** Inside another player's territory. */
    | 'enemy-territory'
    /** A Town Center too close to another one (TERRITORY.townCenterSpacing). */
    | 'town-spacing';
}

/** How a match was decided. */
export type VictoryReason = 'conquest' | 'resign' | 'wonder';

/** What a ranged attack throws: renderers pick a model per kind. */
export type ProjectileKind = 'arrow' | 'stone' | 'javelin' | 'boulder' | 'bolt';

export type SimEvent =
  | { type: 'spawned'; id: EntityId; kind: EntityKind }
  | { type: 'removed'; id: EntityId }
  | { type: 'deposited'; owner: PlayerId; pos: Vec2; resource: ResourceType; amount: number }
  | { type: 'depleted'; id: EntityId; kind: NodeKind; pos: Vec2 }
  | { type: 'stockpile'; stock: Stockpile; pop: number; popCap: number }
  /** A foundation finished construction. */
  | { type: 'constructed'; id: EntityId }
  /** An entity lost hit points (hp is the new value). */
  | { type: 'damaged'; id: EntityId; hp: number; maxHp: number; by: EntityId | null }
  /** A unit or building was destroyed (followed by 'removed'). */
  | { type: 'died'; id: EntityId; kind: EntityKind; owner: PlayerId; pos: Vec2 }
  /** A ranged attack was launched; renderers draw it flying for `flight` seconds. `by` is the shooter. */
  | { type: 'projectile'; kind: ProjectileKind; from: Vec2; to: Vec2; flight: number; targetId: EntityId; by?: EntityId }
  /** A player lost everything (or resigned). */
  | { type: 'defeated'; player: PlayerId; reason: 'conquest' | 'resign' }
  /** The game is decided: every surviving player is on the winning team (or the wonder owner's team). */
  | { type: 'gameOver'; winners: PlayerId[]; reason: VictoryReason }
  /** A finished wonder started the victory countdown (all players). */
  | { type: 'wonderStarted'; id: EntityId; owner: PlayerId; pos: Vec2; remaining: number }
  /** The counting wonder fell (or changed hands) before its countdown ran out. */
  | { type: 'wonderCancelled'; id: EntityId; owner: PlayerId; pos: Vec2 }
  /** One of `owner`'s units or buildings was hit by an enemy (for "under attack" alerts). */
  | { type: 'attacked'; owner: PlayerId; id: EntityId; pos: Vec2 }
  /** Legacy farm food metadata changed; completed farms no longer deplete. */
  | { type: 'farmFood'; id: EntityId; food: number }
  | { type: 'unitState'; id: EntityId; state: UnitState }
  | { type: 'trainProgress'; buildingId: EntityId; queue: number; progress: number; total: number }
  | { type: 'rejected'; reason: RejectReason }
  /** A building decayed away from its owner's territory and turned neutral (Gaia), M18-3. */
  | { type: 'abandoned'; id: EntityId; kind: BuildingKind; owner: PlayerId; pos: Vec2 }
  /** Research progress at a building (local player only, like trainProgress). */
  | { type: 'researchProgress'; buildingId: EntityId; tech: TechId; queue: number; progress: number; total: number }
  /** In-place building upgrade progress (local player only, like trainProgress). */
  | { type: 'upgradeProgress'; buildingId: EntityId; tier: number; progress: number; total: number }
  /** A building finished upgrading in place to `tier` (all players; consumers filter). */
  | { type: 'buildingUpgraded'; id: EntityId; owner: PlayerId; tier: number }
  /** `owner` finished researching `tech` (all players; consumers filter). */
  | { type: 'researched'; owner: PlayerId; tech: TechId }
  /** `owner` entered a new age. */
  | { type: 'agedUp'; owner: PlayerId; age: Age }
  /** `owner`'s market prices changed (gold per 100). */
  | { type: 'marketPrices'; owner: PlayerId; prices: Record<MarketResource, number> }
  /** Resources sent between players (amount is what arrived). */
  | { type: 'tribute'; from: PlayerId; to: PlayerId; resource: ResourceType; amount: number }
  /** A trade cart delivered gold at a market. */
  | { type: 'traded'; owner: PlayerId; id: EntityId; gold: number }
  /** `owner` killed or razed an enemy entity at `pos` and took `loot` (only resources > 0). */
  | { type: 'looted'; owner: PlayerId; pos: Vec2; loot: Partial<Stockpile> }
  | { type: 'treasure'; owner: PlayerId; site: string; pos: Vec2; reward: string }
  | { type: 'relic'; owner: PlayerId; site: string; templeId: EntityId }
  /** A building changed hands by capture (M18-4): `owner` took it from `previousOwner` (0 = Gaia). */
  | { type: 'captured'; id: EntityId; kind: BuildingKind; owner: PlayerId; previousOwner: PlayerId; pos: Vec2 }
  | { type: 'converted'; owner: PlayerId; id: EntityId; previousOwner: PlayerId }
  /** A soldier ranked up (and healed to full). */
  | { type: 'promoted'; id: EntityId; owner: PlayerId; rank: Rank };
