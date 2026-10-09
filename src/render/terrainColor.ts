import { SEA_LEVEL, type Heightfield } from '../core/types';
import { DIRT, FOREST_FLOOR, GRASS, SAND } from './palette';

/** sRGB channels in 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface TerrainSample {
  height: number;
  /** Rise/run of the ground. 0 is flat, 1 is a 45° slope. */
  slope: number;
  /** 0..1 forest density. */
  forest: number;
  /** Stable 0..1 tint variation. */
  variation: number;
}

/** Smooth Hermite step. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Deterministic 0..1 hash of a ground position. */
export function hash01(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Sample height, slope, forest density and a coarse colour variation at (x, z).
 * Slope uses a 0.5 unit central difference, clamped to the heightfield.
 */
export function sampleTerrain(hf: Heightfield, x: number, z: number): TerrainSample {
  const e = 0.5;
  const x0 = clamp(x - e, 0, hf.width);
  const x1 = clamp(x + e, 0, hf.width);
  const z0 = clamp(z - e, 0, hf.depth);
  const z1 = clamp(z + e, 0, hf.depth);
  const dx = x1 - x0 || 1;
  const dz = z1 - z0 || 1;
  const cell = 2;
  return {
    height: hf.heightAt(x, z),
    slope: Math.hypot(
      (hf.heightAt(x1, z) - hf.heightAt(x0, z)) / dx,
      (hf.heightAt(x, z1) - hf.heightAt(x, z0)) / dz,
    ),
    forest: hf.forestDensity(x, z),
    variation: hash01(Math.round(x / cell) * cell, Math.round(z / cell) * cell),
  };
}

/**
 * Vertex tint for one terrain sample: sand near sea level, grass by default,
 * darker forest floor, dirt on steep slopes, and a darkened underwater bed.
 */
export function terrainVertexSrgb(sample: TerrainSample): Rgb {
  const v = clamp01(sample.variation);
  const grass = scale(hexRgb(GRASS[1]), 0.96 + v * 0.08);
  const sand = hexRgb(SAND[v > 0.5 ? 1 : 0]);
  const forest = hexRgb(FOREST_FLOOR[v > 0.5 ? 1 : 0]);
  const dirt = hexRgb(DIRT[v > 0.5 ? 1 : 0]);

  const sandT = 1 - smoothstep(0.02, 0.6, sample.height);
  const dirtT = smoothstep(0.4, 0.95, sample.slope);
  const forestT = clamp01(sample.forest) * (1 - sandT) * (1 - dirtT * 0.65);

  let color = mix(grass, sand, clamp01(sandT));
  color = mix(color, forest, forestT);
  color = mix(color, dirt, dirtT * (1 - sandT * 0.35));

  if (sample.height < SEA_LEVEL) {
    const depth = clamp01(-sample.height / 2.4);
    color = scale(color, 1 - depth * 0.58);
    color = mix(color, { r: 0.05, g: 0.11, b: 0.15 }, depth * 0.45);
  }

  return { r: clamp01(color.r), g: clamp01(color.g), b: clamp01(color.b) };
}

function hexRgb(hex: number): Rgb {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function scale(a: Rgb, k: number): Rgb {
  return { r: a.r * k, g: a.g * k, b: a.b * k };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
