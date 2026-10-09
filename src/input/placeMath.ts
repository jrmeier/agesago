import { footprint } from '../core/buildings';
import type { BuildingKind, Vec2 } from '../core/types';

/** Placement grid step in world units. */
export const PLACE_GRID = 0.5;
const QUARTER = Math.PI / 2;

/** Snap a ground point to the placement grid. */
export function snapToGrid(p: Vec2, step = PLACE_GRID): Vec2 {
  return { x: Math.round(p.x / step) * step, z: Math.round(p.z / step) * step };
}

/** Rotate by one quarter turn in the direction of `dir`'s sign, normalised to [0, 2π). */
export function rotateQuarter(rot: number, dir = 1): number {
  const q = (((Math.round(rot / QUARTER) + Math.sign(dir)) % 4) + 4) % 4;
  return q * QUARTER;
}

/**
 * Keep a footprint's centre inside the map so the ghost never hangs off the edge
 * (out-of-bounds is still reported by canPlace, but the ghost stays visible).
 */
export function clampToMap(kind: BuildingKind, p: Vec2, rot: number, width: number, depth: number): Vec2 {
  const { hw, hd } = footprint(kind, rot);
  return {
    x: Math.min(width - hw, Math.max(hw, p.x)),
    z: Math.min(depth - hd, Math.max(hd, p.z)),
  };
}

/** Ghost position for a ground point: clamped into the map, then snapped. */
export function placementPos(kind: BuildingKind, ground: Vec2, rot: number, width: number, depth: number): Vec2 {
  return snapToGrid(clampToMap(kind, ground, rot, width, depth));
}
