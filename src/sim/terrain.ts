import { MAP_D, MAP_W, SEA_LEVEL, type GroundWeights, type Heightfield, type Vec2 } from '../core/types';

interface Lake {
  center: Vec2;
  radiusX: number;
  radiusZ: number;
}

interface River {
  points: Vec2[];
  ford: Vec2;
  fordAlong: number;
  fords: Vec2[];
  fordAlongs: number[];
}

/** Seeded landmarks shared by terrain, roads and scenery placement. */
export interface TerrainFeatures {
  townCenter: Vec2;
  lake: Lake;
  ponds: Lake[];
  river: River;
  tributary: River;
  ridges: { center: Vec2; radiusX: number; radiusZ: number; height: number }[];
  outcrops: Vec2[];
  roads: Vec2[][];
  hamlet: Vec2;
  abandonedHamlet: Vec2;
  stoneCircle: Vec2;
}

/** Small deterministic PRNG; separate salts keep terrain and placement independent. */
export function createSeededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function latticeValue(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = smoothstep(0, 1, x - ix);
  const tz = smoothstep(0, 1, z - iz);
  return mix(
    mix(latticeValue(ix, iz, seed), latticeValue(ix + 1, iz, seed), tx),
    mix(latticeValue(ix, iz + 1, seed), latticeValue(ix + 1, iz + 1, seed), tx),
    tz
  );
}

function watercourse(points: Vec2[], indices: number[]): River {
  let length = 0;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    lengths.push(length);
  }
  const fords = indices.map((i) => ({ ...points[i] }));
  const fordAlongs = indices.map((i) => lengths[i]);
  return { points, ford: fords[0], fordAlong: fordAlongs[0], fords, fordAlongs };
}

/** A central valley settlement, three ridges, a lake basin and three river crossings. */
export function terrainFeatures(seed: number, width = MAP_W, depth = MAP_D): TerrainFeatures {
  const random = createSeededRandom(seed ^ 0x3c6ef372);
  const scale = Math.min(width / MAP_W, depth / MAP_D);
  const at = (x: number, z: number): Vec2 => ({ x: x * width, z: z * depth });
  const townCenter = {
    x: Math.round((width * 0.48 + (random() - 0.5) * 4 * scale) * 2) / 2,
    z: Math.round((depth * 0.5 + (random() - 0.5) * 4 * scale) * 2) / 2,
  };
  const lake = { center: at(0.85, 0.82), radiusX: (25 + random() * 3) * scale, radiusZ: (22 + random() * 2) * scale };
  const ponds = [
    { center: at(0.19 + random() * 0.025, 0.63), radiusX: 7.5 * scale, radiusZ: 6 * scale },
    { center: at(0.48, 0.15 + random() * 0.02), radiusX: 8 * scale, radiusZ: 5.5 * scale },
  ];
  const phase = random() * Math.PI * 2;
  const main: Vec2[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    main.push({
      x: mix(width * 0.69, lake.center.x, t) + Math.sin(t * Math.PI * 3 + phase) * 6 * scale * (1 - t),
      z: lake.center.z * t,
    });
  }
  const river = watercourse(main, [10, 20]);
  const join = main[12];
  const branch: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    branch.push({
      x: join.x * t,
      z: mix(depth * 0.29, join.z, t) + Math.sin(t * Math.PI * 4) * 3.5 * scale,
    });
  }
  const tributary = watercourse(branch, [13]);
  const ridges = [
    { center: at(0.20 + random() * 0.02, 0.16), radiusX: 21 * scale, radiusZ: 17 * scale, height: 6.5 },
    { center: at(0.87, 0.20 + random() * 0.025), radiusX: 18 * scale, radiusZ: 26 * scale, height: 6.1 },
    { center: at(0.21 + random() * 0.02, 0.85), radiusX: 26 * scale, radiusZ: 18 * scale, height: 6.7 },
  ];
  const outcrops = ridges.flatMap((r) => [
    { x: r.center.x - r.radiusX * 0.75, z: r.center.z + r.radiusZ * 0.4 },
    { x: r.center.x + r.radiusX * 0.65, z: r.center.z - r.radiusZ * 0.25 },
  ]);
  const hamlet = { x: townCenter.x + 19 * scale, z: townCenter.z + 15 * scale };
  const abandonedHamlet = at(0.91, 0.60);
  const stoneCircle = at(0.10, 0.44);
  const track = (waypoints: Vec2[]): Vec2[] => {
    const points = [waypoints[0]];
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const count = Math.max(1, Math.ceil(length / (9 * scale)));
      const bend = length < 20 * scale ? 0 : (random() - 0.5) * 3 * scale;
      for (let j = 1; j <= count; j++) {
        const t = j / count;
        const offset = Math.sin(t * Math.PI) * bend;
        points.push({ x: mix(a.x, b.x, t) - dz / length * offset, z: mix(a.z, b.z, t) + dx / length * offset });
      }
    }
    return points;
  };
  const ford = river.fords[1];
  const northFord = tributary.ford;
  const roads = [
    track([townCenter, at(0.32, 0.49), at(0.16, 0.49), at(0, 0.52)]),
    track([townCenter, { x: northFord.x, z: northFord.z + 10 * scale }, northFord,
      { x: northFord.x, z: northFord.z - 10 * scale }, at(0.36, 0)]),
    track([townCenter, { x: hamlet.x, z: hamlet.z - 5 * scale },
      { x: ford.x - 9 * scale, z: ford.z }, ford, { x: ford.x + 9 * scale, z: ford.z },
      { x: abandonedHamlet.x, z: abandonedHamlet.z - 7 * scale }, at(1, 0.56)]),
    track([townCenter, at(0.50, 0.69), at(0.53, 0.87), at(0.52, 1)]),
  ];
  return { townCenter, lake, ponds, river, tributary, ridges, outcrops, roads, hamlet, abandonedHamlet, stoneCircle };
}

