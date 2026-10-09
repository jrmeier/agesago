import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREE_FOLIAGE, TREE_TRUNK, VILLAGER } from './palette';

type Triple = [number, number, number];

/** Lighter, yellower greens than tree canopies so berry bushes read as food at a glance. */
const BUSH_FOLIAGE = [0x7fae4e, 0x6f9e44, 0x8cbc58];
type Random = () => number;

/** Create one vertex-colour material to share across model meshes and instances. */
export const modelMaterial = (): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Procedural villager animation states. */
export type VillagerPose = 'idle' | 'walk' | 'chop' | 'forage' | 'mine';

/** A ground-anchored villager facing +z; animate without changing its world transform. */
export interface VillagerModel {
  object: THREE.Group;
  setPose(state: VillagerPose, t: number, carry?: 'wood' | 'food' | 'gold' | null): void;
}

function seededRandom(seed: number): Random {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), value | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function part(
  source: THREE.BufferGeometry,
  hex: number,
  position: Triple = [0, 0, 0],
  scale: Triple = [1, 1, 1],
  rotation: Triple = [0, 0, 0]
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  geometry.deleteAttribute('uv');
  geometry.scale(...scale);
  geometry.rotateX(rotation[0]);
  geometry.rotateY(rotation[1]);
  geometry.rotateZ(rotation[2]);
  geometry.translate(...position);
  const color = new THREE.Color(hex);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  for (const piece of parts) piece.dispose();
  if (!geometry) throw new Error('Model parts have incompatible geometry attributes');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function grounded(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const geometry = merge(parts);
  const bounds = geometry.boundingBox!;
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

function roughen(geometry: THREE.BufferGeometry, random: Random): THREE.BufferGeometry {
  const vertices = geometry.getAttribute('position');
  const radii = new Map<string, number>();
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i);
    const y = vertices.getY(i);
    const z = vertices.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let radius = radii.get(key);
    if (radius === undefined) {
      radius = 0.92 + random() * 0.16;
      radii.set(key, radius);
    }
    vertices.setXYZ(i, x * radius, y * radius, z * radius);
  }
  return geometry;
}

function crown(random: Random, color: number, position: Triple, scale: Triple): THREE.BufferGeometry {
  return part(roughen(new THREE.IcosahedronGeometry(1, 0), random), color, position, scale);
}

/** Three deterministic, faceted tree variants, each below 220 triangles. */
export function treeGeometries(): THREE.BufferGeometry[] {
  const broadleaf = seededRandom(11);
  const pine = seededRandom(29);
  const birch = seededRandom(47);
  return [
    grounded([
      part(new THREE.CylinderGeometry(0.12, 0.21, 1.95, 6), TREE_TRUNK, [0, 0.975, 0]),
      part(new THREE.CylinderGeometry(0.04, 0.08, 0.95, 4), TREE_TRUNK, [-0.27, 1.85, 0], [1, 1, 1], [0, 0, 0.62]),
      part(new THREE.CylinderGeometry(0.04, 0.08, 0.95, 4), TREE_TRUNK, [0.27, 1.85, 0], [1, 1, 1], [0, 0, -0.62]),
      crown(broadleaf, TREE_FOLIAGE[0], [-0.54, 2.35, 0.05], [0.72, 0.83, 0.75]),
      crown(broadleaf, TREE_FOLIAGE[1], [0.54, 2.4, 0.04], [0.72, 0.8, 0.75]),
      crown(broadleaf, TREE_FOLIAGE[0], [0, 2.3, -0.48], [0.8, 0.8, 0.7]),
      crown(broadleaf, TREE_FOLIAGE[2], [0, 2.4, 0.48], [0.79, 0.8, 0.7]),
      crown(broadleaf, TREE_FOLIAGE[2], [0.02, 2.82, 0], [0.89, 0.92, 0.87]),
    ], 'tree-broadleaf'),
    grounded([
      part(new THREE.CylinderGeometry(0.08, 0.17, 2.9, 6), TREE_TRUNK, [0, 1.45, 0]),
      part(roughen(new THREE.ConeGeometry(1.12, 1.65, 8), pine), TREE_FOLIAGE[1], [0, 1.79, 0]),
      part(roughen(new THREE.ConeGeometry(0.87, 1.45, 8), pine), TREE_FOLIAGE[0], [0, 2.65, 0]),
      part(roughen(new THREE.ConeGeometry(0.57, 1.2, 8), pine), TREE_FOLIAGE[2], [0, 3.4, 0]),
    ], 'tree-pine'),
    grounded([
      part(new THREE.CylinderGeometry(0.075, 0.13, 2.65, 6), 0xd8c5a0, [0, 1.325, 0]),
      ...[0.35, 0.77, 1.2, 1.65].map((y, i) =>
        part(new THREE.BoxGeometry(0.12, 0.035, 0.035), TREE_TRUNK, [0, y, i % 2 ? -0.09 : 0.09])
      ),
      part(new THREE.CylinderGeometry(0.025, 0.05, 0.8, 4), 0xd8c5a0, [-0.2, 2.2, 0], [1, 1, 1], [0, 0, 0.5]),
      part(new THREE.CylinderGeometry(0.025, 0.05, 0.8, 4), 0xd8c5a0, [0.2, 2.2, 0], [1, 1, 1], [0, 0, -0.5]),
      crown(birch, TREE_FOLIAGE[2], [-0.45, 2.58, 0.02], [0.69, 0.86, 0.97]),
      crown(birch, 0x6aa84f, [0.45, 2.65, -0.02], [0.69, 0.86, 0.97]),
      crown(birch, TREE_FOLIAGE[2], [0, 2.95, 0], [0.73, 1.02, 1.02]),
    ], 'tree-birch'),
  ];
}

