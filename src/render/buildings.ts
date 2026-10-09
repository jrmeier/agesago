import * as THREE from 'three';
import { TREE_TRUNK, SELECTION } from './palette';
import { merge, modelMaterial, part } from './models';
import { amphoraParts, bevelBox, block, crateParts, gableParts, roofParts } from './props';

/** Ancient civic centre, ground-anchored with its portico facing +z. */
export function buildTownCenter(baseHeight: number): THREE.Group {
  const parts = [
    part(bevelBox(3.25, 0.26, 3.25), 0xb4ae98, [0, 0.13, 0]),
    part(bevelBox(3.03, 0.15, 3.03), 0xc9c2a9, [0, 0.335, 0]),
    block([2.6, 0.12, 0.35], 0xc3b99f, [0, 0.06, 1.78]),
    block([2.6, 0.12, 0.31], 0xd4ccb4, [0, 0.18, 1.59]),
    part(bevelBox(2.88, 2.13, 2.13), 0xe1dac4, [0, 1.475, -0.41]),
    block([3.15, 0.15, 3.15], 0xd0c6ab, [0, 2.57, 0]),
    block([3.18, 0.12, 3.18], 0x9d4937, [0, 2.705, 0]),
    ...gableParts(3.16, 3.17, 2.75, 0.92, 0xe1dac4),
    ...roofParts(3.45, 3.5, 2.75, 0.97, false, 6),
    block([0.75, 1.44, 0.07], TREE_TRUNK, [0, 1.1, 0.675]),
    block([0.82, 0.09, 0.11], 0xb9b097, [0, 1.845, 0.7]),
  ];
  for (let i = 0; i < 5; i++) {
    const x = -1.19 + i * 0.595;
    parts.push(block([0.27, 0.12, 0.29], 0xd7cfb9, [x, 0.47, 1.2]));
    parts.push(part(new THREE.CylinderGeometry(0.09, 0.12, 1.88, 8), 0xe9e2cc, [x, 1.47, 1.2]));
    parts.push(part(new THREE.CylinderGeometry(0.14, 0.12, 0.12, 8), 0xcac1a9, [x, 2.47, 1.2]));
    parts.push(block([0.29, 0.08, 0.3], 0xe3d9be, [x, 2.555, 1.2]));
  }
  for (let i = 0; i < 6; i++) {
    parts.push(block([0.47, 0.23, 2.17], [0xb8b09a, 0xc6bea9, 0xd0c7b0][i % 3], [-1.19 + i * 0.475, 0.53, -0.41]));
    parts.push(block([0.26, 0.04, 0.025], SELECTION, [-1.25 + i * 0.5, 2.7, 1.605]));
  }
  for (const side of [-1, 1]) {
    const angle = Math.atan2(0.92, 1.58);
    parts.push(block([1.84, 0.08, 0.06], 0x446c78, [side * 0.79, 3.24, 1.62], [0, 0, -side * angle]));
    parts.push(block([0.4, 0.57, 0.025], 0x685a43, [side * 1.445, 1.77, -0.47], [0, Math.PI / 2, 0]));
  }
  const shellEnd = parts.length;
  parts.push(...amphoraParts(-1.33, 0.41, 0.7, 0.7));
  parts.push(...amphoraParts(1.34, 0.41, 0.6, 0.65));
  parts.push(...crateParts([1.35, 0, -1.58], 0.34));
  const storesEnd = parts.length;
  parts.push(part(new THREE.CylinderGeometry(0.025, 0.035, 1.29, 5), TREE_TRUNK, [-1.44, 3.455, -0.78]));
  parts.push(part(new THREE.OctahedronGeometry(0.095), SELECTION, [-1.44, 4.145, -0.78], [0.8, 1.2, 0.65]));
  parts.push(block([0.39, 0.52, 0.027], 0x9e3b26, [-1.235, 3.81, -0.78]));
  parts.push(block([0.035, 0.45, 0.038], SELECTION, [-1.06, 3.81, -0.78]));
  parts.push(block([0.27, 0.045, 0.038], SELECTION, [-1.235, 3.96, -0.78]));
  const object = new THREE.Group();
  object.name = 'town-center';
  const material = modelMaterial();
  const sections: [string, THREE.BufferGeometry[]][] = [
    ['plinth', parts.slice(0, 4)], ['agora', parts.slice(4, shellEnd)],
    ['stores', parts.slice(shellEnd, storesEnd)], ['standard', parts.slice(storesEnd)],
  ];
  for (const [name, pieces] of sections) {
    const mesh = new THREE.Mesh(merge(pieces), material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    object.add(mesh);
  }
  object.position.y = baseHeight;
  return object;
}
