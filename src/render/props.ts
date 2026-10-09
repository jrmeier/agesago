import * as THREE from 'three';
import type { PropKind } from '../core/types';
import { TREE_TRUNK, TREE_FOLIAGE, SAND } from './palette';
import { crown, grounded, part, roughen, seededRandom, type Triple } from './models';

const STONE = [0xa6a594, 0xb8b5a2, 0xc9c5b1, 0x969b91];
const PLASTER = 0xe2dbc3;
const CLAY = [0xa95136, 0xbe6944, 0x92432e];
const WOOD = 0x82603b;
const STRAW = 0xc8a453;

/** A small chamfer on every edge, useful for stone, plaster and bundled straw. */
export function bevelBox(w: number, h: number, d: number, bevel = 0.04): THREE.BufferGeometry {
  const b = Math.min(bevel, w / 4, h / 4, d / 4);
  const outline = new THREE.Shape();
  outline.moveTo(-w / 2 + b, -d / 2);
  outline.lineTo(w / 2 - b, -d / 2);
  outline.lineTo(w / 2, -d / 2 + b);
  outline.lineTo(w / 2, d / 2 - b);
  outline.lineTo(w / 2 - b, d / 2);
  outline.lineTo(-w / 2 + b, d / 2);
  outline.lineTo(-w / 2, d / 2 - b);
  outline.lineTo(-w / 2, -d / 2 + b);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: h - 2 * b, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: b / 2, bevelThickness: b,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, h / 2 - b, 0);
  return geometry;
}

/** A coloured rectangular timber or masonry part. */
export function block(size: Triple, color: number, pos: Triple, rotation: Triple = [0, 0, 0]): THREE.BufferGeometry {
  return part(new THREE.BoxGeometry(...size), color, pos, [1, 1, 1], rotation);
}

/** Solid triangular gable ends under a pitched roof. */
export function gableParts(w: number, d: number, y: number, rise: number, color: number): THREE.BufferGeometry[] {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  return [-1, 1].map(side => part(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }),
    color, [0, y, side * d / 2 - 0.03]));
}

/** Pitched roof with individual tile seams or layered straw, ridge caps and eaves. */
export function roofParts(w: number, d: number, y: number, rise: number, thatch = false, rows = 4): THREE.BufferGeometry[] {
  const a = Math.atan2(rise, w / 2);
  const length = Math.hypot(w / 2, rise);
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(block([length, 0.095, d], thatch ? STRAW : CLAY[0], [side * w / 4, y + rise / 2, 0], [0, 0, -side * a]));
    parts.push(block([0.07, 0.14, d + 0.08], TREE_TRUNK, [side * w / 2, y - 0.015, 0]));
    const tiles = thatch ? 4 : 6;
    for (let row = 0; row < rows; row++) {
      const x = (row + 0.5) * w / (2 * rows);
      for (let col = 0; col < tiles; col++) {
        const z = (col + 0.5) * d / tiles - d / 2;
        parts.push(block([length / rows * 0.94, thatch ? 0.065 : 0.035, d / tiles * 0.965],
          thatch ? [STRAW, 0xb69348, 0xd4b667][(row + col) % 3] : CLAY[(row + col) % 3],
          [side * x, y + rise * (1 - x / (w / 2)) + 0.074, z], [0, 0, -side * a]));
      }
    }
  }
  for (let i = 0; i < 7; i++) {
    parts.push(part(new THREE.CylinderGeometry(0.085, 0.085, d / 7 * 0.98, 4), thatch ? 0xa98742 : CLAY[1],
      [0, y + rise + 0.085, (i + 0.5) * d / 7 - d / 2], [1, 1, 1], [Math.PI / 2, 0, 0]));
  }
  return parts;
}

