import { EXPLORED, UNEXPLORED, VISIBLE } from '../sim/visibility';

/** Straight (non-premultiplied) RGBA, 0..255. */
export type RGBA = [number, number, number, number];

/**
 * Minimap fog overlay per cell state, painted over the terrain chart:
 * unexplored = opaque dark umber (unknown land), explored = a translucent grey-brown wash
 * that both dims and desaturates what was seen, visible = clear.
 */
export const FOG_RGBA: Record<number, RGBA> = {
  [UNEXPLORED]: [20, 13, 7, 255],
  [EXPLORED]: [44, 38, 32, 150],
  [VISIBLE]: [0, 0, 0, 0],
};

/** Overlay colour for a visibility cell state (unknown values count as unexplored). */
export function fogColor(state: number): RGBA {
  return FOG_RGBA[state] ?? FOG_RGBA[UNEXPLORED];
}

/** Write one RGBA pixel per visibility cell into `out` (length ≥ state.length × 4). */
export function paintFog(state: ArrayLike<number>, out: Uint8ClampedArray): void {
  for (let i = 0; i < state.length; i++) {
    const c = fogColor(state[i]);
    const o = i * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = c[3];
  }
}

/** Opacity of a resource dot on the minimap: hidden where unexplored, faded where only remembered. */
export function nodeAlpha(state: number): number {
  if (state === VISIBLE) return 1;
  if (state === EXPLORED) return 0.6;
  return 0;
}
