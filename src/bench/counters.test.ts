import { describe, expect, it } from 'vitest';
import { COUNTERS } from '../core/counters';
import { UNITS } from '../core/units';
import { costOf, fight, raze } from './counters';

/**
 * M16-9: every row of the published counter table (src/core/counters.ts, docs/BALANCE.md, the
 * in-game help) holds in play. Equal-cost groups, City Age, no research, both sides of three
 * jittered line-ups, at a small and a large budget; the counter must keep most of the value left.
 */
const FIGHTS = COUNTERS.flatMap((row) => row.fights.map(([a, b]) => [row.unit, a, b] as const));

describe('counter table', () => {
  it('names real units and every fight is between different kinds', () => {
    for (const [, a, b] of FIGHTS) {
      expect(UNITS[a]).toBeDefined();
      expect(UNITS[b]).toBeDefined();
      expect(a).not.toBe(b);
    }
    expect(FIGHTS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(FIGHTS)('%s: %s beats %s cost for cost', (_row, a, b) => {
    for (const budget of [1200, 3600]) {
      const r = fight(a, b, budget, { seeds: 2 });
      // Rounding never favours the counter: it has the floor, the victim the ceiling.
      expect(r.spentA).toBeLessThanOrEqual(r.spentB);
      expect(r.share, `${a} vs ${b} at ${budget}`).toBeGreaterThanOrEqual(0.75);
      expect(r.leftA, `${a} vs ${b} at ${budget}`).toBeGreaterThanOrEqual(0.25);
    }
  }, 60_000);

  const RAZES = COUNTERS.flatMap((row) => row.razes ?? []);
  it.each(RAZES)('$kind razes a $target at least twice as fast as the same spend of $than', ({ kind, target, than }) => {
    const siege = raze(kind, target, 900, 400);
    const other = raze(than, target, 900, 400);
    expect(siege.seconds).not.toBeNull();
    expect(siege.seconds! * 2).toBeLessThanOrEqual(other.seconds ?? Infinity);
  }, 60_000);

  it('champions cost two to three line units, as the help says', () => {
    expect(costOf('praetorian') / costOf('swordsman')).toBe(3);
    expect(costOf('equites') / costOf('horseman')).toBe(2);
  });
});
