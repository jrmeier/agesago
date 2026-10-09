import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type ResourceNode, type Vec2 } from '../core/types';
import { World } from '../sim/World';
import { CROP_RIPE, CROP_THIN, footprintMinY, GHOST_INVALID, GHOST_VALID, SOIL_FALLOW, SOIL_TILLED } from './buildingVisuals';
import { EntityViews } from './EntityViews';
import { CHUNK_SIZE } from './instanceChunks';

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

function field(heightAt: Heightfield['heightAt']): Heightfield {
  return {
    width: 176,
    depth: 176,
    heightAt,
    isWater: () => false,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function makeWorld(hf: Heightfield): World {
  return new World(hf, {
    townCenter: { x: 80, z: 80 },
    villagers: [{ x: 84, z: 84 }],
    scouts: [],
    nodes: [{ kind: 'tree', pos: { x: 8, z: 8 }, amount: 40 }],
    props: [],
  });
}

let nextId = 50_000;

function place(world: World, kind: BuildingKind, pos: Vec2, rot: number, complete: boolean, progress = complete ? 1 : 0.2, food?: number): Building {
  const building: Building = {
    id: nextId++,
    kind,
    owner: 1,
    hp: 500,
    maxHp: 500,
    pos: { ...pos },
    rot,
    radius: 2,
    complete,
    buildProgress: progress,
    queue: 0,
    progress: 0,
    food,
  };
  world.buildings.set(building.id, building);
  world.events.emit({ type: 'spawned', id: building.id, kind });
  return building;
}

describe('buildings, ghost and picking', () => {
  beforeAll(installCanvasMock);

  it('seats a building on the lowest footprint sample and keeps its yaw', () => {
    const hf = field((x, z) => 1 + x * 0.05 + z * 0.25);
    const world = makeWorld(hf);
    const views = new EntityViews(world);
    const pos = { x: 20, z: 20 };
    const rot = Math.PI / 2;
    place(world, 'house', pos, rot, true);
    const group = views.object.getObjectByName('building:house')!;
    const minY = footprintMinY(hf, 'house', pos, rot);
    const centreY = Math.max(hf.heightAt(pos.x, pos.z), 0);
    expect(group.position.x).toBeCloseTo(pos.x, 5);
    expect(group.position.z).toBeCloseTo(pos.z, 5);
    expect(group.position.y).toBeCloseTo(minY, 5);
    expect(group.position.y).toBeLessThan(centreY - 0.05);
    expect(group.rotation.y).toBeCloseTo(rot, 5);
    expect(BUILDINGS.house.size.w).toBeGreaterThan(0);
  });

  it('builds up the foundation stages, then swaps to the finished model', () => {
    const world = makeWorld(field(() => 2));
    const views = new EntityViews(world);
    const building = place(world, 'storehouse', { x: 30, z: 30 }, 0, false, 0.1);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    camera.position.set(30, 12, 42);
    camera.lookAt(30, 2, 30);
    const group = views.object.getObjectByName('building:storehouse')!;
    const foundation = group.getObjectByName('foundation')!;
    const finished = group.getObjectByName('finished')!;
    const shown = () => {
      let n = 0;
      foundation.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) n++;
      });
      return n;
    };

    views.sync(0, 0, camera);
    expect(foundation.visible).toBe(true);
    expect(finished.visible).toBe(false);
    const early = shown();

    building.buildProgress = 0.85;
    views.sync(0, 0.2, camera);
    expect(foundation.visible).toBe(true);
    expect(finished.visible).toBe(false);
    expect(shown()).toBeGreaterThan(early);
    expect(group.getObjectByName('progress')!.visible).toBe(true);

    building.complete = true;
    building.buildProgress = 1;
    world.events.emit({ type: 'constructed', id: building.id });
    views.sync(0, 0.3, camera);
    expect(foundation.visible).toBe(false);
    expect(finished.visible).toBe(true);
    expect(group.getObjectByName('progress')!.visible).toBe(false);

    views.setSelected(new Set([building.id]));
    views.sync(0, 0.4, camera);
    const bar = group.getObjectByName('progress')!;
    expect(bar.visible).toBe(true);
    const fill = bar.getObjectByName('progress-fill') as THREE.Mesh;
    expect(fill.scale.x).toBeCloseTo(1, 5);
  });

  it('tracks farm crops with food remaining and goes fallow at zero', () => {
    const world = makeWorld(field(() => 1));
    const views = new EntityViews(world);
    const farm = place(world, 'farm', { x: 40, z: 24 }, 0, true, 1, FARM_FOOD);
    const camera = new THREE.PerspectiveCamera();
    views.sync(0, 0, camera);
    const group = views.object.getObjectByName('building:farm')!;
    const crops = group.getObjectByName('crops')!;
    const soil = group.getObjectByName('tilled') as THREE.Mesh;
    expect(crops.visible).toBe(true);
    expect(crops.scale.y).toBeCloseTo(1, 5);
    expect((soil.material as THREE.MeshLambertMaterial).color.getHex()).toBe(SOIL_TILLED);

    farm.food = FARM_FOOD / 2;
    views.sync(0, 0.1, camera);
    expect(crops.scale.y).toBeCloseTo(0.5, 5);
    expect((crops.children[0] as THREE.Mesh).material).toBeTruthy();
    const cropMat = (crops.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    expect(cropMat.color.getHex()).toBe(CROP_RIPE);

    farm.food = FARM_FOOD * 0.2;
    views.sync(0, 0.2, camera);
    expect(cropMat.color.getHex()).toBe(CROP_THIN);

    farm.food = 0;
    views.sync(0, 0.3, camera);
    expect(crops.visible).toBe(false);
    expect((soil.material as THREE.MeshLambertMaterial).color.getHex()).toBe(SOIL_FALLOW);
  });

  it('shows and hides a tinted placement ghost on the terrain', () => {
    const hf = field(() => 3.25);
    const world = makeWorld(hf);
    const views = new EntityViews(world);
    views.showGhost('house', { x: 12, z: 18 }, Math.PI / 2, true);
    const ghost = views.object.getObjectByName('placement-ghost')!;
    expect(ghost.visible).toBe(true);
    expect(ghost.position.x).toBeCloseTo(12, 5);
    expect(ghost.position.z).toBeCloseTo(18, 5);
    expect(ghost.position.y).toBeCloseTo(3.25, 5);
    expect(ghost.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    const outline = ghost.getObjectByName('footprint') as THREE.Mesh;
    expect((outline.material as THREE.MeshBasicMaterial).color.getHex()).toBe(GHOST_VALID);

    views.showGhost('house', { x: 14, z: 18 }, 0, false);
    expect(ghost.visible).toBe(true);
    expect(ghost.position.x).toBeCloseTo(14, 5);
    expect(ghost.rotation.y).toBeCloseTo(0, 5);
    expect((outline.material as THREE.MeshBasicMaterial).color.getHex()).toBe(GHOST_INVALID);

    views.showGhost('farm', { x: 14, z: 22 }, 0, true);
    expect(ghost.visible).toBe(false);
    const farmGhost = views.object.children.filter((obj) => obj.name === 'placement-ghost').find((obj) => obj.visible)!;
    expect(farmGhost.position.z).toBeCloseTo(22, 5);

    views.hideGhost();
    expect(farmGhost.visible).toBe(false);
  });

  it('picks any building from its footprint, including an unfinished one', () => {
    const hf = field(() => 1);
    const world = makeWorld(hf);
    const views = new EntityViews(world);
    const house = place(world, 'house', { x: 18, z: 16 }, 0, false, 0.4);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    const y = 1 + 1.1;
    camera.position.set(house.pos.x, y + 8, house.pos.z + 10);
    camera.lookAt(house.pos.x, y, house.pos.z);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).toBe(house.id);

    const unit = world.units.values().next().value!;
    unit.pos = { x: 150, z: 150 };
    unit.prevPos = { x: 150, z: 150 };
    const tc = world.townCenter!;
    camera.position.set(tc.pos.x, 10, tc.pos.z + 12);
    camera.lookAt(tc.pos.x, 2, tc.pos.z);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).toBe(tc.id);

    camera.position.set(120, 12, 132);
    camera.lookAt(120, 1, 120);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).toBeNull();
  });

  it('instances stone quarries on their own chunk meshes', () => {
    const world = makeWorld(field(() => 1));
    const views = new EntityViews(world);
    const node: ResourceNode = {
      id: nextId++,
      kind: 'stone',
      type: 'stone',
      pos: { x: 50, z: 52 },
      amount: 400,
      radius: 0.7,
    };
    world.nodes.set(node.id, node);
    world.events.emit({ type: 'spawned', id: node.id, kind: 'stone' });
    let stone = 0;
    views.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.name.endsWith(':lod')) return;
      if (mesh.name.startsWith('stone:')) {
        stone += mesh.count;
        expect(mesh.frustumCulled).toBe(true);
        expect(mesh.boundingSphere).not.toBeNull();
        expect(mesh.boundingSphere!.radius).toBeLessThan(CHUNK_SIZE);
      }
    });
    expect(stone).toBe(1);
  });
});

