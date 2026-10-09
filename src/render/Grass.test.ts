import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Quality } from '../core/quality';
import { GRASS_ONLY, type GroundWeights, type Heightfield, type Vec2 } from '../core/types';
import { collectGrass, GrassField } from './Grass';

const weights = (over: Partial<GroundWeights> = {}): GroundWeights => ({ ...GRASS_ONLY, ...over });

function field(over: Partial<Heightfield> = {}): Heightfield {
  return {
    width: 32,
    depth: 32,
    heightAt: () => 2,
    isWater: () => false,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: () => weights(),
    ...over,
  };
}

function cover(density: number, radius: number): Quality {
  return {
    tier: 'low',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 0,
    grassDensity: density,
    grassRadius: radius,
    fancyWater: false,
  };
}

describe('collectGrass', () => {
  const focus: Vec2 = { x: 4, z: 4 };
  const quality = cover(4, 3);

  it('is deterministic inside the radius and stable for a small focus shift', () => {
    const hf = field();
    const a = collectGrass(hf, quality, focus);
    const b = collectGrass(hf, quality, focus);
    expect(a.length).toBeGreaterThan(10);
    expect(a.map((t) => [t.x, t.z, t.kind])).toEqual(b.map((t) => [t.x, t.z, t.kind]));
    const nudged = collectGrass(hf, quality, { x: 4.15, z: 4.1 });
    const placed = new Set(a.map((t) => `${t.x},${t.z}`));
    const shared = nudged.filter((t) => placed.has(`${t.x},${t.z}`));
    expect(shared.length).toBeGreaterThan(10);
    for (const tuft of a) {
      expect(Math.hypot(tuft.x - focus.x, tuft.z - focus.z)).toBeLessThanOrEqual(quality.grassRadius + 1e-6);
      expect(tuft.kind).toBe('grass');
    }
  });

  it('skips water, path, rock, sand, and trees, and plants flowers in meadow', () => {
    const q = cover(5, 4);
    const at: Vec2 = { x: 8, z: 8 };
    expect(collectGrass(field({ isWater: () => true }), q, at)).toHaveLength(0);
    expect(collectGrass(field({ heightAt: () => -0.4 }), q, at)).toHaveLength(0);
    expect(collectGrass(field({ ground: () => weights({ grass: 0, path: 1 }) }), q, at)).toHaveLength(0);
    expect(collectGrass(field({ ground: () => weights({ grass: 0, rock: 1 }) }), q, at)).toHaveLength(0);
    expect(collectGrass(field({ ground: () => weights({ grass: 0, sand: 1 }) }), q, at)).toHaveLength(0);
    expect(collectGrass(field({ forestDensity: () => 1 }), q, at)).toHaveLength(0);
    expect(collectGrass(field(), cover(0, 4), at)).toHaveLength(0);

    const meadow = collectGrass(field({ ground: () => weights({ grass: 0, meadow: 1 }) }), q, at);
    expect(meadow.some((t) => t.kind === 'flower')).toBe(true);
    expect(meadow.some((t) => t.kind === 'grass')).toBe(true);
    const flowers = new Set(meadow.filter((t) => t.kind === 'flower').map((t) => `${t.color.r.toFixed(3)}`));
    expect(flowers.size).toBeGreaterThan(1);
  });
});

describe('GrassField', () => {
  it('constructs and updates without throwing', () => {
    const hf = field();
    const grass = new GrassField(hf, cover(3, 4));
    expect(grass.object).toBeInstanceOf(THREE.Object3D);
    grass.update({ x: 8, z: 8 }, 0.2);
    grass.update({ x: 8.1, z: 8 }, 1.4);
    let count = 0;
    grass.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) count += mesh.count;
    });
    expect(count).toBe(collectGrass(hf, cover(3, 4), { x: 8, z: 8 }).length);

    const bare = new GrassField(hf, cover(0, 0));
    bare.update({ x: 8, z: 8 }, 1);
    expect(bare.object.children).toHaveLength(0);
  });
});
