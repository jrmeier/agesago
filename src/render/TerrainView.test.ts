import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { qualityTier } from '../core/quality';
import { type GroundWeights, type Heightfield } from '../core/types';
import { packSplat } from './terrainColor';
import { TerrainView } from './TerrainView';

function installCanvasMock(): void {
  const data = new Uint8ClampedArray(512 * 512 * 4);
  const ctx: object = new Proxy(function () {}, {
    apply: () => ctx,
    get: (_target, prop) => (prop === 'data' ? data : ctx),
  });
  Object.assign(globalThis, {
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ctx,
      }),
    },
  });
}

describe('TerrainView splats', () => {
  beforeAll(installCanvasMock);

  it('matches heightAt and stores normalised ground weights', () => {
    const groundAt = (x: number, z: number): GroundWeights => {
      if (x < 3) return { grass: 2, meadow: 2, forest: 0, dirt: 0, rock: 0, sand: 0, path: 0 };
      if (z > 5) return { grass: 0, meadow: 0, forest: 0, dirt: 0, rock: 0, sand: 0, path: 3 };
      return { grass: 0, meadow: 0, forest: 1, dirt: 0, rock: 0, sand: 0, path: 0 };
    };
    const hf: Heightfield = {
      width: 8,
      depth: 6,
      heightAt: (x, z) => 1.2 + Math.sin(x * 0.4) * 0.3 + z * 0.05,
      isWater: () => false,
      isWalkable: () => true,
      forestDensity: () => 0,
      ground: groundAt,
    };
    const view = new TerrainView(hf, qualityTier('low'));
    const ground = view.object.children[0] as THREE.Mesh;
    const pos = ground.geometry.attributes.position;
    const s0 = ground.geometry.attributes.splat0;
    const s1 = ground.geometry.attributes.splat1;
    expect(s0.itemSize).toBe(4);
    expect(s1.itemSize).toBe(4);

    let surfaces = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const expected = hf.heightAt(x, z);
      expect(Math.abs(y - expected) < 0.05 || Math.abs(y - (expected - 4)) < 1e-3).toBe(true);
      if (s1.getW(i) !== 0) continue;
      surfaces += 1;
      const packed = packSplat(groundAt(x, z));
      expect(s0.getX(i)).toBeCloseTo(packed.splat0[0], 5);
      expect(s0.getY(i)).toBeCloseTo(packed.splat0[1], 5);
      expect(s0.getZ(i)).toBeCloseTo(packed.splat0[2], 5);
      expect(s0.getW(i)).toBeCloseTo(packed.splat0[3], 5);
      expect(s1.getX(i)).toBeCloseTo(packed.splat1[0], 5);
      expect(s1.getY(i)).toBeCloseTo(packed.splat1[1], 5);
      expect(s1.getZ(i)).toBeCloseTo(packed.splat1[2], 5);
      const sum = s0.getX(i) + s0.getY(i) + s0.getZ(i) + s0.getW(i) + s1.getX(i) + s1.getY(i) + s1.getZ(i);
      expect(sum).toBeCloseTo(1, 5);
    }
    expect(surfaces).toBe(17 * 13);
    expect(ground.receiveShadow).toBe(false);
  });
});
