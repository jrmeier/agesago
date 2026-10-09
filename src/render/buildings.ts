import * as THREE from 'three';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind } from '../core/types';
import { TREE_TRUNK, SELECTION } from './palette';
import { bowParts, merge, modelMaterial, part, type Triple } from './models';
import { amphoraParts, bevelBox, block, cartGeometry, crateParts, gableParts, roofParts } from './props';

const STONE = 0xc5bea6;
const WOOD = 0x82603b;

export interface BuildingModelOptions {
  color?: number;
  seed?: number;
  /** Upgrade tier from buildingTier(): watch tower 0..2, town centre 0..1. Other kinds ignore it. */
  tier?: number;
}

/**
 * Bake footprint fitting into geometry, leaving the group's transform to the renderer.
 * Named anchor points (pre-fit coordinates) are mapped the same way into `userData.anchors`.
 */
function fitFootprint(object: THREE.Group, kind: BuildingKind, anchors: Record<string, Triple> = {}): void {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const spec = BUILDINGS[kind].size;
  const sx = spec.w / size.x, sz = spec.d / size.z;
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.translate(-center.x, -bounds.min.y, -center.z);
    child.geometry.scale(sx, 1, sz);
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  });
  const fitted: Record<string, Triple> = {};
  for (const [name, [x, y, z]] of Object.entries(anchors)) fitted[name] = [(x - center.x) * sx, y - bounds.min.y, (z - center.z) * sz];
  object.userData.anchors = fitted;
}

/** Clamp a requested upgrade tier to what a kind can show. */
export function modelTier(kind: BuildingKind, tier: number | undefined): number {
  const max = kind === 'watchTower' ? 2 : kind === 'townCenter' ? 1 : 0;
  const t = Number.isFinite(tier) ? Math.trunc(tier as number) : 0;
  return Math.max(0, Math.min(max, t));
}

function section(object: THREE.Group, name: string, pieces: THREE.BufferGeometry[], material: THREE.Material): void {
  const mesh = new THREE.Mesh(merge(pieces), material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  object.add(mesh);
}

/** Ancient civic centre, ground-anchored with its portico facing +z. */
export function buildTownCenter(baseHeight: number, opts?: { color?: number; tier?: number }): THREE.Group {
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
  const fortified = modelTier('townCenter', opts?.tier) >= 1;
  if (fortified) parts.push(...fortifiedTownCenterParts());
  const shellEnd = parts.length;
  // The fortified centre trades its porch jars for masonry to stay inside the triangle budget.
  if (!fortified) {
    parts.push(...amphoraParts(-1.33, 0.41, 0.7, 0.7));
    parts.push(...amphoraParts(1.34, 0.41, 0.6, 0.65));
  }
  parts.push(...crateParts([1.35, 0, -1.58], 0.34));
  const storesEnd = parts.length;
  parts.push(part(new THREE.CylinderGeometry(0.025, 0.035, 1.29, 5), TREE_TRUNK, [-1.44, 3.455, -0.78]));
  parts.push(part(new THREE.OctahedronGeometry(0.095), SELECTION, [-1.44, 4.145, -0.78], [0.8, 1.2, 0.65]));
  parts.push(block([0.39, 0.52, 0.027], opts?.color ?? 0x9e3b26, [-1.235, 3.81, -0.78]));
  parts.push(block([0.035, 0.45, 0.038], SELECTION, [-1.06, 3.81, -0.78]));
  parts.push(block([0.27, 0.045, 0.038], SELECTION, [-1.235, 3.96, -0.78]));
  const object = new THREE.Group();
  object.name = 'town-center';
  object.userData.tier = modelTier('townCenter', opts?.tier);
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
  fitFootprint(object, 'townCenter');
  object.position.y = baseHeight;
  return object;
}

/** Crenellated stone corner bastions (Fortified Town Center). */
function fortifiedTownCenterParts(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const masonry = 0x9f9580;
  // Bastions rise clear of the eaves so their crenels read from the RTS camera.
  for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4]) {
    parts.push(block([0.42, 3.2, 0.42], masonry, [x, 1.9, z]));
    parts.push(block([0.46, 0.08, 0.46], 0xb7ad92, [x, 1.2, z]));
    parts.push(block([0.48, 0.12, 0.48], 0xb7ad92, [x, 3.54, z]));
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) parts.push(block([0.14, 0.2, 0.14], masonry, [x + dx * 0.16, 3.7, z + dz * 0.16]));
  }
  return parts;
}

