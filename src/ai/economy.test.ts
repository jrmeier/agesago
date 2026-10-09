import { describe, expect, it } from 'vitest';
import { BUILDINGS, MAX_POP } from '../core/buildings';
import type { BuildingKind } from '../core/types';
import { AIPlayer } from './AIPlayer';
import { dist } from './context';
import { makeGame, run } from './harness';

const DROP_SITES: BuildingKind[] = ['storehouse', 'granary', 'miningCamp'];
/** Sim minutes per game: enough to boom past 30 villagers and run the berries dry.
 *  A shore fish patch can push the first farm past 12 minutes; it still waits for the berries. */
const MINUTES = 15;
/** Longest pop-cap stall tolerated (sim seconds): the build pass runs every few seconds. */
const MAX_STALL = 10;
/** Berries this close to the Town Center count as the home berries. */
const HOME_BERRIES = 40;

describe('economy AI (moderate, headless)', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: booms, houses, drops, farms and scouts', (seed) => {
    const world = makeGame(seed, ['ai', 'human']);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed });
    const tc = world.townCenterOf(1)!;
    const scout = [...world.units.values()].find((u) => u.owner === 1 && u.kind === 'scout')!;
    const scoutStart = { ...scout.pos };
    const homeBerries = () => {
      let n = 0;
      for (const node of world.nodes.values()) if (node.kind === 'berry' && dist(node.pos, tc.pos) < HOME_BERRIES) n += node.amount;
      return n;
    };

    let aiMs = 0;
    let ticks = 0;
    let maxVillagers = 0;
    let scoutMoved = 0;
    let stall = 0;
    let maxStall = 0;
    let berriesAtFirstFarm: number | null = null;
    const stalled = () => {
      const pop = world.popOf(1);
      const cap = world.popCapOf(1);
      if (pop < cap || cap >= MAX_POP || world.stockOf(1).wood < BUILDINGS.house.cost.wood!) return false;
      for (const u of world.units.values()) if (u.owner === 1 && u.kind === 'villager' && u.state === 'idle') return true;
      return false;
    };

    for (let t = 0; t < MINUTES * 60; t++) {
      const st = run(world, [ai], 1);
      aiMs += st.aiMs.get(1)!;
      ticks += st.updates;
      let villagers = 0;
      for (const u of world.units.values()) if (u.owner === 1 && u.kind === 'villager') villagers++;
      maxVillagers = Math.max(maxVillagers, villagers);
      if (world.units.has(scout.id)) scoutMoved = Math.max(scoutMoved, dist(scout.pos, scoutStart));
      stall = stalled() ? stall + 1 : 0;
      maxStall = Math.max(maxStall, stall);
      if (berriesAtFirstFarm === null && [...world.buildings.values()].some((b) => b.owner === 1 && b.kind === 'farm')) {
        berriesAtFirstFarm = homeBerries();
      }
    }

    const drops = [...world.buildings.values()].filter((b) => b.owner === 1 && b.complete && DROP_SITES.includes(b.kind));
    const msPerTick = aiMs / ticks;
    console.log(
      `seed ${seed}: villagers ${maxVillagers}, pop ${world.popOf(1)}/${world.popCapOf(1)}, drop sites ${drops.length}, ` +
        `scout moved ${scoutMoved.toFixed(0)}, longest stall ${maxStall}s, berries at first farm ${berriesAtFirstFarm}, ` +
        `AI ${msPerTick.toFixed(4)} ms/tick`
    );

    expect(maxVillagers).toBeGreaterThanOrEqual(30);
    expect(maxStall).toBeLessThanOrEqual(MAX_STALL);
    expect(stalled()).toBe(false);
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(scoutMoved).toBeGreaterThan(10);
    // Fields come once the home berries are gone, not before.
    expect(berriesAtFirstFarm).toBe(0);
    expect(msPerTick).toBeLessThan(1);
    expect(ai.stats.commands).toBeGreaterThan(0);
    ai.dispose();
  }, 60_000);
});
