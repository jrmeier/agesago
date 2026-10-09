import * as THREE from 'three';
import { SEA_LEVEL, type Heightfield, type PropKind, type PropPlacement } from '../core/types';
import { applyFog, createFogDepthMaterial, isConcealed, matrixForConcealment, type FogOfWar } from './fog';
import { CHUNK_SIZE, chunkCoord, LOD_DISTANCE } from './instanceChunks';
import { impostorBox } from './lod';
import { modelMaterial } from './models';
import { propGeometries } from './props';

const TILTED = new Set<PropKind>(['boulder', 'rocks', 'bush', 'log']);
const UP = new THREE.Vector3(0, 1, 0);
const LOD_DISTANCE_SQ = LOD_DISTANCE * LOD_DISTANCE;

function variantAt(prop: PropPlacement, count: number): number {
  let hash = Math.imul(Math.round(prop.pos.x * 1024), 73856093) ^ Math.imul(Math.round(prop.pos.z * 1024), 19349663);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash >>> 0) % count;
}

interface PropBatch {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  /** Instance matrices as built, before fog zeroes concealed props. */
  base: Float32Array;
  cx: number;
  cz: number;
  farLod: boolean;
}

/**
 * Static scenery batched by kind, variant and 16×16 chunk.
 * Each chunk is its own InstancedMesh pair (full mesh + box impostor) with a bounding
 * sphere so the frustum drops off-screen scenery. `update(camera)` swaps in the impostor
 * past {@link LOD_DISTANCE} and turns shadows off for those chunks.
 */
export class PropsView {
  readonly object = new THREE.Group();
  private readonly material = modelMaterial();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly batches: PropBatch[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly scratch = new THREE.Matrix4();
  private fog: FogOfWar | null = null;
  private fogVersion = -1;
  private depthMaterial: THREE.Material | null = null;
  private shadows = true;

  constructor(hf: Heightfield, props: PropPlacement[]) {
    this.object.name = 'props';
    const geometries = propGeometries();
    const batches = new Map<string, { geometry: THREE.BufferGeometry; placements: PropPlacement[]; cx: number; cz: number; name: string }>();
    for (const prop of props) {
      const variants = geometries[prop.kind];
      const variant = variantAt(prop, variants.length);
      const { cx, cz } = chunkCoord(prop.pos.x, prop.pos.z);
      const name = `${prop.kind}:${variant}:${cx}:${cz}`;
      let batch = batches.get(name);
      if (!batch) {
        batch = { geometry: variants[variant], placements: [], cx, cz, name };
        batches.set(name, batch);
      }
      batch.placements.push(prop);
    }
    const used = new Set([...batches.values()].map((batch) => batch.geometry));
    for (const variants of Object.values(geometries)) {
      for (const geometry of variants) if (!used.has(geometry)) geometry.dispose();
    }
    const dummy = new THREE.Object3D();
    const normal = new THREE.Vector3();
    const yaw = new THREE.Quaternion();
    for (const batch of batches.values()) {
      const near = new THREE.InstancedMesh(batch.geometry, this.material, batch.placements.length);
      const farGeo = impostorBox(batch.geometry);
      const far = new THREE.InstancedMesh(farGeo, this.material, batch.placements.length);
      near.name = batch.name;
      far.name = `${batch.name}:lod`;
      near.castShadow = near.receiveShadow = true;
      far.castShadow = far.receiveShadow = false;
      far.visible = false;
      near.frustumCulled = far.frustumCulled = true;
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
        near.setMatrixAt(i, dummy.matrix);
        far.setMatrixAt(i, dummy.matrix);
      });
      near.instanceMatrix.needsUpdate = true;
      far.instanceMatrix.needsUpdate = true;
      near.computeBoundingSphere();
      far.computeBoundingSphere();
      const base = new Float32Array(near.instanceMatrix.array.length);
      base.set(near.instanceMatrix.array as ArrayLike<number>);
      this.geometries.add(batch.geometry);
      this.geometries.add(farGeo);
      this.batches.push({ near, far, base, cx: batch.cx, cz: batch.cz, farLod: false });
      this.meshes.push(near, far);
      this.object.add(near, far);
    }
  }

  /**
   * Fog scenery and collapse props on unexplored cells to zero scale.
   * Call `syncFog()` after `FogOfWar.update` and before render. onBeforeRender repeats it,
   * but instance matrices are uploaded earlier in the frame, so the explicit call is the one that lands the same frame.
   */
  setFog(fog: FogOfWar): void {
    this.fog = fog;
    if (!this.depthMaterial) {
      applyFog(this.material, fog, { hideUnexplored: true });
      this.depthMaterial = createFogDepthMaterial(fog);
    }
    for (const mesh of this.meshes) this.hook(mesh);
    this.fogVersion = -1;
    this.syncFog();
  }

  /** Rewrite instance scales from the latest visibility grid. No-op until the version changes. */
  syncFog(): void {
    if (!this.fog || this.fog.version === this.fogVersion) return;
    this.fogVersion = this.fog.version;
    const vis = this.fog.visibility;
    for (const batch of this.batches) {
      const { near, far, base } = batch;
      for (let i = 0; i < near.count; i++) {
        this.scratch.fromArray(base, i * 16);
        const concealed = isConcealed(vis, this.scratch.elements[12], this.scratch.elements[14]);
        matrixForConcealment(this.scratch, concealed, this.scratch);
        near.setMatrixAt(i, this.scratch);
        far.setMatrixAt(i, this.scratch);
      }
      near.instanceMatrix.needsUpdate = true;
      far.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Hide the full mesh past ~70 units (show the box impostor, no shadows).
   * Off-screen chunks stay frustum-culled via their bounding spheres either way.
   * Call each frame with the active camera before render.
   */
  update(camera: THREE.Camera): void {
    const camX = camera.position.x;
    const camZ = camera.position.z;
    for (const batch of this.batches) {
      const dx = camX - (batch.cx + 0.5) * CHUNK_SIZE;
      const dz = camZ - (batch.cz + 0.5) * CHUNK_SIZE;
      batch.farLod = dx * dx + dz * dz > LOD_DISTANCE_SQ;
      batch.near.visible = !batch.farLod;
      batch.far.visible = batch.farLod;
      const cast = this.shadows && !batch.farLod;
      batch.near.castShadow = cast;
      batch.near.receiveShadow = cast;
      batch.far.castShadow = false;
      batch.far.receiveShadow = false;
    }
  }

  /** Apply the integrator's quality setting, including shadow-free phones. Far chunks stay unshadowed. */
  setShadows(on: boolean): void {
    this.shadows = on;
    for (const batch of this.batches) {
      const cast = on && !batch.farLod;
      batch.near.castShadow = batch.near.receiveShadow = cast;
      batch.far.castShadow = batch.far.receiveShadow = false;
    }
  }

  /** Release instance buffers, generated geometry and the shared material. */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.depthMaterial?.dispose();
    this.object.clear();
    this.meshes.length = 0;
    this.batches.length = 0;
    this.geometries.clear();
  }

  private hook(mesh: THREE.InstancedMesh): void {
    if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial;
    if (mesh.userData.agFogHook) return;
    mesh.userData.agFogHook = 1;
    mesh.onBeforeRender = () => this.syncFog();
  }
}