interface DistanceField {
  distance: Float32Array;
  along: Float32Array;
}

function lineField(points: Vec2[], reach: number, columns: number, rows: number, stepX: number, stepZ: number): DistanceField {
  const distance = new Float32Array((columns + 1) * (rows + 1)).fill(Infinity);
  const along = new Float32Array(distance.length);
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const squared = dx * dx + dz * dz;
    if (squared === 0) continue;
    const segmentLength = Math.sqrt(squared);
    const left = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach) / stepX));
    const right = Math.min(columns, Math.ceil((Math.max(a.x, b.x) + reach) / stepX));
    const top = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach) / stepZ));
    const bottom = Math.min(rows, Math.ceil((Math.max(a.z, b.z) + reach) / stepZ));
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        const x = column * stepX - a.x;
        const z = row * stepZ - a.z;
        const t = clamp((x * dx + z * dz) / squared, 0, 1);
        const d = Math.hypot(x - dx * t, z - dz * t);
        const index = row * (columns + 1) + column;
        if (d < distance[index]) {
          distance[index] = d;
          along[index] = length + segmentLength * t;
        }
      }
    }
    length += segmentLength;
  }
  return { distance, along };
}

/** Half-unit terrain and cached surface blends; render queries need only bilinear reads. */
export function generateTerrain(seed: number, width = MAP_W, depth = MAP_D): Heightfield {
  const features = terrainFeatures(seed, width, depth);
  const scale = Math.min(width / MAP_W, depth / MAP_D);
  const columns = Math.ceil(width * 2);
  const rows = Math.ceil(depth * 2);
  const stride = columns + 1;
  const stepX = width / columns;
  const stepZ = depth / rows;
  const count = stride * (rows + 1);
  const heights = new Float64Array(count);
  const shores = new Float32Array(count);
  const forest = new Float32Array(count);
  const materials = Array.from({ length: 7 }, () => new Float32Array(count));
  const rivers = [features.river, features.tributary];
  const channels = rivers.map((river) => lineField(river.points, 10 * scale, columns, rows, stepX, stepZ));
  const roadDistance = new Float32Array(count).fill(Infinity);
  for (const road of features.roads) {
    const field = lineField(road, 2.8 * scale, columns, rows, stepX, stepZ);
    for (let i = 0; i < count; i++) roadDistance[i] = Math.min(roadDistance[i], field.distance[i]);
  }
  const lakes = [features.lake, ...features.ponds];
  const clearings = [features.hamlet, features.abandonedHamlet, features.stoneCircle, ...features.ridges.map((r) => r.center)];
  const belts = [
    { x: width * 0.18, z: depth * 0.39, rx: 30 * scale, rz: 48 * scale },
    { x: width * 0.37, z: depth * 0.78, rx: 43 * scale, rz: 24 * scale },
    { x: width * 0.86, z: depth * 0.36, rx: 24 * scale, rz: 40 * scale },
    { x: width * 0.92, z: depth * 0.68, rx: 20 * scale, rz: 28 * scale },
    { x: width * 0.48, z: depth * 0.15, rx: 35 * scale, rz: 20 * scale },
    { x: features.townCenter.x - 14 * scale, z: features.townCenter.z - 5 * scale, rx: 15 * scale, rz: 13 * scale },
  ];
  const rolling = (x: number, z: number): number => SEA_LEVEL + 0.85
    + 1.45 * valueNoise(x / (38 * scale), z / (38 * scale), seed)
    + 0.55 * valueNoise(x / (15 * scale), z / (15 * scale), seed + 1013);
  const padHeight = rolling(features.townCenter.x, features.townCenter.z);

  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const i = row * stride + column;
      const x = column * stepX;
      const z = row * stepZ;
      let land = rolling(x, z);
      for (const ridge of features.ridges) {
        const nx = (x - ridge.center.x) / ridge.radiusX;
        const nz = (z - ridge.center.z) / ridge.radiusZ;
        const r = Math.hypot(nx, nz);
        land += ridge.height * (1 - smoothstep(0.08, 1.35, r));
        land += 1.45 * (1 - smoothstep(0.43, 0.50, r)) * smoothstep(0.06, 0.28, nz);
      }
      for (const outcrop of features.outcrops) {
        land += 1.5 * (1 - smoothstep(1.1 * scale, 2.2 * scale, Math.hypot(x - outcrop.x, z - outcrop.z)));
      }
      land = Math.min(9.3, land);
      let height = land;
      let shore = Infinity;
      for (const lake of lakes) {
        const r = Math.hypot((x - lake.center.x) / lake.radiusX, (z - lake.center.z) / lake.radiusZ);
        const d = (r - 1) * Math.min(lake.radiusX, lake.radiusZ);
        shore = Math.min(shore, d);
        const bed = r <= 1 ? SEA_LEVEL - 1.8 + 1.45 * r * r
          : mix(SEA_LEVEL - 0.35, land, smoothstep(0, 4.5 * scale, d));
        height = Math.min(height, bed);
      }
      for (let c = 0; c < channels.length; c++) {
        const d = channels[c].distance[i];
        if (d > 10 * scale) continue;
        const river = rivers[c];
        const radius = (c === 0 ? 1.8 : 1.25) * scale;
        let ford = 0;
        for (const along of river.fordAlongs) {
          ford = Math.max(ford, 1 - smoothstep(3.7 * scale, 6.8 * scale, Math.abs(channels[c].along[i] - along)));
        }
        const bed = d <= radius ? SEA_LEVEL - 0.9 + 0.75 * (d / radius) ** 2
          : mix(SEA_LEVEL - 0.15, land, smoothstep(radius, 6 * scale, d));
        const crossing = mix(SEA_LEVEL + 0.6, land, smoothstep(0, 10 * scale, d));
        height = Math.min(height, mix(bed, crossing, ford));
        shore = Math.min(shore, mix(d - radius, 4 * scale, ford));
      }
      const padDistance = Math.max(Math.abs(x - features.townCenter.x), Math.abs(z - features.townCenter.z));
      height = mix(padHeight, height, smoothstep(3.5 * scale, 7 * scale, padDistance));
      heights[i] = height;
      shores[i] = shore;
    }
  }

  const sample = (grid: Float32Array | Float64Array, x: number, z: number): number => {
    const gx = clamp(x, 0, width) / stepX;
    const gz = clamp(z, 0, depth) / stepZ;
    const column = Math.min(Math.floor(gx), columns - 1);
    const row = Math.min(Math.floor(gz), rows - 1);
    const i = row * stride + column;
    return mix(mix(grid[i], grid[i + 1], gx - column), mix(grid[i + stride], grid[i + stride + 1], gx - column), gz - row);
  };
  const heightAt = (x: number, z: number): number => sample(heights, x, z);
  const slopeAt = (x: number, z: number): number => {
    const left = Math.max(0, x - stepX / 2);
    const right = Math.min(width, x + stepX / 2);
    const north = Math.max(0, z - stepZ / 2);
    const south = Math.min(depth, z + stepZ / 2);
    return Math.hypot((heightAt(right, z) - heightAt(left, z)) / (right - left),
      (heightAt(x, south) - heightAt(x, north)) / (south - north));
  };
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const i = row * stride + column;
      const x = column * stepX;
      const z = row * stepZ;
      const h = heights[i];
      const slope = slopeAt(x, z);
      const padDistance = Math.max(Math.abs(x - features.townCenter.x), Math.abs(z - features.townCenter.z));
      const pad = 1 - smoothstep(3.5 * scale, 7 * scale, padDistance);
      const path = (1 - smoothstep(0.85 * scale, 1.8 * scale, roadDistance[i]))
        * smoothstep(SEA_LEVEL, SEA_LEVEL + 0.15, h) * (1 - smoothstep(0.65, 1, slope));
      let belt = 0;
      for (const b of belts) {
        const r = Math.hypot((x - b.x) / b.rx, (z - b.z) / b.rz);
        belt = Math.max(belt, 1 - smoothstep(0.55, 1.35, r));
      }
      let clearing = smoothstep(5 * scale, 9 * scale, padDistance);
      for (const center of clearings) {
        clearing *= smoothstep(7 * scale, 11 * scale, Math.hypot(x - center.x, z - center.z));
      }
      const moisture = valueNoise(x / (24 * scale), z / (24 * scale), seed ^ 0x510e527f);
      const mask = valueNoise(x / (9 * scale), z / (9 * scale), seed ^ 0x5be0cd19);
      forest[i] = clamp(belt * (0.76 + 0.24 * mask) * clearing
        * smoothstep(0.7 * scale, 3.4 * scale, shores[i]) * smoothstep(0.45, 1.1, h)
        * (1 - smoothstep(0.45, 0.85, slope)) * (1 - path), 0, 1);
      const sand = h < SEA_LEVEL ? 1 : (1 - smoothstep(0.15 * scale, 2.6 * scale, shores[i])) * (1 - pad);
      const rock = smoothstep(0.35, 0.92, slope);
      const dirt = Math.max(pad * 0.86, smoothstep(0.18, 0.58, slope) * 0.55);
      const meadow = (1 - smoothstep(0.38, 0.64, moisture)) * smoothstep(0.35, 0.65, mask) * (1 - pad);
      let remaining = 1;
      for (const [channel, weight] of [[6, path], [5, sand], [4, rock], [3, dirt], [2, forest[i]], [1, meadow]]) {
        materials[channel][i] = remaining * weight;
        remaining *= 1 - weight;
      }
      materials[0][i] = remaining;
    }
  }
  const inside = (x: number, z: number): boolean => x >= 0 && z >= 0 && x <= width && z <= depth;
  return {
    width,
    depth,
    heightAt,
    isWater: (x, z) => heightAt(x, z) < SEA_LEVEL,
    isWalkable: (x, z) => inside(x, z) && heightAt(x, z) >= SEA_LEVEL && slopeAt(x, z) <= 0.9,
    forestDensity: (x, z) => inside(x, z) && heightAt(x, z) > SEA_LEVEL + 0.35 ? sample(forest, x, z) : 0,
    ground: (x, z): GroundWeights => ({
      grass: sample(materials[0], x, z), meadow: sample(materials[1], x, z), forest: sample(materials[2], x, z),
      dirt: sample(materials[3], x, z), rock: sample(materials[4], x, z), sand: sample(materials[5], x, z),
      path: sample(materials[6], x, z),
    }),
  };
}
