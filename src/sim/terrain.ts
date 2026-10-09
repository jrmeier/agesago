import { MAP_D, MAP_W, SEA_LEVEL, type Heightfield, type Vec2 } from '../core/types';

/** Landmark positions shared by terrain carving and starting resource placement. */
export interface TerrainFeatures {
  townCenter: Vec2;
  lake: { center: Vec2; radiusX: number; radiusZ: number };
  river: { points: Vec2[]; ford: Vec2; fordAlong: number };
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

function hillHeight(x: number, z: number, seed: number): number {
  let noise = 0;
  for (let octave = 0; octave < 3; octave++) {
    const frequency = 2 ** octave / 20;
    noise += valueNoise(x * frequency, z * frequency, seed + octave * 1013) / 2 ** octave;
  }
  return SEA_LEVEL + 0.3 + 2.5 * noise / 1.75;
}

/** Seeded landmarks; the default TC sits near the centre, west of the lake and river. */
export function terrainFeatures(seed: number, width = MAP_W, depth = MAP_D): TerrainFeatures {
  const random = createSeededRandom(seed ^ 0x3c6ef372);
  const scale = Math.min(width / MAP_W, depth / MAP_D);
  const townCenter = {
    x: Math.round((width * 0.43 + (random() - 0.5) * 2 * scale) * 2) / 2,
    z: Math.round((depth * 0.5 + (random() - 0.5) * 3 * scale) * 2) / 2,
  };
  const lake = {
    center: { x: width * 0.79 + (random() - 0.5) * 2 * scale, z: depth * 0.72 },
    radiusX: (7 + random()) * scale,
    radiusZ: (5.5 + random()) * scale,
  };
  const phase = random() * Math.PI * 2;
  const points: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    points.push({
      x: mix(width * 0.69, lake.center.x, t) + Math.sin(t * Math.PI * 3 + phase) * 2.2 * scale * (1 - t),
      z: lake.center.z * t,
    });
  }
  const fordIndex = 11;
  let fordAlong = 0;
  for (let i = 1; i <= fordIndex; i++) {
    fordAlong += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return { townCenter, lake, river: { points, ford: { ...points[fordIndex] }, fordAlong } };
}

function riverDistance(x: number, z: number, points: Vec2[]): { distance: number; along: number } {
  let distance = Infinity;
  let along = 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const dx = points[i].x - start.x;
    const dz = points[i].z - start.z;
    const segmentLength = Math.hypot(dx, dz);
    const t = clamp(((x - start.x) * dx + (z - start.z) * dz) / segmentLength ** 2, 0, 1);
    const d = Math.hypot(x - start.x - dx * t, z - start.z - dz * t);
    if (d < distance) {
      distance = d;
      along = length + segmentLength * t;
    }
    length += segmentLength;
  }
  return { distance, along };
}

