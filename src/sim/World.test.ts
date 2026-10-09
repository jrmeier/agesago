import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED } from '../core/types';
import { generateMap } from './mapgen';
import { World } from './World';

describe('World (contract smoke test)', () => {
  it('builds from the generated map', () => {
    const { hf, layout } = generateMap(DEFAULT_SEED);
    const world = new World(hf, layout);
    expect(world.pop).toBe(layout.villagers.length);
    expect(world.nodes.size).toBe(layout.nodes.length);
    expect(world.townCenter.kind).toBe('townCenter');
  });
});
