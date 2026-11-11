import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CIV_IDS } from '../core/civilizations';
import { BUILDINGS } from '../core/buildings';
import { isChampion, UNITS } from '../core/units';
import type { UnitKind } from '../core/types';
import { buildingModel } from './buildings';
import { createBuildingVisual } from './buildingVisuals';
import { createUnitAvatar } from './modelBridge';

const vertices = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((c) => { if (c instanceof THREE.Mesh) n += c.geometry.getAttribute('position').count; });
  return n;
};

describe('fortress model (M16-5)', () => {
  it('has a distinct low-poly style per civ that fills the 5 × 5 footprint', () => {
    const counts = CIV_IDS.map((civ) => {
      const model = buildingModel('fortress', { civ, color: 0x2255cc });
      expect(model.userData.civ).toBe(civ);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(BUILDINGS.fortress.size.w, 1);
      expect(size.z).toBeCloseTo(BUILDINGS.fortress.size.d, 1);
      expect(size.y).toBeGreaterThan(3);
      const n = vertices(model);
      expect(n).toBeLessThan(20000);
      return n;
    });
    expect(new Set(counts).size).toBe(CIV_IDS.length);
  });

  it('builds a full visual with foundation stages', () => {
    const visual = createBuildingVisual('fortress', 0x2255cc, 0, 'celts');
    visual.setProgress(0.5, false);
    visual.setProgress(1, true);
    expect(visual.object.getObjectByName('finished')?.visible).toBe(true);
  });
});

describe('champion models (M16-5)', () => {
  const champions = (Object.keys(UNITS) as UnitKind[]).filter(isChampion);
  it.each(champions)('%s wears a champion kit over its line model', (kind) => {
    const avatar = createUnitAvatar(kind, 0x2255cc, 3);
    expect(avatar.object.name).toBe(kind);
    expect(avatar.object.getObjectByName('champion-kit')).toBeDefined();
    for (const pose of ['idle', 'walk', 'attack', 'die']) avatar.setPose(pose, 0.4);
    avatar.setOpacity(0.5);
  });
});
