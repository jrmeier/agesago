import type { Building, EntityId, PlayerId, Unit } from '../../core/types';
import type { World } from '../World';
import { buildingRect } from './sites';
import { routeForUnit, closedGates } from './passage';
import { cancelExplore } from './explore';
import { orderStop, releaseCombat } from './combat';

export const HERD_CAP = 6;
export const BREED_SECONDS = 45;
export const HARVEST_SECONDS = 60;
export const LIVESTOCK_FOOD = 60;

function inside(b: Building, u: Unit): boolean {
  const r = buildingRect(b);
  return u.pos.x > r.x0 && u.pos.x < r.x1 && u.pos.z > r.z0 && u.pos.z < r.z1;
}
/** Each animal belongs to at most one pasture, even for overlapping legacy saves. */
export function corralSheep(world: World, b: Building): Unit[] {
  return [...world.units.values()].filter(u => u.kind === 'sheep' && u.owner === b.owner && u.hp > 0
    && u.state !== 'garrisoned' && !u.path.length && inside(b, u)
    && ![...world.buildings.values()].some(other => other.id < b.id && other.kind === 'corral'
      && other.complete && other.owner === b.owner && inside(other, u)));
}
export function corralWorker(world: World, b: Building): Unit | undefined {
  return [...world.units.values()].find(u => u.tendingCorral === b.id && u.owner === b.owner && u.hp > 0
    && u.kind === 'villager' && (u.state === 'toTend' || u.state === 'tending'));
}
export function releaseTending(world: World, ids: EntityId[]): void {
  for (const id of ids) {
    const u = world.units.get(id);
    if (!u?.tendingCorral) continue;
    delete u.tendingCorral;
    if (u.state === 'toTend' || u.state === 'tending') { u.path = []; world.setState(u, 'idle'); }
  }
}
export function orderTend(world: World, ids: EntityId[], buildingId: EntityId, by: PlayerId): void {
  const b = world.buildings.get(buildingId);
  if (!b || b.owner !== by || b.kind !== 'corral' || !b.complete) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' }); return;
  }
  const nearby = [...world.buildings.values()].filter(c => c.id !== b.id && c.kind === 'corral' && c.complete
    && c.owner === by && Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) <= 24)
    .sort((a, c) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) - Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) || a.id - c.id);
  let occupied = false, unreachable = false;
  for (const id of new Set(ids)) {
    const u = world.units.get(id);
    if (!u || u.owner !== by || u.kind !== 'villager' || u.state === 'garrisoned') continue;
    const candidates = [b, ...nearby].filter(c => !corralWorker(world, c) || corralWorker(world, c)?.id === id);
    let assigned = false;
    for (const c of candidates) {
      const path = routeForUnit(world, u, c.pos);
      if (!path || !inside(c, { ...u, pos: path.at(-1) ?? u.pos })) continue;
      releaseTending(world, [id]); cancelExplore(world, [u]); releaseCombat(world, [id]);
      world.buildState.delete(id); world.gatherState.delete(id);
      for (const [farm, worker] of world.farmers) if (worker === id) world.farmers.delete(farm);
      u.gatherNode = null; u.gatherType = null; u.target = null;
      u.tendingCorral = c.id; u.path = path; world.setState(u, 'toTend'); assigned = true; break;
    }
    if (!assigned && !candidates.length) {
      releaseTending(world, [id]); orderStop(world, [id]); occupied = true;
    } else if (!assigned) unreachable = true;
  }
  if (occupied || unreachable) world.events.emit({ type: 'rejected', reason: occupied ? 'occupied' : 'unreachable' });
}
export function orderGateLivestock(world: World, id: EntityId, open: boolean, by: PlayerId): void {
  const b = world.buildings.get(id);
  if (!b || b.owner !== by || b.kind !== 'gate' || !b.complete) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' }); return;
  }
  b.livestockOpen = open;
}
export function livestockSystem(world: World, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  for (const u of world.units.values()) {
    if (!u.tendingCorral) continue;
    const b = world.buildings.get(u.tendingCorral);
    if (!b || !b.complete || b.owner !== u.owner || (u.state !== 'toTend' && u.state !== 'tending')) {
      releaseTending(world, [u.id]); continue;
    }
    if (u.state === 'toTend' && !u.path.length && inside(b, u)) world.setState(u, 'tending');
  }
  for (const b of world.buildings.values()) {
    if (b.kind !== 'corral' || !b.complete || b.hp <= 0) continue;
    const worker = corralWorker(world, b);
    if (!worker || worker.state !== 'tending' || !inside(b, worker) || worker.path.length) continue;
    const sheep = corralSheep(world, b);
    if (sheep.length < 2) { b.breedProgress = 0; b.harvestProgress = 0; continue; }
    // No banked breeding above the cap; a fixed work cycle creates at most one animal.
    b.breedProgress = sheep.length < HERD_CAP ? (b.breedProgress ?? 0) + dt : 0;
    if (b.breedProgress >= BREED_SECONDS) {
      const pos = world.nav.withMask(closedGates(world, b.owner, true), () => world.nav.nearestFree(b.pos));
      if (pos && inside(b, { ...worker, pos })) {
        const child = world.spawnUnit('sheep', pos); child.owner = b.owner;
        sheep.push(child); b.breedProgress = 0; world.refreshFog();
      }
    }
    b.harvestProgress = sheep.length > 2 ? (b.harvestProgress ?? 0) + dt : 0;
    if (b.harvestProgress >= HARVEST_SECONDS && sheep.length > 2) {
      const surplus = sheep[sheep.length - 1];
      // Consume the animal directly, never also spawn a harvestable carcass.
      world.units.delete(surplus.id); world.combatState.delete(surplus.id);
      world.events.emit({ type: 'removed', id: surplus.id });
      world.players.get(b.owner)!.stock.food += LIVESTOCK_FOOD;
      b.harvestProgress = 0; world.emitStock(); world.refreshFog();
    }
  }
}
