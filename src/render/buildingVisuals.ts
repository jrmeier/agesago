import * as THREE from 'three';
import { BUILDINGS, FARM_FOOD, footprint } from '../core/buildings';
import { SEA_LEVEL, type BuildingKind, type Heightfield, type Vec2 } from '../core/types';
import { buildTownCenter } from './buildings';
import * as models from './models';

/** Placement ghost tints. Outline uses these directly; the model lerps toward them. */
export const GHOST_VALID = 0x3cba6a;
export const GHOST_INVALID = 0xd24b45;

export const SOIL_TILLED = 0x6a4528;
export const SOIL_FALLOW = 0x8d7048;
export const CROP_RIPE = 0x6f9a3a;
export const CROP_THIN = 0xc6a24a;

const FRAME_AT = 1 / 3;
const SHELL_AT = 2 / 3;
const LIMESTONE = 0xe1dac4;
const TERRACOTTA = 0x9d4937;
const TIMBER = 0x6b4630;

const boxCache = new Map<string, THREE.BoxGeometry>();

export interface BuildingVisual {
  object: THREE.Group;
  /** Stone base → timber frame → finished shell. `complete` shows only the finished model. */
  setProgress(progress: number, complete: boolean): void;
  /** Crop height and colour. `0` is fallow (bare tilled soil). No-op for other kinds. */
  setFarmFood(food: number): void;
  /** Billboard progress bar. Shown while the building is selected or still under construction. */
  setBar(show: boolean, progress: number, camera: THREE.Camera): void;
}

/** Lowest terrain sample under the rotated footprint, clamped to sea level. */
export function footprintMinY(hf: Heightfield, kind: BuildingKind, pos: Vec2, rot: number): number {
  const { w, d } = BUILDINGS[kind].size;
  const hw = w / 2;
  const hd = d / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  let min = Infinity;
  for (const lx of [-hw, 0, hw]) {
    for (const lz of [-hd, 0, hd]) {
      const x = pos.x + lx * cos - lz * sin;
      const z = pos.z + lx * sin + lz * cos;
      const y = Math.max(hf.heightAt(x, z), SEA_LEVEL);
      if (y < min) min = y;
    }
  }
  return min === Infinity ? SEA_LEVEL : min;
}

export function createBuildingVisual(kind: BuildingKind): BuildingVisual {
  const root = new THREE.Group();
  root.name = kind === 'townCenter' ? 'town-center' : `building:${kind}`;
  const foundation = foundationFor(kind);
  const scaffold = scaffoldFor(kind);
  const finished = finishedFor(kind);
  const bar = progressBar();
  const top = modelTop(finished);
  bar.position.y = top + 0.55;
  root.add(foundation, scaffold, finished, bar);

  const crops = finished.getObjectByName('crops');
  const cropMat = (crops?.userData.cropMat as THREE.MeshLambertMaterial | undefined) ?? null;
  const soilMat = (finished.getObjectByName('tilled') as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
  const fill = bar.getObjectByName('progress-fill') as THREE.Mesh;

  const visual: BuildingVisual = {
    object: root,
    setProgress(progress: number, complete: boolean): void {
      const p = complete ? 1 : clamp01(progress);
      const done = complete || p >= 0.999;
      foundation.visible = !done;
      scaffold.visible = !done && p >= FRAME_AT;
      finished.visible = done || p >= SHELL_AT;
      if (foundation.visible) foundation.scale.y = 0.08 + 0.92 * Math.min(1, p / FRAME_AT);
      else foundation.scale.y = 1;
      if (scaffold.visible) scaffold.scale.y = 0.08 + 0.92 * Math.min(1, (p - FRAME_AT) / (SHELL_AT - FRAME_AT));
      else scaffold.scale.y = 1;
      if (finished.visible) setOpacity(finished, done ? 1 : 0.2 + 0.8 * Math.min(1, (p - SHELL_AT) / (1 - SHELL_AT)));
    },
    setFarmFood(food: number): void {
      if (!crops || !cropMat) return;
      const t = clamp01(food / FARM_FOOD);
      crops.visible = t > 0.02;
      crops.scale.y = Math.max(0.04, t);
      cropMat.color.setHex(t > 0.35 ? CROP_RIPE : CROP_THIN);
      soilMat?.color.setHex(t > 0.02 ? SOIL_TILLED : SOIL_FALLOW);
    },
    setBar(show: boolean, progress: number, camera: THREE.Camera): void {
      bar.visible = show;
      if (!show) return;
      const t = Math.max(0.001, clamp01(progress));
      fill.scale.x = t;
      fill.position.x = -(1.15 / 2) * (1 - t);
      bar.lookAt(camera.position);
      bar.rotateY(Math.PI);
    },
  };
  visual.setProgress(1, true);
  return visual;
}

/** Translucent finished model plus a ground footprint outline. Cached by the caller per kind. */
export function createGhost(kind: BuildingKind): THREE.Group {
  const ghost = new THREE.Group();
  ghost.name = 'placement-ghost';
  const visual = createBuildingVisual(kind);
  visual.setProgress(1, true);
  const model = visual.object;
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noShadow = 1;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const lambert = mat as THREE.MeshLambertMaterial;
      lambert.userData.baseColor = lambert.color?.getHex?.() ?? 0xffffff;
      lambert.transparent = true;
      lambert.opacity = 0.48;
      lambert.depthWrite = false;
    }
  });
  const bar = model.getObjectByName('progress');
  if (bar) bar.visible = false;
  ghost.add(model);
  ghost.add(footprintOutline(kind));
  tintGhost(ghost, true);
  return ghost;
}

