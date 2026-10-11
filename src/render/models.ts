import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREE_FOLIAGE, TREE_TRUNK, VILLAGER } from './palette';
import { applyRole, mergeTagged, tag } from './tiers';

export type Triple = [number, number, number];

/** Lighter, yellower greens than tree canopies so berry bushes read as food at a glance. */
const BUSH_FOLIAGE = [0x7fae4e, 0x6f9e44, 0x8cbc58];
type Random = () => number;

/** Create one vertex-colour material to share across model meshes and instances. */
export const modelMaterial = (): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Procedural villager animation states. */
export type VillagerPose = 'idle' | 'walk' | 'chop' | 'forage' | 'mine' | 'build' | 'farm';
export type VillagerCarry = 'wood' | 'food' | 'gold' | 'stone' | null;

/** A ground-anchored villager facing +z; animate without changing its world transform. */
export interface VillagerModel {
  object: THREE.Group;
  setPose(state: VillagerPose, t: number, carry?: VillagerCarry): void;
}

export type ScoutPose = 'idle' | 'walk' | 'gallop';

/** A mounted scout facing +z, with animation confined to its local rig. */
export interface ScoutModel {
  object: THREE.Group;
  setPose(state: ScoutPose, t: number): void;
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

/** Box-built quadrupeds, facing +Z with four hooves seated at Y=0. */
export function createAnimal(kind: 'deer' | 'boar' | 'sheep'): SoldierModel {
  const object = new THREE.Group();
  object.name = kind;
  const rig = new THREE.Group();
  object.add(rig);
  const color = kind === 'sheep' ? 0xe2dcc5 : kind === 'boar' ? 0x574437 : 0xa97848;
  const legHeight = kind === 'deer' ? 0.55 : 0.25;
  const bodyY = legHeight + 0.22;
  const parts = [
    part(new THREE.BoxGeometry(kind === 'deer' ? 0.36 : 0.55, 0.44, 0.85), color, [0, bodyY, 0]),
    part(new THREE.BoxGeometry(0.27, 0.3, 0.32), kind === 'sheep' ? 0x6c5b47 : color, [0, bodyY + (kind === 'deer' ? 0.27 : 0.02), 0.55]),
  ];
  for (const x of [-0.16, 0.16]) for (const z of [-0.3, 0.3]) {
    parts.push(part(new THREE.BoxGeometry(0.09, legHeight, 0.09), 0x554334, [x, legHeight / 2, z]));
  }
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(0.16, 0.07, 0.12), color, [side * 0.2, bodyY + 0.21, 0.5]));
    if (kind === 'deer') {
      parts.push(part(new THREE.BoxGeometry(0.05, 0.35, 0.05), 0xd6c5a0, [side * 0.12, bodyY + 0.55, 0.5]));
      parts.push(part(new THREE.BoxGeometry(0.2, 0.05, 0.05), 0xd6c5a0, [side * 0.17, bodyY + 0.62, 0.5]));
    }
    if (kind === 'boar') parts.push(part(new THREE.BoxGeometry(0.055, 0.13, 0.07), 0xe9dfbf, [side * 0.12, bodyY - 0.03, 0.74]));
  }
  const geometry = grounded(parts, `${kind}-body`);
  geometry.userData.dispose = 1;
  const material = modelMaterial();
  material.userData.owned = 1;
  rig.add(new THREE.Mesh(geometry, material));
  return {
    object,
    setPose(pose, time, extra): void {
      const progress = typeof extra === 'number' ? extra : extra?.progress ?? 0;
      rig.position.y = pose === 'walk' ? Math.abs(Math.sin(time * 6)) * 0.025 : 0;
      rig.rotation.x = pose === 'attack' ? -Math.max(0, Math.sin(time * 6)) * 0.18 : 0;
      rig.rotation.z = pose === 'die' ? Math.min(1, progress) * Math.PI / 2 : 0;
    },
  };
}

export function carcassGeometry(): THREE.BufferGeometry {
  return grounded([
    part(new THREE.BoxGeometry(0.7, 0.22, 0.9), 0x8a5540, [0, 0.11, 0]),
    part(new THREE.BoxGeometry(0.3, 0.17, 0.28), 0xa77b55, [0.1, 0.085, 0.5]),
    part(new THREE.BoxGeometry(0.85, 0.08, 0.12), 0x594334, [0, 0.04, -0.23]),
  ], 'carcass');
}

export function fishGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.24, -0.15], [0.24, 0.15], [0, 0.55]]) {
    pieces.push(part(new THREE.BoxGeometry(0.15, 0.09, 0.4), 0x92b6bb, [x, 0.045, z]));
    pieces.push(part(new THREE.BoxGeometry(0.24, 0.07, 0.08), 0x4b8995, [x, 0.045, z - 0.24]));
  }
  return grounded(pieces, 'fish-school');
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

/** Pale stepped limestone with broad cut faces and dressed blocks; ready for instancing. */
export function stoneQuarryGeometry(): THREE.BufferGeometry {
  const random = seededRandom(211);
  return grounded([
    part(new THREE.BoxGeometry(1.25, 0.42, 0.95), 0xc8c5b2, [0, 0.21, -0.08]),
    part(new THREE.BoxGeometry(0.93, 0.44, 0.72), 0xdad5bd, [-0.12, 0.64, -0.19]),
    part(roughen(new THREE.BoxGeometry(0.61, 0.32, 0.5), random), 0xe5dfca, [-0.25, 1.01, -0.22]),
    ...[0, 1, 2].map(i => part(new THREE.BoxGeometry(0.035, 0.38, 0.012), 0x999887,
      [-0.45 + i * 0.3, 0.64, 0.177])),
    part(new THREE.BoxGeometry(0.38, 0.25, 0.32), 0xe0dac5, [0.58, 0.125, 0.46]),
    part(new THREE.BoxGeometry(0.36, 0.22, 0.29), 0xc2bfab, [0.16, 0.11, 0.53]),
    part(new THREE.BoxGeometry(0.31, 0.23, 0.3), 0xd4cfb9, [0.48, 0.35, 0.44]),
    crown(random, 0xb7b5a3, [-0.64, 0.11, 0.37], [0.19, 0.14, 0.18]),
    crown(random, 0xd4cfb9, [-0.39, 0.08, 0.55], [0.15, 0.1, 0.13]),
  ], 'stone-quarry');
}

/** Separate 4×4 farm crop layer. Scale Y and tint the material as food is consumed. */
export function farmCropsGeometry(): THREE.BufferGeometry {
  const random = seededRandom(223);
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 8; col++) {
      const x = -1.61 + row * 0.64;
      const z = -1.65 + col * 0.47;
      const h = 0.48 + random() * 0.19;
      parts.push(part(new THREE.CylinderGeometry(0.015, 0.027, h, 3), 0x919247, [x, h / 2, z]));
      parts.push(part(new THREE.OctahedronGeometry(0.075), 0xd5ba69, [x, h, z], [0.55, 1.5, 0.55]));
      parts.push(part(new THREE.ConeGeometry(0.055, h * 0.8, 3), 0xa4a253,
        [x + 0.05, h * 0.39, z + 0.025], [1, 1, 0.22], [0, row, -0.23]));
    }
  }
  return grounded(parts, 'farm-crops');
}

