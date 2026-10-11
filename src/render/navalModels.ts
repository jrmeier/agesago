import * as THREE from 'three';
import { block, crateParts } from './props';
import { merge, modelMaterial, part } from './models';
import type { UnitKind } from '../core/types';

/** Baked pointed hull, deck, mast, rigging and working gear. Each ship has a distinct silhouette. */
export function createShip(kind: UnitKind, opts: { color: number }): { object: THREE.Group; setPose(pose: string, t: number, extra?: { progress?: number }): void } {
  const object = new THREE.Group(); object.name = kind;
  const rig = new THREE.Group(); rig.name = 'rig'; object.add(rig);
  const length = kind === 'trireme' ? 3.3 : kind === 'merchantShip' ? 2.8 : kind === 'transport' ? 2.7 : 1.9;
  const width = kind === 'fishingBoat' ? 0.65 : kind === 'trireme' ? 0.85 : 1.15;
  const shape = new THREE.Shape(); shape.moveTo(0, -length / 2);
  shape.quadraticCurveTo(width * 0.65, -length * 0.3, width / 2, 0);
  shape.quadraticCurveTo(width * 0.6, length * 0.28, 0, length / 2);
  shape.quadraticCurveTo(-width * 0.6, length * 0.28, -width / 2, 0);
  shape.quadraticCurveTo(-width * 0.65, -length * 0.3, 0, -length / 2);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.06, bevelThickness: 0.08, curveSegments: 4 });
  hull.rotateX(Math.PI / 2);
  const parts = [part(hull, 0x765033, [0, 0.42, 0]), block([width * 0.68, 0.04, length * 0.66], 0xb59560, [0, 0.48, 0])];
  for (const x of [-width * 0.43, width * 0.43]) parts.push(block([0.055, 0.15, length * 0.72], opts.color, [x, 0.51, 0]));
  for (let z = -length * 0.3; z <= length * 0.3; z += 0.3) parts.push(block([width * 0.75, 0.055, 0.11], 0xa98551, [0, 0.55, z]));
  const mastHeight = kind === 'fishingBoat' ? 1.1 : kind === 'merchantShip' ? 2.3 : 1.65;
  parts.push(part(new THREE.CylinderGeometry(0.025, 0.05, mastHeight, 6), 0x765033, [0, 0.5 + mastHeight / 2, -0.12]));
  parts.push(block([width * 1.3, 0.045, 0.04], 0x765033, [0, 0.55 + mastHeight * 0.83, -0.1]));
  parts.push(block([width * 1.15, mastHeight * 0.55, 0.035], kind === 'trireme' ? opts.color : 0xe9dfbf, [0, 0.55 + mastHeight * 0.55, -0.1]));
  parts.push(block([width * 0.23, mastHeight * 0.55, 0.041], opts.color, [0, 0.55 + mastHeight * 0.55, -0.075]));
  if (kind === 'merchantShip') { parts.push(...crateParts([-0.23, 0.53, 0.5], 0.32), ...crateParts([0.23, 0.53, 0.5], 0.32)); }
  if (kind === 'fishingBoat') {
    parts.push(part(new THREE.CylinderGeometry(0.18, 0.15, 0.22, 6), 0xbaa57d, [0, 0.65, 0.45]));
    for (let i = 0; i < 4; i++) parts.push(block([0.5, 0.015, 0.015], 0xd7caae, [0.32, 0.3, 0.2 + i * 0.13], [0, 0.4, -0.4]));
  }
  if (kind === 'trireme') { parts.push(part(new THREE.ConeGeometry(0.12, 0.58, 5), 0xb99843, [0, 0.38, length / 2 + 0.19], [Math.PI / 2, 0, 0])); }
  if (kind === 'transport') {
    for (const x of [-0.26, 0.26]) for (const z of [-0.5, 0.45]) parts.push(block([0.23, 0.17, 0.23], 0x7c4e30, [x, 0.66, z]));
    parts.push(block([width * 0.7, 0.09, 0.4], 0xb59560, [0, 0.55, length * 0.41]));
  }
  const material = modelMaterial(); const body = new THREE.Mesh(merge(parts), material); body.name = 'hull-and-rigging'; body.castShadow = body.receiveShadow = true; rig.add(body);
  const banks: THREE.Mesh[] = [];
  for (const sign of [-1, 1]) {
    const oars = []; const count = kind === 'trireme' ? 10 : kind === 'fishingBoat' ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const z = -length * 0.3 + i / Math.max(1, count - 1) * length * 0.6;
      oars.push(block([0.66, 0.025, 0.035], 0x947344, [sign * (width * 0.5 + 0.22), 0.3, z], [0, sign * 0.2, sign * 0.1]));
      oars.push(block([0.19, 0.028, 0.12], 0x947344, [sign * (width * 0.5 + 0.5), 0.28, z - 0.05]));
    }
    const bank = new THREE.Mesh(merge(oars), material); bank.name = sign < 0 ? 'port-oars' : 'starboard-oars'; rig.add(bank); banks.push(bank);
  }
  return { object, setPose(pose, t, extra) {
    rig.position.y = pose === 'die' ? -Math.min(1, extra?.progress ?? t) * 1.1 : 0;
    rig.rotation.z = pose === 'die' ? Math.min(1, extra?.progress ?? t) * 0.5 : 0;
    for (const bank of banks) bank.rotation.y = pose === 'walk' || pose === 'attack' ? Math.sin(t * 4) * 0.045 : 0;
  } };
}
