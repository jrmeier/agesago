import { footprintRadius } from '../core/buildings';
import type { BuildingKind, EntityId, PlayerId, Vec2 } from '../core/types';
import { EXPLORED, VISIBLE } from '../sim/visibility';

/** What the local player currently knows about a cell. */
export type Sight = 'unexplored' | 'explored' | 'visible';

/**
 * Enemy building as last seen. Deliberately has no construction progress, queue,
 * farm food, or garrison — those would leak what changed out of sight.
 */
export interface LastSeenBuilding {
  id: EntityId;
  kind: BuildingKind;
  owner: PlayerId;
  pos: Vec2;
  rot: number;
  hp: number;
  maxHp: number;
  complete: boolean;
}

export function sightFromState(state: number): Sight {
  if (state === VISIBLE) return 'visible';
  if (state === EXPLORED) return 'explored';
  return 'unexplored';
}

/** Copy only the fields a snapshot is allowed to remember. `pos` is not aliased. */
export function rememberBuilding(building: LastSeenBuilding): LastSeenBuilding {
  return {
    id: building.id,
    kind: building.kind,
    owner: building.owner,
    pos: { x: building.pos.x, z: building.pos.z },
    rot: building.rot,
    hp: building.hp,
    maxHp: building.maxHp,
    complete: building.complete,
  };
}

/**
 * Enemy units may be drawn, picked, and attacked only while their cell is visible.
 * Own units always may.
 */
export function unitMayShow(ownerIsLocal: boolean, sight: Sight): boolean {
  return ownerIsLocal || sight === 'visible';
}

/**
 * How to draw a building. Enemy buildings that are only remembered use `snapshot`
 * (frozen mesh). They are not a live target — see {@link buildingMayTarget}.
 */
export function buildingPresentation(args: {
  ownerIsLocal: boolean;
  sight: Sight;
  /** False before fog is attached: own buildings stay visible on the shroudless map. */
  fogActive: boolean;
  snap: LastSeenBuilding | undefined;
}): 'live' | 'snapshot' | 'hidden' {
  if (args.ownerIsLocal) {
    if (!args.fogActive || args.sight !== 'unexplored') return 'live';
    return 'hidden';
  }
  if (args.sight === 'visible') return 'live';
  if (args.sight === 'explored' && args.snap) return 'snapshot';
  return 'hidden';
}

/** Own buildings are targets once fog would draw them. An enemy ghost is not, until it is visible again. */
export function buildingMayTarget(ownerIsLocal: boolean, sight: Sight, fogActive: boolean): boolean {
  return buildingPresentation({ ownerIsLocal, sight, fogActive, snap: undefined }) === 'live';
}

export interface LastSeenStep {
  snaps: Map<EntityId, LastSeenBuilding>;
  /** Snapshots dropped because the cell is visible and the building is gone. */
  confirmedGone: LastSeenBuilding[];
}

/**
 * Refresh memory of enemy buildings.
 * Visible: replace the snapshot from the live building (allowed fields only).
 * Explored: keep the previous snapshot and do not read live hp, completion, or pose.
 * Visible and missing: drop it so the site can show rubble or empty ground.
 * Own buildings are not remembered.
 */
export function stepLastSeen(
  prev: ReadonlyMap<EntityId, LastSeenBuilding>,
  buildings: Iterable<LastSeenBuilding>,
  localPlayer: PlayerId,
  sightAt: (x: number, z: number) => Sight,
): LastSeenStep {
  const snaps = new Map(prev);
  const alive = new Set<EntityId>();
  for (const building of buildings) {
    if (building.owner === localPlayer) {
      snaps.delete(building.id);
      continue;
    }
    alive.add(building.id);
    if (sightAt(building.pos.x, building.pos.z) === 'visible') snaps.set(building.id, rememberBuilding(building));
  }
  const confirmedGone: LastSeenBuilding[] = [];
  for (const [id, snap] of snaps) {
    if (alive.has(id)) continue;
    if (sightAt(snap.pos.x, snap.pos.z) !== 'visible') continue;
    snaps.delete(id);
    confirmedGone.push(snap);
  }
  return { snaps, confirmedGone };
}

export interface BuildingBlip {
  id: EntityId;
  owner: PlayerId;
  x: number;
  z: number;
  radius: number;
}

/**
 * Minimap buildings: the local player's live footprints, plus enemy snapshots
 * (including a building that died in fog). Never-seen enemy buildings are omitted.
 */
export function minimapBuildingBlips(
  localPlayer: PlayerId,
  buildings: Iterable<{ id: EntityId; owner: PlayerId; pos: Vec2; radius: number }>,
  snaps: ReadonlyMap<EntityId, LastSeenBuilding>,
): BuildingBlip[] {
  const enemy: BuildingBlip[] = [];
  const own: BuildingBlip[] = [];
  for (const building of buildings) {
    if (building.owner !== localPlayer) continue;
    own.push({
      id: building.id,
      owner: building.owner,
      x: building.pos.x,
      z: building.pos.z,
      radius: building.radius,
    });
  }
  for (const snap of snaps.values()) {
    if (snap.owner === localPlayer) continue;
    enemy.push({
      id: snap.id,
      owner: snap.owner,
      x: snap.pos.x,
      z: snap.pos.z,
      radius: footprintRadius(snap.kind),
    });
  }
  return enemy.concat(own);
}

export interface ShownSelection {
  unitIds: EntityId[];
  /** Own building, or an enemy building whose cell is visible right now. */
  liveBuildingId: EntityId | null;
  /** Fogged enemy building to describe from memory. Never the live record. */
  remembered: LastSeenBuilding | null;
}

/**
 * What the selection panel may read. Hidden enemy units are dropped.
 * A fogged enemy building contributes its snapshot, not the live entity.
 */
export function shownSelection(
  ids: Iterable<EntityId>,
  localPlayer: PlayerId,
  unitAt: (id: EntityId) => { owner: PlayerId; pos: Vec2 } | undefined,
  buildingAt: (id: EntityId) => { owner: PlayerId; pos: Vec2 } | undefined,
  snaps: ReadonlyMap<EntityId, LastSeenBuilding>,
  sightAt: (x: number, z: number) => Sight,
): ShownSelection {
  const unitIds: EntityId[] = [];
  let liveBuildingId: EntityId | null = null;
  let remembered: LastSeenBuilding | null = null;
  for (const id of ids) {
    const unit = unitAt(id);
    if (unit) {
      if (unitMayShow(unit.owner === localPlayer, sightAt(unit.pos.x, unit.pos.z))) unitIds.push(id);
      continue;
    }
    if (liveBuildingId !== null || remembered) continue;
    const building = buildingAt(id);
    const snap = snaps.get(id);
    if (building && (building.owner === localPlayer || sightAt(building.pos.x, building.pos.z) === 'visible')) {
      liveBuildingId = id;
      continue;
    }
    if (snap && sightAt(snap.pos.x, snap.pos.z) === 'explored') remembered = snap;
  }
  if (unitIds.length) return { unitIds, liveBuildingId: null, remembered: null };
  return { unitIds, liveBuildingId, remembered: liveBuildingId === null ? remembered : null };
}