/** Build a 0.95 m villager with looping limb poses, tools and optional carried goods. */
export function createVillager(opts?: { color?: number; tunic?: number; skin?: number; seed?: number }): VillagerModel {
  const tunic = opts?.tunic ?? VILLAGER.tunic;
  const skin = opts?.skin ?? VILLAGER.head;
  const random = seededRandom(opts?.seed ?? 1);
  const phase = random() * Math.PI * 2;
  const hair = [0x493623, TREE_TRUNK, 0x8a6c34][Math.floor(random() * 3)];
  const dress = Math.abs(Math.trunc(opts?.seed ?? 1)) % 3;
  const trim = opts?.color ?? [0x9e3b26, 0x446b81, 0x9c7a3c][dress];
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
      part(new THREE.CylinderGeometry(0.17, 0.17, 0.014, 5), 0xd9bb78, [0, 0.542, -0.005]),
      part(new THREE.CylinderGeometry(0.055, 0.09, 0.043, 5), 0xc3a369, [0, 0.564, -0.005]),
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

  // Tool heads are tagged so research can retint them in place (flint → bronze → iron).
  const axe = mesh(mergeTagged([
    part(new THREE.CylinderGeometry(0.013, 0.016, 0.29, 4), TREE_TRUNK, [0, -0.355, 0]),
    tag(part(new THREE.BoxGeometry(0.13, 0.085, 0.03), 0x888579, [0.043, -0.47, 0]), 'axe', 0x888579),
    tag(part(new THREE.BoxGeometry(0.035, 0.105, 0.04), 0xbfae8e, [0.108, -0.47, 0]), 'axe', 0x888579),
  ]), rightArm, 'axe');
  const pick = mesh(mergeTagged([
    part(new THREE.CylinderGeometry(0.013, 0.016, 0.3, 4), TREE_TRUNK, [0, -0.355, 0]),
    tag(part(new THREE.BoxGeometry(0.16, 0.035, 0.035), 0x888579, [0, -0.49, 0]), 'pick', 0x888579),
    tag(part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xbfae8e, [-0.1, -0.51, 0], [1, 1, 1], [0, 0, 1.1]), 'pick', 0x888579),
    tag(part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xbfae8e, [0.1, -0.51, 0], [1, 1, 1], [0, 0, -1.1]), 'pick', 0x888579),
  ]), rightArm, 'pick');
  // A short-handled sickle for field work; the crescent blade follows the farming chain.
  const sickle = mesh(mergeTagged([
    part(new THREE.BoxGeometry(0.026, 0.16, 0.026), TREE_TRUNK, [0, -0.3, 0.02]),
    tag(part(new THREE.TorusGeometry(0.075, 0.012, 3, 4, Math.PI * 1.1), 0x888579,
      [0.0, -0.43, 0.06], [1, 1, 0.6], [0, Math.PI / 2, 0.3]), 'sickle', 0x888579),
  ]), rightArm, 'sickle');
  const mallet = mesh(merge([
    part(new THREE.BoxGeometry(0.028, 0.25, 0.028), TREE_TRUNK, [0, -0.34, 0]),
    part(new THREE.BoxGeometry(0.17, 0.09, 0.09), 0x94714a, [0, -0.45, 0]),
  ]), rightArm, 'mallet');

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
  const stone = mesh(part(new THREE.BoxGeometry(0.27, 0.14, 0.25), 0xd4cfb9,
    [0.19, 0.34, 0.01]), body, 'carry-stone');

  const corners: THREE.Vector3[] = [];
  const bounds = legGeometry.boundingBox!;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  const point = new THREE.Vector3();

  const legs = [leftLeg, rightLeg];
  function setPose(state: VillagerPose, t: number, carry?: VillagerCarry): void {
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
    } else if (state === 'build') {
      rightArm.rotation.x = -0.65 - work * 1.55;
      leftArm.rotation.x = -0.8;
      body.rotation.x = 0.13 + (1 - work) * 0.07;
    } else if (state === 'farm') {
      // Stooped reaping: the sickle sweeps low across the crop.
      body.rotation.x = 0.3 + (1 - work) * 0.08;
      leftArm.rotation.x = -0.75;
      rightArm.rotation.set(-0.55 - work * 0.75, 0, -0.08 - work * 0.35);
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
    mallet.visible = state === 'build';
    sickle.visible = state === 'farm';
    wood.visible = carry === 'wood';
    food.visible = carry === 'food';
    gold.visible = carry === 'gold';
    stone.visible = carry === 'stone';
    if (stone.visible && (state === 'idle' || state === 'walk')) rightArm.rotation.set(-2.4, 0, -0.45);

    let sole = Infinity;
    for (const leg of legs) {
      leg.updateMatrix();
      for (const corner of corners) sole = Math.min(sole, point.copy(corner).applyMatrix4(leg.matrix).y);
    }
    rig.position.y = -sole + bob;
  }

  setPose('idle', 0);
  return { object, setPose };
}

/**
 * Ancient light cavalry: a 1.25 m horse with a rider near 1.9 m, a petasos or
 * bronze helmet, and a javelin. One material, shared leg geometry, no textures.
 * `cloak` colours both the cloak and saddle cloth; `t` is elapsed seconds.
 */
