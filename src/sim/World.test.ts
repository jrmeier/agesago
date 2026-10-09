import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, GRASS_ONLY, type Heightfield, type MapLayout, type SimEvent, type Vec2 } from '../core/types';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { World } from './World';

const DT = 1 / BALANCE.tickRate;

/** Flat 64×48 field where `water(x, z)` marks lake cells. */
function flatField(water: (x: number, z: number) => boolean = () => false): Heightfield {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x <= 64 && z <= 48;
  return {
    width: 64,
    depth: 48,
    heightAt: (x, z) => (water(x, z) ? -1 : 0.5),
    isWater: water,
    isWalkable: (x, z) => inside(x, z) && !water(x, z),
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function layout(villagers: Vec2[], nodes: MapLayout['nodes'] = []): MapLayout {
  return { townCenter: { x: 32, z: 24 }, villagers, scouts: [], nodes, props: [] };
}

function record(world: World): SimEvent[] {
  const log: SimEvent[] = [];
  for (const t of ['spawned', 'removed', 'stockpile', 'unitState', 'trainProgress', 'rejected'] as const) {
    world.events.on(t, (e) => log.push(e));
  }
  return log;
}

function run(world: World, seconds: number, each?: () => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    world.tick(DT);
    each?.();
  }
}

const firstId = (m: Map<number, unknown>) => m.keys().next().value as number;

describe('World (contract smoke test)', () => {
  it('builds from the generated map', () => {
    const { hf, layout } = generateMap(DEFAULT_SEED);
    const world = new World(hf, layout);
    expect(world.pop).toBe(layout.villagers.length + layout.scouts.length);
    expect(world.villagerCount).toBe(layout.villagers.length);
    expect(world.nodes.size).toBe(layout.nodes.length);
    expect(world.townCenter.kind).toBe('townCenter');
  });
});

describe('gathering', () => {
  it('fills to carry cap, walks to the TC, and stock rises only on deposit by carryCap', () => {
    const world = new World(flatField(), layout([{ x: 32, z: 28.5 }], [{ kind: 'tree', pos: { x: 38, z: 28 }, amount: 100 }]));
    const log = record(world);
    const u = world.units.get(firstId(world.units))!;
    const tree = firstId(world.nodes);
    world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree });
    expect(u.state).toBe('toNode');

    let lastWood = 0;
    let deposits = 0;
    let maxCarry = 0;
    run(world, 60, () => {
      maxCarry = Math.max(maxCarry, u.carry?.amount ?? 0);
      if (world.stock.wood !== lastWood) {
        expect(world.stock.wood - lastWood).toBe(BALANCE.carryCap);
        expect(log.filter((e) => e.type === 'stockpile').pop()).toMatchObject({ stock: { wood: world.stock.wood } });
        expect(u.carry).toBeNull();
        expect(Math.hypot(u.pos.x - 32, u.pos.z - 24)).toBeLessThan(BALANCE.townCenterRadius + 1.5);
        lastWood = world.stock.wood;
        deposits++;
      }
    });
    expect(deposits).toBeGreaterThanOrEqual(2);
    expect(maxCarry).toBe(BALANCE.carryCap);
    const states = log.filter((e) => e.type === 'unitState').map((e) => (e as { state: string }).state);
    expect(states.slice(0, 4)).toEqual(['toNode', 'gathering', 'toDrop', 'toNode']);
    expect(world.nodes.get(tree)!.amount).toBe(100 - world.stock.wood - (u.carry?.amount ?? 0));
  });

  it('retargets the nearest same-type node when its node is depleted', () => {
    const world = new World(
      flatField(),
      layout(
        [{ x: 32, z: 28.5 }],
        [
          { kind: 'tree', pos: { x: 38, z: 28 }, amount: 5 },
          { kind: 'berry', pos: { x: 39, z: 29 }, amount: 100 },
          { kind: 'tree', pos: { x: 47, z: 33 }, amount: 100 },
          { kind: 'tree', pos: { x: 44, z: 31 }, amount: 100 },
        ]
      )
    );
    const log = record(world);
    const u = world.units.get(firstId(world.units))!;
    const [first, , far, near] = [...world.nodes.keys()];
    world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: first });
    run(world, 30);
    expect(log).toContainEqual({ type: 'removed', id: first });
    expect(world.nodes.has(first)).toBe(false);
    expect(world.stock.wood).toBeGreaterThanOrEqual(5);
    expect(u.gatherNode).toBe(near);
    expect(u.gatherType).toBe('wood');
    expect(world.nodes.get(far)!.amount).toBe(100);
  });

  it('goes idle when no same-type node is within range', () => {
    const world = new World(
      flatField(),
      layout(
        [{ x: 32, z: 28.5 }],
        [
          { kind: 'tree', pos: { x: 38, z: 28 }, amount: 5 },
          { kind: 'tree', pos: { x: 5, z: 5 }, amount: 100 },
        ]
      )
    );
    const u = world.units.get(firstId(world.units))!;
    world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: firstId(world.nodes) });
    run(world, 30);
    expect(world.stock.wood).toBe(5);
    expect(u.state).toBe('idle');
    expect(u.gatherNode).toBeNull();
  });

  it('resets carry when switching resource type', () => {
    const world = new World(
      flatField(),
      layout([{ x: 32, z: 28.5 }], [
        { kind: 'tree', pos: { x: 38, z: 28 }, amount: 100 },
        { kind: 'gold', pos: { x: 30, z: 32 }, amount: 100 },
      ])
    );
    const u = world.units.get(firstId(world.units))!;
    const [tree, gold] = [...world.nodes.keys()];
    world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree });
    while (!(u.carry && u.carry.amount >= 3)) world.tick(DT);
    world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: gold });
    while (u.state !== 'gathering') world.tick(DT);
    world.tick(DT);
    expect(u.carry === null || u.carry.type === 'gold').toBe(true);
    run(world, 2);
    expect(u.carry!.type).toBe('gold');
    expect(world.stock.wood).toBe(0);
  });

  it('rejects a gather order on a missing node', () => {
    const world = new World(flatField(), layout([{ x: 32, z: 28.5 }]));
    const log = record(world);
    world.dispatch({ type: 'gather', unitIds: [firstId(world.units)], nodeId: 999 });
    expect(log).toEqual([{ type: 'rejected', reason: 'invalid-target' }]);
  });
});

