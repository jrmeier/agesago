import { tierStats } from '../../core/buildings';
import type { Building, EntityId, UnitKind, Vec2 } from '../../core/types';
import { isHero, isShip, popCost, UNITS, trainable } from '../../core/units';
import { ensureProductionQueue, productionOrder, removeProduction } from '../productionQueue';
import { BALANCE } from '../balance';
import type { World } from '../World';
import { affordable, pay } from './build';
import { applyRally } from './combat';
import { heroBlock } from './heroes';
import { ageOf, unitStat } from './research';

function emitProgress(world: World, b: Building): void {
  if (b.owner !== world.localPlayer) return;
  const head = b.queueKinds?.[0];
  world.events.emit({
    type: 'trainProgress',
    buildingId: b.id,
    queue: b.queue,
    progress: b.progress,
    total: head ? batchTrainTime(world, b, head, batchCount(b, 0)) : BALANCE.trainTime,
  });
}

/** Seconds for `b` to train one `kind` (its owner's research and the building's upgrade tier applied). */
export function trainTime(world: World, b: Building, kind: UnitKind): number {
  return unitStat(world, b.owner, kind, 'trainTime', UNITS[kind].trainTime) / tierStats(b.kind, b.tier).trainSpeed;
}

/** Seconds for a batch of `count`: unitTrainTime × count^batchExponent (faster per unit than singles). */
export function batchTime(unitTime: number, count: number): number {
  return unitTime * Math.pow(count, BALANCE.batchExponent);
}

/** Seconds for `b` to train a batch of `count` × `kind`. */
export function batchTrainTime(world: World, b: Building, kind: UnitKind, count: number): number {
  return count === 1 ? trainTime(world, b, kind) : batchTime(trainTime(world, b, kind), count);
}

/** Units in queue entry `index` (older saves carry no counts: 1 each). */
export function batchCount(b: Pick<Building, 'queueCounts'>, index: number): number {
  return b.queueCounts?.[index] ?? 1;
}

/** Seconds the current training head takes (its whole batch), or the default when nothing is queued. */
export function headTrainTime(world: World, b: Building): number {
  const head = b.queueKinds?.[0];
  return head ? batchTrainTime(world, b, head, batchCount(b, 0)) : BALANCE.trainTime;
}

/**
 * Population of the units queued anywhere by `owner` (they count against the pop cap before they
 * exist): each queue entry is a batch of `batchCount` units of its kind (M15-4), each costing
 * popCost (siege takes several slots, M16-2). Legacy queues may lack kinds or counts: any units
 * beyond the listed entries are one villager each.
 */
export function queuedPop(world: World, owner: number): number {
  let n = 0;
  for (const b of world.buildings.values()) if (b.owner === owner) n += buildingQueuedPop(b);
  return n;
}

/** Population held by `b`'s training queue (see queuedPop). */
export function buildingQueuedPop(b: Pick<Building, 'queue' | 'queueKinds' | 'queueCounts'>): number {
  const kinds = b.queueKinds ?? [];
  let n = 0;
  let units = 0;
  for (let i = 0; i < kinds.length && units < b.queue; i++) {
    const c = Math.min(batchCount(b, i), b.queue - units);
    n += popCost(kinds[i]) * c;
    units += c;
  }
  return n + b.queue - units;
}

/** Materialize per-entry counts (older saves have none) before changing the queue. */
function ensureCounts(b: Building): number[] {
  return (b.queueCounts ??= (b.queueKinds ?? []).map(() => 1));
}

/**
 * 'train' command: the building must be complete and able to train `unit` (default: its first
 * trainable kind). `count` (1..maxTrainBatch, default 1) units form one batch: the whole batch is
 * paid up front and needs free pop slots for every unit (counting queued units).
 *
 * A batch order (count ≥ 2) joins the last queue entry instead of starting a new one when that
 * entry is the same kind, is the last thing in the production queue (no research after it), has
 * not started training, and the merged batch stays within maxTrainBatch. Single orders (the AI's)
 * always add their own entry.
 *
 * A hero (M16-6) trains one at a time (a batch order is cut to 1), and needs no other hero alive
 * or queued and its retrain cooldown over (systems/heroes).
 */
