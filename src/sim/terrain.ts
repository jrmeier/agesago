import { MAP_D, MAP_W, type Heightfield } from '../core/types';

/**
 * Seeded heightfield: rolling hills, a lake, a river (with one ford) and a forest mask.
 * Owned by the World lane (T2). Pure TS — no three.js.
 *
 * STUB: flat land so other lanes can run before T2 lands.
 */
export function generateTerrain(_seed: number, width = MAP_W, depth = MAP_D): Heightfield {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x <= width && z <= depth;
  return {
    width,
    depth,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: inside,
    forestDensity: () => 0,
  };
}
