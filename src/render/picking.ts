export interface PickCandidate {
  id: number;
  /** Higher wins. Villagers outrank resource nodes, which outrank the Town Center. */
  rank: number;
  /** Smaller is closer to the camera. */
  depth: number;
}

export const PICK_RANK = {
  villager: 3,
  node: 2,
  townCenter: 1,
} as const;

/**
 * Point-in-rectangle test. Corners may be inverted (a drag box can go up and left).
 * Edges are inclusive.
 */
export function rectContains(px: number, py: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/** NDC (−1..1, y up) → canvas CSS pixels (origin top-left, y down). */
export function ndcToCanvas(ndcX: number, ndcY: number, width: number, height: number): { x: number; y: number } {
  return {
    x: (ndcX + 1) * 0.5 * width,
    y: (1 - ndcY) * 0.5 * height,
  };
}

/**
 * Choose the entity under the cursor. Higher rank wins outright; within a rank
 * the smaller depth (nearer to the camera) wins.
 */
export function choosePick(hits: readonly PickCandidate[]): number | null {
  let best: PickCandidate | null = null;
  for (const hit of hits) {
    if (!best || hit.rank > best.rank || (hit.rank === best.rank && hit.depth < best.depth)) {
      best = hit;
    }
  }
  return best ? best.id : null;
}
