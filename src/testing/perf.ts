/**
 * Wall-clock budgets in tests are tuned on a dev machine. Hosted CI runners are about 2x
 * slower per core and share it with parallel suites, so scale every timing budget by
 * PERF_SLACK (default 3 under CI, 1 locally). Correctness assertions never use this.
 */
export const PERF_SLACK = Number(process.env.PERF_SLACK ?? (process.env.CI ? 3 : 1));

export const perfBudget = (ms: number): number => ms * PERF_SLACK;
