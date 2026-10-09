import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { qualityTier } from '../core/quality';
import { GRASS_ONLY, type GroundWeights, type Heightfield } from '../core/types';
import { Water, waterBounds } from './Water';

function field(over: Partial<Heightfield> = {}): Heightfield {
  return {
    width: 40,
    depth: 30,
    heightAt: (x, z) => (x > 12 && x < 24 && z > 8 && z < 18 ? -1.5 : 2),
    isWater: (x, z) => x > 12 && x < 24 && z > 8 && z < 18,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: (): GroundWeights => ({ ...GRASS_ONLY }),
    ...over,
  };
}

describe('Water', () => {
  it('constructs a clipped fancy surface and a simple low-tier plane', () => {
    const hf = field();
    const fancy = new Water(hf, qualityTier('high'));
    const low = new Water(hf, qualityTier('low'));
    expect(fancy.mesh).toBeInstanceOf(THREE.Mesh);
    expect(fancy.mesh.visible).toBe(true);
    const mat = fancy.mesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.opacity).toBeLessThan(1);

    const box = new THREE.Box3().setFromObject(fancy.mesh);
    expect(box.min.x).toBeGreaterThan(0);
    expect(box.min.x).toBeLessThan(12);
    expect(box.max.x).toBeGreaterThan(24);
    expect(box.max.x).toBeLessThan(40);
    expect(box.min.y).toBeLessThan(0.2);
    expect(box.max.y).toBeGreaterThan(-0.2);

    expect(low.mesh.visible).toBe(true);
    const lambert = low.mesh.material as THREE.MeshLambertMaterial;
    expect(lambert.transparent).toBe(true);
    expect(lambert.depthWrite).toBe(false);
    expect(lambert.opacity).toBeLessThan(1);

    fancy.update(1.2);
    low.update(0.4);
  });

  it('hides the plane on a dry map and still moves vertices', () => {
    const hf = field({
      heightAt: () => 3,
      isWater: () => false,
    });
    expect(waterBounds(hf, 4)).toBeNull();
    const water = new Water(hf, qualityTier('medium'));
    expect(water.mesh.visible).toBe(false);
    const before = (water.mesh.geometry.attributes.position.array as Float32Array).slice();
    water.update(1.7);
    const after = water.mesh.geometry.attributes.position.array as Float32Array;
    let moved = 0;
    for (let i = 1; i < after.length; i += 3) if (Math.abs(after[i] - before[1]) > 1e-4) moved += 1;
    expect(moved).toBeGreaterThan(10);
  });
});
