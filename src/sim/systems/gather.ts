import type { EntityId, ResourceNode, ResourceType, Unit, Vec2 } from '../../core/types';
import { BALANCE } from '../balance';
import type { World } from '../World';

/** Per-unit gather bookkeeping kept off the frozen Unit shape. */
export interface GatherState {
  /** Seconds accumulated toward the next resource unit. */
  timer: number;
  /** Position of the node last assigned — the centre of the retarget search. */
  anchor: Vec2;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** 'gather' command: send every unit to the node. */
export function orderGather(world: World, unitIds: EntityId[], nodeId: EntityId): void {
  const node = world.nodes.get(nodeId);
  if (!node) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  let sent = 0;
  for (const id of unitIds) {
    const u = world.units.get(id);
    if (u && sendToNode(world, u, node)) sent++;
  }
  if (unitIds.length && !sent) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/** Assign `node` to `u` and path to its edge. False (unit untouched) if unreachable. */
export function sendToNode(world: World, u: Unit, node: ResourceNode): boolean {
  const path = world.nav.findPath(u.pos, world.approachPoint(u.pos, node.pos, node.radius));
  if (!path) return false;
  u.gatherNode = node.id;
  u.gatherType = node.type;
  u.path = path;
  world.gatherState.set(u.id, { timer: 0, anchor: { ...node.pos } });
  world.setState(u, 'toNode');
  return true;
}

/** Arrivals for toNode / toDrop, then gathering progress. */
export function gatherSystem(world: World, dt: number, arrived: Unit[]): void {
  for (const u of arrived) {
    if (u.state === 'toNode') arriveAtNode(world, u);
    else if (u.state === 'toDrop') deposit(world, u);
  }
  for (const u of world.units.values()) {
    if (u.state === 'gathering') gatherTick(world, u, dt);
  }
}

/** Nodes of `type` within BALANCE.retargetRadius of `from`, nearest first. */
function nearestNodes(world: World, type: ResourceType, from: Vec2): ResourceNode[] {
  return [...world.nodes.values()]
    .filter((n) => n.type === type && n.amount > 0 && dist(n.pos, from) <= BALANCE.retargetRadius)
    .sort((a, b) => dist(a.pos, from) - dist(b.pos, from));
}

/** The assigned node is gone: drop off what's carried, else move to the nearest same-type node, else idle. */
function retarget(world: World, u: Unit): void {
  if (u.carry && u.carry.amount > 0) {
    sendToDrop(world, u);
    return;
  }
  const anchor = world.gatherState.get(u.id)?.anchor ?? u.pos;
  if (u.gatherType) {
    for (const n of nearestNodes(world, u.gatherType, anchor)) if (sendToNode(world, u, n)) return;
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

function arriveAtNode(world: World, u: Unit): void {
  const node = u.gatherNode !== null ? world.nodes.get(u.gatherNode) : undefined;
  if (!node) {
    retarget(world, u);
    return;
  }
  if (dist(u.pos, node.pos) > node.radius + BALANCE.villagerRadius + BALANCE.reach) {
    goIdle(world, u);
    return;
  }
  u.facing = Math.atan2(node.pos.x - u.pos.x, node.pos.z - u.pos.z);
  world.setState(u, 'gathering');
}

function gatherTick(world: World, u: Unit, dt: number): void {
  const node = u.gatherNode !== null ? world.nodes.get(u.gatherNode) : undefined;
  if (!node) {
    retarget(world, u);
    return;
  }
  if (u.carry && u.carry.type !== node.type) u.carry = null;
  let gs = world.gatherState.get(u.id);
  if (!gs) world.gatherState.set(u.id, (gs = { timer: 0, anchor: { ...node.pos } }));
  if (!(u.carry && u.carry.amount >= BALANCE.carryCap)) {
    gs.timer += dt;
    while (gs.timer >= BALANCE.gatherInterval - 1e-9 && node.amount > 0) {
      gs.timer -= BALANCE.gatherInterval;
      node.amount -= 1;
      u.carry = { type: node.type, amount: (u.carry?.amount ?? 0) + 1 };
      if (u.carry.amount >= BALANCE.carryCap) break;
    }
  }
  if (node.amount <= 0) {
    world.nodes.delete(node.id);
    world.events.emit({ type: 'removed', id: node.id });
  }
  if ((u.carry && u.carry.amount >= BALANCE.carryCap) || node.amount <= 0) {
    gs.timer = 0;
    sendToDrop(world, u);
  }
}

function sendToDrop(world: World, u: Unit): void {
  const tc = world.townCenter;
  const path = world.nav.findPath(u.pos, world.approachPoint(u.pos, tc.pos, tc.radius));
  if (!path) {
    goIdle(world, u);
    return;
  }
  u.path = path;
  world.setState(u, 'toDrop');
}

function deposit(world: World, u: Unit): void {
  const tc = world.townCenter;
  if (dist(u.pos, tc.pos) > tc.radius + BALANCE.villagerRadius + BALANCE.reach) {
    goIdle(world, u);
    return;
  }
  if (u.carry && u.carry.amount > 0) {
    world.stock[u.carry.type] += u.carry.amount;
    u.carry = null;
    world.emitStock();
  }
  const node = u.gatherNode !== null ? world.nodes.get(u.gatherNode) : undefined;
  if (node && sendToNode(world, u, node)) return;
  retarget(world, u);
}
