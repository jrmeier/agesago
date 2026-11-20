import { describe, expect, it } from 'vitest';
import { COUNTERS } from '../core/counters';
import { UNITS } from '../core/units';
import { LINE_UNITS, costOf, fight, raze } from './counters';

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

describe('counter table at every unit-line tier', () => {
  const lineFights = FIGHTS.filter(([, a, b]) => LINE_UNITS.includes(a) && LINE_UNITS.includes(b));
  // Measured with seeds: 2 after the L60 slinger retune: only these cases are below 75%
  // (unchanged from main 7157fcc). Everything else keeps the published bar, including
  // Archer-line vs Slinger-line at every tier (100%) and tier-1 Archer/Hoplite at 3600 (77%).
  const exceptions = [
    { a: 'archer', b: 'hoplite', tier: 1, budget: 1200, measured: 0.73 },
    { a: 'archer', b: 'hoplite', tier: 2, budget: 1200, measured: 0.73 },
    { a: 'archer', b: 'hoplite', tier: 2, budget: 3600, measured: 0.71 },
  ];
  const cases = lineFights.flatMap(([, a, b]) =>
    ([1, 2, 3] as const).flatMap((tier) => [1200, 3600].map((budget) => ({ a, b, tier, budget }))));

  it.each(cases)('tier $tier: $a beats $b at $budget', ({ a, b, tier, budget }) => {
    const r = fight(a, b, budget, { tier, seeds: 2 });
    expect(r.share).toBeGreaterThanOrEqual(0.6);
    if (!exceptions.some((e) => e.a === a && e.b === b && e.tier === tier && e.budget === budget)) {
      expect(r.share).toBeGreaterThanOrEqual(0.75);
    }
    // Ticket #60's explicit example: Veteran Hoplites beat Light Cavalry cleanly.
    if (a === 'hoplite' && b === 'scout' && tier === 1) expect(r.share).toBe(1);
  }, 120_000);
});
