import { BUILDINGS } from '../../core/buildings';
import type { Building, EntityId, PlayerId, Unit } from '../../core/types';
import type { World } from '../World';
import { builderSpot } from './build';
import { cancelExplore, settleCancelled } from './explore';
import { route } from './passage';
import { inReach, siteApproach } from './sites';

const reject = (world: World, reason: 'invalid-target' | 'unreachable') => world.events.emit({ type: 'rejected', reason });

/** Free beds left, counting villagers already walking in. */
function room(world: World, b: Building): number {
  const cap = BUILDINGS[b.kind].garrison ?? 0;
  if (!b.complete || cap <= 0) return 0;
  let used = b.occupants?.length ?? 0;
  for (const u of world.units.values()) if (u.state === 'toShelter' && u.shelter === b.id) used++;
  return cap - used;
}

function dropWork(world: World, units: Unit[]): Unit[] {
  const cancelled = cancelExplore(world, units);
  for (const u of units) {
    u.target = null;
    u.gatherNode = null;
    u.gatherType = null;
    world.gatherState.delete(u.id);
    world.buildState.delete(u.id);
    world.fleeState.delete(u.id);
    world.combatState.delete(u.id);
    for (const [farm, id] of world.farmers) if (id === u.id) world.farmers.delete(farm);
  }
  return cancelled;
}

function enter(world: World, u: Unit, b: Building): boolean {
  const cap = BUILDINGS[b.kind].garrison ?? 0;
  if (!b.complete || (b.occupants?.length ?? 0) >= cap || !inReach(u, b)) return false;
  u.path = [];
  u.pos = { x: b.pos.x, z: b.pos.z };
  u.prevPos = { x: b.pos.x, z: b.pos.z };
  u.shelter = b.id;
  u.target = null;
  (b.occupants ??= []).push(u.id);
  world.setState(u, 'garrisoned');
  return true;
}

/** A spot just outside `b` that a villager can stand on. */
function exitSpot(world: World, b: Building): { x: number; z: number } {
  const origin = siteApproach(b.pos, b);
  for (let s = 0; s < 8; s++) {
    const p = builderSpot(b, origin, s);
    if (world.nav.isFree(p)) return p;
  }
  return world.nav.nearestFree(origin) ?? origin;
}

function eject(world: World, b: Building, u: Unit): void {
  const occupants = b.occupants;
  if (occupants) {
    const i = occupants.indexOf(u.id);
    if (i >= 0) occupants.splice(i, 1);
  }
  const spot = exitSpot(world, b);
  u.shelter = null;
  u.path = [];
  u.pos = { x: spot.x, z: spot.z };
  u.prevPos = { x: spot.x, z: spot.z };
  world.setState(u, 'idle');
}

/**
 * 'garrison': villagers of the building's owner walk in, up to the free beds.
 * Returns whether anyone was sent or taken inside. `quiet` skips the reject event
 * (the town bell reports once for the whole order).
 */
export function orderGarrison(world: World, unitIds: EntityId[], buildingId: EntityId, quiet = false): boolean {
  const b = world.buildings.get(buildingId);
  const cap = b ? (BUILDINGS[b.kind].garrison ?? 0) : 0;
  const villagers = unitIds
    .map((id) => world.units.get(id))
    .filter((u): u is Unit => !!u && u.kind === 'villager' && u.owner === b?.owner && u.state !== 'garrisoned');
  if (!b || !b.complete || cap <= 0 || !villagers.length) {
    if (!quiet) reject(world, 'invalid-target');
    return false;
  }
  const cancelled = dropWork(world, villagers);
  let sent = 0;
  for (const u of villagers) {
    if (room(world, b) <= 0) continue;
    u.shelter = b.id;
    if (enter(world, u, b)) {
      sent++;
      continue;
    }
    const path = route(world, u.owner, u.pos, siteApproach(u.pos, b));
    if (!path) {
      u.shelter = null;
      continue;
    }
    u.path = path;
    world.setState(u, 'toShelter');
    sent++;
  }
  settleCancelled(world, cancelled);
  if (!sent && !quiet) reject(world, 'unreachable');
  return sent > 0;
}

/** 'ungarrison': everyone inside steps out next to the building. */
export function orderUngarrison(world: World, buildingId: EntityId, by: PlayerId): void {
  const b = world.buildings.get(buildingId);
  if (!b || b.owner !== by) {
    reject(world, 'invalid-target');
    return;
  }
  const ids = [...(b.occupants ?? [])];
  if (!ids.length) {
    reject(world, 'invalid-target');
    return;
  }
  for (const id of ids) {
    const u = world.units.get(id);
    if (u) eject(world, b, u);
  }
}

/** 'townBell': each of the issuer's villagers runs to the nearest shelter that has a bed. */
export function orderTownBell(world: World, by: PlayerId): void {
  const villagers = [...world.units.values()].filter((u) => u.owner === by && u.kind === 'villager' && u.state !== 'garrisoned');
  const shelters = [...world.buildings.values()].filter(
    (b) => b.owner === by && b.complete && (BUILDINGS[b.kind].garrison ?? 0) > 0,
  );
  if (!villagers.length || !shelters.length) {
    reject(world, 'invalid-target');
    return;
  }
  let sent = 0;
  for (const u of villagers) {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of shelters) {
      if (room(world, b) <= 0) continue;
      const d = Math.hypot(b.pos.x - u.pos.x, b.pos.z - u.pos.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best && orderGarrison(world, [u.id], best.id, true)) sent++;
  }
  if (!sent) reject(world, 'unreachable');
}

/** Villagers who have reached a shelter door step inside. */
export function garrisonSystem(world: World, arrived: Unit[]): void {
  for (const u of arrived) {
    if (u.state !== 'toShelter' || u.shelter == null) continue;
    const b = world.buildings.get(u.shelter);
    if (!b || b.owner !== u.owner || !enter(world, u, b)) {
      u.shelter = null;
      u.path = [];
      world.setState(u, 'idle');
    }
  }
}
