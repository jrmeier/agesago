import type { Heightfield, Vec2 } from '../core/types';
import { BALANCE } from './balance';

/** A circular obstacle (building footprint) that paths must avoid. */
export interface Obstacle {
  pos: Vec2;
  radius: number;
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
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** 1 where a villager can stand at the cell centre. */
  private readonly walk: Uint8Array;
  /** Connected-region label per cell (0 = blocked). */
  private readonly region: Int32Array;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private heapCell: number[] = [];
  private heapF: number[] = [];

  constructor(
    readonly hf: Heightfield,
    readonly obstacles: Obstacle[] = []
  ) {
    this.cols = Math.max(1, Math.ceil(hf.width / NAV_CELL));
    this.rows = Math.max(1, Math.ceil(hf.depth / NAV_CELL));
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.region = new Int32Array(n);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.center(i);
      this.walk[i] = this.isFree(c) ? 1 : 0;
    }
    this.labelRegions();
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
    return true;
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

  /** Waypoints from `from` to `to` (excluding `from`), or null if unreachable. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    let start = this.cellOf(from);
    const startFree = start >= 0 && this.walk[start] === 1;
    if (!startFree) {
      start = this.nearestCell(from, 0);
      if (start < 0) return null;
    }
    const reg = this.region[start];

    let goal = this.cellOf(to);
    const goalExact = goal >= 0 && this.walk[goal] === 1;
    if (goalExact) {
      if (this.region[goal] !== reg) return null;
    } else {
      goal = this.nearestCell(to, reg);
      if (goal < 0) return null;
    }

    if (startFree && goalExact && this.lineOfSight(from, to)) return [{ x: to.x, z: to.z }];

    const cells = this.search(start, goal);
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
      if (!this.walkAt(ix, iz)) return false;
      if (ix === ex && iz === ez) return true;
      if (Math.abs(tx - tz) < 1e-9) {
        if (!this.walkAt(ix + sx, iz) || !this.walkAt(ix, iz + sz)) return false;
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

  private walkAt(ix: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && ix < this.cols && iz < this.rows && this.walk[iz * this.cols + ix] === 1;
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
  private nearestCell(p: Vec2, reg: number): number {
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
            if (this.walk[i] === 1 && (reg === 0 || this.region[i] === reg)) {
              const c = this.center(i);
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
  }

  /** A* from cell to cell; returns the cell chain start→goal, or null. */
  private search(start: number, goal: number): number[] | null {
    const { cols, rows, walk, g, parent, seen, closed } = this;
    const gen = ++this.gen;
    const gx = goal % cols;
    const gz = (goal - gx) / cols;
    const h = (i: number) => {
      const x = i % cols;
      const ax = Math.abs(x - gx);
      const az = Math.abs((i - x) / cols - gz);
      return (ax + az + (Math.SQRT2 - 2) * Math.min(ax, az)) * 1.0001;
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
        if (!walk[ni] || closed[ni] === gen) continue;
        if (d >= 4 && (!walk[z * cols + nx] || !walk[nz * cols + x])) continue;
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
