import { describe, expect, it } from 'vitest';
import { AGE_TARGETS, ECO_TECHS, PAYBACK_LIMIT, measurePaybacks, runPacing } from './pacing';

/**
 * Pacing regression guard (M8-17): a shortened bench on one seed. The full table, all seeds and
 * the Empire Age come from `npm run bench:pacing` (see docs/BALANCE.md).
 */
describe('progression pacing', () => {
  it('the scripted build order reaches the Town and City Ages on schedule', { timeout: 180_000 }, () => {
    const r = runPacing(1, { stopAtAge: 2, maxSeconds: AGE_TARGETS[2].hi + 60 });
    for (const age of [1, 2] as const) {
      expect(r.ages[age], `age ${age}`).not.toBeNull();
      expect(r.ages[age]!).toBeGreaterThanOrEqual(AGE_TARGETS[age].lo);
      expect(r.ages[age]!).toBeLessThanOrEqual(AGE_TARGETS[age].hi);
    }
  });

  it('Village and Town Age economy techs pay for themselves within five minutes', { timeout: 120_000 }, () => {
    const cases = ECO_TECHS.filter((c) => ['bronzeAxe', 'oxPlough', 'bronzePicks', 'ironAxe', 'ironPloughshare'].includes(c.tech));
    for (const p of measurePaybacks(1, cases, { window: 180 })) {
      expect(p.payback, p.tech).toBeLessThanOrEqual(PAYBACK_LIMIT);
    }
  });
});
