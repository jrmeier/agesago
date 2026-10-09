import { describe, expect, it } from 'vitest';
import { type Heightfield, type Vec2 } from '../core/types';
import { generateMap } from './mapgen';
import { generateTerrain, terrainFeatures } from './terrain';

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function floodFill(hf: Heightfield, start: Vec2, step = 1): (pos: Vec2) => boolean {
  const columns = Math.ceil(hf.width / step);
  const rows = Math.ceil(hf.depth / step);
  const point = (column: number, row: number): Vec2 => ({ x: (column + 0.5) * step, z: (row + 0.5) * step });
  const clearSegment = (a: Vec2, b: Vec2): boolean => {
    const count = Math.ceil(distance(a, b) / 0.2);
    for (let i = 0; i <= count; i++) {
      const t = count === 0 ? 0 : i / count;
      if (!hf.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  };
  const startColumn = Math.floor(start.x / step);
  const startRow = Math.floor(start.z / step);
  const visited = new Set<number>([startRow * columns + startColumn]);
  const queue = [{ column: startColumn, row: startRow }];
  expect(clearSegment(start, point(startColumn, startRow))).toBe(true);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const column = cell.column + dx;
      const row = cell.row + dz;
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
      const key = row * columns + column;
      if (visited.has(key) || !clearSegment(point(cell.column, cell.row), point(column, row))) continue;
      visited.add(key);
      queue.push({ column, row });
    }
  }
  return (pos) => {
    const column = Math.floor(pos.x / step);
    const row = Math.floor(pos.z / step);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = column + dx;
        const cz = row + dz;
        if (cx < 0 || cz < 0 || cx >= columns || cz >= rows) continue;
        if (visited.has(cz * columns + cx) && clearSegment(pos, point(cx, cz))) return true;
      }
    }
    return false;
  };
}

describe('generateMap', () => {
  it('repeats the complete layout and terrain for the same seed', () => {
    const first = generateMap(1);
    const repeated = generateMap(1);
    expect(repeated.layout).toEqual(first.layout);
    expect(generateMap(2).layout).not.toEqual(first.layout);
    const standalone = generateTerrain(1);
    for (let z = 0; z <= first.hf.depth; z += 0.5) {
      for (let x = 0; x <= first.hf.width; x += 0.5) {
        expect(repeated.hf.heightAt(x, z)).toBe(first.hf.heightAt(x, z));
        expect(first.hf.heightAt(x, z)).toBe(standalone.heightAt(x, z));
      }
    }
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('populates walkable, reachable resources with the required counts for seed %i', (seed) => {
    const { hf, layout } = generateMap(seed);
    const tc = layout.townCenter;
    const reachable = floodFill(hf, tc);
    const trees = layout.nodes.filter((node) => node.kind === 'tree');
    const berries = layout.nodes.filter((node) => node.kind === 'berry');
    const gold = layout.nodes.filter((node) => node.kind === 'gold');
    expect(layout.villagers).toHaveLength(3);
    expect(distance(tc, { x: hf.width / 2, z: hf.depth / 2 })).toBeLessThan(7);
    for (const pos of layout.villagers) {
      expect(pos.z).toBeGreaterThan(tc.z);
      expect(distance(pos, tc)).toBeGreaterThan(1.6);
      expect(hf.isWalkable(pos.x, pos.z)).toBe(true);
      expect(reachable(pos)).toBe(true);
    }
    expect(trees.length).toBeGreaterThanOrEqual(250);
    expect(trees.length).toBeLessThanOrEqual(400);
    expect(Math.min(...trees.map((node) => distance(node.pos, tc)))).toBeLessThanOrEqual(12);
    expect(berries.length).toBeGreaterThanOrEqual(6);
    expect(berries.length).toBeLessThanOrEqual(8);
    expect(gold.filter((node) => distance(node.pos, tc) <= 16)).toHaveLength(3);
    expect(gold).toHaveLength(4);
    const river = terrainFeatures(seed).river;
    expect(gold.some((node) => node.pos.x > river.ford.x + 4 && Math.abs(node.pos.z - river.ford.z) < 3)).toBe(true);
    for (const pos of [
      { x: river.ford.x - 6, z: river.ford.z },
      { x: river.ford.x + 6, z: river.ford.z },
    ]) expect(reachable(pos), `river bank ${pos.x}`).toBe(true);
    let minSpacing = Infinity;
    for (let i = 0; i < layout.nodes.length; i++) {
      const node = layout.nodes[i];
      expect(node.amount).toBe(node.kind === 'tree' ? 100 : node.kind === 'berry' ? 125 : 400);
      expect(distance(node.pos, tc)).toBeGreaterThanOrEqual(4);
      expect(hf.isWalkable(node.pos.x, node.pos.z), `${node.kind} on dry land`).toBe(true);
      expect(reachable(node.pos), `${node.kind} reachable from TC`).toBe(true);
      if (node.kind === 'tree') expect(hf.forestDensity(node.pos.x, node.pos.z)).toBeGreaterThanOrEqual(0.45);
      if (node.kind === 'berry') expect(distance(node.pos, tc)).toBeLessThanOrEqual(10);
      for (let j = 0; j < i; j++) minSpacing = Math.min(minSpacing, distance(node.pos, layout.nodes[j].pos));
    }
    expect(minSpacing).toBeGreaterThanOrEqual(1.1);
  });

  it.each([0.5, 2])('keeps both banks and every starting position reachable on a %i-unit grid', (step) => {
    const { hf, layout } = generateMap(1);
    const reachable = floodFill(hf, layout.townCenter, step);
    const ford = terrainFeatures(1).river.ford;
    expect(reachable({ x: ford.x - 6, z: ford.z })).toBe(true);
    expect(reachable({ x: ford.x + 6, z: ford.z })).toBe(true);
    for (const pos of [...layout.villagers, ...layout.nodes.map((node) => node.pos)]) {
      expect(reachable(pos), `position ${pos.x}, ${pos.z}`).toBe(true);
    }
  });
});