describe('training', () => {
  it('rejects at 49 food, accepts at 50 and spawns after trainTime', () => {
    const world = new World(flatField(), layout([{ x: 32, z: 28.5 }]));
    const log = record(world);
    const tc = world.townCenter;
    world.stock.food = 49;
    world.dispatch({ type: 'train', buildingId: tc.id });
    expect(log).toEqual([{ type: 'rejected', reason: 'insufficient-food' }]);
    expect(tc.queue).toBe(0);

    world.stock.food = 50;
    world.dispatch({ type: 'train', buildingId: tc.id });
    expect(world.stock.food).toBe(0);
    expect(tc.queue).toBe(1);

    run(world, BALANCE.trainTime - 0.1);
    expect(world.pop).toBe(1);
    expect(log.filter((e) => e.type === 'trainProgress').length).toBeGreaterThan(100);
    run(world, 0.1);
    expect(world.pop).toBe(2);
    expect(tc.queue).toBe(0);
    const spawned = log.find((e) => e.type === 'spawned');
    expect(spawned).toMatchObject({ kind: 'villager' });
    const v = world.units.get((spawned as { id: number }).id)!;
    expect(world.nav.isFree(v.pos)).toBe(true);
    expect(Math.hypot(v.pos.x - 32, v.pos.z - 24)).toBeLessThan(tc.radius + 1.5);
    expect(log.filter((e) => e.type === 'stockpile').pop()).toMatchObject({ pop: 2 });
  });

  it('enforces the pop cap counting queued villagers', () => {
    // The Town Center alone houses 5.
    const villagers = Array.from({ length: 4 }, (_, i) => ({ x: 4 + i * 2, z: 40 }));
    const world = new World(flatField(), layout(villagers));
    const log = record(world);
    world.stock.food = 500;
    world.dispatch({ type: 'train', buildingId: world.townCenter.id });
    world.dispatch({ type: 'train', buildingId: world.townCenter.id });
    expect(world.townCenter.queue).toBe(1);
    expect(world.stock.food).toBe(450);
    expect(log).toContainEqual({ type: 'rejected', reason: 'pop-cap' });
  });
});

