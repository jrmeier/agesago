import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PropKind } from '../core/types';
import { buildTownCenter } from './buildings';
import { propGeometries } from './props';

const KINDS: PropKind[] = ['boulder', 'rocks', 'standingStone', 'ruinColumn', 'ruinWall', 'fence', 'hayBale', 'wheatField', 'well', 'house', 'cart', 'reeds', 'bush', 'log'];

function triangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

describe('ancient scenery', () => {
  const geometries = propGeometries();

  it('covers every frozen scenery kind', () => {
    expect(Object.keys(geometries).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)('grounds and centres every %s variant, with coloured flat faces within budget', kind => {
    expect(geometries[kind].length).toBeGreaterThanOrEqual(1);
    for (const geometry of geometries[kind]) {
      const budget = kind === 'house' || kind === 'wheatField' ? 1500 : 400;
      expect(triangles(geometry)).toBeGreaterThan(0);
      expect(triangles(geometry), `${geometry.name} triangle count`).toBeLessThanOrEqual(budget);
      expect(geometry.index).toBeNull();
      expect(geometry.groups).toHaveLength(0);
      const position = geometry.getAttribute('position');
      for (const name of ['position', 'normal', 'color']) {
        const attribute = geometry.getAttribute(name);
        expect(attribute.itemSize).toBe(3);
        expect(attribute.count).toBe(position.count);
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      expect(Array.from(geometry.getAttribute('color').array).every(v => v >= 0 && v <= 1)).toBe(true);
      expect(new Set(Array.from(geometry.getAttribute('color').array)).size).toBeGreaterThan(20);
      const box = geometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
      expect(box.min.z + box.max.z).toBeCloseTo(0, 5);
      const normals = geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i += 3) {
        expect(normals.getX(i)).toBeCloseTo(normals.getX(i + 1), 5);
        expect(normals.getY(i)).toBeCloseTo(normals.getY(i + 2), 5);
      }
    }
  });

  it('keeps houses near a three by four metre footprint with distinct thatch and tile variants', () => {
    const houses = geometries.house;
    expect(houses.length).toBeGreaterThanOrEqual(2);
    for (const house of houses) {
      const size = house.boundingBox!.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(2.8);
      expect(size.x).toBeLessThan(3.6);
      expect(size.z).toBeGreaterThan(3.8);
      expect(size.z).toBeLessThan(4.5);
      expect(size.y).toBeGreaterThan(2.7);
      expect(size.y).toBeLessThan(3.2);
    }
    expect(Array.from(houses[0].getAttribute('color').array)).not.toEqual(Array.from(houses[1].getAttribute('color').array));
  });

  it('makes a walk-through wheat patch near six by four metres', () => {
    const size = geometries.wheatField[0].boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(5.5);
    expect(size.x).toBeLessThan(6.2);
    expect(size.z).toBeGreaterThan(3.5);
    expect(size.z).toBeLessThan(4.2);
  });

  it('repeats procedural geometry and vertex colours exactly', () => {
    const repeated = propGeometries();
    for (const kind of KINDS) {
      geometries[kind].forEach((geometry, i) => {
        for (const name of ['position', 'color']) expect(Array.from(geometry.getAttribute(name).array)).toEqual(Array.from(repeated[kind][i].getAttribute(name).array));
      });
    }
    for (const variants of Object.values(repeated)) for (const geometry of variants) geometry.dispose();
  });
});

describe('civic centre', () => {
  it('preserves baseHeight, faces +z and fits the footprint, height and 2500 triangle budget', () => {
    const model = buildTownCenter(2.25);
    expect(model.position.toArray()).toEqual([0, 2.25, 0]);
    expect(model.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(2.25, 5);
    expect(size.x).toBeCloseTo(3.2, 5);
    expect(size.z).toBeCloseTo(3.2, 5);
    expect(size.y).toBeGreaterThan(3.8);
    expect(size.y).toBeLessThan(4.4);
    let count = 0;
    const materials = new Set<THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      count += triangles(object.geometry);
      expect(object.geometry.getAttribute('color')).toBeDefined();
      expect(object.castShadow && object.receiveShadow).toBe(true);
      materials.add(object.material as THREE.Material);
    });
    expect(count).toBeLessThanOrEqual(2500);
    expect(materials.size).toBe(1);
    const material = [...materials][0] as THREE.MeshLambertMaterial;
    expect(material.vertexColors && material.flatShading).toBe(true);
  });
});
