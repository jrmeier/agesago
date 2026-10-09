import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind } from '../core/types';
import { buildingModel, foundationModel } from './buildings';
import { createScout, createSoldier, createVillager, projectileGeometry, type SoldierKind, type SoldierPose } from './models';
import { rubbleGeometry } from './props';

const soldiers: SoldierKind[] = ['hoplite', 'swordsman', 'slinger', 'archer', 'horseman'];
const poses: SoldierPose[] = ['idle', 'walk', 'attack', 'die'];
const military: BuildingKind[] = ['barracks', 'archeryRange', 'stable'];

function meshes(object: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry>[] {
  const result: THREE.Mesh<THREE.BufferGeometry>[] = [];
  object.traverse(child => { if (child instanceof THREE.Mesh) result.push(child); });
  return result;
}
function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const result = new THREE.Box3();
  object.traverseVisible(child => {
    if (child instanceof THREE.Mesh) result.union(child.geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld));
  });
  return result;
}
function transforms(object: THREE.Object3D): number[] {
  const result: number[] = [];
  object.traverse(child => result.push(...child.position.toArray(), ...child.quaternion.toArray(), ...child.scale.toArray(), Number(child.visible)));
  return result;
}
function triangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}
function hasColor(object: THREE.Object3D, hex: number): boolean {
  const expected = new THREE.Color(hex);
  const values = [expected.r, expected.g, expected.b];
  const dominant = values.indexOf(Math.max(...values));
  return meshes(object).some(mesh => {
    const colors = mesh.geometry.getAttribute('color');
    for (let i = 0; i < colors.count; i++) {
      const actual = [colors.getX(i), colors.getY(i), colors.getZ(i)];
      const shade = values[dominant] ? actual[dominant] / values[dominant] : 1;
      if (shade >= 0.85 && shade <= 1.15 && actual.every((v, j) => Math.abs(v - values[j] * shade) < 1e-6)) return true;
    }
    return false;
  });
}
function checkGeometry(geometry: THREE.BufferGeometry): void {
  expect(geometry.index).toBeNull();
  expect(geometry.groups).toHaveLength(0);
  const positions = geometry.getAttribute('position');
  for (const name of ['position', 'normal', 'color']) {
    const attribute = geometry.getAttribute(name);
    expect(attribute.itemSize).toBe(3);
    expect(attribute.count).toBe(positions.count);
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  }
  const colors = geometry.getAttribute('color');
  expect(Array.from(colors.array).every(v => v >= 0 && v <= 1)).toBe(true);
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i += 3) {
    for (const get of [normals.getX.bind(normals), normals.getY.bind(normals), normals.getZ.bind(normals)]) {
      expect(get(i)).toBe(get(i + 1));
      expect(get(i)).toBe(get(i + 2));
    }
  }
  expect(geometry.boundingBox).not.toBeNull();
  expect(geometry.boundingSphere).not.toBeNull();
}

