import type { EntityId, Unit, Vec2 } from '../../core/types';
import { BALANCE } from '../balance';
import { UNEXPLORED } from '../visibility';
import { unitSight } from './stats';
import type { World } from '../World';
import { route } from './passage';

/** Per-unit auto-explore bookkeeping kept off the frozen Unit shape. */
export interface ExploreState {
  /** Unexplored ground the unit is heading for (claimed against other explorers), or null before planning. */
  target: Vec2 | null;
  /** visibility.version when the target was picked. */
  planVersion: number;
}

/** 'explore' command: drop current work and queue every unit for a frontier search. */
export function orderExplore(world: World, unitIds: EntityId[]): void {
  for (const id of unitIds) {
    const u = world.units.get(id);
    if (!u) continue;
    u.path = [];
    u.gatherNode = null;
    u.gatherType = null;
    world.gatherState.delete(u.id);
    world.exploreState.set(u.id, { target: null, planVersion: -1 });
    world.exploreQueue.delete(u.id);
    world.exploreQueue.add(u.id);
    world.setState(u, 'exploring');
  }
}

/**
 * Cancel auto-explore for units about to receive another order. Their state is left as is;
 * call settleCancelled() after the new order so units it couldn't take go idle.
 */
export function cancelExplore(world: World, units: Unit[]): Unit[] {
  const cancelled: Unit[] = [];
  for (const u of units) {
    if (!world.exploreState.delete(u.id)) continue;
    world.exploreQueue.delete(u.id);
    cancelled.push(u);
  }
  return cancelled;
}

/** Cancelled explorers that the new order didn't take stop where they are. */
export function settleCancelled(world: World, cancelled: Unit[]): void {
  for (const u of cancelled) {
    if (u.state !== 'exploring') continue;
    u.path = [];
    world.setState(u, 'idle');
  }
}

/**
 * Queue explorers that need a new target (none yet, target revealed, or arrived), then run at
 * most BALANCE.exploreSearchesPerTick frontier searches, oldest request first.
 */
export function exploreSystem(world: World): void {
  const vis = world.visibility;
  for (const [id, st] of world.exploreState) {
    const u = world.units.get(id);
    if (!u || u.state !== 'exploring') {
      world.exploreState.delete(id);
      world.exploreQueue.delete(id);
      continue;
    }
    if (world.exploreQueue.has(id)) continue;
    const stale =
      !st.target || vis.isExplored(st.target.x, st.target.z) || (!u.path.length && vis.version !== st.planVersion);
    if (stale) world.exploreQueue.add(id);
  }
  // Deterministic work budget: frontier BFS cells plus weighted A* expansions. The first plan
  // always runs, so a far target costs one plan this tick instead of several.
  let searches = 0;
  let work = 0;
  for (const id of world.exploreQueue) {
    if (searches >= BALANCE.exploreSearchesPerTick || work >= BALANCE.exploreWorkPerTick) break;
    searches++;
    world.exploreQueue.delete(id);
    const u = world.units.get(id);
    const st = world.exploreState.get(id);
    if (u && st) work += plan(world, u, st);
  }
}

/** Pick and path to the next target; returns the work it cost. */
function plan(world: World, u: Unit, st: ExploreState): number {
  const grid = gridOf(world);
  const visited0 = grid.visited;
  const expanded0 = world.nav.expanded;
  planTarget(world, u, st);
  return grid.visited - visited0 + A_STAR_WEIGHT * (world.nav.expanded - expanded0);
}

/** An A* expansion costs about this many frontier-BFS cells. */
const A_STAR_WEIGHT = 3;

function planTarget(world: World, u: Unit, st: ExploreState): void {
  const target = findFrontier(world, u);
  const path = target && route(world, u.owner, u.pos, target, BALANCE.explorePathGreed);
  if (!target || !path) {
    world.exploreState.delete(u.id);
    u.path = [];
    world.setState(u, 'idle');
    return;
  }
  u.path = path;
  st.target = target;
  st.planVersion = world.visibility.version;
}

/** Sample points inside a 1-unit fog cell — the centres of its four 0.5-unit nav cells. */
const SUB = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

/**
 * Fog-resolution (1 unit) copy of the nav grid used for frontier BFS: 4× fewer cells than the
 * nav grid. A fog cell is open if any nav cell inside it is walkable, and the BFS is
 * 8-connected without corner rules, so its connectivity is a superset of the nav grid's;
 * candidates are then checked against the unit's exact nav region so every target is reachable.
 * Padded with a closed one-cell border so the BFS needs no bounds checks.
 */
class FrontierGrid {
  /** Padded row stride (fog cols + 2). */
  readonly stride: number;
  /** Nav region of the first walkable sample in each padded cell (0 = closed). */
  readonly region: Int32Array;
  /** Index into SUB of that sample. */
  readonly sub: Uint8Array;
  /** Padded index → index into visibility.state. */
  readonly fog: Int32Array;
  /** Search generation that last queued each cell; CLOSED for cells the BFS never enters. */
  readonly seen: Int32Array;
  readonly queue: Int32Array;
  /** Padded-index offsets of the 8 neighbours. */
  readonly offsets: Int32Array;
  gen = 0;
  /** Running total of cells the frontier BFS has visited (work meter). */
  visited = 0;
  /** A search that found nothing: skip identical searches until the fog changes. */
  emptyVersion = -1;
  emptyRegion = 0;
  /** nav.version this copy was built from; buildings placed or removed since make it stale. */
  readonly navVersion: number;

