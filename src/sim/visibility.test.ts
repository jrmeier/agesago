import { describe, expect, it } from 'vitest';
import { EXPLORED, UNEXPLORED, VISIBLE, Visibility } from './visibility';

describe('Visibility', () => {
  it('starts unexplored, reveals within sight, and remembers explored cells', () => {
    const vis = new Visibility(40, 30);
    expect(vis.stateAt(10, 10)).toBe(UNEXPLORED);

    vis.update([{ pos: { x: 10, z: 10 }, sight: 5 }]);
    expect(vis.stateAt(10, 10)).toBe(VISIBLE);
    expect(vis.stateAt(14, 10)).toBe(VISIBLE);
    expect(vis.stateAt(16, 10)).toBe(UNEXPLORED);
    expect(vis.stateAt(14.2, 14.2)).toBe(UNEXPLORED); // outside the circle, inside its square

    vis.update([{ pos: { x: 30, z: 20 }, sight: 5 }]);
    expect(vis.stateAt(10, 10)).toBe(EXPLORED);
    expect(vis.isExplored(10, 10)).toBe(true);
    expect(vis.isVisible(10, 10)).toBe(false);
    expect(vis.isVisible(30, 20)).toBe(true);
  });

  it('bumps version only when something changes', () => {
    const vis = new Visibility(20, 20);
    const viewer = { pos: { x: 5, z: 5 }, sight: 3 };
    vis.update([viewer]);
    const v = vis.version;
    vis.update([viewer]);
    expect(vis.version).toBe(v);
    viewer.pos = { x: 12, z: 12 };
    vis.update([viewer]);
    expect(vis.version).toBe(v + 1);
  });

  it('clips at the map edge and reports explored fraction', () => {
    const vis = new Visibility(10, 10);
    vis.update([{ pos: { x: 0, z: 0 }, sight: 4 }]);
    expect(vis.stateAt(-1, 0)).toBe(UNEXPLORED);
    expect(vis.exploredFraction).toBeGreaterThan(0.1);
    expect(vis.exploredFraction).toBeLessThan(0.2);
  });
});
