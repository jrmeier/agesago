import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { CIV_IDS } from '../core/civilizations';
import { GRASS_ONLY, type Heightfield } from '../core/types';
import { UNITS } from '../core/units';
import { defaultPlayers, World } from '../sim/World';
import { buildingModel } from './buildings';
import { EntityViews } from './EntityViews';
import { IMPACT_SECONDS, ImpactPuffs } from './impacts';
import { createUnitAvatar, projectileGeometry } from './modelBridge';
import { arcHeight, ProjectilePool } from './projectiles';
import {
  ARM_COCKED,
  ARM_STOWED,
  ARM_THROWN,
  boltDraw,
  catapultArm,
  createSiegeEngine,
  ramSwing,
  THROW_SECONDS,
  type SiegeKind,
} from './siegeModels';
import { perfBudget } from '../testing/perf';

const KINDS: SiegeKind[] = ['ram', 'catapult', 'boltShooter'];

function meshes(object: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry>[] {
  const result: THREE.Mesh<THREE.BufferGeometry>[] = [];
  object.traverse(child => { if (child instanceof THREE.Mesh) result.push(child); });
  return result;
}

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const result = new THREE.Box3();
  object.traverseVisible(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.computeBoundingBox();
      result.union(child.geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld));
    }
  });
  return result;
}

function triangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

function worldPos(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
}

describe('siege engine models', () => {
  it.each(KINDS)('%s is grounded, wheeled, faces +z and stays within budget', kind => {
    const model = createSiegeEngine(kind, { color: 0x2077ba, seed: 3 });
    model.setPose('idle', 0, { deploy: 0 });
    const box = bounds(model.object);
    expect(box.min.y).toBeGreaterThan(-0.08);
    expect(box.min.y).toBeLessThan(0.03);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(size.x * 0.9);
    expect(size.y).toBeGreaterThan(0.6);
    expect(size.y).toBeLessThan(1.6);
    const all = meshes(model.object);
    // One shared material and a few pivoting parts: draw calls and triangles stay soldier-sized.
    expect(new Set(all.map(m => m.material)).size).toBe(1);
    expect(all.length).toBeLessThanOrEqual(14);
    const tris = all.reduce((sum, m) => sum + triangles(m.geometry), 0);
    expect(tris).toBeLessThanOrEqual(2600);
    expect(all.filter(m => m.name === 'wheel').length).toBeGreaterThanOrEqual(2);
  });

  it.each(KINDS)('%s builds through the avatar bridge in every pose without allocating geometry', kind => {
    const avatar = createUnitAvatar(kind, 0x2077ba, 5);
    const geometries = new Set(meshes(avatar.object).map(m => m.geometry));
    for (const pose of ['idle', 'walk', 'attack', 'die']) {
      for (const t of [0, 0.3, 1.7]) avatar.setPose(pose, t, null, { deploy: 1, sinceFire: t });
    }
    expect(new Set(meshes(avatar.object).map(m => m.geometry))).toEqual(geometries);
    expect(avatar.object.userData.unitKind).toBe(kind);
    expect(avatar.object.getObjectByName('player-cloth')).toBeTruthy();
  });

  it('poses a large siege army quickly (benchmark: 60 engines × 120 frames)', () => {
    const avatars = Array.from({ length: 60 }, (_, i) => createUnitAvatar(KINDS[i % 3], 0x2077ba, i));
    const poses = ['idle', 'walk', 'attack'];
    const started = performance.now();
    for (let frame = 0; frame < 120; frame++) {
      const t = frame / 60;
      avatars.forEach((avatar, i) => avatar.setPose(poses[(i + frame) % 3], t, null, { deploy: (frame % 30) / 29, sinceFire: t % 5 }));
    }
    const perFrame = (performance.now() - started) / 120;
    // Pivot moves only; generous so a loaded machine does not flake (about 0.05 ms on a dev box).
    expect(perFrame).toBeLessThan(perfBudget(4));
  });

  it('rolls wheels when walking and leaves them still when idle', () => {
    const model = createSiegeEngine('ram', { seed: 1 });
    const wheel = model.object.getObjectByName('wheel0')!;
    model.setPose('walk', 0.7);
    expect(Math.abs(wheel.rotation.x)).toBeGreaterThan(0.5);
    model.setPose('idle', 0.7);
    expect(wheel.rotation.x).toBe(0);
  });

  it('slumps a wrecked engine over as it dies', () => {
    for (const kind of KINDS) {
      const model = createSiegeEngine(kind, { seed: 1 });
      model.setPose('die', 0, { progress: 1 });
      const rig = model.object.getObjectByName('soldierRig')!;
      expect(Math.abs(rig.rotation.z), kind).toBeGreaterThan(0.3);
    }
  });
});

