import { nextUpgrade, popBonusOf, type BuildingUpgradeSpec } from '../../core/buildings';
import type { Building, EntityId, PlayerId, RejectReason } from '../../core/types';
import { productionOrder } from '../productionQueue';
import type { World } from '../World';
import { affordable, pay } from './build';
import { buildingMaxHp } from './stats';
import { rescale } from './upgrades';

/**
 * In-place building upgrades (M14-1), modelled on 0 A.D.'s Upgrade component: one building
 * advances tier 0 → 1 → 2 along its BUILDING_UPGRADES chain. The cost is paid when it starts,
 * a cancel refunds it in full, and a building destroyed mid-upgrade refunds nothing. While
 * upgrading a building cannot train or research, and it can only start with an empty queue.
 * Tier stats flow through stats.ts (buildingMaxHp, armorOf, buildingAttack, garrisonCap) and
 * World.popCapOf.
 */

/** Why `b` can't start its next upgrade for `by` now (ignoring cost when `ignoreCost`), or null. */
export function upgradeBlock(world: World, b: Building | undefined, by: PlayerId, ignoreCost = false): RejectReason | null {
  if (!b || b.owner !== by || !b.complete) return 'invalid-target';
  const spec = nextUpgrade(b.kind, b.tier);
  if (!spec) return 'max-tier';
  if (b.upgrading || productionOrder(b).length > 0 || b.queue > 0 || (b.research?.length ?? 0) > 0) return 'busy';
  const p = world.players.get(by);
  if (!p) return 'invalid-target';
  if (p.age < spec.age) return 'age';
  if (spec.requires?.some((t) => !p.researched.has(t))) return 'requires';
  if (!ignoreCost && !affordable(world, spec.cost, by)) return 'insufficient-resources';
  return null;
}

/** The upgrade `b` is currently working on, if any. */
export function activeUpgrade(b: Building): BuildingUpgradeSpec | undefined {
  return b.upgrading ? nextUpgrade(b.kind, b.upgrading.to - 1) : undefined;
}

function reject(world: World, by: PlayerId, reason: RejectReason): void {
  if (by === world.localPlayer) world.events.emit({ type: 'rejected', reason });
}

function emitProgress(world: World, b: Building): void {
  const spec = activeUpgrade(b);
  if (b.owner !== world.localPlayer || !b.upgrading || !spec) return;
  world.events.emit({ type: 'upgradeProgress', buildingId: b.id, tier: b.upgrading.to, progress: b.upgrading.progress, total: spec.time });
}

/** 'upgradeBuilding' command: start `buildingId`'s next tier; pays up front. */
export function orderUpgradeBuilding(world: World, buildingId: EntityId, by: PlayerId): void {
  const b = world.buildings.get(buildingId);
  const block = upgradeBlock(world, b, by);
  if (block) {
    reject(world, by, block);
    return;
  }
  const spec = nextUpgrade(b!.kind, b!.tier)!;
  pay(world, spec.cost, 1, by);
  b!.upgrading = { to: spec.tier, progress: 0 };
  if (by === world.localPlayer) world.emitStock();
  emitProgress(world, b!);
}

/** 'cancelUpgrade' command: stop the upgrade in progress and refund its cost in full. */
export function orderCancelUpgrade(world: World, buildingId: EntityId, by: PlayerId): void {
  const b = world.buildings.get(buildingId);
  const spec = b && activeUpgrade(b);
  if (!b || b.owner !== by || !spec) {
    reject(world, by, 'invalid-target');
    return;
  }
  delete b.upgrading;
  pay(world, spec.cost, -1, by);
  if (by === world.localPlayer) {
    world.emitStock();
    world.events.emit({ type: 'upgradeProgress', buildingId: b.id, tier: spec.tier, progress: 0, total: 0 });
  }
}

/** Advance every building upgrade; finished ones take their new tier's stats. */
export function buildingUpgradeSystem(world: World, dt: number): void {
  for (const b of world.buildings.values()) {
    if (!b.upgrading) continue;
    const spec = activeUpgrade(b);
    if (!spec) {
      // Defensive: an upgrade with no matching chain step is dropped without a refund.
      delete b.upgrading;
      continue;
    }
    b.upgrading.progress += dt;
    if (b.upgrading.progress >= spec.time - 1e-9) completeUpgrade(world, b, spec.tier);
    else emitProgress(world, b);
  }
}

/** Put `b` at `tier`: keep its hp fraction under the new maxHp and refresh the pop cap. */
export function completeUpgrade(world: World, b: Building, tier: number): void {
  const popBefore = popBonusOf(b.kind, b.tier);
  delete b.upgrading;
  b.tier = tier;
  rescale(b, buildingMaxHp(world, b.owner, b.kind, tier));
  world.events.emit({ type: 'buildingUpgraded', id: b.id, owner: b.owner, tier });
  if (b.owner === world.localPlayer && popBonusOf(b.kind, tier) !== popBefore) world.emitStock();
}
