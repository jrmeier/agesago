import type { Heightfield, Vec2 } from '../core/types';
import { BALANCE } from './balance';

/** A circular obstacle (building footprint) that paths must avoid. */
export interface Obstacle {
  pos: Vec2;
  radius: number;
}

/** Axis-aligned rectangle in ground coordinates (a building footprint; rotations are 90° steps). */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Distance from `p` to the rectangle (0 inside). */
export function rectDistance(p: Vec2, r: Rect): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dz = Math.max(r.z0 - p.z, 0, p.z - r.z1);
  return Math.hypot(dx, dz);
}

/** Point of `r` grown by `margin` nearest to `p`: `p` clamped into it, pushed out to the nearest side if inside. */
export function rectApproach(p: Vec2, r: Rect, margin: number): Vec2 {
  const x0 = r.x0 - margin;
  const x1 = r.x1 + margin;
  const z0 = r.z0 - margin;
  const z1 = r.z1 + margin;
  const x = Math.min(x1, Math.max(x0, p.x));
  const z = Math.min(z1, Math.max(z0, p.z));
  if (x > x0 && x < x1 && z > z0 && z < z1) {
    const m = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    if (m === x - x0) return { x: x0, z };
    if (m === x1 - x) return { x: x1, z };
    if (m === z - z0) return { x, z: z0 };
    return { x, z: z1 };
  }
  return { x, z };
}

