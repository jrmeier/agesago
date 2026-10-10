import { BUILDINGS, footprint } from '../../core/buildings';
import type { Building, BuildingKind, ResourceNode, ResourceType, Unit, Vec2, PlayerId } from '../../core/types';
import { BALANCE } from '../balance';
import { NAV_CELL, rectApproach, rectDistance, type Rect } from '../nav';
import type { World } from '../World';
import { closedGates, route } from './passage';

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

/** Fish are worked from the closest reachable shore cell to the node. */
export function nodeApproach(world: World, from: Vec2, node: ResourceNode): Vec2 | null {
  if (node.kind !== 'fish') return world.approachPoint(from, node.pos, node.radius);
  if (!world.hf.isWater(node.pos.x, node.pos.z)) return null;
  return world.nav.nearestFreeCell(node.pos, world.nav.regionAt(from), (p) =>
    world.nav.isFree(p) && [[-NAV_CELL, 0], [NAV_CELL, 0], [0, -NAV_CELL], [0, NAV_CELL]]
      .some(([dx, dz]) => world.hf.isWater(p.x + dx, p.z + dz)));
}

export function nodeInReach(world: World, u: Unit, node: ResourceNode): boolean {
  return world.nav.withMask(closedGates(world, u.owner), () => nodePointInReach(world, u.pos, node));
}

function nodePointInReach(world: World, pos: Vec2, node: ResourceNode): boolean {
  const spot = node.kind === 'fish' ? nodeApproach(world, pos, node) : node.pos;
  if (!spot) return false;
  const reach = node.kind === 'fish' ? BALANCE.reach + BALANCE.villagerRadius
    : node.radius + BALANCE.villagerRadius + BALANCE.reach;
  return world.nav.isFree(pos) && Math.hypot(pos.x - spot.x, pos.z - spot.z) <= reach;
}

/**
 * Route to a work spot, never to an arbitrary nav snap outside resource reach.
 * Try the facing edge's route first; invalid routes fall back to nearby cell centres.
 * The local search and endpoint checks use the same enemy-gate mask as the path itself.
 */
export function nodePath(world: World, u: Unit, node: ResourceNode): Vec2[] | null {
  return world.nav.withMask(closedGates(world, u.owner), () => {
    const preferred = nodeApproach(world, u.pos, node);
    const toSpot = (spot: Vec2): Vec2[] | null => {
      const path = world.nav.findPath(u.pos, spot);
      return path && nodePointInReach(world, path.at(-1) ?? u.pos, node) ? path : null;
    };
    // Fishing deliberately reaches a shore rather than the fish's own radius.
    if (node.kind === 'fish') return preferred && toSpot(preferred);

    const reg = world.nav.regionAt(u.pos);
    const usable = (p: Vec2) => world.nav.isFree(p) && world.nav.isWalkableCell(p)
      && world.nav.regionOfCell(p) === reg;
    // A free edge can sit in a blocked grid cell. Let the navigator use its nearby
    // cell and append that exact edge, then validate the actual endpoint.
    if (preferred) {
      const path = toSpot(preferred);
      if (path) return path;
    }

    const reach = node.radius + BALANCE.villagerRadius + BALANCE.reach;
    const spots: Vec2[] = [];
    const x0 = Math.max(0, Math.floor((node.pos.x - reach) / NAV_CELL));
    const x1 = Math.min(world.nav.cols - 1, Math.floor((node.pos.x + reach) / NAV_CELL));
    const z0 = Math.max(0, Math.floor((node.pos.z - reach) / NAV_CELL));
    const z1 = Math.min(world.nav.rows - 1, Math.floor((node.pos.z + reach) / NAV_CELL));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const p = { x: (x + 0.5) * NAV_CELL, z: (z + 0.5) * NAV_CELL };
        if (Math.hypot(p.x - node.pos.x, p.z - node.pos.z) <= reach && usable(p)) spots.push(p);
      }
    }
    spots.sort((a, b) => Math.hypot(a.x - u.pos.x, a.z - u.pos.z) - Math.hypot(b.x - u.pos.x, b.z - u.pos.z));
    for (const spot of spots) {
      const path = toSpot(spot);
      if (path) return path;
    }
    return null;
  });
}

/**
 * Complete building accepting `type` with the shortest walk from `from`, and that path. Candidates
 * are tried nearest-first by straight-line distance to the footprint, which is a lower bound on
 * the walk, so the search stops once no remaining site could beat the best path found (usually
 * after one A*; more only when, say, the nearest camp is across a river). Null if none is reachable.
 */
export function nearestDrop(world: World, from: Vec2, type: ResourceType, owner: PlayerId): { b: Building; path: Vec2[] } | null {
  const cands: { b: Building; d: number }[] = [];
  for (const b of world.buildings.values()) {
    if (b.complete && b.owner === owner && BUILDINGS[b.kind].drop.includes(type)) cands.push({ b, d: rectDistance(from, buildingRect(b)) });
  }
  cands.sort((a, c) => a.d - c.d);
  let best: { b: Building; path: Vec2[]; len: number } | null = null;
  for (const { b, d } of cands) {
    if (best && d >= best.len) break;
    const path = route(world, owner, from, siteApproach(from, b));
    if (!path) continue;
    const len = pathLength(from, path);
    if (!best || len < best.len) best = { b, path, len };
  }
  return best && { b: best.b, path: best.path };
}

/** Walking distance along `path` starting at `from`. */
function pathLength(from: Vec2, path: Vec2[]): number {
  let len = 0;
  let p = from;
  for (const q of path) {
    len += Math.hypot(q.x - p.x, q.z - p.z);
    p = q;
  }
  return len;
}
