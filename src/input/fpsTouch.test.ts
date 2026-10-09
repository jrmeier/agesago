import { describe, expect, it } from 'vitest';
import { FpsTouch, STICK_DEAD_ZONE, STICK_RADIUS_PX, stickKnob, stickVector } from './fpsTouch';

const R = STICK_RADIUS_PX;

describe('stickVector', () => {
  it('is zero at rest and inside the dead zone', () => {
    expect(stickVector(100, 100, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(stickVector(100, 100, 100 + R * STICK_DEAD_ZONE * 0.9, 100)).toEqual({ x: 0, y: 0 });
  });

  it('maps screen up to forward and screen right to strafe right', () => {
    const up = stickVector(0, 0, 0, -R);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    const right = stickVector(0, 0, R, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });

  it('rises linearly from the dead zone and caps at unit length beyond the ring', () => {
    const half = R * (STICK_DEAD_ZONE + (1 - STICK_DEAD_ZONE) / 2);
    expect(stickVector(0, 0, 0, half).y).toBeCloseTo(-0.5);
    const far = stickVector(0, 0, 3 * R, -3 * R);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
    expect(far.x).toBeCloseTo(Math.SQRT1_2);
    expect(far.y).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('stickKnob', () => {
  it('follows the thumb inside the ring and is clamped to it outside', () => {
    expect(stickKnob(10, 10, 20, 30)).toEqual({ x: 10, y: 20 });
    const k = stickKnob(0, 0, 0, 5 * R);
    expect(k.x).toBeCloseTo(0);
    expect(k.y).toBeCloseTo(R);
    expect(stickKnob(5, 5, 5, 5)).toEqual({ x: 0, y: 0 });
  });
});

describe('FpsTouch', () => {
  const W = 800;

  it('left-half finger drives the joystick centred where it landed', () => {
    const t = new FpsTouch();
    t.down(1, 100, 400, W);
    expect(t.stick).toMatchObject({ cx: 100, cy: 400 });
    t.move(1, 100, 400 - R);
    expect(t.vector.y).toBeCloseTo(1);
    t.up(1);
    expect(t.stick).toBeNull();
    expect(t.vector).toEqual({ x: 0, y: 0 });
  });

  it('right-half finger accumulates look drag until taken', () => {
    const t = new FpsTouch();
    t.down(2, 600, 300, W);
    t.move(2, 620, 290);
    t.move(2, 650, 280);
    expect(t.takeLook()).toEqual({ x: 50, y: -20 });
    expect(t.takeLook()).toEqual({ x: 0, y: 0 });
    expect(t.vector).toEqual({ x: 0, y: 0 });
  });

  it('runs joystick and look at the same time; extra fingers are ignored', () => {
    const t = new FpsTouch();
    t.down(1, 100, 400, W);
    t.down(2, 600, 300, W);
    t.down(3, 150, 380, W);
    t.down(4, 700, 300, W);
    t.move(3, 150, 0);
    t.move(4, 0, 0);
    expect(t.vector).toEqual({ x: 0, y: 0 });
    expect(t.takeLook()).toEqual({ x: 0, y: 0 });
    t.move(1, 100 + R, 400);
    t.move(2, 610, 300);
    expect(t.vector.x).toBeCloseTo(1);
    expect(t.takeLook()).toEqual({ x: 10, y: 0 });
  });

  it('reset releases both', () => {
    const t = new FpsTouch();
    t.down(1, 100, 400, W);
    t.down(2, 600, 300, W);
    t.move(2, 700, 300);
    t.reset();
    expect(t.stick).toBeNull();
    expect(t.takeLook()).toEqual({ x: 0, y: 0 });
    t.move(2, 800, 300);
    expect(t.takeLook()).toEqual({ x: 0, y: 0 });
  });
});
