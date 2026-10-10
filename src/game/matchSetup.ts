import { DEFAULT_SEED } from '../core/types';

/** Largest seed the new-game field accepts. */
export const SEED_MAX = 1_000_000_000;

/** A shareable seed, or null when the text is empty or not a whole number in range. */
export function parseSeed(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n > SEED_MAX) return null;
  return n;
}

/** Seed from a query string (`?seed=12`). Invalid values are ignored. */
export function seedFromSearch(search: string): number | null {
  return parseSeed(new URLSearchParams(search).get('seed'));
}

/** Use `value` when it is a legal seed, otherwise `fallback`. */
export function matchSeed(value: number | null | undefined, fallback = DEFAULT_SEED): number {
  if (value == null || !Number.isInteger(value) || value < 1 || value > SEED_MAX) return fallback;
  return value;
}

/** Town count the generator accepts. Anything else starts a two-town match. */
export function matchPlayers(value: number | null | undefined): number {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return 2;
}