describe('ram', () => {
  it('swings its beam forward on each blow and back between blows', () => {
    const reload = UNITS.ram.reload;
    expect(ramSwing(0, reload)).toBeCloseTo(1, 5);
    expect(ramSwing(reload / 2, reload)).toBeCloseTo(-1, 5);
    expect(ramSwing(reload, reload)).toBeCloseTo(1, 5);
    // Blows stopped: the beam comes to rest.
    expect(ramSwing(reload * 3, reload)).toBe(0);
    expect(ramSwing(Infinity, reload)).toBe(0);

    const model = createSiegeEngine('ram', { seed: 2 });
    const beam = model.object.getObjectByName('ram-beam')!;
    model.setPose('idle', 0);
    const rest = beam.position.clone();
    model.setPose('attack', 0, { sinceFire: 0 });
    expect(beam.position.z).toBeGreaterThan(rest.z + 0.2);
    expect(beam.position.y).toBeGreaterThan(rest.y);
    model.setPose('attack', 0, { sinceFire: reload / 2 });
    expect(beam.position.z).toBeLessThan(rest.z - 0.2);
    // The bronze head stays ahead of the shed's nose at full swing.
    model.setPose('attack', 0, { sinceFire: 0 });
    const head = bounds(beam).max.z;
    expect(head).toBeGreaterThan(bounds(model.object.getObjectByName('ram-shed')!).max.z);
  });
});

