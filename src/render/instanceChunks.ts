import * as THREE from 'three';
import type { EntityId } from '../core/types';

/** World-unit width of one instanced-mesh chunk. Tight enough for the RTS frustum to drop most of the map. */
export const CHUNK_SIZE = 16;
/**
 * Horizontal distance from the camera to a chunk centre past which the chunk
 * draws its far LOD and casts no shadow.
 */
export const LOD_DISTANCE = 70;

const LOD_DISTANCE_SQ = LOD_DISTANCE * LOD_DISTANCE;
const swap = new THREE.Matrix4();

export function chunkCoord(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
}

export interface ChunkRecord {
  readonly cx: number;
  readonly cz: number;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  readonly ids: EntityId[];
  readonly bases: THREE.Matrix4[];
  readonly indexOf: Map<EntityId, number>;
  farLod: boolean;
}

/**
 * One near and one far InstancedMesh per 16×16 cell.
 * Each mesh keeps its own bounding sphere so the renderer frustum-culls it;
 * `cull` only swaps LOD and shadow flags (visibility stays on so the shadow
 * camera can still draw a near chunk that sits just outside the view).
 */
export class SpatialInstances {
  readonly chunks = new Map<string, ChunkRecord>();
  private readonly idAt = new Map<EntityId, string>();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly nearGeometry: THREE.BufferGeometry,
    private readonly farGeometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    /** Stable prefix, e.g. `tree:0` or `stumps`. Chunk coordinates are appended. */
    readonly label: string,
    private readonly capacity: number,
    private readonly prepare: (mesh: THREE.InstancedMesh) => void,
  ) {}

  get count(): number {
    let n = 0;
    for (const chunk of this.chunks.values()) n += chunk.ids.length;
    return n;
  }

  forEachMesh(fn: (mesh: THREE.InstancedMesh) => void): void {
    for (const chunk of this.chunks.values()) {
      fn(chunk.near);
      fn(chunk.far);
    }
  }

  add(id: EntityId, matrix: THREE.Matrix4): void {
    const { cx, cz } = chunkCoord(matrix.elements[12], matrix.elements[14]);
    const key = `${cx}:${cz}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.createChunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    if (chunk.ids.length >= chunk.near.instanceMatrix.count) this.grow(chunk);
    const index = chunk.ids.length;
    chunk.ids.push(id);
    chunk.indexOf.set(id, index);
    chunk.near.count = chunk.ids.length;
    chunk.far.count = chunk.ids.length;
    chunk.near.setMatrixAt(index, matrix);
    chunk.far.setMatrixAt(index, matrix);
    const base = new THREE.Matrix4().copy(matrix);
    chunk.bases[index] = base;
    chunk.near.instanceMatrix.needsUpdate = true;
    chunk.far.instanceMatrix.needsUpdate = true;
    chunk.near.visible = !chunk.farLod;
    chunk.far.visible = chunk.farLod;
    this.idAt.set(id, key);
    rebound(chunk);
  }

  /** Drop an instance and return its full-scale matrix (fog-safe). */
  remove(id: EntityId): THREE.Matrix4 | null {
    const key = this.idAt.get(id);
    if (key === undefined) return null;
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    const index = chunk.indexOf.get(id);
    if (index === undefined) return null;
    const saved = chunk.bases[index].clone();
    const last = chunk.ids.length - 1;
    if (index !== last) {
      const moved = chunk.ids[last];
      chunk.ids[index] = moved;
      chunk.bases[index] = chunk.bases[last];
      chunk.indexOf.set(moved, index);
      chunk.near.getMatrixAt(last, swap);
      chunk.near.setMatrixAt(index, swap);
      chunk.far.setMatrixAt(index, swap);
    }
    chunk.ids.pop();
    chunk.bases.pop();
    chunk.indexOf.delete(id);
    this.idAt.delete(id);
    chunk.near.count = chunk.ids.length;
    chunk.far.count = chunk.ids.length;
    chunk.near.instanceMatrix.needsUpdate = true;
    chunk.far.instanceMatrix.needsUpdate = true;
    if (chunk.ids.length === 0) {
      chunk.near.visible = false;
      chunk.far.visible = false;
    } else {
      rebound(chunk);
    }
    return saved;
  }

  conceal(hidden: (x: number, z: number) => boolean, pose: THREE.Matrix4, concealMatrix: (base: THREE.Matrix4, concealed: boolean, out: THREE.Matrix4) => THREE.Matrix4): void {
    for (const chunk of this.chunks.values()) {
      for (let i = 0; i < chunk.ids.length; i++) {
        const base = chunk.bases[i];
        const concealed = hidden(base.elements[12], base.elements[14]);
        concealMatrix(base, concealed, pose);
        chunk.near.setMatrixAt(i, pose);
        chunk.far.setMatrixAt(i, pose);
      }
      chunk.near.instanceMatrix.needsUpdate = true;
      chunk.far.instanceMatrix.needsUpdate = true;
    }
  }

  /** Swap far LOD / shadows from the camera. Frustum rejection is the mesh bounding sphere. */
  cull(camX: number, camZ: number, shadows: boolean): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.ids.length === 0) {
        chunk.near.visible = false;
        chunk.far.visible = false;
        continue;
      }
      const dx = camX - (chunk.cx + 0.5) * CHUNK_SIZE;
      const dz = camZ - (chunk.cz + 0.5) * CHUNK_SIZE;
      chunk.farLod = dx * dx + dz * dz > LOD_DISTANCE_SQ;
      this.applyLod(chunk, shadows);
    }
  }

  /** Re-apply shadow flags from the current LOD without moving the camera test. */
  setShadows(shadows: boolean): void {
    for (const chunk of this.chunks.values()) this.applyLod(chunk, shadows);
  }

  private applyLod(chunk: ChunkRecord, shadows: boolean): void {
    chunk.near.visible = chunk.ids.length > 0 && !chunk.farLod;
    chunk.far.visible = chunk.ids.length > 0 && chunk.farLod;
    const cast = shadows && !chunk.farLod && chunk.ids.length > 0;
    chunk.near.castShadow = cast;
    chunk.near.receiveShadow = cast;
    chunk.far.castShadow = false;
    chunk.far.receiveShadow = false;
  }

  private createChunk(cx: number, cz: number): ChunkRecord {
    const near = this.makeMesh(this.nearGeometry, `${this.label}:${cx}:${cz}`, false);
    const far = this.makeMesh(this.farGeometry, `${this.label}:${cx}:${cz}:lod`, true);
    return { cx, cz, near, far, ids: [], bases: [], indexOf: new Map(), farLod: false };
  }

  private makeMesh(geometry: THREE.BufferGeometry, name: string, lod: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = true;
    mesh.visible = !lod;
    mesh.castShadow = !lod;
    mesh.receiveShadow = !lod;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.prepare(mesh);
    this.parent.add(mesh);
    return mesh;
  }

  private grow(chunk: ChunkRecord): void {
    chunk.near = this.replaceMesh(chunk.near);
    chunk.far = this.replaceMesh(chunk.far);
    rebound(chunk);
  }

  private replaceMesh(src: THREE.InstancedMesh): THREE.InstancedMesh {
    const next = new THREE.InstancedMesh(src.geometry, src.material, src.instanceMatrix.count * 2);
    next.name = src.name;
    next.count = src.count;
    next.frustumCulled = true;
    next.visible = src.visible;
    next.castShadow = src.castShadow;
    next.receiveShadow = src.receiveShadow;
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    next.customDepthMaterial = src.customDepthMaterial;
    for (let i = 0; i < src.count; i++) {
      src.getMatrixAt(i, swap);
      next.setMatrixAt(i, swap);
    }
    next.instanceMatrix.needsUpdate = true;
    this.parent.remove(src);
    src.dispose();
    this.prepare(next);
    this.parent.add(next);
    return next;
  }
}

function rebound(chunk: ChunkRecord): void {
  chunk.near.computeBoundingSphere();
  chunk.far.computeBoundingSphere();
}
