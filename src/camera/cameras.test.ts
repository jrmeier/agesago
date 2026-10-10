import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GestureEvent } from '../input/gestures';
import type { Input } from '../input/Input';
import type { TouchState } from '../input/TouchInput';
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

function fakeTouch(touch: Partial<TouchState> = {}): TouchState {
  return { gestures: [], stick: { x: 0, y: 0 }, lookX: 0, lookY: 0, active: false, ...touch };
}

function fakeInput(keys: string[] = [], touch: Partial<TouchState> = {}): Input {
  const held = new Set(keys);
  return {
    touch: fakeTouch(touch),
    x: 0,
    y: 0,
    width: W,
    height: H,
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

describe('RtsCamera touch', () => {
  const frame = (rts: RtsCamera, gestures: GestureEvent[]) => rts.update(1 / 60, fakeInput([], { gestures, active: true }));

  for (const flat of [true, false]) {
    it(`pinch keeps the ground point under the midpoint (${flat ? 'flat' : 'hilly'})`, () => {
      const hf = testField(flat);
      for (const [mx, my] of [
        [640, 360],
        [300, 250],
        [1000, 520],
      ]) {
        for (const scale of [1.25, 0.8]) {
          const rts = new RtsCamera(makeCamera(), hf, { x: 32, z: 26 });
          const g = pickGround3(screenRay(rts.camera, mx, my, W, H), hf)!;
          frame(rts, [{ type: 'panStart', x: mx, y: my }]);
          for (let i = 0; i < 3; i++) frame(rts, [{ type: 'pan', x: mx, y: my }, { type: 'pinch', x: mx, y: my, scale }]);
          expect(Math.sign(rts.distance - 26)).toBe(-Math.sign(scale - 1));
          const px = toPx(g, rts.camera);
          expect(Math.hypot(px.x - mx, px.y - my)).toBeLessThan(1);
        }
      }
    });
  }

  it('one-finger pan drags the grabbed ground point with the finger', () => {
    const hf = testField(true);
    const rts = new RtsCamera(makeCamera(), hf, { x: 32, z: 26 });
    const g = pickGround3(screenRay(rts.camera, 640, 360, W, H), hf)!;
    frame(rts, [{ type: 'panStart', x: 640, y: 360 }]);
    frame(rts, [
      { type: 'pan', x: 600, y: 380 },
      { type: 'pan', x: 520, y: 420 },
    ]);
    const px = toPx(g, rts.camera);
    expect(Math.hypot(px.x - 520, px.y - 420)).toBeLessThan(1);
    expect(rts.target.x).toBeGreaterThan(32);
    frame(rts, [{ type: 'panEnd' }]);
    const before = { ...rts.target };
    frame(rts, [{ type: 'pan', x: 100, y: 100 }]);
    expect(rts.target).toEqual(before);
  });

  it('a pinch–spread zooms in, a pinch–close zooms out', () => {
    const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
    frame(rts, [{ type: 'pinch', x: 640, y: 360, scale: 2 }]);
    expect(rts.distance).toBeCloseTo(13);
    frame(rts, [{ type: 'pinch', x: 640, y: 360, scale: 0.5 }]);
    expect(rts.distance).toBeCloseTo(26);
  });

  it('does not edge-scroll while touch is active', () => {
    const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
    const input = Object.assign(fakeInput([], { active: true }), { inside: true, clientX: 2, clientY: 2, viewWidth: W, viewHeight: H });
    rts.update(0.5, input);
    expect(rts.target).toEqual({ x: 32, z: 26 });
  });

  it('edge scroll can be switched off, and arrow keys still pan', () => {
    const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
    rts.edgeScroll = false;
    const edge = Object.assign(fakeInput(), { inside: true, clientX: 2, clientY: 360, viewWidth: W, viewHeight: H });
    rts.update(0.5, edge);
    expect(rts.target).toEqual({ x: 32, z: 26 });
    const arrow = Object.assign(fakeInput(['ArrowRight']), { inside: true, clientX: 2, clientY: 360, viewWidth: W, viewHeight: H });
    rts.update(0.5, arrow);
    expect(rts.target.x).toBeGreaterThan(32);
  });

  it('edge speed scales only the edge scroll', () => {
    const shift = (speed: number) => {
      const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
      rts.edgeSpeed = speed;
      const input = Object.assign(fakeInput(), { inside: true, clientX: 2, clientY: 360, viewWidth: W, viewHeight: H });
      rts.update(0.5, input);
      return 32 - rts.target.x;
    };
    expect(shift(2)).toBeCloseTo(shift(1) * 2, 4);
  });

  it('invert pan reverses a finger drag and leaves arrow keys alone', () => {
    const drag = (invert: boolean) => {
      const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
      rts.invertPan = invert;
      const frame = (gestures: GestureEvent[]) => rts.update(1 / 60, fakeInput([], { gestures, active: true }));
      frame([{ type: 'panStart', x: 640, y: 360 }]);
      frame([{ type: 'pan', x: 520, y: 420 }]);
      return rts.target.x - 32;
    };
    expect(Math.sign(drag(true))).toBe(-Math.sign(drag(false)));
    const rts = new RtsCamera(makeCamera(), testField(true), { x: 32, z: 26 });
    rts.invertPan = true;
    const arrow = Object.assign(fakeInput(['ArrowRight']), { inside: false });
    rts.update(0.5, arrow);
    expect(rts.target.x).toBeGreaterThan(32);
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

  it('walks with the touch joystick at analog speed', () => {
    const full = new FpsCamera(makeCamera(), testField(true));
    const half = new FpsCamera(makeCamera(), testField(true));
    full.enter({ x: 30, z: 30 }, 0);
    half.enter({ x: 30, z: 30 }, 0);
    full.update(0.5, fakeInput([], { stick: { x: 0, y: 1 } }));
    half.update(0.5, fakeInput([], { stick: { x: 0, y: 0.5 } }));
    expect(full.pos.z).toBeCloseTo(30 - 2.5);
    expect(half.pos.z).toBeCloseTo(30 - 1.25);
    const strafe = new FpsCamera(makeCamera(), testField(true));
    strafe.enter({ x: 30, z: 30 }, 0);
    strafe.update(0.5, fakeInput([], { stick: { x: 1, y: 0 } }));
    expect(strafe.pos.x).toBeCloseTo(32.5);
  });

  it('turns with a touch look drag', () => {
    const fps = new FpsCamera(makeCamera(), testField());
    fps.enter({ x: 30, z: 30 }, 0);
    fps.update(1 / 60, fakeInput([], { lookX: 100, lookY: -50 }));
    expect(fps.yaw).toBeLessThan(0);
    expect(fps.pitch).toBeGreaterThan(-0.12);
  });

  it('nudges an entry point out of the water', () => {
    const hf = testField();
    const fps = new FpsCamera(makeCamera(), hf);
    fps.enter({ x: 10, z: 10 }, 0);
    expect(hf.isWater(fps.pos.x, fps.pos.z)).toBe(false);
  });
});