describe('catapult', () => {
  it('stows the arm and lifts its outriggers when packed, cocks and plants them when set up', () => {
    const model = createSiegeEngine('catapult', { seed: 4 });
    const arm = model.object.getObjectByName('catapult-arm')!;
    const stone = model.object.getObjectByName('catapult-stone')!;
    const leg = model.object.getObjectByName('catapult-leg')!;
    model.setPose('idle', 0, { deploy: 0 });
    expect(arm.rotation.x).toBeCloseTo(ARM_STOWED, 5);
    expect(stone.visible).toBe(false);
    const packedFoot = bounds(leg).min.y;
    model.setPose('idle', 0, { deploy: 0.5 });
    const halfway = arm.rotation.x;
    expect(halfway).toBeLessThan(ARM_STOWED);
    expect(halfway).toBeGreaterThan(ARM_COCKED);
    model.setPose('idle', 0, { deploy: 1 });
    expect(arm.rotation.x).toBeCloseTo(ARM_COCKED, 5);
    expect(stone.visible).toBe(true);
    const plantedFoot = bounds(leg).min.y;
    expect(plantedFoot).toBeLessThan(packedFoot - 0.1);
    expect(plantedFoot).toBeLessThan(0.03);
  });

  it('throws the arm on the shot and is cocked again before the next one', () => {
    const reload = UNITS.catapult.reload;
    expect(catapultArm(Infinity, reload)).toBe(ARM_COCKED);
    expect(catapultArm(0, reload)).toBeCloseTo(ARM_COCKED, 5);
    expect(catapultArm(THROW_SECONDS, reload)).toBeCloseTo(ARM_THROWN, 2);
    expect(catapultArm(0.4, reload)).toBeGreaterThan(ARM_THROWN - 0.1);
    expect(catapultArm(reload * 0.7, reload)).toBeCloseTo(ARM_COCKED, 5);
    expect(catapultArm(reload - 0.01, reload)).toBeCloseTo(ARM_COCKED, 5);
    // Monotonic swing up, then monotonic wind back down.
    let last = -Infinity;
    for (let s = 0; s <= THROW_SECONDS; s += 0.02) {
      const a = catapultArm(s, reload);
      expect(a).toBeGreaterThanOrEqual(last - 1e-9);
      last = a;
    }

    const model = createSiegeEngine('catapult', { seed: 4 });
    const arm = model.object.getObjectByName('catapult-arm')!;
    const stone = model.object.getObjectByName('catapult-stone')!;
    model.setPose('attack', 0, { deploy: 1, sinceFire: 0.3 });
    expect(arm.rotation.x).toBeGreaterThan(0);
    expect(stone.visible).toBe(false);
    model.setPose('attack', 0, { deploy: 1, sinceFire: reload * 0.8 });
    expect(arm.rotation.x).toBeCloseTo(ARM_COCKED, 5);
    expect(stone.visible).toBe(true);
    // Mid-pack it never throws, even in the attack pose.
    model.setPose('attack', 0, { deploy: 0.5, sinceFire: 0.1 });
    expect(arm.rotation.x).toBeGreaterThan(ARM_COCKED);
    expect(arm.rotation.x).toBeLessThan(ARM_STOWED);
  });

  it('arm tip passes the crossbar height only when thrown', () => {
    const model = createSiegeEngine('catapult', { seed: 1 });
    const arm = model.object.getObjectByName('catapult-arm')!;
    const tip = new THREE.Object3D();
    tip.position.set(0, 0.88, 0);
    arm.add(tip);
    model.setPose('attack', 0, { deploy: 1, sinceFire: Infinity });
    const cocked = worldPos(tip);
    model.setPose('attack', 0, { deploy: 1, sinceFire: THROW_SECONDS });
    const thrown = worldPos(tip);
    expect(cocked.z).toBeLessThan(-0.5);
    expect(thrown.y).toBeGreaterThan(1);
    expect(thrown.z).toBeGreaterThan(cocked.z + 0.6);
  });
});

describe('bolt shooter', () => {
  it('folds its bow and tips nose-down packed, spreads and levels when set up', () => {
    const model = createSiegeEngine('boltShooter', { seed: 2 });
    const mount = model.object.getObjectByName('bolt-mount')!;
    const left = model.object.getObjectByName('bolt-arm-left')!;
    const bolt = model.object.getObjectByName('bolt-loaded')!;
    model.setPose('idle', 0, { deploy: 0 });
    const packedFold = Math.abs(left.rotation.y);
    expect(mount.rotation.x).toBeGreaterThan(0.4);
    expect(bolt.visible).toBe(false);
    model.setPose('idle', 0, { deploy: 1 });
    expect(Math.abs(left.rotation.y)).toBeLessThan(packedFold - 0.5);
    expect(Math.abs(mount.rotation.x)).toBeLessThan(0.1);
    expect(bolt.visible).toBe(true);
  });

  it('snaps the string forward on the shot and winches it back before the next', () => {
    const reload = UNITS.boltShooter.reload;
    expect(boltDraw(Infinity, reload)).toBe(1);
    expect(boltDraw(0, reload)).toBe(1);
    expect(Math.abs(boltDraw(0.06, reload))).toBeLessThan(0.01);
    expect(Math.abs(boltDraw(0.2, reload))).toBeLessThan(0.15);
    expect(boltDraw(reload * 0.6, reload)).toBeCloseTo(1, 5);

    const model = createSiegeEngine('boltShooter', { seed: 2 });
    const string = model.object.getObjectByName('bolt-string')!;
    const bolt = model.object.getObjectByName('bolt-loaded')!;
    model.setPose('attack', 0, { deploy: 1, sinceFire: Infinity });
    const drawn = string.position.z;
    const drawnWidth = string.scale.x;
    expect(bolt.visible).toBe(true);
    model.setPose('attack', 0, { deploy: 1, sinceFire: 0.07 });
    expect(string.position.z).toBeGreaterThan(drawn + 0.2);
    expect(string.scale.x).toBeGreaterThan(drawnWidth);
    expect(bolt.visible).toBe(false);
    model.setPose('attack', 0, { deploy: 1, sinceFire: reload * 0.7 });
    expect(string.position.z).toBeCloseTo(drawn, 5);
    expect(bolt.visible).toBe(true);
  });
});

