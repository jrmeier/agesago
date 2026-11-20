import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { qualityTier } from '../core/quality';
import { GRASS_ONLY, type GroundWeights, type Heightfield } from '../core/types';
import { CHUNK_SIZE } from './instanceChunks';
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
    const ground = view.object.children[0].children[0] as THREE.Mesh;
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

  function chunkedGround(): TerrainView {
    return new TerrainView({
      width: 48,
      depth: 32,
      heightAt: (x, z) => 2 + Math.sin(x * 0.4) * 0.8 + Math.cos(z * 0.2),
      isWater: () => false,
      isWalkable: () => true,
      forestDensity: () => 0,
      ground: () => GRASS_ONLY,
    }, qualityTier('high'));
  }

  it('partitions every surface and skirt triangle once and shares all attributes and material', () => {
    const view = chunkedGround();
    const ground = view.object.children[0];
    expect(ground.name).toBe('terrain');
    const chunks = ground.children as THREE.Mesh[];
    expect(chunks).toHaveLength(6);
    const triangles = new Set<string>();
    const allIndices: number[] = [];
    for (const mesh of chunks) {
      expect(mesh.name).toMatch(/^terrain:[0-2]:[0-1]$/);
      expect(mesh.material).toBe(chunks[0].material);
      expect(mesh.frustumCulled && mesh.castShadow && mesh.receiveShadow).toBe(true);
      for (const name of ['position', 'normal', 'uv', 'splat0', 'splat1']) {
        expect(mesh.geometry.getAttribute(name)).toBe(chunks[0].geometry.getAttribute(name));
      }
      const index = mesh.geometry.index!;
      allIndices.push(...index.array);
      for (let i = 0; i < index.count; i += 3) {
        const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].join(':');
        expect(triangles.has(triangle)).toBe(false);
        triangles.add(triangle);
      }
    }
    // 96 × 64 surface quads plus two 96-quad and two 64-quad skirts.
    expect(allIndices.length).toBe((96 * 64 + 2 * 96 + 2 * 64) * 6);
    // Every original surface triangle retains its indices and winding.
    for (let z = 0; z < 64; z++) for (let x = 0; x < 96; x++) {
      const a = z * 97 + x;
      expect(triangles.has(`${a}:${a + 97}:${a + 1}`)).toBe(true);
      expect(triangles.has(`${a + 1}:${a + 97}:${a + 98}`)).toBe(true);
    }
    let skirtBase = 97 * 65;
    for (const [edge, length] of [97, 97, 65, 65].entries()) {
      for (let i = 0; i < length - 1; i++) {
        const a = skirtBase + i * 2;
        if (edge === 0 || edge === 3) {
          expect(triangles.has(`${a}:${a + 1}:${a + 2}`)).toBe(true);
          expect(triangles.has(`${a + 2}:${a + 1}:${a + 3}`)).toBe(true);
        } else {
          expect(triangles.has(`${a}:${a + 2}:${a + 1}`)).toBe(true);
          expect(triangles.has(`${a + 2}:${a + 3}:${a + 1}`)).toBe(true);
        }
      }
      skirtBase += length * 2;
    }
    // Normals must still include neighbouring triangles across chunk borders.
    const reference = new THREE.BufferGeometry();
    reference.setAttribute('position', chunks[0].geometry.getAttribute('position'));
    reference.setIndex(allIndices);
    reference.computeVertexNormals();
    const normals = chunks[0].geometry.getAttribute('normal');
    const expected = reference.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) {
      expect(normals.getX(i)).toBeCloseTo(expected.getX(i), 5);
      expect(normals.getY(i)).toBeCloseTo(expected.getY(i), 5);
      expect(normals.getZ(i)).toBeCloseTo(expected.getZ(i), 5);
    }
    view.dispose();
  });

  it('bounds only each chunk’s indexed vertices, including its skirts', () => {
    const view = chunkedGround();
    const vertex = new THREE.Vector3();
    for (const mesh of view.object.children[0].children as THREE.Mesh[]) {
      const { geometry } = mesh;
      const box = geometry.boundingBox!;
      const sphere = geometry.boundingSphere!;
      expect(sphere.radius).toBeLessThan(CHUNK_SIZE * 1.5 + box.max.y - box.min.y);
      // A sphere computed from the whole shared position attribute would still pass the
      // radius limit above on this small map, so pin it to the chunk's own box as well.
      expect(sphere.radius).toBeLessThanOrEqual(box.getSize(new THREE.Vector3()).length() / 2 + 1e-6);
      expect(box.containsPoint(sphere.center)).toBe(true);
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(CHUNK_SIZE);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(CHUNK_SIZE);
      for (const index of geometry.index!.array) {
        vertex.fromBufferAttribute(geometry.getAttribute('position'), index);
        expect(box.containsPoint(vertex)).toBe(true);
        expect(vertex.distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-6);
      }
    }
    view.dispose();
  });

  it('disposes every chunk geometry and the one shared material', () => {
    const view = chunkedGround();
    const chunks = view.object.children[0].children as THREE.Mesh[];
    let geometries = 0;
    let materials = 0;
    for (const mesh of chunks) mesh.geometry.addEventListener('dispose', () => geometries++);
    (chunks[0].material as THREE.Material).addEventListener('dispose', () => materials++);
    view.dispose();
    expect(geometries).toBe(6);
    expect(materials).toBe(1);
  });
});