export function createScout(opts?: { color?: number; cloak?: number; seed?: number }): ScoutModel {
  const seed = Math.abs(Math.trunc(opts?.seed ?? 1));
  const random = seededRandom(seed);
  const phase = random() * Math.PI * 2;
  const cloakColor = opts?.color ?? opts?.cloak ?? VILLAGER.tunic;
  const coat = [0x985032, 0x65402b, 0xb1b0a6][seed % 3];
  const hair = [0x623b26, 0x28221d, 0x62625b][seed % 3];
  const stocking = seed % 3 === 1 ? hair : 0xd8cbb3;
  const skin = VILLAGER.head;
  const leather = 0x493623;
  const bronze = 0xb89b53;
  const material = modelMaterial();
  const object = new THREE.Group();
  object.name = 'scout';

  function pivot(parent: THREE.Object3D, name: string, position: Triple): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    parent.add(group);
    return group;
  }

  function mesh(geometry: THREE.BufferGeometry, parent: THREE.Object3D, name: string): THREE.Mesh {
    const result = new THREE.Mesh(geometry, material);
    result.name = name;
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function rod(hex: number, from: Triple, to: Triple, radius: number): THREE.BufferGeometry {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 4);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    return part(geometry, hex, start.add(end).multiplyScalar(0.5).toArray() as Triple);
  }

  const rig = pivot(object, 'rig', [0, 0, 0]);
  // Pitch around the horse's chest, then ground the rig using the animated hooves.
  const horse = pivot(rig, 'horse', [0, 0.98, -0.1]);
  mesh(mergeTagged([
    // Bronze peytral over the chest, hidden until the first cavalry-armour tech.
    tag(part(new THREE.BoxGeometry(0.36, 0.2, 0.05), 0xe4d9bd, [0, -0.02, 0.6], [1, 1, 1], [-0.35, 0, 0]), 'jerkin', 0xe4d9bd),
    part(new THREE.IcosahedronGeometry(1, 0), coat, [0, 0.02, -0.03], [0.3, 0.27, 0.62]),
    part(new THREE.IcosahedronGeometry(1, 0), coat, [0, 0.06, 0.37], [0.26, 0.24, 0.25]),
    part(new THREE.IcosahedronGeometry(1, 0), coat, [0, 0.02, -0.38], [0.29, 0.24, 0.29]),
    part(new THREE.BoxGeometry(0.56, 0.026, 0.52), cloakColor, [0, 0.255, -0.04]),
    ...[-1, 1].flatMap(side => [
      part(new THREE.BoxGeometry(0.024, 0.27, 0.52), cloakColor, [side * 0.282, 0.11, -0.04]),
      part(new THREE.BoxGeometry(0.028, 0.025, 0.53), 0xd8c5a0, [side * 0.285, -0.018, -0.04]),
      rod(leather, [side * 0.13, 0.46, 0.18], [side * 0.12, 0.365, 0.95], 0.009),
    ]),
    part(new THREE.BoxGeometry(0.33, 0.035, 0.38), leather, [0, 0.279, -0.04]),
    // A simple girth and cloth saddle, without modern stirrups or a saddle horn.
    part(new THREE.BoxGeometry(0.59, 0.03, 0.035), leather, [0, -0.06, -0.04]),
  ]), horse, 'horse-body-tack');

  const upperLegGeometry = merge([
    part(new THREE.CylinderGeometry(0.074, 0.048, 0.36, 5), coat, [0, -0.175, 0]),
    part(new THREE.IcosahedronGeometry(0.06, 0), coat, [0, -0.35, 0], [1, 0.8, 1]),
  ]);
  const lowerLegGeometry = merge([
    part(new THREE.CylinderGeometry(0.033, 0.025, 0.39, 5), coat, [0, -0.195, 0]),
    part(new THREE.CylinderGeometry(0.027, 0.03, 0.11, 5), stocking, [0, -0.355, 0]),
    part(new THREE.BoxGeometry(0.1, 0.08, 0.14), 0x302b27, [0, -0.44, 0.018]),
  ]);
  const legNames = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
  const legs = legNames.map((name, i) => {
    const upper = pivot(horse, `${name}Leg`, [i % 2 === 0 ? -0.18 : 0.18, -0.15, i < 2 ? 0.4 : -0.39]);
    mesh(upperLegGeometry, upper, `${name}-upper-leg`);
    const lower = pivot(upper, `${name}Knee`, [0, -0.35, 0]);
    mesh(lowerLegGeometry, lower, `${name}-hoof-leg`);
    return { upper, lower };
  });

  const neck = pivot(horse, 'horseNeck', [0, 0.15, 0.46]);
  mesh(merge([
    part(new THREE.CylinderGeometry(0.11, 0.18, 0.52, 6), coat, [0, 0.12, 0.11], [1, 1, 1], [0.45, 0, 0]),
    part(new THREE.IcosahedronGeometry(1, 0), coat, [0, 0.03, 0.02], [0.18, 0.2, 0.2]),
  ]), neck, 'horse-neck');
  const head = pivot(neck, 'horseHead', [0, 0.27, 0.25]);
  mesh(merge([
    part(new THREE.IcosahedronGeometry(1, 0), coat, [0, 0.015, 0.055], [0.12, 0.16, 0.2], [-0.35, 0, 0]),
    part(new THREE.BoxGeometry(0.18, 0.14, 0.23), coat, [0, -0.06, 0.245]),
    part(new THREE.BoxGeometry(0.15, 0.09, 0.045), 0x57443a, [0, -0.078, 0.351]),
    ...[-1, 1].flatMap(side => [
      part(new THREE.ConeGeometry(0.045, 0.17, 4), coat, [side * 0.073, 0.19, -0.015], [1, 1, 0.55], [-0.18, 0, side * -0.12]),
      part(new THREE.BoxGeometry(0.01, 0.028, 0.029), 0x211e1a, [side * 0.115, 0.052, 0.11]),
      part(new THREE.BoxGeometry(0.008, 0.021, 0.025), 0x302b27, [side * 0.093, -0.044, 0.32]),
      rod(leather, [side * 0.12, 0.1, 0.018], [side * 0.105, -0.055, 0.24], 0.009),
      part(new THREE.BoxGeometry(0.025, 0.028, 0.028), bronze, [side * 0.115, -0.055, 0.24]),
    ]),
    part(new THREE.BoxGeometry(0.197, 0.02, 0.035), leather, [0, -0.023, 0.29]),
    part(new THREE.BoxGeometry(0.23, 0.022, 0.022), leather, [0, 0.1, 0.017]),
    part(new THREE.BoxGeometry(0.065, 0.14, 0.045), hair, [0, 0.16, 0.025], [1, 1, 1], [-0.25, 0, 0]),
  ]), head, 'horse-head-bridle');

  const mane = pivot(neck, 'horseMane', [0, 0.04, -0.075]);
  mesh(merge([0, 1, 2].map(i =>
    part(new THREE.BoxGeometry(0.065, 0.17, 0.08), hair, [0, i * 0.105, i * 0.05], [1, 1, 1], [0.45, 0, 0])
  )), mane, 'horse-mane');
  const tail = pivot(horse, 'horseTail', [0, 0.09, -0.58]);
  mesh(merge([
    part(new THREE.CylinderGeometry(0.04, 0.065, 0.42, 5), hair, [0, -0.2, -0.12], [1, 1, 1], [0.55, 0, 0]),
    part(new THREE.ConeGeometry(0.07, 0.17, 5), hair, [0, -0.39, -0.24], [1, 1, 1], [Math.PI + 0.3, 0, 0]),
  ]), tail, 'horse-tail');

  const rider = pivot(horse, 'rider', [0, 0.28, -0.04]);
  mesh(mergeTagged([
    tag(part(new THREE.CylinderGeometry(0.115, 0.16, 0.31, 6), 0xe4d9bd, [0, 0.155, 0]), 'armor', 0xe4d9bd),
    part(new THREE.CylinderGeometry(0.16, 0.165, 0.025, 6), cloakColor, [0, 0.007, 0]),
    tag(part(new THREE.BoxGeometry(0.26, 0.026, 0.21), leather, [0, 0.12, 0]), 'trim', leather),
    part(new THREE.BoxGeometry(0.038, 0.03, 0.015), bronze, [0, 0.12, 0.11]),
    part(new THREE.BoxGeometry(0.07, 0.06, 0.07), skin, [0, 0.346, 0]),
    part(new THREE.BoxGeometry(0.17, 0.18, 0.16), skin, [0, 0.46, 0]),
    part(new THREE.BoxGeometry(0.18, 0.045, 0.168), leather, [0, 0.544, -0.004]),
    part(new THREE.BoxGeometry(0.035, 0.043, 0.025), skin, [0, 0.462, 0.092]),
    ...[-1, 1].flatMap(side => [
      part(new THREE.BoxGeometry(0.015, 0.016, 0.008), 0x302b27, [side * 0.037, 0.493, 0.082]),
      rod(0xe4d9bd, [side * 0.13, 0.27, 0], [side * 0.18, 0.16, 0.1], 0.045),
      rod(skin, [side * 0.18, 0.16, 0.1], [side * 0.13, 0.18, 0.22], 0.032),
      part(new THREE.BoxGeometry(0.068, 0.065, 0.07), skin, [side * 0.13, 0.18, 0.22]),
      rod(0xe4d9bd, [side * 0.095, 0.018, 0.04], [side * 0.25, -0.19, 0.08], 0.061),
      rod(skin, [side * 0.25, -0.19, 0.08], [side * 0.27, -0.43, -0.02], 0.036),
      part(new THREE.BoxGeometry(0.09, 0.05, 0.15), leather, [side * 0.27, -0.45, 0.015]),
    ]),
    ...(seed % 2 === 0 ? [
      // Wide-brim Thessalian travelling hat (petasos).
      part(new THREE.CylinderGeometry(0.19, 0.19, 0.018, 8), 0xd9bb78, [0, 0.572, -0.008]),
      part(new THREE.CylinderGeometry(0.065, 0.105, 0.065, 8), 0xc3a369, [0, 0.602, -0.008]),
      part(new THREE.BoxGeometry(0.015, 0.12, 0.012), leather, [-0.088, 0.51, 0.004]),
      part(new THREE.BoxGeometry(0.015, 0.12, 0.012), leather, [0.088, 0.51, 0.004]),
    ] : [
      part(new THREE.IcosahedronGeometry(1, 0), bronze, [0, 0.574, -0.008], [0.115, 0.08, 0.11]),
      part(new THREE.BoxGeometry(0.22, 0.025, 0.185), bronze, [0, 0.559, -0.008]),
      ...[-1, 1].map(side => part(new THREE.BoxGeometry(0.024, 0.115, 0.065), bronze, [side * 0.098, 0.486, -0.018])),
      part(new THREE.BoxGeometry(0.18, 0.08, 0.026), bronze, [0, 0.504, -0.09]),
      tag(part(new THREE.BoxGeometry(0.03, 0.06, 0.2), 0x8a2a1c, [0, 0.66, -0.01]), 'crest', 0x8a2a1c),
    ]),
  ]), rider, 'rider-tunic-head');

  const cloak = pivot(rider, 'riderCloak', [0, 0.29, -0.115]);
  const cloakGeometry = new THREE.BoxGeometry(0.36, 0.41, 0.025);
  const cloakVertices = cloakGeometry.getAttribute('position');
  for (let i = 0; i < cloakVertices.count; i++) {
    if (cloakVertices.getY(i) > 0) cloakVertices.setX(i, cloakVertices.getX(i) * 0.68);
  }
  mesh(merge([
    part(cloakGeometry, cloakColor, [0, -0.18, -0.06], [1, 1, 1], [0.28, 0, 0]),
    part(new THREE.BoxGeometry(0.11, 0.033, 0.025), bronze, [-0.1, 0.012, 0.012]),
  ]), cloak, 'rider-cloak');
  mesh(merge([
    rod(TREE_TRUNK, [0.13, -0.25, 0.15], [0.13, 0.61, 0.29], 0.013),
    part(new THREE.ConeGeometry(0.028, 0.12, 4), bronze, [0.13, 0.665, 0.3], [1, 1, 0.5], [0.16, 0, 0]),
  ]), rider, 'javelin');

  hideOptional(object);
  // Precompute hoof bounds once. The pose loop allocates no geometry or objects.
  const hoofCorners: THREE.Vector3[] = [];
  const bounds = lowerLegGeometry.boundingBox!;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) hoofCorners.push(new THREE.Vector3(x, y, z));
    }
  }
  const hoofMatrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  // Hind-left → fore-left → hind-right → fore-right: four distinct walk beats.
  const walkOffsets = [Math.PI * 1.5, Math.PI * 0.5, 0, Math.PI];
  const gallopOffsets = [0, 0.3, Math.PI, Math.PI + 0.3];

  function setPose(state: ScoutPose, t: number): void {
    const rate = state === 'idle' ? 0.25 : state === 'walk' ? 1.4 : 2.8;
    const cycle = t * Math.PI * 2 * rate + phase;
    const stride = Math.sin(cycle);
    const galloping = state === 'gallop';
    const moving = state !== 'idle';
    horse.rotation.set(stride * (galloping ? 0.055 : 0.012), 0, Math.sin(cycle * 2) * (moving ? 0.012 : 0.006));
    neck.rotation.set(stride * (moving ? 0.025 : 0.015), 0, 0);
    head.rotation.set(Math.sin(cycle * 2) * (galloping ? 0.055 : 0.025), 0, 0);
    mane.rotation.set(Math.sin(cycle * 4) * (galloping ? 0.12 : 0.012), 0, Math.sin(cycle * 3) * (galloping ? 0.09 : 0.015));
    tail.rotation.set(galloping ? -0.25 + stride * 0.14 : stride * 0.025, stride * (moving ? 0.15 : 0.3), Math.sin(cycle * 3) * (galloping ? 0.12 : 0.035));
    rider.position.y = 0.28 + (moving ? Math.sin(cycle * 2) * (galloping ? 0.02 : 0.007) : 0);
    rider.rotation.set(galloping ? 0.1 - stride * 0.035 : -stride * 0.012, 0, -horse.rotation.z * 0.6);
    cloak.rotation.set(Math.sin(cycle * 3) * (galloping ? 0.16 : 0.025) - (galloping ? 0.18 : 0), 0, Math.sin(cycle * 2) * 0.025);

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const legCycle = cycle + (galloping ? gallopOffsets[i] : walkOffsets[i]);
      const swing = Math.sin(legCycle);
      const fold = (0.5 + 0.5 * swing) ** 2;
      leg.upper.rotation.set(swing * (galloping ? 0.7 : moving ? 0.34 : 0.018), 0, 0);
      leg.lower.rotation.set(moving ? 0.035 + fold * (galloping ? 0.58 : 0.24) : swing * 0.012, 0, 0);
    }

    horse.updateMatrix();
    let sole = Infinity;
    for (const leg of legs) {
      leg.upper.updateMatrix();
      leg.lower.updateMatrix();
      hoofMatrix.multiplyMatrices(horse.matrix, leg.upper.matrix).multiply(leg.lower.matrix);
      for (const corner of hoofCorners) sole = Math.min(sole, point.copy(corner).applyMatrix4(hoofMatrix).y);
    }
    // Gallop has a small airborne interval; all other poses keep a hoof at ground.
    rig.position.y = -sole + (galloping ? 0.06 * stride * stride : 0);
  }

  setPose('idle', 0);
  return { object, setPose };
}

