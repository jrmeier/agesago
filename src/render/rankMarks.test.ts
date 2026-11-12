import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GRASS_ONLY, type Heightfield, type Unit } from '../core/types';
import { gainXp } from '../sim/systems/veterancy';
import { defaultPlayers, World } from '../sim/World';
import { EntityViews } from './EntityViews';
import {
  CHEVRON_ADVANCED,
  CHEVRON_ELITE,
  PROMOTION_SECONDS,
  SPARKLES,
  chevronColor,
  chevronCount,
  chevronSize,
  promotionGlow,
} from './rankMarks';

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

function makeWorld(soldiers = 0): World {
  return new World(
    field(),
    {
      townCenter: { x: 40, z: 40 },
      villagers: [{ x: 42, z: 42 }],
      scouts: Array.from({ length: soldiers }, (_, i) => ({ x: 30 + (i % 20), z: 30 + Math.floor(i / 20) })),
      nodes: [],
      props: [],
    },
    defaultPlayers(2),
  );
}

function cameraAt(x: number, z: number, height = 6, back = 10): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(x, 1.9 + height, z + back);
  camera.lookAt(x, 1.9, z);
  camera.updateMatrixWorld();
  return camera;
}

const mesh = (views: EntityViews, name: string) => views.object.getObjectByName(name) as THREE.InstancedMesh;
const scouts = (world: World): Unit[] => [...world.units.values()].filter((u) => u.kind === 'scout');

beforeAll(installCanvasMock);

describe('rank mark helpers', () => {
  it('draws one chevron for Advanced and two for Elite', () => {
    expect(chevronCount(undefined)).toBe(0);
    expect(chevronCount(0)).toBe(0);
    expect(chevronCount(1)).toBe(1);
    expect(chevronCount(2)).toBe(2);
    expect(chevronColor(1)).toBe(CHEVRON_ADVANCED);
    expect(chevronColor(2)).toBe(CHEVRON_ELITE);
  });

  it('keeps chevrons readable far away and small up close', () => {
    const fps = chevronSize(3);
    const rts = chevronSize(40);
    expect(fps).toBeLessThan(rts);
    expect(fps).toBeGreaterThan(0);
    expect(chevronSize(1000)).toBe(chevronSize(400));
    expect(chevronSize(0)).toBe(chevronSize(1));
  });

  it('flashes in, rises and fades out', () => {
    const start = promotionGlow(0.05)!;
    const peak = promotionGlow(PROMOTION_SECONDS * 0.15)!;
    const late = promotionGlow(PROMOTION_SECONDS * 0.9)!;
    expect(peak.intensity).toBeCloseTo(1);
    expect(start.intensity).toBeLessThan(peak.intensity);
    expect(late.intensity).toBeLessThan(peak.intensity);
    expect(late.rise).toBeGreaterThan(start.rise);
    expect(promotionGlow(PROMOTION_SECONDS)).toBeNull();
    expect(promotionGlow(-1)).toBeNull();
  });
});

