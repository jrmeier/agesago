import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createUnitAvatar } from './modelBridge';
import { buildingModel } from './buildings';
import type { UnitKind } from '../core/types';

describe('naval and priest models', () => {
  for (const kind of ['priest','fishingBoat','merchantShip','trireme','transport'] as UnitKind[]) it(`${kind} has finite ground-anchored geometry and animates without replacing meshes`, () => {
    const avatar=createUnitAvatar(kind,0x2077ba,17); const box=new THREE.Box3().setFromObject(avatar.object);
    expect(box.min.y).toBeGreaterThanOrEqual(-.1); expect(box.max.y).toBeGreaterThan(1);
    let triangles=0; avatar.object.traverse(o=> { if (!(o instanceof THREE.Mesh)) return;
      const pos=o.geometry.getAttribute('position'); expect(Array.from(pos.array).every(Number.isFinite)).toBe(true);
      triangles+=(o.geometry.index?.count??pos.count)/3; });
    expect(triangles).toBeGreaterThan(80); expect(triangles).toBeLessThan(1500);
    const meshes=avatar.object.children.length; avatar.setPose('walk',5); avatar.setPose('attack',5); avatar.setPose('idle',0);
    expect(avatar.object.children.length).toBe(meshes);
  });
  it('dock and temple fit their actual placement footprints', () => {
    for (const kind of ['dock','temple'] as const) {
      const model=buildingModel(kind); const box=new THREE.Box3().setFromObject(model), size=box.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(4,4); expect(size.z).toBeCloseTo(4,4); expect(box.min.y).toBeCloseTo(0,4);
    }
  });
});
