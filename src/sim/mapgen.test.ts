import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Heightfield, type MapLayout, type PropPlacement, type Vec2 } from '../core/types';
import { BUILD_RING_RADIUS, generateMap, START_RADIUS } from './mapgen';
import { terrainFeatures } from './terrain';

// The synchronous seed sweep can exceed Vitest's worker RPC deadline on CI.
// Let pending worker messages drain between cases without changing generation timings.
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function footprint(prop: PropPlacement): number {
  if (prop.blockRadius > 0) return prop.blockRadius;
  return prop.scale * (prop.kind === 'wheatField' ? 2.8 : prop.kind === 'reeds' ? 0.4 : 0.55);
}

function floodFill(hf: Heightfield, layout: MapLayout, step = 0.5): (pos: Vec2) => boolean {
  const columns = Math.ceil(hf.width / step);
  const rows = Math.ceil(hf.depth / step);
  const walk = new Uint8Array(columns * rows);
  const visited = new Uint8Array(walk.length);
  const queue = new Int32Array(walk.length);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      walk[row * columns + column] = hf.isWalkable((column + 0.5) * step, (row + 0.5) * step) ? 1 : 0;
    }
  }
  const obstacles = [layout, ...(layout.extraStarts ?? [])].map((start) => ({ pos: start.townCenter, radius: 2.3 })).concat([
    ...layout.props.filter((p) => p.blockRadius > 0).map((p) => ({ pos: p.pos, radius: p.blockRadius }))]);
  for (const obstacle of obstacles) {
    const r = obstacle.radius + 0.3;
    const left = Math.max(0, Math.floor((obstacle.pos.x - r) / step));
    const right = Math.min(columns - 1, Math.ceil((obstacle.pos.x + r) / step));
    const top = Math.max(0, Math.floor((obstacle.pos.z - r) / step));
    const bottom = Math.min(rows - 1, Math.ceil((obstacle.pos.z + r) / step));
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        if (distance(obstacle.pos, { x: (column + 0.5) * step, z: (row + 0.5) * step }) < r) walk[row * columns + column] = 0;
      }
    }
  }
  const start = layout.villagers[1];
  const first = Math.floor(start.z / step) * columns + Math.floor(start.x / step);
  expect(walk[first]).toBe(1);
  queue[0] = first;
  visited[first] = 1;
  let tail = 1;
  const dx = [-1, 1, 0, 0];
  const dz = [0, 0, -1, 1];
  for (let head = 0; head < tail; head++) {
    const index = queue[head];
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (let d = 0; d < 4; d++) {
      const x = column + dx[d];
      const z = row + dz[d];
      if (x < 0 || z < 0 || x >= columns || z >= rows) continue;
      const next = z * columns + x;
      if (visited[next] || !walk[next]) continue;
      if (!hf.isWalkable((column + 0.5 + dx[d] / 2) * step, (row + 0.5 + dz[d] / 2) * step)) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }
  return (pos) => {
    const column = Math.floor(pos.x / step);
    const row = Math.floor(pos.z / step);
    if (!hf.isWalkable(pos.x, pos.z) || column < 0 || row < 0 || column >= columns || row >= rows) return false;
    if (visited[row * columns + column]) return true;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = column + dx;
        const z = row + dz;
        if (x < 0 || z < 0 || x >= columns || z >= rows || !visited[z * columns + x]) continue;
        const target = { x: (x + 0.5) * step, z: (z + 0.5) * step };
        const count = Math.ceil(distance(pos, target) / 0.15);
        let clear = true;
        for (let i = 0; i <= count; i++) {
          const p = { x: pos.x + (target.x - pos.x) * i / count, z: pos.z + (target.z - pos.z) * i / count };
          if (!hf.isWalkable(p.x, p.z) || obstacles.some((o) => distance(o.pos, p) < o.radius + 0.3)) clear = false;
        }
        if (clear) return true;
      }
    }
    return false;
  };
}

