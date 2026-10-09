import type { Building, Command, EntityId, Vec2 } from '../core/types';

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