export type SoldierKind = 'phalangiteGuard' | 'legionary' | 'immortal' | 'raider' | 'hoplite' | 'swordsman' | 'slinger' | 'archer' | 'horseman';
export type SoldierPose = 'idle' | 'walk' | 'attack' | 'die';
/** Die uses progress 0..1, supplied either directly or as { progress }. */
export type SoldierPoseExtra = number | { progress?: number };
export interface SoldierModel {
  object: THREE.Group;
  /** t is seconds; foot attacks loop at 1 Hz, mounted attacks use the scout gallop. */
  setPose(pose: SoldierPose, t: number, extra?: SoldierPoseExtra): void;
}

function coloredRod(hex: number, from: Triple, to: Triple, radius: number): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 4);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  return part(geometry, hex, a.add(b).multiplyScalar(0.5).toArray() as Triple);
}

/** A small recurved bow in the yz plane, gripped at the origin and aimed along +z. */
export function bowParts(): THREE.BufferGeometry[] {
  const points: Triple[] = [[0, -0.24, 0.02], [0, -0.16, 0.1], [0, 0, 0.14], [0, 0.16, 0.1], [0, 0.24, 0.02]];
  return [
    ...points.slice(1).map((point, i) => coloredRod(0x94714a, points[i], point, 0.014)),
    coloredRod(0xd8c5a0, points[0], points[4], 0.004),
  ];
}

/** Tiny coloured projectiles centred on the origin, with their tip along +z. */
export function projectileGeometry(kind: 'arrow' | 'stone' | 'javelin'): THREE.BufferGeometry {
  let pieces: THREE.BufferGeometry[];
  if (kind === 'stone') {
    pieces = [part(new THREE.IcosahedronGeometry(0.055, 0), 0x96998e)];
  } else {
    const length = kind === 'arrow' ? 0.42 : 0.85;
    const radius = kind === 'arrow' ? 0.007 : 0.012;
    pieces = [
      coloredRod(TREE_TRUNK, [0, 0, -length / 2], [0, 0, length / 2 - 0.06], radius),
      part(new THREE.ConeGeometry(radius * 2.8, 0.09, 4), 0xb8ad8d,
        [0, 0, length / 2 - 0.015], [1, 1, 0.6], [Math.PI / 2, 0, 0]),
    ];
    if (kind === 'arrow') for (const yaw of [0, Math.PI / 2]) {
      pieces.push(part(new THREE.BoxGeometry(0.047, 0.004, 0.09), 0xe4d9bd,
        [0, 0, -length / 2 + 0.05], [1, 1, 1], [0, 0, yaw]));
    }
  }
  const geometry = merge(pieces);
  geometry.name = `projectile-${kind}`;
  return geometry;
}

