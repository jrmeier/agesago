import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { VISIBLE } from '../sim/visibility';
import { CORPSE_SECONDS, RUBBLE_SECONDS } from './deaths';
import { DUST_SECONDS, dustCount } from './workFx';
import * as settings from '../game/settings';
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
    // Shots fly on the sim clock: alpha 1 puts the frame at world.time.
    const at = (time: number) => {
      world.time = time;
      views.sync(1, time, camera);
    };

    world.events.emit({
      type: 'projectile',
      kind: 'arrow',
      from: { x: 10, z: 10 },
      to: { x: 20, z: 10 },
      flight: 1,
      targetId: 1,
    });
    at(0);
    expect(visible()).toHaveLength(1);
    const arrow = visible()[0];
    expect(arrow.position.x).toBeCloseTo(10, 1);
    const launched = group.children.length;

    at(0.5);
    expect(arrow.position.x).toBeCloseTo(15, 1);
    expect(arrow.position.y).toBeGreaterThan(3.2);
    const along = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
    expect(along.x).toBeGreaterThan(0.85);

    at(1.05);
    expect(arrow.visible).toBe(false);

    world.events.emit({
      type: 'projectile',
      kind: 'stone',
      from: { x: 10, z: 12 },
      to: { x: 16, z: 12 },
      flight: 1,
      targetId: 1,
    });
    at(1.05);
    expect(group.children.length).toBe(launched);
    const stone = visible()[0];
    expect(stone.userData.projectileKind).toBe('stone');
    const spin = stone.rotation.x;
    at(1.55);
    expect(stone.rotation.x).not.toBeCloseTo(spin, 2);
    at(2.2);
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

  it('hides enemy units outside sight and freezes a last-seen enemy building until it is visible again', () => {
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
    expect(building.getObjectByName('finished')!.visible).toBe(true);

    views.setSelected(new Set([barracks.id]));
    views.sync(0, 0.1, buildingCam);
    const fill = () => views.object.getObjectByName('hp-fill') as THREE.InstancedMesh;
    const color = new THREE.Color();
    expect(fill().count).toBe(1);
    fill().getColorAt(0, color);
    expect(color.g).toBeGreaterThan(color.r);

    world.visibility.update([]);
    barracks.hp = 1;
    barracks.complete = false;
    barracks.buildProgress = 0.1;
    barracks.rot = Math.PI / 2;
    barracks.pos = { x: 12.4, z: 8.4 };
    views.sync(0, 0.2, camera);
    expect(world.visibility.isExplored(8, 8)).toBe(true);
    expect(world.visibility.isVisible(8, 8)).toBe(false);
    expect(object.visible).toBe(false);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).not.toBe(enemy.id);
    expect(views.idsInRect({ x0: 0, y0: 0, x1: 200, y1: 200 }, camera, { width: 200, height: 200 })).not.toContain(enemy.id);
    expect(world.visibility.isExplored(12, 8)).toBe(true);
    expect(world.visibility.isVisible(12, 8)).toBe(false);
    expect(building.visible).toBe(true);
    expect(building.getObjectByName('finished')!.visible).toBe(true);
    expect(building.getObjectByName('foundation')!.visible).toBe(false);
    expect(building.position.x).toBeCloseTo(12);
    expect(building.position.z).toBeCloseTo(8);
    expect(building.rotation.y).toBeCloseTo(0);
    expect(views.pick(new THREE.Vector2(0, 0), buildingCam)).not.toBe(barracks.id);
    fill().getColorAt(0, color);
    expect(color.g).toBeGreaterThan(color.r);

    const own = world.spawnUnit('archer', { x: 6, z: 6 }, 1);
    expect(world.visibility.isVisible(6, 6)).toBe(false);
    expect(unitObject(views, own.id).visible).toBe(true);

    world.buildings.delete(barracks.id);
    world.events.emit({ type: 'died', id: barracks.id, kind: 'barracks', owner: 2, pos: { x: 12, z: 8 } });
    world.events.emit({ type: 'removed', id: barracks.id });
    views.sync(0, 0.4, buildingCam);
    expect(unitObject(views, barracks.id).visible).toBe(true);
    expect(views.object.getObjectByName('deaths')!.getObjectByName('rubble')).toBeFalsy();
    expect(views.pick(new THREE.Vector2(0, 0), buildingCam)).not.toBe(barracks.id);
    fill().getColorAt(0, color);
    expect(color.g).toBeGreaterThan(color.r);

    world.visibility.update([{ pos: { x: 12, z: 8 }, sight: 4 }]);
    views.sync(0, 0.6, buildingCam);
    expect(views.object.children.some((obj) => obj.userData.entityId === barracks.id)).toBe(false);
    expect(views.object.getObjectByName('deaths')!.getObjectByName('rubble')).toBeTruthy();
  });

  it('uses the same last-seen rules on the low quality tier', () => {
    const world = makeWorld();
    const views = new EntityViews(world, qualityTier('low'));
    const enemy = world.spawnUnit('archer', { x: 8, z: 8 }, 2);
    const barracks = place(world, views, 'barracks', { x: 12, z: 8 }, 2);
    expect(unitObject(views, enemy.id).visible).toBe(false);
    expect(unitObject(views, barracks.id).visible).toBe(false);

    world.visibility.update([{ pos: { x: 12, z: 8 }, sight: 6 }]);
    const camera = cameraAt(12, 8);
    views.sync(0, 0, camera);
    expect(unitObject(views, enemy.id).visible).toBe(true);
    expect(unitObject(views, barracks.id).visible).toBe(true);

    world.visibility.update([]);
    views.sync(0, 0.2, camera);
    expect(unitObject(views, enemy.id).visible).toBe(false);
    expect(unitObject(views, barracks.id).visible).toBe(true);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).not.toBe(barracks.id);
    expect(views.pick(new THREE.Vector2(0, 0), camera)).not.toBe(enemy.id);
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

describe('capture bars (M18-4)', () => {
  beforeAll(installCanvasMock);

  it('draws the owner share against the leading challenger only while a building is being captured', () => {
    const world = makeWorld();
    world.visibility.state.fill(VISIBLE);
    const views = new EntityViews(world);
    const camera = cameraAt(46, 40);
    const house = place(world, views, 'house', { x: 46, z: 40 }, 2);
    const back = () => views.object.getObjectByName('capture-back') as THREE.InstancedMesh;
    const fill = () => views.object.getObjectByName('capture-fill') as THREE.InstancedMesh;
    views.sync(0, 0, camera);
    expect(views.captureBars.count).toBe(0);
    expect(fill().visible).toBe(false);

    house.capture = [0, 100, 175];
    views.sync(0, 0.1, camera);
    expect(views.captureBars.count).toBe(1);
    const color = new THREE.Color();
    fill().getColorAt(0, color);
    expect(color.getHex()).toBe(PLAYER_COLORS[1]);
    back().getColorAt(0, color);
    expect(color.getHex()).toBe(PLAYER_COLORS[0]);
  });
});


describe('construction and tree feedback', () => {
  beforeAll(installCanvasMock);
  afterEach(() => vi.restoreAllMocks());
  it.each(['low', 'medium', 'high'] as const)('cleans construction dust on %s and limits wall puffs', tier => {
    const world = makeWorld();
    world.visibility.state.fill(VISIBLE);
    const views = new EntityViews(world, qualityTier(tier));
    const house = place(world, views, 'house', { x: 45, z: 45 }, 1);
    const camera = cameraAt(45, 45);
    world.events.emit({ type: 'constructed', id: house.id });
    const effect = views.object.getObjectByName('construction-dust')!;
    expect(effect.children).toHaveLength(dustCount(tier));
    const material = (effect.children[0] as THREE.Mesh).material as THREE.Material;
    const disposed = vi.spyOn(material, 'dispose');
    views.sync(0, 0, camera); views.sync(0, DUST_SECONDS + 0.01, camera);
    expect(views.object.getObjectByName('construction-dust')).toBeUndefined();
    expect(disposed).toHaveBeenCalledOnce();
    const wall = place(world, views, 'palisade', { x: 48, z: 45 }, 1);
    world.events.emit({ type: 'constructed', id: wall.id });
    expect(views.object.getObjectByName('construction-dust')?.children.length ?? 0).toBe(tier === 'low' ? 0 : 1);
  });

  it.each(['high', 'low'] as const)('adds the stump immediately and cleans the temporary tree on %s', tier => {
    const world = makeWorld();
    world.visibility.state.fill(VISIBLE);
    const views = new EntityViews(world, qualityTier(tier));
    const id = world.allocId(), pos = { x: 45, z: 45 };
    world.nodes.set(id, { id, kind: 'tree', type: 'wood', pos, amount: 1, radius: 0.5 });
    world.events.emit({ type: 'spawned', id, kind: 'tree' });
    world.nodes.delete(id); world.events.emit({ type: 'removed', id });
    expect(views.object.children.some(o => o.name.startsWith('stumps') && (o as THREE.InstancedMesh).count === 1)).toBe(true);
    const tree = views.object.getObjectByName('falling-tree');
    if (tier === 'low') { expect(tree).toBeUndefined(); return; }
    expect(tree).toBeDefined();
    const mesh = tree!.children[0] as THREE.Mesh;
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    const camera = cameraAt(45, 45);
    views.sync(0, 0, camera); views.sync(0, 0.6, camera);
    expect(tree!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI * 85 / 180);
    views.sync(0, 0.8, camera); expect(tree!.position.y).toBeLessThan(1);
    views.sync(0, 1.01, camera);
    expect(tree!.parent).toBeNull(); expect(tree!.children).toHaveLength(0);
    expect(disposeGeometry).not.toHaveBeenCalled(); expect(disposeMaterial).not.toHaveBeenCalled();
  });

  it('caps trees, skips hidden removals and suppresses construction and falling with reduced motion', () => {
    const world = makeWorld();
    const views = new EntityViews(world, qualityTier('high'));
    const fell = (x: number) => {
      const id = world.allocId();
      world.nodes.set(id, { id, kind: 'tree', type: 'wood', pos: { x, z: 45 }, amount: 1, radius: 0.5 });
      world.events.emit({ type: 'spawned', id, kind: 'tree' });
      world.nodes.delete(id); world.events.emit({ type: 'removed', id });
    };
    world.visibility.state.fill(0); fell(45);
    expect(views.object.getObjectByName('falling-tree')).toBeUndefined();
    world.visibility.state.fill(VISIBLE);
    for (let i = 0; i < 8; i++) fell(45 + i);
    const effects = views.object.getObjectByName('work-fx')!;
    expect(effects.children).toHaveLength(6);
    const camera = cameraAt(45, 45);
    views.sync(0, 0, camera); views.sync(0, 1.01, camera);
    vi.spyOn(settings, 'currentSettings').mockReturnValue({ ...settings.currentSettings(), reducedMotion: true });
    fell(45);
    const house = place(world, views, 'house', { x: 45, z: 45 }, 1);
    world.events.emit({ type: 'constructed', id: house.id });
    expect(effects.children).toHaveLength(0);
  });
});
