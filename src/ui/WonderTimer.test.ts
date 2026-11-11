import { describe, expect, it } from 'vitest';
import { formatCountdown } from './WonderTimer';

describe('wonder countdown text', () => {
  it('shows minutes and seconds, rounding up so 0:00 is the end', () => {
    expect(formatCountdown(300)).toBe('5:00');
    expect(formatCountdown(299.2)).toBe('5:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(0.01)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});
