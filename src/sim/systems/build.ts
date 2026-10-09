import { BUILDINGS, FARM_FOOD, footprintRadius } from '../../core/buildings';
import type {
  Building,
  BuildingKind,
  EntityId,
  PlacementCheck,
  RejectReason,
  ResourceNode,
  ResourceType,
  Stockpile,
  Unit,
  Vec2,
} from '../../core/types';
import { BALANCE } from '../balance';
import { rectApproach, rectDistance, type Rect } from '../nav';
import type { World } from '../World';
import { cancelExplore, settleCancelled } from './explore';
import { isWorkableFarm, nearestSources, orderFarm, sendToFarm, sendToSource } from './gather';
import { buildingRect, footprintRect, inReach, snapRot } from './sites';

const reject = (world: World, reason: RejectReason) => world.events.emit({ type: 'rejected', reason });

function affordable(world: World, cost: Partial<Stockpile>): boolean {
  for (const [r, n] of Object.entries(cost) as [ResourceType, number][]) if (world.stock[r] < n) return false;
  return true;
}

function pay(world: World, cost: Partial<Stockpile>, sign: 1 | -1): void {
  for (const [r, n] of Object.entries(cost) as [ResourceType, number][]) world.stock[r] -= sign * n;
}

/** Footprints overlap by more than a hair (buildings may touch edge to edge). */
function overlaps(a: Rect, b: Rect): boolean {
  const e = 1e-6;
  return a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.z0 < b.z1 - e && b.z0 < a.z1 - e;
}

/** A disc of radius `r` at `p` cuts into the rectangle. */
function discHits(p: Vec2, r: number, rect: Rect): boolean {
  if (p.x + r <= rect.x0 || p.x - r >= rect.x1 || p.z + r <= rect.z0 || p.z - r >= rect.z1) return false;
  return rectDistance(p, rect) < r;
}

/**
 * Placement rules (World.canPlace). The footprint (rot snapped to 90°) must lie inside the map;
 * terrain is sampled every ~BALANCE.placementSample over it and every sample must be explored,
 * dry and walkable (not too steep); it may not overlap another building or foundation, a
 * resource node or blocking scenery; and the stockpile must cover the cost. Units never block
 * placement: on a non-walkable footprint they are nudged to its edge when the foundation is laid.
 * Unexplored ground is reported before water/slope so the check leaks nothing about hidden terrain.
 */
export function canPlace(world: World, kind: BuildingKind, pos: Vec2, rot: number): PlacementCheck {
  const r = footprintRect(kind, pos, snapRot(rot));
  const hf = world.hf;
  if (!(r.x0 >= 0 && r.z0 >= 0 && r.x1 <= hf.width && r.z1 <= hf.depth)) return { ok: false, reason: 'out-of-bounds' };

  const step = BALANCE.placementSample;
  const e = 1e-3; // keep edge samples inside the footprint's own cells
  const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / step));
  const nz = Math.max(1, Math.ceil((r.z1 - r.z0) / step));
  const vis = world.visibility;
  let water = false;
  let slope = false;
  for (let j = 0; j <= nz; j++) {
    const z = r.z0 + e + ((r.z1 - r.z0 - 2 * e) * j) / nz;
    for (let i = 0; i <= nx; i++) {
      const x = r.x0 + e + ((r.x1 - r.x0 - 2 * e) * i) / nx;
      if (!vis.isExplored(x, z)) return { ok: false, reason: 'unexplored' };
      if (water || slope) continue;
      if (hf.isWater(x, z)) water = true;
      else if (!hf.isWalkable(x, z)) slope = true;
    }
  }
  if (water) return { ok: false, reason: 'water' };
  if (slope) return { ok: false, reason: 'slope' };

  for (const b of world.buildings.values()) if (overlaps(r, buildingRect(b))) return { ok: false, reason: 'occupied' };
  for (const n of world.nodes.values()) if (discHits(n.pos, n.radius, r)) return { ok: false, reason: 'occupied' };
  for (const o of world.nav.obstacles) if (discHits(o.pos, o.radius, r)) return { ok: false, reason: 'occupied' };

  if (!affordable(world, BUILDINGS[kind].cost)) return { ok: false, reason: 'insufficient-resources' };
  return { ok: true };
}

