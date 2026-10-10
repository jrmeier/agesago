import * as THREE from 'three';
import { block } from './props';
import { merge, modelMaterial, part } from './models';

/** Robed priest with a sun medallion and a bronze crook; distinct from armed citizens. */
export function createPriest(_kind: string, opts: { color: number }): { object: THREE.Group; setPose(pose: string, t: number, extra?: { progress?: number }): void } {
  const object = new THREE.Group(); object.name = 'priest';
  const rig = new THREE.Group(); rig.name = 'rig'; object.add(rig);
  const parts = [
    part(new THREE.ConeGeometry(0.27, 0.85, 8), 0xf0e4c9, [0, 0.43, 0]),
    block([0.36, 0.48, 0.22], opts.color, [0, 0.9, 0]),
    part(new THREE.SphereGeometry(0.13, 6, 4), 0xd7af86, [0, 1.28, 0]),
    part(new THREE.CylinderGeometry(0.16, 0.14, 0.14, 8), 0xf0e4c9, [0, 1.44, 0]),
    part(new THREE.CylinderGeometry(0.025, 0.025, 1.45, 5), 0x8a592c, [0.29, 0.77, 0.12]),
    part(new THREE.TorusGeometry(0.085, 0.018, 4, 8, Math.PI * 1.5), 0xc9a045, [0.34, 1.48, 0.12]),
    part(new THREE.OctahedronGeometry(0.065), 0xe8bb52, [0, 1.03, 0.13]),
    block([0.14, 0.06, 0.27], 0x745534, [-0.12, 0.035, 0.04]),
    block([0.14, 0.06, 0.27], 0x745534, [0.12, 0.035, 0.04]),
  ];
  const mesh = new THREE.Mesh(merge(parts), modelMaterial()); mesh.castShadow = mesh.receiveShadow = true; rig.add(mesh);
  return { object, setPose(pose, t, extra) {
    rig.position.y = pose === 'walk' ? Math.abs(Math.sin(t * 6)) * 0.035 : 0;
    rig.rotation.x = pose === 'die' ? -Math.min(1, extra?.progress ?? t) * Math.PI / 2 : 0;
  } };
}
