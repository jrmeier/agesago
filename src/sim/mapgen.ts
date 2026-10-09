import { MAP_D, MAP_W, type Heightfield, type MapLayout } from '../core/types';
import { generateTerrain } from './terrain';

/**
 * Builds the terrain plus the starting layout: a flat Town Center pad, three villagers,
 * and trees / berry bushes / gold placed on walkable ground reachable from the TC.
 * Owned by the World lane (T2). Pure TS — no three.js.
 *
 * STUB: a handful of nodes around the map centre.
 */
export function generateMap(seed: number): { hf: Heightfield; layout: MapLayout } {
  const hf = generateTerrain(seed);
  const cx = MAP_W / 2;
  const cz = MAP_D / 2;
  const layout: MapLayout = {
    townCenter: { x: cx, z: cz },
    villagers: [
      { x: cx - 2.5, z: cz + 2.5 },
      { x: cx, z: cz + 3 },
      { x: cx + 2.5, z: cz + 2.5 },
    ],
    nodes: [
      { kind: 'tree', pos: { x: cx - 8, z: cz - 4 }, amount: 100 },
      { kind: 'tree', pos: { x: cx - 9, z: cz - 2 }, amount: 100 },
      { kind: 'berry', pos: { x: cx + 6, z: cz + 5 }, amount: 125 },
      { kind: 'gold', pos: { x: cx + 9, z: cz - 6 }, amount: 400 },
    ],
  };
  return { hf, layout };
}
