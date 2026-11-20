import * as THREE from 'three';
import type { QualityTier } from '../core/quality';
import type { BuildingKind, Vec2 } from '../core/types';
import { currentSettings } from '../game/settings';

export const DUST_SECONDS = 0.9;
const DUST_GEO = new THREE.SphereGeometry(0.35, 5, 4);
DUST_GEO.userData.shared = 1;

export interface DustPuff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  ox: number;
  oz: number;
}

export function dustCount(tier: QualityTier): number {
  return tier === 'low' ? 1 : tier === 'medium' ? 3 : 5;
}

/** Shared by collapsing buildings and completed construction. Materials belong to each puff. */
export function createDust(parent: THREE.Object3D, count: number, size: number): DustPuff[] {
  const dust: DustPuff[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xcbb89a, transparent: true, opacity: 0.4, depthWrite: false });
    const mesh = new THREE.Mesh(DUST_GEO, mat);
    mesh.name = 'dust';
    mesh.userData.noShadow = 1;
    const ox = Math.cos(i / count * Math.PI * 2) * size * 0.28;
    const oz = Math.sin(i / count * Math.PI * 2) * size * 0.28;
    mesh.position.set(ox, 0.4, oz);
    parent.add(mesh);
    dust.push({ mesh, mat, ox, oz });
  }
  return dust;
}

export function updateDust(dust: DustPuff[], age: number, visible: boolean): void {
  const t = age / DUST_SECONDS;
  if (t >= 1) { disposeDust(dust); return; }
  for (const puff of dust) {
    puff.mesh.visible = visible;
    puff.mesh.position.set(puff.ox, 0.35 + t * 1.15, puff.oz);
    puff.mesh.scale.setScalar(0.45 + t * 2.1);
    puff.mat.opacity = (1 - t) * 0.42;
  }
}

export function disposeDust(dust: DustPuff[]): void {
  for (const puff of dust) {
    puff.mesh.visible = false;
    puff.mesh.removeFromParent();
    puff.mat.dispose();
  }
  dust.length = 0;
}

interface ConstructionDust { object: THREE.Group; dust: DustPuff[]; born: number }
interface FallingTree {
  object: THREE.Group;
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  born: number;
  ground: number;
  sink: number;
}

/** Bounded, visual-only work effects. Shared tree geometry/material are never disposed here. */
export class WorkFx {
  readonly object = new THREE.Group();
  private readonly dust: ConstructionDust[] = [];
  private readonly trees: FallingTree[] = [];

  constructor(parent: THREE.Object3D, private readonly tier: QualityTier) {
    this.object.name = 'work-fx';
    parent.add(this.object);
  }

  get active(): boolean { return this.dust.length > 0 || this.trees.length > 0; }

  constructed(kind: BuildingKind, pos: Vec2, ground: number, size: number): void {
    if (currentSettings().reducedMotion) return;
    const wall = kind === 'palisade' || kind === 'stoneWall' || kind === 'gate';
    if (wall && this.tier === 'low') return;
    if (this.dust.length >= 24) this.removeDust(0);
    const object = new THREE.Group();
    object.name = 'construction-dust';
    object.position.set(pos.x, ground, pos.z);
    this.object.add(object);
    this.dust.push({ object, dust: createDust(object, wall ? 1 : dustCount(this.tier), size), born: -1 });
  }

  fell(id: number, base: THREE.Matrix4, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    if (this.tier === 'low' || currentSettings().reducedMotion || this.trees.length >= 6) return;
    const object = new THREE.Group();
    object.name = 'falling-tree';
    const mesh = new THREE.Mesh(geometry, material);
    base.decompose(object.position, mesh.quaternion, mesh.scale);
    object.add(mesh);
    this.object.add(object);
    const angle = (id * 2.399963229728653) % (Math.PI * 2);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.trees.push({ object, mesh, axis: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
      born: -1, ground: object.position.y, sink: (geometry.boundingSphere?.radius ?? 3) * 2 * mesh.scale.y });
  }

  update(time: number, visible: (x: number, z: number) => boolean): void {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const effect = this.dust[i];
      if (effect.born < 0) effect.born = time;
      if (time - effect.born >= DUST_SECONDS || currentSettings().reducedMotion) { this.removeDust(i); continue; }
      updateDust(effect.dust, time - effect.born, visible(effect.object.position.x, effect.object.position.z));
    }
    for (let i = this.trees.length - 1; i >= 0; i--) {
      const tree = this.trees[i];
      if (tree.born < 0) tree.born = time;
      const age = time - tree.born;
      if (age >= 1 || currentSettings().reducedMotion) {
        tree.object.removeFromParent();
        tree.object.remove(tree.mesh);
        this.trees.splice(i, 1);
        continue;
      }
      tree.object.visible = visible(tree.object.position.x, tree.object.position.z);
      tree.object.quaternion.setFromAxisAngle(tree.axis, Math.min(1, age / 0.6) * Math.PI * 85 / 180);
      tree.object.position.y = tree.ground - Math.max(0, (age - 0.6) / 0.4) * tree.sink;
    }
  }

  private removeDust(index: number): void {
    const effect = this.dust[index];
    disposeDust(effect.dust);
    effect.object.removeFromParent();
    this.dust.splice(index, 1);
  }
}
