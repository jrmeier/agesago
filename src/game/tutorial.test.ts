import { describe, expect, it } from 'vitest';
import {
  advance,
  hintText,
  loadDismissed,
  rememberDismissed,
  type TutorialBaseline,
  type TutorialFacts,
} from './tutorial';

function facts(over: Partial<TutorialFacts> = {}): TutorialFacts {
  return {
    wood: 0,
    food: 50,
    villagers: 3,
    gathering: false,
    houses: 0,
    scoutMoving: false,
    barracks: 0,
    raidSpawned: false,
    raidersAlive: 0,
    ...over,
  };
}

const baseline: TutorialBaseline = { villagers: 3, food: 50 };

describe('tutorial steps', () => {
  it('advances only from sim facts, and skips work that is already done', () => {
    expect(advance('gather', facts(), baseline)).toBe('gather');
    expect(advance('gather', facts({ gathering: true }), baseline)).toBe('train');
    expect(advance('gather', facts({ wood: 10, villagers: 4, houses: 1 }), baseline)).toBe('scout');
    expect(advance('raid', facts({ raidSpawned: true, raidersAlive: 2 }), baseline)).toBe('raid');
    expect(advance('raid', facts({ raidSpawned: true, raidersAlive: 0 }), baseline)).toBe('done');
    expect(advance('raid', facts({ raidSpawned: false, raidersAlive: 0 }), baseline)).toBe('raid');
  });

  it('does not repeat a hint once it has been dismissed', () => {
    const stored = rememberDismissed(loadDismissed(null), 'gather');
    const dismissed = loadDismissed(stored);
    expect(hintText('gather', false, dismissed)).toBe('');
    expect(hintText('train', true, dismissed)).toContain('Tap');
    expect(hintText('train', false, dismissed)).toContain('Click');
    expect(loadDismissed('nope')).toEqual(new Set());
  });
});