import { describe, expect, it } from 'vitest';
import type { Heightfield, Vec2 } from '../core/types';
import { NavGrid } from './nav';

/** Flat 64×48 field where `water(x, z)` marks lake cells. */
function flatField(water: (x: number, z: number) => boolean = () => false): Heightfield {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x <= 64 && z <= 48;
  return {
    width: 64,
    depth: 48,
    heightAt: (x, z) => (water(x, z) ? -1 : 0.5),
    isWater: water,
    isWalkable: (x, z) => inside(x, z) && !water(x, z),
    forestDensity: () => 0,
  };
}

const rectLake = (x0: number, z0: number, x1: number, z1: number) => (x: number, z: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;

/** Every point along the path (sampled every 5 cm) is walkable. */
function pathStaysDry(hf: Heightfield, from: Vec2, path: Vec2[]): boolean {
  let a = from;
  for (const b of path) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      if (!hf.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    a = b;
  }
  return true;
}

describe('NavGrid', () => {
  it('returns a direct segment on open ground', () => {
    const nav = new NavGrid(flatField());
    expect(nav.findPath({ x: 5, z: 5 }, { x: 40.3, z: 30.7 })).toEqual([{ x: 40.3, z: 30.7 }]);
  });

  it('routes around a lake and ends exactly at the target', () => {
    const hf = flatField(rectLake(20, 10, 30, 38));
    const nav = new NavGrid(hf);
    const from = { x: 15.2, z: 24.1 };
    const to = { x: 35.7, z: 23.9 };
    const path = nav.findPath(from, to)!;
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(to);
    expect(pathStaysDry(hf, from, path)).toBe(true);
    // Smoothed: a handful of corners, not one waypoint per cell.
    expect(path.length).toBeLessThan(6);
  });

  it('returns null for an enclosed target', () => {
    const ring = (x: number, z: number) => {
      const d = Math.hypot(x - 40, z - 24);
      return d > 4 && d < 7;
    };
    const nav = new NavGrid(flatField(ring));
    expect(nav.findPath({ x: 10, z: 10 }, { x: 40, z: 24 })).toBeNull();
    expect(nav.findPath({ x: 40, z: 24 }, { x: 10, z: 10 })).toBeNull();
  });

  it('paths to the nearest shore when the target is water', () => {
    const hf = flatField(rectLake(20, 10, 30, 38));
    const nav = new NavGrid(hf);
    const path = nav.findPath({ x: 10, z: 24 }, { x: 22, z: 24 })!;
    const end = path[path.length - 1];
    expect(hf.isWalkable(end.x, end.z)).toBe(true);
    expect(end.x).toBeLessThan(20);
    expect(end.x).toBeGreaterThan(19);
  });

  it('keeps villagers out of obstacle footprints and stops at their edge', () => {
    const hf = flatField();
    const tc = { pos: { x: 32, z: 24 }, radius: 1.6 };
    const nav = new NavGrid(hf, [tc]);
    const from = { x: 26, z: 24 };
    const path = nav.findPath(from, { x: 38, z: 24 })!;
    let a = from;
    for (const b of path) {
      for (let t = 0; t <= 1; t += 0.01) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        expect(Math.hypot(x - 32, z - 24)).toBeGreaterThan(1.6);
      }
      a = b;
    }
    const toTc = nav.findPath(from, tc.pos)!;
    const end = toTc[toTc.length - 1];
    expect(Math.hypot(end.x - 32, end.z - 24)).toBeGreaterThan(1.6);
    expect(Math.hypot(end.x - 32, end.z - 24)).toBeLessThan(2.8);
  });

  it('handles a burst of long path requests cheaply', () => {
    const nav = new NavGrid(flatField(rectLake(20, 4, 30, 44)));
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      expect(nav.findPath({ x: 2 + (i % 10), z: 2 + i * 0.4 }, { x: 60 - (i % 7), z: 46 - i * 0.4 })).not.toBeNull();
    }
    // 100 cross-map requests (5 ticks' worth at 20/tick) well under a frame budget each.
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
