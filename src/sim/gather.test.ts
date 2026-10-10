import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout, type SimEvent } from '../core/types';
import { BALANCE } from './balance';
import { World } from './World';
import { completeBuilding, layFoundation } from './systems/build';
import { nodeApproach, nodeInReach } from './systems/sites';

const DT = 1 / BALANCE.tickRate;

function field(water: (x: number, z: number) => boolean = () => false): Heightfield {
  return {
    width: 64, depth: 48, heightAt: () => 0.5,
    isWater: water,
    isWalkable: (x, z) => x >= 0 && x < 64 && z >= 0 && z < 48 && !water(x, z),
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

function setup(nodes: MapLayout['nodes'], hf = field()) {
  const world = new World(hf, {
    townCenter: { x: 10, z: 10 }, villagers: [{ x: 10, z: 20 }], scouts: [], props: [], nodes,
  });
  const worker = [...world.units.values()][0];
  const rejected: SimEvent[] = [];
  world.events.on('rejected', (e) => rejected.push(e));
  return { world, worker, rejected };
}

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) world.tick(DT);
}

describe('resource work routes', () => {
  it('uses another work side when an obstacle blocks the facing approach', () => {
    const { world, worker, rejected } = setup([{ kind: 'tree', pos: { x: 20, z: 20 }, amount: 100 }]);
    const tree = [...world.nodes.values()][0];
    world.nav.addRect(999, { x0: 18.7, x1: 20, z0: 18.5, z1: 21.5 });
    expect(world.nav.isFree(nodeApproach(world, worker.pos, tree)!)).toBe(false);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    expect(rejected).toEqual([]);
    expect(worker.state).toBe('toNode');
    expect(nodeInReach(world, { ...worker, pos: worker.path.at(-1)! }, tree)).toBe(true);
    run(world, 12);
    expect(tree.amount).toBeLessThan(100);
    expect(worker.state).not.toBe('idle');
  });

  it('uses an accessible side when the facing approach is on a disconnected land pocket', () => {
    const hf = field((x, z) => x >= 18 && x < 20 && z >= 19 && z < 21
      && !(x >= 18.5 && x < 19.5 && z >= 19.5 && z < 20.5));
    const { world, worker, rejected } = setup([{ kind: 'tree', pos: { x: 20.1, z: 20 }, amount: 100 }], hf);
    const tree = [...world.nodes.values()][0];
    const preferred = nodeApproach(world, worker.pos, tree)!;
    expect(world.nav.isFree(preferred)).toBe(true);
    expect(world.nav.connected(worker.pos, preferred)).toBe(false);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    expect(rejected).toEqual([]);
    expect(worker.state).toBe('toNode');
    expect(nodeInReach(world, { ...worker, pos: worker.path.at(-1)! }, tree)).toBe(true);
    run(world, 10);
    expect(tree.amount).toBeLessThan(100);
  });

  it('rejects an unreachable riverbank tree immediately instead of walking to a distant snapped cell', () => {
    const { world, worker, rejected } = setup([{ kind: 'tree', pos: { x: 24.1, z: 20 }, amount: 100 }],
      field((x) => x >= 20 && x <= 24));
    const tree = [...world.nodes.values()][0];
    const before = { ...worker.pos };
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    expect(rejected).toEqual([{ type: 'rejected', reason: 'unreachable' }]);
    expect(worker.path).toEqual([]);
    expect(worker.gatherNode).toBeNull();
    run(world, 10);
    expect(worker.pos).toEqual(before);
    expect(tree.amount).toBe(100);
  });

  it('rejects a resource surrounded by obstacles without replacing the current wood job', () => {
    const { world, worker, rejected } = setup([
      { kind: 'tree', pos: { x: 15, z: 20 }, amount: 100 },
      { kind: 'gold', pos: { x: 25, z: 20 }, amount: 100 },
    ]);
    const [tree, gold] = [...world.nodes.values()];
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    run(world, 4);
    const oldPath = worker.path;
    const oldState = worker.state;
    const oldGather = world.gatherState.get(worker.id);
    world.nav.addRect(999, { x0: 23, x1: 27, z0: 18, z1: 22 });
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: gold.id });
    expect(rejected).toEqual([{ type: 'rejected', reason: 'unreachable' }]);
    expect(worker.state).toBe(oldState);
    expect(worker.path).toBe(oldPath);
    expect(worker.gatherNode).toBe(tree.id);
    expect(world.gatherState.get(worker.id)).toBe(oldGather);
    run(world, 2);
    expect(tree.amount).toBeLessThan(100);
    expect(gold.amount).toBe(100);
  });

  it('honors enemy gate masks when choosing work spots and lets the gate owner through', () => {
    const { world, worker, rejected } = setup([{ kind: 'tree', pos: { x: 20, z: 20 }, amount: 100 }]);
    const tree = [...world.nodes.values()][0];
    const gate = layFoundation(world, 'gate', tree.pos, 0, 2);
    completeBuilding(world, gate);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    expect(rejected).toEqual([{ type: 'rejected', reason: 'unreachable' }]);
    expect(worker.path).toEqual([]);
    gate.owner = worker.owner;
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    expect(worker.state).toBe('toNode');
    run(world, 7);
    expect(tree.amount).toBeLessThan(100);
  });

  it('a valid gather, move and stop each supersede an existing wood assignment', () => {
    const { world, worker } = setup([
      { kind: 'tree', pos: { x: 15, z: 20 }, amount: 100 },
      { kind: 'gold', pos: { x: 16, z: 23 }, amount: 100 },
    ]);
    const [tree, gold] = [...world.nodes.values()];
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    run(world, 4);
    expect(worker.carry?.type).toBe('wood');
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: gold.id });
    expect(worker.gatherNode).toBe(gold.id);
    expect(worker.gatherType).toBe('gold');
    run(world, 4);
    expect(worker.carry?.type).toBe('gold');
    expect(gold.amount).toBeLessThan(100);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    world.dispatch({ type: 'move', unitIds: [worker.id], target: { x: 12, z: 24 } });
    expect(worker.state).toBe('moving');
    expect(worker.gatherNode).toBeNull();
    expect(world.gatherState.has(worker.id)).toBe(false);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    world.dispatch({ type: 'stop', unitIds: [worker.id] });
    expect(worker.state).toBe('idle');
    expect(worker.path).toEqual([]);
    expect(worker.gatherNode).toBeNull();
    expect(world.gatherState.has(worker.id)).toBe(false);
  });

  it('preserves nearest-shore fishing even when the fish is beyond land-node work range', () => {
    const { world, worker } = setup([{ kind: 'fish', pos: { x: 26, z: 20 }, amount: 100 }],
      field((x, z) => x >= 20 && x <= 30 && z >= 15 && z <= 25));
    const fish = [...world.nodes.values()][0];
    const shore = nodeApproach(world, worker.pos, fish)!;
    expect(Math.hypot(shore.x - fish.pos.x, shore.z - fish.pos.z)).toBeGreaterThan(3);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: fish.id });
    expect(worker.path.at(-1)).toEqual(shore);
    run(world, 60);
    expect(fish.amount).toBeLessThan(100);
    expect(world.stock.food).toBeGreaterThan(0);
  });

  it('keeps harvesting and depositing the selected tree through multiple normal cycles', () => {
    const { world, worker } = setup([{ kind: 'tree', pos: { x: 15, z: 20 }, amount: 100 }]);
    const tree = [...world.nodes.values()][0];
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: tree.id });
    run(world, 60);
    expect(world.stock.wood).toBeGreaterThanOrEqual(BALANCE.carryCap * 2);
    expect(worker.gatherNode).toBe(tree.id);
    expect(tree.amount).toBe(100 - world.stock.wood - (worker.carry?.amount ?? 0));
  });

  it('uses the same permitted fishing shore for route selection and arrival beside an enemy gate', () => {
    const { world, worker } = setup([{ kind: 'fish', pos: { x: 26, z: 20 }, amount: 100 }],
      field((x, z) => x >= 20 && x <= 30 && z >= 15 && z <= 25));
    const fish = [...world.nodes.values()][0];
    const shore = nodeApproach(world, worker.pos, fish)!;
    const gate = layFoundation(world, 'gate', shore, 0, 2);
    completeBuilding(world, gate);
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: fish.id });
    expect(worker.state).toBe('toNode');
    expect(worker.path.at(-1)).not.toEqual(shore);
    run(world, 30);
    expect(fish.amount).toBeLessThan(100);
  });
});