/** 'build' command: validate, pay, lay the foundation and send the villagers to build it. */
export function orderBuild(world: World, unitIds: EntityId[], kind: BuildingKind, pos: Vec2, rot: number): void {
  if (!BUILDINGS[kind].buildable) {
    reject(world, 'invalid-target');
    return;
  }
  const check = canPlace(world, kind, pos, rot);
  if (!check.ok) {
    reject(world, check.reason === 'insufficient-resources' ? 'insufficient-resources' : 'blocked-site');
    return;
  }
  pay(world, BUILDINGS[kind].cost, 1);
  const b = layFoundation(world, kind, pos, snapRot(rot));
  world.emitStock();
  sendBuilders(world, unitIds, b);
}

/** Create an unfinished building and emit 'spawned'; non-walkable footprints block nav at once. */
export function layFoundation(world: World, kind: BuildingKind, pos: Vec2, rot: number): Building {
  const b: Building = {
    id: world.allocId(),
    kind,
    pos: { x: pos.x, z: pos.z },
    rot,
    radius: footprintRadius(kind),
    complete: false,
    buildProgress: 0,
    queue: 0,
    progress: 0,
  };
  world.buildings.set(b.id, b);
  if (!BUILDINGS[kind].walkable) blockFootprint(world, b);
  world.events.emit({ type: 'spawned', id: b.id, kind });
  return b;
}

/** Make `b` a nav obstacle, push units off it and re-route paths that now cross it. */
export function blockFootprint(world: World, b: Building): void {
  const rect = buildingRect(b);
  world.nav.addRect(b.id, rect);
  const m = BALANCE.villagerRadius;
  const grown: Rect = { x0: rect.x0 - m, z0: rect.z0 - m, x1: rect.x1 + m, z1: rect.z1 + m };
  for (const u of world.units.values()) {
    if (rectDistance(u.pos, grown) <= 0) {
      const edge = rectApproach(u.pos, rect, m + BALANCE.approachGap);
      const p = world.nav.isFree(edge) ? edge : world.nav.nearestFree(edge);
      if (p) u.pos = p;
    }
    if (u.path.length && pathCrosses(u.pos, u.path, grown)) {
      const path = world.nav.findPath(u.pos, u.path[u.path.length - 1]);
      if (path) u.path = path;
    }
  }
}

/** Some leg of the polyline `from` → path crosses the rectangle (slab test per segment). */
function pathCrosses(from: Vec2, path: Vec2[], r: Rect): boolean {
  let a = from;
  for (const b of path) {
    let t0 = 0;
    let t1 = 1;
    const d = [b.x - a.x, b.z - a.z];
    const o = [a.x, a.z];
    const lo = [r.x0, r.z0];
    const hi = [r.x1, r.z1];
    let hit = true;
    for (let k = 0; k < 2 && hit; k++) {
      if (Math.abs(d[k]) < 1e-12) {
        if (o[k] <= lo[k] || o[k] >= hi[k]) hit = false;
      } else {
        let ta = (lo[k] - o[k]) / d[k];
        let tb = (hi[k] - o[k]) / d[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 >= t1) hit = false;
      }
    }
    if (hit) return true;
    a = b;
  }
  return false;
}

/**
 * Builder stand point: on the footprint grown by the villager radius + gap, at the spot nearest
 * `from`, shifted along the edge by `slot` (0, +1, −1, +2, …) × BALANCE.builderSpacing so a
 * group spreads out around the site instead of stacking.
 */