/** Guard Tower (tier 1) and Fortress Tower (tier 2); both carry a team banner. */
function upgradedTowerParts(tier: number, color: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const masonry = tier >= 2 ? 0xc9c0a6 : 0xb7ad92;
  let top: number;
  if (tier === 1) {
    // Taller shaft with string courses, arrow slits, a full ring of merlons and a banner.
    parts.push(block([1.9, 0.28, 1.9], STONE, [0, 0.14, 0]));
    parts.push(block([1.3, 3.5, 1.3], masonry, [0, 2.03, 0]));
    for (const y of [1.35, 2.6]) parts.push(block([1.36, 0.08, 1.36], 0xd4ccb4, [0, y, 0]));
    parts.push(block([0.42, 0.85, 0.08], TREE_TRUNK, [0, 0.705, 0.65]));
    for (const y of [1.9, 3.1]) {
      parts.push(block([0.07, 0.34, 0.04], 0x3b3328, [0, y, 0.66]));
      parts.push(block([0.04, 0.34, 0.07], 0x3b3328, [0.66, y, 0]));
      parts.push(block([0.04, 0.34, 0.07], 0x3b3328, [-0.66, y, 0]));
    }
    // Timber corbels carry an overhanging fighting floor.
    for (const x of [-0.5, 0.5]) for (const z of [-0.69, 0.69]) parts.push(block([0.1, 0.18, 0.14], WOOD, [x, 3.66, z]));
    parts.push(block([1.74, 0.16, 1.74], WOOD, [0, 3.86, 0]));
    for (const z of [0.79, -0.79]) parts.push(block([1.74, 0.24, 0.16], STONE, [0, 4.06, z]));
    for (const x of [0.79, -0.79]) parts.push(block([0.16, 0.24, 1.42], STONE, [x, 4.06, 0]));
    for (const t of [-0.62, 0, 0.62]) {
      for (const z of [0.79, -0.79]) parts.push(block([0.22, 0.3, 0.16], 0xd4ccb4, [t, 4.33, z]));
      if (t !== 0) for (const x of [0.79, -0.79]) parts.push(block([0.16, 0.3, 0.22], 0xd4ccb4, [x, 4.33, t]));
    }
    top = 4.18;
  } else {
    // Fortress keep: battered plinth, massive shaft, corner turrets and machicolations.
    parts.push(part(bevelBox(1.9, 0.62, 1.9, 0.08), 0xa79b84, [0, 0.31, 0]));
    parts.push(part(bevelBox(1.56, 3.7, 1.56, 0.05), masonry, [0, 2.47, 0]));
    parts.push(block([0.48, 1.0, 0.1], TREE_TRUNK, [0, 1.12, 0.79]));
    parts.push(block([0.62, 0.12, 0.12], 0x9f9580, [0, 1.68, 0.8]));
    for (const y of [2.2, 3.4]) {
      parts.push(block([0.07, 0.38, 0.04], 0x3b3328, [0, y, 0.79]));
      parts.push(block([0.04, 0.38, 0.07], 0x3b3328, [0.79, y, 0]));
      parts.push(block([0.04, 0.38, 0.07], 0x3b3328, [-0.79, y, 0]));
      parts.push(block([0.07, 0.38, 0.04], 0x3b3328, [0, y, -0.79]));
    }
    // Machicolation corbels and the projecting parapet.
    for (const t of [-0.55, 0, 0.55]) {
      for (const z of [-0.82, 0.82]) parts.push(block([0.12, 0.2, 0.12], 0x9f9580, [t, 4.28, z]));
      for (const x of [-0.82, 0.82]) parts.push(block([0.12, 0.2, 0.12], 0x9f9580, [x, 4.28, t]));
    }
    parts.push(block([1.84, 0.3, 1.84], 0xd4ccb4, [0, 4.53, 0]));
    for (const t of [-0.4, 0.4]) {
      for (const z of [-0.84, 0.84]) parts.push(block([0.24, 0.28, 0.16], masonry, [t, 4.82, z]));
      for (const x of [-0.84, 0.84]) parts.push(block([0.16, 0.28, 0.24], masonry, [x, 4.82, t]));
    }
    // Round corner turrets with conical tiled caps.
    for (const x of [-0.82, 0.82]) for (const z of [-0.82, 0.82]) {
      parts.push(part(new THREE.CylinderGeometry(0.2, 0.23, 0.9, 8), masonry, [x, 4.83, z]));
      parts.push(part(new THREE.ConeGeometry(0.26, 0.42, 8), 0x9d4937, [x, 5.49, z]));
    }
    top = 4.68;
  }
  // Banner pole on the roof with the owner's colours.
  parts.push(block([0.06, 1.3, 0.06], TREE_TRUNK, [0, top + 0.65, 0]));
  parts.push(block([0.5, 0.34, 0.03], color, [0.28, top + 1.08, 0]));
  parts.push(part(new THREE.OctahedronGeometry(0.06, 0), 0xb89b53, [0, top + 1.33, 0]));
  return parts;
}

