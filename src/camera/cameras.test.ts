import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Input } from '../input/Input';
import { pickGround3, screenRay } from '../input/pickGround';
import { testField } from '../input/testField';
import { EYE_HEIGHT, FpsCamera } from './FpsCamera';
import { edgeScrollDir, MAX_DISTANCE, MIN_DISTANCE, RtsCamera } from './RtsCamera';

const W = 1280;
const H = 720;

const makeCamera = () => new THREE.PerspectiveCamera(50, W / H, 0.1, 400);

function toPx(p: THREE.Vector3, cam: THREE.Camera): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

function fakeInput(keys: string[] = []): Input {
  const held = new Set(keys);
  return {
    key: (c: string) => held.has(c),
    isDown: () => false,
    drag: () => undefined,
    shift: held.has('ShiftLeft'),
    moveX: 0,
    moveY: 0,
    wheel: 0,
    inside: false,
    overHud: false,
  } as unknown as Input;
}

describe('RtsCamera zoom-to-cursor', () => {
  const cursors = [
    [640, 360],
    [200, 150],
    [1100, 600],
    [900, 250],
  ];

  for (const flat of [true, false]) {
    it(`keeps the terrain point under the cursor (${flat ? 'flat' : 'hilly'})`, () => {
      const hf = testField(flat);
      for (const [cx, cy] of cursors) {
        for (const factor of [0.7, 1.3]) {
          const rts = new RtsCamera(makeCamera(), hf, { x: 32, z: 26 });
          const g = pickGround3(screenRay(rts.camera, cx, cy, W, H), hf)!;
          expect(g).not.toBeNull();
          rts.zoomAt(cx, cy, W, H, factor);
          if (flat) expect(rts.distance).toBeCloseTo(26 * factor);
          else expect(Math.sign(rts.distance - 26)).toBe(Math.sign(factor - 1));
          const px = toPx(g, rts.camera);
          expect(Math.hypot(px.x - cx, px.y - cy)).toBeLessThan(1);
        }
      }
    });
  }

  it('holds the cursor point through smoothed wheel zoom', () => {
    const hf = testField();
    for (const wheel of [-400, 200]) {
      const rts = new RtsCamera(makeCamera(), hf, { x: 20, z: 20 });
      const [cx, cy] = [300, 200];
      const g = pickGround3(screenRay(rts.camera, cx, cy, W, H), hf)!;
      for (let i = 0; i < 60; i++) {
        const input = Object.assign(fakeInput(), { wheel: i === 0 ? wheel : 0, x: cx, y: cy, width: W, height: H });
        rts.update(1 / 60, input);
        const px = toPx(g, rts.camera);
        expect(Math.hypot(px.x - cx, px.y - cy)).toBeLessThan(1);
      }
      expect(rts.distance).not.toBeCloseTo(26);
    }
  });

  it('clamps distance', () => {
    const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
    rts.zoomAt(640, 360, W, H, 0.01);
    expect(rts.distance).toBe(MIN_DISTANCE);
    rts.zoomAt(640, 360, W, H, 100);
    expect(rts.distance).toBe(MAX_DISTANCE);
  });

  it('keeps the camera above the terrain', () => {
    const hf = testField();
    const rts = new RtsCamera(makeCamera(), hf, { x: 10, z: 40 });
    rts.update(1 / 60, fakeInput());
    const p = rts.camera.position;
    expect(p.y).toBeGreaterThan(Math.max(hf.heightAt(Math.min(p.x, 64), Math.min(p.z, 48)), 0));
  });
});

describe('edgeScrollDir', () => {
  it('scrolls only within 18 px of an edge', () => {
    expect(edgeScrollDir(640, 360, W, H)).toEqual({ x: 0, y: 0 });
    expect(edgeScrollDir(5, 360, W, H)).toEqual({ x: -1, y: 0 });
    expect(edgeScrollDir(W - 3, 2, W, H)).toEqual({ x: 1, y: -1 });
    expect(edgeScrollDir(640, H - 10, W, H)).toEqual({ x: 0, y: 1 });
    expect(edgeScrollDir(19, 19, W, H)).toEqual({ x: 0, y: 0 });
  });
});

describe('FpsCamera', () => {
  it('stands at eye height above the ground', () => {
    const hf = testField();
    const fps = new FpsCamera(makeCamera(), hf);
    fps.enter({ x: 30, z: 30 }, 0);
    expect(fps.camera.position.y).toBeCloseTo(hf.heightAt(30, 30) + EYE_HEIGHT);
  });

  it('walks along −z at yaw 0', () => {
    const fps = new FpsCamera(makeCamera(), testField());
    fps.enter({ x: 30, z: 30 }, 0);
    fps.update(0.5, fakeInput(['KeyW']));
    expect(fps.pos.z).toBeLessThan(30);
    expect(fps.pos.x).toBeCloseTo(30);
  });

  it('is blocked by water and the map edge', () => {
    const hf = testField();
    const fps = new FpsCamera(makeCamera(), hf);
    fps.enter({ x: 10, z: 16 }, 0); // the pit lies straight ahead at (10, 10)
    for (let i = 0; i < 200; i++) {
      fps.update(1 / 30, fakeInput(['KeyW', 'ShiftLeft']));
      expect(hf.isWater(fps.pos.x, fps.pos.z)).toBe(false);
    }
    fps.enter({ x: 60, z: 30 }, -Math.PI / 2); // facing +x
    for (let i = 0; i < 200; i++) fps.update(1 / 30, fakeInput(['KeyW']));
    expect(fps.pos.x).toBeLessThanOrEqual(64);
  });

  it('nudges an entry point out of the water', () => {
    const hf = testField();
    const fps = new FpsCamera(makeCamera(), hf);
    fps.enter({ x: 10, z: 10 }, 0);
    expect(hf.isWater(fps.pos.x, fps.pos.z)).toBe(false);
  });
});
