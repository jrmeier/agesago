import { BUILDINGS, footprint } from '../core/buildings';
import type { BuildingKind, PlayerId, Vec2 } from '../core/types';
import type { World } from '../sim/World';
import type { Intel } from './intel';

export interface SpotQuery {
  kind: BuildingKind;
  center: Vec2;
  minR: number;
  maxR: number;
  /** Cells every footprint cell must keep from resource nodes (at least 1: no node inside). */
  clearOfNodes: number;
  /** Free ground kept around non-walkable buildings so units can walk between them. */
  gap: number;
  /** Prefer spots in this direction from `center` (unit vector), weighted by `bias` (world units). */
  toward?: Vec2;
  bias?: number;
  /** Nav region the builders are in (NavGrid.regionAt); the spot must lie in it. */
  region?: number;
  /** Stop after this many full canPlace checks. */
  maxChecks?: number;
}

interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  walkable: boolean;
}

/**
 * Find a legal spot for a building near `center`, ring by ring. Cheap filters (bounds,
 * explored, distance to resources, spacing from other buildings) run first; World.canPlace has
 * the final say, so the AI only ever issues placements a human could. Footprints are square,
 * so rotation is always 0. Null if nothing fits.
 */
export function findSpot(world: World, intel: Intel, player: PlayerId, q: SpotQuery): Vec2 | null {
  const { hw, hd } = footprint(q.kind, 0);
  const walkable = BUILDINGS[q.kind].walkable;
  const boxes: Box[] = [];
  for (const b of world.buildings.values()) {
    const f = footprint(b.kind, b.rot);
    boxes.push({ x0: b.pos.x - f.hw, z0: b.pos.z - f.hd, x1: b.pos.x + f.hw, z1: b.pos.z + f.hd, walkable: BUILDINGS[b.kind].walkable });
  }
  const cands: { p: Vec2; s: number }[] = [];
  const seen = new Set<number>();
  for (let r = q.minR; r <= q.maxR; r += 1) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 1.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = { x: Math.round((q.center.x + Math.cos(a) * r) * 2) / 2, z: Math.round((q.center.z + Math.sin(a) * r) * 2) / 2 };
      const key = p.x * 1000 + p.z;
      if (seen.has(key)) continue;
      seen.add(key);
      let s = r;
      if (q.toward && q.bias) s += q.bias * (1 - (Math.cos(a) * q.toward.x + Math.sin(a) * q.toward.z)) * 0.5;
      cands.push({ p, s });
    }
  }
  cands.sort((a, b) => a.s - b.s);
  const W = world.hf.width;
  const D = world.hf.depth;
  let checks = q.maxChecks ?? 12;
  for (const { p } of cands) {
    const x0 = p.x - hw;
    const x1 = p.x + hw;
    const z0 = p.z - hd;
    const z1 = p.z + hd;
    if (x0 < 0.5 || z0 < 0.5 || x1 > W - 0.5 || z1 > D - 0.5) continue;
    if (!intel.knows(p.x, p.z) || !intel.knows(x0, z0) || !intel.knows(x1, z1) || !intel.knows(x0, z1) || !intel.knows(x1, z0)) continue;
    if (!world.hf.isWalkable(p.x, p.z)) continue;
    // No resource node in (or within clearOfNodes cells of) any cell the footprint covers.
    const c = Math.max(1, q.clearOfNodes);
    let nodes = false;
    for (let z = Math.floor(z0); z < z1 && !nodes; z++) {
      for (let x = Math.floor(x0); x < x1; x++) {
        if (intel.nodeDistAt(x, z) < c) {
          nodes = true;
          break;
        }
      }
    }
    if (nodes) continue;
    let clash = false;
    for (const b of boxes) {
      const g = walkable && b.walkable ? 0 : q.gap;
      if (x0 < b.x1 + g && b.x0 - g < x1 && z0 < b.z1 + g && b.z0 - g < z1) {
        clash = true;
        break;
      }
    }
    if (clash) continue;
    // Builders must be able to walk there (not across a river with no ford).
    if (q.region && world.nav.regionOfCell(p) !== q.region) continue;
    if (!world.canPlace(q.kind, p, 0, player).ok) {
      if (--checks <= 0) return null;
      continue;
    }
    return p;
  }
  return null;
}
