import { BUILDINGS } from '../../core/buildings';
import { GAIA, type Building, type EntityId, type PlayerId, type ResourceType, type Stockpile, type Unit } from '../../core/types';
import { canWork, isShip } from '../../core/units';
import { BALANCE } from '../balance';
import type { World } from '../World';
import { idle, sendWorkers } from './build';
import { inReach } from './sites';

/**
 * Repair (modelled on 0 A.D. Repairable): workers restore hit points of an own or allied
 * completed building. One repairer takes buildTime × BALANCE.repairTimeFactor seconds for
 * 0 → full hp; n repairers work n^buildExponent times as fast. 0 → full costs
 * BALANCE.repairCostFactor × the building's cost, owed fractionally per player in
 * world.repairDebt and charged a whole unit at a time; a player who can't pay the next unit
 * stops repairing. Repairers share world.buildState with builders ('toRepair' → 'repairing').
 */

/** `by`'s workers may repair `b`: complete, damaged, alive and own or allied. */
export function canRepair(world: World, b: Building, by: PlayerId): boolean {
  return b.complete && b.hp > 0 && b.hp < b.maxHp && b.owner !== GAIA && !world.areEnemies(by, b.owner);
}

/** 'repair' command: send `by`'s capable land units to repair building `targetId`. */
export function orderRepair(world: World, unitIds: EntityId[], targetId: EntityId, by: PlayerId): void {
  const b = world.buildings.get(targetId);
  const units = unitIds.map((id) => world.units.get(id))
    .filter((u): u is Unit => !!u && canWork(u.kind) && u.owner === by && u.state !== 'garrisoned');
  if (!b || !units.length || !canRepair(world, b, by)) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  if (!sendWorkers(world, units, b, 'toRepair')) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/** Hit points per second that `n` repairers restore on `b`. */
export function repairRate(b: Building, n: number): number {
  if (n <= 0) return 0;
  return (b.maxHp * Math.pow(n, BALANCE.buildExponent)) / (BUILDINGS[b.kind].buildTime * BALANCE.repairTimeFactor);
}

/**
 * Add the cost of repairing `fraction` of `b`'s max hp to `owner`'s repair debt and charge any
 * whole units now due. Returns false (charging nothing) if the stockpile can't cover them.
 */
function chargeRepair(world: World, owner: PlayerId, b: Building, fraction: number): boolean {
  const stock = world.stockOf(owner);
  const debt = world.repairDebt.get(owner) ?? {};
  const next: Partial<Stockpile> = {};
  for (const [r, n] of Object.entries(BUILDINGS[b.kind].cost) as [ResourceType, number][]) {
    const owed = (debt[r] ?? 0) + n * BALANCE.repairCostFactor * fraction;
    if (stock[r] < Math.floor(owed)) return false;
    next[r] = owed;
  }
  let paid = false;
  for (const [r, owed] of Object.entries(next) as [ResourceType, number][]) {
    const due = Math.floor(owed);
    if (due > 0) paid = true;
    stock[r] -= due;
    debt[r] = owed - due;
  }
  world.repairDebt.set(owner, debt);
  if (paid && owner === world.localPlayer) world.emitStock();
  return true;
}

function stopAll(world: World, crew: Unit[]): void {
  for (const u of crew) {
    world.buildState.delete(u.id);
    idle(world, u);
  }
}

/** Repairer arrivals, hit points restored (and paid for) on every building being repaired, ships healing at docks. */
export function repairSystem(world: World, dt: number, arrived: Unit[]): void {
  for (const u of arrived) {
    if (u.state !== 'toRepair') continue;
    const id = world.buildState.get(u.id);
    const b = id !== undefined ? world.buildings.get(id) : undefined;
    if (!b || !canRepair(world, b, u.owner) || !inReach(u, b)) {
      world.buildState.delete(u.id);
      idle(world, u);
      continue;
    }
    u.facing = Math.atan2(b.pos.x - u.pos.x, b.pos.z - u.pos.z);
    world.setState(u, 'repairing');
  }
  if (world.buildState.size) repairBuildings(world, dt);
  dockHeal(world, dt);
}

function repairBuildings(world: World, dt: number): void {
  // Building → owner → its repairers, in buildState order (deterministic).
  const crews = new Map<EntityId, Map<PlayerId, Unit[]>>();
  for (const [uid, bid] of world.buildState) {
    const u = world.units.get(uid);
    if (u?.state !== 'repairing') continue;
    let byOwner = crews.get(bid);
    if (!byOwner) crews.set(bid, (byOwner = new Map()));
    const crew = byOwner.get(u.owner);
    if (crew) crew.push(u);
    else byOwner.set(u.owner, [u]);
  }
  for (const [bid, byOwner] of crews) {
    const b = world.buildings.get(bid);
    const all = [...byOwner.values()].flat();
    if (!b || !b.complete || b.hp >= b.maxHp) {
      if (b && b.hp > b.maxHp) b.hp = b.maxHp;
      stopAll(world, all);
      continue;
    }
    const hp = Math.min(repairRate(b, all.length) * dt, b.maxHp - b.hp);
    for (const [owner, crew] of byOwner) {
      if (!canRepair(world, b, owner)) {
        stopAll(world, crew);
        continue;
      }
      const share = (hp * crew.length) / all.length;
      if (!chargeRepair(world, owner, b, share / b.maxHp)) {
        stopAll(world, crew);
        if (owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'insufficient-resources' });
        continue;
      }
      b.hp = Math.min(b.maxHp, b.hp + share);
    }
    if (b.hp >= b.maxHp - 1e-9) {
      b.hp = b.maxHp;
      stopAll(world, all.filter((u) => u.state === 'repairing'));
    }
  }
}

/** A damaged ship near an own completed dock slowly heals (free). */
function dockHeal(world: World, dt: number): void {
  for (const u of world.units.values()) {
    if (!isShip(u.kind) || u.hp >= u.maxHp || u.state === 'garrisoned') continue;
    for (const b of world.buildings.values()) {
      if (b.kind !== 'dock' || !b.complete || b.owner !== u.owner) continue;
      if (Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z) > b.radius + BALANCE.dockHealRange) continue;
      u.hp = Math.min(u.maxHp, u.hp + BALANCE.dockHealRate * dt);
      break;
    }
  }
}
