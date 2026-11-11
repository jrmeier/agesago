import type { Building, EntityId, PlayerId, Unit, Vec2 } from '../core/types';

/** What a ground line shows: a walk in progress, a patrol loop, a guard link, or patrol points being chosen. */
export type RouteKind = 'move' | 'patrol' | 'guard' | 'pending';

/** One polyline on the ground, first point first. */
export interface OrderRoute {
  kind: RouteKind;
  points: Vec2[];
}

/** The parts of the world the routes are read from (no three, no DOM: testable). */
export interface RouteSource {
  units: ReadonlyMap<EntityId, Unit>;
  buildings: ReadonlyMap<EntityId, Building>;
  combatState: ReadonlyMap<EntityId, { order?: string | null; guard?: EntityId }>;
  localPlayer: PlayerId;
}

/** Most selected units that get a line, so a 200-unit selection stays cheap and legible. */
export const MAX_ROUTE_UNITS = 24;

/**
 * Ground lines for the selected own units: a patrolling unit's whole loop (from where it stands, round
 * through every point and back), a guard's link to what it guards, otherwise the rest of its path.
 * Enemy, dead and garrisoned units get none.
 */
export function orderRoutes(src: RouteSource, selected: Iterable<EntityId>, max = MAX_ROUTE_UNITS): OrderRoute[] {
  const out: OrderRoute[] = [];
  for (const id of selected) {
    if (out.length >= max) break;
    const u = src.units.get(id);
    if (!u || u.owner !== src.localPlayer || u.hp <= 0 || u.state === 'garrisoned') continue;
    const from = { x: u.pos.x, z: u.pos.z };
    if (u.patrol && u.patrol.route.length) {
      const { route, index } = u.patrol;
      const loop = [from];
      for (let k = 0; k <= route.length; k++) loop.push({ ...route[(index + k) % route.length] });
      out.push({ kind: 'patrol', points: loop });
      continue;
    }
    const cs = src.combatState.get(id);
    if (cs?.order === 'guard' && cs.guard !== undefined) {
      const t = src.units.get(cs.guard) ?? src.buildings.get(cs.guard);
      if (t) out.push({ kind: 'guard', points: [from, { x: t.pos.x, z: t.pos.z }] });
      continue;
    }
    if (u.path.length) out.push({ kind: 'move', points: [from, ...u.path.map((p) => ({ x: p.x, z: p.z }))] });
  }
  return out;
}

/** Points along `points` no more than `step` apart, so a line drawn through them can hug the terrain. */
export function subdivide(points: readonly Vec2[], step: number): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out: Vec2[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}
