import { canWork } from '../../core/units';
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
  /** Player-chosen work area; automatic retargets never move this centre. */
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

/** Completed farms produce indefinitely, including exhausted farms from old saves. */
export function isWorkableFarm(b: Building | undefined): boolean {
  return !!b && b.kind === 'farm' && b.complete;
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

/** 'gather' command: send capable land units to work the node. */
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
 * 'gather' on a farm: one worker works a farm at a time. The first worker takes this farm;
 * the rest take nearby free farms, or stop if none are available.
 */
export function orderFarm(world: World, unitIds: EntityId[], farm: Building): void {
  if (!isWorkableFarm(farm)) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  const units = [...new Set(unitIds)]
    .map((id) => world.units.get(id))
    .filter((u): u is Unit => !!u && canWork(u.kind) && u.state !== 'garrisoned' && u.owner === farm.owner);
  const cancelled = cancelExplore(world, units);
  let unassigned = 0;
  for (const u of units) {
    if (sendToFarm(world, u, farm)) continue;
    const assigned = nearestSources(world, 'food', farm.pos, u)
      .some(f => !('type' in f) && f.kind === 'farm' && sendToFarm(world, u, f));
    // The explicit farm order replaces the old job even when every nearby field is busy.
    if (!assigned) {
      goIdle(world, u);
      unassigned++;
    }
  }
  settleCancelled(world, cancelled);
  if (unassigned || (unitIds.length && !units.length)) world.events.emit({ type: 'rejected', reason: 'occupied' });
}

/** Assign `node` to `u` and path to its edge. False (unit untouched) if unreachable. */
export function sendToNode(world: World, u: Unit, node: ResourceNode): boolean {
  if (node.amount <= 0) return false;
  if (!canWork(u.kind) || u.state === 'garrisoned') return false;
  const path = nodePath(world, u, node);
  if (!path) return false;
  assign(world, u, node.id, node.type, node.pos, path);
  return true;
}

/** Claim `farm` for `u` and walk onto its near edge. False (unit untouched) if taken, incomplete or unreachable. */
export function sendToFarm(world: World, u: Unit, farm: Building): boolean {
  if (!canWork(u.kind) || u.state === 'garrisoned' || !isWorkableFarm(farm) || !farmFree(world, farm, u)) return false;
  const path = route(world, u.owner, u.pos, farmSpot(u.pos, farm));
  if (!path || !inReach({ ...u, pos: path.at(-1) ?? u.pos }, farm)) return false;
  assign(world, u, farm.id, 'food', farm.pos, path);
  if (u.gatherNode === farm.id) world.farmers.set(farm.id, u.id);
  return true;
}

/** Release the previous economy job without destroying carried resources. */
export function clearEconomyJob(world: World, u: Unit): void {
  if (u.gatherNode !== null && world.farmers.get(u.gatherNode) === u.id) world.farmers.delete(u.gatherNode);
  u.gatherNode = null;
  u.gatherType = null;
  u.target = null;
  world.gatherState.delete(u.id);
  world.buildState.delete(u.id);
}

function assign(world: World, u: Unit, id: EntityId, type: ResourceType, anchor: Vec2, path: Vec2[]): void {
  clearEconomyJob(world, u);
  u.gatherNode = id;
  u.gatherType = type;
  u.path = path;
  world.gatherState.set(u.id, { timer: 0, anchor: { ...anchor } });
  world.setState(u, 'toNode');
  if (u.carry && u.carry.amount > 0 && u.carry.type !== type) sendToDrop(world, u);
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
    if (!canWork(u.kind)) continue;
    if (u.state === 'toNode') arriveAtNode(world, u);
    else if (u.state === 'toDrop') deposit(world, u);
  }
  for (const u of world.units.values()) {
    if (canWork(u.kind) && u.state === 'gathering') gatherTick(world, u, dt);
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
    for (const s of nearestSources(world, u.gatherType, anchor, u)) {
      if (resumeSource(world, u, s, anchor)) return;
    }
  }
  goIdle(world, u);
}

/** Restore interrupted work before depositing, so cargo never erases the chosen job. */
export function resumeGatherJob(world: World, u: Unit, nodeId: EntityId | null, type: ResourceType, anchor: Vec2): void {
  u.gatherNode = nodeId;
  u.gatherType = type;
  world.gatherState.set(u.id, { timer: 0, anchor: { ...anchor } });
  const node = nodeId !== null ? world.nodes.get(nodeId) : undefined;
  const farm = nodeId !== null ? world.buildings.get(nodeId) : undefined;
  if (farm && isWorkableFarm(farm) && farmFree(world, farm, u)) world.farmers.set(farm.id, u.id);
  if (u.carry && u.carry.amount > 0 && (u.carry.type !== type || u.carry.amount >= carryCap(world, u, type))) {
    sendToDrop(world, u);
    return;
  }
  if (node && resumeSource(world, u, node, anchor)) return;
  if (farm && resumeSource(world, u, farm, anchor)) return;
  retarget(world, u);
}

/** Resume the current job without turning an automatic trip into a new work area. */
function resumeSource(world: World, u: Unit, source: ResourceNode | Building, anchor: Vec2): boolean {
  if (!sendToSource(world, u, source)) return false;
  const gs = world.gatherState.get(u.id);
  if (gs) gs.anchor = { ...anchor };
  return true;
}

function goIdle(world: World, u: Unit): void {
  clearEconomyJob(world, u);
  u.path = [];
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
  let amount = node ? node.amount : Infinity;
  if (u.carry && u.carry.amount > 0 && u.carry.type !== type) {
    sendToDrop(world, u);
    return;
  }
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
  const anchor = gs?.anchor ?? u.pos;
  if (node && resumeSource(world, u, node, anchor)) return;
  const farm = farmOf(world, u);
  if (farm && resumeSource(world, u, farm, anchor)) return;
  if (farm) world.farmers.delete(farm.id);
  retarget(world, u);
}
