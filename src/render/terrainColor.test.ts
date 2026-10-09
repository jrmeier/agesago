import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield } from '../core/types';
import { hash01, packSplat, sampleTerrain, terrainVertexSrgb } from './terrainColor';

describe('terrainVertexSrgb', () => {
  const flat = { slope: 0, forest: 0, variation: 0 };

  it('is sand near sea level and grass on high flat ground', () => {
    const beach = terrainVertexSrgb({ ...flat, height: 0.05 });
    const grass = terrainVertexSrgb({ ...flat, height: 6 });
    expect(beach.r).toBeGreaterThan(beach.b);
    expect(beach.r).toBeGreaterThan(grass.r);
    expect(grass.g).toBeGreaterThan(grass.r);
    expect(grass.g).toBeGreaterThan(grass.b);
  });

  it('darkens forest floor relative to open grass', () => {
    const grass = terrainVertexSrgb({ ...flat, height: 6 });
    const woods = terrainVertexSrgb({ ...flat, height: 6, forest: 1 });
    expect(woods.r + woods.g + woods.b).toBeLessThan(grass.r + grass.g + grass.b);
  });

  it('turns steep slopes to dirt', () => {
    const steep = terrainVertexSrgb({ height: 6, slope: 1.2, forest: 0, variation: 0 });
    expect(steep.r).toBeGreaterThan(steep.g);
    expect(steep.g).toBeGreaterThan(steep.b);
  });

  it('darkens the bed below sea level', () => {
    const shore = terrainVertexSrgb({ ...flat, height: 0.2 });
    const bed = terrainVertexSrgb({ ...flat, height: -2 });
    expect(bed.r + bed.g + bed.b).toBeLessThan((shore.r + shore.g + shore.b) * 0.75);
  });
});

describe('packSplat', () => {
  const empty = { grass: 0, meadow: 0, forest: 0, dirt: 0, rock: 0, sand: 0, path: 0 };

  it('normalises weights and keeps the spare channel', () => {
    const packed = packSplat({ ...empty, grass: 2, meadow: 2 }, 0.25);
    expect(packed.splat0[0]).toBeCloseTo(0.5);
    expect(packed.splat0[1]).toBeCloseTo(0.5);
    expect(packed.splat0[2]).toBe(0);
    expect(packed.splat1[3]).toBeCloseTo(0.25);
    const sum =
      packed.splat0[0] +
      packed.splat0[1] +
      packed.splat0[2] +
      packed.splat0[3] +
      packed.splat1[0] +
      packed.splat1[1] +
      packed.splat1[2];
    expect(sum).toBeCloseTo(1);
  });

  it('treats a blank blend as grass and drops negative weights', () => {
    expect(packSplat(empty).splat0[0]).toBe(1);
    const packed = packSplat({ ...empty, rock: 2, sand: -1 });
    expect(packed.splat1[0]).toBeCloseTo(1);
    expect(packed.splat1[1]).toBe(0);
  });
});

describe('sampleTerrain', () => {
  it('hashes stably inside 0..1', () => {
    expect(hash01(3.5, 8)).toBe(hash01(3.5, 8));
    const h = hash01(1, 2);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });

  it('reads slope and forest density off the heightfield', () => {
    const hf: Heightfield = {
      width: 20,
      depth: 20,
      heightAt: (x) => 3 + x * 0.5,
      isWater: () => false,
      isWalkable: () => true,
      forestDensity: (x) => (x >= 10 ? 1 : 0),
      ground: () => GRASS_ONLY,
    };
    const open = sampleTerrain(hf, 4, 4);
    const woods = sampleTerrain(hf, 14, 4);
    expect(open.height).toBeCloseTo(5, 5);
    expect(open.slope).toBeCloseTo(0.5, 5);
    expect(open.forest).toBe(0);
    expect(woods.forest).toBe(1);
    expect(woods.slope).toBeCloseTo(0.5, 5);
  });
});
