import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GRASS_ONLY, type Heightfield, type Unit } from '../core/types';
import { generateMap } from '../sim/mapgen';
import { World } from '../sim/World';
import { EntityViews } from './EntityViews';
import { TerrainView } from './TerrainView';

function installCanvasMock(): void {
  const data = new Uint8ClampedArray(512 * 512 * 4);
  const ctx: object = new Proxy(function () {}, {
    apply: () => ctx,
    get: (_target, prop) => (prop === 'data' ? data : ctx),
  });
  Object.assign(globalThis, {
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ctx,
      }),
    },
  });
}

describe('TerrainView', () => {
  beforeAll(installCanvasMock);

  it('samples heightAt, drops skirts, and animates the water plane', () => {
    const hf: Heightfield = {
      width: 64,
      depth: 48,
      heightAt: (x, z) => 1.5 + Math.sin(x * 0.15) * 0.4 + z * 0.02,
      isWater: () => false,
      isWalkable: () => true,
      forestDensity: (x) => (x > 40 ? 0.8 : 0),
      ground: () => GRASS_ONLY,
    };
    const view = new TerrainView(hf);
    const ground = view.object.children[0] as THREE.Mesh;
    const water = view.object.children[1] as THREE.Mesh;
    const pos = ground.geometry.attributes.position;
    const normal = ground.geometry.attributes.normal;

    expect(pos.count).toBe(129 * 97 + (129 + 97) * 4);
    let tops = 0;
    let skirts = 0;
    let upNormals = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const expected = hf.heightAt(x, z);
      if (Math.abs(y - expected) < 1e-4) {
        tops += 1;
        if (x > 2 && x < 62 && z > 2 && z < 46 && normal.getY(i) > 0.5) upNormals += 1;
      } else if (Math.abs(y - (expected - 4)) < 1e-4) {
        skirts += 1;
      } else {
        throw new Error(`vertex ${i} y=${y} is neither surface nor skirt at (${x}, ${z})`);
      }
    }
    expect(tops).toBe(129 * 97 + (129 + 97) * 2);
    expect(skirts).toBe((129 + 97) * 2);
    expect(upNormals).toBeGreaterThan(1000);

    const waterMat = water.material as THREE.MeshLambertMaterial;
    expect(waterMat.transparent).toBe(true);
    expect(waterMat.depthWrite).toBe(false);
    expect(waterMat.opacity).toBeLessThan(1);
    const before = water.geometry.attributes.position.array as Float32Array;
    const y0 = before[1];
    view.update(1.7);
    const after = water.geometry.attributes.position.array as Float32Array;
    let moved = 0;
    for (let i = 1; i < after.length; i += 3) if (Math.abs(after[i] - y0) > 1e-4) moved += 1;
    expect(moved).toBeGreaterThan(10);
  });
});

describe('EntityViews', () => {
  let hf: Heightfield;
  let world: World;
  let views: EntityViews;
  let unit: Unit;

  beforeAll(() => {
    installCanvasMock();
    const map = generateMap(1);
    hf = map.hf;
    world = new World(hf, map.layout);
    views = new EntityViews(world);
    unit = world.units.values().next().value as Unit;
  });

  function instanceCount(): number {
    let n = 0;
    views.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (mesh.isInstancedMesh && mesh.name !== 'stumps') n += mesh.count;
    });
    return n;
  }

  it('mounts the starting villagers, nodes and town center', () => {
    expect(instanceCount()).toBe(world.nodes.size);
    const top = views.object.children;
    expect(top.filter((obj) => obj.name === 'villager' || obj.name === 'scout')).toHaveLength(world.units.size);
    const buildings = top.filter((obj) => obj.name !== 'villager' && obj.name !== 'scout' && (obj as THREE.Group).children.length > 3);
    expect(buildings).toHaveLength(1);
  });

  it('picks the villager under the cursor and box-selects by foot or centre', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    const aimY = Math.max(hf.heightAt(unit.pos.x, unit.pos.z), 0) + 0.86;
    camera.position.set(unit.pos.x, aimY + 6, unit.pos.z + 10);
    camera.lookAt(unit.pos.x, aimY, unit.pos.z);
    views.sync(0, 0.2, camera);

    expect(views.pick(new THREE.Vector2(0, 0), camera)).toBe(unit.id);

    const hit = views.idsInRect({ x0: 40, y0: 40, x1: 160, y1: 160 }, camera, { width: 200, height: 200 });
    const miss = views.idsInRect({ x0: 0, y0: 0, x1: 8, y1: 8 }, camera, { width: 200, height: 200 });
    expect(hit).toContain(unit.id);
    expect(miss).not.toContain(unit.id);
  });

  it('places villager models on the ground, turned to their heading', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    unit.facing = 1.2;
    views.sync(1, 0, camera);
    const ground = Math.max(hf.heightAt(unit.pos.x, unit.pos.z), 0);
    const villager = views.object.children.find(
      (obj) => obj.name === 'villager' && Math.abs(obj.position.x - unit.pos.x) < 0.01 && Math.abs(obj.position.z - unit.pos.z) < 0.01
    );
    expect(villager).toBeDefined();
    expect(villager!.position.y).toBeCloseTo(ground, 4);
    expect(villager!.rotation.y).toBeCloseTo(1.2, 4);
  });

  it('shows a selection ring and a fading move marker', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    camera.position.set(unit.pos.x, 12, unit.pos.z + 12);
    camera.lookAt(unit.pos.x, 1, unit.pos.z);
    views.setSelected(new Set([unit.id]));
    views.flashMarker({ x: 12, z: 14 });
    views.sync(0, 3, camera);
    views.sync(0, 3.25, camera);

    const marker = views.object.children.find((child) => child.renderOrder === 4) as THREE.Mesh;
    const ring = views.object.children.find((child) => child.renderOrder === 3) as THREE.Mesh;
    expect(ring.visible).toBe(true);
    expect(ring.position.x).toBeCloseTo(unit.pos.x, 4);
    expect(ring.position.z).toBeCloseTo(unit.pos.z, 4);
    expect(marker.visible).toBe(true);
    expect(marker.scale.x).toBeGreaterThan(1);
    expect(marker.position.x).toBeCloseTo(12, 4);
    expect(marker.position.z).toBeCloseTo(14, 4);

    views.sync(0, 4, camera);
    expect(marker.visible).toBe(false);
    views.setSelected(new Set());
    views.sync(0, 4, camera);
    expect(ring.visible).toBe(false);
  });

  it('hides a resource instance when it is removed, leaving a stump for trees', () => {
    const tree = [...world.nodes.values()].find((n) => n.kind === 'tree')!;
    const stumps = views.object.children.find((obj) => obj.name === 'stumps') as THREE.InstancedMesh;
    const before = instanceCount();
    world.events.emit({ type: 'removed', id: tree.id });
    expect(instanceCount()).toBe(before - 1);
    expect(stumps.count).toBe(1);
  });
});
