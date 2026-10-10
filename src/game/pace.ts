/** Sim speed multipliers offered in the pause menu. 1× is the default. */
export const GAME_SPEEDS = [0.5, 1, 1.5, 2] as const;

export type GameSpeed = (typeof GAME_SPEEDS)[number];

export function isGameSpeed(n: number): n is GameSpeed {
  return (GAME_SPEEDS as readonly number[]).includes(n);
}

/**
 * Sim seconds to accumulate per wall second.
 * A paused or finished match adds none, so the clock stays where it is.
 */
export function simScale(speed: GameSpeed, paused: boolean, matchOver: boolean): number {
  if (paused || matchOver) return 0;
  return speed;
}