/** Smithy: a tiled stone workshop with an open lean-to over a glowing hearth, chimney and anvil. */
function forgeParts(): { parts: THREE.BufferGeometry[]; anchors: Record<string, Triple> } {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(bevelBox(3.0, 1.55, 1.5), 0xd6cdb4, [0, 0.83, -0.86]));
  parts.push(...gableParts(3.0, 1.5, 1.6, 0.55, 0xd6cdb4).map(piece => piece.translate(0, 0, -0.86)));
  parts.push(...roofParts(3.25, 1.62, 1.6, 0.6, false, 3).map(piece => piece.translate(0, 0, -0.86)));
  parts.push(block([0.58, 1.05, 0.05], TREE_TRUNK, [0.75, 0.585, -0.09]));
  // Lean-to: two posts and a sloping tiled roof falling toward the yard.
  for (const x of [-1.38, 0.15]) parts.push(block([0.12, 1.5, 0.12], TREE_TRUNK, [x, 0.81, 1.12]));
  parts.push(block([1.8, 0.07, 0.07], WOOD, [-0.62, 1.52, 1.12]));
  parts.push(block([1.85, 0.07, 1.45], 0x9d4937, [-0.62, 1.66, 0.48], [0.2, 0, 0]));
  // Hearth: a stone forge with a glowing mouth and a bed of coals.
  parts.push(part(bevelBox(0.95, 0.62, 0.78, 0.05), 0x8f877a, [-0.75, 0.37, 0.24]));
  parts.push(block([0.5, 0.26, 0.04], 0xff8a2a, [-0.75, 0.4, 0.64]));
  parts.push(block([0.66, 0.05, 0.5], 0xffb347, [-0.75, 0.705, 0.24]));
  for (const [x, z] of [[-0.92, 0.18], [-0.68, 0.32], [-0.6, 0.12]]) {
    parts.push(part(new THREE.OctahedronGeometry(0.08, 0), 0xff5a1a, [x, 0.74, z], [1, 0.6, 1]));
  }
  // Chimney rising from the back of the hearth through the workshop roof.
  parts.push(block([0.5, 2.62, 0.5], 0xa89f8a, [-0.75, 1.37, -0.22]));
  parts.push(block([0.6, 0.1, 0.6], 0x8f877a, [-0.75, 2.73, -0.22]));
  parts.push(block([0.32, 0.02, 0.32], 0x2b2420, [-0.75, 2.79, -0.22]));
  // Leather bellows against the hearth.
  parts.push(block([0.32, 0.12, 0.44], 0x6b4a2e, [-1.36, 0.48, 0.3], [0, 0, 0.3]));
  parts.push(block([0.06, 0.05, 0.3], WOOD, [-1.42, 0.58, 0.62]));
  // Anvil on its stump, with a hammer resting across the face.
  parts.push(part(new THREE.CylinderGeometry(0.17, 0.2, 0.4, 6), TREE_TRUNK, [0.55, 0.26, 0.78]));
  parts.push(block([0.17, 0.1, 0.12], 0x3e4044, [0.55, 0.51, 0.78]));
  parts.push(block([0.42, 0.13, 0.18], 0x4a4c50, [0.55, 0.62, 0.78]));
  parts.push(part(new THREE.ConeGeometry(0.06, 0.2, 4), 0x4a4c50, [0.86, 0.63, 0.78], [1, 1, 1], [0, 0, -Math.PI / 2]));
  parts.push(block([0.03, 0.03, 0.24], TREE_TRUNK, [0.48, 0.705, 0.8]));
  parts.push(block([0.08, 0.06, 0.07], 0x3e4044, [0.48, 0.71, 0.93]));
  // Quench trough and a stack of bar stock.
  parts.push(block([0.74, 0.26, 0.32], STONE, [0.3, 0.16, 1.36]));
  parts.push(block([0.62, 0.02, 0.2], 0x527779, [0.3, 0.29, 1.36]));
  for (let i = 0; i < 3; i++) parts.push(block([0.26, 0.05, 0.08], [0x8f969c, 0xb08a4a, 0x8f969c][i], [1.25, 0.09 + Math.floor(i / 2) * 0.05, 0.5 + (i % 2) * 0.1]));
  // Weapon rack beside the door.
  parts.push(block([0.62, 0.06, 0.05], WOOD, [1.28, 0.95, -0.06]));
  for (const x of [1.1, 1.3, 1.46]) parts.push(block([0.035, 0.6, 0.02], 0xc2c4b8, [x, 0.68, -0.04]));
  return { parts, anchors: { hearth: [-0.75, 0.4, 0.68], chimney: [-0.75, 2.8, -0.22] } };
}

/** A low, light jar used where amphoraParts would cost too many triangles. */
function jarParts(x: number, y: number, z: number, scale = 1, color = 0xbe6944): THREE.BufferGeometry[] {
  return [
    part(new THREE.CylinderGeometry(0.07, 0.12, 0.24, 6), color, [x, y + 0.12 * scale, z], [scale, scale, scale]),
    part(new THREE.CylinderGeometry(0.05, 0.08, 0.16, 6), 0xa95136, [x, y + 0.31 * scale, z], [scale, scale, scale]),
  ];
}

/** Agora: paving, three market stalls with striped awnings, jars and a well head. */
function marketParts(color: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(block([4.0, 0.05, 4.0], 0xd8cfb6, [0, 0.085, 0]));
  for (let i = 0; i < 4; i++) parts.push(block([4.0, 0.012, 0.04], 0xb3a98f, [0, 0.112, -1.5 + i * 1.0]));
  const stall = (x: number, z: number, yaw: number, stripe: number, goods: number): void => {
    const local: THREE.BufferGeometry[] = [];
    local.push(block([1.3, 0.48, 0.42], WOOD, [0, 0.36, 0.22]));
    local.push(block([1.38, 0.05, 0.5], 0xc4a36e, [0, 0.625, 0.22]));
    for (const px of [-0.64, 0.64]) for (const pz of [-0.36, 0.42]) local.push(block([0.07, 1.42, 0.07], TREE_TRUNK, [px, 0.82, pz]));
    // Five stripes slope toward the customer, with a scalloped valance along the front edge.
    for (let i = 0; i < 5; i++) {
      const c = i % 2 === 0 ? 0xece3cc : stripe;
      local.push(block([0.28, 0.035, 1.0], c, [-0.56 + i * 0.28, 1.56, 0.04], [0.26, 0, 0]));
      local.push(block([0.28, 0.14, 0.02], c, [-0.56 + i * 0.28, 1.36, 0.55]));
    }
    // Wares on the counter: fruit, cloth bolts or small jars.
    for (let i = 0; i < 3; i++) {
      const gx = -0.4 + i * 0.4;
      if (goods === 0) local.push(part(new THREE.OctahedronGeometry(0.09, 0), [0xc74432, 0xd4a843, 0x7fae4e][i], [gx, 0.71, 0.2]));
      else if (goods === 1) local.push(block([0.26, 0.1, 0.16], [0x446b81, 0xe4d9bd, 0x9c7a3c][i], [gx, 0.7, 0.2], [0, 0.2 * i, 0]));
      else local.push(part(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 5), 0xbe6944, [gx, 0.73, 0.2]));
    }
    for (const piece of local) parts.push(piece.rotateY(yaw).translate(x, 0.11, z));
  };
  stall(-0.95, -1.25, 0, color, 0);
  stall(0.95, -1.25, 0, 0x446b81, 1);
  stall(1.3, 0.6, -Math.PI / 2, 0xc8a453, 2);
  // Well head in the square.
  parts.push(part(new THREE.CylinderGeometry(0.36, 0.4, 0.38, 8), STONE, [-0.55, 0.3, 0.75]));
  parts.push(part(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 8), 0x3f5f62, [-0.55, 0.48, 0.75]));
  // Amphorae stacked by the stalls and a rope-tied crate.
  for (const [x, z, s] of [[-1.75, -0.4, 1], [-1.55, -0.2, 0.85], [-1.78, -0.05, 0.9], [0.05, 1.6, 0.95], [-0.2, 1.72, 0.8]] as const) {
    parts.push(...jarParts(x, 0.11, z, s, s > 0.9 ? 0xbe6944 : 0xa95136));
  }
  parts.push(...crateParts([1.15, 0.11, 1.7], 0.36));
  return parts;
}

