import * as THREE from 'three';
import type { CivId } from '../core/civilizations';
import { part, type Triple } from './models';
import { TREE_TRUNK } from './palette';
import { bevelBox, block, gableParts, roofParts } from './props';

/**
 * Upgraded building tiers (M14-4). Each builder returns parts in the same pre-fit coordinates as the
 * tier-0 model in buildings.ts, kept inside the tier-0 bounds so fitting the footprint does not
 * squash the base building. Every upgraded tier carries a small civilisation finial (`civCrest`),
 * so the same tier reads differently per civ on top of the architecture tint.
 */

const STONE = 0xc5bea6;
const WOOD = 0x82603b;
const MASONRY = 0xb7ad92;
const DARK_MASONRY = 0xa79b84;
const LIGHT_STONE = 0xd4ccb4;
const TILE = 0x9d4937;
const GOLD = 0xb89b53;
const BRIGHT_GOLD = 0xd7b251;
const SLIT = 0x3b3328;
const BANNER = 0x9e3b26;

/** Pyramid roof with four faces, rotated so its edges follow a square plan. */
function pyramid(radius: number, height: number, color: number, [x, y, z]: Triple): THREE.BufferGeometry {
  return part(new THREE.ConeGeometry(radius, height, 4), color, [x, y + height / 2, z], [1, 1, 1], [0, Math.PI / 4, 0]);
}

/**
 * A civilisation finial about 0.4·s tall standing on `base`: Hellene akroterion, Roman eagle
 * standard, Persian stepped merlon in glazed blue, Celtic horned post with a round shield.
 */
export function civCrest(civ: CivId | undefined, [x, y, z]: Triple, s = 1): THREE.BufferGeometry[] {
  const at = (dx: number, dy: number, dz = 0): Triple => [x + dx * s, y + dy * s, z + dz * s];
  const sz = (w: number, h: number, d: number): Triple => [w * s, h * s, d * s];
  switch (civ) {
    case 'romans':
      return [
        block(sz(0.035, 0.5, 0.035), TREE_TRUNK, at(0, 0.25)),
        block(sz(0.24, 0.035, 0.035), GOLD, at(0, 0.38)),
        block(sz(0.2, 0.17, 0.02), BANNER, at(0, 0.27)),
        part(new THREE.OctahedronGeometry(0.075 * s, 0), BRIGHT_GOLD, at(0, 0.54), [1.4, 0.8, 0.8]),
      ];
    case 'persians':
      return [
        block(sz(0.3, 0.1, 0.14), 0x2f6c9a, at(0, 0.05)),
        block(sz(0.2, 0.1, 0.14), GOLD, at(0, 0.15)),
        block(sz(0.1, 0.12, 0.14), 0x2f6c9a, at(0, 0.26)),
        block(sz(0.04, 0.06, 0.15), BRIGHT_GOLD, at(0, 0.35)),
      ];
    case 'celts':
      return [
        block(sz(0.08, 0.36, 0.08), TREE_TRUNK, at(0, 0.18)),
        block(sz(0.035, 0.24, 0.035), 0xe2d6b8, at(-0.09, 0.42), [0, 0, 0.55]),
        block(sz(0.035, 0.24, 0.035), 0xe2d6b8, at(0.09, 0.42), [0, 0, -0.55]),
        part(new THREE.CylinderGeometry(0.13 * s, 0.13 * s, 0.03 * s, 6), 0x4f6b3a, at(0, 0.2, 0.06), [1, 1, 1], [Math.PI / 2, 0, 0]),
      ];
    default:
      // Hellenes, and models built without a civilisation (placement ghosts, tests).
      return [
        block(sz(0.18, 0.06, 0.18), LIGHT_STONE, at(0, 0.03)),
        part(new THREE.ConeGeometry(0.1 * s, 0.3 * s, 4), BRIGHT_GOLD, at(0, 0.21)),
        block(sz(0.28, 0.12, 0.03), GOLD, at(0, 0.14)),
      ];
  }
}

