import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { qualityTier } from '../core/quality';
import { createGroundTextures } from './textures';

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

describe('createGroundTextures', () => {
  beforeAll(installCanvasMock);

  it('builds wrapping mipmapped textures at the tier size', () => {
    const high = createGroundTextures(qualityTier('high'));
    const low = createGroundTextures(qualityTier('low'));
    const layers = [high.grass, high.meadow, high.forest, high.dirt, high.rock, high.sand, high.path];
    expect(layers).toHaveLength(7);
    for (const tex of layers) {
      expect(tex.image.width).toBe(512);
      expect(tex.image.height).toBe(512);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex.wrapT).toBe(THREE.RepeatWrapping);
      expect(tex.generateMipmaps).toBe(true);
      expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(tex.anisotropy).toBeGreaterThan(1);
    }
    for (const tex of [low.grass, low.meadow, low.forest, low.dirt, low.rock, low.sand, low.path]) {
      expect(tex.image.width).toBe(256);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    }
    expect(createGroundTextures(qualityTier('high'))).toBe(high);
  });
});
