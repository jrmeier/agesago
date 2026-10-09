import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind } from '../core/types';
import { buildingModel, foundationModel } from './buildings';

const kinds = Object.keys(BUILDINGS) as BuildingKind[];

function meshes(object: THREE.Object3D, visibleOnly = false): THREE.Mesh<THREE.BufferGeometry>[] {
  const result: THREE.Mesh<THREE.BufferGeometry>[] = [];
  const visit = (child: THREE.Object3D): void => {
    if (child instanceof THREE.Mesh) result.push(child);
  };
  if (visibleOnly) object.traverseVisible(visit);
  else object.traverse(visit);
  return result;
}

function triangleCount(object: THREE.Object3D, visibleOnly = false): number {
  return meshes(object, visibleOnly).reduce((sum, mesh) =>
    sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0);
}

function visibleBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  for (const mesh of meshes(object, true)) {
    bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
  }
  return bounds;
}

describe('economy building models', () => {
  it.each(kinds)('%s matches its centred contract footprint and ground plane within 2500 triangles', kind => {
    for (const seed of [0, 1, 2, 17]) {
      const object = buildingModel(kind, { seed });
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(BUILDINGS[kind].size.w, 5);
      expect(size.z).toBeCloseTo(BUILDINGS[kind].size.d, 5);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 5);
      expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0, 5);
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(object.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(triangleCount(object)).toBeGreaterThan(0);
      expect(triangleCount(object)).toBeLessThanOrEqual(2500);
      const materials = new Set<THREE.Material>();
      for (const mesh of meshes(object)) {
        const geometry = mesh.geometry;
        expect(geometry.index).toBeNull();
        expect(geometry.groups).toHaveLength(0);
        const positions = geometry.getAttribute('position');
        for (const name of ['position', 'normal', 'color']) {
          const attribute = geometry.getAttribute(name);
          expect(attribute.count).toBe(positions.count);
          expect(attribute.itemSize).toBe(3);
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        }
        const normals = geometry.getAttribute('normal');
        for (let i = 0; i < normals.count; i += 3) {
          expect([normals.getX(i), normals.getY(i), normals.getZ(i)]).toEqual(
            [normals.getX(i + 1), normals.getY(i + 1), normals.getZ(i + 1)]);
        }
        const material = mesh.material as THREE.MeshLambertMaterial;
        expect(material.vertexColors && material.flatShading).toBe(true);
        expect(material.map).toBeNull();
        materials.add(material);
      }
      expect(materials.size).toBe(1);
      expect(meshes(object).length).toBeLessThanOrEqual(4);
    }
  });

  it('has distinct silhouettes and seeded tile/thatch houses without crops baked into farms', () => {
    // Economy buildings; the military buildings get their own models in the M6 models lane.
    const economy: BuildingKind[] = ['townCenter', 'house', 'storehouse', 'granary', 'miningCamp', 'farm'];
    const heights = economy.map(kind => visibleBounds(buildingModel(kind)).max.y);
    expect(new Set(heights.map(height => height.toFixed(2))).size).toBe(economy.length);
    const signature = (seed: number): number[] => Array.from(meshes(buildingModel('house', { seed }))[0].geometry.getAttribute('color').array);
    expect(signature(1)).toEqual(signature(1));
    expect(signature(1)).not.toEqual(signature(2));
    expect(visibleBounds(buildingModel('farm')).max.y).toBeLessThan(0.6);
  });
});

describe('construction models', () => {
  it.each(kinds)('%s reveals stages monotonically with stable geometry and transforms', kind => {
    const model = foundationModel(kind);
    const children = [...model.object.children];
    const geometries = meshes(model.object).map(mesh => mesh.geometry);
    const counts: number[] = [];
    let previous = new Set<THREE.Mesh>();
    for (const p of [0, 0.29, 0.3, 0.59, 0.6, 0.89, 0.9, 1]) {
      model.setProgress(p);
      const current = new Set(meshes(model.object, true));
      for (const mesh of previous) expect(current.has(mesh)).toBe(true);
      previous = current;
      counts.push(triangleCount(model.object, true));
      const bounds = visibleBounds(model.object);
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(bounds.max.x).toBeLessThanOrEqual(BUILDINGS[kind].size.w / 2 + 0.0001);
      expect(bounds.max.z).toBeLessThanOrEqual(BUILDINGS[kind].size.d / 2 + 0.0001);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-BUILDINGS[kind].size.w / 2 - 0.0001);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-BUILDINGS[kind].size.d / 2 - 0.0001);
    }
    expect(counts[2]).toBeGreaterThan(counts[0]);
    expect(counts[4]).toBeGreaterThan(counts[2]);
    expect(counts[6]).toBeGreaterThan(counts[4]);
    expect(model.object.children).toEqual(children);
    expect(meshes(model.object).map(mesh => mesh.geometry)).toEqual(geometries);
    model.object.position.set(12, 3, 8);
    model.object.rotation.y = Math.PI / 2;
    model.setProgress(0.3);
    expect(children.map(child => child.visible)).toEqual([true, true, false, false]);
    expect(model.object.position.toArray()).toEqual([12, 3, 8]);
    expect(model.object.rotation.y).toBe(Math.PI / 2);
    for (const p of [-1, NaN, Infinity]) {
      model.setProgress(p);
      expect(children.map(child => child.visible)).toEqual([true, false, false, false]);
    }
    model.setProgress(2);
    expect(children.every(child => child.visible)).toBe(true);
    expect(new Set(meshes(model.object).map(mesh => mesh.material)).size).toBe(1);
  });
});