describe('ancient military units', () => {
  it.each(soldiers)('%s is a small grounded model with coloured flat faces within budget', kind => {
    for (const seed of [0, 1, 7]) {
      const model = createSoldier(kind, { seed });
      const box = bounds(model.object);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.max.y).toBeGreaterThan(kind === 'horseman' ? 1.8 : 0.92);
      expect(box.max.y).toBeLessThan(kind === 'horseman' ? 2.05 : 1.02);
      expect(model.object.position.toArray()).toEqual([0, 0, 0]);
      expect(model.object.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      const all = meshes(model.object);
      const count = all.reduce((sum, mesh) => sum + triangles(mesh.geometry), 0);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(kind === 'horseman' ? 1500 : 900);
      expect(all.length).toBeLessThanOrEqual(kind === 'horseman' ? 16 : 12);
      expect(new Set(all.map(mesh => mesh.material)).size).toBe(1);
      for (const mesh of all) {
        checkGeometry(mesh.geometry);
        const material = mesh.material as THREE.MeshLambertMaterial;
        expect(material.flatShading && material.vertexColors).toBe(true);
        expect(material.map).toBeNull();
      }
    }
  });

  it.each(soldiers)('%s keeps all poses finite and grounded, reuses geometry and preserves world placement', kind => {
    const model = createSoldier(kind, { seed: 17 });
    const all = meshes(model.object);
    const geometries = all.map(mesh => mesh.geometry);
    const attributes = geometries.map(g => g.getAttribute('position'));
    for (const pose of poses) for (let frame = 0; frame <= 32; frame++) {
      const progress = frame / 32;
      model.setPose(pose, frame / 16, { progress });
      expect(transforms(model.object).every(Number.isFinite)).toBe(true);
      expect(bounds(model.object).min.y).toBeGreaterThanOrEqual(-0.00001);
    }
    model.setPose('die', 0, 1);
    const corpse = bounds(model.object);
    expect(corpse.min.y).toBeCloseTo(0, 5);
    expect(corpse.max.y).toBeLessThan(kind === 'horseman' ? 0.8 : 0.65);
    model.setPose('die', 999, { progress: 1 });
    expect(bounds(model.object).max.y).toBeCloseTo(corpse.max.y, 6);
    model.setPose('idle', 0);
    expect(transforms(model.object)).toEqual(transforms(createSoldier(kind, { seed: 17 }).object));
    expect(meshes(model.object).map(mesh => mesh.geometry)).toEqual(geometries);
    expect(geometries.map(g => g.getAttribute('position'))).toEqual(attributes);
    model.object.position.set(12, 3, 4);
    model.object.rotation.set(0.1, 1.2, 0.2);
    model.object.scale.setScalar(1.1);
    const world = [...model.object.position.toArray(), ...model.object.quaternion.toArray(), ...model.object.scale.toArray()];
    for (const pose of poses) model.setPose(pose, 1.25, 1);
    expect([...model.object.position.toArray(), ...model.object.quaternion.toArray(), ...model.object.scale.toArray()]).toEqual(world);
  });

  it.each(soldiers)('%s has a changing, repeating attack and clamps death progress', kind => {
    const model = createSoldier(kind);
    model.setPose('attack', 0.23);
    const a = transforms(model.object);
    model.setPose('attack', 0.48);
    expect(transforms(model.object)).not.toEqual(a);
    // The mounted charge combines a 2.8 Hz gait with a 1 Hz spear loop: period 5s.
    model.setPose('attack', 0.23 + (kind === 'horseman' ? 5 : 1));
    transforms(model.object).forEach((v, i) => expect(v).toBeCloseTo(a[i], 6));
    model.setPose('die', 0, -2);
    const upright = transforms(model.object);
    for (const progress of [0, NaN, Infinity]) {
      model.setPose('die', 0, progress);
      expect(transforms(model.object)).toEqual(upright);
    }
    model.setPose('die', 0, 1);
    const dead = transforms(model.object);
    model.setPose('die', 0, 9);
    expect(transforms(model.object)).toEqual(dead);
  });

  it('releases sling stones and arrows after the draw/whirl, and loads them again', () => {
    for (const [kind, name] of [['slinger', 'loaded-stone'], ['archer', 'nocked-arrow']] as const) {
      const model = createSoldier(kind);
      model.setPose('attack', 0.5);
      expect(model.object.getObjectByName(name)!.visible).toBe(true);
      model.setPose('attack', 0.8);
      expect(model.object.getObjectByName(name)!.visible).toBe(false);
      model.setPose('attack', 1.1);
      expect(model.object.getObjectByName(name)!.visible).toBe(true);
    }
  });

  it('couches the cavalry spear ahead of the muzzle when charging', () => {
    const model = createSoldier('horseman');
    model.setPose('attack', 0.5);
    // Use transformed vertices: rotating a diagonal shaft's AABB inflates its height.
    const spear = new THREE.Box3().setFromObject(model.object.getObjectByName('javelin')!, true);
    const head = new THREE.Box3().setFromObject(model.object.getObjectByName('horse-head-bridle')!, true);
    expect(spear.max.z).toBeGreaterThan(head.max.z + 0.2);
    expect(spear.getSize(new THREE.Vector3()).z).toBeGreaterThan(1.5);
    expect(spear.getSize(new THREE.Vector3()).y).toBeLessThan(0.3);
  });

  it.each(soldiers)('%s changes only cloth/shield colours, leaving seeded geometry stable', kind => {
    const first = createSoldier(kind, { color: 0x204edb, seed: 3 });
    const second = createSoldier(kind, { color: 0xc22343, seed: 3 });
    expect(hasColor(first.object, 0x204edb)).toBe(true);
    expect(hasColor(second.object, 0xc22343)).toBe(true);
    expect(hasColor(createSoldier(kind, { color: 0 }).object, 0)).toBe(true);
    meshes(first.object).forEach((mesh, i) => {
      expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(Array.from(meshes(second.object)[i].geometry.getAttribute('position').array));
    });
  });

  it('adds team cloth to villagers and scouts while preserving legacy defaults and colour options', () => {
    for (const seed of [0, 1, 2]) {
      expect(hasColor(createVillager({ seed, color: 0x204edb }).object, 0x204edb)).toBe(true);
      expect(hasColor(createScout({ seed, color: 0x204edb }).object, 0x204edb)).toBe(true);
      expect(hasColor(createVillager({ seed, color: 0 }).object, 0)).toBe(true);
      expect(hasColor(createScout({ seed, color: 0 }).object, 0)).toBe(true);
    }
    expect(hasColor(createVillager({ tunic: 0xc22343 }).object, 0xc22343)).toBe(true);
    expect(hasColor(createScout({ cloak: 0xc22343 }).object, 0xc22343)).toBe(true);
    expect(transforms(createVillager().object)).toEqual(transforms(createVillager({}).object));
    expect(transforms(createScout().object)).toEqual(transforms(createScout({}).object));
  });
});

