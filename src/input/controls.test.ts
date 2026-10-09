import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { classifyRelease, rectBetween } from './Controls';
import { DRAG_THRESHOLD_PX, exceedsDragThreshold } from './Input';
import { pickGround, pickGround3 } from './pickGround';
import { testField } from './testField';

describe('click vs drag', () => {
  it('uses a 5 px threshold', () => {
    expect(exceedsDragThreshold(0, 0, DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(exceedsDragThreshold(0, 0, 3, 4)).toBe(false);
    expect(exceedsDragThreshold(0, 0, 4, 4)).toBe(true);
  });

  it('classifies releases', () => {
    expect(classifyRelease(undefined)).toBeNull();
    expect(classifyRelease({ held: true, dragging: true })).toBeNull();
    expect(classifyRelease({ held: false, dragging: false })).toBe('click');
    expect(classifyRelease({ held: false, dragging: true })).toBe('drag');
  });

  it('normalises box corners', () => {
    expect(rectBetween(30, 5, 10, 20)).toEqual({ x0: 10, y0: 5, x1: 30, y1: 20 });
  });
});

describe('pickGround', () => {
  const down = (x: number, z: number) => new THREE.Ray(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));

  it('hits flat ground straight below', () => {
    const p = pickGround(down(12, 30), testField(true))!;
    expect(p.x).toBeCloseTo(12);
    expect(p.z).toBeCloseTo(30);
  });

  it('finds the first surface crossing of an oblique ray over hills', () => {
    const hf = testField();
    const ray = new THREE.Ray(new THREE.Vector3(30, 25, 50), new THREE.Vector3(0.1, -0.8, -0.6).normalize());
    const p = pickGround3(ray, hf)!;
    expect(p).not.toBeNull();
    expect(Math.abs(p.y - Math.max(hf.heightAt(p.x, p.z), 0))).toBeLessThan(0.01);
    const t = p.distanceTo(ray.origin);
    const q = new THREE.Vector3();
    for (let s = 0; s < t - 0.05; s += 0.05) {
      ray.at(s, q);
      if (q.x >= 0 && q.z >= 0 && q.x <= 64 && q.z <= 48) expect(q.y).toBeGreaterThan(Math.max(hf.heightAt(q.x, q.z), 0) - 1e-6);
    }
  });

  it('treats water as a surface at sea level', () => {
    expect(pickGround3(down(10, 10), testField())!.y).toBeCloseTo(0);
  });

  it('returns null when the ray misses the map', () => {
    expect(pickGround(down(-5, 10), testField())).toBeNull();
    const up = new THREE.Ray(new THREE.Vector3(10, 50, 10), new THREE.Vector3(0, 1, 0));
    expect(pickGround(up, testField())).toBeNull();
  });
});