/** Large House: wider, two storeys under a steeper roof, with a chimney and shuttered upper windows. */
export function largeHouseParts(seed: number, civ?: CivId): THREE.BufferGeometry[] {
  const wall = 0xe2dbc3;
  const parts: THREE.BufferGeometry[] = [
    block([2.46, 0.3, 2.3], STONE, [0, 0.21, -0.05]),
    part(bevelBox(2.38, 1.15, 2.22), wall, [0, 0.93, -0.05]),
    block([2.46, 0.1, 2.3], WOOD, [0, 1.55, -0.05]),
    part(bevelBox(2.3, 0.95, 2.16), 0xe8e1cc, [0, 2.07, -0.05]),
    ...gableParts(2.3, 2.16, 2.54, 0.78, wall).map(piece => piece.translate(0, 0, -0.05)),
    ...roofParts(2.5, 2.42, 2.54, 0.84, seed % 2 === 0, 3).map(piece => piece.translate(0, 0, -0.05)),
    // Ground floor door and window, then two shuttered upper windows over a timber balcony.
    block([0.56, 1.02, 0.06], TREE_TRUNK, [-0.5, 0.82, 1.08]),
    block([0.46, 0.42, 0.035], 0x423c2e, [0.52, 1.0, 1.075]),
    block([1.9, 0.07, 0.3], WOOD, [0, 1.62, 1.18]),
    block([1.9, 0.22, 0.04], WOOD, [0, 1.77, 1.31]),
  ];
  for (const x of [-0.55, 0.55]) {
    parts.push(block([0.4, 0.4, 0.035], 0x423c2e, [x, 2.1, 1.04]));
    parts.push(block([0.08, 0.46, 0.06], WOOD, [x - 0.24, 2.1, 1.06]));
    parts.push(block([0.08, 0.46, 0.06], WOOD, [x + 0.24, 2.1, 1.06]));
  }
  // Chimney through the roof slope.
  parts.push(block([0.32, 1.25, 0.32], DARK_MASONRY, [0.62, 2.95, -0.55]));
  parts.push(block([0.4, 0.08, 0.4], 0x8f877a, [0.62, 3.6, -0.55]));
  parts.push(...civCrest(civ, [0, 3.36, 1.12], 1));
  return parts;
}

/** Reinforced Palisade: taller sharpened stakes on a stone footing, iron bands and back braces. */
export function reinforcedPalisadeParts(civ?: CivId): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [block([1.86, 0.26, 0.36], DARK_MASONRY, [0, 0.13, 0])];
  for (const x of [-0.72, -0.24, 0.24, 0.72]) {
    parts.push(block([0.18, 1.42, 0.18], TREE_TRUNK, [x, 0.93, 0]));
    parts.push(part(new THREE.ConeGeometry(0.12, 0.3, 4), 0x6a4a28, [x, 1.79, 0], [1, 1, 1], [0, Math.PI / 4, 0]));
  }
  for (const y of [0.62, 1.32]) parts.push(block([1.84, 0.1, 0.22], 0x4a4c50, [0, y, 0]));
  for (const x of [-0.48, 0.48]) parts.push(block([0.08, 1.15, 0.08], WOOD, [x, 0.8, -0.12], [0.45, 0, 0]));
  parts.push(...civCrest(civ, [0, 1.38, 0.08], 0.55));
  return parts;
}

/** Fortified Stone Wall: battered footing, taller courses, a corbelled parapet with slit merlons. */
export function fortifiedWallParts(civ?: CivId): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [
    block([1.9, 0.42, 0.78], DARK_MASONRY, [0, 0.21, 0]),
    block([1.8, 0.5, 0.66], STONE, [0, 0.67, 0]),
    block([1.74, 0.5, 0.6], LIGHT_STONE, [0, 1.17, 0]),
    block([1.8, 0.42, 0.64], STONE, [0, 1.63, 0]),
    block([1.9, 0.12, 0.76], MASONRY, [0, 1.9, 0]),
  ];
  for (const x of [-0.75, 0, 0.75]) parts.push(block([0.14, 0.14, 0.74], DARK_MASONRY, [x, 1.78, 0]));
  for (const x of [-0.7, -0.24, 0.24, 0.7]) {
    parts.push(block([0.32, 0.38, 0.7], MASONRY, [x, 2.15, 0]));
    parts.push(block([0.05, 0.2, 0.72], SLIT, [x, 2.15, 0]));
  }
  parts.push(...civCrest(civ, [0, 1.96, 0.2], 0.55));
  return parts;
}

