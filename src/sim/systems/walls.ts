import { BUILDINGS } from '../../core/buildings';
import type { BuildingKind, Vec2 } from '../../core/types';

/** Snap a coordinate onto the 0.5 placement grid. */
function snap(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Wall segments along a drag. The line locks to the longer axis (walls are axis-aligned,
 * same 90° yaw as every other footprint). Segments tile edge to edge by `size.w`.
 * A short drag is one segment at the start; a longer drag includes both ends.
 */
export function wallSegments(kind: BuildingKind, from: Vec2, to: Vec2): { pos: Vec2; rot: number }[] {
  const step = BUILDINGS[kind].size.w;
  const a = { x: snap(from.x), z: snap(from.z) };
  const dx = snap(to.x) - a.x;
  const dz = snap(to.z) - a.z;
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  const rot = horizontal ? 0 : Math.PI / 2;
  const span = Math.abs(horizontal ? dx : dz);
  const sign = (horizontal ? dx : dz) < 0 ? -1 : 1;
  const n = span < step * 0.5 ? 1 : Math.round(span / step) + 1;
  const out: { pos: Vec2; rot: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * step * sign;
    out.push({ pos: horizontal ? { x: a.x + t, z: a.z } : { x: a.x, z: a.z + t }, rot });
  }
  return out;
}
