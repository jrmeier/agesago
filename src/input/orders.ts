import type { Building, Command, EntityId, PlayerId, Vec2 } from '../core/types';

/** What lies under a right-click / tap, already resolved against the scene and the fog. */
export interface OrderTarget {
  /** Resource node under the pointer, if any. */
  nodeId: EntityId | null;
  /** Whether that node stands on explored ground (nodes in the black can't be targeted). */
  nodeExplored: boolean;
  /** Ground point under the pointer, or null if the ray missed the map. */
  ground: Vec2 | null;
}

/**
 * Order for the selection: gather from an explored node (the sim turns that into a move for
 * scouts), otherwise move to the ground point — unexplored ground is a valid destination.
 */
export function resolveOrder(unitIds: readonly EntityId[], t: OrderTarget): Command | null {
  if (!unitIds.length) return null;
  if (t.nodeId !== null && t.nodeExplored) return { type: 'gather', unitIds: [...unitIds], nodeId: t.nodeId };
  if (!t.ground) return null;
  return { type: 'move', unitIds: [...unitIds], target: { ...t.ground } };
}

/** A unit or building under the pointer, as far as targeting cares. */
export interface HitEntity {
  id: EntityId;
  owner: PlayerId;
  pos: Vec2;
  /** The local player can currently see it (fogged enemies can't be targeted). */
  visible: boolean;
}

/**
 * Orders that depend on who owns the thing under the pointer:
 * - own units selected + a visible enemy unit / building → 'attack';
 * - no own units, but an own building that can train is selected → 'rally' to the entity
 *   (gather / follow it: `targetId`) or the ground point.
 * Anything else → null, and the caller falls back to resolveBuildingOrder / resolveOrder.
 */
export function resolveTargetOrder(
  sel: { unitIds: readonly EntityId[]; rallyBuildingId: EntityId | null },
  hit: HitEntity | null,
  ground: Vec2 | null,
  isEnemy: (owner: PlayerId) => boolean
): Command | null {
  if (sel.unitIds.length) {
    if (hit && hit.visible && isEnemy(hit.owner)) return { type: 'attack', unitIds: [...sel.unitIds], targetId: hit.id };
    return null;
  }
  if (sel.rallyBuildingId === null) return null;
  if (hit && hit.id !== sel.rallyBuildingId) {
    return { type: 'rally', buildingId: sel.rallyBuildingId, pos: { ...hit.pos }, targetId: hit.id };
  }
  if (!ground) return null;
  return { type: 'rally', buildingId: sel.rallyBuildingId, pos: { ...ground } };
}

/** Attack-move for the selection to a ground point (null with nothing to send or nowhere to go). */
export function resolveAttackMove(
  unitIds: readonly EntityId[],
  ground: Vec2 | null
): Extract<Command, { type: 'attackMove' }> | null {
  if (!unitIds.length || !ground) return null;
  return { type: 'attackMove', unitIds: [...unitIds], target: { ...ground } };
}

/** The parts of a building that decide what villagers do when ordered onto it. */
export type OrderBuilding = Pick<Building, 'id' | 'kind' | 'complete' | 'food'>;

/**
 * Villager order onto a building: a foundation → help construct it; a complete farm with
 * food → work it (a 'gather' whose nodeId is the farm); an exhausted farm → 'construct'
 * (reseed). Anything else (e.g. a finished house) is not a building order → null, and the
 * caller falls back to selecting it or a plain move.
 */
export function resolveBuildingOrder(villagerIds: readonly EntityId[], b: OrderBuilding): Command | null {
  if (!villagerIds.length) return null;
  const unitIds = [...villagerIds];
  if (!b.complete) return { type: 'construct', unitIds, buildingId: b.id };
  if (b.kind !== 'farm') return null;
  if (b.food === undefined || b.food > 0) return { type: 'gather', unitIds, nodeId: b.id };
  return { type: 'construct', unitIds, buildingId: b.id };
}
