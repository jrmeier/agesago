import { BUILDINGS, footprint } from '../../core/buildings';
import type { Building, BuildingKind, ResourceType, Unit, Vec2, PlayerId } from '../../core/types';
import { BALANCE } from '../balance';
import { rectApproach, rectDistance, type Rect } from '../nav';
import type { World } from '../World';

/** Snap a yaw to the nearest 90° step, in [0, 2π). */
export function snapRot(rot: number): number {
  const q = ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4;
  return (q * Math.PI) / 2;
}

/** World-space footprint of a `kind` building centred at `pos` with yaw `rot`. */
export function footprintRect(kind: BuildingKind, pos: Vec2, rot: number): Rect {
  const { hw, hd } = footprint(kind, rot);
  return { x0: pos.x - hw, z0: pos.z - hd, x1: pos.x + hw, z1: pos.z + hd };
}

export function buildingRect(b: Building): Rect {
  return footprintRect(b.kind, b.pos, b.rot);
}

/** `u` stands close enough to the footprint edge to work on / deposit at `b`. */
export function inReach(u: Unit, b: Building): boolean {
  return rectDistance(u.pos, buildingRect(b)) <= BALANCE.villagerRadius + BALANCE.reach;
}

/** Where a unit coming from `from` should stand to reach `b`: just outside the nearest footprint edge. */
export function siteApproach(from: Vec2, b: Building): Vec2 {
  return rectApproach(from, buildingRect(b), BALANCE.villagerRadius + BALANCE.approachGap);
}

/**
 * Nearest complete building accepting `type`, with a path to it from `from`. Ranked by
 * straight-line distance to the footprint (a cheap stand-in for path length; the TC and a
 * handful of camps make this a short loop). Null if none is reachable.
 */
export function nearestDrop(world: World, from: Vec2, type: ResourceType, owner: PlayerId): { b: Building; path: Vec2[] } | null {
  const cands: { b: Building; d: number }[] = [];
  for (const b of world.buildings.values()) {
    if (b.complete && b.owner === owner && BUILDINGS[b.kind].drop.includes(type)) cands.push({ b, d: rectDistance(from, buildingRect(b)) });
  }
  cands.sort((a, c) => a.d - c.d);
  for (const { b } of cands) {
    const path = world.nav.findPath(from, siteApproach(from, b));
    if (path) return { b, path };
  }
  return null;
}