/** Nav grid cell size in world units. */
export const NAV_CELL = 0.5;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Grid A* over Heightfield.isWalkable plus obstacle footprints.
 * Owned by the Sim lane (T3). Pure TS — no three.js.
 *
 * 8-connected with no corner cutting; obstacles are inflated by the villager radius.
 * The walkability grid and its connected regions are computed once, so unreachable
 * targets are rejected without a search and each A* run reuses typed scratch arrays.
 *
 * Buildings are rectangular obstacles added/removed at runtime (addRect / removeRect): only
 * the cells under the footprint are re-marked, and regions are relabelled locally when that
 * provably can't split or merge them (the usual case: a building on open ground), else in full.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** 1 where a villager can stand at the cell centre. */
  private readonly walk: Uint8Array;
  /** Walkability from terrain and circular obstacles only (never changes). */
  private readonly base: Uint8Array;
  /** Number of rectangular obstacles covering each cell. */
  private readonly rectCount: Uint8Array;
  private readonly rects = new Map<number, Rect>();
  private nextLabel = 0;
  /** Increments whenever walkability or region labels change (callers caching regions rebuild). */
  version = 0;
  /** Connected-region label per cell (0 = blocked). */
  private readonly region: Int32Array;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  /** Running total of A* cell expansions — a deterministic cost meter for callers that budget work. */
  expanded = 0;
  private heapCell: number[] = [];
  private heapF: number[] = [];
  /**
   * Rectangles treated as blocked for the current query only (enemy gates).
   * They are not written into `walk`, so the owner's paths still use the opening.
   */
  private mask: readonly Rect[] | null = null;

  constructor(
    readonly hf: Heightfield,
    readonly obstacles: Obstacle[] = []
  ) {
    this.cols = Math.max(1, Math.ceil(hf.width / NAV_CELL));
    this.rows = Math.max(1, Math.ceil(hf.depth / NAV_CELL));
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.base = new Uint8Array(n);
    this.rectCount = new Uint8Array(n);
    this.region = new Int32Array(n);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.center(i);
      this.walk[i] = this.isFree(c) ? 1 : 0;
    }
    this.base.set(this.walk);
    this.labelRegions();
  }

  /**
   * Run `fn` with `rects` blocked on top of the shared grid. Empty or null is the shared grid.
   * Nested calls restore the previous mask. Used so a gate stays open for its owner.
   */
  withMask<T>(rects: readonly Rect[] | null, fn: () => T): T {
    const prev = this.mask;
    this.mask = rects && rects.length ? rects : null;
    try {
      return fn();
    } finally {
      this.mask = prev;
    }
  }

  /** Block a rectangular footprint (inflated by the villager radius) under key `id`, re-marking only its cells. */
  addRect(id: number, r: Rect): void {
    if (this.rects.has(id)) this.removeRect(id);
    this.rects.set(id, { ...r });
    const box = this.cellBox(r);
    if (!box) return;
    const [cx0, cz0, cx1, cz1] = box;
    const { cols, walk, region, rectCount } = this;
    let changed = false;
    for (let z = cz0; z <= cz1; z++) {
      for (let x = cx0; x <= cx1; x++) {
        const i = z * cols + x;
        rectCount[i]++;
        if (walk[i]) {
          walk[i] = 0;
          region[i] = 0;
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.version++;
    // A fully walkable ring around the box is one 4-connected loop, so blocking the box
    // can't disconnect anything. Otherwise a region may have split: relabel.
    if (!this.ringWalkable(cx0 - 1, cz0 - 1, cx1 + 1, cz1 + 1)) this.labelRegions();
  }

  /** Remove the rectangular obstacle `id` (no-op if unknown). */
  removeRect(id: number): void {
    const r = this.rects.get(id);
    if (!r) return;
    this.rects.delete(id);
    const box = this.cellBox(r);
    if (!box) return;
    const [cx0, cz0, cx1, cz1] = box;
    const { cols, walk, base, rectCount } = this;
    const freed: number[] = [];
    for (let z = cz0; z <= cz1; z++) {
      for (let x = cx0; x <= cx1; x++) {
        const i = z * cols + x;
        if (rectCount[i] > 0) rectCount[i]--;
        if (!walk[i] && base[i] && rectCount[i] === 0) {
          walk[i] = 1;
          freed.push(i);
        }
      }
    }
    if (!freed.length) return;
    this.version++;
    if (!this.labelFreed(freed)) this.labelRegions();
  }

  /** Walkable point nearest to `p` (`p` itself if already free), or null if there is none. */
  nearestFree(p: Vec2): Vec2 | null {
    if (this.isFree(p) && this.isWalkableCell(p)) return { x: p.x, z: p.z };
    const i = this.nearestCell(p, 0);
    return i < 0 ? null : this.center(i);
  }

  /** Nearest free cell centre in `reg` (0 = any), optionally excluding reserved formation space. */
  nearestFreeCell(p: Vec2, reg = 0, accept?: (p: Vec2) => boolean): Vec2 | null {
    const i = this.nearestCell(p, reg, accept);
    return i < 0 ? null : this.center(i);
  }

  /** Clamp a steering displacement to free ground, checking the segment as well as its end. */
  clampMove(from: Vec2, to: Vec2): Vec2 {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (NAV_CELL / 4)));
    let safe = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree({ x: from.x + dx * t, z: from.z + dz * t })) {
        let blocked = t;
        // Preserve the clear prefix; do not jump across a wall to a free endpoint.
        for (let j = 0; j < 8; j++) {
          const mid = (safe + blocked) / 2;
          if (this.isFree({ x: from.x + dx * mid, z: from.z + dz * mid })) safe = mid;
          else blocked = mid;
        }
        return { x: from.x + dx * safe, z: from.z + dz * safe };
      }
      safe = t;
    }
    return { x: to.x, z: to.z };
  }

  /** True if a villager can stand at `p`: walkable terrain, clear of every inflated obstacle. */
  isFree(p: Vec2): boolean {
    if (!this.hf.isWalkable(p.x, p.z)) return false;
    for (const o of this.obstacles) {
      const r = o.radius + BALANCE.villagerRadius;
      const dx = p.x - o.pos.x;
      const dz = p.z - o.pos.z;
      if (dx * dx + dz * dz < r * r) return false;
    }
    const m = BALANCE.villagerRadius;
    for (const r of this.rects.values()) {
      if (p.x > r.x0 - m && p.x < r.x1 + m && p.z > r.z0 - m && p.z < r.z1 + m) return false;
    }
    return !this.maskCovers(p);
  }

  /** True if the nav cell containing `p` is walkable. */
  isWalkableCell(p: Vec2): boolean {
    const i = this.cellOf(p);
    return i >= 0 && this.walk[i] === 1;
  }

  /** True if `a` and `b` lie in the same connected walkable region. */
  connected(a: Vec2, b: Vec2): boolean {
    const ia = this.cellOf(a);
    const ib = this.cellOf(b);
    return ia >= 0 && ib >= 0 && this.region[ia] !== 0 && this.region[ia] === this.region[ib];
  }

  /**
   * Waypoints from `from` to `to` (excluding `from`), or null if unreachable.
   * `greed` > 1 inflates the A* heuristic: far fewer cells searched on long routes, paths at
   * most `greed`× longer than optimal (smoothing recovers most of that).
   */
  findPath(from: Vec2, to: Vec2, greed = 1): Vec2[] | null {
    let start = this.cellOf(from);
    const startFree = start >= 0 && this.passCell(start);
    if (!startFree) {
      start = this.nearestCell(from, 0);
      if (start < 0) return null;
    }
    const reg = this.region[start];

    let goal = this.cellOf(to);
    const goalExact = goal >= 0 && this.passCell(goal);
    if (goalExact) {
      if (this.region[goal] !== reg) return null;
    } else {
      goal = this.nearestCell(to, reg);
      if (goal < 0) return null;
    }

    if (startFree && goalExact && this.lineOfSight(from, to)) return [{ x: to.x, z: to.z }];

    const cells = this.search(start, goal, greed);
    if (!cells) return null;

    const pts = cells.map((i) => this.center(i));
    if (startFree) pts[0] = { x: from.x, z: from.z };
    if (goalExact && pts.length > 1) pts[pts.length - 1] = { x: to.x, z: to.z };
    const path = this.smooth(pts);
    if (!startFree) path.unshift(pts[0]);
    if (!goalExact) {
      const end = this.center(goal);
      if (this.isFree(to) && Math.hypot(end.x - to.x, end.z - to.z) <= NAV_CELL * 1.5) {
        path.push({ x: to.x, z: to.z });
      }
    }
    return path;
  }

  /** Straight walk from `a` to `b` stays on walkable cells (supercover; corners need both sides). */
  lineOfSight(a: Vec2, b: Vec2): boolean {
    const x0 = a.x / NAV_CELL;
    const z0 = a.z / NAV_CELL;
    const x1 = b.x / NAV_CELL;
    const z1 = b.z / NAV_CELL;
    let ix = Math.floor(x0);
    let iz = Math.floor(z0);
    const ex = Math.floor(x1);
    const ez = Math.floor(z1);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const sx = Math.sign(dx);
    const sz = Math.sign(dz);
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tx = dx > 0 ? (ix + 1 - x0) * tdx : dx < 0 ? (x0 - ix) * tdx : Infinity;
    let tz = dz > 0 ? (iz + 1 - z0) * tdz : dz < 0 ? (z0 - iz) * tdz : Infinity;
    let steps = Math.abs(ex - ix) + Math.abs(ez - iz) + 2;
    while (steps-- > 0) {
      if (!this.passAt(ix, iz)) return false;
      if (ix === ex && iz === ez) return true;
      if (Math.abs(tx - tz) < 1e-9) {
        if (!this.passAt(ix + sx, iz) || !this.passAt(ix, iz + sz)) return false;
        ix += sx;
        iz += sz;
        tx += tdx;
        tz += tdz;
      } else if (tx < tz) {
        ix += sx;
        tx += tdx;
      } else {
        iz += sz;
        tz += tdz;
      }
    }
    return true;
  }

  /** Connected-region label of the walkable cell at (or nearest to) `p`; 0 if there is none. */
  regionAt(p: Vec2): number {
    let i = this.cellOf(p);
    if (i < 0 || this.walk[i] !== 1) i = this.nearestCell(p, 0);
    return i < 0 ? 0 : this.region[i];
  }

  /** Region label of the cell containing `p` (0 if blocked or off the grid) — no nearest-cell fallback. */
  regionOfCell(p: Vec2): number {
    const i = this.cellOf(p);
    return i < 0 ? 0 : this.region[i];
  }

  /** Cells whose centres lie strictly inside `r` grown by the villager radius: [x0, z0, x1, z1], or null. */
  private cellBox(r: Rect): [number, number, number, number] | null {
    const m = BALANCE.villagerRadius;
    // Centre (i + 0.5)·NAV_CELL strictly inside (a, b)  ⇔  a/NAV_CELL − 0.5 < i < b/NAV_CELL − 0.5.
    const lo = (a: number) => Math.floor(a / NAV_CELL - 0.5) + 1;
    const hi = (b: number) => Math.ceil(b / NAV_CELL - 0.5) - 1;
    const cx0 = Math.max(0, lo(r.x0 - m));
    const cz0 = Math.max(0, lo(r.z0 - m));
    const cx1 = Math.min(this.cols - 1, hi(r.x1 + m));
    const cz1 = Math.min(this.rows - 1, hi(r.z1 + m));
    return cx0 > cx1 || cz0 > cz1 ? null : [cx0, cz0, cx1, cz1];
  }

  /** Every cell on the border of the box is walkable (off-grid cells count as blocked). */
  private ringWalkable(x0: number, z0: number, x1: number, z1: number): boolean {
    for (let x = x0; x <= x1; x++) if (!this.walkAt(x, z0) || !this.walkAt(x, z1)) return false;
    for (let z = z0; z <= z1; z++) if (!this.walkAt(x0, z) || !this.walkAt(x1, z)) return false;
    return true;
  }

  /**
   * Label freshly walkable cells by flooding each connected group of them: a group joins the one
   * region it touches, or gets a new label. False if a group touches two regions (a merge).
   */
  private labelFreed(freed: number[]): boolean {
    const { cols, rows, walk, region } = this;
    const stack: number[] = [];
    for (const s of freed) {
      if (region[s]) continue;
      const group: number[] = [s];
      region[s] = -1;
      stack.push(s);
      let touch = 0;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % cols;
        const z = (i - x) / cols;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const nz = z + DZ[d];
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const ni = nz * cols + nx;
          if (!walk[ni]) continue;
          const r = region[ni];
          if (r === 0) {
            region[ni] = -1;
            group.push(ni);
            stack.push(ni);
          } else if (r > 0) {
            if (touch && touch !== r) return false;
            touch = r;
          }
        }
      }
      const label = touch || ++this.nextLabel;
      for (const i of group) region[i] = label;
    }
    return true;
  }

  private walkAt(ix: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && ix < this.cols && iz < this.rows && this.walk[iz * this.cols + ix] === 1;
  }

  /** `walkAt`, plus the current query mask (enemy gates). */
  private passAt(ix: number, iz: number): boolean {
    if (!this.walkAt(ix, iz)) return false;
    return !this.mask || !this.maskCovers(this.center(iz * this.cols + ix));
  }

  private passCell(i: number): boolean {
    if (this.walk[i] !== 1) return false;
    return !this.mask || !this.maskCovers(this.center(i));
  }

  private maskCovers(p: Vec2): boolean {
    const mask = this.mask;
    if (!mask) return false;
    const m = BALANCE.villagerRadius;
    for (const r of mask) {
      if (p.x > r.x0 - m && p.x < r.x1 + m && p.z > r.z0 - m && p.z < r.z1 + m) return true;
    }
    return false;
  }

  private cellOf(p: Vec2): number {
    const ix = Math.floor(p.x / NAV_CELL);
    const iz = Math.floor(p.z / NAV_CELL);
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    return iz * this.cols + ix;
  }

  private center(i: number): Vec2 {
    return { x: ((i % this.cols) + 0.5) * NAV_CELL, z: (Math.floor(i / this.cols) + 0.5) * NAV_CELL };
  }

  /** Walkable cell nearest to `p` (in region `reg`, or any region when 0), or -1. */
  private nearestCell(p: Vec2, reg: number, accept?: (p: Vec2) => boolean): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / NAV_CELL)));
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor(p.z / NAV_CELL)));
    const maxR = Math.max(this.cols, this.rows);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= maxR; r++) {
      if (best >= 0 && (r - 1) * NAV_CELL > bestD) break;
      for (let iz = cz - r; iz <= cz + r; iz++) {
        if (iz < 0 || iz >= this.rows) continue;
        const edge = iz === cz - r || iz === cz + r;
        for (let ix = cx - r; ix <= cx + r; ix += edge ? 1 : 2 * r) {
          if (ix >= 0 && ix < this.cols) {
            const i = iz * this.cols + ix;
            if (this.passCell(i) && (reg === 0 || this.region[i] === reg)) {
              const c = this.center(i);
              if (accept && !accept(c)) continue;
              const d = Math.hypot(c.x - p.x, c.z - p.z);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
          if (r === 0) break;
        }
      }
    }
    return best;
  }

  private labelRegions(): void {
    const { cols, rows, walk, region } = this;
    region.fill(0);
    const stack: number[] = [];
    let label = 0;
    for (let s = 0; s < walk.length; s++) {
      if (!walk[s] || region[s]) continue;
      region[s] = ++label;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % cols;
        const z = (i - x) / cols;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const nz = z + DZ[d];
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const ni = nz * cols + nx;
          if (walk[ni] && !region[ni]) {
            region[ni] = label;
            stack.push(ni);
          }
        }
      }
    }
    this.nextLabel = label;
  }

  /** A* from cell to cell; returns the cell chain start→goal, or null. */
  private search(start: number, goal: number, greed: number): number[] | null {
    const w = 1.0001 * Math.max(1, greed);
    const { cols, rows, g, parent, seen, closed } = this;
    const gen = ++this.gen;
    const gx = goal % cols;
    const gz = (goal - gx) / cols;
    const h = (i: number) => {
      const x = i % cols;
      const ax = Math.abs(x - gx);
      const az = Math.abs((i - x) / cols - gz);
      return (ax + az + (Math.SQRT2 - 2) * Math.min(ax, az)) * w;
    };
    this.heapCell.length = 0;
    this.heapF.length = 0;
    g[start] = 0;
    parent[start] = -1;
    seen[start] = gen;
    this.push(start, h(start));
    let found = false;
    while (this.heapCell.length) {
      const cur = this.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      this.expanded++;
      if (cur === goal) {
        found = true;
        break;
      }
      const x = cur % cols;
      const z = (cur - x) / cols;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (!this.passCell(ni) || closed[ni] === gen) continue;
        if (d >= 4 && (!this.passCell(z * cols + nx) || !this.passCell(nz * cols + x))) continue;
        const ng = g[cur] + COST[d];
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          parent[ni] = cur;
          this.push(ni, ng + h(ni));
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let i = goal; i !== -1; i = parent[i]) cells.push(i);
    return cells.reverse();
  }

  /** Line-of-sight pruning; returns the kept points after pts[0]. */
  private smooth(pts: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = a + 1;
      while (b + 1 < pts.length && this.lineOfSight(pts[a], pts[b + 1])) b++;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }

  private push(cell: number, f: number): void {
    const hc = this.heapCell;
    const hf = this.heapF;
    let i = hc.length;
    hc.push(cell);
    hf.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hc[i] = hc[p];
      hf[i] = hf[p];
      i = p;
    }
    hc[i] = cell;
    hf[i] = f;
  }

  private pop(): number {
    const hc = this.heapCell;
    const hf = this.heapF;
    const top = hc[0];
    const lastC = hc.pop()!;
    const lastF = hf.pop()!;
    const n = hc.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && hf[r] < hf[l] ? r : l;
        if (hf[c] >= lastF) break;
        hc[i] = hc[c];
        hf[i] = hf[c];
        i = c;
      }
      hc[i] = lastC;
      hf[i] = lastF;
    }
    return top;
  }
}
