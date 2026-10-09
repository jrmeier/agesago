import * as THREE from 'three';
import type { Quality } from '../core/quality';
import type { PlayerId, Vec2 } from '../core/types';
import { rubbleGeometry } from './modelBridge';

export const CORPSE_SECONDS = 6;
export const RUBBLE_SECONDS = 20;
const COLLAPSE_SECONDS = 0.55;
const DUST_SECONDS = 0.9;

const DUST_GEO = new THREE.SphereGeometry(0.35, 5, 4);
DUST_GEO.userData.shared = 1;

export interface CorpseSource {
  object: THREE.Object3D;
  shadow: THREE.Mesh;
  die(age: number): void;
  setOpacity(opacity: number): void;
}

interface Corpse {
  object: THREE.Object3D;
  shadow: THREE.Mesh;
  die: (age: number) => void;
  setOpacity: (opacity: number) => void;
  born: number;
  owner: PlayerId;
  x: number;
  z: number;
}

interface DustPuff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  ox: number;
  oz: number;
}

interface Rubble {
  object: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  dust: DustPuff[];
  born: number;
  owner: PlayerId;
  x: number;
  z: number;
  ground: number;
  tilt: number;
}

export type ShownFn = (owner: PlayerId, x: number, z: number, rubble: boolean) => boolean;

/**
 * Short-lived stand-ins after the sim deletes a unit or building.
 * Corpses play die/fall and fade over {@link CORPSE_SECONDS}.
 * Rubble settles with a dust puff and fades over {@link RUBBLE_SECONDS}.
 */
export class DeathGhosts {
  readonly object = new THREE.Group();
  private readonly corpses: Corpse[] = [];
  private readonly rubble: Rubble[] = [];
  private readonly dustCount: number;
  private readonly maxCorpses: number;
  private readonly maxRubble: number;
  private shadows = false;

  constructor(parent: THREE.Object3D, quality?: Pick<Quality, 'tier'>) {
    this.object.name = 'deaths';
    const tier = quality?.tier ?? 'medium';
    this.dustCount = tier === 'low' ? 1 : tier === 'medium' ? 3 : 5;
    this.maxCorpses = tier === 'low' ? 10 : tier === 'high' ? 24 : 16;
    this.maxRubble = tier === 'low' ? 4 : tier === 'high' ? 8 : 6;
    parent.add(this.object);
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (let i = 0; i < this.rubble.length; i++) {
      this.rubble[i].mesh.castShadow = on;
      this.rubble[i].mesh.receiveShadow = on;
    }
  }

  addUnit(source: CorpseSource, owner: PlayerId, pos: Vec2, visible: boolean): void {
    if (this.corpses.length >= this.maxCorpses) this.removeCorpse(0);
    sealMaterials(source.object);
    source.shadow.material = (source.shadow.material as THREE.Material).clone();
    source.object.visible = visible;
    source.shadow.visible = visible;
    this.object.add(source.object, source.shadow);
    this.corpses.push({
      object: source.object,
      shadow: source.shadow,
      die: (age) => source.die(age),
      setOpacity: (opacity) => source.setOpacity(opacity),
      born: -1,
      owner,
      x: pos.x,
      z: pos.z,
    });
  }

