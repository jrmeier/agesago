/**
 * Procedural rectangular landscape: a continuous heightmap (rolling hills) with
 * a lake, beaches, rocky slopes and forest zones. Everything is a single
 * rectangular landmass — no isometric diamond island.
 */

export enum Biome {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Rock = 4,
}

export const LAND_W = 110; // cells along X
export const LAND_H = 78; // cells along Z
export const HEIGHT_SCALE = 10;
export const WATER_LEVEL = 1.5;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 37);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export class Landscape {
  readonly width = LAND_W;
  readonly height = LAND_H;
  readonly waterLevel = WATER_LEVEL;

  /** Corner heights, size (W+1) x (H+1). */
  readonly heights: Float32Array;
  /** Per-cell biome, size W x H. */
  readonly biome: Uint8Array;

  townCell = { x: Math.floor(LAND_W / 2), y: Math.floor(LAND_H / 2) };

  private vx = LAND_W + 1;
  private vz = LAND_H + 1;

  constructor(seed = 7) {
    this.heights = new Float32Array(this.vx * this.vz);
    this.biome = new Uint8Array(LAND_W * LAND_H);
    this.generate(seed);
  }

  private generate(seed: number): void {
    // 1) Base heightmap: broad rolling hills + medium + fine detail.
    for (let gz = 0; gz < this.vz; gz++) {
      for (let gx = 0; gx < this.vx; gx++) {
        const nx = gx / this.width;
        const nz = gz / this.height;
        let e =
          0.6 * fbm(nx * 3.0, nz * 3.0, seed) +
          0.3 * fbm(nx * 6.0, nz * 6.0, seed + 11) +
          0.1 * fbm(nx * 12.0, nz * 12.0, seed + 23);
        e = Math.pow(e, 1.5); // flatten lowlands, keep peaks
        this.heights[gz * this.vx + gx] = e * HEIGHT_SCALE;
      }
    }

    // 2) Carve a lake basin so there is a body of water.
    this.carveBasin(this.width * 0.28, this.height * 0.34, 13, WATER_LEVEL - 1.4);
    // 3) A meandering river from the lake toward an edge.
    this.carveRiver(seed);

    // 4) Flatten a plaza for the town center near the map middle (on land).
    this.flattenTownPlaza(seed);

    // 5) Classify biomes from the finished heightmap.
    this.classify(seed);
  }

  private carveBasin(cx: number, cz: number, radius: number, targetY: number): void {
    for (let gz = 0; gz < this.vz; gz++) {
      for (let gx = 0; gx < this.vx; gx++) {
        const d = Math.hypot(gx - cx, gz - cz);
        if (d < radius) {
          const t = smooth(1 - d / radius);
          const i = gz * this.vx + gx;
          this.heights[i] = lerp(this.heights[i], targetY, t);
        }
      }
    }
  }

  private carveRiver(seed: number): void {
    let x = this.width * 0.28;
    let z = this.height * 0.34;
    const steps = this.height;
    for (let s = 0; s < steps; s++) {
      z += 1;
      x += (fbm(z * 0.12, 3.7, seed + 5) - 0.5) * 3.2;
      const cx = Math.round(x);
      const cz = Math.round(z);
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= this.vx || gz >= this.vz) continue;
          const d = Math.hypot(dx, dz);
          if (d > 2.2) continue;
          const i = gz * this.vx + gx;
          const t = smooth(1 - d / 2.2);
          this.heights[i] = lerp(this.heights[i], WATER_LEVEL - 1.0, t);
        }
      }
      if (z >= this.height - 1) break;
    }
  }

  private flattenTownPlaza(seed: number): void {
    // Find a fairly flat, above-water grass spot near the center.
    let best = { x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
    let bestScore = Infinity;
    for (let gz = this.height * 0.35; gz < this.height * 0.7; gz++) {
      for (let gx = this.width * 0.4; gx < this.width * 0.75; gx++) {
        const x = Math.floor(gx);
        const y = Math.floor(gz);
        const h = this.cornerHeight(x, y);
        if (h < WATER_LEVEL + 1.2) continue;
        const slope = this.localSlope(x, y);
        const dc = Math.hypot(x - this.width / 2, y - this.height / 2);
        const score = slope * 8 + dc * 0.05 + fbm(x * 0.1, y * 0.1, seed) * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }

    const plazaY = this.cornerHeight(best.x, best.y);
    const r = 5;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = best.x + dx;
        const gz = best.y + dz;
        if (gx < 0 || gz < 0 || gx >= this.vx || gz >= this.vz) continue;
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        const t = smooth(1 - d / r);
        const i = gz * this.vx + gx;
        this.heights[i] = lerp(this.heights[i], plazaY, t * 0.92);
      }
    }
    this.townCell = best;
  }

  private classify(seed: number): void {
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const h = this.cellHeight(x, z);
        const slope = this.localSlope(x, z);
        const moist = fbm(x * 0.05 + 10, z * 0.05 + 4, seed + 71);
        let b: Biome;
        if (h < this.waterLevel) b = Biome.Water;
        else if (h < this.waterLevel + 0.7) b = Biome.Sand;
        else if (slope > 1.4 || h > HEIGHT_SCALE * 0.72) b = Biome.Rock;
        else if (moist > 0.58 && h < HEIGHT_SCALE * 0.6) b = Biome.Forest;
        else b = Biome.Grass;
        this.biome[z * this.width + x] = b;
      }
    }
  }

  private cornerHeight(gx: number, gz: number): number {
    const x = Math.max(0, Math.min(this.vx - 1, gx));
    const z = Math.max(0, Math.min(this.vz - 1, gz));
    return this.heights[z * this.vx + x];
  }

  private cellHeight(x: number, z: number): number {
    return (
      (this.cornerHeight(x, z) +
        this.cornerHeight(x + 1, z) +
        this.cornerHeight(x, z + 1) +
        this.cornerHeight(x + 1, z + 1)) /
      4
    );
  }

  private localSlope(x: number, z: number): number {
    const a = this.cornerHeight(x, z);
    const b = this.cornerHeight(x + 1, z);
    const c = this.cornerHeight(x, z + 1);
    const d = this.cornerHeight(x + 1, z + 1);
    return Math.max(Math.abs(a - d), Math.abs(b - c), Math.abs(a - b), Math.abs(a - c));
  }

  /** Bilinear-interpolated terrain height at continuous world coords. */
  heightAt(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.width - 1e-3, x));
    const cz = Math.max(0, Math.min(this.height - 1e-3, z));
    const gx = Math.floor(cx);
    const gz = Math.floor(cz);
    const fx = cx - gx;
    const fz = cz - gz;
    const h00 = this.cornerHeight(gx, gz);
    const h10 = this.cornerHeight(gx + 1, gz);
    const h01 = this.cornerHeight(gx, gz + 1);
    const h11 = this.cornerHeight(gx + 1, gz + 1);
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  biomeAt(x: number, z: number): Biome {
    const ix = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    const iz = Math.max(0, Math.min(this.height - 1, Math.floor(z)));
    return this.biome[iz * this.width + ix] as Biome;
  }

  isWalkable(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return false;
    const b = this.biomeAt(x, z);
    if (b === Biome.Water || b === Biome.Forest || b === Biome.Rock) return false;
    return this.localSlope(Math.floor(x), Math.floor(z)) < 1.6;
  }

  moistureAt(gx: number, gz: number, seed = 7): number {
    return fbm(gx * 0.05 + 10, gz * 0.05 + 4, seed + 71);
  }
}