/** Stoa academy: a stepped platform, a colonnade on three sides and a pedimented, tiled roof. */
function academyParts(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const marble = 0xe6dfca;
  for (let i = 0; i < 3; i++) parts.push(block([4.2 - i * 0.22, 0.12, 3.9 - i * 0.22], [0xb8b09a, 0xc9c2a9, 0xd4ccb4][i], [0, 0.09 + i * 0.12, 0]));
  parts.push(part(bevelBox(3.3, 1.9, 1.5), marble, [0, 1.34, -0.95]));
  parts.push(block([0.6, 1.2, 0.05], TREE_TRUNK, [0, 0.99, -0.18]));
  // Painted wall panels either side of the door.
  for (const x of [-1.0, 1.0]) parts.push(block([0.7, 0.5, 0.02], 0x446b81, [x, 1.35, -0.19]));
  const columns: [number, number][] = [];
  for (let i = 0; i < 6; i++) columns.push([-1.55 + i * 0.62, 1.45]);
  for (const x of [-1.55, 1.55]) for (const z of [0.6, -0.2]) columns.push([x, z]);
  for (const [x, z] of columns) {
    parts.push(block([0.3, 0.07, 0.3], 0xd7cfb9, [x, 0.43, z]));
    parts.push(part(new THREE.CylinderGeometry(0.1, 0.12, 1.76, 6), 0xf0eadb, [x, 1.34, z]));
    parts.push(block([0.3, 0.09, 0.3], 0xe3d9be, [x, 2.265, z]));
  }
  // Entablature with a triglyph frieze, then the pediment and roof.
  parts.push(block([3.62, 0.16, 3.4], 0xd8d0b8, [0, 2.39, -0.15]));
  parts.push(block([3.66, 0.12, 0.05], 0x446b81, [0, 2.53, 1.56]));
  for (let i = 0; i < 7; i++) parts.push(block([0.1, 0.13, 0.06], 0x3b3a44, [-1.5 + i * 0.5, 2.53, 1.585]));
  parts.push(block([3.7, 0.08, 3.46], 0xd0c6ab, [0, 2.63, -0.15]));
  parts.push(...gableParts(3.62, 3.4, 2.67, 0.62, marble).map(piece => piece.translate(0, 0, -0.15)));
  parts.push(...roofParts(3.9, 3.56, 2.67, 0.66, false, 2).map(piece => piece.translate(0, 0, -0.15)));
  // Akroteria on the pediment and a philosopher's herm in the forecourt.
  parts.push(part(new THREE.ConeGeometry(0.1, 0.24, 4), 0xb89b53, [0, 3.48, 1.56]));
  for (const x of [-1.78, 1.78]) parts.push(part(new THREE.ConeGeometry(0.08, 0.18, 4), 0xb89b53, [x, 2.78, 1.56]));
  parts.push(block([0.26, 0.7, 0.26], 0xe9e2cc, [1.6, 0.68, 1.75]));
  parts.push(block([0.18, 0.2, 0.18], 0xd9d2bb, [1.6, 1.13, 1.75]));
  return parts;
}

