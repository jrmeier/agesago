import type { Command, EntityId, Vec2 } from '../core/types';

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