describe('rank marks in the scene', () => {
  it('draws chevrons only over veterans, gold and doubled for Elite', () => {
    const world = makeWorld(2);
    const views = new EntityViews(world);
    const camera = cameraAt(31, 30);
    const [a, b] = scouts(world);
    const fill = () => mesh(views, 'rank-fill');
    views.sync(0, 0, camera);
    expect(fill().count).toBe(0);
    expect(fill().visible).toBe(false);

    gainXp(world, a, 100);
    views.sync(0, 0.1, camera);
    expect(fill().count).toBe(1);
    expect(mesh(views, 'rank-back').count).toBe(1);
    const color = new THREE.Color();
    fill().getColorAt(0, color);
    expect(color.getHex()).toBe(new THREE.Color(CHEVRON_ADVANCED).getHex());

    gainXp(world, b, 300);
    views.sync(0, 0.2, camera);
    expect(fill().count).toBe(3);
    fill().getColorAt(2, color);
    expect(color.getHex()).toBe(new THREE.Color(CHEVRON_ELITE).getHex());

    // The second Elite chevron sits above the first.
    const m1 = new THREE.Matrix4();
    const m2 = new THREE.Matrix4();
    fill().getMatrixAt(1, m1);
    fill().getMatrixAt(2, m2);
    const p1 = new THREE.Vector3().setFromMatrixPosition(m1);
    const p2 = new THREE.Vector3().setFromMatrixPosition(m2);
    expect(p2.y).toBeGreaterThan(p1.y);
    // Above the unit's head, not on the ground.
    expect(p1.y).toBeGreaterThan(2.5);
  });

  it('draws smaller chevrons for a first-person camera than at RTS zoom', () => {
    const world = makeWorld(1);
    const [scout] = scouts(world);
    gainXp(world, scout, 100);
    const views = new EntityViews(world);
    const scale = (camera: THREE.Camera) => {
      views.sync(0, 0, camera);
      const m = new THREE.Matrix4();
      mesh(views, 'rank-fill').getMatrixAt(0, m);
      return new THREE.Vector3().setFromMatrixScale(m).x;
    };
    const rts = scale(cameraAt(30, 30, 30, 22));
    const fps = scale(cameraAt(30, 30, 0.2, 3));
    expect(fps).toBeLessThan(rts);
  });

  it('hides chevrons for a veteran inside a building', () => {
    const world = makeWorld(1);
    const [scout] = scouts(world);
    gainXp(world, scout, 100);
    const views = new EntityViews(world);
    scout.state = 'garrisoned';
    views.sync(0, 0, cameraAt(30, 30));
    expect(mesh(views, 'rank-fill').count).toBe(0);
  });

  it('sparkles briefly where a soldier is promoted', () => {
    const world = makeWorld(1);
    const views = new EntityViews(world);
    const camera = cameraAt(30, 30);
    const sparkle = () => mesh(views, 'promotion-sparkle');
    views.sync(0, 10, camera);
    expect(sparkle().count).toBe(0);
    gainXp(world, scouts(world)[0], 100);
    views.sync(0, 10.1, camera);
    expect(sparkle().count).toBe(SPARKLES);
    expect(sparkle().visible).toBe(true);
    views.sync(0, 10.1 + PROMOTION_SECONDS + 0.01, camera);
    expect(sparkle().count).toBe(0);
    expect(sparkle().visible).toBe(false);
  });

  it('keeps instanced rank marks within the frame budget for a large veteran army', () => {
    const camera = cameraAt(40, 34, 30, 22);
    // Two identical armies, one plain and one ranked, timed in alternating windows and compared
    // best against best: a parallel test run's shifting CPU load then hits both alike (timing them
    // one after the other let a load swing between the two phases break the ratio).
    const plainWorld = makeWorld(200), rankedWorld = makeWorld(200);
    scouts(rankedWorld).forEach((u, i) => gainXp(rankedWorld, u, i % 2 ? 300 : 100));
    const plainViews = new EntityViews(plainWorld), rankedViews = new EntityViews(rankedWorld);
    const time = (views: EntityViews, frames: number) => {
      const start = performance.now();
      for (let f = 0; f < frames; f++) views.sync(0, f / 60, camera);
      return (performance.now() - start) / frames;
    };
    time(plainViews, 10);
    time(rankedViews, 10);
    let plain = Infinity, ranked = Infinity;
    for (let round = 0; round < 6; round++) {
      plain = Math.min(plain, time(plainViews, 10));
      ranked = Math.min(ranked, time(rankedViews, 10));
    }
    expect(mesh(rankedViews, 'rank-fill').count).toBe(300);
    expect(mesh(plainViews, 'rank-fill').count).toBe(0);
    // Two extra instanced draws; the per-unit work is a few matrix writes.
    expect(ranked).toBeLessThan(plain * 1.5 + 0.5);
  });
});
