import { type Heightfield, type MapLayout, type NodeKind, type Vec2 } from '../core/types';
import { createSeededRandom, generateTerrain, terrainFeatures } from './terrain';

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function connectedLand(hf: Heightfield, start: Vec2): (pos: Vec2) => boolean {
  const columns = Math.floor(hf.width);
  const rows = Math.floor(hf.depth);
  const visited = new Uint8Array(columns * rows);
  const queue: number[] = [];
  const startIndex = Math.floor(start.z) * columns + Math.floor(start.x);
  visited[startIndex] = 1;
  queue.push(startIndex);
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextColumn = column + dx;
      const nextRow = row + dz;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
      const next = nextRow * columns + nextColumn;
      if (visited[next] || !hf.isWalkable(nextColumn + 0.5, nextRow + 0.5)) continue;
      if (!hf.isWalkable(column + 0.5 + dx / 2, row + 0.5 + dz / 2)) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  return (pos) => {
    if (!hf.isWalkable(pos.x, pos.z)) return false;
    const column = Math.floor(pos.x);
    const row = Math.floor(pos.z);
    if (column < 0 || row < 0 || column >= columns || row >= rows || !visited[row * columns + column]) return false;
    for (let t = 0.25; t <= 1; t += 0.25) {
      if (!hf.isWalkable(pos.x + (column + 0.5 - pos.x) * t, pos.z + (row + 0.5 - pos.z) * t)) return false;
    }
    return true;
  };
}

/** Deterministic starting settlement and resources, placed on land connected to the TC. */
export function generateMap(seed: number): { hf: Heightfield; layout: MapLayout } {
  const hf = generateTerrain(seed);
  const features = terrainFeatures(seed);
  const townCenter = { ...features.townCenter };
  const random = createSeededRandom(seed ^ 0x1f83d9ab);
  const reachable = connectedLand(hf, townCenter);
  const layout: MapLayout = {
    townCenter,
    villagers: [
      { x: townCenter.x - 1.8, z: townCenter.z + 3.6 },
      { x: townCenter.x, z: townCenter.z + 3.8 },
      { x: townCenter.x + 1.8, z: townCenter.z + 3.6 },
    ],
    nodes: [],
  };
  const canPlace = (pos: Vec2): boolean => reachable(pos)
    && distance(pos, townCenter) >= 4
    && layout.nodes.every((node) => distance(node.pos, pos) >= 1.1);
  const place = (kind: NodeKind, desired: Vec2): void => {
    for (let ring = 0; ring <= 5; ring++) {
      const count = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        const pos = { x: desired.x + Math.cos(angle) * ring * 0.6, z: desired.z + Math.sin(angle) * ring * 0.6 };
        if (!canPlace(pos)) continue;
        layout.nodes.push({ kind, pos, amount: kind === 'berry' ? 125 : kind === 'gold' ? 400 : 100 });
        return;
      }
    }
    throw new Error(`No reachable ${kind} placement for seed ${seed}`);
  };

  const berryCenter = { x: townCenter.x + 6.2, z: townCenter.z + 4.6 };
  const berryPhase = random() * Math.PI * 2;
  place('berry', berryCenter);
  for (let i = 0; i < 6; i++) {
    const angle = berryPhase + i / 6 * Math.PI * 2;
    place('berry', { x: berryCenter.x + Math.cos(angle) * 1.5, z: berryCenter.z + Math.sin(angle) * 1.5 });
  }
  for (const offset of [{ x: -7, z: -8 }, { x: 10, z: -5 }, { x: -6, z: 11 }]) {
    place('gold', { x: townCenter.x + offset.x + random() - 0.5, z: townCenter.z + offset.z + random() - 0.5 });
  }
  place('gold', { x: features.river.ford.x + 7, z: features.river.ford.z + random() - 0.5 });

  const candidates: Vec2[] = [];
  for (let z = 0.65; z < hf.depth - 0.65; z += 1.3) {
    for (let x = 0.65; x < hf.width - 0.65; x += 1.3) {
      const pos = { x: x + (random() - 0.5) * 0.12, z: z + (random() - 0.5) * 0.12 };
      if (hf.forestDensity(pos.x, pos.z) >= 0.45 && canPlace(pos)) candidates.push(pos);
    }
  }
  const nearest = candidates.reduce<Vec2 | undefined>((best, pos) =>
    !best || distance(pos, townCenter) < distance(best, townCenter) ? pos : best, undefined);
  if (nearest && distance(nearest, townCenter) <= 12) place('tree', nearest);
  else throw new Error(`No nearby forest for seed ${seed}`);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const treeTarget = 320 + Math.floor(random() * 40);
  let treeCount = 1;
  for (const pos of candidates) {
    if (treeCount >= treeTarget) break;
    if (!canPlace(pos)) continue;
    place('tree', pos);
    treeCount++;
  }
  if (treeCount < 250) throw new Error(`Insufficient reachable forest for seed ${seed}`);
  return { hf, layout };
}