export function builderSpot(b: Building, from: Vec2, slot: number): Vec2 {
  const r = buildingRect(b);
  const m = BALANCE.villagerRadius + BALANCE.approachGap;
  const X0 = r.x0 - m;
  const X1 = r.x1 + m;
  const Z0 = r.z0 - m;
  const Z1 = r.z1 + m;
  const W = X1 - X0;
  const D = Z1 - Z0;
  const P = 2 * (W + D);
  const q = rectApproach(from, r, m);
  const eps = 1e-6;
  let t: number;
  if (Math.abs(q.z - Z0) < eps) t = q.x - X0;
  else if (Math.abs(q.x - X1) < eps) t = W + (q.z - Z0);
  else if (Math.abs(q.z - Z1) < eps) t = W + D + (X1 - q.x);
  else t = 2 * W + D + (Z1 - q.z);
  const k = slot === 0 ? 0 : (slot % 2 ? 1 : -1) * Math.ceil(slot / 2);
  t = (((t + k * BALANCE.builderSpacing) % P) + P) % P;
  if (t < W) return { x: X0 + t, z: Z0 };
  if (t < W + D) return { x: X1, z: Z0 + (t - W) };
  if (t < 2 * W + D) return { x: X1 - (t - W - D), z: Z1 };
  return { x: X0, z: Z1 - (t - 2 * W - D) };
}

/** Send villagers to work on foundation `b` ('toBuild' → 'building' on arrival). Scouts ignore it. */
export function sendBuilders(world: World, unitIds: EntityId[], b: Building): void {
  const units = unitIds.map((id) => world.units.get(id)).filter((u): u is Unit => !!u && u.kind === 'villager');
  const cancelled = cancelExplore(world, units);
  // Slots are laid out around the edge point nearest the group's centre, so they never collide.
  const c = { x: 0, z: 0 };
  for (const u of units) {
    c.x += u.pos.x / units.length;
    c.z += u.pos.z / units.length;
  }
  let sent = 0;
  units.forEach((u, i) => {
    const path = world.nav.findPath(u.pos, builderSpot(b, c, i));
    if (!path) return;
    sent++;
    u.path = path;
    u.gatherNode = null;
    u.gatherType = null;
    world.gatherState.delete(u.id);
    world.buildState.set(u.id, b.id);
    world.setState(u, 'toBuild');
  });
  settleCancelled(world, cancelled);
  if (unitIds.length && !sent) reject(world, 'unreachable');
}

/**
 * 'construct' command: help build a foundation. On a complete farm it means "farm it"; on a
 * fallow farm (food 0) it reseeds: pays the farm's cost again, refills it to FARM_FOOD at once,
 * and the first villager starts farming.
 */
export function orderConstruct(world: World, unitIds: EntityId[], buildingId: EntityId): void {
  const b = world.buildings.get(buildingId);
  if (!b) {
    reject(world, 'invalid-target');
    return;
  }
  if (!b.complete) {
    sendBuilders(world, unitIds, b);
    return;
  }
  if (b.kind !== 'farm') {
    reject(world, 'invalid-target');
    return;
  }
  if (!isWorkableFarm(b)) {
    const villagers = unitIds.some((id) => world.units.get(id)?.kind === 'villager');
    if (!villagers) {
      reject(world, 'invalid-target');
      return;
    }
    const cost = BUILDINGS.farm.cost;
    if (!affordable(world, cost)) {
      reject(world, 'insufficient-resources');
      return;
    }
    pay(world, cost, 1);
    b.food = FARM_FOOD;
    world.emitStock();
  }
  orderFarm(world, unitIds, b);
}

/** 'cancelBuild': refund the full cost of an unfinished foundation and remove it. */
export function orderCancelBuild(world: World, buildingId: EntityId): void {
  const b = world.buildings.get(buildingId);
  if (!b || b.complete) {
    reject(world, 'invalid-target');
    return;
  }
  pay(world, BUILDINGS[b.kind].cost, -1);
  removeBuilding(world, b);
  world.emitStock();
}

