import * as THREE from 'three';
import { BUILDINGS, FARM_FOOD, footprint } from '../core/buildings';
import { SEA_LEVEL, type BuildingKind, type Heightfield, type Vec2 } from '../core/types';
import { buildingModel, foundationModel, modelTier } from './buildings';
import { prefersReducedMotion } from './tiers';

/** Placement ghost tints. Outline uses these directly; the model lerps toward them. */
export const GHOST_VALID = 0x3cba6a;
export const GHOST_INVALID = 0xd24b45;

export const SOIL_TILLED = 0x6a4528;
export const SOIL_FALLOW = 0x8d7048;
export const CROP_RIPE = 0x6f9a3a;
export const CROP_THIN = 0xc6a24a;


const boxCache = new Map<string, THREE.BoxGeometry>();
const BANNER_POLE = new THREE.CylinderGeometry(0.04, 0.05, 1, 5);
const HEARTH_GLOW = new THREE.BoxGeometry(0.5, 0.26, 0.05);
const SMOKE_PUFF = new THREE.IcosahedronGeometry(0.16, 0);
HEARTH_GLOW.userData.shared = 1;
SMOKE_PUFF.userData.shared = 1;
const BANNER_CLOTH = new THREE.BoxGeometry(0.62, 0.34, 0.05);
BANNER_POLE.userData.shared = 1;
BANNER_CLOTH.userData.shared = 1;

export interface BuildingVisual {
  object: THREE.Group;
  /** Stone base → timber frame → finished shell. `complete` shows only the finished model. */
  setProgress(progress: number, complete: boolean): void;
  /** Crop height and colour. `0` is fallow (bare tilled soil). No-op for other kinds. */
  setFarmFood(food: number): void;
  /** Billboard progress bar. Shown while the building is selected or still under construction. */
  setBar(show: boolean, progress: number, camera: THREE.Camera): void;
  /**
   * Swap to the model for an upgrade tier (watch tower 0..2, town centre 0..1) in place.
   * Returns true when meshes were replaced, so the caller can re-apply fog and shadows.
   */
  setTier(tier: number): boolean;
  readonly tier: number;
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

export function createBuildingVisual(kind: BuildingKind, color?: number, tier = 0): BuildingVisual {
  const root = new THREE.Group();
  root.name = kind === 'townCenter' ? 'town-center' : `building:${kind}`;
  let currentTier = modelTier(kind, tier);
  let stages = foundationModel(kind, { tier: currentTier });
  let foundation = stages.object;
  foundation.name = 'foundation';
  ownMaterials(foundation);
  let finished = finishedFor(kind, color, currentTier);
  const bar = progressBar();
  const top = modelTop(finished);
  bar.position.y = top + 0.55;
  root.add(foundation, finished, bar);
  if (color !== undefined) addBanner(root, kind, color);
  let lastProgress = 1;
  let lastComplete = true;

  const crops = finished.getObjectByName('crops');
  const cropMat = (crops?.userData.cropMat as THREE.MeshLambertMaterial | undefined) ?? null;
  const soilMat = (finished.getObjectByName('tilled') as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
  const fill = bar.getObjectByName('progress-fill') as THREE.Mesh;

  const visual: BuildingVisual = {
    object: root,
    get tier(): number {
      return currentTier;
    },
    setTier(next: number): boolean {
      const t = modelTier(kind, next);
      if (t === currentTier) return false;
      currentTier = t;
      root.remove(foundation, finished);
      disposeTree(foundation);
      disposeTree(finished);
      stages = foundationModel(kind, { tier: t });
      foundation = stages.object;
      foundation.name = 'foundation';
      ownMaterials(foundation);
      finished = finishedFor(kind, color, t);
      root.add(foundation, finished);
      bar.position.y = modelTop(finished) + 0.55;
      visual.setProgress(lastProgress, lastComplete);
      return true;
    },
    setProgress(progress: number, complete: boolean): void {
      lastProgress = progress;
      lastComplete = complete;
      const p = complete ? 1 : clamp01(progress);
      const done = complete || p >= 0.999;
      // Staked footprint → plinth → timber frame/scaffold → nearly finished, then the finished model.
      foundation.visible = !done;
      finished.visible = done;
      if (!done) stages.setProgress(p);
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

function finishedFor(kind: BuildingKind, color?: number, tier = 0): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'finished';
  // Farms keep the animated tilled field (crops track food); other kinds use the ancient-world models.
  const model = kind === 'farm' ? farmField() : buildingModel(kind, { seed: 1, color, tier });
  if (kind !== 'farm') ownMaterials(model);
  group.add(model);
  if (kind === 'forge') addForgeEffects(group, model.userData.anchors as Record<string, [number, number, number]> | undefined);
  return group;
}

/**
 * Hearth glow (unlit, so it reads at dusk) and one looping chimney puff. Both animate in
 * onBeforeRender, so an off-screen forge costs nothing; reduced motion holds them still.
 */
function addForgeEffects(group: THREE.Group, anchors?: Record<string, [number, number, number]>): void {
  if (!anchors?.hearth || !anchors.chimney) return;
  const still = prefersReducedMotion();
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
  const glow = new THREE.Mesh(HEARTH_GLOW, glowMat);
  glow.name = 'hearth-glow';
  glow.position.set(...anchors.hearth);
  glow.castShadow = false;
  const hot = new THREE.Color(0xffb04a);
  const warm = new THREE.Color(0xe8611c);
  glow.onBeforeRender = () => {
    if (still) return;
    const t = performance.now() / 1000;
    glowMat.color.copy(warm).lerp(hot, 0.5 + 0.3 * Math.sin(t * 7.3) + 0.2 * Math.sin(t * 13.1));
  };
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xd9d5cc, transparent: true, opacity: 0.45, depthWrite: false });
  const smoke = new THREE.Mesh(SMOKE_PUFF, smokeMat);
  smoke.name = 'chimney-smoke';
  smoke.userData.noShadow = 1;
  smoke.castShadow = smoke.receiveShadow = false;
  const [sx, sy, sz] = anchors.chimney;
  const place = (k: number): void => {
    smoke.position.set(sx + k * 0.25, sy + 0.12 + k * 0.95, sz - k * 0.1);
    smoke.scale.setScalar(0.7 + k * 1.1);
    smokeMat.opacity = 0.5 * (1 - k);
  };
  place(0.3);
  smoke.onBeforeRender = () => {
    if (still) return;
    place(((performance.now() / 1000) / 2.6) % 1);
  };
  group.add(glow, smoke);
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) mat.dispose();
  });
}

/** Cloth banner in the owner's colour. Placement ghosts omit it (no colour passed). */
function addBanner(root: THREE.Group, kind: BuildingKind, color: number): void {
  const { w, d } = BUILDINGS[kind].size;
  const height = kind === 'farm' ? 1.15 : kind === 'townCenter' ? 3.6 : 2.5;
  const banner = new THREE.Group();
  banner.name = 'owner-banner';
  const pole = new THREE.Mesh(BANNER_POLE, new THREE.MeshLambertMaterial({ color: 0x5c4030 }));
  pole.scale.y = height;
  pole.position.y = height / 2;
  pole.castShadow = true;
  pole.receiveShadow = true;
  const cloth = new THREE.Mesh(BANNER_CLOTH, new THREE.MeshLambertMaterial({ color }));
  cloth.name = 'owner-banner-cloth';
  cloth.position.set(0.34, height - 0.28, 0);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  banner.add(pole, cloth);
  banner.position.set(w * 0.32, 0, d * 0.32);
  root.add(banner);
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

function ownMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
    else mesh.material = mesh.material.clone();
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
