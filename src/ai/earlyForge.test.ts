import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import type { Difficulty } from '../core/types';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { AIPlayer } from './AIPlayer';
import { snapshot, type Ctx } from './context';
import { makeGame, run } from './harness';

/** Town Age with production, free builders and enough stone to distract the old tower-first plan. */
function town(difficulty: Difficulty, wood = 150) {
  const world = makeGame(1, ['human', 'ai']);
  const p = world.players.get(2)!;
  p.age = 1;
  p.researched.add('townAge');
  const home = world.townCenterOf(2)!.pos;
  const barracks = layFoundation(world, 'barracks', { x: home.x + 9, z: home.z }, 0, 2);
  completeBuilding(world, barracks);
  Object.assign(world.stockOf(2), { food: 0, wood, gold: 0, stone: 100 });
  const ai = new AIPlayer(world, 2, { difficulty, seed: 1 });
  ai.intel.scan();
  ai.intel.refreshNodes();
  return { world, ai, pass: () => ai.research.pass(snapshot(world, 2)) };
}

const forges = (world: ReturnType<typeof makeGame>) => [...world.buildings.values()].filter((b) => b.owner === 2 && b.kind === 'forge');

describe('early Town Age forge (T123)', () => {
  it.each(['moderate', 'hard', 'hardest'] as const)('%s lays the forge before optional towers, then finishes it within 120 seconds', (difficulty) => {
    const { world, ai, pass } = town(difficulty);
    pass();
    expect(forges(world)).toHaveLength(1);
    expect([...world.buildings.values()].some((b) => b.owner === 2 && b.kind === 'watchTower')).toBe(false);
    run(world, [ai], 120);
    expect(forges(world)).toHaveLength(1);
    expect(forges(world)[0].complete).toBe(true);
    ai.dispose();
  });

  it('reserves a short forge cost against military production, then spends it on the forge', () => {
    const { world, ai, pass } = town('moderate', BUILDINGS.forge.cost.wood! - 1);
    // The first wave and emergency defenders deliberately bypass reserves; exercise normal
    // production with a full first wave and enough food/population for another soldier.
    const home = world.townCenterOf(2)!.pos;
    for (let i = 0; i < ai.profile.firstWave; i++) world.spawnUnit('hoplite', { x: home.x - 4, z: home.z + i / 2 }, 2);
    world.stockOf(2).food = 100;
    pass();
    ai.military.pass(snapshot(world, 2));
    expect(world.stockOf(2).wood).toBe(BUILDINGS.forge.cost.wood! - 1);
    world.stockOf(2).wood++;
    pass();
    expect(forges(world)).toHaveLength(1);
    expect(world.stockOf(2).wood).toBe(0);
    ai.dispose();
  });

  it('recognizes a forge just laid by the City Age prerequisite planner in the same pass', () => {
    const { world, ai, pass } = town('moderate', 300);
    const home = world.townCenterOf(2)!.pos;
    const villagers = snapshot(world, 2).villagers.length;
    for (let i = villagers; i < ai.profile.research!.cityAgeAt - 3; i++) {
      world.spawnUnit('villager', { x: home.x - 4, z: home.z + (i % 5) }, 2);
    }
    pass();
    expect(forges(world)).toHaveLength(1);
    ai.dispose();
  });

  it('does not duplicate a forge foundation while its builders work', () => {
    const { world, ai, pass } = town('moderate', 1000);
    pass();
    pass();
    expect(forges(world)).toHaveLength(1);
    ai.dispose();
  });

  it('funds the first forge before reserving wood for a second Town Center', () => {
    const { world, ai, pass } = town('hard');
    const ctx = (ai as unknown as { ctx: Ctx }).ctx;
    ctx.townReserve = { ...BUILDINGS.townCenter.cost };
    pass();
    expect(forges(world)).toHaveLength(1);
    expect(world.stockOf(2).wood).toBe(0);
    expect(ctx.townReserve).toEqual(BUILDINGS.townCenter.cost);
    ai.dispose();
  });
});
