import * as THREE from 'three';
import { expect, it } from 'vitest';
import { EntityViews } from './EntityViews';

it('avoids visible solid buildings without treating walkable farms or hidden buildings as camera walls', () => {
  const views = Object.create(EntityViews.prototype) as EntityViews;
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const building = { kind: 'townCenter' };
  Object.assign(views, { cameraRay: new THREE.Raycaster(), buildingViews: new Map([[1, { object }]]),
    memoryViews: new Map(), lastSeen: new Map(), world: { buildings: new Map([[1, building]]) } });
  const from = new THREE.Vector3(0, 0, 3), to = new THREE.Vector3(0, 0, -3);
  expect(views.cameraObstacleDistance(from, to)).toBeCloseTo(2.5);
  object.visible = false;
  expect(views.cameraObstacleDistance(from, to)).toBe(Infinity);
  object.visible = true; building.kind = 'farm';
  expect(views.cameraObstacleDistance(from, to)).toBe(Infinity);
  object.geometry.dispose(); (object.material as THREE.Material).dispose();
});