  constructor(
    world: World,
    readonly cols = world.visibility.cols,
    readonly rows = world.visibility.rows
  ) {
    const w = (this.stride = cols + 2);
    const n = w * (rows + 2);
    this.region = new Int32Array(n);
    this.sub = new Uint8Array(n);
    this.fog = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.offsets = Int32Array.of(1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1);
    this.navVersion = world.nav.version;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.fog[(r + 1) * w + c + 1] = r * cols + c;
        for (let s = 0; s < 4; s++) {
          const reg = world.nav.regionOfCell({ x: c + SUB[s][0], z: r + SUB[s][1] });
          if (reg) {
            this.region[(r + 1) * w + c + 1] = reg;
            this.sub[(r + 1) * w + c + 1] = s;
            break;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) if (!this.region[i]) this.seen[i] = CLOSED;
  }
}

/** `seen` value of closed cells: never below a search generation, so one compare skips both. */
const CLOSED = 0x7fffffff; // stays a small integer for the JIT (Uint32 values above 2^31 are doubles)

const grids = new WeakMap<World, FrontierGrid>();

function gridOf(world: World): FrontierGrid {
  let g = grids.get(world);
  if (!g || g.navVersion !== world.nav.version) {
    const fresh = new FrontierGrid(world);
    if (g) fresh.visited = g.visited; // keep the work meter monotonic
    grids.set(world, (g = fresh));
  }
  return g;
}

/**
 * Nearest reachable unexplored ground for `u`, biased toward its heading so it sweeps, and
 * away from targets other explorers have claimed. BFS over fog cells from the unit: after the
 * first unexplored cell (ring d0) it continues only a bounded number of rings to compare
 * candidates, so it touches few cells while unexplored ground is near and floods the whole
 * region only when the map is almost done. Null when nothing reachable is unexplored.
 */
export function findFrontier(world: World, u: Unit): Vec2 | null {
  const grid = gridOf(world);
  const vis = world.visibility;
  const unitRegion = world.nav.regionAt(u.pos);
  if (!unitRegion) return null;
  if (grid.emptyVersion === vis.version && grid.emptyRegion === unitRegion) return null;

  const { cols, rows, stride, region, fog, seen, queue, offsets } = grid;
  const state = vis.state;
  const hx = Math.sin(u.facing);
  const hz = Math.cos(u.facing);
  const ux = u.pos.x;
  const uz = u.pos.z;
  const bias = BALANCE.exploreForwardBias / 2;

  const claimR = unitSight(world, u.owner, u.kind);
  const claimR2 = claimR * claimR;
  const claims: number[] = [];
  for (const [id, st] of world.exploreState) {
    if (id !== u.id && st.target) claims.push(st.target.x, st.target.z);
  }

  const sc = Math.min(cols - 1, Math.max(0, Math.floor(ux)));
  const sr = Math.min(rows - 1, Math.max(0, Math.floor(uz)));
  const start = (sr + 1) * stride + sc + 1;
  const gen = ++grid.gen;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = gen;
  let depth = 0;
  let levelEnd = tail;
  let limit = Infinity;
  let best = -1;
  let bestScore = Infinity;
  while (head < tail) {
    if (head === levelEnd) {
      if (++depth > limit) break;
      levelEnd = tail;
    }
    const cur = queue[head++];
    if (region[cur] === unitRegion && state[fog[cur]] === UNEXPLORED) {
      if (limit === Infinity) limit = depth + Math.max(4, Math.min(depth, 12));
      const x = (cur % stride) - 0.5;
      const z = ((cur / stride) | 0) - 0.5;
      const dx = x - ux;
      const dz = z - uz;
      const len = Math.hypot(dx, dz);
      const cos = len > 1e-6 ? (dx * hx + dz * hz) / len : 1;
      // Ring depth (Chebyshev) only exceeds the straight distance when walls force a detour.
      let score = Math.max(len, depth) * (1 + bias * (1 - cos));
      for (let i = 0; i < claims.length; i += 2) {
        const cx = claims[i] - x;
        const cz = claims[i + 1] - z;
        if (cx * cx + cz * cz < claimR2) {
          score += 2 * claimR;
          break;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = cur;
      }
    }
    for (let d = 0; d < 8; d++) {
      const ni = cur + offsets[d];
      if (seen[ni] >= gen) continue; // visited this search, or closed (pinned at CLOSED)
      seen[ni] = gen;
      queue[tail++] = ni;
    }
  }
  grid.visited += head;
  if (best < 0) {
    grid.emptyVersion = vis.version;
    grid.emptyRegion = unitRegion;
    return null;
  }
  const s = SUB[grid.sub[best]];
  return { x: (best % stride) - 1 + s[0], z: ((best / stride) | 0) - 1 + s[1] };
}
