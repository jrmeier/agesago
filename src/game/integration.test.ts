import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, type NodeKind, type ResourceNode } from '../core/types';
import { BALANCE } from '../sim/balance';
import { generateMap } from '../sim/mapgen';
import { World } from '../sim/World';

function nearest(world: World, kind: NodeKind): ResourceNode {
  const tc = world.townCenter.pos;
  return [...world.nodes.values()]
    .filter((n) => n.kind === kind)
    .sort((a, b) => Math.hypot(a.pos.x - tc.x, a.pos.z - tc.z) - Math.hypot(b.pos.x - tc.x, b.pos.z - tc.z))[0];
}

function run(world: World, seconds: number) {
  const dt = 1 / BALANCE.tickRate;
  for (let t = 0; t < seconds; t += dt) world.tick(dt);
}

describe('generated map + sim', () => {
  it('starting villagers stand outside the Town Center footprint', () => {
    const { hf, layout } = generateMap(DEFAULT_SEED);
    const world = new World(hf, layout);
    for (const u of world.units.values()) {
      expect(Math.hypot(u.pos.x - layout.townCenter.x, u.pos.z - layout.townCenter.z)).toBeGreaterThan(
        BALANCE.townCenterRadius + BALANCE.villagerRadius
      );
    }
  });

  it('villagers gather every resource type and can train from food', () => {
    const { hf, layout } = generateMap(DEFAULT_SEED);
    const world = new World(hf, layout);
    const [a, b, c] = [...world.units.keys()];
    world.dispatch({ type: 'gather', unitIds: [a], nodeId: nearest(world, 'tree').id });
    world.dispatch({ type: 'gather', unitIds: [b], nodeId: nearest(world, 'berry').id });
    world.dispatch({ type: 'gather', unitIds: [c], nodeId: nearest(world, 'gold').id });
    run(world, 120);
    expect(world.stock.wood).toBeGreaterThan(0);
    expect(world.stock.food).toBeGreaterThanOrEqual(BALANCE.trainCost.food);
    expect(world.stock.gold).toBeGreaterThan(0);

    world.dispatch({ type: 'train', buildingId: world.townCenter.id });
    run(world, BALANCE.trainTime + 1);
    expect(world.pop).toBe(4);
  });
});
