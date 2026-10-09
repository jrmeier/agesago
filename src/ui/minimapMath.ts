import type { GroundWeights, Heightfield, Vec2 } from '../core/types';

/** Linear 0..255 RGB triple. */
export type RGB = [number, number, number];

/** Pixel size of a minimap drawn into a `w × h` box. Screen up is world −z, so z grows downward. */
export interface MapBox {
  w: number;
  h: number;
  mapW: number;
  mapD: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** World ground point → minimap pixel (x right, z down). */
export function worldToMap(p: Vec2, box: MapBox): { u: number; v: number } {
  return { u: (p.x / box.mapW) * box.w, v: (p.z / box.mapD) * box.h };
}

/** Minimap pixel → world ground point, clamped to the map. */
export function mapToWorld(u: number, v: number, box: MapBox): Vec2 {
  return { x: clamp((u / box.w) * box.mapW, 0, box.mapW), z: clamp((v / box.h) * box.mapD, 0, box.mapD) };
}

/** Minimap tints per ground material: warm, slightly antique, readable at a few pixels. */
export const GROUND_TINT: Record<keyof GroundWeights, RGB> = {
  grass: [118, 152, 74],
  meadow: [150, 166, 84],
  forest: [70, 104, 52],
  dirt: [150, 118, 74],
  rock: [152, 146, 132],
  sand: [214, 192, 140],
  path: [184, 146, 92],
};

const WATER_SHALLOW: RGB = [96, 160, 172];
const WATER_DEEP: RGB = [30, 82, 116];
/** Parchment the whole map is toned toward, so it reads like a painted chart. */
const PARCHMENT: RGB = [222, 200, 156];
const PARCHMENT_MIX = 0.14;
/** Depth (units below sea level) at which water reaches its deepest tint. */
const DEEP_AT = 2.5;

/** Material with the largest weight. */
export function dominantGround(g: GroundWeights): keyof GroundWeights {
  let best: keyof GroundWeights = 'grass';
  for (const k of Object.keys(GROUND_TINT) as (keyof GroundWeights)[]) if (g[k] > g[best]) best = k;
  return best;
}

/** Weighted blend of the material tints (weights are normalised, so any positive mix works). */
export function groundColor(g: GroundWeights): RGB {
  let sum = 0;
  const c: RGB = [0, 0, 0];
  for (const k of Object.keys(GROUND_TINT) as (keyof GroundWeights)[]) {
    const w = Math.max(0, g[k]);
    if (!w) continue;
    sum += w;
    for (let i = 0; i < 3; i++) c[i] += GROUND_TINT[k][i] * w;
  }
  if (sum <= 0) return [...GROUND_TINT.grass];
  return [c[0] / sum, c[1] / sum, c[2] / sum];
}

/** Water tint by depth below sea level: pale shallows to deep blue. */
export function waterColor(depth: number): RGB {
  const t = clamp(depth / DEEP_AT, 0, 1);
  return [0, 1, 2].map((i) => WATER_SHALLOW[i] + (WATER_DEEP[i] - WATER_SHALLOW[i]) * t) as RGB;
}

/** Light from the north-west and above, as on old maps. */
const LIGHT = normalize3(-1, 1.6, -1);

/** Brightness multiplier from the height gradient; 1 on flat ground, >1 on slopes facing the light. */
export function hillShade(dhdx: number, dhdz: number): number {
  const [nx, ny, nz] = normalize3(-dhdx, 1, -dhdz);
  return clamp((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / LIGHT[1], 0.55, 1.35);
}

/** Final minimap colour at a ground point: water by depth, else material blend with hill shading. */
export function terrainColor(hf: Heightfield, x: number, z: number): RGB {
  const h = hf.heightAt(x, z);
  let c: RGB;
  if (hf.isWater(x, z)) {
    c = waterColor(-h);
  } else {
    const e = 0.75;
    const dx = (hf.heightAt(x + e, z) - hf.heightAt(x - e, z)) / (2 * e);
    const dz = (hf.heightAt(x, z + e) - hf.heightAt(x, z - e)) / (2 * e);
    const k = hillShade(dx, dz) * clamp(1 + h * 0.012, 0.9, 1.12);
    c = groundColor(hf.ground(x, z)).map((v) => v * k) as RGB;
  }
  return c.map((v, i) => clamp(Math.round(v + (PARCHMENT[i] - v) * PARCHMENT_MIX), 0, 255)) as RGB;
}

/** Rasterise the whole heightfield into RGBA pixels (row-major, z down), sampling pixel centres. */
export function renderTerrain(hf: Heightfield, w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const z = ((j + 0.5) / h) * hf.depth;
    for (let i = 0; i < w; i++) {
      const c = terrainColor(hf, ((i + 0.5) / w) * hf.width, z);
      const o = (j * w + i) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
  }
  return px;
}

/** Footprint key rounded to `step` world units, for cheap change detection. */
export function footprintKey(quad: readonly Vec2[], step = 0.05): string {
  return quad.map((p) => `${Math.round(p.x / step)},${Math.round(p.z / step)}`).join(';');
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
