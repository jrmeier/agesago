import { isShip } from '../../core/units';
import type { Stat } from '../../core/techs';
import type { Building, EntityId, ResourceNode, ResourceType, Unit, UnitState, Vec2 } from '../../core/types';
import { BALANCE } from '../balance';
import { rectDistance } from '../nav';
import type { World } from '../World';
import { unitStat } from './research';
import { route } from './passage';
import { cancelExplore, settleCancelled } from './explore';
import { buildingRect, inReach, nearestDrop, nodeInReach, nodePath } from './sites';

/** Per-unit gather bookkeeping kept off the frozen Unit shape. */
export interface GatherState {
  /** Seconds accumulated toward the next resource unit. */
  timer: number;
  /** Position of the node last assigned — the centre of the retarget search. */
  anchor: Vec2;
  /** Drop site the unit is walking to while 'toDrop'. */
  drop?: EntityId;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Stat names per resource, prebuilt so hot loops don't build strings. */
const CARRY_STAT: Record<ResourceType, Stat> = { wood: 'carry.wood', food: 'carry.food', gold: 'carry.gold', stone: 'carry.stone' };
const GATHER_STAT: Record<ResourceType, Stat> = { wood: 'gather.wood', food: 'gather.food', gold: 'gather.gold', stone: 'gather.stone' };

/** How much of `type` villager `u` can carry (BALANCE.carryCap plus its owner's research). */
export function carryCap(world: World, u: Unit, type: ResourceType): number {
  return Math.round(unitStat(world, u.owner, u.kind, CARRY_STAT[type], BALANCE.carryCap));
}

/** Seconds per resource unit for `u` on a node of `type` (farm: a farm field). */
export function gatherInterval(world: World, u: Unit, type: ResourceType, farm: boolean): number {
  if (farm) return BALANCE.farmInterval / unitStat(world, u.owner, u.kind, 'gather.farm', 1);
  return BALANCE.gatherIntervals[type] / unitStat(world, u.owner, u.kind, GATHER_STAT[type], 1);
}

/** States in which a farmer keeps its claim on a farm. */
const FARMING: ReadonlySet<UnitState> = new Set(['toNode', 'gathering', 'toDrop']);

/** A complete farm with food left. */
export function isWorkableFarm(b: Building | undefined): boolean {
  return !!b && b.kind === 'farm' && b.complete && (b.food ?? 0) > 0;
}

/** Nobody but `u` is working `farm` (stale claims — the farmer took another order — are dropped). */
export function farmFree(world: World, farm: Building, u: Unit): boolean {
  // Only the farm's owner may work it (a gather order on an enemy field must not harvest it).
  if (farm.owner !== u.owner) return false;
  const id = world.farmers.get(farm.id);
  if (id === undefined || id === u.id) return true;
  const f = world.units.get(id);
  if (f && f.gatherNode === farm.id && FARMING.has(f.state)) return false;
  world.farmers.delete(farm.id);
  return true;
}

/** 'gather' command: send every villager to work the node; scouts can't gather and just walk up to it. */
export function orderGather(world: World, unitIds: EntityId[], nodeId: EntityId): void {
  const node = world.nodes.get(nodeId);
  if (!node) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  const units = unitIds.map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
  const cancelled = cancelExplore(world, units);
  let sent = 0;
  for (const u of units) {
    if (sendToNode(world, u, node)) sent++;
  }
  settleCancelled(world, cancelled);
  if (unitIds.length && !sent) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/**
 * 'gather' on a farm: one villager works a farm at a time. The first villager takes this farm;
 * the rest take the nearest other free farms nearby, or ignore the order if there are none.
 */
export function orderFarm(world: World, unitIds: EntityId[], farm: Building): void {
  const units = unitIds
    .map((id) => world.units.get(id))
    .filter((u): u is Unit => !!u && u.kind === 'villager');
  const cancelled = cancelExplore(world, units);
  let sent = 0;
  for (const u of units) {
    if (farmFree(world, farm, u)) {
      if (sendToFarm(world, u, farm)) sent++;
      continue;
    }
    for (const f of nearestSources(world, 'food', farm.pos, u)) {
      if (f.kind === 'farm' && sendToFarm(world, u, f)) {
        sent++;
        break;
      }
    }
  }
  settleCancelled(world, cancelled);
  // Nobody took it: the farm is busy (or fallow / unreachable) and no other free farm is near.
  if (unitIds.length && !sent) world.events.emit({ type: 'rejected', reason: 'occupied' });
}

/** Plain move to the edge of `node` (for units that can't gather). False if unreachable. */
function walkToNode(world: World, u: Unit, node: ResourceNode): boolean {
  const path = nodePath(world, u, node);
  if (!path) return false;
  u.path = path;
  u.gatherNode = null;
  u.gatherType = null;
  world.gatherState.delete(u.id);
  world.setState(u, 'moving');
  return true;
}

/** Assign `node` to `u` and path to its edge (scouts just walk there). False (unit untouched) if unreachable. */
export function sendToNode(world: World, u: Unit, node: ResourceNode): boolean {
  if (u.kind !== 'villager') return walkToNode(world, u, node);
  const path = nodePath(world, u, node);
  if (!path) return false;
  assign(world, u, node.id, node.type, node.pos, path);
  return true;
}

/** Claim `farm` for `u` and walk onto its near edge. False (unit untouched) if taken, fallow or unreachable. */
export function sendToFarm(world: World, u: Unit, farm: Building): boolean {
  if (u.kind !== 'villager' || !isWorkableFarm(farm) || !farmFree(world, farm, u)) return false;
  const path = route(world, u.owner, u.pos, farmSpot(u.pos, farm));
  if (!path) return false;
  assign(world, u, farm.id, 'food', farm.pos, path);
  world.farmers.set(farm.id, u.id);
  return true;
}

function assign(world: World, u: Unit, id: EntityId, type: ResourceType, anchor: Vec2, path: Vec2[]): void {
  u.gatherNode = id;
  u.gatherType = type;
  u.path = path;
  world.gatherState.set(u.id, { timer: 0, anchor: { ...anchor } });
  world.setState(u, 'toNode');
}

/** Point inside the field nearest to `from`, BALANCE.farmInset in from the edge. */
function farmSpot(from: Vec2, farm: Building): Vec2 {
  const r = buildingRect(farm);
  const clamp = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));
  const i = BALANCE.farmInset;
  return { x: clamp(from.x, r.x0 + i, r.x1 - i), z: clamp(from.z, r.z0 + i, r.z1 - i) };
}