/** Town centers on one walkable component. Buildings and scenery do not count as water. */
function townCentersConnected(hf: Heightfield, centers: Vec2[]): boolean {
  const step = 0.5;
  const columns = Math.ceil(hf.width / step);
  const rows = Math.ceil(hf.depth / step);
  const walk = new Uint8Array(columns * rows);
  const visited = new Uint8Array(walk.length);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      walk[row * columns + column] = hf.isWalkable((column + 0.5) * step, (row + 0.5) * step) ? 1 : 0;
    }
  }
  const queue = new Int32Array(walk.length);
  const origin = centers[0];
  const first = Math.floor(origin.z / step) * columns + Math.floor(origin.x / step);
  if (first < 0 || first >= walk.length || !walk[first]) return false;
  queue[0] = first;
  visited[first] = 1;
  let tail = 1;
  const dx = [-1, 1, 0, 0];
  const dz = [0, 0, -1, 1];
  for (let head = 0; head < tail; head++) {
    const index = queue[head];
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (let d = 0; d < 4; d++) {
      const x = column + dx[d];
      const z = row + dz[d];
      if (x < 0 || z < 0 || x >= columns || z >= rows) continue;
      const next = z * columns + x;
      if (visited[next] || !walk[next]) continue;
      if (!hf.isWalkable((column + 0.5 + dx[d] / 2) * step, (row + 0.5 + dz[d] / 2) * step)) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }
  return centers.every((center) => {
    const column = Math.floor(center.x / step);
    const row = Math.floor(center.z / step);
    return hf.isWalkable(center.x, center.z) && column >= 0 && row >= 0 && column < columns && row < rows
      && visited[row * columns + column] === 1;
  });
}

const START_KINDS = ['tree', 'berry', 'gold', 'stone'] as const;

function resourcesInStart(layout: MapLayout, center: Vec2): number[] {
  const totals = [0, 0, 0, 0];
  for (const node of layout.nodes) {
    const kind = START_KINDS.indexOf(node.kind as typeof START_KINDS[number]);
    if (kind < 0 || distance(node.pos, center) > START_RADIUS) continue;
    totals[kind] += node.amount;
  }
  return totals;
}

const cases = [1, 2, 3, 4].flatMap((players) => Array.from({ length: 10 }, (_, i) => [players, i + 1] as const));
const rivalCases = [2, 3, 4].flatMap((players) => Array.from({ length: 20 }, (_, i) => [players, i + 1] as const));