/** Delete a building: nav freed, 'removed' emitted, its builders go idle. */
export function removeBuilding(world: World, b: Building): void {
  world.buildings.delete(b.id);
  world.nav.removeRect(b.id);
  world.farmers.delete(b.id);
  world.events.emit({ type: 'removed', id: b.id });
  for (const u of buildersOf(world, b.id)) idle(world, u);
}

function buildersOf(world: World, id: EntityId): Unit[] {
  const out: Unit[] = [];
  for (const [uid, bid] of world.buildState) {
    if (bid !== id) continue;
    world.buildState.delete(uid);
    const u = world.units.get(uid);
    if (u && (u.state === 'toBuild' || u.state === 'building')) out.push(u);
  }
  return out;
}

function idle(world: World, u: Unit): void {
  u.path = [];
  world.setState(u, 'idle');
}

/** Builder arrivals, then construction progress: n builders add n^0.75 / buildTime per second. */
export function buildSystem(world: World, dt: number, arrived: Unit[]): void {
  for (const u of arrived) {
    if (u.state !== 'toBuild') continue;
    const id = world.buildState.get(u.id);
    const b = id !== undefined ? world.buildings.get(id) : undefined;
    if (!b || b.complete || !inReach(u, b)) {
      world.buildState.delete(u.id);
      idle(world, u);
      continue;
    }
    u.facing = Math.atan2(b.pos.x - u.pos.x, b.pos.z - u.pos.z);
    world.setState(u, 'building');
  }
  if (!world.buildState.size) return;
  const workers = new Map<EntityId, number>();
  for (const [uid, bid] of world.buildState) {
    const u = world.units.get(uid);
    if (!u || (u.state !== 'toBuild' && u.state !== 'building')) {
      world.buildState.delete(uid); // took another order
      continue;
    }
    if (u.state === 'building') workers.set(bid, (workers.get(bid) ?? 0) + 1);
  }
  for (const [bid, n] of workers) {
    const b = world.buildings.get(bid);
    if (!b || b.complete) continue;
    b.buildProgress = Math.min(1, b.buildProgress + (Math.pow(n, BALANCE.buildExponent) / BUILDINGS[b.kind].buildTime) * dt);
    if (b.buildProgress >= 1 - 1e-9) completeBuilding(world, b);
  }
}

/**
 * Finish `b`: 'constructed', pop cap / fog update, then the builders move on — a farm's first
 * builder farms it, drop-site builders gather the nearest matching resource, the rest go idle.
 */
export function completeBuilding(world: World, b: Building): void {
  b.complete = true;
  b.buildProgress = 1;
  if (b.kind === 'farm') b.food = FARM_FOOD;
  world.events.emit({ type: 'constructed', id: b.id });
  world.emitStock();
  world.refreshFog();
  const spec = BUILDINGS[b.kind];
  for (const u of buildersOf(world, b.id)) {
    u.path = [];
    if (b.kind === 'farm') {
      if (sendToFarm(world, u, b)) continue;
    } else if (spec.drop.length && b.kind !== 'townCenter') {
      const s = nearestOf(world, spec.drop, b.pos, u);
      if (s && sendToSource(world, u, s)) continue;
    }
    idle(world, u);
  }
}

/** Nearest workable source of any of `types` within the retarget radius of `from`. */
function nearestOf(world: World, types: ResourceType[], from: Vec2, u: Unit): ResourceNode | Building | null {
  let best: ResourceNode | Building | null = null;
  let bestD = Infinity;
  for (const t of types) {
    const s = nearestSources(world, t, from, u)[0];
    if (!s) continue;
    const d = 'type' in s ? Math.hypot(s.pos.x - from.x, s.pos.z - from.z) : rectDistance(from, buildingRect(s));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
