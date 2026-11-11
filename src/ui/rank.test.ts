import { describe, expect, it } from 'vitest';
import { rankLine, rankSummary } from './rank';

describe('rank panel helpers', () => {
  it('shows progress from the current threshold to the next rank', () => {
    expect(rankLine('hoplite', undefined, undefined)).toEqual({ name: 'Basic', fraction: 0, label: '0 / 100 xp to Advanced' });
    expect(rankLine('hoplite', 0, 40)).toEqual({ name: 'Basic', fraction: 0.4, label: '40 / 100 xp to Advanced' });
    const advanced = rankLine('archer', 1, 200)!;
    expect(advanced.name).toBe('Advanced');
    expect(advanced.fraction).toBeCloseTo(0.5);
    expect(advanced.label).toBe('100 / 200 xp to Elite');
    expect(rankLine('horseman', 2, 999)).toEqual({ name: 'Elite', fraction: 1, label: 'Top rank' });
  });

  it('rounds xp down and clamps the bar', () => {
    expect(rankLine('hoplite', 0, 99.9)!.label).toBe('99 / 100 xp to Advanced');
    expect(rankLine('hoplite', 0, -5)!.fraction).toBe(0);
  });

  it('has no rank line for units that never rank', () => {
    expect(rankLine('villager', 0, 0)).toBeNull();
    expect(rankLine('priest', 0, 0)).toBeNull();
    expect(rankLine('trireme', 0, 0)).toBeNull();
  });

  it('counts a group by rank and skips empty ranks and non-soldiers', () => {
    expect(
      rankSummary([
        { kind: 'hoplite' },
        { kind: 'hoplite', rank: 0 },
        { kind: 'archer', rank: 2 },
        { kind: 'villager' },
        { kind: 'scout', rank: 2 },
      ]),
    ).toBe('2 Basic · 2 Elite');
    expect(rankSummary([{ kind: 'hoplite', rank: 1 }])).toBe('1 Advanced');
    expect(rankSummary([{ kind: 'villager' }, { kind: 'priest' }])).toBeNull();
  });
});
