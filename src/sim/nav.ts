import type { Heightfield, Vec2 } from '../core/types';

/** A circular obstacle (building footprint) that paths must avoid. */
export interface Obstacle {
  pos: Vec2;
  radius: number;
}

/**
 * Grid A* over Heightfield.isWalkable plus obstacle footprints.
 * Owned by the Sim lane (T3). Pure TS — no three.js.
 *
 * STUB: straight line.
 */
export class NavGrid {
  constructor(
    readonly hf: Heightfield,
    readonly obstacles: Obstacle[] = []
  ) {}

  /** Waypoints from `from` to `to` (excluding `from`), or null if unreachable. */
  findPath(_from: Vec2, to: Vec2): Vec2[] | null {
    return [to];
  }
}
