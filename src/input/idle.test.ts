import { describe, expect, it } from 'vitest';
import type { Unit } from '../core/types';
import { IdleCycler, idleVillagers } from './idle';

const u = (id: number, kind: Unit['kind'], owner: number, state: Unit['state']) => ({ id, kind, owner, state, pos: { x: id, z: 0 } });

describe('idle villagers', () => {
  const units = [
    u(7, 'villager', 1, 'idle'),
    u(2, 'villager', 1, 'idle'),
    u(3, 'villager', 1, 'gathering'),
    u(4, 'scout', 1, 'idle'),
    u(5, 'villager', 2, 'idle'),
    u(6, 'hoplite', 1, 'idle'),
  ];

  it('lists only the owner’s idle villagers, in id order', () => {
    expect(idleVillagers(units, 1).map((v) => v.id)).toEqual([2, 7]);
    expect(idleVillagers(units, 2).map((v) => v.id)).toEqual([5]);
  });

  it('cycles through them, wrapping, and copes with the list changing', () => {
    const c = new IdleCycler();
    const idle = idleVillagers(units, 1);
    expect(c.next(idle)?.id).toBe(2);
    expect(c.next(idle)?.id).toBe(7);
    expect(c.next(idle)?.id).toBe(2);
    // Villager 2 went to work; the cycle carries on from where it was.
    expect(c.next(idle.filter((v) => v.id !== 2))?.id).toBe(7);
    expect(c.next([])).toBeNull();
    expect(c.next(idle)?.id).toBe(2);
  });
});
