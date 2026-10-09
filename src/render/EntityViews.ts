import * as THREE from 'three';
import type { EntityId, Vec2 } from '../core/types';
import type { World } from '../sim/World';

/** Screen-space rectangle in CSS pixels relative to the canvas. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Visuals for every sim entity: Y-axis billboard sprites (instanced where possible),
 * the Town Center mesh, selection rings and the move marker. Subscribes to world.events
 * for spawned/removed. Owned by the Render lane (T4).
 * Public surface FROZEN: constructor, object, sync, pick, idsInRect, setSelected, flashMarker.
 *
 * STUB: draws nothing; picking returns nothing.
 */
export class EntityViews {
  readonly object = new THREE.Group();

  constructor(readonly world: World) {}

  /** Update visuals. `alpha` ∈ [0,1] interpolates unit prevPos → pos; `time` in seconds. */
  sync(_alpha: number, _time: number, _camera: THREE.Camera): void {}

  /** Entity under a normalised-device-coordinate point, or null. Units win over nodes. */
  pick(_ndc: THREE.Vector2, _camera: THREE.Camera): EntityId | null {
    return null;
  }

  /** Units whose screen position falls inside `rect` (canvas CSS pixels). */
  idsInRect(_rect: ScreenRect, _camera: THREE.Camera, _viewport: { width: number; height: number }): EntityId[] {
    return [];
  }

  setSelected(_ids: ReadonlySet<EntityId>): void {}

  /** Show the move-order marker at a ground position. */
  flashMarker(_p: Vec2): void {}
}
