import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, type NodeKind, type PropKind, type Vec2 } from '../core/types';
import { generateMap } from '../sim/mapgen';
import { DiscoveryTracker, NEAR_HOME, RateLimitedQueue, cluster, directionWord, discoveryText, findSites } from './discover';

const home = { x: 100, z: 100 };

describe('direction words (north = −z, east = +x)', () => {
  it('names the eight compass points', () => {
    const at = (dx: number, dz: number) => directionWord(home, { x: home.x + dx, z: home.z + dz });
    expect(at(0, -40)).toBe('north');
    expect(at(30, -30)).toBe('north-east');
    expect(at(40, 0)).toBe('east');
    expect(at(30, 30)).toBe('south-east');
    expect(at(0, 40)).toBe('south');
    expect(at(-30, 30)).toBe('south-west');
    expect(at(-40, 0)).toBe('west');
    expect(at(-30, -30)).toBe('north-west');
    expect(at(40, -10)).toBe('east');
    expect(at(3, 4)).toBe('nearby');
  });

  it('writes the toast text', () => {
    expect(discoveryText('ruins', home, { x: 130, z: 70 })).toBe('Ruins discovered to the north-east');
    expect(discoveryText('gold', home, { x: 102, z: 101 })).toBe('Gold discovered nearby');
  });
});

describe('rate-limited toasts', () => {
  it('releases at most one item per interval, in order', () => {
    const q = new RateLimitedQueue<string>(4);
    expect(q.poll(0)).toBeNull();
    q.push('a');
    q.push('b');
    q.push('c');
    expect(q.poll(10)).toBe('a');
    expect(q.poll(11)).toBeNull();
    expect(q.poll(13.9)).toBeNull();
    expect(q.poll(14)).toBe('b');
    expect(q.poll(30)).toBe('c');
    expect(q.poll(40)).toBeNull();
    expect(q.size).toBe(0);
  });
});

describe('points of interest on the generated map', () => {
  it('finds every ruin, the stone circle, both hamlets and some far deposits — none at home', () => {
    const { layout } = generateMap(DEFAULT_SEED);
    const sites = findSites(layout.props, layout.nodes, layout.townCenter);
    const count = (k: string) => sites.filter((s) => s.kind === k).length;
    expect(count('ruins')).toBe(3);
    expect(count('stones')).toBeGreaterThanOrEqual(1);
    expect(count('hamlet')).toBe(2);
    expect(count('gold') + count('stone')).toBeGreaterThan(0);
    // Sites are distinct places, not fragments of one.
    for (const a of sites) for (const b of sites) if (a !== b && a.kind === b.kind) {
      expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(8);
    }
  });
});

describe('points of interest', () => {
  const prop = (kind: PropKind, x: number, z: number) => ({ kind, pos: { x, z } });
  const node = (kind: NodeKind, x: number, z: number) => ({ kind, pos: { x, z } });

  it('clusters nearby points', () => {
    const pts: Vec2[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 6, z: 0 },
      { x: 50, z: 50 },
    ];
    expect(cluster(pts, 4).map((c) => c.length).sort()).toEqual([1, 3]);
  });

  it('finds ruins, stone circles, hamlets and distant deposits', () => {
    const props = [
      ...[0, 3, 6].map((d) => prop('ruinColumn', 30 + d, 30)),
      prop('ruinWall', 33, 25),
      ...Array.from({ length: 9 }, (_, i) => prop('standingStone', 150 + 4 * Math.cos(i), 40 + 4 * Math.sin(i))),
      prop('standingStone', 10, 160), // a lone stone is not a site
      prop('house', 120, 120),
      prop('house', 130, 120),
      prop('well', 125, 122),
      prop('boulder', 60, 60),
    ];
    const nodes = [
      node('gold', home.x + 5, home.z), // the starting patch: not a discovery
      node('gold', 20, 150),
      node('gold', 22, 151),
      node('stone', 160, 160),
      node('tree', 10, 10),
    ];
    const sites = findSites(props, nodes, home);
    expect(sites.map((s) => s.kind).sort()).toEqual(['gold', 'hamlet', 'ruins', 'stone', 'stones']);
    const gold = sites.find((s) => s.kind === 'gold')!;
    expect(gold.points).toHaveLength(2);
    expect(Math.hypot(gold.pos.x - home.x, gold.pos.z - home.z)).toBeGreaterThan(NEAR_HOME);
    expect(new Set(sites.map((s) => s.id)).size).toBe(sites.length);
  });

  it('reports each site once, when any of its points is explored', () => {
    const sites = findSites([prop('ruinColumn', 10, 10), prop('ruinColumn', 12, 10)], [node('stone', 160, 160)], home);
    const tracker = new DiscoveryTracker(sites);
    const explored = new Set<string>();
    const isExplored = (x: number, z: number) => explored.has(`${Math.floor(x)},${Math.floor(z)}`);
    expect(tracker.check(isExplored)).toEqual([]);
    explored.add('12,10');
    expect(tracker.check(isExplored).map((s) => s.kind)).toEqual(['ruins']);
    expect(tracker.check(isExplored)).toEqual([]);
    explored.add('160,160');
    expect(tracker.check(isExplored).map((s) => s.kind)).toEqual(['stone']);
    expect(tracker.remaining).toBe(0);
  });
});
