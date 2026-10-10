import { MARKET } from '../../core/buildings';
import { isAnimal, isShip, UNITS } from '../../core/units';
import type { Building, EntityId, Heightfield, PlayerId, Unit, Vec2 } from '../../core/types';
import type { World } from '../World';
import { releaseCombat } from './combat';
import { route } from './passage';

export const TRANSPORT_CAPACITY = 10;
export const FISHING_CAPACITY = 20;
export const FISHING_RATE = 0.8;
const SHORE_REACH = 3.8;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export type NavalJob =
  | { type: 'fish'; source: EntityId; home: EntityId; phase: 'out' | 'back'; timer: number }
  | { type: 'trade'; home: EntityId; partner: EntityId; phase: 'out' | 'back' };
export interface Landing { land: Vec2; water: Vec2 }

/** Ships use an independent grid. A dry cell is always closed regardless of land walkability. */
export function waterHeightfield(hf: Heightfield): Heightfield {
  return { width: hf.width, depth: hf.depth, heightAt: (x, z) => hf.heightAt(x, z),
    isWater: (x, z) => hf.isWater(x, z), forestDensity: () => 0, ground: (x, z) => hf.ground(x, z),
    isWalkable: (x, z) => x >= 0.5 && z >= 0.5 && x <= hf.width - 0.5 && z <= hf.depth - 0.5 && hf.isWater(x, z) };
}
export function dockApproach(world: World, b: Building, from?: Vec2): Vec2 | null {
  const reg = from ? world.waterNav.regionAt(from) : 0;
  return world.waterNav.nearestFreeCell(b.pos, reg || undefined);
}
export function ownDock(world: World, u: Unit, except?: EntityId): Building | null {
  let best: Building | null = null, bestD = Infinity;
  for (const b of world.buildings.values()) {
    if (b.kind !== 'dock' || !b.complete || b.owner !== u.owner || b.id === except) continue;
    const p = dockApproach(world, b, u.pos); if (!p || dist(p, b.pos) > b.radius + 2) continue;
    const d = dist(b.pos, u.pos); if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}
function sail(world: World, u: Unit, to: Vec2, state: Unit['state'] = 'moving'): boolean {
  const end = world.waterNav.nearestFree(to);
  const path = end && world.waterNav.findPath(u.pos, end);
  if (!path) return false;
  u.path = path; u.target = null; world.setState(u, state); return true;
}
const reject = (world: World, reason: 'invalid-target' | 'unreachable' | 'occupied') => world.events.emit({ type: 'rejected', reason });

export function orderFish(world: World, ids: EntityId[], nodeId: EntityId): void {
  const node = world.nodes.get(nodeId);
  if (!node || node.kind !== 'fish' || !world.hf.isWater(node.pos.x, node.pos.z)) { reject(world, 'invalid-target'); return; }
  let sent = false;
  for (const id of ids) {
    const u = world.units.get(id); if (!u || u.kind !== 'fishingBoat') continue;
    const home = ownDock(world, u); if (!home) continue;
    if (!sail(world, u, node.pos, 'toNode')) continue;
    u.gatherNode = node.id; u.gatherType = 'food';
    world.navalJobs.set(u.id, { type: 'fish', source: node.id, home: home.id, phase: 'out', timer: 0 }); sent = true;
  }
  if (!sent) reject(world, 'unreachable');
}
export function orderNavalTrade(world: World, ids: EntityId[], dockId: EntityId, by: PlayerId): void {
  const dock = world.buildings.get(dockId);
  if (!dock?.complete || dock.kind !== 'dock' || world.areEnemies(by, dock.owner) || dock.owner === 0) { reject(world, 'invalid-target'); return; }
  let sent = false;
  for (const id of ids) {
    const u = world.units.get(id); if (!u || u.kind !== 'merchantShip' || u.owner !== by) continue;
    const home = ownDock(world, u, dock.id); const p = dockApproach(world, dock, u.pos);
    if (!home || !p || dist(p, dock.pos) > dock.radius + 2 || !sail(world, u, p)) continue;
    world.navalJobs.set(id, { type: 'trade', home: home.id, partner: dock.id, phase: 'out' }); sent = true;
  }
  if (!sent) reject(world, 'unreachable');
}
export function landingAt(world: World, ship: Unit, target: Vec2): Landing | null {
  const land = world.nav.nearestFree(target); if (!land || dist(land, target) > 4) return null;
  const reg = world.waterNav.regionAt(ship.pos);
  const water = reg ? world.waterNav.nearestFreeCell(land, reg) : null;
  if (!water || dist(land, water) > SHORE_REACH) return null;
  return { land, water };
}
export function orderLoadTransport(world: World, ids: EntityId[], transportId: EntityId, by: PlayerId): void {
  const ship = world.units.get(transportId);
  if (!ship || ship.kind !== 'transport' || ship.owner !== by) { reject(world, 'invalid-target'); return; }
  const landing = landingAt(world, ship, ship.pos);
  if (!landing || dist(ship.pos, landing.land) > SHORE_REACH) { reject(world, 'unreachable'); return; }
  let room = TRANSPORT_CAPACITY - (ship.passengers?.length ?? 0) - [...world.boarding.values()].filter(id => id === ship.id).length;
  let sent = false;
  for (const id of [...new Set(ids)]) {
    const u = world.units.get(id);
    if (!u || u.owner !== by || isShip(u.kind) || isAnimal(u.kind) || u.state === 'garrisoned' || world.boarding.has(id)) continue;
    if (room <= 0) break;
    const path = route(world, u.owner, u.pos, landing.land); if (!path) continue;
    releaseCombat(world, [id]); world.gatherState.delete(id); world.buildState.delete(id);
    world.exploreState.delete(id); world.exploreQueue.delete(id); world.priestOrders.delete(id);
    u.path = path; u.gatherNode = null; u.gatherType = null; world.setState(u, 'moving');
    world.boarding.set(id, ship.id); room--; sent = true;
  }
  if (!sent) reject(world, room <= 0 ? 'occupied' : 'unreachable');
}
export function orderUnloadTransport(world: World, transportId: EntityId, target: Vec2, by: PlayerId): void {
  const ship = world.units.get(transportId);
  if (!ship || ship.kind !== 'transport' || ship.owner !== by || !ship.passengers?.length) { reject(world, 'invalid-target'); return; }
  const landing = landingAt(world, ship, target);
  if (!landing || !sail(world, ship, landing.water)) { reject(world, 'unreachable'); return; }
  world.landings.set(ship.id, landing);
}

/** Fish/trade deliveries and transport boarding all advance at fixed sim ticks and persist in saves. */
export function navalSystem(world: World, dt: number): void {
  for (const [id, job] of world.navalJobs) {
    const u = world.units.get(id); if (!u || !isShip(u.kind) || u.state === 'garrisoned') { world.navalJobs.delete(id); continue; }
    let home = world.buildings.get(job.home);
    if (!home?.complete || home.kind !== 'dock' || home.owner !== u.owner) {
      home = ownDock(world, u) ?? undefined;
      if (!home) { world.navalJobs.delete(id); u.path = []; world.setState(u, 'idle'); continue; }
      job.home = home.id;
    }
    if (job.type === 'trade') {
      const partner = world.buildings.get(job.partner);
      if (!partner?.complete || partner.kind !== 'dock' || world.areEnemies(u.owner, partner.owner) || home.id === partner.id) {
        world.navalJobs.delete(id); u.path = []; world.setState(u, 'idle'); continue;
      }
      const destination = job.phase === 'out' ? partner : home; const p = dockApproach(world, destination, u.pos);
      if (!p) { world.navalJobs.delete(id); continue; }
      if (u.path.length || dist(u.pos, p) > 1.2) { if (!u.path.length) sail(world, u, p); continue; }
      if (job.phase === 'back') {
        const d = dist(home.pos, partner.pos); const gold = Math.round(MARKET.goldPerDistance * d * d / MARKET.tradeRefDistance);
        world.stockOf(u.owner).gold += gold; world.events.emit({ type: 'traded', owner: u.owner, id: u.id, gold });
        if (u.owner === world.localPlayer) world.emitStock();
      }
      job.phase = job.phase === 'out' ? 'back' : 'out'; const next = dockApproach(world, job.phase === 'out' ? partner : home, u.pos);
      if (next) sail(world, u, next); continue;
    }
    if (job.phase === 'back') {
      const p = dockApproach(world, home, u.pos);
      if (!p) { world.navalJobs.delete(id); continue; }
      if (u.path.length || dist(u.pos, p) > 1.2) { if (!u.path.length) sail(world, u, p, 'toDrop'); continue; }
      world.stockOf(u.owner).food += u.carry?.amount ?? 0; u.carry = null;
      if (u.owner === world.localPlayer) world.emitStock();
      job.phase = 'out';
    }
    let node = world.nodes.get(job.source);
    if (!node || node.amount <= 0) {
      node = [...world.nodes.values()].filter(n => n.kind === 'fish' && n.amount > 0 && world.hf.isWater(n.pos.x, n.pos.z)
        && world.visibilityOf(u.owner).isExplored(n.pos.x, n.pos.z) && world.waterNav.connected(u.pos, n.pos))
        .sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos) || a.id - b.id)[0];
      if (!node) { world.navalJobs.delete(id); u.path = []; world.setState(u, 'idle'); continue; }
      job.source = node.id; u.gatherNode = node.id;
    }
    if (dist(u.pos, node.pos) > 1.2) { if (!u.path.length) sail(world, u, node.pos, 'toNode'); continue; }
    u.path = []; world.setState(u, 'gathering'); job.timer += dt * FISHING_RATE;
    const amount = Math.min(Math.floor(job.timer), node.amount, FISHING_CAPACITY - (u.carry?.amount ?? 0));
    if (amount > 0) { job.timer -= amount; node.amount -= amount; u.carry = { type: 'food', amount: (u.carry?.amount ?? 0) + amount }; }
    if (node.amount <= 0) { world.nodes.delete(node.id); world.events.emit({ type: 'removed', id: node.id }); }
    if ((u.carry?.amount ?? 0) >= FISHING_CAPACITY || node.amount <= 0) {
      job.phase = 'back'; const p = dockApproach(world, home, u.pos); if (p) sail(world, u, p, 'toDrop');
    }
  }
  for (const [id, shipId] of world.boarding) {
    const u = world.units.get(id), ship = world.units.get(shipId);
    if (!u || !ship || ship.owner !== u.owner || ship.kind !== 'transport' || (ship.passengers?.length ?? 0) >= TRANSPORT_CAPACITY) {
      world.boarding.delete(id); continue;
    }
    if (dist(u.pos, ship.pos) > SHORE_REACH) continue;
    u.path = []; u.shelter = ship.id; u.target = null; world.setState(u, 'garrisoned');
    (ship.passengers ??= []).push(u.id); world.boarding.delete(id);
  }
  for (const ship of world.units.values()) if (ship.kind === 'transport') {
    for (const id of ship.passengers ?? []) { const p = world.units.get(id); if (p) { p.pos = { ...ship.pos }; p.prevPos = { ...ship.prevPos }; } }
    const landing = world.landings.get(ship.id); if (!landing || ship.path.length || dist(ship.pos, landing.water) > 1.2) continue;
    const region = world.nav.regionAt(landing.land); const used: Vec2[] = [];
    const remaining: EntityId[] = [];
    for (const id of ship.passengers ?? []) {
      const u = world.units.get(id); if (!u) continue;
      const p = world.nav.nearestFreeCell(landing.land, region, pos => dist(pos, landing.water) <= SHORE_REACH + 2
        && used.every(a => dist(a, pos) > UNITS[u.kind].radius * 2 + 0.1));
      if (!p) { remaining.push(id); continue; }
      u.pos = { ...p }; u.prevPos = { ...p }; u.path = []; u.shelter = null; world.setState(u, 'idle'); used.push(p);
    }
    ship.passengers = remaining; world.landings.delete(ship.id); world.refreshFog();
  }
}
