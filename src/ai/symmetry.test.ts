import { expect, it } from 'vitest';
import { generateMap } from '../sim/mapgen';
import { World, defaultPlayers } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { snapshot } from './context';

it.each([1, 2])('seed %i: scouting chooses the mirrored frontier cell (T119D)', seed => {
  const { hf, layout } = generateMap(seed, 2);
  const world = new World(hf, layout, defaultPlayers(2));
  const ais = [1, 2].map(p => new AIPlayer(world, p, { difficulty: 'moderate', seed: 7 }));
  const targets = ais.map(ai => {
    const scout = [...world.units.values()].find(u => u.owner === ai.player && u.kind === 'scout')!;
    return ai.economy.frontier(scout)!;
  });
  expect(targets[0]).not.toBeNull();
  expect(targets[1]).toEqual({ x: hf.width - targets[0].x, z: hf.depth - targets[0].z });
  ais.forEach(ai => ai.dispose());
});

it('expansion choices do not depend on resource entity ids (T119D)', () => {
  const { hf, layout } = generateMap(1, 2);
  const world = new World(hf, layout, defaultPlayers(2));
  const ai = new AIPlayer(world, 1, { difficulty: 'hardest', seed: 7 });
  // Exhaust primary gold: exercise the fallback resource cluster candidates.
  for (const n of world.nodes.values()) if (n.type === 'gold') n.amount = 250;
  ai.intel.refreshNodes();
  const before = ai.economy.expansionSite(snapshot(world, 1));
  expect(before).not.toBeNull();
  const other = new AIPlayer(world, 2, { difficulty: 'hardest', seed: 7 });
  other.intel.refreshNodes();
  const mirrored = other.economy.expansionSite(snapshot(world, 2));
  expect(mirrored).not.toBeNull();
  expect(mirrored!.x).toBeCloseTo(hf.width - before!.x, 8);
  expect(mirrored!.z).toBeCloseTo(hf.depth - before!.z, 8);
  other.dispose();
  const nodes = [...world.nodes.values()];
  world.nodes.clear();
  for (const n of nodes) { n.id += 100001; world.nodes.set(n.id, n); }
  ai.intel.refreshNodes();
  expect(ai.economy.expansionSite(snapshot(world, 1))).toEqual(before);
  ai.dispose();
});