/** Terracotta storage jar with lip, dark opening and loop handles. */
export function amphoraParts(x: number, y: number, z: number, scale = 1): THREE.BufferGeometry[] {
  return [
    part(new THREE.CylinderGeometry(0.1, 0.05, 0.14, 6), CLAY[0], [x, y + 0.07 * scale, z], [scale, scale, scale]),
    part(new THREE.CylinderGeometry(0.075, 0.125, 0.22, 6), CLAY[1], [x, y + 0.25 * scale, z], [scale, scale, scale]),
    part(new THREE.CylinderGeometry(0.05, 0.07, 0.13, 6), CLAY[0], [x, y + 0.42 * scale, z], [scale, scale, scale]),
    part(new THREE.CylinderGeometry(0.064, 0.064, 0.035, 6), 0xcf8158, [x, y + 0.485 * scale, z], [scale, scale, scale]),
    part(new THREE.CircleGeometry(0.046, 6), 0x493623, [x, y + 0.504 * scale, z], [scale, scale, scale], [-Math.PI / 2, 0, 0]),
    ...[-1, 1].map(side => part(new THREE.TorusGeometry(0.065, 0.013, 3, 6), CLAY[0],
      [x + side * 0.092 * scale, y + 0.37 * scale, z], [scale, scale, scale])),
  ];
}

/** A weathered crate with corner battens and a diagonal brace. */
export function crateParts(pos: Triple, size = 0.4): THREE.BufferGeometry[] {
  const [x, y, z] = pos;
  return [
    block([size, size, size], WOOD, [x, y + size / 2, z]),
    ...[-1, 1].map(side => block([0.045, size, size + 0.02], TREE_TRUNK, [x + side * size * 0.4, y + size / 2, z])),
    block([size * 1.2, 0.035, 0.025], 0xb09060, [x, y + size / 2, z + size / 2 + 0.018], [0, 0, 0.7]),
  ];
}

/** Irregular limestone outcrop, with a few mossy facets at its foot. */
export function boulderGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 101);
  return grounded([
    crown(random, STONE[seed % 4], [0, 0.65, 0], [1.12, 0.85, 0.86]),
    crown(random, 0x78816a, [-0.53, 0.14, 0.36], [0.43, 0.18, 0.34]),
    crown(random, STONE[1], [0.56, 0.17, -0.23], [0.46, 0.26, 0.37]),
  ], `boulder-${seed}`);
}

/** Loose stones suitable for paths, shores and ruined settlements. */
export function rocksGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 109);
  return grounded(Array.from({ length: 5 }, (_, i) => {
    const a = i * 2.4;
    const radius = 0.2 + random() * 0.17;
    return crown(random, STONE[i % 4], [Math.sin(a) * 0.48, radius * 0.55, Math.cos(a) * 0.38], [radius, radius * 0.75, radius]);
  }), `rocks-${seed}`);
}

/** An old boundary or votive stone with a chipped crown and carved band. */
export function standingStoneGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 127);
  return grounded([
    part(roughen(new THREE.CylinderGeometry(0.32, 0.46, 1.9, 5), random), STONE[seed % 4], [0, 0.95, 0], [1, 1, 0.65]),
    block([0.28, 0.035, 0.018], 0x76796c, [0, 1.18, 0.265]),
    block([0.035, 0.28, 0.018], 0x76796c, [0, 1.18, 0.266]),
  ], `standing-stone-${seed}`);
}

/** Broken fluted limestone shaft and fallen drums. */
export function ruinColumnGeometry(seed = 1): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.25, 0.29, 1.53, 16);
  const vertices = shaft.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i);
    const flute = 1 - 0.07 * (1 + Math.cos(Math.atan2(z, x) * 8));
    const y = vertices.getY(i);
    vertices.setXYZ(i, x * flute, y > 0 ? y + 0.055 * Math.sin(Math.atan2(z, x) * 3 + seed) : y, z * flute);
  }
  return grounded([
    part(bevelBox(0.8, 0.18, 0.8), STONE[2], [0, 0.09, 0]),
    part(new THREE.CylinderGeometry(0.35, 0.35, 0.13, 8), STONE[1], [0, 0.23, 0]),
    part(shaft, STONE[2], [0, 1.04, 0]),
    part(new THREE.CylinderGeometry(0.25, 0.27, 0.5, 8), STONE[1], [0.73, 0.27, 0.21], [1, 1, 1], [0, seed * 0.4, Math.PI / 2]),
    crown(seededRandom(seed + 131), STONE[0], [-0.44, 0.12, 0.5], [0.24, 0.16, 0.2]),
  ], `ruin-column-${seed}`);
}

