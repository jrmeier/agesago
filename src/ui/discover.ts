import type { NodeKind, PropKind, PropPlacement, Vec2 } from '../core/types';

/** Points of interest worth a "discovered" toast. */
export type SiteKind = 'ruins' | 'stones' | 'hamlet' | 'gold' | 'stone';

export interface Site {
  /** Stable key, e.g. "ruins:3". */
  id: string;
  kind: SiteKind;
  /** Centroid — where the camera jumps. */
  pos: Vec2;
  /** Member positions; the site counts as discovered once any of them is explored. */
  points: Vec2[];
}

interface PropRule {
  kinds: readonly PropKind[];
  /** Single-link clustering distance. */
  link: number;
  /** Fewest members for a cluster to count as a site. */
  min: number;
}

const PROP_RULES: Record<'ruins' | 'stones' | 'hamlet', PropRule> = {
  ruins: { kinds: ['ruinColumn', 'ruinWall'], link: 7, min: 2 },
  stones: { kinds: ['standingStone'], link: 6, min: 3 },
  hamlet: { kinds: ['house', 'well'], link: 9, min: 3 },
};

/** Resource clusters closer than this to home are the starting patches, not discoveries. */
export const NEAR_HOME = 26;
const NODE_LINK = 5;

const LABEL: Record<SiteKind, string> = {
  ruins: 'Ruins',
  stones: 'Standing stones',
  hamlet: 'A hamlet',
  gold: 'Gold',
  stone: 'A stone quarry',
};

/** Closer than this to home, a site is "nearby" rather than in a compass direction. */
const NEARBY = 12;
const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** Single-link clusters of points within `link` of each other. */
export function cluster(points: readonly Vec2[], link: number): Vec2[][] {
  const n = points.length;
  const group = new Int32Array(n).fill(-1);
  const out: Vec2[][] = [];
  for (let i = 0; i < n; i++) {
    if (group[i] >= 0) continue;
    const members: Vec2[] = [];
    const stack = [i];
    group[i] = out.length;
    while (stack.length) {
      const a = stack.pop()!;
      members.push(points[a]);
      for (let b = 0; b < n; b++) {
        if (group[b] >= 0) continue;
        if (Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z) <= link) {
          group[b] = out.length;
          stack.push(b);
        }
      }
    }
    out.push(members);
  }
  return out;
}

export function centroid(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/**
 * Points of interest from the map layout: ruin clusters, standing-stone circles / rows,
 * hamlets (houses round a well) and gold / stone deposits away from home.
 */
export function findSites(
  props: readonly Pick<PropPlacement, 'kind' | 'pos'>[],
  nodes: Iterable<{ kind: NodeKind; pos: Vec2 }>,
  home: Vec2
): Site[] {
  const sites: Site[] = [];
  const add = (kind: SiteKind, groups: Vec2[][], min: number, far: boolean): void => {
    for (const points of groups) {
      if (points.length < min) continue;
      const pos = centroid(points);
      if (far && Math.hypot(pos.x - home.x, pos.z - home.z) < NEAR_HOME) continue;
      sites.push({ id: `${kind}:${sites.length}`, kind, pos, points });
    }
  };
  for (const kind of ['ruins', 'stones', 'hamlet'] as const) {
    const rule = PROP_RULES[kind];
    const pts = props.filter((p) => rule.kinds.includes(p.kind)).map((p) => p.pos);
    add(kind, cluster(pts, rule.link), rule.min, false);
  }
  const nodeList = [...nodes];
  for (const kind of ['gold', 'stone'] as const) {
    const pts = nodeList.filter((n) => n.kind === kind).map((n) => n.pos);
    add(kind, cluster(pts, NODE_LINK), 1, true);
  }
  return sites;
}

/** Compass word for `to` as seen from `from` (north = −z, east = +x), or 'nearby'. */
export function directionWord(from: Vec2, to: Vec2): string {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < NEARBY) return 'nearby';
  const bearing = Math.atan2(dx, -dz); // 0 = north, π/2 = east
  const sector = Math.round(bearing / (Math.PI / 4));
  return DIRECTIONS[((sector % 8) + 8) % 8];
}

/** "Ruins discovered to the north-east", "Gold discovered nearby". */
export function discoveryText(kind: SiteKind, home: Vec2, pos: Vec2): string {
  const dir = directionWord(home, pos);
  return `${LABEL[kind]} discovered ${dir === 'nearby' ? 'nearby' : `to the ${dir}`}`;
}

/** Remembers which sites have been seen; check() returns the ones explored since last time. */
export class DiscoveryTracker {
  private readonly pending: Site[];

  constructor(sites: readonly Site[]) {
    this.pending = [...sites];
  }

  get remaining(): number {
    return this.pending.length;
  }

  check(isExplored: (x: number, z: number) => boolean): Site[] {
    const found: Site[] = [];
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      if (s.points.some((p) => isExplored(p.x, p.z))) {
        found.unshift(s);
        this.pending.splice(i, 1);
      }
    }
    return found;
  }
}

/** FIFO that releases at most one item per `interval` seconds. */
export class RateLimitedQueue<T> {
  private readonly items: T[] = [];
  private last = -Infinity;

  constructor(readonly interval = 4) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
  }

  /** The next item if one is waiting and `interval` has passed since the last release. */
  poll(now: number): T | null {
    if (!this.items.length || now - this.last < this.interval) return null;
    this.last = now;
    return this.items.shift()!;
  }
}