/** Tier 0 look: crests and jerkins/barding stay collapsed until research shows them. */
function hideOptional(object: THREE.Object3D): void {
  applyRole(object, 'crest', null, false);
  applyRole(object, 'jerkin', null, false);
}

/** Cache neutral local bounds once; falling poses do no scene traversal or allocation. */
function fallingPose(object: THREE.Group, rig: THREE.Group): (progress: number) => void {
  object.updateMatrixWorld(true);
  const corners: THREE.Vector3[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const bounds = child.geometry.boundingBox!;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(child.matrixWorld));
    }
  });
  const point = new THREE.Vector3();
  return progress => {
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    rig.rotation.set(0, 0, -Math.PI / 2 * p * p * (3 - 2 * p));
    rig.position.set(0, 0, 0);
    rig.updateMatrix();
    let lowest = Infinity;
    for (const corner of corners) lowest = Math.min(lowest, point.copy(corner).applyMatrix4(rig.matrix).y);
    rig.position.y = -lowest;
  };
}

/** Ancient soldiers facing +z, one shared material and no geometry work in setPose. */
export function createSoldier(kind: SoldierKind, opts?: { color?: number; seed?: number }): SoldierModel {
  const unique = {phalangiteGuard:'hoplite',legionary:'swordsman',immortal:'archer',raider:'swordsman'} as const;
  if (kind in unique) {
    const base = unique[kind as keyof typeof unique];
    const model = createSoldier(base,opts);
    model.object.name = kind;
    // A unique silhouette and finish with no extra draw calls or per-frame work.
    const emblem = model.object.getObjectByName(base==='hoplite'?'aspis':base==='archer'?'bow':'oval-shield') as THREE.Mesh | undefined;
    if (emblem) { emblem.scale.set(kind==='phalangiteGuard'?1.2:.8,kind==='legionary'?1.3:1,1); }
    const crest = model.object.getObjectByName('tunic-head-armor') as THREE.Mesh | undefined;
    if(crest) {
      crest.scale.y = kind==='raider' ? .95 : 1.06;
      const trim = opts?.color ?? 0x9e3b26;
      const details = kind==='phalangiteGuard' ? [part(new THREE.BoxGeometry(.03,.08,.23),trim,[0,.61,-.01])] :
        kind==='legionary' ? [part(new THREE.BoxGeometry(.035,.10,.24),trim,[0,.64,-.01]),part(new THREE.BoxGeometry(.27,.035,.22),0xb3a06d,[0,.31,0])] :
        kind==='immortal' ? [part(new THREE.BoxGeometry(.26,.32,.04),trim,[0,.19,-.15]),part(new THREE.BoxGeometry(.18,.13,.035),0xbca466,[0,.43,.09])] :
        [part(new THREE.BoxGeometry(.29,.28,.035),0x4f6242,[0,.17,-.15]),part(new THREE.BoxGeometry(.30,.025,.04),0xd2c19b,[0,.27,-.16])];
      const roles=crest.geometry.userData.tintRoles;
      crest.geometry=merge([crest.geometry,...details]);
      // Base vertices stay first, so their existing upgrade role offsets remain valid.
      crest.geometry.userData.tintRoles=roles;
    }
    const weapon = model.object.getObjectByName(kind==='phalangiteGuard'?'long-spear':'short-sword');
    if(weapon && kind==='phalangiteGuard')weapon.scale.z=1.4;
    if(weapon && kind==='raider')weapon.scale.y=1.15;
    if(emblem && kind==='legionary') {
      emblem.geometry.dispose();
      emblem.geometry=merge([part(new THREE.BoxGeometry(.32,.48,.035),opts?.color ?? 0x9e3b26,[0,-.17,.14]),part(new THREE.BoxGeometry(.34,.49,.015),0xb9a275,[0,-.17,.12]),part(new THREE.IcosahedronGeometry(.045,0),0xb9a275,[0,-.17,.17])]);
    }
    model.object.userData.civilizationUnit = kind;
    return model;
  }
  const seed = Math.abs(Math.trunc(opts?.seed ?? 1));
  const color = opts?.color ?? 0x9e3b26;
  if (kind === 'horseman') {
    // Odd scout variants wear a bronze helmet; retain its horse and four-beat gait.
    const scout = createScout({ color, seed: seed * 2 + 1 });
    const object = scout.object;
    object.name = kind;
    const rig = new THREE.Group();
    rig.name = 'soldierRig';
    rig.add(...object.children);
    object.add(rig);
    const rider = object.getObjectByName('rider')!;
    const spear = object.getObjectByName('javelin') as THREE.Mesh;
    // A longer cavalry spear reaches past the muzzle, pivoting at the gripping hand.
    spear.geometry.dispose();
    spear.geometry = merge([
      coloredRod(TREE_TRUNK, [0, -0.2, -0.5], [0, 0.42, 1.05], 0.013),
      part(new THREE.ConeGeometry(0.03, 0.14, 4), 0xb89b53, [0, 0.446, 1.115],
        [1, 1, 0.6], [Math.atan2(1.55, 0.62), 0, 0]),
    ]);
    spear.position.set(0.13, 0.18, 0.22);
    const fall = fallingPose(object, rig);
    function setPose(pose: SoldierPose, t: number, extra?: SoldierPoseExtra): void {
      const time = Number.isFinite(t) ? t : 0;
      rig.rotation.set(0, 0, 0);
      rig.position.set(0, 0, 0);
      spear.rotation.set(0, 0, 0);
      scout.setPose(pose === 'attack' ? 'gallop' : pose === 'walk' ? 'walk' : 'idle', pose === 'die' ? 0 : time);
      if (pose === 'attack') {
        spear.rotation.x = Math.atan2(0.62, 1.55) + Math.sin(time * Math.PI * 2) * 0.05;
        rider.rotation.x += 0.18;
      } else if (pose === 'die') fall(typeof extra === 'number' ? extra : extra?.progress ?? 0);
    }
    setPose('idle', 0);
    return { object, setPose };
  }

  const material = modelMaterial();
  const skin = VILLAGER.head, bronze = 0xb89b53, leather = 0x493623, linen = 0xe4d9bd;
  const random = seededRandom(seed);
  const hair = [leather, 0x28221d, 0x8a6c34][Math.floor(random() * 3)];
  const phase = random() * Math.PI * 2;
  const object = new THREE.Group();
  object.name = kind;
  const rig = new THREE.Group();
  rig.name = 'soldierRig';
  object.add(rig);
  function pivot(parent: THREE.Object3D, name: string, pos: Triple): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...pos);
    parent.add(group);
    return group;
  }
  function mesh(pieces: THREE.BufferGeometry[], parent: THREE.Object3D, name: string): THREE.Mesh {
    const result = new THREE.Mesh(mergeTagged(pieces), material);
    result.name = name;
    result.castShadow = result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  const body = pivot(rig, 'body', [0, 0.38, 0]);
  const armored = kind === 'hoplite' || kind === 'swordsman';
  const torsoBase = part(new THREE.CylinderGeometry(0.115, 0.15, 0.31, 6), armored ? linen : color, [0, 0.155, 0]);
  const torso = [
    armored ? tag(torsoBase, 'armor', linen) : torsoBase,
    part(new THREE.CylinderGeometry(0.15, 0.155, 0.04, 6), color, [0, 0.012, 0]),
    // The belt takes the unit-line trim colour (bronze, then gold).
    tag(part(new THREE.BoxGeometry(0.25, 0.025, 0.21), leather, [0, 0.11, 0]), 'trim', leather),
    part(new THREE.BoxGeometry(0.07, 0.055, 0.07), skin, [0, 0.332, 0]),
    part(new THREE.BoxGeometry(0.17, 0.18, 0.16), skin, [0, 0.43, 0]),
    part(new THREE.BoxGeometry(0.035, 0.035, 0.025), skin, [0, 0.43, 0.09]),
    ...[-1, 1].map(side => part(new THREE.BoxGeometry(0.018, 0.018, 0.009), leather, [side * 0.038, 0.46, 0.083])),
  ];
  if (armored) {
    torso.push(part(new THREE.IcosahedronGeometry(1, 0), bronze, [0, 0.525, -0.008], [0.115, 0.065, 0.11]));
    torso.push(part(new THREE.BoxGeometry(0.21, 0.027, 0.185), bronze, [0, 0.512, -0.008]));
    for (const side of [-1, 1]) torso.push(part(new THREE.BoxGeometry(0.037, 0.13, 0.065), bronze, [side * 0.082, 0.444, 0.044], [0, 0, side * 0.15]));
    if (kind === 'hoplite') {
      torso.push(part(new THREE.BoxGeometry(0.023, 0.108, 0.025), bronze, [0, 0.462, 0.092]));
      torso.push(tag(part(new THREE.BoxGeometry(0.27, 0.18, 0.215), linen, [0, 0.24, -0.01]), 'armor', linen));
      for (const side of [-1, 1]) torso.push(tag(part(new THREE.BoxGeometry(0.045, 0.22, 0.23), 0xc9c2a9, [side * 0.085, 0.23, 0]), 'armor', linen));
      // Transverse horsehair crest, shown from the first line upgrade.
      torso.push(tag(part(new THREE.BoxGeometry(0.03, 0.05, 0.2), 0x8a2a1c, [0, 0.578, -0.012]), 'crest', 0x8a2a1c));
    } else {
      torso.push(part(new THREE.BoxGeometry(0.04, 0.07, 0.21), color, [0, 0.579, -0.008]));
      torso.push(tag(part(new THREE.BoxGeometry(0.245, 0.24, 0.19), 0xa99a78, [0, 0.205, 0]), 'armor', 0xa99a78));
      // Side plumes either side of the team crest, shown from the first line upgrade.
      for (const side of [-1, 1]) {
        torso.push(tag(part(new THREE.BoxGeometry(0.018, 0.06, 0.03), 0x8a2a1c, [side * 0.1, 0.565, -0.01], [1, 1, 1], [0, 0, side * -0.3]), 'crest', 0x8a2a1c));
      }
    }
  } else {
    torso.push(part(new THREE.BoxGeometry(0.185, kind === 'slinger' ? 0.06 : 0.052, 0.175), hair,
      [0, kind === 'slinger' ? 0.54 : 0.52, -0.004]));
    // A padded jerkin over the tunic, hidden until the first archer-armour tech.
    torso.push(tag(part(new THREE.BoxGeometry(0.255, 0.15, 0.215), linen, [0, 0.215, 0]), 'jerkin', linen));
    // A feather in the cap or headband for the line upgrade.
    torso.push(tag(part(new THREE.BoxGeometry(0.016, 0.11, 0.04), 0x8a2a1c, [0.07, 0.6, -0.04], [1, 1, 1], [-0.35, 0, -0.3]), 'crest', 0x8a2a1c));
    if (kind === 'archer') {
      torso.push(part(new THREE.ConeGeometry(0.112, 0.14, 5), color, [0, 0.535, -0.015], [1, 1, 0.88], [-0.25, 0, 0]));
      torso.push(part(new THREE.CylinderGeometry(0.058, 0.045, 0.28, 5), leather, [0.11, 0.18, -0.145], [1, 1, 1], [0, 0, -0.2]));
      for (const x of [0.08, 0.12, 0.16]) torso.push(coloredRod(0xc8b58c, [x, 0.28, -0.15], [x - 0.015, 0.42, -0.15], 0.007));
    } else torso.push(part(new THREE.IcosahedronGeometry(0.085, 0), leather, [-0.12, 0.07, 0.08], [0.8, 1, 0.65]));
  }
  mesh(torso, body, 'tunic-head-armor');
  const legs = [-1, 1].map(side => {
    const leg = pivot(rig, side < 0 ? 'leftLeg' : 'rightLeg', [side * 0.075, 0.38, 0]);
    mesh([
      part(new THREE.BoxGeometry(0.08, 0.34, 0.085), skin, [0, -0.17, 0]),
      part(new THREE.BoxGeometry(0.086, 0.18, 0.091), armored ? bronze : linen, [0, -0.24, 0]),
      part(new THREE.BoxGeometry(0.105, 0.03, 0.14), leather, [0, -0.365, 0.024]),
    ], leg, 'leg-sandal');
    return leg;
  });
  const leftArm = pivot(body, 'leftArm', [-0.155, 0.26, 0]);
  const rightArm = pivot(body, 'rightArm', [0.155, 0.26, 0]);
  for (const arm of [leftArm, rightArm]) mesh([
    part(new THREE.BoxGeometry(0.088, 0.1, 0.1), color, [0, -0.045, 0]),
    coloredRod(skin, [0, -0.085, 0], [0, -0.205, 0.06], 0.032),
    part(new THREE.BoxGeometry(0.07, 0.065, 0.08), skin, [0, -0.22, 0.065]),
  ], arm, 'sleeve-hand');

  const weapon = pivot(rightArm, 'weapon', [0, -0.22, 0.065]);
  let slingStone: THREE.Mesh | undefined;
  let nockedArrow: THREE.Mesh | undefined;
  let bow: THREE.Group | undefined;
  let bowStrings: THREE.Mesh[] | undefined;
  if (kind === 'hoplite') {
    mesh([
      coloredRod(TREE_TRUNK, [0, 0, -0.55], [0, 0, 0.83], 0.014),
      part(new THREE.ConeGeometry(0.03, 0.14, 4), bronze, [0, 0, 0.9], [1, 1, 0.6], [Math.PI / 2, 0, 0]),
    ], weapon, 'long-spear');
  } else if (kind === 'swordsman') {
    mesh([
      part(new THREE.BoxGeometry(0.026, 0.09, 0.028), leather, [0, -0.023, 0]),
      part(new THREE.BoxGeometry(0.1, 0.025, 0.035), bronze, [0, -0.072, 0]),
      part(new THREE.BoxGeometry(0.04, 0.23, 0.018), 0xc2c4b8, [0, -0.2, 0]),
      part(new THREE.ConeGeometry(0.026, 0.07, 4), 0xc2c4b8, [0, -0.345, 0], [1, 1, 0.45], [Math.PI, 0, 0]),
    ], weapon, 'short-sword');
  } else if (kind === 'slinger') {
    mesh([
      coloredRod(leather, [-0.014, 0, 0], [-0.018, 0, 0.24], 0.006),
      coloredRod(leather, [0.014, 0, 0], [0.018, 0, 0.24], 0.006),
      part(new THREE.BoxGeometry(0.055, 0.015, 0.07), leather, [0, 0, 0.25]),
    ], weapon, 'sling');
    slingStone = mesh([part(new THREE.IcosahedronGeometry(0.025, 0), 0x96998e, [0, 0.022, 0.25])], weapon, 'loaded-stone');
  } else {
    bow = pivot(leftArm, 'bow', [0, -0.22, 0.065]);
    const pieces = bowParts();
    mesh(pieces.slice(0, -1), bow, 'recurved-bow');
    // Two string halves pivot at the nock so draw/loose moves the nock backward.
    bowStrings = [-1, 1].map(side => {
      const string = mesh([coloredRod(linen, [0, 0, 0], [0, -side * 0.24, 0], 0.004)], bow!, 'bow-string');
      string.position.set(0, side * 0.24, 0.02);
      return string;
    });
    pieces[pieces.length - 1].dispose();
    nockedArrow = new THREE.Mesh(projectileGeometry('arrow'), material);
    nockedArrow.name = 'nocked-arrow';
    nockedArrow.position.z = 0.06;
    bow.add(nockedArrow);
  }
  if (armored) mesh([
    tag(part(new THREE.CylinderGeometry(0.235, 0.235, 0.045, 10), bronze, [0, -0.17, 0.11],
      [kind === 'swordsman' ? 0.77 : 1, 1, kind === 'swordsman' ? 1.32 : 1], [Math.PI / 2, 0, 0]), 'rim', bronze),
    part(new THREE.CylinderGeometry(0.208, 0.208, 0.015, 10), color, [0, -0.17, 0.142],
      [kind === 'swordsman' ? 0.77 : 1, 1, kind === 'swordsman' ? 1.32 : 1], [Math.PI / 2, 0, 0]),
    part(new THREE.IcosahedronGeometry(0.06, 0), bronze, [0, -0.17, 0.158], [1, 1, 0.45]),
  ], leftArm, kind === 'hoplite' ? 'aspis' : 'oval-shield');

  hideOptional(object);
  const legBounds = (legs[0].children[0] as THREE.Mesh).geometry.boundingBox!;
  const footCorners: THREE.Vector3[] = [];
  for (const x of [legBounds.min.x, legBounds.max.x]) for (const y of [legBounds.min.y, legBounds.max.y]) {
    for (const z of [legBounds.min.z, legBounds.max.z]) footCorners.push(new THREE.Vector3(x, y, z));
  }
  const point = new THREE.Vector3();
  let fall: ((progress: number) => void) | undefined;
  function setPose(pose: SoldierPose, t: number, extra?: SoldierPoseExtra): void {
    const time = Number.isFinite(t) ? t : 0;
    const cycle = time * Math.PI * 2;
    const stride = Math.sin(cycle * 1.6 + phase);
    const strike = 0.5 - 0.5 * Math.cos(cycle);
    const beat = ((time % 1) + 1) % 1;
    rig.rotation.set(0, 0, 0);
    rig.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    leftArm.rotation.set(0, 0, 0.05);
    rightArm.rotation.set(0, 0, -0.05);
    rightArm.position.set(0.155, 0.26, 0);
    weapon.rotation.set(0, 0, 0);
    legs[0].rotation.set(0, 0, 0);
    legs[1].rotation.set(0, 0, 0);
    if (bow) bow.rotation.set(0, 0, 0);
    if (bowStrings) for (const string of bowStrings) { string.rotation.x = 0; string.scale.y = 1; }
    if (slingStone) slingStone.visible = true;
    if (nockedArrow) { nockedArrow.visible = true; nockedArrow.position.z = 0.06; }
    if (pose === 'walk') {
      legs[0].rotation.x = stride * 0.45;
      legs[1].rotation.x = -stride * 0.45;
      rightArm.rotation.x = stride * 0.25;
      leftArm.rotation.x = -stride * 0.18;
    } else if (pose === 'attack') {
      if (kind === 'hoplite') {
        rightArm.position.z = strike * 0.26;
        rightArm.position.y = 0.26 + strike * 0.14;
        body.rotation.y = -strike * 0.12;
        leftArm.rotation.x = -0.22;
      } else if (kind === 'swordsman') {
        rightArm.rotation.set(-0.6 - strike * 1.8, -strike * 0.6, -0.3);
        body.rotation.y = Math.sin(cycle) * 0.28;
        leftArm.rotation.x = -0.2;
      } else if (kind === 'slinger') {
        rightArm.rotation.x = -2.3;
        weapon.rotation.y = cycle * 2;
        weapon.rotation.x = -0.3;
        slingStone!.visible = beat < 0.72;
        if (beat >= 0.72) rightArm.rotation.x += Math.sin((beat - 0.72) / 0.28 * Math.PI) * 1.4;
      } else {
        const draw = beat < 0.7 ? Math.sin(beat / 0.7 * Math.PI / 2) : Math.max(0, 1 - (beat - 0.7) / 0.1);
        leftArm.rotation.x = -Math.PI / 2;
        rightArm.rotation.set(-Math.PI / 2, -draw * 0.7, 0.4);
        rightArm.position.z = -draw * 0.12;
        bow!.rotation.x = Math.PI / 2;
        for (let i = 0; i < bowStrings!.length; i++) {
          bowStrings![i].rotation.x = (i === 0 ? -1 : 1) * Math.atan2(draw * 0.1, 0.24);
          bowStrings![i].scale.y = Math.hypot(0.24, draw * 0.1) / 0.24;
        }
        nockedArrow!.position.z = 0.06 - draw * 0.1;
        nockedArrow!.visible = beat < 0.7;
        body.rotation.y = -0.28;
      }
    } else if (pose === 'idle') body.rotation.x = Math.sin(cycle * 0.25 + phase) * 0.01;
    let sole = Infinity;
    for (const leg of legs) {
      leg.updateMatrix();
      for (const corner of footCorners) sole = Math.min(sole, point.copy(corner).applyMatrix4(leg.matrix).y);
    }
    rig.position.y = -sole;
    if (pose === 'die') fall?.(typeof extra === 'number' ? extra : extra?.progress ?? 0);
  }
  setPose('die', 0, 0);
  fall = fallingPose(object, rig);
  setPose('idle', 0);
  return { object, setPose };
}