/** Staggered masonry courses, with missing blocks and rubble at the broken end. */
export function ruinWallGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 139);
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4 - Math.floor(row / 2); col++) {
      if (row === 3 && col === (seed % 2 ? 2 : 0)) continue;
      parts.push(block([0.58, 0.29, 0.42], STONE[(row + col + seed) % 4],
        [-0.94 + col * 0.62 + row % 2 * 0.17, 0.145 + row * 0.31, 0]));
    }
  }
  for (let i = 0; i < 4; i++) parts.push(crown(random, STONE[i], [0.9 + random() * 0.4, 0.1, (random() - 0.5) * 0.8], [0.19, 0.14, 0.21]));
  return grounded(parts, `ruin-wall-${seed}`);
}

/** Three metres of split rail or woven wattle fencing. */
export function fenceGeometry(seed = 1): THREE.BufferGeometry {
  const parts = [-1.45, 0, 1.45].map(x => part(new THREE.CylinderGeometry(0.055, 0.07, 1, 5), TREE_TRUNK, [x, 0.5, 0]));
  if (seed % 2) {
    for (const y of [0.35, 0.73]) parts.push(block([3, 0.07, 0.07], WOOD, [0, y, 0]));
    parts.push(block([1.5, 0.05, 0.05], WOOD, [-0.75, 0.54, 0.02], [0, 0, 0.22]));
  } else {
    for (let i = 0; i < 12; i++) parts.push(block([0.025, 0.88, 0.026], WOOD, [-1.38 + i * 0.25, 0.46, 0]));
    for (let row = 0; row < 6; row++) parts.push(block([3, 0.035, 0.04], row % 2 ? 0x94764d : WOOD, [0, 0.16 + row * 0.12, row % 2 ? 0.04 : -0.04]));
  }
  return grounded(parts, `fence-${seed}`);
}

/** Tied sheaf stack with straw courses and rope bindings. */
export function hayBaleGeometry(seed = 1): THREE.BufferGeometry {
  return grounded([
    part(bevelBox(1.05, 0.63, 0.7, 0.08), STRAW, [0, 0.315, 0]),
    ...[-0.28, 0.28].map(x => block([0.032, 0.66, 0.73], 0x7d6943, [x, 0.33, 0])),
    ...[0.14, 0.3, 0.46].map(y => block([0.99, 0.017, 0.012], 0xe0c47d, [0, y, 0.366])),
  ], `hay-bale-${seed}`);
}

/** Walk-through six by four metre wheat rows, with individually leaning ears. */
export function wheatFieldGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 149);
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 10; col++) {
      const x = -2.83 + col * 0.625 + (random() - 0.5) * 0.1;
      const z = -1.85 + row * 0.61 + (random() - 0.5) * 0.08;
      const h = 0.64 + random() * 0.24;
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.015, h, 3), 0xaa924d, [x, h / 2, z]));
      parts.push(part(new THREE.OctahedronGeometry(0.085), [STRAW, SAND[0], 0xd6b65d][col % 3],
        [x, h, z], [0.5, 1.8, 0.55], [0, row * 0.7, (random() - 0.5) * 0.35]));
    }
  }
  return grounded(parts, `wheat-field-${seed}`);
}

/** Open stone well ring, timber hoist, rope and bucket. */
export function wellGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 9; i++) {
      const a = (i + row * 0.5) * Math.PI * 2 / 9;
      parts.push(block([0.37, 0.25, 0.22], STONE[(i + row) % 4], [Math.sin(a) * 0.51, 0.125 + row * 0.27, Math.cos(a) * 0.51], [0, a, 0]));
    }
  }
  parts.push(part(new THREE.CircleGeometry(0.42, 9), 0x394d48, [0, 0.03, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]));
  for (const x of [-0.68, 0.68]) parts.push(block([0.1, 1.75, 0.12], TREE_TRUNK, [x, 0.875, 0]));
  parts.push(block([1.55, 0.12, 0.14], WOOD, [0, 1.7, 0]));
  parts.push(part(new THREE.CylinderGeometry(0.055, 0.055, 1.1, 6), WOOD, [0, 1.47, 0], [1, 1, 1], [0, 0, Math.PI / 2]));
  parts.push(block([0.018, 0.85, 0.018], STRAW, [0.04, 1, 0]));
  parts.push(part(new THREE.CylinderGeometry(0.12, 0.09, 0.21, 6), WOOD, [0.04, 0.48, 0]));
  parts.push(part(new THREE.TorusGeometry(0.09, 0.013, 3, 6), 0x60594a, [0.04, 0.64, 0]));
  return grounded(parts, 'well');
}