describe('siege workshop', () => {
  it('fits its footprint for every civ, with a civ-specific hall', () => {
    const { w, d } = BUILDINGS.siegeWorkshop.size;
    const shapes = new Set<number>();
    for (const civ of CIV_IDS) {
      const model = buildingModel('siegeWorkshop', { civ, color: 0x2077ba });
      const size = bounds(model).getSize(new THREE.Vector3());
      expect(size.x, civ).toBeCloseTo(w, 1);
      expect(size.z, civ).toBeCloseTo(d, 1);
      expect(size.y, civ).toBeGreaterThan(2);
      expect(size.y, civ).toBeLessThan(3.6);
      const all = meshes(model);
      expect(all.length).toBe(1);
      expect(triangles(all[0].geometry), civ).toBeLessThanOrEqual(4000);
      shapes.add(triangles(all[0].geometry));
    }
    expect(shapes.size).toBe(CIV_IDS.length);
    // No civ given: the Hellenic hall.
    expect(triangles(meshes(buildingModel('siegeWorkshop'))[0].geometry))
      .toBe(triangles(meshes(buildingModel('siegeWorkshop', { civ: 'hellenes' }))[0].geometry));
  });
});

describe('siege projectiles', () => {
  it('builds a chunky boulder and a long bolt with its long axis on +Y', () => {
    const boulder = projectileGeometry('boulder');
    const stone = projectileGeometry('stone');
    expect(boulder.boundingSphere!.radius).toBeGreaterThan(stone.boundingSphere!.radius * 1.5);
    const bolt = projectileGeometry('bolt');
    bolt.computeBoundingBox();
    const size = bolt.boundingBox!.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(1.2);
    expect(size.y).toBeGreaterThan(size.x * 5);
    expect(triangles(boulder)).toBeLessThanOrEqual(40);
    expect(triangles(bolt)).toBeLessThanOrEqual(80);
    expect(projectileGeometry('bolt')).toBe(bolt);
  });

  it('lobs boulders high and flies bolts almost flat', () => {
    expect(arcHeight('boulder', 14)).toBeGreaterThan(arcHeight('arrow', 14) * 2);
    expect(arcHeight('bolt', 14)).toBeLessThan(arcHeight('arrow', 14) / 2);
  });

  it('flies exactly the sim flight time on the sim clock and lands once at the aim point', () => {
    const scene = new THREE.Group();
    const pool = new ProjectilePool(scene);
    const landed: Array<[string, number, number, number | null]> = [];
    pool.onLand = (kind, x, _y, z, targetId) => landed.push([kind, x, z, targetId]);
    const mesh = () => pool.object.children.find(child => child.visible);
    pool.launch('boulder', { x: 0, z: 0 }, { x: 14, z: 0 }, 2, () => 0, { start: 10, targetId: 7 });
    // The frame after the shot is drawn a little later than the shot: it is already on its way.
    pool.update(10.5);
    expect(mesh()!.position.x).toBeCloseTo(3.5, 5);
    pool.update(11);
    expect(mesh()!.position.x).toBeCloseTo(7, 5);
    expect(mesh()!.position.y).toBeGreaterThan(arcHeight('boulder', 14));
    pool.update(11.99);
    expect(mesh()).toBeTruthy();
    expect(landed).toHaveLength(0);
    pool.update(12);
    expect(mesh()).toBeUndefined();
    expect(landed).toEqual([['boulder', 14, 0, 7]]);
    pool.update(13);
    expect(landed).toHaveLength(1);
  });

  it('lands a shot armed after its whole flight (a long frame) straight away', () => {
    const pool = new ProjectilePool(new THREE.Group());
    let landed = 0;
    pool.onLand = () => { landed++; };
    pool.launch('bolt', { x: 0, z: 0 }, { x: 3, z: 0 }, 0.2, () => 0, { start: 5 });
    pool.update(6);
    expect(landed).toBe(1);
    expect(pool.object.children.every(child => !child.visible)).toBe(true);
  });
});

