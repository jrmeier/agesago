/** Match options for wonder victory (M16-7). Part of the match setup, saved with the match. */
export interface WonderRules {
  enabled: boolean;
  /** Game seconds a finished wonder must stand. */
  seconds: number;
}

export const DEFAULT_WONDER_SECONDS = 300;
export const WONDER_SECONDS_MIN = 60;
export const WONDER_SECONDS_MAX = 1800;

export function defaultWonderRules(): WonderRules {
  return { enabled: true, seconds: DEFAULT_WONDER_SECONDS };
}

/** Legal rules from untrusted input (setup UI, lobby config, saves); anything else falls back to the defaults. */
export function normalizeWonderRules(v: unknown): WonderRules {
  const d = defaultWonderRules();
  if (typeof v !== 'object' || v === null) return d;
  const r = v as Partial<WonderRules>;
  const seconds = typeof r.seconds === 'number' && Number.isFinite(r.seconds)
    ? Math.min(WONDER_SECONDS_MAX, Math.max(WONDER_SECONDS_MIN, Math.round(r.seconds)))
    : d.seconds;
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled, seconds };
}
