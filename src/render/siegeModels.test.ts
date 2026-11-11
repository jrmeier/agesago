import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { UnitKind } from '../core/types';
import { buildingModel } from './buildings';
import { createUnitAvatar, projectileGeometry } from './modelBridge';

/** M16-2 placeholders (real siege models are M16-3): they must build without crashing and have size. */
describe('siege placeholders', () => {
  it('builds every siege engine avatar and poses it', () => {
    for (const kind of ['ram', 'catapult', 'boltShooter'] as UnitKind[]) {
      const avatar = createUnitAvatar(kind, 0x2077ba, 5);
      for (const pose of ['idle', 'walk', 'attack', 'die']) avatar.setPose(pose, 0.5);
      const size = new THREE.Box3().setFromObject(avatar.object).getSize(new THREE.Vector3());
      expect(size.x, kind).toBeGreaterThan(0.2);
    }
  });

  it('builds boulder and bolt projectiles and the siege workshop', () => {
    const boulder = projectileGeometry('boulder');
    const stone = projectileGeometry('stone');
    boulder.computeBoundingSphere();
    stone.computeBoundingSphere();
    expect(boulder.boundingSphere!.radius).toBeGreaterThan(stone.boundingSphere!.radius * 2);
    expect(projectileGeometry('bolt').getAttribute('position').count).toBeGreaterThan(0);
    const shop = new THREE.Box3().setFromObject(buildingModel('siegeWorkshop')).getSize(new THREE.Vector3());
    expect(shop.y).toBeGreaterThan(1.5);
  });
});