/**
 * Town Center tiers: 1 Town Hall (roof lantern, portico banners), 2 City Hall (bell tower and a
 * crenellated terrace wall), 3 Imperial Palace (gilded dome and gilded obelisks at the steps).
 */
export function townCenterTierParts(tier: number, color: number, civ?: CivId): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  if (tier <= 0) return parts;
  const wall = 0xe1dac4;
  for (const x of [-1.5, 1.5]) {
    parts.push(block([0.06, 2.6, 0.06], TREE_TRUNK, [x, 1.6, 1.6]));
    parts.push(block([0.04, 0.62, 0.36], color, [x, 2.5, 1.4]));
    parts.push(part(new THREE.OctahedronGeometry(0.06, 0), GOLD, [x, 2.94, 1.6]));
  }
  let top: number;
  if (tier === 1) {
    parts.push(block([0.72, 0.52, 0.72], wall, [0, 3.84, -0.2]));
    for (const x of [-0.2, 0.2]) parts.push(block([0.12, 0.26, 0.03], SLIT, [x, 3.86, 0.17]));
    parts.push(pyramid(0.6, 0.45, TILE, [0, 4.1, -0.2]));
    top = 4.55;
  } else {
    // Bell tower rising from the rear of the hall.
    parts.push(part(bevelBox(0.9, 2.4, 0.9, 0.04), wall, [0, 3.2, -0.75]));
    parts.push(block([1.0, 0.1, 1.0], LIGHT_STONE, [0, 4.42, -0.75]));
    for (const x of [-0.22, 0.22]) parts.push(block([0.14, 0.42, 0.04], SLIT, [x, 4.05, -0.29]));
    // Crenellated terrace wall around the sides and back.
    parts.push(block([3.2, 0.62, 0.16], MASONRY, [0, 0.71, -1.54]));
    for (const x of [-1.54, 1.54]) parts.push(block([0.16, 0.62, 2.4], MASONRY, [x, 0.71, -0.36]));
    for (let i = 0; i < 6; i++) parts.push(block([0.22, 0.18, 0.18], LIGHT_STONE, [-1.35 + i * 0.54, 1.11, -1.54]));
    for (const x of [-1.54, 1.54]) for (let i = 0; i < 4; i++) parts.push(block([0.18, 0.18, 0.22], LIGHT_STONE, [x, 1.11, -1.35 + i * 0.6]));
    if (tier === 2) {
      parts.push(pyramid(0.74, 0.62, TILE, [0, 4.47, -0.75]));
      top = 5.09;
    } else {
      // Imperial Palace: a drum and gilded dome on the tower, gilded obelisks flank the steps.
      parts.push(part(new THREE.CylinderGeometry(0.4, 0.42, 0.3, 8), LIGHT_STONE, [0, 4.62, -0.75]));
      parts.push(part(new THREE.SphereGeometry(0.42, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), BRIGHT_GOLD, [0, 4.77, -0.75]));
      for (const x of [-1.05, 1.05]) {
        parts.push(block([0.26, 0.16, 0.26], DARK_MASONRY, [x, 0.32, 1.78]));
        parts.push(part(new THREE.CylinderGeometry(0.06, 0.1, 1.5, 4), LIGHT_STONE, [x, 1.15, 1.78], [1, 1, 1], [0, Math.PI / 4, 0]));
        parts.push(part(new THREE.ConeGeometry(0.075, 0.18, 4), BRIGHT_GOLD, [x, 1.99, 1.78], [1, 1, 1], [0, Math.PI / 4, 0]));
      }
      for (const x of [-1.25, 1.25]) parts.push(part(new THREE.ConeGeometry(0.1, 0.26, 4), BRIGHT_GOLD, [x, 3.0, 1.62]));
      top = 5.19;
    }
  }
  parts.push(...civCrest(civ, [0, top, tier === 1 ? -0.2 : -0.75], 1));
  return parts;
}