export function tintGhost(ghost: THREE.Group, valid: boolean): void {
  const tint = new THREE.Color(valid ? GHOST_VALID : GHOST_INVALID);
  ghost.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const colored = mat as THREE.MeshLambertMaterial;
      if (!colored.color) continue;
      if (mesh.name === 'footprint') {
        colored.color.copy(tint);
        continue;
      }
      const baseHex = colored.userData.baseColor as number | undefined;
      const base = new THREE.Color(baseHex ?? colored.color.getHex());
      colored.color.copy(base).lerp(tint, 0.62);
    }
  });
}

function finishedFor(kind: BuildingKind): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'finished';
  if (kind === 'farm') {
    group.add(farmField());
    const custom = optionalObject('buildingModel', kind);
    if (custom) group.add(custom);
    return group;
  }
  const custom = optionalObject('buildingModel', kind);
  if (custom) {
    ownMaterials(custom);
    group.add(custom);
    return group;
  }
  if (kind === 'townCenter') {
    const tc = buildTownCenter(0);
    ownMaterials(tc);
    group.add(tc);
    return group;
  }
  group.add(placeholderBuilding(kind));
  return group;
}

function foundationFor(kind: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  group.name = 'foundation';
  const custom = optionalObject('foundationModel', kind);
  if (custom) {
    ownMaterials(custom);
    group.add(custom);
    return group;
  }
  const { w, d } = BUILDINGS[kind].size;
  const dirt = kind === 'farm';
  const h = dirt ? 0.08 : 0.22;
  group.add(meshBox(w * 0.98, h, d * 0.98, dirt ? SOIL_TILLED : LIMESTONE, 0, h / 2, 0));
  return group;
}

function scaffoldFor(kind: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scaffold';
  const custom = optionalObject('scaffoldingModel', kind) ?? optionalObject('scaffoldModel', kind);
  if (custom) {
    ownMaterials(custom);
    group.add(custom);
    return group;
  }
  const { w, d } = BUILDINGS[kind].size;
  const h = kind === 'farm' ? 0.55 : kind === 'townCenter' ? 3.2 : 2.05;
  const insetX = w / 2 - 0.14;
  const insetZ = d / 2 - 0.14;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(meshBox(0.08, h, 0.08, TIMBER, sx * insetX, h / 2, sz * insetZ));
    }
  }
  group.add(meshBox(w - 0.2, 0.06, 0.06, TIMBER, 0, h, insetZ));
  group.add(meshBox(w - 0.2, 0.06, 0.06, TIMBER, 0, h, -insetZ));
  group.add(meshBox(0.06, 0.06, d - 0.2, TIMBER, insetX, h, 0));
  group.add(meshBox(0.06, 0.06, d - 0.2, TIMBER, -insetX, h, 0));
  return group;
}