/** A short bark stump with a pale cut surface and spreading roots. */
export function stumpGeometry(): THREE.BufferGeometry {
  return grounded([
    part(new THREE.CylinderGeometry(0.2, 0.26, 0.32, 7), TREE_TRUNK, [0, 0.16, 0]),
    part(new THREE.CylinderGeometry(0.174, 0.174, 0.018, 7), 0xc4956a, [0, 0.323, 0]),
    ...[0, 2 * Math.PI / 3, 4 * Math.PI / 3].map(angle =>
      part(new THREE.BoxGeometry(0.14, 0.1, 0.34), TREE_TRUNK,
        [Math.sin(angle) * 0.22, 0.05, Math.cos(angle) * 0.22], [1, 1, 1], [0, angle, 0])
    ),
  ], 'stump');
}

/** A knee-high leafy bush with red berries on its exposed sides. */
export function berryBushGeometry(): THREE.BufferGeometry {
  const random = seededRandom(71);
  const berries: Triple[] = [
    [-0.38, 0.37, 0.31], [-0.19, 0.59, 0.36], [0.06, 0.32, 0.4], [0.3, 0.53, 0.34],
    [0.5, 0.34, 0.07], [-0.5, 0.43, -0.05], [-0.16, 0.56, -0.4], [0.25, 0.37, -0.35],
    [0.02, 0.66, 0.12], [-0.3, 0.6, -0.12], [0.33, 0.6, -0.06],
  ];
  return grounded([
    part(new THREE.CylinderGeometry(0.035, 0.07, 0.52, 4), TREE_TRUNK, [0, 0.26, 0]),
    crown(random, BUSH_FOLIAGE[1], [-0.28, 0.38, 0], [0.46, 0.36, 0.46]),
    crown(random, BUSH_FOLIAGE[0], [0.28, 0.38, 0], [0.46, 0.36, 0.46]),
    crown(random, BUSH_FOLIAGE[2], [0, 0.48, -0.08], [0.5, 0.36, 0.48]),
    ...berries.map((position, i) => part(new THREE.OctahedronGeometry(0.095), i % 2 ? 0xc74432 : 0x9e3b26, position)),
  ], 'berry-bush');
}

/** A low grey rock outcrop with bright gold nuggets and exposed veins. */
export function goldPileGeometry(): THREE.BufferGeometry {
  const random = seededRandom(97);
  return grounded([
    crown(random, 0x888579, [0, 0.29, -0.02], [0.43, 0.4, 0.38]),
    crown(random, 0x787569, [-0.36, 0.18, 0.08], [0.32, 0.25, 0.3]),
    crown(random, 0xc9a640, [0.36, 0.2, 0.04], [0.32, 0.27, 0.3]),
    crown(random, 0x787569, [-0.18, 0.15, -0.27], [0.28, 0.22, 0.25]),
    crown(random, 0xc9a640, [0.17, 0.12, 0.28], [0.3, 0.2, 0.24]),
    part(new THREE.OctahedronGeometry(0.18), 0xd4a843, [-0.33, 0.3, 0.3], [1, 0.8, 0.8]),
    part(new THREE.OctahedronGeometry(0.16), 0xf0c84a, [0.33, 0.36, 0.26]),
    part(new THREE.OctahedronGeometry(0.15), 0xd4a843, [0.05, 0.55, 0.1]),
    part(new THREE.OctahedronGeometry(0.13), 0xf0c84a, [0.1, 0.2, 0.44]),
    part(new THREE.OctahedronGeometry(0.12), 0xd4a843, [-0.22, 0.45, -0.2]),
    part(new THREE.OctahedronGeometry(0.11), 0xf0c84a, [0.3, 0.3, -0.24]),
    part(new THREE.BoxGeometry(0.045, 0.2, 0.025), 0xd4a843, [-0.06, 0.34, 0.31], [1, 1, 1], [0, 0, -0.45]),
    part(new THREE.BoxGeometry(0.15, 0.035, 0.025), 0xe4c98a, [0.07, 0.41, 0.27], [1, 1, 1], [0, 0, -0.3]),
  ], 'gold-pile');
}

