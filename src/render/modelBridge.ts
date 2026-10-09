import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UnitKind } from '../core/types';
import {
  createScout,
  createAnimal,
  createVillager,
  type ScoutPose,
  type VillagerCarry,
  type VillagerPose,
} from './models';
import { createSoldier, projectileGeometry as modelProjectile } from './models';
import { rubbleGeometry as propsRubble } from './props';

/**
 * Thin adapter over the Models lane.
 * `createSoldier`, `projectileGeometry` and `rubbleGeometry` may land after this file.
 * Until they exist (or a villager/scout pose is still idle/walk only), placeholders cover them.
 */

export type ProjKind = 'arrow' | 'stone' | 'javelin';

export interface UnitAvatar {
  object: THREE.Object3D;
  setPose(pose: string, time: number, carry?: VillagerCarry | null): void;
  setOpacity(opacity: number): void;
}

interface SoldierModel {
  object: THREE.Group;
  setPose(pose: 'idle' | 'walk' | 'attack' | 'die', t: number, extra?: { progress?: number }): void;
}

/** Seconds a soldier takes to fall when killed. */
const DIE_SECONDS = 1.2;

type SoldierFactory = (kind: UnitKind, opts: { color: number; seed?: number }) => SoldierModel;
type ProjectileFactory = (kind: ProjKind) => THREE.BufferGeometry;
type RubbleFactory = (size: number) => THREE.BufferGeometry;

const PENNANT = new THREE.BoxGeometry(0.2, 0.13, 0.045);
PENNANT.userData.shared = 1;

const BODY_GEO = new THREE.BoxGeometry(0.36, 0.7, 0.22);
const HEAD_GEO = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const WEAPON_GEO = new THREE.BoxGeometry(0.06, 0.72, 0.06);
const HORSE_GEO = new THREE.BoxGeometry(0.38, 0.42, 0.95);
BODY_GEO.userData.shared = 1;
HEAD_GEO.userData.shared = 1;
WEAPON_GEO.userData.shared = 1;
HORSE_GEO.userData.shared = 1;

const SKIN_MAT = new THREE.MeshLambertMaterial({ color: 0xe0c4a0 });
const WOOD_MAT = new THREE.MeshLambertMaterial({ color: 0x6b4630 });
const HORSE_MAT = new THREE.MeshLambertMaterial({ color: 0x8a5a32 });

const ARROW_GEO = new THREE.CylinderGeometry(0.016, 0.016, 0.86, 4);
const JAVELIN_GEO = new THREE.CylinderGeometry(0.028, 0.016, 1.15, 5);
const STONE_GEO = new THREE.DodecahedronGeometry(0.13, 0);
ARROW_GEO.userData.shared = 1;
JAVELIN_GEO.userData.shared = 1;
STONE_GEO.userData.shared = 1;

const projectileCache = new Map<ProjKind, THREE.BufferGeometry>();
const rubbleCache = new Map<string, THREE.BufferGeometry>();
const sizeScratch = new THREE.Vector3();

const PENNANT_Y: Record<UnitKind, number> = {
  villager: 0.92,
  scout: 1.62,
  hoplite: 1.2,
  swordsman: 1.2,
  slinger: 1.12,
  archer: 1.15,
  horseman: 1.7,
  deer: 1.3,
  boar: 0.8,
  sheep: 0.8,
};

function soldierFactory(): SoldierFactory | undefined {
  return createSoldier as unknown as SoldierFactory;
}

function projectileFactory(): ProjectileFactory | undefined {
  return modelProjectile;
}

function rubbleFactory(): RubbleFactory | undefined {
  return propsRubble;
}

function acceptsPose(fn: (...args: never[]) => void, pose: string): boolean {
  const src = Function.prototype.toString.call(fn);
  return src.includes(`'${pose}'`) || src.includes(`"${pose}"`);
}

function markOwned(material: THREE.Material): THREE.Material {
  material.userData.owned = 1;
  return material;
}

function ownTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) mat.userData.owned = 1;
  });
}

function pennant(kind: UnitKind, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(PENNANT, markOwned(new THREE.MeshLambertMaterial({ color })));
  mesh.name = 'player-cloth';
  mesh.position.set(0, PENNANT_Y[kind], -0.2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tag(object: THREE.Object3D, kind: UnitKind, color: number): void {
  object.userData.unitKind = kind;
  object.userData.ownerColor = color;
  object.add(pennant(kind, color));
}

function markDisposableGeos(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.geometry.userData.shared === 1) return;
    mesh.geometry.userData.dispose = 1;
  });
}

function clearRig(object: THREE.Object3D): void {
  const rig = object.getObjectByName('rig');
  if (rig) rig.rotation.x = 0;
}