/** Grounded, centred ancient economy buildings; the renderer supplies world position and yaw. */
export function buildingModel(kind: BuildingKind, opts?: BuildingModelOptions): THREE.Group {
  if (kind === 'townCenter') return buildTownCenter(0, opts);
  const { w, d } = BUILDINGS[kind].size;
  const seed = Math.abs(Math.trunc(opts?.seed ?? 1));
  const tier = modelTier(kind, opts?.tier);
  const object = new THREE.Group();
  object.name = kind;
  object.userData.tier = tier;
  let anchors: Record<string, Triple> = {};
  const parts = [block([w, 0.06, d], kind === 'farm' ? 0x73533a : 0xaaa18a, [0, 0.03, 0])];
  if (kind === 'house') {
    parts.push(part(bevelBox(2.15, 1.48, 2.07), 0xe2dbc3, [0, 0.8, -0.09]));
    parts.push(block([2.19, 0.22, 2.11], STONE, [0, 0.17, -0.09]));
    parts.push(...gableParts(2.15, 2.07, 1.54, 0.65, 0xe2dbc3));
    parts.push(...roofParts(2.48, 2.42, 1.54, 0.7, seed % 2 === 0));
    parts.push(block([0.54, 1.02, 0.06], TREE_TRUNK, [-0.43, 0.57, 0.98]));
    parts.push(block([0.46, 0.43, 0.035], 0x423c2e, [0.49, 1.02, 0.966]));
    for (const x of [0.24, 0.74]) parts.push(block([0.08, 0.51, 0.06], WOOD, [x, 1.02, 1.005]));
    parts.push(...amphoraParts(0.96, 0.06, 1.04, 0.75));
  } else if (kind === 'storehouse') {
    parts.push(block([1.9, 1.38, 0.12], WOOD, [-0.38, 0.75, -1.13]));
    for (const x of [-1.28, 0.52]) {
      parts.push(block([0.12, 1.48, 1.9], WOOD, [x, 0.8, -0.24]));
      for (const z of [-1.16, 0.68]) parts.push(block([0.15, 1.72, 0.15], TREE_TRUNK, [x, 0.92, z]));
    }
    const roof = roofParts(2.1, 2.24, 1.68, 0.59, false, 3);
    for (const piece of roof) piece.translate(-0.38, 0, -0.2);
    parts.push(...roof);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3 - row; i++) {
      const x = -0.98 + i * 0.28 + row * 0.14;
      parts.push(part(new THREE.CylinderGeometry(0.13, 0.14, 0.67, 6), TREE_TRUNK,
        [x, 0.2 + row * 0.23, 1.04], [1, 1, 1], [Math.PI / 2, 0, 0]));
      parts.push(part(new THREE.CircleGeometry(0.115, 6), 0xc4956a, [x, 0.2 + row * 0.23, 1.38]));
    }
    parts.push(block([0.17, 2.62, 0.17], TREE_TRUNK, [1.03, 1.37, -0.22]));
    parts.push(block([0.17, 0.17, 1.62], WOOD, [1.03, 2.56, 0.41]));
    parts.push(block([0.12, 1.02, 0.12], WOOD, [1.03, 2.18, 0.07], [-0.66, 0, 0]));
    parts.push(block([0.023, 1.18, 0.023], 0xc8b58c, [1.03, 1.92, 1.15]));
    parts.push(...crateParts([1.03, 0.72, 1.15], 0.42));
  } else if (kind === 'miningCamp') {
    parts.push(part(bevelBox(2.12, 1.22, 1.65), STONE, [-0.3, 0.67, -0.43]));
    parts.push(...gableParts(2.12, 1.65, 1.28, 0.44, STONE).map(piece => piece.translate(-0.3, 0, -0.43)));
    parts.push(...roofParts(2.38, 1.94, 1.28, 0.49, false, 3).map(piece => piece.translate(-0.3, 0, -0.43)));
    parts.push(block([0.64, 0.97, 0.045], TREE_TRUNK, [-0.3, 0.545, 0.42]));
    const cart = cartGeometry();
    cart.scale(0.49, 0.49, 0.49).translate(-0.69, 0.06, 0.9);
    parts.push(cart);
    for (let i = 0; i < 3; i++) {
      parts.push(part(new THREE.IcosahedronGeometry(0.17, 0), 0x96998e, [-0.9 + i * 0.2, 0.41, 0.72]));
      parts.push(block([0.035, 0.75, 0.035], WOOD, [0.81 + i * 0.2, 0.46, 0.26]));
      parts.push(block([0.2, 0.035, 0.05], 0x8c8978, [0.81 + i * 0.2, 0.83, 0.26]));
      parts.push(part(bevelBox(0.32, 0.27, 0.36), 0xd4cfb9, [0.84 + i % 2 * 0.35, 0.195 + Math.floor(i / 2) * 0.28, 0.97]));
    }
    parts.push(block([0.64, 0.055, 0.07], TREE_TRUNK, [1.01, 0.51, 0.23]));
  } else if (kind === 'granary') {
    for (const x of [-1, 1]) for (const z of [-0.99, 0.7]) {
      parts.push(part(bevelBox(0.35, 0.55, 0.35), STONE, [x, 0.335, z]));
      parts.push(block([0.51, 0.1, 0.51], 0xe0d8bf, [x, 0.64, z]));
    }
    parts.push(block([2.38, 0.15, 2.11], WOOD, [0, 0.745, -0.14]));
    parts.push(block([2.17, 1.2, 1.82], 0xc0a875, [0, 1.42, -0.24]));
    for (const x of [-1.09, 0, 1.09]) parts.push(block([0.1, 1.22, 0.09], TREE_TRUNK, [x, 1.43, 0.72]));
    for (const y of [1.08, 1.42, 1.78]) parts.push(block([2.12, 0.025, 0.024], WOOD, [0, y, 0.684]));
    parts.push(...gableParts(2.17, 1.82, 2.02, 0.65, 0xc0a875).map(piece => piece.translate(0, 0, -0.24)));
    parts.push(...roofParts(2.54, 2.2, 2.02, 0.69, true, 3).map(piece => piece.translate(0, 0, -0.24)));
    for (let i = 0; i < 3; i++) parts.push(block([0.65, 0.18, 0.23], STONE, [-0.53, 0.15 + i * 0.18, 1.18 - i * 0.2]));
    for (let i = 0; i < 3; i++) {
      parts.push(...amphoraParts(0.33 + i * 0.33, 0.06, 1.05, 0.75));
      parts.push(part(new THREE.IcosahedronGeometry(0.2, 0), 0xcab783, [-1.13 + i * 0.33, 0.23, -1.16], [1, 1.2, 0.85]));
    }
  } else if (kind === 'barracks') {
    // A squat masonry compound with a tiled rear hall and an open drill yard.
    parts.push(part(bevelBox(3.45, 1.68, 1.52), 0xd4ccb4, [0, 0.9, -1.03]));
    parts.push(...gableParts(3.45, 1.52, 1.74, 0.62, 0xd4ccb4).map(piece => piece.translate(0, 0, -1.03)));
    parts.push(...roofParts(3.68, 1.82, 1.74, 0.67, false, 3).map(piece => piece.translate(0, 0, -1.03)));
    parts.push(block([0.7, 1.2, 0.06], TREE_TRUNK, [0, 0.66, -0.235]));
    for (const x of [-1.7, 1.7]) {
      parts.push(block([0.17, 0.67, 2.02], STONE, [x, 0.395, 0.74]));
      for (const z of [-1.65, -0.32]) parts.push(block([0.14, 1.78, 0.14], TREE_TRUNK, [x, 0.95, z]));
    }
    // Weapon rack: crossed feet, rail, bronze-tipped spears and round shields.
    for (const x of [-1.15, -0.42]) parts.push(block([0.08, 0.86, 0.08], WOOD, [x, 0.49, 0.17]));
    parts.push(block([0.92, 0.09, 0.09], TREE_TRUNK, [-0.785, 0.85, 0.17]));
    for (let i = 0; i < 3; i++) {
      const x = -1.08 + i * 0.28;
      parts.push(part(new THREE.CylinderGeometry(0.018, 0.018, 1.24, 4), WOOD, [x, 0.68, 0.29], [1, 1, 1], [-0.12, 0, 0]));
      parts.push(part(new THREE.ConeGeometry(0.038, 0.14, 4), 0xb89b53, [x, 1.36, 0.21]));
      parts.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.045, 8), opts?.color ?? 0x9e3b26, [x, 0.45, 0.34], [1, 1, 1], [Math.PI / 2, 0, 0]));
    }
    for (const z of [0.5, 1.3]) {
      parts.push(block([0.54, 0.065, 0.48], WOOD, [1.03, 0.095, z]));
      parts.push(block([0.08, 1.08, 0.08], TREE_TRUNK, [1.03, 0.62, z]));
      parts.push(part(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 6), 0xc8a453, [1.03, 0.81, z]));
      parts.push(block([0.62, 0.075, 0.07], WOOD, [1.03, 0.88, z]));
      parts.push(part(new THREE.IcosahedronGeometry(0.135, 0), 0xd4b667, [1.03, 1.22, z]));
    }
  } else if (kind === 'archeryRange') {
    // High open-sided timber hall; the visible targets occupy the front practice lane.
    for (const x of [-1.61, 1.61]) for (const z of [-1.57, -0.53, 0.46]) {
      parts.push(block([0.14, 2.1, 0.14], TREE_TRUNK, [x, 1.11, z]));
      parts.push(block([0.075, 0.64, 0.09], WOOD, [x * 0.91, 1.96, z], [0, 0, x < 0 ? -0.5 : 0.5]));
    }
    parts.push(block([3.4, 0.15, 0.15], WOOD, [0, 2.12, 0.46]));
    parts.push(block([3.4, 0.15, 0.15], WOOD, [0, 2.12, -1.57]));
    parts.push(...roofParts(3.63, 2.48, 2.17, 0.85, true, 3).map(piece => piece.translate(0, 0, -0.55)));
    for (const x of [-0.88, 0.88]) {
      for (const side of [-1, 1]) parts.push(block([0.055, 1.08, 0.07], WOOD, [x + side * 0.19, 0.59, 1.34], [0, 0, side * -0.23]));
      for (const [radius, color, z] of [[0.34, 0xc8a453, 1.36], [0.24, 0xe4d9bd, 1.4], [0.14, 0x9e3b26, 1.425], [0.055, 0x493623, 1.44]]) {
        parts.push(part(new THREE.CylinderGeometry(radius, radius, 0.035, 10), color, [x, 0.95, z], [1, 1, 1], [Math.PI / 2, 0, 0]));
      }
    }
    parts.push(block([1.2, 0.085, 0.09], WOOD, [0, 1.13, -1.55]));
    for (const x of [-0.56, 0.56]) parts.push(block([0.08, 1.1, 0.08], TREE_TRUNK, [x, 0.61, -1.55]));
    for (const x of [-0.4, 0, 0.4]) parts.push(...bowParts().map(piece => piece.rotateY(Math.PI / 2).translate(x, 0.86, -1.48)));
    parts.push(...crateParts([1.19, 0.06, -1.34], 0.4));
  } else if (kind === 'stable') {
    // Long low thatched roof over three open stalls, with a trough in the forecourt.
    parts.push(block([3.36, 1.3, 0.13], WOOD, [0, 0.71, -1.7]));
    for (const x of [-1.61, -0.54, 0.54, 1.61]) {
      parts.push(block([0.12, 1.3, 2.3], WOOD, [x, 0.71, -0.55]));
      for (const z of [-1.64, 0.57]) parts.push(block([0.15, 1.65, 0.15], TREE_TRUNK, [x, 0.885, z]));
      parts.push(block([0.07, 0.07, 2.3], 0xaf8d5d, [x, 1.29, -0.55]));
    }
    parts.push(...roofParts(3.67, 2.64, 1.72, 0.58, true, 3).map(piece => piece.translate(0, 0, -0.54)));
    for (const x of [-1.07, 0, 1.07]) {
      parts.push(part(bevelBox(0.76, 0.29, 0.59), 0xc8a453, [x, 0.205, -1.02]));
      parts.push(block([0.045, 0.3, 0.6], 0x7d6943, [x, 0.21, -1.02]));
      parts.push(block([0.91, 0.075, 0.075], WOOD, [x, 0.85, 0.57]));
    }
    // Hollow stone trough with water, rather than a solid box.
    parts.push(block([2.1, 0.09, 0.51], STONE, [0, 0.105, 1.32]));
    for (const z of [1.1, 1.54]) parts.push(block([2.1, 0.33, 0.08], STONE, [0, 0.265, z]));
    for (const x of [-1.01, 1.01]) parts.push(block([0.08, 0.33, 0.44], STONE, [x, 0.265, 1.32]));
    parts.push(block([1.92, 0.015, 0.34], 0x527779, [0, 0.285, 1.32]));
  } else if (kind === 'watchTower' && tier > 0) {
    parts.push(...upgradedTowerParts(tier, opts?.color ?? 0x9e3b26));
  } else if (kind === 'forge') {
    const forge = forgeParts();
    parts.push(...forge.parts);
    anchors = forge.anchors;
  } else if (kind === 'market') {
    parts.push(...marketParts(opts?.color ?? 0x9e3b26));
  } else if (kind === 'academy') {
    parts.push(...academyParts());
  } else if (kind === 'watchTower') {
    // Square stone shaft, a timber fighting floor and a crenellated head. Faces +z.
    parts.push(block([1.9, 0.28, 1.9], STONE, [0, 0.14, 0]));
    parts.push(block([1.28, 2.55, 1.28], 0xb7ad92, [0, 1.555, 0]));
    parts.push(block([0.42, 0.85, 0.08], TREE_TRUNK, [0, 0.56, 0.64]));
    parts.push(block([1.72, 0.16, 1.72], WOOD, [0, 2.91, 0]));
    for (const z of [0.78, -0.78]) {
      parts.push(block([1.72, 0.22, 0.16], STONE, [0, 3.1, z]));
      for (const x of [-0.62, 0, 0.62]) parts.push(block([0.22, 0.32, 0.16], 0xd4ccb4, [x, 3.37, z]));
    }
    for (const x of [0.78, -0.78]) parts.push(block([0.16, 0.22, 1.4], STONE, [x, 3.1, 0]));
  } else if (kind === 'palisade') {
    // A short run of stakes along local +x, so a horizontal wall (rot 0) reads as a fence.
    parts.push(block([1.86, 0.12, 0.36], WOOD, [0, 0.08, 0]));
    for (const x of [-0.72, -0.24, 0.24, 0.72]) {
      parts.push(block([0.16, 1.28, 0.16], TREE_TRUNK, [x, 0.72, 0]));
      parts.push(block([0.1, 0.18, 0.1], 0x6a4a28, [x, 1.45, 0]));
    }
    parts.push(block([1.8, 0.08, 0.08], WOOD, [0, 0.48, 0]));
    parts.push(block([1.8, 0.08, 0.08], WOOD, [0, 1.05, 0]));
  } else if (kind === 'stoneWall') {
    // Masonry courses along local +x, with a crenellated top.
    parts.push(block([1.9, 0.32, 0.78], 0xa79b84, [0, 0.16, 0]));
    parts.push(block([1.78, 0.42, 0.62], STONE, [0, 0.53, 0]));
    parts.push(block([1.7, 0.42, 0.56], 0xd4ccb4, [0, 0.95, 0]));
    parts.push(block([1.78, 0.38, 0.62], STONE, [0, 1.35, 0]));
    for (const x of [-0.66, -0.22, 0.22, 0.66]) parts.push(block([0.3, 0.28, 0.62], 0xb7ad92, [x, 1.68, 0]));
  } else if (kind === 'gate') {
    // Two piers and a lintel, leaves swung open along local +z (the passage through the wall).
    for (const x of [-0.72, 0.72]) parts.push(block([0.42, 1.7, 0.72], STONE, [x, 0.85, 0]));
    parts.push(block([1.9, 0.28, 0.76], 0xd4ccb4, [0, 1.84, 0]));
    parts.push(block([0.1, 1.35, 0.52], WOOD, [-0.28, 0.72, 0.16]));
    parts.push(block([0.1, 1.35, 0.52], WOOD, [0.28, 0.72, -0.16]));
    parts.push(block([0.08, 0.16, 0.08], 0xb89b53, [-0.28, 0.85, 0.4]));
    parts.push(block([0.08, 0.16, 0.08], 0xb89b53, [0.28, 0.85, -0.4]));
  } else {
    for (let i = 0; i < 6; i++) {
      parts.push(block([0.27, 0.045, 3.66], 0x8f6944, [-1.61 + i * 0.64, 0.075, 0]));
      parts.push(block([0.055, 0.014, 3.66], 0x4c3928, [-1.39 + i * 0.64, 0.067, 0]));
    }
    // Two low wattle sides leave the front and right open for gathering villagers.
    for (let i = 0; i < 9; i++) {
      const a = -1.9 + i * 0.475;
      parts.push(block([0.045, 0.43, 0.045], TREE_TRUNK, [a, 0.275, -1.92]));
      parts.push(block([0.045, 0.43, 0.045], TREE_TRUNK, [-1.92, 0.275, a]));
    }
    for (let i = 0; i < 4; i++) {
      parts.push(block([3.87, 0.03, 0.038], WOOD, [0, 0.16 + i * 0.085, -1.92 + i % 2 * 0.03]));
      parts.push(block([0.038, 0.03, 3.87], WOOD, [-1.92 + i % 2 * 0.03, 0.16 + i * 0.085, 0]));
    }
  }
  const military = kind === 'barracks' || kind === 'archeryRange' || kind === 'stable';
  // Upgraded towers fly their banner from the roof instead of a corner pole.
  if ((military || opts?.color !== undefined) && !(kind === 'watchTower' && tier > 0)) {
    const height =
      kind === 'barracks' ? 3.12
      : kind === 'archeryRange' ? 3.48
      : kind === 'stable' ? 2.82
      : kind === 'watchTower' ? 4.4
      : kind === 'stoneWall' || kind === 'gate' ? 2.1
      : kind === 'palisade' ? 1.8
      : kind === 'farm' ? 0.5
      : kind === 'forge' ? 2.2
      : kind === 'market' ? 2.0
      : kind === 'academy' ? 2.4
      : 1.7;
    const x = w / 2 - 0.38, z = d / 2 - 0.4;
    parts.push(block([0.055, height - 0.06, 0.055], TREE_TRUNK, [x, (height + 0.06) / 2, z]));
    parts.push(block([0.44, military ? 0.58 : 0.25, 0.025], opts?.color ?? 0x9e3b26, [x - 0.24, height - (military ? 0.36 : 0.16), z]));
    parts.push(part(new THREE.OctahedronGeometry(0.055, 0), 0xb89b53, [x, height, z]));
  }
  section(object, kind, parts, modelMaterial());
  fitFootprint(object, kind, anchors);
  return object;
}

