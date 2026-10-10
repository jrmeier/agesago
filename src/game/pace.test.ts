import { describe, expect, it } from 'vitest';
import { GAME_SPEEDS, isGameSpeed, simScale } from './pace';

describe('game speed', () => {
  it('offers the four pause-menu speeds and rejects anything else', () => {
    expect(GAME_SPEEDS).toEqual([0.5, 1, 1.5, 2]);
    expect(isGameSpeed(1)).toBe(true);
    expect(isGameSpeed(1.5)).toBe(true);
    expect(isGameSpeed(0)).toBe(false);
    expect(isGameSpeed(3)).toBe(false);
    expect(isGameSpeed(Number.NaN)).toBe(false);
  });

  it('stops the clock while paused or after the match ends', () => {
    for (const speed of GAME_SPEEDS) {
      expect(simScale(speed, true, false)).toBe(0);
      expect(simScale(speed, false, true)).toBe(0);
      expect(simScale(speed, false, false)).toBe(speed);
    }
  });
});