/** Ancient farmhouse with a rubble plinth, plaster, shutters, storage jars and a tile or thatch roof. */
export function houseGeometry(seed = 1): THREE.BufferGeometry {
  const parts = [part(bevelBox(2.72, 1.85, 3.62), seed % 2 ? PLASTER : STONE[1], [0, 0.925, 0])];
  for (let i = 0; i < 6; i++) {
    parts.push(block([0.44, 0.22, 3.65], STONE[i % 4], [-1.12 + i * 0.45, 0.11, 0]));
  }
  parts.push(...roofParts(3.15, 4.03, 1.88, 0.95, seed % 2 === 0));
  parts.push(...gableParts(2.72, 3.62, 1.85, 0.96, seed % 2 ? PLASTER : STONE[1]));
  parts.push(block([0.65, 1.22, 0.065], TREE_TRUNK, [-0.55, 0.61, 1.835]));
  for (let i = 0; i < 3; i++) parts.push(block([0.016, 1.17, 0.012], WOOD, [-0.75 + i * 0.2, 0.61, 1.875]));
  parts.push(block([0.43, 0.43, 0.025], 0x3b3930, [0.61, 1.16, 1.839]));
  for (const x of [0.35, 0.87]) parts.push(block([0.075, 0.56, 0.065], WOOD, [x, 1.16, 1.858]));
  parts.push(block([0.6, 0.065, 0.1], STONE[2], [0.61, 0.88, 1.86]));
  parts.push(...amphoraParts(1.04, 0, 1.87, 0.8));
  return grounded(parts, `house-${seed}`);
}

/** Two-wheeled timber handcart with open slatted sides and long shafts. */
export function cartGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) parts.push(block([0.17, 0.07, 1.28], WOOD, [-0.38 + i * 0.19, 0.49, -0.25]));
  for (const x of [-0.5, 0.5]) {
    for (const y of [0.65, 0.85]) parts.push(block([0.045, 0.11, 1.3], WOOD, [x, y, -0.25]));
    parts.push(block([0.065, 0.07, 1.8], TREE_TRUNK, [x, 0.41, 0.82], [0.09, 0, 0]));
  }
  parts.push(block([1.34, 0.075, 0.075], TREE_TRUNK, [0, 0.37, -0.25]));
  for (const x of [-0.66, 0.66]) {
    parts.push(part(new THREE.TorusGeometry(0.32, 0.045, 3, 9), TREE_TRUNK, [x, 0.365, -0.25], [1, 1, 1], [0, Math.PI / 2, 0]));
    for (let i = 0; i < 4; i++) parts.push(block([0.04, 0.59, 0.03], WOOD, [x, 0.365, -0.25], [i * Math.PI / 4, 0, 0]));
  }
  return grounded(parts, 'cart');
}

/** Green rushes and ochre seed heads on a shoreline. */
export function reedsGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 157);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const x = (random() - 0.5) * 0.75, z = (random() - 0.5) * 0.65;
    const h = 0.65 + random() * 0.6;
    parts.push(part(new THREE.CylinderGeometry(0.012, 0.018, h, 3), 0x7e9150, [x, h / 2, z]));
    parts.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 4), 0x876039, [x, h - 0.05, z]));
    parts.push(part(new THREE.ConeGeometry(0.06, h * 0.8, 3), 0x657e43, [x + 0.09, h * 0.37, z], [1, 1, 0.2], [0, i, -0.23]));
  }
  return grounded(parts, `reeds-${seed}`);
}