describe('generateMap', () => {
  const maps = new Map<string, ReturnType<typeof generateMap>>();
  // Forty maps. Each one is allowed 2s while the rest of the suite is running.
  beforeAll(() => {
    for (const [players, seed] of cases) {
      try {
        maps.set(`${players}/${seed}`, generateMap(seed, players));
      } catch (error) {
        throw new Error(`${players} players, seed ${seed}: ${String(error)}`);
      }
    }
  }, 120_000);

  it('defaults to a rival, supports solo play and rejects invalid counts', () => {
    expect(generateMap(1).layout).toEqual(maps.get('2/1')!.layout);
    expect(maps.get('1/1')!.layout.extraStarts).toEqual([]);
    for (const count of [0, 5, 1.5, NaN, Infinity]) expect(() => generateMap(1, count)).toThrow(RangeError);
    expect(maps.get('2/1')!.layout).not.toEqual(maps.get('2/2')!.layout);
  });

  it.each(cases)('is deterministic and generates quickly (budget 700 ms; 2 s bound under parallel test load) for %i players, seed %i', (players, seed) => {
    const first = maps.get(`${players}/${seed}`)!;
    const start = performance.now();
    const repeated = generateMap(seed, players);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(repeated.layout).toEqual(first.layout);
    for (let z = 0; z <= first.hf.depth; z += 7.5) {
      for (let x = 0; x <= first.hf.width; x += 7.5) {
        expect(repeated.hf.heightAt(x, z)).toBe(first.hf.heightAt(x, z));
        expect(repeated.hf.ground(x, z)).toEqual(first.hf.ground(x, z));
      }
    }
  });

  it.each(cases)('spreads level starts with equal kits and open construction rings for %i players, seed %i', (players, seed) => {
    const { hf, layout } = maps.get(`${players}/${seed}`)!;
    const starts = [layout, ...layout.extraStarts!];
    expect(starts).toHaveLength(players);
    const totals = starts.map((start) => {
      const tc = start.townCenter;
      expect(start.villagers).toHaveLength(3);
      expect(start.scouts).toHaveLength(1);
      expect(tc.x).toBeGreaterThan(START_RADIUS);
      expect(tc.z).toBeGreaterThan(START_RADIUS);
      expect(tc.x).toBeLessThan(hf.width - START_RADIUS);
      expect(tc.z).toBeLessThan(hf.depth - START_RADIUS);
      const height = hf.heightAt(tc.x, tc.z);
      expect(height).toBeGreaterThan(0.8);
      for (let z = -3; z <= 3; z += 0.5) {
        for (let x = -3; x <= 3; x += 0.5) {
          expect(hf.heightAt(tc.x + x, tc.z + z)).toBeCloseTo(height, 12);
          expect(hf.isWalkable(tc.x + x, tc.z + z)).toBe(true);
          expect(hf.forestDensity(tc.x + x, tc.z + z)).toBe(0);
        }
      }
      const nodes = layout.nodes.filter((node) => distance(node.pos, tc) <= START_RADIUS);
      expect(nodes.filter((node) => node.kind === 'tree')).toHaveLength(20);
      expect(nodes.filter((node) => node.kind === 'berry')).toHaveLength(7);
      expect(nodes.filter((node) => node.kind === 'gold')).toHaveLength(2);
      expect(nodes.filter((node) => node.kind === 'stone')).toHaveLength(2);
      expect(nodes.every((node) => distance(node.pos, tc) <= 18)).toBe(true);
      expect(layout.props.filter((prop) => distance(prop.pos, tc) < START_RADIUS + footprint(prop))).toEqual([]);
      for (const node of layout.nodes) {
        expect(distance(node.pos, tc)).toBeGreaterThanOrEqual(BUILD_RING_RADIUS + (node.kind === 'gold' || node.kind === 'stone' ? 0.8 : 0.5));
      }
      // Every orientation offers usable building footprints inside the cleared ring.
      for (let a = 0; a < 24; a++) {
        const angle = a * Math.PI / 12;
        const center = { x: tc.x + Math.cos(angle) * 8.5, z: tc.z + Math.sin(angle) * 8.5 };
        for (const x of [-1.5, 0, 1.5]) {
          for (const z of [-1.5, 0, 1.5]) expect(hf.isWalkable(center.x + x, center.z + z)).toBe(true);
        }
        expect(nodes.every((node) => distance(node.pos, center) >= 2.9)).toBe(true);
      }
      return ['tree', 'berry', 'gold', 'stone'].map((kind) => nodes.filter((node) => node.kind === kind).reduce((sum, node) => sum + node.amount, 0));
    });
    expect(totals[0]).toEqual([2000, 875, 800, 700]);
    for (const total of totals) expect(total).toEqual(totals[0]);
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        expect(distance(starts[i].townCenter, starts[j].townCenter)).toBeGreaterThan(70);
      }
      if (players > 1) {
        const a = starts[i].townCenter;
        const b = starts[(i + 1) % players].townCenter;
        expect(distance(a, b)).toBeCloseTo(104 * Math.sin(Math.PI / players), 0);
      }
    }
  });

  it.each(cases)('keeps every start, resource and gathering approach reachable with scenery blocked for %i players, seed %i', (players, seed) => {
    const { hf, layout } = maps.get(`${players}/${seed}`)!;
    const reachable = floodFill(hf, layout);
    const units = [layout, ...layout.extraStarts!].flatMap((start) => [...start.villagers, ...start.scouts]);
    expect([...units, ...layout.nodes.filter((node) => node.kind !== 'fish').map((node) => node.pos)].filter((pos) => !reachable(pos))).toEqual([]);
    const quarries = layout.nodes.filter((node) => node.kind === 'stone');
    expect(quarries).toHaveLength(10 + players * 2);
    const blockedApproaches = layout.nodes.filter((node) => node.kind !== 'fish').filter((node) => {
      const radius = node.kind === 'stone' || node.kind === 'gold' ? 1.3 : 1.1;
      const approaches = Array.from({ length: 8 }, (_, a) => {
        const angle = a * Math.PI / 4;
        return reachable({ x: node.pos.x + Math.cos(angle) * radius, z: node.pos.z + Math.sin(angle) * radius });
      });
      return node.kind === 'stone' ? approaches.some((clear) => !clear) : !approaches.some(Boolean);
    });
    expect(blockedApproaches).toEqual([]);
    expect(layout.animals).toHaveLength(12);
    for (const animal of layout.animals!) {
      expect(reachable(animal.pos)).toBe(true);
      for (const start of [layout, ...layout.extraStarts!]) expect(distance(animal.pos, start.townCenter)).toBeGreaterThanOrEqual(START_RADIUS + 5);
      const density = hf.forestDensity(animal.pos.x, animal.pos.z);
      if (animal.kind === 'boar') expect(density).toBeGreaterThanOrEqual(0.35);
      else expect(density).toBeLessThanOrEqual(0.25);
    }
    const fish = layout.nodes.filter((node) => node.kind === 'fish');
    expect(fish).toHaveLength(10);
    for (const node of fish) {
      expect(hf.isWater(node.pos.x, node.pos.z)).toBe(true);
      expect(hf.isWalkable(node.pos.x, node.pos.z)).toBe(false);
      expect(node.amount).toBe(200);
      let shore = false;
      for (let a = 0; a < 32; a++) for (let r = 0.5; r <= 4; r += 0.5) {
        const angle = a * Math.PI / 16;
        if (reachable({ x: node.pos.x + Math.cos(angle) * r, z: node.pos.z + Math.sin(angle) * r })) shore = true;
      }
      expect(shore).toBe(true);
    }
    const f = terrainFeatures(seed);
    for (const node of fish) {
      for (const ford of f.river.fords) expect(Math.abs(node.pos.x - ford.x) >= 10.5 || Math.abs(node.pos.z - ford.z) >= 4.5).toBe(true);
      expect(Math.abs(node.pos.x - f.tributary.ford.x) >= 4.5 || Math.abs(node.pos.z - f.tributary.ford.z) >= 10.5).toBe(true);
    }
    for (const ford of f.river.fords) {
      expect(reachable({ x: ford.x - 8, z: ford.z })).toBe(true);
      expect(reachable({ x: ford.x + 8, z: ford.z })).toBe(true);
    }
    expect(reachable({ x: f.tributary.ford.x, z: f.tributary.ford.z - 8 })).toBe(true);
    expect(reachable({ x: f.tributary.ford.x, z: f.tributary.ford.z + 8 })).toBe(true);
  });

  it.each(cases)('retains exploration landmarks and spaced resources on dry ground for %i players, seed %i', (players, seed) => {
    const { hf, layout } = maps.get(`${players}/${seed}`)!;
    const centers = [layout, ...layout.extraStarts!].map((start) => start.townCenter);
    const neutral = layout.nodes.filter((node) => centers.every((center) => distance(node.pos, center) > START_RADIUS));
    expect(layout.nodes.filter((node) => node.kind === 'tree').length).toBeGreaterThanOrEqual(3000);
    expect(layout.nodes.filter((node) => node.kind === 'tree').length).toBeLessThanOrEqual(4500);
    expect(neutral.filter((node) => node.kind === 'berry')).toHaveLength(42);
    expect(neutral.filter((node) => node.kind === 'gold')).toHaveLength(12);
    expect(neutral.filter((node) => node.kind === 'stone')).toHaveLength(10);
    expect(layout.props.length).toBeGreaterThanOrEqual(500);
    expect(layout.props.length).toBeLessThanOrEqual(1100);
    expect(layout.props.filter((p) => p.kind === 'ruinColumn' || p.kind === 'ruinWall').length).toBeGreaterThanOrEqual(20);
    expect(layout.props.filter((p) => p.kind === 'house').length).toBeGreaterThanOrEqual(3);
    expect(layout.props.some((p) => p.kind === 'well')).toBe(true);
    expect(layout.props.some((p) => p.kind === 'wheatField')).toBe(true);
    const invalid = layout.nodes.filter((node) => node.kind !== 'fish').filter((node) => {
      const g = hf.ground(node.pos.x, node.pos.z);
      return node.amount !== (node.kind === 'tree' ? 100 : node.kind === 'berry' ? 125 : node.kind === 'stone' ? 350 : 400)
        || !hf.isWalkable(node.pos.x, node.pos.z) || g.path > 0.04 || g.sand > 0.24
        || (node.kind !== 'stone' && g.rock > 0.32)
        || (node.kind === 'tree' && hf.forestDensity(node.pos.x, node.pos.z) < 0.43);
    });
    expect(invalid).toEqual([]);
    // Check nearby resource pairs without an all-pairs forest scan.
    const cells = new Map<string, typeof layout.nodes>();
    let tightSpacing = false;
    for (const node of layout.nodes) {
      const column = Math.floor(node.pos.x / 8);
      const row = Math.floor(node.pos.z / 8);
      for (let z = row - 1; z <= row + 1; z++) {
        for (let x = column - 1; x <= column + 1; x++) {
          for (const other of cells.get(`${x}/${z}`) ?? []) {
            const r = (kind: string) => kind === 'stone' || kind === 'gold' ? 0.8 : 0.5;
            const minimum = node.kind === 'stone' && other.kind === 'stone' ? 8 : r(node.kind) + r(other.kind) + 0.2;
            if (distance(node.pos, other.pos) < minimum - 1e-9) tightSpacing = true;
          }
        }
      }
      const key = `${column}/${row}`;
      const cell = cells.get(key) ?? [];
      cell.push(node);
      cells.set(key, cell);
    }
    expect(tightSpacing).toBe(false);
    const invalidProps = layout.props.filter((prop) => hf.isWater(prop.pos.x, prop.pos.z)
      || hf.ground(prop.pos.x, prop.pos.z).path > 0.035 || !Number.isFinite(prop.rot) || prop.scale < 0.7 || prop.scale > 1.4);
    expect(invalidProps).toEqual([]);
    let overlap = false;
    for (let i = 0; i < layout.props.length; i++) {
      const prop = layout.props[i];
      const radius = footprint(prop);
      for (const node of layout.nodes) {
        if (distance(prop.pos, node.pos) < radius + (node.kind === 'gold' || node.kind === 'stone' ? 0.8 : 0.5) + 0.2 - 1e-8) overlap = true;
      }
      for (const other of layout.props.slice(0, i)) {
        if (distance(prop.pos, other.pos) < radius + footprint(other) + 0.2 - 1e-8) overlap = true;
      }
    }
    expect(overlap).toBe(false);
  });

  it('also keeps resources connected on the coarser navigation grid', () => {
    const { hf, layout } = maps.get('4/1')!;
    const reachable = floodFill(hf, layout, 1);
    expect(layout.nodes.filter((node) => node.kind !== 'fish' && !reachable(node.pos))).toEqual([]);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 11))('retains the earlier extended seed coverage for seed %i', (seed) => {
    const { hf, layout } = generateMap(seed);
    const reachable = floodFill(hf, layout);
    expect(layout.extraStarts).toHaveLength(1);
    expect(layout.nodes.filter((node) => node.kind === 'stone')).toHaveLength(14);
    expect(layout.nodes.filter((node) => node.kind !== 'fish' && !reachable(node.pos))).toEqual([]);
    expect([layout, ...layout.extraStarts!].flatMap((start) => [...start.villagers, ...start.scouts])
      .filter((pos) => !reachable(pos))).toEqual([]);
  });

  // 700 ms is the desktop target. 2 s matches the other generateMap bound while the suite runs in parallel.
  it.each(rivalCases)('keeps starting resources within 10% and town centers connected by land for %i players, seed %i', (players, seed) => {
    const start = performance.now();
    const { hf, layout } = generateMap(seed, players);
    expect(performance.now() - start).toBeLessThan(2000);
    const starts = [layout, ...(layout.extraStarts ?? [])];
    expect(starts).toHaveLength(players);
    const totals = starts.map((playerStart) => resourcesInStart(layout, playerStart.townCenter));
    for (let i = 0; i < totals.length; i++) {
      for (let j = i + 1; j < totals.length; j++) {
        for (let kind = 0; kind < START_KINDS.length; kind++) {
          const a = totals[i][kind];
          const b = totals[j][kind];
          expect(a, START_KINDS[kind]).toBeGreaterThan(0);
          expect(Math.abs(a - b) * 10, START_KINDS[kind]).toBeLessThanOrEqual(Math.min(a, b));
        }
      }
    }
    expect(townCentersConnected(hf, starts.map((playerStart) => playerStart.townCenter))).toBe(true);
  }, 20_000);

  it('keeps 80k cached ground queries cheap', () => {
    const hf = maps.get('4/1')!.hf;
    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < 80000; i++) sum += hf.ground(i % 176 + 0.25, Math.floor(i / 176) % 176 + 0.25).grass;
    expect(sum).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(150);
  });
});
