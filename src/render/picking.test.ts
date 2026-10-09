import { describe, expect, it } from 'vitest';
import { choosePick, ndcToCanvas, PICK_RANK, rectContains } from './picking';

describe('rectContains', () => {
  it('includes the interior and the edges', () => {
    expect(rectContains(0, 0, -1, -1, 1, 1)).toBe(true);
    expect(rectContains(1, -1, -1, -1, 1, 1)).toBe(true);
    expect(rectContains(1.01, 0, -1, -1, 1, 1)).toBe(false);
  });

  it('accepts an inverted drag box', () => {
    expect(rectContains(10, 12, 40, 30, 5, 8)).toBe(true);
    expect(rectContains(4, 12, 40, 30, 5, 8)).toBe(false);
  });
});

describe('ndcToCanvas', () => {
  it('maps NDC onto canvas CSS pixels with y down', () => {
    expect(ndcToCanvas(-1, 1, 200, 100)).toEqual({ x: 0, y: 0 });
    expect(ndcToCanvas(0, 0, 200, 100)).toEqual({ x: 100, y: 50 });
    expect(ndcToCanvas(1, -1, 200, 100)).toEqual({ x: 200, y: 100 });
  });

  it('lands a centred NDC point inside a canvas drag rect', () => {
    const p = ndcToCanvas(0, 0, 200, 100);
    expect(rectContains(p.x, p.y, 90, 110, 120, 40)).toBe(true);
    expect(rectContains(p.x, p.y, 0, 0, 10, 10)).toBe(false);
  });
});

describe('choosePick', () => {
  it('returns null when nothing was hit', () => {
    expect(choosePick([])).toBeNull();
  });

  it('prefers villagers over nearer nodes, and nodes over the town center', () => {
    const id = choosePick([
      { id: 1, rank: PICK_RANK.townCenter, depth: 1 },
      { id: 2, rank: PICK_RANK.node, depth: 4 },
      { id: 3, rank: PICK_RANK.villager, depth: 20 },
    ]);
    expect(id).toBe(3);
  });

  it('picks the nearer candidate within a rank', () => {
    const id = choosePick([
      { id: 8, rank: PICK_RANK.node, depth: 12 },
      { id: 4, rank: PICK_RANK.node, depth: 5 },
      { id: 9, rank: PICK_RANK.townCenter, depth: 1 },
    ]);
    expect(id).toBe(4);
  });
});