/**
 * Two-wheeled donkey cart for market trade, facing +z: the donkey leads, the cart
 * follows with a load of amphorae under a team-colour cloth. One material, as the
 * soldiers; walking swings the legs and turns the wheels, and 'die' tips it over.
 */
export function createTradeCart(opts?: { color?: number; seed?: number }): SoldierModel {
  const seed = Math.abs(Math.trunc(opts?.seed ?? 1));
  const color = opts?.color ?? 0x9e3b26;
  const random = seededRandom(seed + 307);
  const phase = random() * Math.PI * 2;
  const coat = [0x8d8273, 0x6f6458, 0xa39887][seed % 3];
  const leather = 0x493623, wood = 0x82603b, clay = [0xa95136, 0xbe6944];
  const material = modelMaterial();
  const object = new THREE.Group();
  object.name = 'tradeCart';
  const rig = new THREE.Group();
  rig.name = 'soldierRig';
  object.add(rig);
  function pivot(parent: THREE.Object3D, name: string, pos: Triple): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...pos);
    parent.add(group);
    return group;
  }
  function mesh(pieces: THREE.BufferGeometry[], parent: THREE.Object3D, name: string): THREE.Mesh {
    const result = new THREE.Mesh(merge(pieces), material);
    result.name = name;
    result.castShadow = result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  // Donkey: a squat barrel body, big ears and a dark mane stripe.
  const donkey = pivot(rig, 'donkey', [0, 0.51, 0.36]);
  mesh([
    part(new THREE.IcosahedronGeometry(1, 0), coat, [0, 0, 0], [0.19, 0.18, 0.36]),
    part(new THREE.BoxGeometry(0.12, 0.26, 0.14), coat, [0, 0.14, 0.3], [1, 1, 1], [0.5, 0, 0]),
    part(new THREE.BoxGeometry(0.13, 0.12, 0.26), coat, [0, 0.27, 0.45], [1, 1, 1], [0.25, 0, 0]),
    part(new THREE.BoxGeometry(0.11, 0.08, 0.06), 0xd8cbb3, [0, 0.22, 0.58]),
    part(new THREE.BoxGeometry(0.04, 0.1, 0.24), 0x302b27, [0, 0.27, 0.27], [1, 1, 1], [0.5, 0, 0]),
    ...[-1, 1].map(side => part(new THREE.ConeGeometry(0.035, 0.17, 4), coat,
      [side * 0.05, 0.4, 0.38], [1, 1, 0.5], [-0.25, 0, side * -0.3])),
    part(new THREE.BoxGeometry(0.03, 0.2, 0.03), 0x302b27, [0, -0.05, -0.38], [1, 1, 1], [0.35, 0, 0]),
    // Collar and harness strap in team colour.
    part(new THREE.BoxGeometry(0.2, 0.05, 0.08), color, [0, 0.1, 0.22], [1, 1, 1], [0.5, 0, 0]),
    part(new THREE.BoxGeometry(0.4, 0.035, 0.06), leather, [0, 0.0, 0.12]),
  ], donkey, 'donkey-body');
  const legGeometry = merge([
    part(new THREE.BoxGeometry(0.06, 0.38, 0.06), coat, [0, -0.19, 0]),
    part(new THREE.BoxGeometry(0.07, 0.05, 0.08), 0x302b27, [0, -0.385, 0.01]),
  ]);
  const legs = [[-0.09, 0.2], [0.09, 0.2], [-0.09, -0.22], [0.09, -0.22]].map(([x, z], i) => {
    const leg = pivot(donkey, `donkeyLeg${i}`, [x, -0.1, z]);
    const m = new THREE.Mesh(legGeometry, material);
    m.name = 'donkey-leg';
    m.castShadow = m.receiveShadow = true;
    leg.add(m);
    return leg;
  });

  // Cart: plank bed with side boards, shafts to the harness, axle under the load.
  const cart = pivot(rig, 'cart', [0, 0, -0.56]);
  const load: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(0.66, 0.05, 0.78), wood, [0, 0.42, 0]),
    ...[-1, 1].flatMap(side => [
      part(new THREE.BoxGeometry(0.035, 0.16, 0.78), TREE_TRUNK, [side * 0.33, 0.52, 0]),
      // Shafts run forward to the donkey's flanks.
      coloredRod(TREE_TRUNK, [side * 0.24, 0.43, 0.38], [side * 0.15, 0.6, 1.0], 0.018),
    ]),
    part(new THREE.BoxGeometry(0.66, 0.16, 0.035), TREE_TRUNK, [0, 0.52, -0.38]),
    part(new THREE.BoxGeometry(0.84, 0.04, 0.04), leather, [0, 0.3, 0]),
    part(new THREE.BoxGeometry(0.035, 0.32, 0.035), TREE_TRUNK, [0, 0.21, -0.33]),
  ];
  // Upright amphorae packed in straw, a sack and a team cloth thrown over the rear load.
  for (const [x, z, s] of [[-0.17, 0.2, 1], [0.15, 0.22, 0.9], [0.0, -0.02, 1.05]] as const) {
    load.push(part(new THREE.CylinderGeometry(0.07 * s, 0.04 * s, 0.1 * s, 6), clay[0], [x, 0.5 * 1, z]));
    load.push(part(new THREE.CylinderGeometry(0.055 * s, 0.1 * s, 0.2 * s, 6), clay[1], [x, 0.5 + 0.15 * s, z]));
    load.push(part(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.1 * s, 5), clay[0], [x, 0.5 + 0.3 * s, z]));
  }
  load.push(part(new THREE.IcosahedronGeometry(0.13, 0), 0xc8b58c, [0.16, 0.55, -0.05], [1, 0.75, 1]));
  load.push(part(new THREE.BoxGeometry(0.62, 0.17, 0.32), color, [0, 0.58, -0.22]));
  for (const side of [-1, 1]) {
    load.push(part(new THREE.BoxGeometry(0.02, 0.2, 0.3), color, [side * 0.35, 0.5, -0.22], [1, 1, 1], [0, 0, side * 0.12]));
  }
  load.push(part(new THREE.BoxGeometry(0.64, 0.02, 0.04), 0xd8c5a0, [0, 0.67, -0.1]));
  mesh(load, cart, 'cart-load');
  const wheelGeometry = merge([
    part(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 10), wood, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 6), TREE_TRUNK, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.BoxGeometry(0.055, 0.5, 0.04), TREE_TRUNK, [0, 0, 0]),
    part(new THREE.BoxGeometry(0.055, 0.04, 0.5), TREE_TRUNK, [0, 0, 0]),
  ]);
  const wheels = [-1, 1].map(side => {
    const wheel = pivot(cart, side < 0 ? 'leftWheel' : 'rightWheel', [side * 0.43, 0.27, 0]);
    const m = new THREE.Mesh(wheelGeometry, material);
    m.name = 'wheel';
    m.castShadow = m.receiveShadow = true;
    wheel.add(m);
    return wheel;
  });

  const legBounds = legGeometry.boundingBox!;
  const hoofCorners: THREE.Vector3[] = [];
  for (const x of [legBounds.min.x, legBounds.max.x]) for (const y of [legBounds.min.y, legBounds.max.y]) {
    for (const z of [legBounds.min.z, legBounds.max.z]) hoofCorners.push(new THREE.Vector3(x, y, z));
  }
  const point = new THREE.Vector3();
  const hoof = new THREE.Matrix4();
  let fall: ((progress: number) => void) | undefined;
  function setPose(pose: SoldierPose, t: number, extra?: SoldierPoseExtra): void {
    const time = Number.isFinite(t) ? t : 0;
    const walking = pose === 'walk';
    const cycle = time * Math.PI * 2 * 1.4 + phase;
    rig.rotation.set(0, 0, 0);
    rig.position.set(0, 0, 0);
    donkey.rotation.set(walking ? Math.sin(cycle * 2) * 0.02 : 0, 0, 0);
    legs.forEach((leg, i) => {
      const offset = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation.set(walking ? Math.sin(cycle + offset) * 0.42 : 0, 0, 0);
    });
    // Rolling without slip at about 1.1 m/s for the walk cycle.
    const roll = walking ? -(time * 1.1) / 0.27 : 0;
    for (const wheel of wheels) wheel.rotation.set(roll, 0, 0);
    cart.rotation.set(walking ? Math.sin(cycle * 2) * 0.008 : 0, 0, 0);
    donkey.updateMatrix();
    let sole = Infinity;
    for (const leg of legs) {
      leg.updateMatrix();
      hoof.multiplyMatrices(donkey.matrix, leg.matrix);
      for (const corner of hoofCorners) sole = Math.min(sole, point.copy(corner).applyMatrix4(hoof).y);
    }
    // Wheels (radius 0.27 at axle height 0.27) and hooves both meet the ground.
    rig.position.y = Math.max(0, -sole);
    if (pose === 'die') fall?.(typeof extra === 'number' ? extra : extra?.progress ?? 0);
  }
  setPose('idle', 0);
  fall = fallingPose(object, rig);
  setPose('idle', 0);
  return { object, setPose };
}
