import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GRASS_ONLY, type Heightfield } from '../core/types';
import { generateMap } from '../sim/mapgen';
import { World } from '../sim/World';
import { EntityViews } from './EntityViews';
import { CHUNK_SIZE, LOD_DISTANCE } from './instanceChunks';
import { PropsView } from './PropsView';

function installCanvasMock(): void {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  const ctx: object = new Proxy(function () {}, {
    apply: () => ctx,
    get: (_target, prop) => (prop === 'data' ? data : ctx),
  });
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
}

function field(): Heightfield {
  return {
    width: 176,
    depth: 176,
    heightAt: () => 1,
    isWater: () => false,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function rtsCamera(hf: Heightfield, x: number, z: number, aspect = 16 / 9, distance = 26): THREE.PerspectiveCamera {
  const pitch = (52 * Math.PI) / 180;
  const focusY = Math.max(hf.heightAt(x, z), 0);
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 400);
  camera.position.set(x, focusY + Math.sin(pitch) * distance, z + Math.cos(pitch) * distance);
  camera.position.x = Math.min(hf.width, Math.max(0, camera.position.x));
  camera.position.z = Math.min(hf.depth, Math.max(0, camera.position.z));
  const floor = Math.max(hf.heightAt(camera.position.x, camera.position.z), 0) + 2;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(x, focusY, z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function frustumOf(camera: THREE.Camera): THREE.Frustum {
  camera.updateMatrixWorld();
  const proj = camera.projectionMatrix;
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  const screen = new THREE.Matrix4().multiplyMatrices(proj, camera.matrixWorldInverse);
  return new THREE.Frustum().setFromProjectionMatrix(screen);
}

function triCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.index;
  const corners = index ? index.count : geometry.getAttribute('position').count;
  return corners / 3;
}

/** Triangles a single unchunked draw would submit, versus meshes the RTS camera actually draws. */
function triangleLoad(root: THREE.Object3D, camera: THREE.Camera): { baseline: number; drawn: number } {
  root.updateMatrixWorld(true);
  const frustum = frustumOf(camera);
  let baseline = 0;
  let drawn = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.count === 0) return;
    const tris = triCount(mesh.geometry) * mesh.count;
    if (!mesh.name.endsWith(':lod')) baseline += tris;
    if (!mesh.visible) return;
    if (mesh.frustumCulled && !frustum.intersectsObject(mesh)) return;
    drawn += tris;
  });
  return { baseline, drawn };
}

describe('resource and prop chunks', () => {
  beforeAll(installCanvasMock);

  it('keeps instance counts, bounds each chunk, and hides chunks outside the frustum', () => {
    const hf = field();
    const world = new World(hf, {
      townCenter: { x: 20, z: 20 },
      villagers: [],
      scouts: [],
      nodes: [
        { kind: 'tree', pos: { x: 8, z: 8 }, amount: 40 },
        { kind: 'tree', pos: { x: 10, z: 9 }, amount: 40 },
        { kind: 'berry', pos: { x: 160, z: 160 }, amount: 80 },
        { kind: 'gold', pos: { x: 12, z: 11 }, amount: 200 },
      ],
      props: [],
    });
    const views = new EntityViews(world);
    let near = 0;
    let maxRadius = 0;
    const names = new Set<string>();
    views.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.name.endsWith(':lod') || mesh.name.startsWith('stumps')) return;
      if (mesh.count === 0) return;
      near += mesh.count;
      expect(mesh.frustumCulled).toBe(true);
      expect(mesh.boundingSphere).not.toBeNull();
      maxRadius = Math.max(maxRadius, mesh.boundingSphere!.radius);
      names.add(mesh.name);
    });
    expect(near).toBe(world.nodes.size);
    expect(maxRadius).toBeLessThan(CHUNK_SIZE * 1.5);
    expect(names.size).toBeGreaterThan(1);

    const camera = rtsCamera(hf, 8, 8, 1, 18);
    camera.far = 40;
    camera.updateProjectionMatrix();
    views.sync(0, 0, camera);
    views.object.updateMatrixWorld(true);
    const frustum = frustumOf(camera);
    let sawNear = false;
    let sawFar = false;
    views.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.count === 0 || mesh.name.endsWith(':lod')) return;
      const hit = frustum.intersectsObject(mesh);
      if (mesh.name.startsWith('berry:')) {
        expect(hit).toBe(false);
        sawFar = true;
      }
      if (mesh.name.startsWith('tree:')) {
        expect(hit).toBe(true);
        sawNear = true;
      }
    });
    expect(sawNear).toBe(true);
    expect(sawFar).toBe(true);

    views.setShadows(true);
    const distant = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    distant.position.set(8, 12, 8 + LOD_DISTANCE + 30);
    distant.lookAt(8, 1, 8);
    distant.updateMatrixWorld();
    views.sync(0, 0, distant);
    let detailHidden = false;
    let impostorShown = false;
    views.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.count === 0 || !mesh.name.startsWith('tree:')) return;
      if (mesh.name.endsWith(':lod')) {
        expect(mesh.castShadow).toBe(false);
        if (mesh.visible) impostorShown = true;
      } else if (!mesh.visible) {
        detailHidden = true;
        expect(mesh.castShadow).toBe(false);
      }
    });
    expect(detailHidden).toBe(true);
    expect(impostorShown).toBe(true);
  });

  it('drops at least 60% of resource and prop triangles at the default RTS zoom', () => {
    const map = generateMap(1);
    const world = new World(map.hf, map.layout);
    const views = new EntityViews(world);
    const props = new PropsView(map.hf, map.layout.props);
    const aspects = [16 / 9, 9 / 16];
    for (const aspect of aspects) {
      const camera = rtsCamera(map.hf, world.townCenter.pos.x, world.townCenter.pos.z, aspect, 26);
      views.sync(1, 0, camera);
      props.update(camera);
      const resources = triangleLoad(views.object, camera);
      const scenery = triangleLoad(props.object, camera);
      const baseline = resources.baseline + scenery.baseline;
      const drawn = resources.drawn + scenery.drawn;
      expect(baseline).toBeGreaterThan(100_000);
      expect(drawn).toBeLessThanOrEqual(baseline * 0.4);
    }
    props.dispose();
  });
});
