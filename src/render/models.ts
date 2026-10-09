import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREE_FOLIAGE, TREE_TRUNK, VILLAGER } from './palette';

export type Triple = [number, number, number];

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

/** Stable local randomness for procedural model variants. */
export function seededRandom(seed: number): Random {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), value | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bake a transformed part with weathering, face highlights and vertex colour variation. */
export function part(
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
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const vertices = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const color = new THREE.Color(hex);
  const colors = new Float32Array(vertices.count * 3);
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const height = (y - bounds.min.y) / Math.max(0.01, bounds.max.y - bounds.min.y);
    const noise = Math.sin(x * 37.1 + y * 57.7 + z * 91.3 + hex) * 0.035;
    const shade = 0.9 + height * 0.075 + Math.max(0, normals.getY(i)) * 0.07 + noise;
    colors[i * 3] = Math.min(1, color.r * shade);
    colors[i * 3 + 1] = Math.min(1, color.g * shade);
    colors[i * 3 + 2] = Math.min(1, color.b * shade);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Merge coloured parts, disposing their temporary geometries. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  for (const piece of parts) piece.dispose();
  if (!geometry) throw new Error('Model parts have incompatible geometry attributes');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Centre a merged static model and seat its lowest vertex at zero. */
export function grounded(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const geometry = merge(parts);
  const bounds = geometry.boundingBox!;
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

/** Roughen shared vertices consistently so faceted surfaces remain watertight. */
export function roughen(geometry: THREE.BufferGeometry, random: Random): THREE.BufferGeometry {
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

/** A compact irregular foliage or stone cluster. */
export function crown(random: Random, color: number, position: Triple, scale: Triple): THREE.BufferGeometry {
  return part(roughen(new THREE.IcosahedronGeometry(1, 0), random), color, position, scale);
}

/** Six temperate and Mediterranean tree silhouettes, each below 260 triangles. */
export function treeGeometries(): THREE.BufferGeometry[] {
  const broadleaf = seededRandom(11);
  const pine = seededRandom(29);
  const birch = seededRandom(47);
  const cypress = seededRandom(53);
  const olive = seededRandom(59);
  const umbrella = seededRandom(61);
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
    grounded([
      part(new THREE.CylinderGeometry(0.065, 0.17, 1.3, 6), TREE_TRUNK, [0, 0.65, 0]),
      crown(cypress, 0x284c32, [0, 1.75, 0], [0.43, 1.25, 0.44]),
      crown(cypress, 0x365d36, [0.02, 2.7, 0], [0.34, 1.14, 0.34]),
      part(roughen(new THREE.ConeGeometry(0.24, 0.95, 7), cypress), 0x456c3c, [0, 3.57, 0]),
    ], 'tree-cypress'),
    grounded([
      part(new THREE.CylinderGeometry(0.13, 0.25, 1.05, 6), 0x777360, [0.07, 0.52, 0], [1, 1, 1], [0, 0, -0.16]),
      part(new THREE.CylinderGeometry(0.1, 0.15, 0.95, 5), 0x6e6b58, [-0.03, 1.44, 0], [1, 1, 1], [0.12, 0.6, 0.36]),
      ...[-1, 1].map(side => part(new THREE.CylinderGeometry(0.04, 0.11, 1.1, 5), 0x85816c,
        [side * 0.33, 1.7, 0.04], [1, 1, 1], [0.18, 0, side * -0.68])),
      crown(olive, 0x7c9268, [-0.6, 2.18, 0], [0.73, 0.57, 0.78]),
      crown(olive, 0x94a781, [0.57, 2.25, 0.02], [0.76, 0.6, 0.77]),
      crown(olive, 0x647b58, [0, 2.23, -0.5], [0.75, 0.65, 0.67]),
      crown(olive, 0xa2b18b, [0.03, 2.48, 0.43], [0.79, 0.57, 0.69]),
    ], 'tree-olive'),
    grounded([
      part(new THREE.CylinderGeometry(0.11, 0.2, 2.9, 6), TREE_TRUNK, [0, 1.45, 0]),
      ...[-1, 1].map(side => part(new THREE.CylinderGeometry(0.04, 0.1, 1.18, 5), TREE_TRUNK,
        [side * 0.35, 2.47, 0], [1, 1, 1], [0, 0, side * -0.65])),
      crown(umbrella, 0x3d673a, [-0.68, 2.97, 0.03], [0.91, 0.48, 0.94]),
      crown(umbrella, 0x577d43, [0.64, 3.06, 0.02], [0.91, 0.46, 0.95]),
      crown(umbrella, 0x466d3a, [0, 3.13, -0.6], [1.03, 0.46, 0.8]),
      crown(umbrella, 0x64884a, [0, 3.22, 0.49], [1.06, 0.43, 0.82]),
    ], 'tree-stone-pine'),
  ];
}

/** A short bark stump with a pale cut surface and spreading roots. */
export function stumpGeometry(): THREE.BufferGeometry {
  return grounded([
    part(new THREE.CylinderGeometry(0.2, 0.26, 0.32, 7), TREE_TRUNK, [0, 0.16, 0]),
    part(new THREE.CylinderGeometry(0.174, 0.174, 0.018, 7), 0xc4956a, [0, 0.323, 0]),
    part(new THREE.RingGeometry(0.085, 0.093, 7), 0x9c7a3c, [0, 0.333, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]),
    part(new THREE.BoxGeometry(0.015, 0.008, 0.2), TREE_TRUNK, [0.02, 0.334, 0.04]),
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
    ...berries.slice(0, 3).map(([x, y, z]) => part(new THREE.ConeGeometry(0.035, 0.03, 4), BUSH_FOLIAGE[1], [x, y + 0.079, z])),
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
    part(new THREE.BoxGeometry(0.035, 0.16, 0.025), 0xf0c84a, [0.26, 0.28, -0.32], [1, 1, 1], [0, 0, 0.65]),
    part(new THREE.BoxGeometry(0.14, 0.025, 0.02), 0xd4a843, [-0.2, 0.25, -0.38], [1, 1, 1], [0, 0, -0.2]),
  ], 'gold-pile');
}

/** Build a 0.95 m villager with looping limb poses, tools and optional carried goods. */
export function createVillager(opts?: { tunic?: number; skin?: number; seed?: number }): VillagerModel {
  const tunic = opts?.tunic ?? VILLAGER.tunic;
  const skin = opts?.skin ?? VILLAGER.head;
  const random = seededRandom(opts?.seed ?? 1);
  const phase = random() * Math.PI * 2;
  const hair = [0x493623, TREE_TRUNK, 0x8a6c34][Math.floor(random() * 3)];
  const dress = Math.abs(Math.trunc(opts?.seed ?? 1)) % 3;
  const trim = [0x9e3b26, 0x446b81, 0x9c7a3c][dress];
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
    part(new THREE.CylinderGeometry(0.115, 0.15, 0.34, 6), tunic, [0, 0.14, 0]),
    part(new THREE.CylinderGeometry(0.145, 0.155, 0.035, 6), trim, [0, -0.014, 0]),
    part(new THREE.BoxGeometry(0.25, 0.025, 0.21), TREE_TRUNK, [0, 0.11, 0]),
    part(new THREE.BoxGeometry(0.035, 0.034, 0.014), 0xb89b53, [0, 0.11, 0.11]),
    part(new THREE.BoxGeometry(0.038, 0.31, 0.012), 0xd8c5a0, [-0.065, 0.15, 0.125], [1, 1, 1], [0, 0, -0.05]),
    part(new THREE.BoxGeometry(0.06, 0.06, 0.06), skin, [0, 0.335, 0]),
    part(new THREE.BoxGeometry(0.17, 0.18, 0.16), skin, [0, 0.44, 0]),
    part(new THREE.BoxGeometry(0.184, 0.07, 0.176), hair, [0, 0.535, -0.005]),
    part(new THREE.BoxGeometry(0.035, 0.04, 0.028), skin, [0, 0.438, 0.091]),
    part(new THREE.BoxGeometry(0.019, 0.017, 0.008), 0x493623, [-0.039, 0.472, 0.083]),
    part(new THREE.BoxGeometry(0.019, 0.017, 0.008), 0x493623, [0.039, 0.472, 0.083]),
    ...(dress === 0 ? [
      part(new THREE.BoxGeometry(0.26, 0.32, 0.024), trim, [0, 0.16, -0.118], [1, 1, 1], [-0.12, 0, 0]),
    ] : dress === 1 ? [
      part(new THREE.CylinderGeometry(0.17, 0.17, 0.014, 7), 0xd9bb78, [0, 0.542, -0.005]),
      part(new THREE.CylinderGeometry(0.055, 0.09, 0.043, 7), 0xc3a369, [0, 0.564, -0.005]),
    ] : [
      part(new THREE.BoxGeometry(0.19, 0.056, 0.18), 0xe4d9bd, [0, 0.528, -0.005]),
      part(new THREE.BoxGeometry(0.08, 0.15, 0.025), 0xd8c5a0, [0.07, 0.46, -0.09]),
    ]),
  ]), body, 'torso-head');

  const legGeometry = merge([
    part(new THREE.BoxGeometry(0.08, 0.28, 0.085), skin, [0, -0.14, 0]),
    part(new THREE.BoxGeometry(0.086, 0.095, 0.091), 0xd8c5a0, [0, -0.23, 0]),
    part(new THREE.BoxGeometry(0.105, 0.03, 0.145), 0x493623, [0, -0.365, 0.024]),
    part(new THREE.BoxGeometry(0.085, 0.026, 0.017), TREE_TRUNK, [0, -0.343, 0.049]),
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
