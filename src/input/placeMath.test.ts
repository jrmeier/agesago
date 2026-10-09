import { describe, expect, it } from 'vitest';
import { clampToMap, placementPos, rotateQuarter, snapToGrid } from './placeMath';

const Q = Math.PI / 2;

describe('placement snapping', () => {
  it('snaps to the 0.5 grid', () => {
    expect(snapToGrid({ x: 10.24, z: 3.76 })).toEqual({ x: 10, z: 4 });
    expect(snapToGrid({ x: 10.26, z: -0.2 })).toEqual({ x: 10.5, z: -0 });
    expect(snapToGrid({ x: 7, z: 7 }, 2)).toEqual({ x: 8, z: 8 });
  });

  it('keeps the footprint inside the map, honouring rotation', () => {
    // Farm is 4×4 → half 2; house 2.6 → half 1.3.
    expect(clampToMap('farm', { x: 0.5, z: 175 }, 0, 176, 176)).toEqual({ x: 2, z: 174 });
    expect(clampToMap('house', { x: -3, z: 50 }, Q, 176, 176)).toEqual({ x: 1.3, z: 50 });
    const p = placementPos('house', { x: -3, z: 50.2 }, 0, 176, 176);
    expect(p).toEqual({ x: 1.5, z: 50 });
  });
});

describe('placement rotation', () => {
  it('steps a quarter turn either way and wraps', () => {
    expect(rotateQuarter(0)).toBeCloseTo(Q);
    expect(rotateQuarter(Q, 1)).toBeCloseTo(Math.PI);
    expect(rotateQuarter(3 * Q, 1)).toBe(0);
    expect(rotateQuarter(0, -1)).toBeCloseTo(3 * Q);
    expect(rotateQuarter(0, -120)).toBeCloseTo(3 * Q); // wheel deltas: only the sign counts
  });

  it('snaps an off-grid angle to the nearest quarter first', () => {
    expect(rotateQuarter(0.1)).toBeCloseTo(Q);
    expect(rotateQuarter(Q * 4 + 0.05)).toBeCloseTo(Q);
  });
});
