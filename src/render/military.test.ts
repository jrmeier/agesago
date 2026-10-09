import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { qualityTier } from '../core/quality';
import {
  GRASS_ONLY,
  type Building,
  type BuildingKind,
  type Heightfield,
  type UnitKind,
  type Vec2,
} from '../core/types';
import { defaultPlayers, PLAYER_COLORS, World } from '../sim/World';
import { CORPSE_SECONDS, RUBBLE_SECONDS } from './deaths';
import { EntityViews } from './EntityViews';
import { HP_GREEN, HP_RED, hpColor } from './hpBars';
import { ENEMY_RING } from './palette';

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
    width: 80,
    depth: 80,
    heightAt: () => 1,
    isWater: () => false,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function makeWorld(): World {
  return new World(
    field(),
    {
      townCenter: { x: 40, z: 40 },
      villagers: [{ x: 42, z: 42 }],
      scouts: [{ x: 44, z: 40 }],
      nodes: [],
      props: [],
    },
    defaultPlayers(2),
  );
}

function cameraAt(x: number, z: number): THREE.PerspectiveCamera {
  const aimY = 1.86;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(x, aimY + 6, z + 10);
  camera.lookAt(x, aimY, z);
  return camera;
}

function unitObject(views: EntityViews, id: number): THREE.Object3D {
  const found = views.object.children.find((obj) => obj.userData.entityId === id);
  if (!found) throw new Error(`no view for ${id}`);
  return found;
}

function clothColor(object: THREE.Object3D): number {
  const cloth = object.getObjectByName('player-cloth') as THREE.Mesh;
  return (cloth.material as THREE.MeshLambertMaterial).color.getHex();
}

let nextId = 80_000;

function place(world: World, views: EntityViews, kind: BuildingKind, pos: Vec2, owner: number, hp = 500, maxHp = 500): Building {
  const building: Building = {
    id: nextId++,
    kind,
    owner,
    hp,
    maxHp,
    pos: { ...pos },
    rot: 0,
    radius: 2,
    complete: true,
    buildProgress: 1,
    queue: 0,
    progress: 0,
  };
  world.buildings.set(building.id, building);
  world.events.emit({ type: 'spawned', id: building.id, kind });
  void views;
  return building;
}

