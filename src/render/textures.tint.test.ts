import { describe, expect, it } from 'vitest';
import { coverTint } from './textures';

describe('coverTint', () => {
  it('returns a mid green in 0..1, not clipped white', () => {
    for (const [x, z, m] of [[10, 10, 0], [50.3, 22.7, 0.5], [85, 87, 1]]) {
      const c = coverTint(x, z, m);
      expect(c.g).toBeGreaterThan(c.r);
      expect(c.g).toBeGreaterThan(c.b);
      expect(c.g).toBeGreaterThan(0.08);
      expect(c.g).toBeLessThan(0.75);
    }
  });
});