describe('movement', () => {
  const lake = (x: number, z: number) => x >= 40 && x <= 50 && z >= 10 && z <= 38;

  it('a move order into water walks to the nearest shore', () => {
    const hf = flatField(lake);
    const world = new World(hf, layout([{ x: 30, z: 30 }]));
    const log = record(world);
    const u = world.units.get(firstId(world.units))!;
    world.dispatch({ type: 'move', unitIds: [u.id], target: { x: 43, z: 30 } });
    expect(log.some((e) => e.type === 'rejected')).toBe(false);
    run(world, 15);
    expect(u.state).toBe('idle');
    expect(hf.isWalkable(u.pos.x, u.pos.z)).toBe(true);
    expect(u.pos.x).toBeGreaterThan(39);
    expect(u.pos.x).toBeLessThan(40);
  });

  it('rejects a move into an enclosed area', () => {
    const ring = (x: number, z: number) => {
      const d = Math.hypot(x - 50, z - 24);
      return d > 4 && d < 7;
    };
    const world = new World(flatField(ring), layout([{ x: 30, z: 30 }]));
    const log = record(world);
    world.dispatch({ type: 'move', unitIds: [firstId(world.units)], target: { x: 50, z: 24 } });
    expect(log).toEqual([{ type: 'rejected', reason: 'unreachable' }]);
  });

  it('spreads a group over distinct destinations and stops their gathering', () => {
    const starts = Array.from({ length: 6 }, (_, i) => ({ x: 26 + i, z: 30 }));
    const world = new World(flatField(), layout(starts, [{ kind: 'berry', pos: { x: 24, z: 34 }, amount: 100 }]));
    const ids = [...world.units.keys()];
    world.dispatch({ type: 'gather', unitIds: ids, nodeId: firstId(world.nodes) });
    run(world, 1);
    world.dispatch({ type: 'move', unitIds: ids, target: { x: 12, z: 10 } });
    run(world, 20);
    const units = [...world.units.values()];
    for (const u of units) {
      expect(u.state).toBe('idle');
      expect(u.gatherNode).toBeNull();
      expect(Math.hypot(u.pos.x - 12, u.pos.z - 10)).toBeLessThan(2);
    }
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        expect(Math.hypot(units[i].pos.x - units[j].pos.x, units[i].pos.z - units[j].pos.z)).toBeGreaterThan(0.4);
      }
    }
  });

  it('paths around the TC footprint and updates prevPos / facing', () => {
    const world = new World(flatField(), layout([{ x: 26, z: 24 }]));
    const u = world.units.get(firstId(world.units))!;
    world.dispatch({ type: 'move', unitIds: [u.id], target: { x: 38, z: 24 } });
    let minD = Infinity;
    run(world, 8, () => {
      minD = Math.min(minD, Math.hypot(u.pos.x - 32, u.pos.z - 24));
      const step = Math.hypot(u.pos.x - u.prevPos.x, u.pos.z - u.prevPos.z);
      expect(step).toBeLessThanOrEqual(BALANCE.villagerSpeed * DT + 1e-9);
    });
    expect(minD).toBeGreaterThan(BALANCE.townCenterRadius);
    expect(u.pos).toEqual({ x: 38, z: 24 });
    expect(u.state).toBe('idle');
  });

  it('paths around blocking scenery but walks through walk-through props', () => {
    const base = layout([{ x: 20, z: 24 }]);
    const blocked = new World(flatField(), {
      ...base,
      props: [
        { kind: 'boulder', pos: { x: 26, z: 24 }, rot: 0, scale: 1, blockRadius: 1.2 },
        { kind: 'reeds', pos: { x: 23, z: 24 }, rot: 0, scale: 1, blockRadius: 0 },
      ],
    });
    expect(blocked.nav.isFree({ x: 26, z: 24 })).toBe(false);
    expect(blocked.nav.isFree({ x: 23, z: 24 })).toBe(true);
  });
});
