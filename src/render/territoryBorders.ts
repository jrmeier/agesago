import type { PlayerId } from '../core/types';
import { EXPLORED, VISIBLE } from '../sim/visibility';

/** `known` value for a cell the local player has never explored: drawn as nothing at all. */
export const UNSEEN = 255;

/** What the memory needs from the sim's territory grid (world.territory). */
export interface TerritoryGrid {
  readonly cols: number;
  readonly rows: number;
  /** World units per cell. */
  readonly cell: number;
  /** Owner per cell, row-major `z * cols + x` (0 = neutral). */
  readonly owner: Uint8Array;
  readonly version: number;
}

/** What the memory needs from the local player's fog grid. */
export interface SightGrid {
  stateAt(x: number, z: number): number;
  readonly version: number;
}

/**
 * Update the local player's picture of territory in place; returns true if any cell changed.
 * Same rules as enemy buildings in lastSeen.ts:
 * - unexplored: {@link UNSEEN} (no border is drawn into or along it);
 * - visible: the live owner;
 * - explored but out of sight: the remembered owner. The player always knows their own land, so
 *   a cell they own shows as theirs, and one they lost in the fog shows as neutral (lost, but the
 *   new owner is not revealed). A cell first met already explored (a resumed match) takes the live owner.
 */
export function rememberTerritory(
  known: Uint8Array,
  grid: Pick<TerritoryGrid, 'cols' | 'rows' | 'cell' | 'owner'>,
  sight: Pick<SightGrid, 'stateAt'>,
  local: PlayerId,
): boolean {
  const { cols, rows, cell, owner } = grid;
  let changed = false;
  for (let z = 0; z < rows; z++) {
    const wz = (z + 0.5) * cell;
    for (let x = 0; x < cols; x++) {
      const i = z * cols + x;
      const s = sight.stateAt((x + 0.5) * cell, wz);
      const live = owner[i];
      const prev = known[i];
      let next: number;
      if (s === VISIBLE) next = live;
      else if (s !== EXPLORED) next = UNSEEN;
      else if (live === local) next = local;
      else if (prev === local) next = 0;
      else if (prev === UNSEEN) next = live;
      else next = prev;
      if (next !== prev) {
        known[i] = next;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * One cell edge on the inside of a player's border. The edge runs from (x, z) one cell along
 * `axis` (0 = +x, 1 = +z), in cell units; (nx, nz) points into the owner's cell.
 */
export interface BorderEdge {
  owner: PlayerId;
  x: number;
  z: number;
  axis: 0 | 1;
  nx: number;
  nz: number;
}

/**
 * Edges where the remembered owner changes between 4-neighbours. Each owned side gets its own
 * edge (two players meeting give two lines, one inside each). Nothing is drawn along unexplored
 * cells or the map edge, so the shroud never shows a false border.
 */
export function extractBorders(known: Uint8Array, cols: number, rows: number): BorderEdge[] {
  const out: BorderEdge[] = [];
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const i = z * cols + x;
      const a = known[i];
      if (a === UNSEEN) continue;
      if (x + 1 < cols) {
        const b = known[i + 1];
        if (b !== a && b !== UNSEEN) {
          if (a) out.push({ owner: a, x: x + 1, z, axis: 1, nx: -1, nz: 0 });
          if (b) out.push({ owner: b, x: x + 1, z, axis: 1, nx: 1, nz: 0 });
        }
      }
      if (z + 1 < rows) {
        const b = known[i + cols];
        if (b !== a && b !== UNSEEN) {
          if (a) out.push({ owner: a, x, z: z + 1, axis: 0, nx: 0, nz: -1 });
          if (b) out.push({ owner: b, x, z: z + 1, axis: 0, nx: 0, nz: 1 });
        }
      }
    }
  }
  return out;
}

/** Is cell `i` owned (remembered) and next to a different remembered owner? */
export function isBorderCell(known: Uint8Array, cols: number, rows: number, i: number): boolean {
  const a = known[i];
  if (!a || a === UNSEEN) return false;
  const x = i % cols;
  const differs = (j: number) => known[j] !== a && known[j] !== UNSEEN;
  return (x > 0 && differs(i - 1)) || (x + 1 < cols && differs(i + 1)) || (i >= cols && differs(i - cols)) || (i + cols < cols * rows && differs(i + cols));
}

/**
 * The local player's remembered territory, kept in step with the sim grid and the fog.
 * `update` rescans only when the territory or fog version moved; `version` increments only when
 * a remembered cell actually changed, so views rebuild geometry only then.
 */
export class TerritoryMemory {
  readonly known: Uint8Array;
  version = 0;
  private territoryVersion = -1;
  private sightVersion = -1;

  constructor(
    readonly grid: TerritoryGrid,
    readonly sight: SightGrid,
    readonly local: PlayerId,
  ) {
    this.known = new Uint8Array(grid.cols * grid.rows).fill(UNSEEN);
  }

  /** True when the territory or fog changed since the last `update`. */
  get pending(): boolean {
    return this.grid.version !== this.territoryVersion || this.sight.version !== this.sightVersion;
  }

  /** True when the territory grid itself was recomputed since the last `update`. */
  get territoryChanged(): boolean {
    return this.grid.version !== this.territoryVersion;
  }

  /** Rescan if pending; returns true if the remembered picture changed. */
  update(): boolean {
    if (!this.pending) return false;
    this.territoryVersion = this.grid.version;
    this.sightVersion = this.sight.version;
    if (!rememberTerritory(this.known, this.grid, this.sight, this.local)) return false;
    this.version++;
    return true;
  }
}