function placeholderBuilding(kind: BuildingKind): THREE.Group {
  const { w, d } = BUILDINGS[kind].size;
  const group = new THREE.Group();
  group.name = `placeholder:${kind}`;
  if (kind === 'house') {
    group.add(meshBox(w * 0.82, 1.45, d * 0.82, LIMESTONE, 0, 0.84, 0));
    group.add(meshBox(w * 0.92, 0.32, d * 0.92, TERRACOTTA, 0, 1.68, 0));
    group.add(meshBox(0.46, 0.9, 0.08, TIMBER, 0, 0.48, d * 0.42));
    return group;
  }
  if (kind === 'granary') {
    group.add(meshBox(0.12, 0.7, 0.12, TIMBER, -w * 0.28, 0.35, -d * 0.28));
    group.add(meshBox(0.12, 0.7, 0.12, TIMBER, w * 0.28, 0.35, -d * 0.28));
    group.add(meshBox(0.12, 0.7, 0.12, TIMBER, -w * 0.28, 0.35, d * 0.28));
    group.add(meshBox(0.12, 0.7, 0.12, TIMBER, w * 0.28, 0.35, d * 0.28));
    group.add(meshBox(w * 0.86, 1.15, d * 0.86, 0xc4a46a, 0, 1.35, 0));
    group.add(meshBox(w * 0.96, 0.22, d * 0.96, TERRACOTTA, 0, 2.0, 0));
    return group;
  }
  if (kind === 'miningCamp') {
    group.add(meshBox(0.1, 1.5, 0.1, TIMBER, -w * 0.32, 0.75, d * 0.32));
    group.add(meshBox(0.1, 1.5, 0.1, TIMBER, w * 0.32, 0.75, d * 0.32));
    group.add(meshBox(0.1, 1.5, 0.1, TIMBER, -w * 0.32, 0.75, -d * 0.28));
    group.add(meshBox(0.1, 1.5, 0.1, TIMBER, w * 0.32, 0.75, -d * 0.28));
    group.add(meshBox(w * 0.9, 0.12, d * 0.9, 0x8a5a32, 0, 1.55, 0));
    group.add(meshBox(0.7, 0.4, 0.55, 0xb7b2a4, -0.35, 0.22, -0.2));
    return group;
  }
  // storehouse (and any future kind): timber barn
  group.add(meshBox(w * 0.88, 1.35, d * 0.88, 0x8d5a32, 0, 0.78, 0));
  group.add(meshBox(w * 0.98, 0.28, d * 0.98, 0x6e4428, 0, 1.55, 0));
  group.add(meshBox(0.7, 0.85, 0.08, 0x4e3424, 0, 0.48, d * 0.45));
  return group;
}

function farmField(): THREE.Group {
  const { w, d } = BUILDINGS.farm.size;
  const field = new THREE.Group();
  field.name = 'field';
  const soil = meshBox(w * 0.96, 0.1, d * 0.96, SOIL_TILLED, 0, 0.05, 0);
  soil.name = 'tilled';
  field.add(soil);
  for (let i = -3; i <= 3; i++) {
    field.add(meshBox(w * 0.9, 0.025, 0.06, 0x4e331c, 0, 0.11, i * 0.42));
  }
  const crops = new THREE.Group();
  crops.name = 'crops';
  crops.position.y = 0.12;
  const cropMat = new THREE.MeshLambertMaterial({ color: CROP_RIPE });
  crops.userData.cropMat = cropMat;
  const rowH = 0.55;
  const rowKey = `${(w * 0.88).toFixed(3)},${rowH.toFixed(3)},0.220`;
  let rowGeo = boxCache.get(rowKey);
  if (!rowGeo) {
    rowGeo = new THREE.BoxGeometry(w * 0.88, rowH, 0.22);
    boxCache.set(rowKey, rowGeo);
  }
  for (let i = -3; i <= 3; i++) {
    const row = new THREE.Mesh(rowGeo, cropMat);
    row.position.set(0, rowH / 2, i * 0.42);
    row.castShadow = true;
    row.receiveShadow = true;
    crops.add(row);
  }
  field.add(crops);
  return field;
}

function footprintOutline(kind: BuildingKind): THREE.Mesh {
  const { hw, hd } = footprint(kind, 0);
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo(hw, -hd);
  shape.lineTo(hw, hd);
  shape.lineTo(-hw, hd);
  const hole = new THREE.Path();
  const t = 0.08;
  hole.moveTo(-hw + t, -hd + t);
  hole.lineTo(-hw + t, hd - t);
  hole.lineTo(hw - t, hd - t);
  hole.lineTo(hw - t, -hd + t);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: GHOST_VALID,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = 'footprint';
  mesh.position.y = 0.08;
  mesh.userData.noShadow = 1;
  mesh.renderOrder = 4;
  return mesh;
}

function progressBar(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'progress';
  group.visible = false;
  group.userData.noShadow = 1;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x2c2418, transparent: true, opacity: 0.88, depthWrite: false }),
  );
  bg.name = 'progress-bg';
  bg.userData.noShadow = 1;
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.14),
    new THREE.MeshBasicMaterial({ color: 0xd7a441, depthWrite: false }),
  );
  fill.name = 'progress-fill';
  fill.position.z = 0.02;
  fill.userData.noShadow = 1;
  group.add(bg, fill);
  return group;
}

function meshBox(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
  let geo = boxCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, geo);
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function optionalObject(name: string, kind: BuildingKind): THREE.Object3D | null {
  const fn = (models as Record<string, unknown>)[name];
  if (typeof fn !== 'function') return null;
  const result = (fn as (kind: BuildingKind) => unknown)(kind);
  return result instanceof THREE.Object3D ? result : null;
}

function ownMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
    else mesh.material = mesh.material.clone();
  });
}

function setOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.depthWrite = opacity >= 0.999;
    }
  });
}

function modelTop(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  return Number.isFinite(bounds.max.y) ? bounds.max.y : 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
