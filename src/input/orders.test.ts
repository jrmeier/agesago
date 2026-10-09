import { describe, expect, it } from 'vitest';
import type { Unit, Vec2 } from '../core/types';
import { resolveOrder } from './orders';
import { focusNextScout, nextScout } from './scouts';

describe('order resolution under fog', () => {
  const ground = { x: 40, z: 12 };

  it('gathers from an explored node for the whole selection', () => {
    expect(resolveOrder([1, 2], { nodeId: 9, nodeExplored: true, ground: null })).toEqual({
      type: 'gather',
      unitIds: [1, 2],
      nodeId: 9,
    });
  });

  it('treats a node in the black as a plain move', () => {
    expect(resolveOrder([1], { nodeId: 9, nodeExplored: false, ground })).toEqual({ type: 'move', unitIds: [1], target: ground });
  });

  it('moves into unexplored ground, and does nothing off the map or with no selection', () => {
    expect(resolveOrder([3], { nodeId: null, nodeExplored: false, ground })).toEqual({ type: 'move', unitIds: [3], target: ground });
    expect(resolveOrder([3], { nodeId: null, nodeExplored: false, ground: null })).toBeNull();
    expect(resolveOrder([3], { nodeId: 9, nodeExplored: false, ground: null })).toBeNull();
    expect(resolveOrder([], { nodeId: 9, nodeExplored: true, ground })).toBeNull();
  });
});

describe('find scout', () => {
  const at = (id: number, x: number): Pick<Unit, 'id' | 'pos'> => ({ id, pos: { x, z: 0 } });

  it('cycles through scouts in id order', () => {
    const scouts = [at(7, 70), at(3, 30), at(5, 50)];
    expect(nextScout(scouts, null)?.id).toBe(3);
    expect(nextScout(scouts, 3)?.id).toBe(5);
    expect(nextScout(scouts, 5)?.id).toBe(7);
    expect(nextScout(scouts, 7)?.id).toBe(3);
    expect(nextScout(scouts, 4)?.id).toBe(5);
    expect(nextScout([], null)).toBeNull();
  });

  it('centres the camera and remembers the last scout per world', () => {
    const unit = (id: number, kind: Unit['kind'], x: number) => ({ id, kind, pos: { x, z: 1 } }) as Unit;
    const world = { units: new Map([[1, unit(1, 'villager', 10)], [2, unit(2, 'scout', 20)], [4, unit(4, 'scout', 40)]]) };
    const seen: Vec2[] = [];
    const rig = { focusOn: (p: Vec2) => seen.push(p) };
    expect(focusNextScout(world, rig)).toBe(2);
    expect(focusNextScout(world, rig)).toBe(4);
    expect(focusNextScout(world, rig)).toBe(2);
    expect(seen.map((p) => p.x)).toEqual([20, 40, 20]);
    expect(focusNextScout({ units: new Map([[1, unit(1, 'villager', 10)]]) }, rig)).toBeNull();
  });
});
