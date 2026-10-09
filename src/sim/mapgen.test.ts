import { beforeAll, describe, expect, it } from 'vitest';
import { type Heightfield, type MapLayout, type PropPlacement, type Vec2 } from '../core/types';
import { generateMap } from './mapgen';
import { terrainFeatures } from './terrain';

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
  const obstacles = [{ pos: layout.townCenter, radius: 1.6 },
    ...layout.props.filter((p) => p.blockRadius > 0).map((p) => ({ pos: p.pos, radius: p.blockRadius }))];
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

describe('generateMap', () => {
  const maps = new Map<number, ReturnType<typeof generateMap>>();
  beforeAll(() => {
    for (let seed = 1; seed <= 20; seed++) maps.set(seed, generateMap(seed));
  }, 15000);

  it('repeats the complete layout, heights and ground for the same seed', () => {
    const first = maps.get(1)!;
    const repeated = generateMap(1);
    expect(repeated.layout).toEqual(first.layout);
    expect(maps.get(2)!.layout).not.toEqual(first.layout);
    let same = true;
    for (let z = 0; z <= first.hf.depth; z += 0.5) {
      for (let x = 0; x <= first.hf.width; x += 0.5) {
        if (repeated.hf.heightAt(x, z) !== first.hf.heightAt(x, z)) same = false;
      }
    }
    expect(same).toBe(true);
    expect(repeated.hf.ground(13.75, 161.25)).toEqual(first.hf.ground(13.75, 161.25));
  });

  it.each([[1, 'f4777e29'], [7, '3cd3712b'], [10, 'f6c66be6'], [20, 'f8c4616']] as const)(
    'preserves the pre-quarry resource layout outside the building ring for seed %i', (seed, expected) => {
      const { layout } = maps.get(seed)!;
      const nodes = layout.nodes.filter((node) => node.kind !== 'stone'
        && (node.kind !== 'tree' || distance(node.pos, layout.townCenter) >= 12.5));
      // FNV-1a of the original ordered node data, captured before quarry placement.
      const serialized = JSON.stringify(nodes);
      let hash = 2166136261;
      for (let i = 0; i < serialized.length; i++) hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619);
      expect((hash >>> 0).toString(16)).toBe(expected);
    }
  );

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('scales resources and keeps every node and villager reachable, including across fords, for seed %i', (seed) => {
    const { hf, layout } = maps.get(seed)!;
    const tc = layout.townCenter;
    const reachable = floodFill(hf, layout);
    const trees = layout.nodes.filter((node) => node.kind === 'tree');
    const berries = layout.nodes.filter((node) => node.kind === 'berry');
    const gold = layout.nodes.filter((node) => node.kind === 'gold');
    expect(layout.villagers).toHaveLength(3);
    expect(trees.length).toBeGreaterThanOrEqual(3000);
    expect(trees.length).toBeLessThanOrEqual(4500);
    expect(Math.min(...trees.map((node) => distance(node.pos, tc)))).toBeLessThanOrEqual(12);
    expect(berries.filter((node) => distance(node.pos, tc) <= 10)).toHaveLength(7);
    expect(berries.length).toBeGreaterThanOrEqual(6 * 6);
    expect(berries.length).toBeLessThanOrEqual(8 * 8);
    expect(gold.filter((node) => distance(node.pos, tc) <= 16)).toHaveLength(2);
    expect(gold.length).toBeGreaterThanOrEqual(12);
    expect(gold.length).toBeLessThanOrEqual(16);
    expect(gold.filter((node) => distance(node.pos, tc) > 35).length).toBeGreaterThanOrEqual(10);
    expect(berries.filter((node) => distance(node.pos, tc) > 45).length).toBeGreaterThanOrEqual(25);
    const unreachable = [...layout.villagers, ...layout.nodes.map((node) => node.pos)].filter((pos) => !reachable(pos));
    expect(unreachable).toEqual([]);
    const f = terrainFeatures(seed);
    for (const ford of f.river.fords) {
      expect(reachable({ x: ford.x - 8, z: ford.z })).toBe(true);
      expect(reachable({ x: ford.x + 8, z: ford.z })).toBe(true);
    }
    expect(reachable({ x: f.tributary.ford.x, z: f.tributary.ford.z - 8 })).toBe(true);
    expect(reachable({ x: f.tributary.ford.x, z: f.tributary.ford.z + 8 })).toBe(true);
    expect(gold.some((node) => node.pos.x > f.river.fords[1].x + 8 && Math.abs(node.pos.z - f.river.fords[1].z) < 12)).toBe(true);
    const badPlacement = layout.nodes.filter((node) => {
      const g = hf.ground(node.pos.x, node.pos.z);
      return node.amount !== (node.kind === 'tree' ? 100 : node.kind === 'berry' ? 125 : node.kind === 'stone' ? 350 : 400)
        || g.path > 0.04 || g.sand > 0.24 || (node.kind !== 'stone' && g.rock > 0.32) || distance(node.pos, tc) < 5.5
        || (node.kind === 'tree' && hf.forestDensity(node.pos.x, node.pos.z) < 0.43);
    });
    expect(badPlacement).toEqual([]);
    let spacing = Infinity;
    const cells = new Map<number, Vec2[]>();
    for (const node of layout.nodes) {
      const column = Math.floor(node.pos.x / 2);
      const row = Math.floor(node.pos.z / 2);
      for (let z = row - 1; z <= row + 1; z++) {
        for (let x = column - 1; x <= column + 1; x++) {
          for (const pos of cells.get(z * 100 + x) ?? []) spacing = Math.min(spacing, distance(pos, node.pos));
        }
      }
      const key = row * 100 + column;
      const cell = cells.get(key) ?? [];
      cell.push(node.pos);
      cells.set(key, cell);
    }
    expect(spacing).toBeGreaterThanOrEqual(1.2 - 1e-9);
    for (const [x, z] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      expect(trees.filter((node) => Math.floor(node.pos.x / 88) === x && Math.floor(node.pos.z / 88) === z).length).toBeGreaterThan(250);
    }
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('places rich scenery clear of water, roads, the pad and all other footprints for seed %i', (seed) => {
    const { hf, layout } = maps.get(seed)!;
    const f = terrainFeatures(seed);
    expect(layout.props.length).toBeGreaterThanOrEqual(500);
    expect(layout.props.length).toBeLessThanOrEqual(1100);
    const invalid: PropPlacement[] = [];
    let overlap = false;
    for (let i = 0; i < layout.props.length; i++) {
      const p = layout.props[i];
      const r = footprint(p);
      if (hf.isWater(p.pos.x, p.pos.z) || hf.ground(p.pos.x, p.pos.z).path > 0.035
        || Math.max(Math.abs(p.pos.x - layout.townCenter.x), Math.abs(p.pos.z - layout.townCenter.z)) < 5 + r
        || !Number.isFinite(p.rot) || p.scale < 0.7 || p.scale > 1.4) invalid.push(p);
      for (const node of layout.nodes) {
        const dx = p.pos.x - node.pos.x;
        const dz = p.pos.z - node.pos.z;
        const minimum = r + (node.kind === 'gold' || node.kind === 'stone' ? 0.8 : 0.5) + 0.2;
        if (dx * dx + dz * dz < minimum * minimum - 1e-8) overlap = true;
      }
      for (let j = 0; j < i; j++) {
        const other = layout.props[j];
        if (distance(p.pos, other.pos) < r + footprint(other) + 0.2 - 1e-8) overlap = true;
      }
      if (p.kind === 'wheatField' || p.kind === 'reeds' || p.kind === 'bush') expect(p.blockRadius).toBe(0);
      if (p.kind === 'boulder' || p.kind === 'rocks') expect(p.blockRadius / p.scale).toBeGreaterThanOrEqual(0.8);
    }
    expect(invalid).toEqual([]);
    expect(overlap).toBe(false);
    for (const ridge of f.ridges) {
      const ruins = layout.props.filter((p) => (p.kind === 'ruinColumn' || p.kind === 'ruinWall') && distance(p.pos, ridge.center) < 8);
      expect(ruins.length).toBeGreaterThanOrEqual(7);
      expect(ruins.every((p) => hf.heightAt(p.pos.x, p.pos.z) > 5.5)).toBe(true);
    }
    expect(layout.props.filter((p) => p.kind === 'standingStone' && distance(p.pos, f.stoneCircle) < 7).length).toBeGreaterThanOrEqual(8);
    expect(distance(f.stoneCircle, layout.townCenter)).toBeGreaterThan(60);
    const farm = layout.props.filter((p) => distance(p.pos, f.hamlet) < 25);
    expect(farm.filter((p) => p.kind === 'house')).toHaveLength(4);
    expect(farm.filter((p) => p.kind === 'house').every((p) => distance(p.pos, layout.townCenter) >= 10)).toBe(true);
    expect(farm.filter((p) => p.kind === 'well')).toHaveLength(1);
    expect(farm.some((p) => p.kind === 'cart')).toBe(true);
    expect(farm.filter((p) => p.kind === 'wheatField').length).toBeGreaterThanOrEqual(3);
    expect(farm.filter((p) => p.kind === 'wheatField').length).toBeLessThanOrEqual(6);
    expect(farm.filter((p) => p.kind === 'fence').length).toBeGreaterThanOrEqual(4);
    expect(farm.filter((p) => p.kind === 'hayBale').length).toBeGreaterThanOrEqual(3);
    expect(layout.props.filter((p) => p.kind === 'house' && distance(p.pos, f.abandonedHamlet) < 12).length).toBeGreaterThanOrEqual(3);
    expect(distance(f.abandonedHamlet, layout.townCenter)).toBeGreaterThan(65);
    const reeds = layout.props.filter((p) => p.kind === 'reeds');
    expect(reeds.length).toBeGreaterThan(40);
    expect(reeds.every((p) => hf.heightAt(p.pos.x, p.pos.z) < 0.9 && hf.ground(p.pos.x, p.pos.z).sand > 0.3)).toBe(true);
    expect(layout.props.filter((p) => p.kind === 'log' && hf.forestDensity(p.pos.x, p.pos.z) > 0.35).length).toBeGreaterThanOrEqual(30);
  });

  it('also connects every resource and villager on a one-unit grid with scenery blocked', () => {
    const { hf, layout } = maps.get(1)!;
    const reachable = floodFill(hf, layout, 1);
    expect([...layout.villagers, ...layout.nodes.map((node) => node.pos)].filter((pos) => !reachable(pos))).toEqual([]);
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('places twelve spaced, accessible quarries on dry ground with rocky exploration rewards for seed %i', (seed) => {
    const { hf, layout } = maps.get(seed)!;
    const quarries = layout.nodes.filter((node) => node.kind === 'stone');
    const starting = quarries.filter((node) => distance(node.pos, layout.townCenter) <= 16);
    const distant = quarries.filter((node) => distance(node.pos, layout.townCenter) > 35);
    const reachable = floodFill(hf, layout);
    expect(quarries).toHaveLength(12);
    expect(starting).toHaveLength(2);
    expect(distant).toHaveLength(10);
    expect(distant.filter((node) => hf.ground(node.pos.x, node.pos.z).rock > 0.05).length).toBeGreaterThanOrEqual(5);
    const f = terrainFeatures(seed);
    expect(distant.every((node) => [...f.outcrops, ...f.ridges.map((ridge) => ridge.center),
      { x: f.river.fords[1].x + 15, z: f.river.fords[1].z - 15 }]
      .some((landmark) => distance(node.pos, landmark) < 30))).toBe(true);
    // The main river winds: compare with its bank at the quarry's actual latitude.
    expect(distant.some((node) => {
      const index = f.river.points.findIndex((point) => point.z >= node.pos.z);
      if (index <= 0) return false;
      const a = f.river.points[index - 1];
      const b = f.river.points[index];
      const bankX = a.x + (b.x - a.x) * (node.pos.z - a.z) / (b.z - a.z);
      return node.pos.x > bankX + 8;
    })).toBe(true);
    for (const quarry of quarries) {
      expect(quarry.amount).toBe(350);
      expect(reachable(quarry.pos)).toBe(true);
      for (const radius of [0, 0.8, 1.3]) {
        for (let a = 0; a < 8; a++) {
          const angle = a * Math.PI / 4;
          const pos = { x: quarry.pos.x + Math.cos(angle) * radius, z: quarry.pos.z + Math.sin(angle) * radius };
          expect(hf.isWater(pos.x, pos.z)).toBe(false);
          expect(hf.isWalkable(pos.x, pos.z)).toBe(true);
          expect(hf.ground(pos.x, pos.z).path).toBeLessThanOrEqual(0.04);
          expect(reachable(pos)).toBe(true);
        }
      }
      for (const other of layout.nodes) {
        if (other === quarry) continue;
        const minimum = other.kind === 'stone' ? 8 : other.kind === 'gold' ? 1.8 : 1.5;
        expect(distance(quarry.pos, other.pos)).toBeGreaterThanOrEqual(minimum - 1e-9);
      }
    }
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('clears building room around the TC while retaining starting food, gold and wood for seed %i', (seed) => {
    const { hf, layout } = maps.get(seed)!;
    const tc = layout.townCenter;
    expect(layout.props.filter((prop) => distance(prop.pos, tc) < 12 + footprint(prop))).toEqual([]);
    const nearbyTrees = layout.nodes.filter((node) => node.kind === 'tree' && distance(node.pos, tc) < 12.5);
    expect(nearbyTrees).toHaveLength(1);
    expect(distance(nearbyTrees[0].pos, tc)).toBeLessThanOrEqual(12);
    expect(layout.nodes.filter((node) => node.kind === 'berry' && distance(node.pos, tc) <= 10)).toHaveLength(7);
    expect(layout.nodes.filter((node) => node.kind === 'gold' && distance(node.pos, tc) <= 16)).toHaveLength(2);
    // Verify actual house/storehouse footprints fit on open, walkable ground.
    let sites = 0;
    for (let a = 0; a < 24; a++) {
      const angle = a * Math.PI / 12;
      const center = { x: tc.x + Math.cos(angle) * 9, z: tc.z + Math.sin(angle) * 9 };
      if (layout.nodes.some((node) => distance(node.pos, center) < 2.9)) continue;
      let walkable = true;
      for (const x of [-1.5, 0, 1.5]) {
        for (const z of [-1.5, 0, 1.5]) if (!hf.isWalkable(center.x + x, center.z + z)) walkable = false;
      }
      if (walkable) sites++;
    }
    expect(sites).toBeGreaterThanOrEqual(12);
  });

  it('generates in under 500 ms and keeps 80k ground queries cheap', () => {
    const timings: number[] = [];
    for (const seed of [11, 12, 13]) {
      const start = performance.now();
      generateMap(seed);
      timings.push(performance.now() - start);
    }
    expect(Math.max(...timings)).toBeLessThan(500);
    const hf = maps.get(1)!.hf;
    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < 80000; i++) sum += hf.ground(i % 176 + 0.25, Math.floor(i / 176) % 176 + 0.25).grass;
    expect(sum).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(150);
  });
});