/** Arrivals for toNode / toDrop, then gathering progress. */
export function gatherSystem(world: World, dt: number, arrived: Unit[]): void {
  for (const u of arrived) {
    if (isShip(u.kind)) continue;
    if (u.state === 'toNode') arriveAtNode(world, u);
    else if (u.state === 'toDrop') deposit(world, u);
  }
  for (const u of world.units.values()) {
    if (!isShip(u.kind) && u.state === 'gathering') gatherTick(world, u, dt);
  }
}

/** Workable sources of `type` (nodes; for food also free farms) within BALANCE.retargetRadius of `from`, nearest first. */
export function nearestSources(world: World, type: ResourceType, from: Vec2, u: Unit): (ResourceNode | Building)[] {
  const out: { s: ResourceNode | Building; d: number }[] = [];
  const r = BALANCE.retargetRadius;
  for (const n of world.nodes.values()) {
    if (n.type !== type || n.amount <= 0) continue;
    const d = dist(n.pos, from);
    if (d <= r) out.push({ s: n, d });
  }
  if (type === 'food') {
    for (const b of world.buildings.values()) {
      if (b.owner !== u.owner || !isWorkableFarm(b) || !farmFree(world, b, u)) continue;
      const d = rectDistance(from, buildingRect(b));
      if (d <= r) out.push({ s: b, d });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((e) => e.s);
}

/** Send `u` to work a node or a farm. */
export function sendToSource(world: World, u: Unit, s: ResourceNode | Building): boolean {
  return 'type' in s ? sendToNode(world, u, s) : sendToFarm(world, u, s);
}

/** The assigned source is gone: drop off what's carried, else move to the nearest same-type source, else idle. */
function retarget(world: World, u: Unit): void {
  if (u.carry && u.carry.amount > 0) {
    sendToDrop(world, u);
    return;
  }
  const anchor = world.gatherState.get(u.id)?.anchor ?? u.pos;
  if (u.gatherType) {
    for (const s of nearestSources(world, u.gatherType, anchor, u)) if (sendToSource(world, u, s)) return;
  }
  goIdle(world, u);
}

function goIdle(world: World, u: Unit): void {
  u.path = [];
  u.gatherNode = null;
  u.gatherType = null;
  world.gatherState.delete(u.id);
  world.setState(u, 'idle');
}

/** The farm `u` is assigned to and still holds, if any. */
function farmOf(world: World, u: Unit): Building | undefined {
  const b = u.gatherNode !== null ? world.buildings.get(u.gatherNode) : undefined;
  return b && b.kind === 'farm' && b.complete && world.farmers.get(b.id) === u.id ? b : undefined;
}

function arriveAtNode(world: World, u: Unit): void {
  const node = u.gatherNode !== null ? world.nodes.get(u.gatherNode) : undefined;
  const farm = node ? undefined : farmOf(world, u);
  if (farm) {
    if (!inReach(u, farm)) {
      goIdle(world, u);
      return;
    }
    u.facing = Math.atan2(farm.pos.x - u.pos.x, farm.pos.z - u.pos.z);
    world.setState(u, 'gathering');
    return;
  }
  if (!node) {
    retarget(world, u);
    return;
  }
  if (!nodeInReach(world, u, node)) {
    goIdle(world, u);
    return;
  }
  u.facing = Math.atan2(node.pos.x - u.pos.x, node.pos.z - u.pos.z);
  world.setState(u, 'gathering');
}

function gatherTick(world: World, u: Unit, dt: number): void {
  const node = u.gatherNode !== null ? world.nodes.get(u.gatherNode) : undefined;
  const farm = node ? undefined : farmOf(world, u);
  if (!node && !isWorkableFarm(farm)) {
    if (farm) world.farmers.delete(farm.id);
    retarget(world, u);
    return;
  }
  const type: ResourceType = node ? node.type : 'food';
  const pos = node ? node.pos : farm!.pos;
  const interval = gatherInterval(world, u, type, !node);
  const cap = carryCap(world, u, type);
  let amount = node ? node.amount : farm!.food!;
  if (u.carry && u.carry.type !== type) u.carry = null;
  let gs = world.gatherState.get(u.id);
  if (!gs) world.gatherState.set(u.id, (gs = { timer: 0, anchor: { ...pos } }));
  if (!(u.carry && u.carry.amount >= cap)) {
    gs.timer += dt;
    while (gs.timer >= interval - 1e-9 && amount > 0) {
      gs.timer -= interval;
      amount -= 1;
      u.carry = { type, amount: (u.carry?.amount ?? 0) + 1 };
      if (u.carry.amount >= cap) break;
    }
  }
  if (node) {
    node.amount = amount;
    if (amount <= 0) {
      world.nodes.delete(node.id);
      world.events.emit({ type: 'removed', id: node.id });
    }
  } else {
    // A harvested-out farm stays as a fallow field (food 0) until reseeded.
    farm!.food = amount;
    world.events.emit({ type: 'farmFood', id: farm!.id, food: amount });
    if (amount <= 0) world.farmers.delete(farm!.id);
  }
  if ((u.carry && u.carry.amount >= cap) || amount <= 0) {
    gs.timer = 0;
    if (u.carry && u.carry.amount > 0) sendToDrop(world, u);
    else retarget(world, u);
  }
}

/** Walk to the nearest complete drop site accepting what `u` carries; idle if there is none. */
export function sendToDrop(world: World, u: Unit): void {
  const drop = u.carry ? nearestDrop(world, u.pos, u.carry.type, u.owner) : null;
  if (!drop) {
    goIdle(world, u);
    return;
  }
  u.path = drop.path;
  const gs = world.gatherState.get(u.id);
  if (gs) gs.drop = drop.b.id;
  else world.gatherState.set(u.id, { timer: 0, anchor: { ...u.pos }, drop: drop.b.id });
  world.setState(u, 'toDrop');
}

function deposit(world: World, u: Unit): void {
  const gs = world.gatherState.get(u.id);
  const site = gs?.drop !== undefined ? world.buildings.get(gs.drop) : undefined;
  if (!site || !site.complete) {
    // The drop site was removed on the way: head for the next one.
    if (u.carry && u.carry.amount > 0) sendToDrop(world, u);
    else retarget(world, u);
    return;
  }
  if (!inReach(u, site)) {
    goIdle(world, u);
    return;
  }
  if (gs) gs.drop = undefined;
  if (u.carry && u.carry.amount > 0) {
    world.stockOf(u.owner)[u.carry.type] += u.carry.amount;
    u.carry = null;
    if (u.owner === world.localPlayer) world.emitStock();
  }
  const node = u.gatherNode !== null ? world.nodes.get(u.gatherNode) : undefined;
  if (node && sendToNode(world, u, node)) return;
  const farm = farmOf(world, u);
  if (farm && sendToFarm(world, u, farm)) return;
  if (farm) world.farmers.delete(farm.id);
  retarget(world, u);
}