/** Non-harvestable shrub, distinct from the brighter food bushes. */
export function bushGeometry(seed = 1): THREE.BufferGeometry {
  const random = seededRandom(seed + 163);
  return grounded([
    part(new THREE.CylinderGeometry(0.025, 0.07, 0.42, 4), TREE_TRUNK, [0, 0.21, 0]),
    crown(random, TREE_FOLIAGE[0], [-0.26, 0.44, 0], [0.5, 0.39, 0.47]),
    crown(random, TREE_FOLIAGE[1], [0.26, 0.4, 0.07], [0.44, 0.34, 0.5]),
    crown(random, 0x68834b, [0, 0.64, -0.12], [0.41, 0.39, 0.42]),
  ], `bush-${seed}`);
}

/** Fallen trunk with bark ridges, exposed end grain and a snapped branch. */
export function logGeometry(seed = 1): THREE.BufferGeometry {
  const parts = [
    part(new THREE.CylinderGeometry(0.21, 0.24, 1.95, 7), TREE_TRUNK, [0, 0.24, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(0.184, 0.184, 0.018, 7), 0xc4956a, [-0.984, 0.24, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(0.212, 0.212, 0.018, 7), 0xbca477, [0.984, 0.24, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(0.045, 0.09, 0.36, 5), WOOD, [0.2, 0.48, 0.02], [1, 1, 1], [0.3, 0, -0.5]),
  ];
  for (const z of [-0.12, 0, 0.12]) parts.push(block([1.85, 0.022, 0.025], 0x493d29, [0, 0.43 - Math.abs(z) * 0.4, z]));
  return grounded(parts, `log-${seed}`);
}

/** All scenery variants, generated without image assets and ready for instancing. */
export function propGeometries(): Record<PropKind, THREE.BufferGeometry[]> {
  return {
    boulder: [boulderGeometry(1), boulderGeometry(2), boulderGeometry(3)],
    rocks: [rocksGeometry(1), rocksGeometry(2)],
    standingStone: [standingStoneGeometry(1), standingStoneGeometry(2)],
    ruinColumn: [ruinColumnGeometry(1), ruinColumnGeometry(2)],
    ruinWall: [ruinWallGeometry(1), ruinWallGeometry(2)],
    fence: [fenceGeometry(1), fenceGeometry(2)],
    hayBale: [hayBaleGeometry()],
    wheatField: [wheatFieldGeometry(1), wheatFieldGeometry(2)],
    well: [wellGeometry()],
    house: [houseGeometry(1), houseGeometry(2)],
    cart: [cartGeometry()],
    reeds: [reedsGeometry(1), reedsGeometry(2)],
    bush: [bushGeometry(1), bushGeometry(2)],
    log: [logGeometry(1)],
  };
}

/** Collapsed masonry and snapped rafters, grounded inside a destroyed footprint.
 * Accepts either a square width or BUILDINGS[kind].size. Ready for shared/instanced use.
 */
export function rubbleGeometry(size: number | { w: number; d: number }): THREE.BufferGeometry {
  const valid = (n: number): number => Number.isFinite(n) && n > 0 ? n : 4;
  const w = valid(typeof size === 'number' ? size : size.w);
  const d = valid(typeof size === 'number' ? size : size.d);
  const random = seededRandom(307);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4;
    const radius = 0.15 + random() * 0.58;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    const h = 0.13 + (1 - radius) * 0.25;
    parts.push(part(roughen(new THREE.BoxGeometry(0.27, h, 0.25), random), STONE[i % 4],
      [x, h / 2 + (i > 12 ? 0.12 : 0), z], [1, 1, 1], [random() * 0.3, a, random() * 0.4]));
  }
  for (let i = 0; i < 6; i++) {
    parts.push(block([0.09, 0.08, 0.8 + random() * 0.5], i % 2 ? 0x493d29 : WOOD,
      [(random() - 0.5) * 0.9, 0.12 + i * 0.035, (random() - 0.5) * 0.9], [0.12, i * 1.8, 0.14]));
  }
  const geometry = grounded(parts, 'building-rubble');
  const bounds = geometry.boundingBox!.getSize(new THREE.Vector3());
  geometry.scale(w / bounds.x, Math.min(w, d) * 0.16 / bounds.y, d / bounds.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
