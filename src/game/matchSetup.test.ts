import { describe, expect, it } from 'vitest';
import { matchPlayers, matchSeed, parseSeed, seedFromSearch } from './matchSetup';

describe('match setup', () => {
  it('parses a shareable seed and rejects blanks and junk', () => {
    expect(parseSeed('12')).toBe(12);
    expect(parseSeed(' 7 ')).toBe(7);
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('0')).toBeNull();
    expect(parseSeed('01')).toBeNull();
    expect(parseSeed('1.5')).toBeNull();
    expect(parseSeed('1000000001')).toBeNull();
    expect(seedFromSearch('?seed=42')).toBe(42);
    expect(seedFromSearch('?seed=no')).toBeNull();
    expect(seedFromSearch('')).toBeNull();
  });

  it('falls back to a two-town match when the choice is missing', () => {
    expect(matchSeed(null)).toBe(1);
    expect(matchSeed(4)).toBe(4);
    expect(matchSeed(0, 3)).toBe(3);
    expect(matchPlayers(undefined)).toBe(2);
    expect(matchPlayers(1)).toBe(1);
    expect(matchPlayers(4)).toBe(4);
    expect(matchPlayers(5)).toBe(2);
  });
});
