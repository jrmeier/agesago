import type { UnitKind, Vec2 } from '../core/types';

/** Fog-of-war cell states, AoE-style. */
export const UNEXPLORED = 0;
export const EXPLORED = 1;
export const VISIBLE = 2;

/** Sight radii in world units. */
export const SIGHT = {
  villager: 7,
  scout: 15,
  townCenter: 11,
} as const;

/** Sight radius of a unit kind. */
export function sightOf(kind: UnitKind): number {
  return SIGHT[kind];
}

/** Something that reveals the map around it. */
export interface Viewer {
  pos: Vec2;
  sight: number;
}

/**
 * Per-player exploration grid at 1 unit per cell. Cells start unexplored, become visible
 * while inside any viewer's sight radius, and stay explored (dimmed) afterwards.
 * Pure TS — renderers upload `state` as a texture whenever `version` changes.
 */
export class Visibility {
  readonly cols: number;
  readonly rows: number;
  /** One byte per cell: UNEXPLORED, EXPLORED or VISIBLE. Row-major, z rows of x columns. */
  readonly state: Uint8Array;
  /** Increments whenever any cell changes. */
  version = 0;

  constructor(
    readonly width: number,
    readonly depth: number
  ) {
    this.cols = Math.ceil(width);
    this.rows = Math.ceil(depth);
    this.state = new Uint8Array(this.cols * this.rows);
  }

  stateAt(x: number, z: number): number {
    const c = Math.floor(x);
    const r = Math.floor(z);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return UNEXPLORED;
    return this.state[r * this.cols + c];
  }

  isExplored(x: number, z: number): boolean {
    return this.stateAt(x, z) !== UNEXPLORED;
  }

  isVisible(x: number, z: number): boolean {
    return this.stateAt(x, z) === VISIBLE;
  }

  /** Recompute what is visible now; everything previously visible stays explored. */
  update(viewers: Iterable<Viewer>): void {
    const next = new Uint8Array(this.state.length);
    for (let i = 0; i < next.length; i++) next[i] = this.state[i] === UNEXPLORED ? UNEXPLORED : EXPLORED;
    for (const v of viewers) this.stamp(next, v);
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== this.state[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state.set(next);
    this.version++;
  }

  /** Fraction of the map explored so far (0..1). */
  get exploredFraction(): number {
    let n = 0;
    for (const s of this.state) if (s !== UNEXPLORED) n++;
    return n / this.state.length;
  }

  private stamp(grid: Uint8Array, v: Viewer): void {
    const r = v.sight;
    const c0 = Math.max(0, Math.floor(v.pos.x - r));
    const c1 = Math.min(this.cols - 1, Math.floor(v.pos.x + r));
    const r0 = Math.max(0, Math.floor(v.pos.z - r));
    const r1 = Math.min(this.rows - 1, Math.floor(v.pos.z + r));
    const r2 = r * r;
    for (let row = r0; row <= r1; row++) {
      const dz = row + 0.5 - v.pos.z;
      for (let col = c0; col <= c1; col++) {
        const dx = col + 0.5 - v.pos.x;
        if (dx * dx + dz * dz <= r2) grid[row * this.cols + col] = VISIBLE;
      }
    }
  }
}
