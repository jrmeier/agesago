import { describe, expect, it } from 'vitest';
import { MAP_D, MAP_W, SEA_LEVEL, type Heightfield } from '../core/types';
import { generateTerrain, terrainFeatures } from './terrain';

function samples(hf: Heightfield): number[] {
  const result: number[] = [];
  for (let z = 0; z <= hf.depth; z += 0.5) {
    for (let x = 0; x <= hf.width; x += 0.5) result.push(hf.heightAt(x, z));
  }
  return result;
}

describe('generateTerrain', () => {
  it('repeats every height sample for a seed and changes with a different seed', () => {
    const first = generateTerrain(1);
    expect(first.width).toBe(MAP_W);
    expect(first.depth).toBe(MAP_D);
    expect(samples(first)).toEqual(samples(generateTerrain(1)));
    expect(samples(first)).not.toEqual(samples(generateTerrain(2)));
  });

  it('bilinearly interpolates the half-unit grid and clamps height queries to the map', () => {
    const hf = generateTerrain(7);
    const corners = [hf.heightAt(12, 11), hf.heightAt(12.5, 11), hf.heightAt(12, 11.5), hf.heightAt(12.5, 11.5)];
    expect(hf.heightAt(12.25, 11.25)).toBeCloseTo(corners.reduce((sum, value) => sum + value, 0) / 4, 12);
    expect(hf.heightAt(12.125, 11.375)).toBeCloseTo(
      corners[0] * 0.75 * 0.25 + corners[1] * 0.25 * 0.25 + corners[2] * 0.75 * 0.75 + corners[3] * 0.25 * 0.75, 12
    );
    expect(hf.heightAt(-5, 12)).toBe(hf.heightAt(0, 12));
    expect(hf.heightAt(MAP_W + 5, MAP_D + 5)).toBe(hf.heightAt(MAP_W, MAP_D));
    expect(hf.isWalkable(-0.01, 10)).toBe(false);
    expect(hf.isWalkable(10, MAP_D + 0.01)).toBe(false);
    expect(hf.isWalkable(NaN, 10)).toBe(false);
  });

  it.each([1, 2, 7, 19, 42])('has a submerged lake and river, and a walkable ford for seed %i', (seed) => {
    const hf = generateTerrain(seed);
    const { lake, river, townCenter } = terrainFeatures(seed);
    expect(hf.isWater(lake.center.x, lake.center.z)).toBe(true);
    expect(hf.heightAt(lake.center.x, lake.center.z)).toBeCloseTo(-1.2, 1);
    expect(Math.hypot(lake.center.x - townCenter.x, lake.center.z - townCenter.z)).toBeGreaterThan(18);
    expect(hf.isWater(river.points[0].x, river.points[0].z)).toBe(true);
    for (const index of [3, 6, 17, 20, 24]) {
      const pos = river.points[index];
      expect(hf.isWater(pos.x, pos.z), `river sample ${index}`).toBe(true);
    }
    expect(hf.isWater(river.ford.x, river.ford.z)).toBe(false);
    for (let dx = -4; dx <= 4; dx += 0.25) {
      expect(hf.isWalkable(river.ford.x + dx, river.ford.z), `ford offset ${dx}`).toBe(true);
    }
    let shallowShore = false;
    for (let dx = lake.radiusX; dx <= lake.radiusX + 3; dx += 0.1) {
      const x = lake.center.x + dx;
      const height = hf.heightAt(x, lake.center.z);
      if (height >= SEA_LEVEL && height < SEA_LEVEL + 0.35) {
        shallowShore = true;
        expect(hf.forestDensity(x, lake.center.z)).toBe(0);
      }
    }
    expect(shallowShore).toBe(true);
  });

  it.each([1, 2, 7, 19, 42])('keeps the entire 6×6 TC pad flat, dry and clear for seed %i', (seed) => {
    const hf = generateTerrain(seed);
    const tc = terrainFeatures(seed).townCenter;
    const height = hf.heightAt(tc.x, tc.z);
    expect(height).toBeGreaterThan(SEA_LEVEL + 0.3);
    for (let z = -3; z <= 3; z += 0.25) {
      for (let x = -3; x <= 3; x += 0.25) {
        expect(hf.heightAt(tc.x + x, tc.z + z)).toBeCloseTo(height, 12);
        expect(hf.isWalkable(tc.x + x, tc.z + z)).toBe(true);
        expect(hf.forestDensity(tc.x + x, tc.z + z)).toBe(0);
      }
    }
  });

  it('bounds heights and forest density and makes most land walkable', () => {
    const hf = generateTerrain(1);
    let land = 0;
    let walkable = 0;
    let forest = 0;
    for (let z = 0; z <= MAP_D; z++) {
      for (let x = 0; x <= MAP_W; x++) {
        const height = hf.heightAt(x, z);
        const density = hf.forestDensity(x, z);
        expect(height).toBeGreaterThanOrEqual(-1.2);
        expect(height).toBeLessThanOrEqual(2.8);
        expect(density).toBeGreaterThanOrEqual(0);
        expect(density).toBeLessThanOrEqual(1);
        expect(hf.isWater(x, z)).toBe(height < SEA_LEVEL);
        if (height < SEA_LEVEL) {
          expect(hf.isWalkable(x, z)).toBe(false);
          expect(density).toBe(0);
        } else {
          land++;
          if (hf.isWalkable(x, z)) walkable++;
          if (density >= 0.45) forest++;
        }
      }
    }
    expect(walkable / land).toBeGreaterThan(0.9);
    expect(forest).toBeGreaterThan(500);
  });

  it('retains the optional rectangular dimensions', () => {
    const hf = generateTerrain(3, 40, 30);
    const features = terrainFeatures(3, 40, 30);
    expect(hf.width).toBe(40);
    expect(hf.depth).toBe(30);
    expect(hf.isWater(features.lake.center.x, features.lake.center.z)).toBe(true);
    expect(hf.isWalkable(features.townCenter.x, features.townCenter.z)).toBe(true);
    expect(Number.isFinite(hf.heightAt(40, 30))).toBe(true);
    expect(hf.isWalkable(40.01, 10)).toBe(false);
  });
});