/** Four additive, prebuilt stages. setProgress only flips visibility, including on rewind. */
export function foundationModel(kind: BuildingKind, opts?: BuildingModelOptions): { object: THREE.Group; setProgress(p: number): void } {
  const { w, d } = BUILDINGS[kind].size;
  const object = new THREE.Group();
  object.name = `${kind}-foundation`;
  const material = modelMaterial();
  const cleared = [block([w, 0.025, d], 0x9c835c, [0, 0.0125, 0])];
  const plinth: THREE.BufferGeometry[] = [];
  const frame: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    cleared.push(block([w - 0.18, 0.08, 0.1], STONE, [0, 0.065, side * (d / 2 - 0.09)]));
    cleared.push(block([0.1, 0.08, d - 0.18], STONE, [side * (w / 2 - 0.09), 0.065, 0]));
    plinth.push(block([w * 0.74, kind === 'farm' ? 0.04 : 0.3, 0.17], STONE,
      [0, kind === 'farm' ? 0.08 : 0.19, side * d * 0.36]));
    plinth.push(block([0.17, kind === 'farm' ? 0.04 : 0.3, d * 0.74], STONE,
      [side * w * 0.36, kind === 'farm' ? 0.08 : 0.19, 0]));
    for (const end of [-1, 1]) {
      cleared.push(block([0.065, 0.35, 0.065], TREE_TRUNK, [side * (w / 2 - 0.06), 0.2, end * (d / 2 - 0.06)]));
      frame.push(block([0.09, kind === 'farm' ? 0.44 : 1.85, 0.09], TREE_TRUNK,
        [side * w * 0.43, kind === 'farm' ? 0.28 : 0.965, end * d * 0.43]));
    }
    frame.push(block([w * 0.89, 0.08, 0.09], WOOD, [0, kind === 'farm' ? 0.38 : 1.78, side * d * 0.43]));
  }
  if (kind !== 'farm') {
    // The tilted ladder swings past d * 0.42. Pull it in only when a small footprint
    // (a 2×2 wall segment) would otherwise leave the scaffold outside the plan.
    const beamZ = Math.min(d * 0.42, d / 2 - 0.17);
    const ladderZ = Math.min(d * 0.42, d / 2 - 0.2);
    frame.push(block([w * 0.87, 0.06, 0.33], WOOD, [0, 1.02, -beamZ]));
    for (const x of [-0.22, 0.22]) frame.push(block([0.05, 1.45, 0.06], WOOD, [x, 0.75, ladderZ], [-0.2, 0, 0]));
    for (let i = 0; i < 6; i++) frame.push(block([0.48, 0.05, 0.05], WOOD, [0, 0.16 + i * 0.22, ladderZ + 0.12 - i * 0.044]));
  }
  section(object, 'cleared-site', cleared, material);
  section(object, 'low-plinth', plinth, material);
  section(object, 'scaffolding', frame, material);
  const finished = buildingModel(kind, opts);
  finished.name = 'nearly-finished';
  // Share the foundation material, retaining the factory's normal ownership convention.
  const oldMaterials = new Set<THREE.Material>();
  finished.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    oldMaterials.add(child.material as THREE.Material);
    child.material = material;
  });
  for (const old of oldMaterials) old.dispose();
  object.add(finished);
  const stages = object.children;
  function setProgress(p: number): void {
    const progress = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    stages[0].visible = true;
    stages[1].visible = progress >= 0.3;
    stages[2].visible = progress >= 0.6;
    stages[3].visible = progress >= 0.9;
  }
  setProgress(0);
  return { object, setProgress };
}
