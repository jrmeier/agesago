import { BUILDINGS, TERRITORY } from '../../core/buildings';
import { GAIA, type Building } from '../../core/types';
import type { World } from '../World';
import { destroyBuilding } from './combat';

/**
 * Does `b` lose hp to territory decay? Complete, owned, non-root buildings standing outside
 * their owner's connected territory do, unless someone is garrisoned inside.
 */
export function decaying(world: World, b: Building): boolean {
  if (!b.complete || b.owner === GAIA || b.hp <= 0) return false;
  if (BUILDINGS[b.kind].territory?.root) return false;
  if (b.occupants?.length) return false;
  return world.territoryOwner(b.pos) !== b.owner || !world.isConnected(b.pos);
}

/**
 * Territory decay (M18-3, after 0 A.D.'s TerritoryDecay). Each decaying building loses
 * TERRITORY.decayRate of its max hp per second. At 0 hp a small building (decayTo 'collapse')
 * is destroyed; anything else turns neutral (see abandonBuilding). Town Centers never decay.
 */
export function decaySystem(world: World, dt: number): void {
  let doomed: Building[] | null = null;
  for (const b of world.buildings.values()) {
    if (!decaying(world, b)) continue;
    b.hp = Math.max(0, b.hp - b.maxHp * TERRITORY.decayRate * dt);
    if (b.hp <= 0) (doomed ??= []).push(b);
  }
  if (!doomed) return;
  for (const b of doomed) {
    if (BUILDINGS[b.kind].decayTo === 'collapse') destroyBuilding(world, b);
    else abandonBuilding(world, b);
  }
}

/**
 * Hand `b` to Gaia: its queues are dropped without refund, it keeps TERRITORY.neutralHp of its
 * max hp, projects no territory, fires no arrows and can be attacked by anyone (explicit order).
 * Emits 'abandoned' so views re-colour it and selections drop it.
 */
export function abandonBuilding(world: World, b: Building): void {
  const prev = b.owner;
  b.owner = GAIA;
  b.hp = Math.max(1, b.maxHp * TERRITORY.neutralHp);
  b.queue = 0;
  b.queueKinds = [];
  b.productionQueue = [];
  b.progress = 0;
  b.research = [];
  b.researchProgress = 0;
  b.upgrading = undefined;
  b.rally = undefined;
  b.cooldown = 0;
  world.farmers.delete(b.id);
  world.events.emit({ type: 'abandoned', id: b.id, kind: b.kind, owner: prev, pos: { x: b.pos.x, z: b.pos.z } });
  world.refreshFog();
  if (prev === world.localPlayer) world.emitStock();
}