  addRubble(owner: PlayerId, pos: Vec2, ground: number, size: number, visible: boolean): THREE.Group {
    if (this.rubble.length >= this.maxRubble) this.removeRubble(0);
    const object = new THREE.Group();
    object.name = 'rubble-ghost';
    object.position.set(pos.x, ground, pos.z);
    object.rotation.y = frac(pos.x * 12.9898 + pos.z * 78.233) * Math.PI * 2;
    const mat = new THREE.MeshLambertMaterial({ color: 0x8d8478 });
    const mesh = new THREE.Mesh(rubbleGeometry(size), mat);
    mesh.name = 'rubble';
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    object.add(mesh);
    const dust: DustPuff[] = [];
    for (let i = 0; i < this.dustCount; i++) {
      const puffMat = new THREE.MeshBasicMaterial({
        color: 0xcbb89a,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
      const puff = new THREE.Mesh(DUST_GEO, puffMat);
      puff.name = 'dust';
      puff.userData.noShadow = 1;
      puff.castShadow = false;
      puff.receiveShadow = false;
      const ox = Math.cos((i / this.dustCount) * Math.PI * 2) * size * 0.28;
      const oz = Math.sin((i / this.dustCount) * Math.PI * 2) * size * 0.28;
      puff.position.set(ox, 0.4, oz);
      object.add(puff);
      dust.push({ mesh: puff, mat: puffMat, ox, oz });
    }
    object.visible = visible;
    this.object.add(object);
    this.rubble.push({
      object,
      mesh,
      mat,
      dust,
      born: -1,
      owner,
      x: pos.x,
      z: pos.z,
      ground,
      tilt: 0.25 + frac(pos.x * 4.1 + pos.z) * 0.35,
    });
    return object;
  }

  update(time: number, shown: ShownFn): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const corpse = this.corpses[i];
      if (corpse.born < 0) corpse.born = time;
      const age = time - corpse.born;
      if (age >= CORPSE_SECONDS) {
        this.removeCorpse(i);
        continue;
      }
      const visible = shown(corpse.owner, corpse.x, corpse.z, false);
      corpse.object.visible = visible;
      corpse.shadow.visible = visible;
      corpse.die(age);
      const opacity = 1 - age / CORPSE_SECONDS;
      corpse.setOpacity(opacity);
      const shadowMat = corpse.shadow.material as THREE.MeshBasicMaterial;
      shadowMat.transparent = true;
      shadowMat.opacity = opacity;
    }
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const pile = this.rubble[i];
      if (pile.born < 0) pile.born = time;
      const age = time - pile.born;
      if (age >= RUBBLE_SECONDS) {
        this.removeRubble(i);
        continue;
      }
      const visible = shown(pile.owner, pile.x, pile.z, true);
      pile.object.visible = visible;
      const k = age <= 0 ? 0 : Math.min(1, age / COLLAPSE_SECONDS);
      pile.mesh.position.y = (1 - k) * 1.15;
      pile.mesh.rotation.x = (1 - k) * pile.tilt;
      pile.mesh.rotation.z = (1 - k) * pile.tilt * 0.6;
      const opacity = 1 - age / RUBBLE_SECONDS;
      if (pile.mat.transparent !== opacity < 0.999) {
        pile.mat.transparent = opacity < 0.999;
        pile.mat.depthWrite = opacity >= 0.999;
        pile.mat.needsUpdate = true;
      }
      pile.mat.opacity = opacity;
      const puffT = age / DUST_SECONDS;
      for (let d = 0; d < pile.dust.length; d++) {
        const puff = pile.dust[d];
        const alive = puffT < 1 && visible;
        puff.mesh.visible = alive;
        if (!alive) continue;
        puff.mesh.position.set(puff.ox, 0.35 + puffT * 1.15, puff.oz);
        const spread = 0.45 + puffT * 2.1;
        puff.mesh.scale.setScalar(spread);
        puff.mat.opacity = (1 - puffT) * 0.42;
      }
    }
  }

  private removeCorpse(index: number): void {
    const corpse = this.corpses[index];
    this.object.remove(corpse.object, corpse.shadow);
    disposeMaterials(corpse.object);
    (corpse.shadow.material as THREE.Material).dispose();
    this.corpses.splice(index, 1);
  }

  private removeRubble(index: number): void {
    const pile = this.rubble[index];
    this.object.remove(pile.object);
    pile.mat.dispose();
    for (let i = 0; i < pile.dust.length; i++) pile.dust[i].mat.dispose();
    this.rubble.splice(index, 1);
  }
}

function sealMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.every((mat) => mat.userData.owned === 1)) return;
    const cloned = mats.map((mat) => {
      const copy = mat.clone();
      copy.userData.owned = 1;
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
}

function disposeMaterials(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) mats.add(mat);
    if (mesh.geometry?.userData.dispose === 1) geos.add(mesh.geometry);
  });
  for (const mat of mats) mat.dispose();
  for (const geo of geos) geo.dispose();
}

function frac(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
