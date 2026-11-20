import { DEFAULT_SEED, type StartingResources, type TeamSetup } from '../core/types';
import { DEFAULT_WONDER_SECONDS, normalizeWonderRules, type WonderRules } from '../core/wonder';

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

/** Wonder countdown lengths the new-game and lobby menus offer (game seconds). */
export const WONDER_TIMER_CHOICES = [180, DEFAULT_WONDER_SECONDS, 600, 900] as const;

/** Menu label for a countdown length, e.g. "5 min". */
export function wonderTimerLabel(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

/** Wonder victory rules from setup fields. Missing or invalid values use the defaults (on, 5 min). */
export function matchWonderRules(value: Partial<WonderRules> | null | undefined): WonderRules {
  return normalizeWonderRules(value);
}

/** Team presets only make sense with the required number of towns. */
export function matchTeams(value: TeamSetup | undefined, players: number): TeamSetup {
  if (value === 'allied-rivals' && players >= 3) return value;
  if (value === 'pairs' && players === 4) return value;
  return 'ffa';
}

export function matchResources(value: StartingResources | undefined): StartingResources {
  return value === 'low' || value === 'high' ? value : 'standard';
}