/** Fallback strike / collapse when the rig has no attack or die pose yet. */
function nudge(object: THREE.Object3D, pose: 'attack' | 'die', time: number): void {
  const rig = object.getObjectByName('rig');
  if (!rig) return;
  if (pose === 'die') {
    rig.rotation.x = -Math.min(Math.PI / 2, time * 2.2);
    return;
  }
  const strike = Math.max(0, Math.sin(time * Math.PI * 3));
  rig.rotation.x = -strike * 0.75;
}

function setTreeOpacity(root: THREE.Object3D, opacity: number): void {
  const transparent = opacity < 0.999;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const colored = mat as THREE.MeshLambertMaterial;
      if (!colored.userData.owned) continue;
      if (colored.transparent !== transparent) {
        colored.transparent = transparent;
        colored.depthWrite = !transparent;
        colored.needsUpdate = true;
      }
      colored.opacity = opacity;
    }
  });
}

function fromVillager(color: number, seed: number): UnitAvatar {
  const model = createVillager({ tunic: color, seed, color } as { tunic?: number; seed?: number });
  tag(model.object, 'villager', color);
  ownTree(model.object);
  markDisposableGeos(model.object);
  const nativeAttack = acceptsPose(model.setPose as (...args: never[]) => void, 'attack');
  const nativeDie = acceptsPose(model.setPose as (...args: never[]) => void, 'die');
  const play = model.setPose as (state: string, t: number, carry?: VillagerCarry | null) => void;
  return {
    object: model.object,
    setPose(pose: string, time: number, carry?: VillagerCarry | null): void {
      model.object.userData.pose = pose;
      if (pose === 'attack' && nativeAttack) {
        play('attack', time, carry ?? null);
        return;
      }
      if (pose === 'die' && nativeDie) {
        play('die', time, null);
        return;
      }
      if (pose === 'attack') {
        play('idle', time, carry ?? null);
        nudge(model.object, 'attack', time);
        return;
      }
      if (pose === 'die') {
        play('idle', time, null);
        nudge(model.object, 'die', time);
        return;
      }
      clearRig(model.object);
      const known: VillagerPose[] = ['idle', 'walk', 'chop', 'forage', 'mine', 'build'];
      const next = (known as string[]).includes(pose) ? (pose as VillagerPose) : 'idle';
      model.setPose(next, time, carry ?? null);
    },
    setOpacity: (opacity) => setTreeOpacity(model.object, opacity),
  };
}

function fromScout(color: number, seed: number): UnitAvatar {
  const model = createScout({ cloak: color, seed, color } as { cloak?: number; seed?: number });
  tag(model.object, 'scout', color);
  ownTree(model.object);
  markDisposableGeos(model.object);
  const nativeAttack = acceptsPose(model.setPose as (...args: never[]) => void, 'attack');
  const nativeDie = acceptsPose(model.setPose as (...args: never[]) => void, 'die');
  const play = model.setPose as (state: string, t: number) => void;
  return {
    object: model.object,
    setPose(pose: string, time: number): void {
      model.object.userData.pose = pose;
      if (pose === 'attack' && nativeAttack) {
        play('attack', time);
        return;
      }
      if (pose === 'die' && nativeDie) {
        play('die', time);
        return;
      }
      if (pose === 'attack') {
        play('idle', time);
        nudge(model.object, 'attack', time);
        return;
      }
      if (pose === 'die') {
        play('idle', time);
        nudge(model.object, 'die', time);
        return;
      }
      clearRig(model.object);
      const next: ScoutPose = pose === 'gallop' || pose === 'walk' || pose === 'idle' ? pose : 'idle';
      model.setPose(next, time);
    },
    setOpacity: (opacity) => setTreeOpacity(model.object, opacity),
  };
}

function fromSoldier(kind: UnitKind, color: number, seed: number, factory: SoldierFactory): UnitAvatar {
  const model = factory(kind, { color, seed });
  if (!model.object.name) model.object.name = kind;
  tag(model.object, kind, color);
  return {
    object: model.object,
    setPose(pose: string, time: number): void {
      model.object.userData.pose = pose;
      const next = pose === 'walk' || pose === 'attack' || pose === 'die' ? pose : 'idle';
      // For 'die', `time` is seconds since death; the model wants fall progress 0..1.
      if (next === 'die') model.setPose('die', time, { progress: Math.min(1, time / DIE_SECONDS) });
      else model.setPose(next, time);
    },
    setOpacity: (opacity) => setTreeOpacity(model.object, opacity),
  };
}

