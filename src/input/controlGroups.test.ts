import { describe, expect, it } from 'vitest';
import { ControlGroups, DOUBLE_TAP_S, groupCentre } from './controlGroups';

describe('control groups', () => {
  it('assigns, replaces and clears groups', () => {
    const g = new ControlGroups();
    g.assign(1, [3, 4, 4]);
    expect(g.get(1)).toEqual([3, 4]);
    g.assign(1, [9]);
    expect(g.get(1)).toEqual([9]);
    g.assign(1, []);
    expect(g.get(1)).toEqual([]);
    expect(g.get(2)).toEqual([]);
  });

  it('moves an id out of its old group when assigned elsewhere', () => {
    const g = new ControlGroups();
    g.assign(1, [1, 2, 3]);
    g.assign(2, [3, 4]);
    expect(g.get(1)).toEqual([1, 2]);
    expect(g.get(2)).toEqual([3, 4]);
  });

  it('adds to a group without duplicates', () => {
    const g = new ControlGroups();
    g.assign(5, [1]);
    g.add(5, [1, 2]);
    expect(g.get(5)).toEqual([1, 2]);
  });

  it('round-trips groups and drops ids that are no longer alive', () => {
    const g = new ControlGroups();
    g.assign(2, [4, 5]);
    g.assign(1, [1, 2]);
    const copy = new ControlGroups();
    copy.restore(g.snapshot(), (id) => id !== 5);
    expect(copy.snapshot()).toEqual([[2, [4]], [1, [1, 2]]]);
    copy.restore([[9, [8]], [1, [5]]], (id) => id !== 5);
    expect(copy.get(9)).toEqual([8]);
    expect(copy.get(1)).toEqual([]);
    expect(copy.get(2)).toEqual([]);
  });

  it('drops removed entities everywhere and reports sizes', () => {
    const g = new ControlGroups();
    g.assign(1, [1, 2]);
    g.assign(3, [5]);
    const rev = g.rev;
    g.remove(2);
    g.remove(5);
    expect(g.rev).toBeGreaterThan(rev);
    expect(g.sizes()).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('ignores groups outside 1–9', () => {
    const g = new ControlGroups();
    g.assign(0, [1]);
    g.assign(10, [1]);
    expect(g.sizes().every((n) => n === 0)).toBe(true);
  });

  it('treats a quick second press of the same group as centre', () => {
    const g = new ControlGroups();
    expect(g.press(1, 10)).toBe('select');
    expect(g.press(1, 10 + DOUBLE_TAP_S / 2)).toBe('centre');
    // A third press starts over.
    expect(g.press(1, 10 + DOUBLE_TAP_S)).toBe('select');
    expect(g.press(2, 10 + DOUBLE_TAP_S * 1.1)).toBe('select');
    expect(g.press(2, 20)).toBe('select');
  });

  it('centres on the mean position of the living members', () => {
    const pos = new Map([
      [1, { x: 0, z: 0 }],
      [2, { x: 10, z: 4 }],
    ]);
    expect(groupCentre([1, 2, 3], (id) => pos.get(id))).toEqual({ x: 5, z: 2 });
    expect(groupCentre([3], (id) => pos.get(id))).toBeNull();
  });
});