/** Half-unit height grid with bilinear queries, gentle hills, water, a ford and a flat TC pad. */
export function generateTerrain(seed: number, width = MAP_W, depth = MAP_D): Heightfield {
  const features = terrainFeatures(seed, width, depth);
  const scale = Math.min(width / MAP_W, depth / MAP_D);
  const columns = Math.ceil(width * 2);
  const rows = Math.ceil(depth * 2);
  const stepX = width / columns;
  const stepZ = depth / rows;
  const heights = new Float64Array((columns + 1) * (rows + 1));
  const padHeight = hillHeight(features.townCenter.x, features.townCenter.z, seed);

  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const x = column * stepX;
      const z = row * stepZ;
      const land = hillHeight(x, z, seed);
      const lakeRadius = Math.hypot(
        (x - features.lake.center.x) / features.lake.radiusX,
        (z - features.lake.center.z) / features.lake.radiusZ
      );
      const shoreDistance = (lakeRadius - 1) * features.lake.radiusZ;
      const lakeHeight = lakeRadius <= 1
        ? SEA_LEVEL - 1.2 + 0.85 * lakeRadius ** 2
        : mix(SEA_LEVEL - 0.35, land, smoothstep(0, 3 * scale, shoreDistance));
      const river = riverDistance(x, z, features.river.points);
      let riverHeight = river.distance < 1.15 * scale
        ? SEA_LEVEL - 0.85 + 0.7 * (river.distance / (1.15 * scale)) ** 2
        : mix(SEA_LEVEL - 0.15, land, smoothstep(1.15 * scale, 3.4 * scale, river.distance));
      const fordWeight = 1 - smoothstep(1.75 * scale, 3.75 * scale, Math.abs(river.along - features.river.fordAlong));
      const fordHeight = mix(SEA_LEVEL + 0.55, land, smoothstep(0, 5 * scale, river.distance));
      riverHeight = mix(riverHeight, fordHeight, fordWeight);
      let height = Math.min(land, lakeHeight, riverHeight);
      const padDistance = Math.max(Math.abs(x - features.townCenter.x), Math.abs(z - features.townCenter.z));
      height = mix(padHeight, height, smoothstep(3.25 * scale, 5.5 * scale, padDistance));
      heights[row * (columns + 1) + column] = height;
    }
  }

  const heightAt = (x: number, z: number): number => {
    const gx = clamp(x, 0, width) / stepX;
    const gz = clamp(z, 0, depth) / stepZ;
    const column = Math.min(Math.floor(gx), columns - 1);
    const row = Math.min(Math.floor(gz), rows - 1);
    const index = row * (columns + 1) + column;
    return mix(
      mix(heights[index], heights[index + 1], gx - column),
      mix(heights[index + columns + 1], heights[index + columns + 2], gx - column),
      gz - row
    );
  };
  const inside = (x: number, z: number): boolean => x >= 0 && z >= 0 && x <= width && z <= depth;
  const clusters = [
    { x: features.townCenter.x - 10 * scale, z: features.townCenter.z - 2 * scale, rx: 11 * scale, rz: 8 * scale },
    { x: width * 0.2, z: depth * 0.22, rx: 11 * scale, rz: 8 * scale },
    { x: width * 0.23, z: depth * 0.77, rx: 12 * scale, rz: 8 * scale },
    { x: width * 0.85, z: depth * 0.23, rx: 9 * scale, rz: 8 * scale },
  ];

  return {
    width,
    depth,
    heightAt,
    isWater: (x, z) => heightAt(x, z) < SEA_LEVEL,
    isWalkable: (x, z) => {
      if (!inside(x, z) || heightAt(x, z) < SEA_LEVEL) return false;
      const left = Math.max(0, x - stepX / 2);
      const right = Math.min(width, x + stepX / 2);
      const north = Math.max(0, z - stepZ / 2);
      const south = Math.min(depth, z + stepZ / 2);
      const dx = (heightAt(right, z) - heightAt(left, z)) / (right - left);
      const dz = (heightAt(x, south) - heightAt(x, north)) / (south - north);
      return Math.hypot(dx, dz) <= 0.9;
    },
    forestDensity: (x, z) => {
      if (!inside(x, z)) return 0;
      const shoreWeight = smoothstep(SEA_LEVEL + 0.35, SEA_LEVEL + 0.8, heightAt(x, z));
      const padDistance = Math.max(Math.abs(x - features.townCenter.x), Math.abs(z - features.townCenter.z));
      const padWeight = smoothstep(4.5 * scale, 6 * scale, padDistance);
      let cluster = 0;
      for (const c of clusters) {
        cluster = Math.max(cluster, Math.exp(-(((x - c.x) / c.rx) ** 2 + ((z - c.z) / c.rz) ** 2)));
      }
      const mask = valueNoise(x / (7 * scale), z / (7 * scale), seed ^ 0x510e527f);
      return clamp(cluster * (0.8 + 0.25 * mask) * shoreWeight * padWeight, 0, 1);
    },
    ground(x, z) {
      // Placeholder blend until the World lane replaces it.
      const h = heightAt(x, z);
      const sand = 1 - smoothstep(SEA_LEVEL + 0.2, SEA_LEVEL + 0.6, h);
      const forest = (1 - sand) * this.forestDensity(x, z);
      const grass = Math.max(0, 1 - sand - forest);
      return { grass, meadow: 0, forest, dirt: 0, rock: 0, sand, path: 0 };
    },
  };
}
