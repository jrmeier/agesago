import * as THREE from 'three';
import { SEA_LEVEL, type Heightfield, type PropKind, type PropPlacement } from '../core/types';
import { modelMaterial } from './models';
import { propGeometries } from './props';

const TILTED = new Set<PropKind>(['boulder', 'rocks', 'bush', 'log']);
const UP = new THREE.Vector3(0, 1, 0);

function variantAt(prop: PropPlacement, count: number): number {
  let hash = Math.imul(Math.round(prop.pos.x * 1024), 73856093) ^ Math.imul(Math.round(prop.pos.z * 1024), 19349663);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash >>> 0) % count;
}

/** Static scenery batched by kind and stable position-based variant. */
export class PropsView {
  readonly object = new THREE.Group();
  private readonly material = modelMaterial();
  private readonly meshes: THREE.InstancedMesh[] = [];

  constructor(hf: Heightfield, props: PropPlacement[]) {
    this.object.name = 'props';
    const geometries = propGeometries();
    const batches = new Map<string, { geometry: THREE.BufferGeometry; placements: PropPlacement[] }>();
    for (const prop of props) {
      const variants = geometries[prop.kind];
      const variant = variantAt(prop, variants.length);
      const key = `${prop.kind}:${variant}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { geometry: variants[variant], placements: [] };
        batches.set(key, batch);
      }
      batch.placements.push(prop);
    }
    const used = new Set([...batches.values()].map(batch => batch.geometry));
    for (const variants of Object.values(geometries)) {
      for (const geometry of variants) if (!used.has(geometry)) geometry.dispose();
    }
    const dummy = new THREE.Object3D();
    const normal = new THREE.Vector3();
    const yaw = new THREE.Quaternion();
    for (const [key, batch] of batches) {
      const mesh = new THREE.InstancedMesh(batch.geometry, this.material, batch.placements.length);
      mesh.name = key;
      mesh.castShadow = mesh.receiveShadow = true;
      batch.placements.forEach((prop, i) => {
        const { x, z } = prop.pos;
        dummy.position.set(x, Math.max(hf.heightAt(x, z), SEA_LEVEL), z);
        dummy.quaternion.identity();
        if (TILTED.has(prop.kind) && !hf.isWater(x, z)) {
          const x0 = Math.max(0, x - 0.35), x1 = Math.min(hf.width, x + 0.35);
          const z0 = Math.max(0, z - 0.35), z1 = Math.min(hf.depth, z + 0.35);
          const dx = (hf.heightAt(x1, z) - hf.heightAt(x0, z)) / Math.max(0.001, x1 - x0);
          const dz = (hf.heightAt(x, z1) - hf.heightAt(x, z0)) / Math.max(0.001, z1 - z0);
          normal.set(-dx, 1, -dz).normalize();
          dummy.quaternion.setFromUnitVectors(UP, normal);
          const angle = dummy.quaternion.angleTo(new THREE.Quaternion());
          if (angle > 0.18) dummy.quaternion.slerp(new THREE.Quaternion(), 1 - 0.18 / angle);
        }
        yaw.setFromAxisAngle(UP, prop.rot);
        dummy.quaternion.multiply(yaw);
        dummy.scale.setScalar(prop.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.object.add(mesh);
    }
  }

  /** Apply the integrator's quality setting, including shadow-free phones. */
  setShadows(on: boolean): void {
    for (const mesh of this.meshes) mesh.castShadow = mesh.receiveShadow = on;
  }

  /** Release instance buffers, generated geometry and the shared material. */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      mesh.geometry.dispose();
    }
    this.material.dispose();
    this.object.clear();
  }
}
