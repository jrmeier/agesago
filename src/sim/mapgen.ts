import { type Heightfield, type MapLayout, type NodeKind, type PropKind, type Vec2 } from '../core/types';
import { createSeededRandom, generateTerrain, terrainFeatures } from './terrain';

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

interface Footprint {
  pos: Vec2;
  radius: number;
}

class PlacementGrid {
  private readonly cells = new Map<number, Footprint[]>();
  private readonly columns: number;

  constructor(width: number) {
    this.columns = Math.ceil(width / 4) + 1;
  }

  add(pos: Vec2, radius: number): void {
    const key = Math.floor(pos.z / 4) * this.columns + Math.floor(pos.x / 4);
    const cell = this.cells.get(key);
    if (cell) cell.push({ pos, radius });
    else this.cells.set(key, [{ pos, radius }]);
  }

  clear(pos: Vec2, radius: number): boolean {
    const reach = radius + 4;
    const left = Math.max(0, Math.floor((pos.x - reach) / 4));
    const right = Math.min(this.columns - 1, Math.floor((pos.x + reach) / 4));
    const top = Math.max(0, Math.floor((pos.z - reach) / 4));
    const bottom = Math.floor((pos.z + reach) / 4);
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        const cell = this.cells.get(row * this.columns + column);
        if (!cell) continue;
        for (const other of cell) {
          const dx = pos.x - other.pos.x;
          const dz = pos.z - other.pos.z;
          const minimum = radius + other.radius + 0.2;
          if (dx * dx + dz * dz < minimum * minimum) return false;
        }
      }
    }
    return true;
  }
}

function connectedLand(hf: Heightfield, start: Vec2): (pos: Vec2) => boolean {
  const columns = Math.floor(hf.width);
  const rows = Math.floor(hf.depth);
  const walk = new Uint8Array(columns * rows);
  const visited = new Uint8Array(walk.length);
  for (let i = 0; i < walk.length; i++) walk[i] = hf.isWalkable(i % columns + 0.5, Math.floor(i / columns) + 0.5) ? 1 : 0;
  const queue = new Int32Array(walk.length);
  const first = Math.floor(start.z) * columns + Math.floor(start.x);
  visited[first] = 1;
  queue[0] = first;
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
      if (!hf.isWalkable(column + 0.5 + dx[d] / 2, row + 0.5 + dz[d] / 2)) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }
  return (pos) => {
    const column = Math.floor(pos.x);
    const row = Math.floor(pos.z);
    if (column < 0 || row < 0 || column >= columns || row >= rows || !visited[row * columns + column]) return false;
    for (let t = 0; t <= 1; t += 0.25) {
      if (!hf.isWalkable(pos.x + (column + 0.5 - pos.x) * t, pos.z + (row + 0.5 - pos.z) * t)) return false;
    }
    return true;
  };
}

const PROP_RADIUS: Record<PropKind, number> = {
  boulder: 0.9, rocks: 1.1, standingStone: 0.6, ruinColumn: 0.65, ruinWall: 1.25,
  fence: 1.1, hayBale: 0.65, wheatField: 2.8, well: 0.9, house: 1.9, cart: 1,
  reeds: 0.4, bush: 0.55, log: 1.05,
};

