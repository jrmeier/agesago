import * as THREE from 'three';
import { TREE_FOLIAGE, TREE_TRUNK } from './palette';
import { grounded, part } from './models';
import * as models from './models';

/**
 * Far-chunk stand-ins. The models lane owns the full meshes; these stay here so
 * culling can ship before `stoneQuarryGeometry` / building models land.
 * A cross-quad would need a double-sided material, and every instance shares
 * `modelMaterial()` (front side, vertex colours), so the tree impostor is a
 * 4-side trunk plus a 5-side cone instead.
 */

let treeLod: THREE.BufferGeometry | null = null;
let berryLod: THREE.BufferGeometry | null = null;
let goldLod: THREE.BufferGeometry | null = null;
let stoneLod: THREE.BufferGeometry | null = null;
let stoneNear: THREE.BufferGeometry | null = null;
const quarryExport = 'stoneQuarryGeometry';

export function treeLodGeometry(): THREE.BufferGeometry {
  if (!treeLod) {
    treeLod = grounded(
      [
        part(new THREE.CylinderGeometry(0.1, 0.18, 1.35, 4, 1, true), TREE_TRUNK, [0, 0.68, 0]),
        part(new THREE.ConeGeometry(0.9, 2.15, 5), TREE_FOLIAGE[1], [0, 2.15, 0]),
      ],
      'tree-lod',
    );
  }
  return treeLod;
}

export function berryLodGeometry(): THREE.BufferGeometry {
  if (!berryLod) {
    berryLod = grounded(
      [part(new THREE.OctahedronGeometry(0.42), 0x6f9e44, [0, 0.36, 0]), part(new THREE.OctahedronGeometry(0.09), 0xc74432, [0.16, 0.48, 0.12])],
      'berry-lod',
    );
  }
  return berryLod;
}

export function goldLodGeometry(): THREE.BufferGeometry {
  if (!goldLod) {
    goldLod = grounded(
      [
        part(new THREE.OctahedronGeometry(0.34), 0x787569, [0, 0.22, 0]),
        part(new THREE.OctahedronGeometry(0.16), 0xf0c84a, [0.12, 0.38, 0.06]),
      ],
      'gold-lod',
    );
  }
  return goldLod;
}

export function stoneLodGeometry(): THREE.BufferGeometry {
  if (!stoneLod) {
    stoneLod = grounded([part(new THREE.BoxGeometry(0.85, 0.45, 0.7), 0xb7b2a4, [0, 0.22, 0])], 'stone-lod');
  }
  return stoneLod;
}

/** Near stone quarry. Uses `stoneQuarryGeometry` once the models lane exports it. */
export function stoneNodeGeometry(): THREE.BufferGeometry {
  if (!stoneNear) stoneNear = loadStoneQuarry();
  return stoneNear;
}

function loadStoneQuarry(): THREE.BufferGeometry {
  const fn = (models as Record<string, unknown>)[quarryExport];
  if (typeof fn === 'function') {
    const geo = (fn as () => unknown)();
    if (geo instanceof THREE.BufferGeometry) {
      if (geo.boundingBox === null) geo.computeBoundingBox();
      if (geo.boundingSphere === null) geo.computeBoundingSphere();
      return geo;
    }
  }
  return grounded(
    [
      part(new THREE.BoxGeometry(0.95, 0.42, 0.72), 0xb7b2a4, [0, 0.21, 0]),
      part(new THREE.BoxGeometry(0.55, 0.38, 0.48), 0x9c978c, [0.32, 0.19, 0.16]),
      part(new THREE.BoxGeometry(0.38, 0.55, 0.36), 0xd0cbbd, [-0.28, 0.28, -0.12]),
      part(new THREE.BoxGeometry(0.7, 0.06, 0.04), 0x8a8476, [0.02, 0.44, 0.2]),
    ],
    'stone-quarry',
  );
}

const impostors = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Axis-aligned box in the source geometry's local frame, coloured with its average vertex colour. */
export function impostorBox(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = impostors.get(source);
  if (cached) return cached;
  if (source.boundingBox === null) source.computeBoundingBox();
  const bounds = source.boundingBox!;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  const box = new THREE.BoxGeometry(Math.max(size.x, 0.08), Math.max(size.y, 0.08), Math.max(size.z, 0.08));
  const colored = part(box, averageColor(source), [center.x, center.y, center.z]);
  colored.name = `${source.name || 'prop'}-lod`;
  colored.computeBoundingSphere();
  impostors.set(source, colored);
  return colored;
}

function averageColor(geometry: THREE.BufferGeometry): number {
  const attr = geometry.getAttribute('color');
  if (!attr || attr.count === 0) return 0x9a8f78;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < attr.count; i++) {
    r += attr.getX(i);
    g += attr.getY(i);
    b += attr.getZ(i);
  }
  const n = attr.count;
  return new THREE.Color(r / n, g / n, b / n).getHex();
}