export function orderTrain(world: World, buildingId: EntityId, unit?: UnitKind, count = 1): void {
  const b = world.buildings.get(buildingId);
  const kinds = b ? trainable(b.kind, world.players.get(b.owner)?.player.civ) : [];
  // A civ-specific advanced unit may lead the roster; the implicit command
  // still trains an available basic unit while that unique unit is age-locked.
  const kind = unit ?? kinds.find(k => (UNITS[k].age ?? 0) <= ageOf(world, b!.owner)) ?? kinds[0];
  if (!b || !b.complete || !kind || !kinds.includes(kind)
    || !Number.isInteger(count) || count < 1 || count > BALANCE.maxTrainBatch) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  if (b.upgrading) {
    if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'busy' });
    return;
  }
  if ((UNITS[kind].age ?? 0) > ageOf(world, b.owner)) {
    if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'age' });
    return;
  }
  const heroBlocked = isHero(kind) ? heroBlock(world, b.owner) : null;
  if (heroBlocked) {
    if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: heroBlocked });
    return;
  }
  // One hero per player: a Shift-click or ×5 batch of the hero tile queues just the one.
  if (isHero(kind)) count = 1;
  if (world.popOf(b.owner) + queuedPop(world, b.owner) + count * popCost(kind) > world.popCapOf(b.owner)) {
    if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'pop-cap' });
    return;
  }
  const cost = UNITS[kind].cost;
  if (!affordable(world, cost, b.owner, count)) {
    if (b.owner === world.localPlayer) {
      const onlyFood = Object.keys(cost).length === 1 && 'food' in cost;
      world.events.emit({ type: 'rejected', reason: onlyFood ? 'insufficient-food' : 'insufficient-resources' });
    }
    return;
  }
  pay(world, cost, count, b.owner);
  const counts = ensureCounts(b);
  const queueKinds = (b.queueKinds ??= []);
  const last = queueKinds.length - 1;
  const order = ensureProductionQueue(b);
  const joinable = count > 1 && last >= 0 && queueKinds[last] === kind && order[order.length - 1] === 'train'
    && !(last === 0 && b.progress > 0) && counts[last] + count <= BALANCE.maxTrainBatch;
  if (joinable) counts[last] += count;
  else {
    order.push('train');
    queueKinds.push(kind);
    counts.push(count);
  }
  b.queue += count;
  if (b.owner === world.localPlayer) world.emitStock();
  emitProgress(world, b);
}

/** 'cancelTrain': drop queue entry `index` and refund its whole batch (the head also loses its progress). */
export function orderCancelTrain(world: World, buildingId: EntityId, index: number): void {
  const b = world.buildings.get(buildingId);
  const kinds = b?.queueKinds;
  if (!b || !kinds || !Number.isInteger(index) || index < 0 || index >= kinds.length) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  removeProduction(b, 'train', index);
  const [count] = ensureCounts(b).splice(index, 1);
  const [kind] = kinds.splice(index, 1);
  b.queue = Math.max(0, b.queue - count);
  if (index === 0) b.progress = 0;
  pay(world, UNITS[kind].cost, -count, b.owner);
  if (b.owner === world.localPlayer) world.emitStock();
  emitProgress(world, b);
}

/** Advance every training queue; spawn the head unit beside the building when it completes. */
export function trainSystem(world: World, dt: number): void {
  for (const b of world.buildings.values()) advanceTraining(world, b, dt);
}

/** Buildings whose head batch is waiting for pop room (UI notice only; not sim state). */
const popBlocked = new WeakSet<Building>();

/**
 * Tick one building only when training owns the shared queue head. A batch that has not started
 * waits (no progress) until its owner has pop room for every unit in it (popCost each), with one 'pop-cap' notice.
 * When it completes, all its units appear together.
 */
export function advanceTraining(world: World, b: Building, dt: number): void {
  if (!b.complete || b.queue <= 0 || productionOrder(b)[0] !== 'train') return;
  const kind = b.queueKinds?.[0] ?? 'villager';
  const count = batchCount(b, 0);
  if (b.progress <= 0 && world.popOf(b.owner) + count * popCost(kind) > world.popCapOf(b.owner)) {
    if (!popBlocked.has(b)) {
      popBlocked.add(b);
      if (b.owner === world.localPlayer) world.events.emit({ type: 'rejected', reason: 'pop-cap' });
    }
    return;
  }
  popBlocked.delete(b);
  b.progress += dt;
  if (b.progress >= batchTrainTime(world, b, kind, count) - 1e-9) {
    removeProduction(b, 'train', 0);
    b.queue = Math.max(0, b.queue - count);
    b.queueKinds?.shift();
    b.queueCounts?.shift();
    b.progress = 0;
    for (let i = 0; i < count; i++) {
      const u = world.spawnUnit(kind, spawnPoint(world, b, kind), b.owner);
      applyRally(world, b, u);
    }
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
