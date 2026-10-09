import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, SEA_LEVEL, type Heightfield, type PropKind, type PropPlacement } from '../core/types';
import { PropsView } from './PropsView';

function field(heightAt: Heightfield['heightAt']): Heightfield {
  return { width: 160, depth: 120, heightAt, isWater: (x, z) => heightAt(x, z) < SEA_LEVEL,
    isWalkable: () => true, forestDensity: () => 0, ground: () => GRASS_ONLY };
}

function placement(kind: PropKind, x: number, z: number, rot = 0, scale = 1): PropPlacement {
  return { kind, pos: { x, z }, rot, scale, blockRadius: 0 };
}

function matrices(view: PropsView): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const child of view.object.children) {
    const mesh = child as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      result.set(`${matrix.elements[12]},${matrix.elements[14]}`, [Number(mesh.name.split(':')[1]), ...matrix.elements]);
    }
  }
  return result;
}

describe('PropsView', () => {
  it('mounts every placement once and batches by kind and variant on one material', () => {
    const props = [placement('house', 12, 8), placement('rocks', 10, 9), placement('rocks', 14, 10),
      placement('rocks', 10, 9), placement('reeds', 8, 7), placement('ruinColumn', 11, 12)];
    const view = new PropsView(field(() => 1.5), props);
    let count = 0;
    const materials = new Set<THREE.Material>();
    const names = new Set<string>();
    for (const object of view.object.children) {
      expect(object).toBeInstanceOf(THREE.InstancedMesh);
      const mesh = object as THREE.InstancedMesh;
      const lod = mesh.name.endsWith(':lod');
      if (!lod) count += mesh.count;
      expect(mesh.castShadow && mesh.receiveShadow).toBe(!lod);
      expect(mesh.boundingSphere).not.toBeNull();
      expect((mesh.boundingSphere as THREE.Sphere).radius).toBeLessThan(24);
      expect(mesh.frustumCulled).toBe(true);
      expect(names.has(mesh.name)).toBe(false);
      names.add(mesh.name);
      materials.add(mesh.material as THREE.Material);
    }
    expect(count).toBe(props.length);
    expect(materials.size).toBe(1);
    view.setShadows(false);
    expect(view.object.children.every(child => !child.castShadow && !child.receiveShadow)).toBe(true);
    view.setShadows(true);
    for (const child of view.object.children) {
      const mesh = child as THREE.InstancedMesh;
      expect(mesh.castShadow && mesh.receiveShadow).toBe(!mesh.name.endsWith(':lod'));
    }
    view.dispose();
    expect(view.object.children).toHaveLength(0);
  });

  it('seats land scenery and reeds at the terrain or water surface, applying yaw and scale', () => {
    const props = [placement('house', 20, 8, 0.8, 1.2), placement('well', 4, 3, -0.4, 0.85), placement('reeds', 1, 2)];
    const hf = field(x => x < 2 ? -0.8 : 2);
    const view = new PropsView(hf, props);
    const transforms = matrices(view);
    for (const prop of props) {
      const matrix = new THREE.Matrix4().fromArray(transforms.get(`${prop.pos.x},${prop.pos.z}`)!.slice(1));
      const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
      matrix.decompose(position, rotation, scale);
      expect(position.y).toBeCloseTo(Math.max(hf.heightAt(prop.pos.x, prop.pos.z), SEA_LEVEL));
      expect(scale.x).toBeCloseTo(prop.scale);
      expect(rotation.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rot))).toBeCloseTo(0, 3);
    }
    view.dispose();
  });

  it('chooses variants independently of placement order', () => {
    const props = Array.from({ length: 20 }, (_, i) => placement('boulder', 5 + i * 2, 3 + i));
    const first = new PropsView(field(() => 0), props);
    const second = new PropsView(field(() => 0), [...props].reverse());
    const a = matrices(first), b = matrices(second);
    for (const [key, matrix] of a) expect(b.get(key)).toEqual(matrix);
    expect(new Set([...a.values()].map(matrix => matrix[0])).size).toBeGreaterThan(1);
    first.dispose(); second.dispose();
  });

  it('tilts only small natural props to the terrain slope and caps steep inclines', () => {
    const props = ['rocks', 'log', 'bush', 'house', 'ruinColumn', 'standingStone'].map((kind, i) => placement(kind as PropKind, 10 + i, 10, 0.7));
    for (const slope of [0.08, 2]) {
      const view = new PropsView(field((x, z) => 0.5 + x * slope + z * slope / 2), props);
      for (const child of view.object.children) {
        const matrix = new THREE.Matrix4();
        (child as THREE.InstancedMesh).getMatrixAt(0, matrix);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
        const angle = up.angleTo(new THREE.Vector3(0, 1, 0));
        if (/^(rocks|log|bush):/.test(child.name)) {
          expect(angle).toBeGreaterThan(0.01);
          expect(angle).toBeLessThanOrEqual(0.18001);
          if (slope < 1) expect(up.distanceTo(new THREE.Vector3(-slope, 1, -slope / 2).normalize())).toBeLessThan(1e-6);
        } else expect(angle).toBeCloseTo(0, 6);
      }
      view.dispose();
    }
  });

  it('handles an empty scenery list', () => {
    const view = new PropsView(field(() => 0), []);
    expect(view.object.children).toHaveLength(0);
    view.setShadows(false);
    view.dispose();
  });
});
