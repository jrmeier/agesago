import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout } from '../core/types';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { defaultPlayers, World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { run } from './harness';

/** Flat open ground: the AI's Town Center at (20, 40), the enemy's far to the east. */
function arena(): World {
  const hf: Heightfield = {
    width: 150, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 150 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = {
    townCenter: { x: 20, z: 40 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 130, z: 40 }, villagers: [], scouts: [] }],
  };
  const players = defaultPlayers(2).map((p, i) => ({ ...p, control: i === 0 ? 'ai' as const : 'human' as const }));
  return new World(hf, layout, players);
}

function building(world: World, kind: Parameters<typeof layFoundation>[1], x: number, z: number) {
  const b = layFoundation(world, kind, { x, z }, 0, 1);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  return b;
}

describe('T120: raid defence', () => {
  it('engages raiders that split up between two buildings', () => {
    const world = arena();
    Object.assign(world.stockOf(1), { food: 0, wood: 0, gold: 0, stone: 0 });
    // Two drop sites 24 apart, three raiders on each: the raid's centroid has nobody within sight.
    const north = building(world, 'storehouse', 32, 28);
    const south = building(world, 'storehouse', 32, 52);
    const defenders = Array.from({ length: 8 }, (_, i) => world.spawnUnit('hoplite', { x: 24 + i % 4, z: 39 + Math.floor(i / 4) }, 1));
    const raid = [north, south].flatMap((b) => {
      const group = Array.from({ length: 3 }, (_, i) => world.spawnUnit('hoplite', { x: 35.5, z: b.pos.z - 1 + i }, 2));
      world.dispatch({ type: 'attack', unitIds: group.map((u) => u.id), targetId: b.id }, 2);
      return group;
    });
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed: 1, tune: { research: null, militaryQueue: 0, targetVillagers: 0 } });
    run(world, [ai], 90);
    const dead = raid.filter((u) => !world.units.has(u.id)).length;
    const alive = defenders.filter((u) => world.units.has(u.id)).length;
    console.log(`split raid: raiders dead ${dead}/6, defenders left ${alive}/8, storehouses ${world.buildings.has(north.id)}/${world.buildings.has(south.id)}`);
    expect(dead).toBe(6);
    ai.dispose();
  });

  it('spends the next food on a soldier, not a villager, while raiders outnumber the army at home', () => {
    const world = arena();
    Object.assign(world.stockOf(1), { food: 0, wood: 0, gold: 0, stone: 0 });
    const tc = world.townCenterOf(1)!;
    const barracks = building(world, 'barracks', 12, 30);
    const store = building(world, 'storehouse', 34, 40);
    for (const z of [50, 55]) building(world, 'house', 10, z);
    for (let i = 0; i < 6; i++) world.spawnUnit('villager', { x: 10 + i, z: 46 }, 1);
    const raid = Array.from({ length: 4 }, (_, i) => world.spawnUnit('hoplite', { x: 37.5, z: 38.5 + i }, 2));
    world.dispatch({ type: 'attack', unitIds: raid.map((u) => u.id), targetId: store.id }, 2);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed: 1, tune: { research: null } });
    // Past the reaction delay with nothing to spend, then one soldier's worth of food arrives.
    run(world, [ai], ai.profile.reaction + 2 * ai.profile.militaryInterval + 1);
    expect(tc.queue).toBe(0);
    expect(barracks.queue).toBe(0);
    Object.assign(world.stockOf(1), { food: 60, wood: 1000 });
    run(world, [ai], 2 * ai.profile.militaryInterval + 1);
    console.log(`raid food: barracks queue ${barracks.queue}, Town Center queue ${tc.queue}, food ${world.stockOf(1).food}`);
    expect(barracks.queue).toBe(1);
    expect(tc.queue).toBe(0);
    ai.dispose();
  });
});
