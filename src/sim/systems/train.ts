import type { Building, EntityId, Vec2 } from '../../core/types';
import { BALANCE } from '../balance';
import type { World } from '../World';

function emitProgress(world: World, b: Building): void {
  world.events.emit({
    type: 'trainProgress',
    buildingId: b.id,
    queue: b.queue,
    progress: b.progress,
    total: BALANCE.trainTime,
  });
}

/**
 * 'train' command (Town Center only): needs food and a free pop slot under World.popCap
 * (houses + TC), counting villagers already queued; pays up front.
 */
export function orderTrain(world: World, buildingId: EntityId): void {
  const b = world.buildings.get(buildingId);
  if (!b || b.kind !== 'townCenter' || !b.complete) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  let queued = 0;
  for (const other of world.buildings.values()) queued += other.queue;
  if (world.pop + queued >= world.popCap) {
    world.events.emit({ type: 'rejected', reason: 'pop-cap' });
    return;
  }
  if (world.stock.food < BALANCE.trainCost.food) {
    world.events.emit({ type: 'rejected', reason: 'insufficient-food' });
    return;
  }
  world.stock.food -= BALANCE.trainCost.food;
  b.queue++;
  world.emitStock();
  emitProgress(world, b);
}

/** Advance every training queue; spawn a villager beside the building when the head completes. */
export function trainSystem(world: World, dt: number): void {
  for (const b of world.buildings.values()) {
    if (b.queue <= 0) continue;
    b.progress += dt;
    if (b.progress >= BALANCE.trainTime - 1e-9) {
      b.queue--;
      b.progress = 0;
      world.spawnVillager(spawnPoint(world, b));
      world.emitStock();
    }
    emitProgress(world, b);
  }
}

/** A free walkable spot on a ring around the building, preferring the front (+z) and empty ground. */
export function spawnPoint(world: World, b: Building): Vec2 {
  const units = [...world.units.values()];
  const steps = 24;
  for (const crowdOk of [false, true]) {
    for (let ring = 0; ring < 4; ring++) {
      const r = b.radius + BALANCE.villagerRadius + 0.25 + ring * 0.7;
      for (let k = 0; k < steps; k++) {
        const a = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * ((2 * Math.PI) / steps);
        const p = { x: b.pos.x + Math.sin(a) * r, z: b.pos.z + Math.cos(a) * r };
        if (!world.nav.isFree(p)) continue;
        if (crowdOk || units.every((u) => Math.hypot(u.pos.x - p.x, u.pos.z - p.z) >= 0.6)) return p;
      }
    }
  }
  return { x: b.pos.x, z: b.pos.z + b.radius + BALANCE.villagerRadius + 0.25 };
}