/** Build a 0.95 m villager with looping limb poses, tools and optional carried goods. */
export function createVillager(opts?: { tunic?: number; skin?: number; seed?: number }): VillagerModel {
  const tunic = opts?.tunic ?? VILLAGER.tunic;
  const skin = opts?.skin ?? VILLAGER.head;
  const random = seededRandom(opts?.seed ?? 1);
  const phase = random() * Math.PI * 2;
  const hair = [0x493623, TREE_TRUNK, 0x8a6c34][Math.floor(random() * 3)];
  const material = modelMaterial();
  const object = new THREE.Group();
  object.name = 'villager';
  const rig = new THREE.Group();
  rig.name = 'rig';
  object.add(rig);

  function mesh(geometry: THREE.BufferGeometry, parent: THREE.Object3D, name: string): THREE.Mesh {
    const result = new THREE.Mesh(geometry, material);
    result.name = name;
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function pivot(parent: THREE.Object3D, name: string, position: Triple): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    parent.add(group);
    return group;
  }

  const body = pivot(rig, 'body', [0, 0.38, 0]);
  mesh(merge([
    part(new THREE.CylinderGeometry(0.115, 0.145, 0.31, 5), tunic, [0, 0.155, 0]),
    part(new THREE.BoxGeometry(0.275, 0.035, 0.2), TREE_TRUNK, [0, 0.085, 0]),
    part(new THREE.BoxGeometry(0.06, 0.06, 0.06), skin, [0, 0.335, 0]),
    part(new THREE.BoxGeometry(0.17, 0.18, 0.16), skin, [0, 0.44, 0]),
    part(new THREE.BoxGeometry(0.184, 0.07, 0.176), hair, [0, 0.535, -0.005]),
    part(new THREE.BoxGeometry(0.035, 0.04, 0.028), skin, [0, 0.438, 0.091]),
    part(new THREE.BoxGeometry(0.019, 0.017, 0.008), 0x493623, [-0.039, 0.472, 0.083]),
    part(new THREE.BoxGeometry(0.019, 0.017, 0.008), 0x493623, [0.039, 0.472, 0.083]),
  ]), body, 'torso-head');

  const legGeometry = merge([
    part(new THREE.BoxGeometry(0.08, 0.28, 0.085), 0x5a3d24, [0, -0.14, 0]),
    part(new THREE.BoxGeometry(0.105, 0.1, 0.145), 0x493623, [0, -0.33, 0.024]),
  ]);
  const leftLeg = pivot(rig, 'leftLeg', [-0.075, 0.38, 0]);
  const rightLeg = pivot(rig, 'rightLeg', [0.075, 0.38, 0]);
  mesh(legGeometry, leftLeg, 'left-boot-leg');
  mesh(legGeometry, rightLeg, 'right-boot-leg');

  const armGeometry = merge([
    part(new THREE.BoxGeometry(0.09, 0.14, 0.1), tunic, [0, -0.058, 0]),
    part(new THREE.BoxGeometry(0.066, 0.135, 0.072), skin, [0, -0.181, 0]),
    part(new THREE.BoxGeometry(0.074, 0.06, 0.08), skin, [0, -0.25, 0]),
  ]);
  const leftArm = pivot(body, 'leftArm', [-0.156, 0.25, 0]);
  const rightArm = pivot(body, 'rightArm', [0.156, 0.25, 0]);
  mesh(armGeometry, leftArm, 'left-sleeve-hand');
  mesh(armGeometry, rightArm, 'right-sleeve-hand');

  const axe = mesh(merge([
    part(new THREE.CylinderGeometry(0.013, 0.016, 0.29, 4), TREE_TRUNK, [0, -0.355, 0]),
    part(new THREE.BoxGeometry(0.13, 0.085, 0.03), 0x888579, [0.043, -0.47, 0]),
    part(new THREE.BoxGeometry(0.035, 0.105, 0.04), 0xbfae8e, [0.108, -0.47, 0]),
  ]), rightArm, 'axe');
  const pick = mesh(merge([
    part(new THREE.CylinderGeometry(0.013, 0.016, 0.3, 4), TREE_TRUNK, [0, -0.355, 0]),
    part(new THREE.BoxGeometry(0.16, 0.035, 0.035), 0x888579, [0, -0.49, 0]),
    part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xbfae8e, [-0.1, -0.51, 0], [1, 1, 1], [0, 0, 1.1]),
    part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xbfae8e, [0.1, -0.51, 0], [1, 1, 1], [0, 0, -1.1]),
  ]), rightArm, 'pick');

  const pack = pivot(body, 'pack', [0, 0.16, -0.14]);
  const wood = mesh(merge([
    part(new THREE.CylinderGeometry(0.046, 0.052, 0.32, 4), TREE_TRUNK, [0, 0.04, -0.05], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(0.046, 0.052, 0.29, 4), 0x9c7a3c, [0, 0.13, -0.05], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.BoxGeometry(0.035, 0.19, 0.11), 0xd8c5a0, [0, 0.085, -0.05]),
  ]), pack, 'carry-wood');
  const food = mesh(merge([
    part(new THREE.CylinderGeometry(0.09, 0.066, 0.15, 4), 0x9c7a3c, [0, 0.035, -0.05]),
    ...([-0.05, 0, 0.05] as const).map((x, i) =>
      part(new THREE.OctahedronGeometry(0.037), 0xc74432, [x, 0.12, -0.05 + (i % 2) * 0.025])
    ),
  ]), pack, 'carry-food');
  const gold = mesh(merge([
    part(new THREE.IcosahedronGeometry(0.1, 0), 0x9c7a3c, [0, 0.04, -0.04], [1, 0.8, 0.8]),
    part(new THREE.OctahedronGeometry(0.068), 0xd4a843, [0, 0.12, -0.07]),
  ]), pack, 'carry-gold');

  const corners: THREE.Vector3[] = [];
  const bounds = legGeometry.boundingBox!;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  const point = new THREE.Vector3();

  function setPose(state: VillagerPose, t: number, carry?: 'wood' | 'food' | 'gold' | null): void {
    const cycle = t * Math.PI * 2;
    const stride = Math.sin(cycle * 1.6 + phase);
    const work = 0.5 - 0.5 * Math.cos(cycle * 1.25 + phase);
    body.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    leftLeg.rotation.set(0, 0, 0);
    rightLeg.rotation.set(0, 0, 0);
    leftArm.rotation.set(0, 0, 0.08);
    rightArm.rotation.set(0, 0, -0.08);
    let bob = 0;

    if (state === 'walk') {
      leftLeg.rotation.x = stride * 0.48;
      rightLeg.rotation.x = -stride * 0.48;
      leftArm.rotation.x = -stride * 0.42;
      rightArm.rotation.x = stride * 0.42;
      bob = 0.01 * (1 - Math.cos(2 * (cycle * 1.6 + phase)));
    } else if (state === 'chop' || state === 'mine') {
      rightArm.rotation.x = -0.45 - work * (state === 'chop' ? 2.15 : 1.7);
      leftArm.rotation.x = -0.5 - work * 1.2;
      body.rotation.x = 0.06 + (1 - work) * 0.12;
      body.rotation.y = Math.sin(cycle * 1.25 + phase) * 0.08;
    } else if (state === 'forage') {
      leftLeg.rotation.set(0.95, 0, 0.12);
      rightLeg.rotation.set(0.95, 0, -0.12);
      body.rotation.x = 0.38 + Math.sin(cycle + phase) * 0.04;
      leftArm.rotation.x = -0.9;
      rightArm.rotation.x = -1.1 - Math.sin(cycle + phase) * 0.22;
    } else {
      body.scale.y = 1 + Math.sin(cycle * 0.4 + phase) * 0.006;
    }

    axe.visible = state === 'chop';
    pick.visible = state === 'mine';
    wood.visible = carry === 'wood';
    food.visible = carry === 'food';
    gold.visible = carry === 'gold';

    let sole = Infinity;
    for (const leg of [leftLeg, rightLeg]) {
      leg.updateMatrix();
      for (const corner of corners) sole = Math.min(sole, point.copy(corner).applyMatrix4(leg.matrix).y);
    }
    rig.position.y = -sole + bob;
  }

  setPose('idle', 0);
  return { object, setPose };
}