describe('impact puffs', () => {
  it('swells, rises and fades over IMPACT_SECONDS, reusing a fixed pool', () => {
    const puffs = new ImpactPuffs(new THREE.Group(), { tier: 'low' });
    puffs.update(0);
    puffs.spawn('dust', 5, 1, 5, 2);
    const n = puffs.active;
    expect(n).toBeGreaterThan(0);
    const first = puffs.object.children[0] as THREE.Mesh;
    const startY = first.position.y;
    const startScale = first.scale.x;
    puffs.update(IMPACT_SECONDS / 2);
    expect(first.position.y).toBeGreaterThan(startY);
    expect(first.scale.x).toBeGreaterThan(startScale);
    expect(((first.material as THREE.MeshBasicMaterial).opacity)).toBeLessThan(0.5);
    puffs.update(IMPACT_SECONDS);
    expect(puffs.active).toBe(0);
    for (let i = 0; i < 40; i++) puffs.spawn('debris', i, 0, 0, 1);
    expect(puffs.object.children.length).toBeLessThanOrEqual(12);
  });
});

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
    { townCenter: { x: 40, z: 40 }, villagers: [{ x: 42, z: 42 }], scouts: [], nodes: [], props: [] },
    defaultPlayers(2),
  );
}

describe('siege in the entity views', () => {
  beforeAll(installCanvasMock);

  it('times the throw to the shot, then kicks up dust where the boulder lands', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(40, 10, 50);
    camera.lookAt(40, 1, 40);
    const catapult = world.spawnUnit('catapult', { x: 38, z: 38 });
    catapult.deployed = true;
    world.setState(catapult, 'attacking');
    const view = views.object.children.find(child => child.userData.entityId === catapult.id)!;
    const arm = view.getObjectByName('catapult-arm')!;
    const impacts = views.object.getObjectByName('impacts')!;
    const at = (time: number) => {
      world.time = time;
      views.sync(1, time, camera);
    };
    at(1);
    expect(arm.rotation.x).toBeLessThan(0);
    world.events.emit({ type: 'projectile', kind: 'boulder', from: { x: 38, z: 38 }, to: { x: 41, z: 41 }, flight: 1, targetId: 999, by: catapult.id });
    // Aim it at the villager so the visual pose is attack.
    catapult.target = world.units.values().next().value!.id;
    at(1 + THROW_SECONDS);
    expect(view.userData.pose).toBe('attack');
    expect(arm.rotation.x).toBeCloseTo(ARM_THROWN, 1);
    expect(impacts.children.filter(child => child.visible)).toHaveLength(0);
    at(2);
    expect(impacts.children.filter(child => child.visible).length).toBeGreaterThan(0);
  });

  it('packs the catapult arm down while the sim packs it', () => {
    const world = makeWorld();
    const views = new EntityViews(world);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    const catapult = world.spawnUnit('catapult', { x: 38, z: 38 });
    const view = views.object.children.find(child => child.userData.entityId === catapult.id)!;
    const arm = view.getObjectByName('catapult-arm')!;
    views.sync(1, 0, camera);
    expect(arm.rotation.x).toBeCloseTo(ARM_STOWED, 5);
    const full = UNITS.catapult.packTime!;
    catapult.packTimer = full / 2;
    world.setState(catapult, 'unpacking');
    views.sync(1, 0.1, camera);
    expect(arm.rotation.x).toBeLessThan(ARM_STOWED - 0.5);
    expect(arm.rotation.x).toBeGreaterThan(ARM_COCKED + 0.5);
    delete catapult.packTimer;
    catapult.deployed = true;
    world.setState(catapult, 'idle');
    views.sync(1, 0.2, camera);
    expect(arm.rotation.x).toBeCloseTo(ARM_COCKED, 5);
  });
});
