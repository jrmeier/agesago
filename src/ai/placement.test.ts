import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout, type Vec2 } from '../core/types';
import { generateMap } from '../sim/mapgen';
import { defaultPlayers, World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { run } from './harness';
import { Intel } from './intel';
import { findSpot, type SpotQuery } from './placement';

const W = 160, D = 80;
const image = (p: Vec2): Vec2 => ({ x: W - p.x, z: D - p.z });

/** Flat open ground, the two Town Centers images of each other under a half-turn about the centre. */
function arena(): World {
  const hf: Heightfield = {
    width: W, depth: D, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= W && z <= D,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const west = { x: 30, z: 38 };
  const layout: MapLayout = {
    townCenter: west, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: image(west), villagers: [], scouts: [] }],
  };
  return new World(hf, layout, defaultPlayers(2));
}

describe('AI building spots (T119)', () => {
  it('a half-turned search finds the image of the unturned one', () => {
    const world = arena();
    const intel = [1, 2].map((p) => { const i = new Intel(world, p as 1 | 2, true); i.refreshNodes(); return i; });
    const west = world.townCenterOf(1)!.pos, east = world.townCenterOf(2)!.pos;
    expect(east).toEqual(image(west));
    const toward = { x: 1, z: 0 };
    const queries: Omit<SpotQuery, 'center'>[] = [
      { kind: 'house', minR: 5, maxR: 16, clearOfNodes: 1, gap: 1 },
      { kind: 'barracks', minR: 9, maxR: 20, clearOfNodes: 3, gap: 1.5, toward, bias: 8 },
      { kind: 'storehouse', minR: 6, maxR: 18, clearOfNodes: 1, gap: 1 },
    ];
    for (const q of queries) {
      const a = findSpot(world, intel[0], 1, { ...q, center: west, turns: 0 });
      const mirroredToward = q.toward && { x: -q.toward.x, z: -q.toward.z };
      const b = findSpot(world, intel[1], 2, { ...q, center: east, toward: mirroredToward, turns: 2 });
      expect(a, q.kind).not.toBeNull();
      expect(b, q.kind).toEqual(image(a!));
      // Unturned, the east search starts on the same compass side as the west one: not the image.
      const unturned = findSpot(world, intel[1], 2, { ...q, center: east, toward: mirroredToward });
      if (!q.toward) expect(unturned, q.kind).not.toEqual(image(a!));
    }
  });

  it('turns default to 0: the scan starts at +x as before', () => {
    const world = arena();
    const intel = new Intel(world, 1, true);
    intel.refreshNodes();
    const q: SpotQuery = { kind: 'house', center: world.townCenterOf(1)!.pos, minR: 6, maxR: 16, clearOfNodes: 1, gap: 1 };
    const spot = findSpot(world, intel, 1, q)!;
    expect(spot).toEqual(findSpot(world, intel, 1, { ...q, turns: 0 }));
    expect(spot.x).toBeGreaterThan(q.center.x);
    expect(spot.z).toBe(q.center.z);
    // A quarter-turn moves the first choice from +x to +z, a half-turn to -x.
    expect(findSpot(world, intel, 1, { ...q, turns: 1 })).toEqual({ x: q.center.x, z: q.center.z + (spot.x - q.center.x) });
    expect(findSpot(world, intel, 1, { ...q, turns: 2 })).toEqual({ x: q.center.x - (spot.x - q.center.x), z: q.center.z });
  });

  it('both seats of the mirrored default map lay out the same town', () => {
    for (const seed of [1, 2]) {
      const { hf, layout } = generateMap(seed, 2);
      const players = defaultPlayers(2, ['romans', 'romans']).map((p) => ({ ...p, control: 'ai' as const }));
      const world = new World(hf, layout, players);
      // The same AI seed for both: the two sides differ only in where they stand.
      const ais = players.map((p) => new AIPlayer(world, p.id, { difficulty: 'moderate', seed: 7 }));
      run(world, ais, 60);
      const town = (owner: number, turned: boolean) => [...world.buildings.values()].filter((b) => b.owner === owner)
        .map((b) => `${b.kind} ${(turned ? hf.width - b.pos.x : b.pos.x).toFixed(1)} ${(turned ? hf.depth - b.pos.z : b.pos.z).toFixed(1)}`).sort();
      expect(town(1, false).length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(town(2, true), `seed ${seed}`).toEqual(town(1, false));
      ais.forEach((ai) => ai.dispose());
    }
  }, 60_000);
});