function placeholder(kind: UnitKind, color: number, seed: number): UnitAvatar {
  const object = new THREE.Group();
  object.name = kind;
  const cloth = markOwned(new THREE.MeshLambertMaterial({ color })) as THREE.MeshLambertMaterial;
  const mounted = kind === 'horseman';
  const body = new THREE.Mesh(BODY_GEO, cloth);
  body.name = 'body';
  body.position.y = mounted ? 1.15 : 0.72;
  body.castShadow = true;
  body.receiveShadow = true;
  const head = new THREE.Mesh(HEAD_GEO, SKIN_MAT);
  head.position.y = mounted ? 1.62 : 1.18;
  head.castShadow = true;
  const weapon = new THREE.Mesh(WEAPON_GEO, WOOD_MAT);
  weapon.name = 'weapon';
  weapon.position.set(seed % 2 === 0 ? 0.28 : -0.28, mounted ? 1.2 : 0.85, 0.12);
  weapon.castShadow = true;
  object.add(body, head, weapon);
  let horse: THREE.Mesh | null = null;
  if (mounted) {
    horse = new THREE.Mesh(HORSE_GEO, HORSE_MAT);
    horse.name = 'horse';
    horse.position.y = 0.42;
    horse.castShadow = true;
    object.add(horse);
  }
  tag(object, kind, color);
  const bodyBase = body.position.y;
  return {
    object,
    setPose(pose: string, time: number): void {
      object.userData.pose = pose;
      const bob = pose === 'walk' ? Math.abs(Math.sin(time * 8)) * 0.06 : 0;
      const fallen = pose === 'die' ? Math.min(1, time * 1.6) : 0;
      body.position.y = bodyBase * (1 - fallen * 0.45) + bob;
      body.rotation.x = -fallen * 1.15;
      weapon.rotation.x = pose === 'attack' ? -0.7 - Math.max(0, Math.sin(time * 9)) * 1.05 : pose === 'walk' ? Math.sin(time * 8) * 0.3 : -0.15;
      if (horse) horse.position.y = 0.42 + bob;
    },
    setOpacity: (opacity) => setTreeOpacity(object, opacity),
  };
}

/** Mount one unit. Military kinds use `createSoldier` when the Models lane has exported it. */
export function createUnitAvatar(kind: UnitKind, color: number, seed: number): UnitAvatar {
  if (kind === 'deer' || kind === 'boar' || kind === 'sheep') {
    const model = createAnimal(kind);
    model.object.userData.unitKind = kind;
    return {
      object: model.object,
      setPose(pose, time): void {
        model.object.userData.pose = pose;
        model.setPose(pose === 'walk' || pose === 'attack' || pose === 'die' ? pose : 'idle', time,
          { progress: Math.min(1, time / DIE_SECONDS) });
      },
      setOpacity: (opacity) => setTreeOpacity(model.object, opacity),
    };
  }
  if (kind === 'villager') return fromVillager(color, seed);
  if (kind === 'scout') return fromScout(color, seed);
  const factory = soldierFactory();
  if (factory) return fromSoldier(kind, color, seed, factory);
  return placeholder(kind, color, seed);
}

function alignLongAxisToY(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return;
  const size = box.getSize(sizeScratch);
  if (size.y >= size.x && size.y >= size.z) return;
  if (size.z >= size.x) geo.rotateX(Math.PI / 2);
  else geo.rotateZ(Math.PI / 2);
  geo.computeBoundingBox();
}

/** Arrow / javelin / stone mesh. Long axis is +Y so callers can aim that axis along velocity. */
export function projectileGeometry(kind: ProjKind): THREE.BufferGeometry {
  const cached = projectileCache.get(kind);
  if (cached) return cached;
  const factory = projectileFactory();
  let geo: THREE.BufferGeometry;
  if (factory) {
    geo = factory(kind).clone();
    if (kind !== 'stone') alignLongAxisToY(geo);
  } else if (kind === 'arrow') geo = ARROW_GEO;
  else if (kind === 'javelin') geo = JAVELIN_GEO;
  else geo = STONE_GEO;
  geo.userData.shared = 1;
  projectileCache.set(kind, geo);
  return geo;
}

function makeRubble(size: number): THREE.BufferGeometry {
  const specs: Array<[number, number, number, number, number, number]> = [
    [0.38, 0.16, 0.28, -0.22, 0.08, 0.08],
    [0.24, 0.22, 0.2, 0.26, 0.11, -0.16],
    [0.42, 0.1, 0.16, 0.02, 0.05, 0.24],
    [0.14, 0.26, 0.14, -0.34, 0.13, -0.18],
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const [w, h, d, x, y, z] of specs) {
    const piece = new THREE.BoxGeometry(w * size, h * size, d * size);
    piece.translate(x * size, y * size, z * size);
    parts.push(piece);
  }
  const merged = mergeGeometries(parts, false);
  for (const piece of parts) piece.dispose();
  if (!merged) throw new Error('rubble parts failed to merge');
  merged.computeBoundingSphere();
  return merged;
}

/** Collapsed building mesh, already sized. Shared per quantized size — do not dispose. */
export function rubbleGeometry(size: number): THREE.BufferGeometry {
  const key = size.toFixed(2);
  const cached = rubbleCache.get(key);
  if (cached) return cached;
  const factory = rubbleFactory();
  const geo = factory ? factory(size) : makeRubble(size);
  geo.userData.shared = 1;
  rubbleCache.set(key, geo);
  return geo;
}
