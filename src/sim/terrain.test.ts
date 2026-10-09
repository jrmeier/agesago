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
  it('repeats the complete 176×176 heightfield and surface blends for a seed', () => {
    const first = generateTerrain(1);
    const repeated = generateTerrain(1);
    expect(first.width).toBe(176);
    expect(first.depth).toBe(176);
    expect(samples(first)).toEqual(samples(repeated));
    expect(samples(first)).not.toEqual(samples(generateTerrain(2)));
    for (let z = 0; z <= MAP_D; z += 9) {
      for (let x = 0; x <= MAP_W; x += 9) expect(first.ground(x, z)).toEqual(repeated.ground(x, z));
    }
  });

  it('bilinearly interpolates the half-unit grid and clamps height queries', () => {
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

  it.each([1, 3, 7, 10])('has a large lake, two ponds, flowing channels and three dry fords for seed %i', (seed) => {
    const hf = generateTerrain(seed);
    const f = terrainFeatures(seed);
    expect(f.lake.radiusX).toBeGreaterThan(24);
    for (const lake of [f.lake, ...f.ponds]) {
      expect(hf.isWater(lake.center.x, lake.center.z)).toBe(true);
      expect(hf.heightAt(lake.center.x, lake.center.z)).toBeLessThan(-1.7);
      expect(hf.ground(lake.center.x, lake.center.z).sand).toBeGreaterThan(0.99);
      let sandyShore = false;
      for (let offset = 0; offset <= 4; offset += 0.2) {
        const x = lake.center.x - lake.radiusX - offset;
        if (!hf.isWater(x, lake.center.z) && hf.ground(x, lake.center.z).sand > 0.4) {
          sandyShore = true;
          expect(hf.forestDensity(x, lake.center.z)).toBeLessThan(0.1);
        }
      }
      expect(sandyShore).toBe(true);
    }
    for (const index of [0, 3, 6, 15, 26]) {
      const p = f.river.points[index];
      expect(hf.isWater(p.x, p.z), `main river ${index}`).toBe(true);
    }
    for (const index of [0, 3, 7, 19, 24]) {
      const p = f.tributary.points[index];
      expect(hf.isWater(p.x, p.z), `tributary ${index}`).toBe(true);
    }
    expect(f.river.fords).toHaveLength(2);
    expect(f.tributary.fords).toHaveLength(1);
    for (const ford of f.river.fords) {
      for (let offset = -7; offset <= 7; offset += 0.25) {
        expect(hf.isWalkable(ford.x + offset, ford.z), `main ford ${offset}`).toBe(true);
      }
    }
    const ford = f.tributary.ford;
    for (let offset = -6; offset <= 6; offset += 0.25) {
      expect(hf.isWalkable(ford.x, ford.z + offset), `tributary ford ${offset}`).toBe(true);
    }
  });

  it.each([1, 3, 7, 10])('keeps the TC pad flat and puts three taller ridges away from it for seed %i', (seed) => {
    const hf = generateTerrain(seed);
    const { townCenter: tc, ridges } = terrainFeatures(seed);
    const height = hf.heightAt(tc.x, tc.z);
    expect(height).toBeGreaterThan(SEA_LEVEL + 0.8);
    expect(height).toBeLessThan(3);
    expect(Math.hypot(tc.x - 88, tc.z - 88)).toBeLessThan(7);
    for (let z = -3; z <= 3; z += 0.5) {
      for (let x = -3; x <= 3; x += 0.5) {
        expect(hf.heightAt(tc.x + x, tc.z + z)).toBeCloseTo(height, 12);
        expect(hf.isWalkable(tc.x + x, tc.z + z)).toBe(true);
        expect(hf.forestDensity(tc.x + x, tc.z + z)).toBe(0);
      }
    }
    for (const ridge of ridges) {
      expect(hf.heightAt(ridge.center.x, ridge.center.z)).toBeGreaterThan(6.5);
      expect(Math.hypot(ridge.center.x - tc.x, ridge.center.z - tc.z)).toBeGreaterThan(60);
    }
    expect(hf.ground(tc.x - 2.5, tc.z + 2.5).dirt).toBeGreaterThan(0.5);
  });

  it('has sane, smooth blends, broad forest and meadow patches, and rocky unwalkable flanks', () => {
    const hf = generateTerrain(1);
    let minimum = Infinity;
    let maximum = -Infinity;
    let sumError = 0;
    let steep = 0;
    let rocky = 0;
    let water = 0;
    let trees = 0;
    let meadow = 0;
    let walkable = 0;
    let maxHeight = -Infinity;
    for (let z = 0; z <= MAP_D; z++) {
      for (let x = 0; x <= MAP_W; x++) {
        const h = hf.heightAt(x, z);
        const g = hf.ground(x, z);
        const weights = Object.values(g);
        minimum = Math.min(minimum, ...weights);
        maximum = Math.max(maximum, ...weights);
        sumError = Math.max(sumError, Math.abs(weights.reduce((sum, w) => sum + w, 0) - 1));
        maxHeight = Math.max(maxHeight, h);
        expect(hf.isWater(x, z)).toBe(h < SEA_LEVEL);
        if (hf.isWater(x, z)) {
          water++;
          expect(hf.isWalkable(x, z)).toBe(false);
          expect(hf.forestDensity(x, z)).toBe(0);
        } else if (hf.isWalkable(x, z)) walkable++;
        else if (g.sand < 0.1) {
          steep++;
          if (g.rock > 0.7) rocky++;
        }
        if (hf.forestDensity(x, z) > 0.43) trees++;
        if (g.meadow > 0.35) meadow++;
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(maximum).toBeLessThanOrEqual(1);
    expect(sumError).toBeLessThan(1e-6);
    expect(maxHeight).toBeGreaterThan(8);
    expect(maxHeight).toBeLessThanOrEqual(9.3);
    expect(water).toBeGreaterThan(2500);
    expect(water).toBeLessThan(5000);
    expect(walkable / ((MAP_W + 1) * (MAP_D + 1) - water)).toBeGreaterThan(0.94);
    expect(steep).toBeGreaterThan(80);
    expect(rocky / steep).toBeGreaterThan(0.85);
    expect(trees).toBeGreaterThan(8000);
    expect(meadow).toBeGreaterThan(2500);
    const p = hf.ground(60.125, 120.125);
    const q = hf.ground(60.135, 120.135);
    expect(Math.max(...Object.keys(p).map((key) => Math.abs(p[key as keyof typeof p] - q[key as keyof typeof q])))).toBeLessThan(0.02);
  });

  it.each([1, 7, 10])('paints four winding tracks with soft verges and dry, walkable centres for seed %i', (seed) => {
    const hf = generateTerrain(seed);
    const { roads } = terrainFeatures(seed);
    expect(roads).toHaveLength(4);
    for (const road of roads) {
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1];
        const b = road[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        for (let t = 0; t <= 1; t += 1 / Math.ceil(length)) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          expect(hf.isWalkable(x, z)).toBe(true);
          expect(hf.ground(x, z).path).toBeGreaterThan(0.8);
        }
      }
    }
    const a = roads[3][4];
    const b = roads[3][5];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    const verge = hf.ground(x - (b.z - a.z) / length * 1.4, z + (b.x - a.x) / length * 1.4).path;
    expect(verge).toBeGreaterThan(0.05);
    expect(verge).toBeLessThan(0.7);
    expect(hf.ground(x - (b.z - a.z) / length * 3, z + (b.x - a.x) / length * 3).path).toBeLessThan(0.01);
  });

  it('retains optional rectangular dimensions', () => {
    const hf = generateTerrain(3, 40, 30);
    const f = terrainFeatures(3, 40, 30);
    expect(hf.width).toBe(40);
    expect(hf.depth).toBe(30);
    expect(hf.isWater(f.lake.center.x, f.lake.center.z)).toBe(true);
    expect(hf.isWalkable(f.townCenter.x, f.townCenter.z)).toBe(true);
    expect(Number.isFinite(hf.heightAt(40, 30))).toBe(true);
    expect(hf.isWalkable(40.01, 10)).toBe(false);
    expect(Object.values(hf.ground(40, 30)).reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
  });

  it('accepts multiple supplied pads, levels dry economy areas and preserves distant terrain', () => {
    const pads = [{ x: 36, z: 88 }, { x: 140, z: 88 }];
    const hf = generateTerrain(1, MAP_W, MAP_D, pads);
    const legacy = generateTerrain(1);
    for (const pad of pads) {
      const height = hf.heightAt(pad.x, pad.z);
      for (let a = 0; a < 16; a++) {
        const angle = a * Math.PI / 8;
        for (const radius of [0, 3, 8, 12, 16, 17]) {
          const x = pad.x + Math.cos(angle) * radius;
          const z = pad.z + Math.sin(angle) * radius;
          expect(hf.heightAt(x, z)).toBeCloseTo(height, 12);
          expect(hf.isWater(x, z)).toBe(false);
          expect(hf.isWalkable(x, z)).toBe(true);
          expect(hf.ground(x, z).path).toBe(0);
        }
      }
      expect(hf.ground(pad.x, pad.z).dirt).toBeGreaterThan(0.8);
      expect(hf.forestDensity(pad.x - 14, pad.z - 4)).toBeGreaterThan(0.9);
    }
    for (const [x, z] of [[10, 10], [160, 150], [50, 165]]) {
      expect(hf.heightAt(x, z)).toBe(legacy.heightAt(x, z));
      expect(hf.ground(x, z)).toEqual(legacy.ground(x, z));
    }
  });
});
