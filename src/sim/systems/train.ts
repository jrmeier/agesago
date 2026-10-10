import type { Building, EntityId, UnitKind, Vec2 } from '../../core/types';
import { isShip, UNITS, trainable } from '../../core/units';
import { ensureProductionQueue, productionOrder, removeProduction } from '../productionQueue';
import { BALANCE } from '../balance';
import type { World } from '../World';
import { affordable, pay } from './build';
import { applyRally } from './combat';
import { ageOf, unitStat } from './research';

function emitProgress(world: World, b: Building): void {
  if (b.owner !== world.localPlayer) return;
  const head = b.queueKinds?.[0];
  world.events.emit({
    type: 'trainProgress',
    buildingId: b.id,
    queue: b.queue,
    progress: b.progress,
    total: head ? trainTime(world, b, head) : BALANCE.trainTime,
  });
}

/** Seconds for `b` to train one `kind` (its owner's research applied). */
export function trainTime(world: World, b: Building, kind: UnitKind): number {
  return unitStat(world, b.owner, kind, 'trainTime', UNITS[kind].trainTime);
}

/** Units queued anywhere by `owner` (they count against the pop cap before they exist). */
function queuedBy(world: World, owner: number): number {
  let n = 0;
  for (const b of world.buildings.values()) if (b.owner === owner) n += b.queue;
  return n;
}

/**
 * 'train' command: the building must be complete and able to train `unit` (default: its first
 * trainable kind). Needs the unit's cost and a free pop slot (counting queued units); pays up front.
 */
export function orderTrain(world: World, buildingId: EntityId, unit?: UnitKind): void {
  const b = world.buildings.get(buildingId);
  const kinds = b ? trainable(b.kind, world.players.get(b.owner)?.player.civ) : [];
  // A civ-specific advanced unit may lead the roster; the implicit command
  // still trains an available basic unit while that unique unit is age-locked.
  const kind = unit ?? kinds.find(k => (UNITS[k].age ?? 0) <= ageOf(world, b!.owner)) ?? kinds[0];
  if (!b || !b.complete || !kind || !kinds.includes(kind)) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  if ((UNITS[kind].age ?? 0) > ageOf(world, b.owner)) {
    if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'age' });
    return;
  }
  if (world.popOf(b.owner) + queuedBy(world, b.owner) >= world.popCapOf(b.owner)) {
    if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'pop-cap' });
    return;
  }
  const cost = UNITS[kind].cost;
  if (!affordable(world, cost, b.owner)) {
    if (b.owner === world.localPlayer) {
      const onlyFood = Object.keys(cost).length === 1 && 'food' in cost;
      world.events.emit({ type: 'rejected', reason: onlyFood ? 'insufficient-food' : 'insufficient-resources' });
    }
    return;
  }
  pay(world, cost, 1, b.owner);
  ensureProductionQueue(b).push('train');
  b.queue++;
  (b.queueKinds ??= []).push(kind);
  if (b.owner === world.localPlayer) world.emitStock();
  emitProgress(world, b);
}

/** 'cancelTrain': drop queue entry `index` and refund its full cost (the head also loses its progress). */
export function orderCancelTrain(world: World, buildingId: EntityId, index: number): void {
  const b = world.buildings.get(buildingId);
  const kinds = b?.queueKinds;
  if (!b || !kinds || !Number.isInteger(index) || index < 0 || index >= kinds.length) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  removeProduction(b, 'train', index);
  const [kind] = kinds.splice(index, 1);
  b.queue = kinds.length;
  if (index === 0) b.progress = 0;
  pay(world, UNITS[kind].cost, -1, b.owner);
  if (b.owner === world.localPlayer) world.emitStock();
  emitProgress(world, b);
}

/** Advance every training queue; spawn the head unit beside the building when it completes. */
export function trainSystem(world: World, dt: number): void {
  for (const b of world.buildings.values()) advanceTraining(world, b, dt);
}

/** Tick one building only when training owns the shared queue head. */
export function advanceTraining(world: World, b: Building, dt: number): void {
  if (!b.complete || b.queue <= 0 || productionOrder(b)[0] !== 'train') return;
  const kind = b.queueKinds?.[0] ?? 'villager';
  b.progress += dt;
  if (b.progress >= trainTime(world, b, kind) - 1e-9) {
    removeProduction(b, 'train', 0);
    b.queue--;
    b.queueKinds?.shift();
    b.progress = 0;
    const u = world.spawnUnit(kind, spawnPoint(world, b, kind), b.owner);
    applyRally(world, b, u);
    if (b.owner === world.localPlayer) world.emitStock();
  }
  emitProgress(world, b);
}

/** A free walkable spot on a ring around the building, preferring the front (+z) and empty ground. */
export function spawnPoint(world: World, b: Building, kind?: UnitKind): Vec2 {
  const nav = kind && isShip(kind) ? world.waterNav : world.nav;
  const units = [...world.units.values()];
  const steps = 24;
  for (const crowdOk of [false, true]) {
    for (let ring = 0; ring < 4; ring++) {
      const r = b.radius + BALANCE.villagerRadius + 0.25 + ring * 0.7;
      for (let k = 0; k < steps; k++) {
        const a = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * ((2 * Math.PI) / steps);
        const p = { x: b.pos.x + Math.sin(a) * r, z: b.pos.z + Math.cos(a) * r };
        if (!nav.isFree(p) || (kind && isShip(kind) && !nav.isWalkableCell(p))) continue;
        if (crowdOk || units.every((u) => Math.hypot(u.pos.x - p.x, u.pos.z - p.z) >= 0.6)) return p;
      }
    }
  }
  const fallback = { x: b.pos.x, z: b.pos.z + b.radius + BALANCE.villagerRadius + 0.25 };
  return kind && isShip(kind) ? nav.nearestFreeCell(fallback) ?? fallback : fallback;
}