describe('military rendering', () => {
  beforeAll(installCanvasMock);

  it('maps hit points from green through yellow to red', () => {
    const color = new THREE.Color();
    expect(hpColor(1, color).getHex()).toBe(HP_GREEN);
    expect(hpColor(0.5, color).getHex()).toBe(0xe0c240);
    expect(hpColor(0, color).getHex()).toBe(HP_RED);
    hpColor(0.25, color);
    expect(color.r).toBeGreaterThan(color.g);
  });

  it('mounts every unit kind in its owner colour and banners buildings', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const kinds: UnitKind[] = ['villager', 'scout', 'hoplite', 'swordsman', 'slinger', 'archer', 'horseman'];
    for (let i = 0; i < kinds.length; i++) {
      const unit = world.spawnUnit(kinds[i], { x: 12, z: 12 + i * 2 }, 2);
      const object = unitObject(views, unit.id);
      expect(object.userData.unitKind).toBe(kinds[i]);
      expect(object.userData.ownerColor).toBe(PLAYER_COLORS[1]);
      expect(clothColor(object)).toBe(PLAYER_COLORS[1]);
    }
    const local = world.units.values().next().value!;
    expect(clothColor(unitObject(views, local.id))).toBe(PLAYER_COLORS[0]);

    const town = views.object.getObjectByName('town-center')!;
    const townCloth = town.getObjectByName('owner-banner')!.getObjectByName('owner-banner-cloth') as THREE.Mesh;
    expect((townCloth.material as THREE.MeshLambertMaterial).color.getHex()).toBe(PLAYER_COLORS[0]);

    const barracks = place(world, views, 'barracks', { x: 10, z: 14 }, 2);
    const enemyCloth = unitObject(views, barracks.id).getObjectByName('owner-banner-cloth') as THREE.Mesh;
    expect((enemyCloth.material as THREE.MeshLambertMaterial).color.getHex()).toBe(PLAYER_COLORS[1]);
  });

  it('walks while moving or chasing, attacks in range, and idles otherwise', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = cameraAt(40, 50);
    const hero = world.spawnUnit('hoplite', { x: 40, z: 50 }, 1);
    const foe = world.spawnUnit('swordsman', { x: 40.4, z: 50 }, 2);
    const pose = () => unitObject(views, hero.id).userData.pose;

    hero.state = 'attacking';
    hero.target = foe.id;
    views.sync(0, 0.2, camera);
    expect(pose()).toBe('attack');

    foe.pos = { x: 48, z: 50 };
    views.sync(0, 0.4, camera);
    expect(pose()).toBe('walk');

    hero.state = 'idle';
    hero.target = null;
    hero.path = [];
    views.sync(0, 0.6, camera);
    expect(pose()).toBe('idle');

    hero.state = 'moving';
    views.sync(0, 0.8, camera);
    expect(pose()).toBe('walk');

    const scout = [...world.units.values()].find((unit) => unit.kind === 'scout')!;
    scout.state = 'exploring';
    views.sync(0, 1, camera);
    expect(unitObject(views, scout.id).userData.pose).toBe('gallop');
    scout.state = 'attacking';
    scout.target = foe.id;
    foe.pos = { x: scout.pos.x + 0.2, z: scout.pos.z };
    views.sync(0, 1.2, camera);
    expect(unitObject(views, scout.id).userData.pose).toBe('attack');

    const villager = [...world.units.values()].find((unit) => unit.kind === 'villager' && unit.owner === 1)!;
    villager.state = 'gathering';
    villager.gatherType = 'wood';
    views.sync(0, 1.4, camera);
    expect(unitObject(views, villager.id).userData.pose).toBe('chop');
  });

  it('shows HP bars when damaged or selected and hides them at full health', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = cameraAt(42, 42);
    const villager = [...world.units.values()].find((unit) => unit.kind === 'villager')!;
    const fill = () => views.object.getObjectByName('hp-fill') as THREE.InstancedMesh;
    const color = new THREE.Color();

    views.sync(0, 0, camera);
    expect(fill().count).toBe(0);
    expect(fill().visible).toBe(false);

    villager.hp = 1;
    views.sync(0, 0.1, camera);
    expect(fill().count).toBe(1);
    expect(fill().visible).toBe(true);
    fill().getColorAt(0, color);
    expect(color.r).toBeGreaterThan(color.g);

    villager.hp = villager.maxHp;
    views.sync(0, 0.2, camera);
    expect(fill().count).toBe(0);

    views.setSelected(new Set([villager.id]));
    views.sync(0, 0.3, camera);
    expect(fill().count).toBe(1);
    fill().getColorAt(0, color);
    expect(color.g).toBeGreaterThan(color.r);

    views.setSelected(new Set());
    const house = place(world, views, 'house', { x: 48, z: 48 }, 1, 500, 500);
    views.sync(0, 0.4, camera);
    expect(fill().count).toBe(0);
    house.hp = 200;
    views.sync(0, 0.5, camera);
    expect(fill().count).toBe(1);
    house.hp = house.maxHp;
    views.sync(0, 0.6, camera);
    expect(fill().count).toBe(0);
  });

  it('flies a pooled projectile on an arc and reuses the mesh', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = cameraAt(15, 10);
    const group = views.object.getObjectByName('projectiles')!;
    const visible = () => group.children.filter((child) => child.visible);

    world.events.emit({
      type: 'projectile',
      kind: 'arrow',
      from: { x: 10, z: 10 },
      to: { x: 20, z: 10 },
      flight: 1,
      targetId: 1,
    });
    views.sync(0, 0, camera);
    expect(visible()).toHaveLength(1);
    const arrow = visible()[0];
    expect(arrow.position.x).toBeCloseTo(10, 1);
    const launched = group.children.length;

    views.sync(0, 0.5, camera);
    expect(arrow.position.x).toBeCloseTo(15, 1);
    expect(arrow.position.y).toBeGreaterThan(3.2);
    const along = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
    expect(along.x).toBeGreaterThan(0.85);

    views.sync(0, 1.05, camera);
    expect(arrow.visible).toBe(false);

    world.events.emit({
      type: 'projectile',
      kind: 'stone',
      from: { x: 10, z: 12 },
      to: { x: 16, z: 12 },
      flight: 1,
      targetId: 1,
    });
    views.sync(0, 1.05, camera);
    expect(group.children.length).toBe(launched);
    const stone = visible()[0];
    expect(stone.userData.projectileKind).toBe('stone');
    const spin = stone.rotation.x;
    views.sync(0, 1.55, camera);
    expect(stone.rotation.x).not.toBeCloseTo(spin, 2);
    views.sync(0, 2.2, camera);
    expect(visible()).toHaveLength(0);
  });

  it('keeps a fading corpse and collapsing rubble after the sim removes the entity', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = cameraAt(42, 42);
    const villager = [...world.units.values()].find((unit) => unit.kind === 'villager')!;
    const id = villager.id;
    const pos = { ...villager.pos };
    world.units.delete(id);
    world.events.emit({ type: 'died', id, kind: 'villager', owner: 1, pos });
    world.events.emit({ type: 'removed', id });

    const deaths = views.object.getObjectByName('deaths')!;
    expect(views.object.children.some((obj) => obj.userData.entityId === id)).toBe(false);
    expect(deaths.getObjectByName('player-cloth')).toBeTruthy();

    views.sync(0, 0, camera);
    const corpse = deaths.children.find((obj) => obj.userData.unitKind === 'villager')!;
    expect(corpse.userData.pose).toBe('die');
    const cloth = corpse.getObjectByName('player-cloth') as THREE.Mesh;
    expect((cloth.material as THREE.MeshLambertMaterial).opacity).toBeCloseTo(1, 2);

    views.sync(0, 1, camera);
    const rig = corpse.getObjectByName('rig')!;
    expect(rig.rotation.x).toBeLessThan(-1);

    views.sync(0, 3, camera);
    expect((cloth.material as THREE.MeshLambertMaterial).opacity).toBeCloseTo(1 - 3 / CORPSE_SECONDS, 2);

    views.sync(0, CORPSE_SECONDS + 0.05, camera);
    expect(deaths.getObjectByName('player-cloth')).toBeFalsy();

    const house = place(world, views, 'house', { x: 50, z: 50 }, 1);
    const houseId = house.id;
    world.buildings.delete(houseId);
    world.events.emit({ type: 'died', id: houseId, kind: 'house', owner: 1, pos: house.pos });
    world.events.emit({ type: 'removed', id: houseId });
    expect(views.object.getObjectByName('building:house')).toBeUndefined();
    const rubble = deaths.getObjectByName('rubble') as THREE.Mesh;
    expect(rubble).toBeTruthy();
    const dust = deaths.getObjectByName('dust') as THREE.Mesh;
    expect(dust.visible).toBe(true);

    views.sync(0, 30, camera);
    expect(dust.visible).toBe(true);
    views.sync(0, 31.2, camera);
    expect(dust.visible).toBe(false);
    expect((rubble.material as THREE.MeshLambertMaterial).opacity).toBeGreaterThan(0.9);

    views.sync(0, 30 + RUBBLE_SECONDS * 0.5, camera);
    expect((rubble.material as THREE.MeshLambertMaterial).opacity).toBeCloseTo(0.5, 1);

    views.sync(0, 30 + RUBBLE_SECONDS + 0.05, camera);
    expect(deaths.getObjectByName('rubble')).toBeFalsy();
  });

  it('uses a single dust puff on the low quality tier', () => {
    const world = makeWorld();
    const views = new EntityViews(world, qualityTier('low'));
    const house = place(world, views, 'storehouse', { x: 55, z: 55 }, 1);
    world.buildings.delete(house.id);
    world.events.emit({ type: 'died', id: house.id, kind: 'storehouse', owner: 1, pos: house.pos });
    let dust = 0;
    views.object.getObjectByName('deaths')!.traverse((obj) => {
      if (obj.name === 'dust') dust += 1;
    });
    expect(dust).toBe(1);
  });

  it('hides enemy units that are not visible, keeps explored enemy buildings, and will not pick either while hidden', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const enemy = world.spawnUnit('swordsman', { x: 8, z: 8 }, 2);
    const object = unitObject(views, enemy.id);
    expect(world.visibility.isVisible(8, 8)).toBe(false);
    expect(object.visible).toBe(false);

    const camera = cameraAt(8, 8);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).not.toBe(enemy.id);
    const box = views.idsInRect({ x0: 0, y0: 0, x1: 200, y1: 200 }, camera, { width: 200, height: 200 });
    expect(box).not.toContain(enemy.id);

    const barracks = place(world, views, 'barracks', { x: 12, z: 8 }, 2);
    const building = unitObject(views, barracks.id);
    expect(building.visible).toBe(false);
    const buildingCam = cameraAt(12, 8);
    expect(views.pick(new THREE.Vector2(0, 0), buildingCam)).not.toBe(barracks.id);

    world.visibility.update([{ pos: { x: 8, z: 8 }, sight: 6 }]);
    views.sync(0, 0, camera);
    expect(object.visible).toBe(true);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).toBe(enemy.id);
    expect(views.idsInRect({ x0: 0, y0: 0, x1: 200, y1: 200 }, camera, { width: 200, height: 200 })).toContain(enemy.id);
    expect(building.visible).toBe(true);

    world.visibility.update([]);
    views.sync(0, 0.2, camera);
    expect(world.visibility.isExplored(8, 8)).toBe(true);
    expect(world.visibility.isVisible(8, 8)).toBe(false);
    expect(object.visible).toBe(false);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).not.toBe(enemy.id);
    expect(views.idsInRect({ x0: 0, y0: 0, x1: 200, y1: 200 }, camera, { width: 200, height: 200 })).not.toContain(enemy.id);
    expect(world.visibility.isExplored(12, 8)).toBe(true);
    expect(building.visible).toBe(true);
    expect(views.pick(new THREE.Vector2(0, 0), buildingCam)).toBe(barracks.id);

    const own = world.spawnUnit('archer', { x: 6, z: 6 }, 1);
    expect(world.visibility.isVisible(6, 6)).toBe(false);
    expect(unitObject(views, own.id).visible).toBe(true);
  });

  it('draws the owner colour on friendly rings and red on an enemy', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = cameraAt(42, 42);
    const villager = [...world.units.values()].find((unit) => unit.kind === 'villager')!;
    views.setSelected(new Set([villager.id]));
    views.sync(0, 0, camera);
    const ring = () => views.object.children.find((child) => child.renderOrder === 3 && child.visible) as THREE.Mesh;
    expect((ring().material as THREE.MeshBasicMaterial).color.getHex()).toBe(PLAYER_COLORS[0]);

    const enemy = world.spawnUnit('archer', { x: 42, z: 46 }, 2);
    world.visibility.update([{ pos: enemy.pos, sight: 4 }]);
    views.setSelected(new Set([enemy.id]));
    views.sync(0, 0.2, cameraAt(42, 46));
    expect(unitObject(views, enemy.id).visible).toBe(true);
    expect((ring().material as THREE.MeshBasicMaterial).color.getHex()).toBe(ENEMY_RING);
  });
});
