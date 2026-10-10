import { BUILDINGS, footprint } from '../../core/buildings';
import { isShip } from '../../core/units';
import type { Building, PlayerId, Unit, Vec2 } from '../../core/types';
import type { Rect } from '../nav';
import type { World } from '../World';

function rectOf(b: Building): Rect {
  const { hw, hd } = footprint(b.kind, b.rot);
  return { x0: b.pos.x - hw, z0: b.pos.z - hd, x1: b.pos.x + hw, z1: b.pos.z + hd };
}

/** Finished gates this player may not walk through. */
export function closedGates(world: World, owner: PlayerId): Rect[] {
  const out: Rect[] = [];
  for (const b of world.buildings.values()) {
    const spec = BUILDINGS[b.kind];
    if (!spec.gate || !b.complete || b.owner === owner) continue;
    out.push(rectOf(b));
  }
  return out;
}

/** Path for `owner`: the shared grid, plus every other player's finished gates blocked. */
export function route(world: World, owner: PlayerId, from: Vec2, to: Vec2, greed = 1): Vec2[] | null {
  const gates = closedGates(world, owner);
  if (!gates.length) return world.nav.findPath(from, to, greed);
  return world.nav.withMask(gates, () => world.nav.findPath(from, to, greed));
}

/** Select the navigation medium for this unit. */
export function navFor(world: World, unit: Unit) { return isShip(unit.kind) ? world.waterNav : world.nav; }
export function routeForUnit(world: World, unit: Unit, to: Vec2, greed = 1): Vec2[] | null {
  if (!isShip(unit.kind)) return route(world, unit.owner, unit.pos, to, greed);
  const end = world.waterNav.nearestFree(to);
  return end ? world.waterNav.findPath(unit.pos, end, greed) : null;
}
