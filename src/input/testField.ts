import { GRASS_ONLY, type Heightfield } from '../core/types';

/** Test-only terrain: a smooth bump field with a pit below sea level centred on (10, 10), or flat at y = 1. */
export function testField(flat = false): Heightfield {
  const heightAt = (x: number, z: number) =>
    flat ? 1 : 2 + 1.5 * Math.sin(x * 0.3) * Math.cos(z * 0.25) - 4 * Math.exp(-((x - 10) ** 2 + (z - 10) ** 2) / 8);
  return {
    width: 64,
    depth: 48,
    heightAt,
    isWater: (x, z) => heightAt(x, z) < 0,
    isWalkable: (x, z) => heightAt(x, z) >= 0,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}