describe('military buildings and destruction props', () => {
  it('gives military buildings distinct silhouettes', () => {
    const heights = military.map(kind => bounds(buildingModel(kind)).max.y.toFixed(2));
    expect(new Set(heights).size).toBe(3);
    for (const kind of military) {
      const model = buildingModel(kind);
      expect(meshes(model).reduce((sum, mesh) => sum + triangles(mesh.geometry), 0)).toBeLessThanOrEqual(2500);
      expect(bounds(model).getSize(new THREE.Vector3()).toArray().filter((_, i) => i !== 1)).toEqual([4, 4]);
    }
  });

  it.each(Object.keys(BUILDINGS) as BuildingKind[])('%s accepts team banners and colours its finished foundation', kind => {
    const first = buildingModel(kind, { color: 0x204edb });
    const second = buildingModel(kind, { color: 0xc22343 });
    expect(hasColor(first, 0x204edb)).toBe(true);
    expect(hasColor(second, 0xc22343)).toBe(true);
    expect(hasColor(buildingModel(kind, { color: 0 }), 0)).toBe(true);
    const size = bounds(first).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(BUILDINGS[kind].size.w, 5);
    expect(size.z).toBeCloseTo(BUILDINGS[kind].size.d, 5);
    const foundation = foundationModel(kind, { color: 0x204edb });
    foundation.setProgress(1);
    expect(hasColor(foundation.object.getObjectByName('nearly-finished')!, 0x204edb)).toBe(true);
  });

  it.each(['arrow', 'stone', 'javelin'] as const)('%s projectile is tiny, deterministic and oriented along +z', kind => {
    const geometry = projectileGeometry(kind);
    checkGeometry(geometry);
    expect(triangles(geometry)).toBeLessThanOrEqual(64);
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(0.12);
    expect(size.y).toBeLessThan(0.12);
    expect(size.z).toBeLessThan(1);
    if (kind !== 'stone') {
      expect(size.z).toBeGreaterThan(size.x * 5);
      // The nose is metal, while the rear is shaft/fletching.
      const positions = geometry.getAttribute('position');
      let tip = 0;
      for (let i = 1; i < positions.count; i++) if (positions.getZ(i) > positions.getZ(tip)) tip = i;
      const color = geometry.getAttribute('color');
      expect(color.getX(tip)).toBeGreaterThan(color.getZ(tip));
    }
    const repeated = projectileGeometry(kind);
    for (const name of ['position', 'color']) expect(Array.from(geometry.getAttribute(name).array)).toEqual(Array.from(repeated.getAttribute(name).array));
  });

  it.each([2.6, 4, { w: 3.2, d: 4 }])('fits grounded, low rubble into footprint %j under 600 triangles', size => {
    const geometry = rubbleGeometry(size);
    checkGeometry(geometry);
    expect(triangles(geometry)).toBeLessThanOrEqual(600);
    const box = geometry.boundingBox!;
    const dimensions = box.getSize(new THREE.Vector3());
    expect(dimensions.x).toBeCloseTo(typeof size === 'number' ? size : size.w, 5);
    expect(dimensions.z).toBeCloseTo(typeof size === 'number' ? size : size.d, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(dimensions.y).toBeLessThan(0.7);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
    expect(box.min.z + box.max.z).toBeCloseTo(0, 5);
    const repeated = rubbleGeometry(size);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(Array.from(repeated.getAttribute('position').array));
  });
});