/** Rich ancient countryside; spatial spacing and connected-land filtering keep placement cheap. */
export function generateMap(seed: number): { hf: Heightfield; layout: MapLayout } {
  const hf = generateTerrain(seed);
  const features = terrainFeatures(seed);
  const townCenter = { ...features.townCenter };
  const random = createSeededRandom(seed ^ 0x1f83d9ab);
  const reachable = connectedLand(hf, townCenter);
  const occupied = new PlacementGrid(hf.width);
  const layout: MapLayout = {
    townCenter,
    villagers: [
      { x: townCenter.x - 1.8, z: townCenter.z + 3.6 },
      { x: townCenter.x, z: townCenter.z + 3.8 },
      { x: townCenter.x + 1.8, z: townCenter.z + 3.6 },
    ],
    nodes: [],
    props: [],
  };
  const padClear = (pos: Vec2, radius: number): boolean =>
    Math.max(Math.abs(pos.x - townCenter.x), Math.abs(pos.z - townCenter.z)) >= 5 + radius;
  const onMap = (pos: Vec2, radius: number): boolean => pos.x >= radius + 0.5 && pos.z >= radius + 0.5
    && pos.x <= hf.width - radius - 0.5 && pos.z <= hf.depth - radius - 0.5;
  const fordClear = (pos: Vec2, radius: number): boolean => features.river.fords.every((ford) =>
    Math.abs(pos.x - ford.x) >= 10 + radius || Math.abs(pos.z - ford.z) >= 4 + radius)
    && (Math.abs(pos.x - features.tributary.ford.x) >= 4 + radius || Math.abs(pos.z - features.tributary.ford.z) >= 10 + radius);
  const addProp = (kind: PropKind, pos: Vec2, rot: number, scale: number): boolean => {
    const radius = PROP_RADIUS[kind] * scale;
    if (!onMap(pos, radius) || !padClear(pos, radius) || !fordClear(pos, radius) || !reachable(pos) || !occupied.clear(pos, radius)) return false;
    const ground = hf.ground(pos.x, pos.z);
    if (ground.path > 0.035 || (kind !== 'reeds' && ground.sand > 0.3)) return false;
    const blocking = kind !== 'reeds' && kind !== 'wheatField' && kind !== 'bush';
    for (let a = 0; a < 8; a++) {
      const angle = a * Math.PI / 4;
      const edge = { x: pos.x + Math.cos(angle) * (radius + 0.4), z: pos.z + Math.sin(angle) * (radius + 0.4) };
      if (hf.ground(edge.x, edge.z).path > 0.08) return false;
      if (kind === 'reeds' ? hf.heightAt(edge.x, edge.z) < -0.45 : !hf.isWalkable(edge.x, edge.z)) return false;
      if (blocking && hf.heightAt(edge.x, edge.z) < 0.55) return false;
    }
    layout.props.push({ kind, pos, rot, scale, blockRadius: blocking ? radius : 0 });
    occupied.add(pos, radius);
    return true;
  };
  const propNear = (kind: PropKind, desired: Vec2, rot = random() * Math.PI * 2, scale = 0.85 + random() * 0.3): void => {
    for (let ring = 0; ring <= 5; ring++) {
      const count = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        if (addProp(kind, { x: desired.x + Math.cos(angle) * ring * 0.5, z: desired.z + Math.sin(angle) * ring * 0.5 }, rot, scale)) return;
      }
    }
  };

  for (const ridge of features.ridges) {
    const center = ridge.center;
    const rot = (random() - 0.5) * 0.4;
    for (const x of [-3.3, 3.3]) {
      for (const z of [-3, 0, 3]) propNear('ruinColumn', { x: center.x + x, z: center.z + z }, rot);
    }
    for (const x of [-2, 2]) propNear('ruinWall', { x: center.x + x, z: center.z - 5.5 }, rot, 0.9);
    propNear('rocks', { x: center.x + 1, z: center.z + 5.5 }, rot, 0.8);
  }
  for (let i = 0; i < 9; i++) {
    const angle = i / 9 * Math.PI * 2;
    propNear('standingStone', {
      x: features.stoneCircle.x + Math.cos(angle) * 4,
      z: features.stoneCircle.z + Math.sin(angle) * 4,
    }, angle, 0.85 + random() * 0.3);
  }
  for (let i = 0; i < 5; i++) propNear('standingStone', { x: hf.width * 0.64 + i * 2.6, z: hf.depth * 0.88 }, 0, 0.8);

  const hamlet = (center: Vec2, abandoned: boolean): void => {
    for (const [x, z] of [[-5, -1], [5, -1], [-5, 5], [5, 5]]) {
      propNear('house', { x: center.x + x, z: center.z + z }, Math.PI + (random() - 0.5) * 0.25, abandoned ? 0.85 : 1);
    }
    propNear('well', { x: center.x, z: center.z + 2 }, 0, 0.9);
    propNear('cart', { x: center.x + 2, z: center.z - 2 }, 0.3, 0.85);
    for (const [x, z] of [[-7, 10], [0, 11], [7, 11], [-7, 17], [0, 18]]) {
      propNear('wheatField', { x: center.x + x, z: center.z + z }, 0, abandoned ? 0.8 : 0.95);
    }
    for (let i = 0; i < 6; i++) propNear('fence', { x: center.x - 9.5, z: center.z + i * 2.8 }, 0, 0.85);
    for (let i = 0; i < 3; i++) propNear('hayBale', { x: center.x + 10, z: center.z + 3 + i * 2 }, 0.2, 0.85);
  };
  hamlet(features.hamlet, false);
  hamlet(features.abandonedHamlet, true);

  let logs = 0;
  for (let attempt = 0; logs < 36 && attempt < 3000; attempt++) {
    const pos = { x: 4 + random() * (hf.width - 8), z: 4 + random() * (hf.depth - 8) };
    if (hf.forestDensity(pos.x, pos.z) > 0.5 && addProp('log', pos, random() * Math.PI * 2, 0.8 + random() * 0.25)) logs++;
  }

  const clearings = [features.hamlet, features.abandonedHamlet, features.stoneCircle, ...features.ridges.map((r) => r.center)];
  const canPlaceNode = (pos: Vec2, kind: NodeKind): boolean => {
    const radius = kind === 'gold' ? 0.8 : 0.5;
    if (!onMap(pos, radius) || !padClear(pos, radius) || !fordClear(pos, radius) || !reachable(pos) || !occupied.clear(pos, radius)) return false;
    const ground = hf.ground(pos.x, pos.z);
    if (ground.path > 0.04 || ground.sand > 0.24 || ground.rock > 0.32) return false;
    if (clearings.some((center) => distance(center, pos) < 8)) return false;
    if (kind === 'tree' && hf.forestDensity(pos.x, pos.z) < 0.43) return false;
    for (let a = 0; a < 4; a++) {
      const angle = a * Math.PI / 2;
      if (!reachable({ x: pos.x + Math.cos(angle) * 1.1, z: pos.z + Math.sin(angle) * 1.1 })) return false;
    }
    return true;
  };
  const addNode = (kind: NodeKind, pos: Vec2): boolean => {
    if (!canPlaceNode(pos, kind)) return false;
    layout.nodes.push({ kind, pos, amount: kind === 'berry' ? 125 : kind === 'gold' ? 400 : 100 });
    occupied.add(pos, kind === 'gold' ? 0.8 : 0.5);
    return true;
  };
  const nodeNear = (kind: NodeKind, desired: Vec2, maxStartDistance = Infinity): void => {
    for (let ring = 0; ring <= 16; ring++) {
      const count = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        const pos = { x: desired.x + Math.cos(angle) * ring * 0.65, z: desired.z + Math.sin(angle) * ring * 0.65 };
        if (distance(pos, townCenter) <= maxStartDistance && addNode(kind, pos)) return;
      }
    }
    throw new Error(`No reachable ${kind} placement for seed ${seed}`);
  };
  const berries = (center: Vec2, starting = false): void => {
    const phase = random() * Math.PI * 2;
    nodeNear('berry', center, starting ? 10 : Infinity);
    for (let i = 0; i < 6; i++) {
      const angle = phase + i / 6 * Math.PI * 2;
      nodeNear('berry', { x: center.x + Math.cos(angle) * 1.7, z: center.z + Math.sin(angle) * 1.7 }, starting ? 10 : Infinity);
    }
  };
  berries({ x: townCenter.x - 6.5, z: townCenter.z + 5 }, true);
  for (const [x, z] of [[0.12, 0.16], [0.29, 0.40], [0.14, 0.73], [0.59, 0.21], [0.91, 0.47], [0.62, 0.84]]) {
    berries({ x: hf.width * x, z: hf.depth * z });
  }
  nodeNear('gold', { x: townCenter.x - 9, z: townCenter.z - 10 }, 16);
  nodeNear('gold', { x: townCenter.x + 12, z: townCenter.z - 4 }, 16);
  for (const pos of features.outcrops) nodeNear('gold', { x: pos.x + 4, z: pos.z + 3 });
  for (const [x, z] of [[0.10, 0.34], [0.48, 0.07], [0.93, 0.12], [0.96, 0.97], [0.42, 0.94]]) {
    nodeNear('gold', { x: hf.width * x, z: hf.depth * z });
  }
  nodeNear('gold', { x: features.river.fords[1].x + 10, z: features.river.fords[1].z + 8 });

  const candidates: Vec2[] = [];
  for (let z = 1.5; z < hf.depth - 1.5; z += 1.45) {
    for (let x = 1.5; x < hf.width - 1.5; x += 1.45) {
      const pos = { x: x + (random() - 0.5) * 0.6, z: z + (random() - 0.5) * 0.6 };
      if (hf.forestDensity(pos.x, pos.z) >= 0.43) candidates.push(pos);
    }
  }
  const nearby = candidates.filter((pos) => distance(pos, townCenter) <= 12).sort((a, b) => distance(a, townCenter) - distance(b, townCenter));
  if (!nearby.some((pos) => addNode('tree', pos))) throw new Error(`No nearby forest for seed ${seed}`);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const treeTarget = 3500 + Math.floor(random() * 600);
  let trees = 1;
  for (const pos of candidates) {
    if (trees >= treeTarget) break;
    if (addNode('tree', pos)) trees++;
  }
  if (trees < 3000) throw new Error(`Insufficient reachable forest for seed ${seed}: ${trees}`);

  const reedAt = (pos: Vec2, rot: number): boolean => {
    const height = hf.heightAt(pos.x, pos.z);
    return height >= 0 && height < 0.9 && hf.ground(pos.x, pos.z).sand > 0.3
      && addProp('reeds', pos, rot, 0.75 + random() * 0.3);
  };
  for (const lake of [features.lake, ...features.ponds]) {
    for (let i = 0; i < 72; i++) {
      const angle = i / 72 * Math.PI * 2;
      for (const r of [1.08, 1.12, 1.16]) {
        if (reedAt({ x: lake.center.x + Math.cos(angle) * lake.radiusX * r,
          z: lake.center.z + Math.sin(angle) * lake.radiusZ * r }, angle)) break;
      }
    }
  }
  for (const [river, width] of [[features.river, 3.3], [features.tributary, 2.75]] as const) {
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1];
      const b = river.points[i];
      const length = distance(a, b);
      for (const side of [-1, 1]) {
        reedAt({ x: b.x - (b.z - a.z) / length * width * side,
          z: b.z + (b.x - a.x) / length * width * side }, Math.atan2(b.x - a.x, b.z - a.z));
      }
    }
  }

  const propTarget = 720 + Math.floor(random() * 180);
  for (let attempt = 0; layout.props.length < propTarget && attempt < 80000; attempt++) {
    const pos = { x: 2 + random() * (hf.width - 4), z: 2 + random() * (hf.depth - 4) };
    const ground = hf.ground(pos.x, pos.z);
    const height = hf.heightAt(pos.x, pos.z);
    const density = hf.forestDensity(pos.x, pos.z);
    let kind: PropKind;
    if (height >= 0 && height < 0.6 && ground.sand > 0.45) kind = 'reeds';
    else if (ground.rock > 0.12 || height > 3.5 || features.outcrops.some((p) => distance(p, pos) < 7)) {
      kind = random() < 0.55 ? 'boulder' : 'rocks';
    } else if (density > 0.35) kind = random() < 0.30 ? 'log' : 'bush';
    else {
      // Open meadow stays open: the odd shrub, rare stones, and a clear start area.
      const fromTc = distance(pos, townCenter);
      if (fromTc < 12 || random() < 0.45) continue;
      if (fromTc > 20 && random() < 0.12) kind = random() < 0.5 ? 'boulder' : 'rocks';
      else kind = 'bush';
    }
    addProp(kind, pos, random() * Math.PI * 2, 0.7 + random() * 0.65);
  }
  if (layout.props.length < 500) throw new Error(`Insufficient scenery for seed ${seed}`);
  return { hf, layout };
}