/** Level-2 (Large) military buildings: a stone base plus a second structure for each kind. */
export function militaryLevel2Parts(kind: 'barracks' | 'archeryRange' | 'stable', civ?: CivId): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'barracks') {
    // Stone socle under the hall, a paved drill yard and a crenellated gatehouse tower.
    parts.push(block([3.55, 0.3, 1.62], DARK_MASONRY, [0, 0.15, -1.03]));
    parts.push(block([3.2, 0.04, 1.6], 0xc9c0a6, [0, 0.08, 0.8]));
    parts.push(part(bevelBox(0.78, 2.7, 0.78, 0.04), MASONRY, [-1.38, 1.38, 1.3]));
    parts.push(block([0.88, 0.12, 0.88], LIGHT_STONE, [-1.38, 2.79, 1.3]));
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) parts.push(block([0.2, 0.24, 0.2], MASONRY, [-1.38 + dx, 2.97, 1.3 + dz]));
    for (const y of [1.3, 2.1]) parts.push(block([0.07, 0.3, 0.04], SLIT, [-1.38, y, 1.7]));
    parts.push(...civCrest(civ, [-1.38, 2.85, 1.3], 0.9));
  } else if (kind === 'archeryRange') {
    // Stone base under the hall and a raised clerestory loft along the ridge.
    parts.push(block([3.5, 0.24, 2.3], DARK_MASONRY, [0, 0.12, -0.55]));
    parts.push(block([1.3, 0.6, 2.0], WOOD, [0, 3.0, -0.55]));
    for (const z of [-1.2, -0.55, 0.1]) for (const x of [-0.66, 0.66]) parts.push(block([0.03, 0.26, 0.3], SLIT, [x, 3.02, z]));
    parts.push(...gableParts(1.3, 2.0, 3.3, 0.5, WOOD).map(piece => piece.translate(0, 0, -0.55)));
    parts.push(...roofParts(1.5, 2.1, 3.3, 0.52, true, 2).map(piece => piece.translate(0, 0, -0.55)));
    parts.push(...civCrest(civ, [0, 3.82, 0.4], 0.9));
  } else {
    // Stone base under the stalls and a tall thatched hayloft with bales at the corner.
    parts.push(block([3.5, 0.2, 2.4], DARK_MASONRY, [0, 0.1, -0.55]));
    // Opposite corner from the owner banner, clear of the trough.
    parts.push(block([0.78, 1.9, 0.8], 0xb08a5a, [-1.42, 1.03, 1.32]));
    for (const x of [-1.76, -1.08]) parts.push(block([0.1, 2.0, 0.1], TREE_TRUNK, [x, 1.06, 1.74]));
    parts.push(block([0.4, 0.42, 0.04], 0x3b3328, [-1.42, 1.55, 1.73]));
    parts.push(pyramid(0.7, 0.8, 0xc8a453, [-1.42, 1.98, 1.32]));
    for (let i = 0; i < 2; i++) parts.push(block([0.32, 0.26, 0.26], 0xd6bb69, [-0.8 + i * 0.1, 0.19 + i * 0.26, 1.78]));
    parts.push(...civCrest(civ, [-1.42, 2.78, 1.32], 0.8));
  }
  return parts;
}

/**
 * Scaffold cage around an upgrading building, in fitted (footprint) coordinates: corner poles to
 * just above `top`, ledgers and planks every ~0.9 and a diagonal brace on each side.
 */
export function upgradeScaffoldParts(w: number, d: number, top: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const hw = w / 2 - 0.06, hd = d / 2 - 0.06;
  const height = Math.max(1, top + 0.15);
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) parts.push(block([0.08, height, 0.08], TREE_TRUNK, [x, height / 2, z]));
  const levels = Math.min(5, Math.max(1, Math.round(height / 0.9)));
  for (let i = 1; i <= levels; i++) {
    const y = (i * height) / (levels + 0.25);
    for (const z of [-hd, hd]) {
      parts.push(block([w - 0.06, 0.06, 0.06], WOOD, [0, y, z]));
      parts.push(block([w * 0.86, 0.04, 0.24], 0xb0895a, [0, y + 0.05, z - Math.sign(z) * 0.1]));
    }
    for (const x of [-hw, hw]) parts.push(block([0.06, 0.06, d - 0.06], WOOD, [x, y, 0]));
  }
  const run = w * 0.88, rise = height * 0.8;
  for (const z of [-hd, hd]) parts.push(block([Math.hypot(run, rise), 0.05, 0.05], WOOD, [0, height * 0.42, z], [0, 0, Math.atan2(rise, run)]));
  return parts;
}
