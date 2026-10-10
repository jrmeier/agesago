import * as THREE from 'three';
import type { Quality, QualityTier } from '../core/quality';
import { DIRT, FOREST_FLOOR, LIMESTONE, MEADOW, PATH_COLOR, SAND } from './palette';

/** World-units → texture uv. One tile is about 4.5 m, broken up by shader macro noise. */
export const GROUND_UV_SCALE = 0.22;

export interface GroundTextures {
  grass: THREE.CanvasTexture;
  meadow: THREE.CanvasTexture;
  forest: THREE.CanvasTexture;
  dirt: THREE.CanvasTexture;
  rock: THREE.CanvasTexture;
  sand: THREE.CanvasTexture;
  path: THREE.CanvasTexture;
}

const cache = new Map<number, GroundTextures>();

/** 512² on high, 256² on low and medium. */
export function groundTextureSize(tier: QualityTier): number {
  return tier === 'high' ? 512 : 256;
}

/**
 * Procedural tiling ground textures (canvas, repeat, mipmaps, anisotropy).
 * Cached per resolution for the life of the page.
 */
export function createGroundTextures(quality: Quality): GroundTextures {
  const size = groundTextureSize(quality.tier);
  const hit = cache.get(size);
  if (hit) return hit;
  const set: GroundTextures = {
    grass: makeTexture(size, paintGrass),
    meadow: makeTexture(size, paintMeadow),
    forest: makeTexture(size, paintForest),
    dirt: makeTexture(size, paintDirt),
    rock: makeTexture(size, paintRock),
    sand: makeTexture(size, paintSand),
    path: makeTexture(size, paintPath),
  };
  cache.set(size, set);
  return set;
}

/** sRGB 0..1 tint matching the grass/meadow textures at a world position. */
export function coverTint(x: number, z: number, meadow: number): { r: number; g: number; b: number } {
  const u = wrap01(x * GROUND_UV_SCALE);
  const v = wrap01(z * GROUND_UV_SCALE);
  const n = tileNoise(u, v, 4);
  const blade = tileNoise(u, v, 11);
  const shade = 0.92 + n * 0.2 - blade * 0.08;
  // Same sage/olive range as paintGrass and paintMeadow so tufts sit in the ground, not on it.
  const g = lerpRgb(hexRgb(0x66864a), hexRgb(0x92aa5c), n);
  const m = lerpRgb(hexRgb(0x7a9a50), hexRgb(0xa6b866), n);
  const t = clamp01(meadow);
  // hexRgb is 0..255 (canvas paint space); tints are 0..1 sRGB.
  const k = shade / 255;
  return {
    r: clamp01((g[0] + (m[0] - g[0]) * t) * k),
    g: clamp01((g[1] + (m[1] - g[1]) * t) * k),
    b: clamp01((g[2] + (m[2] - g[2]) * t) * k),
  };
}

type Rgb = [number, number, number];
type Paint = (u: number, v: number) => Rgb;

function makeTexture(size: number, paint: Paint): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const rgb = paint(x / size, v);
      const i = (y * size + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Sage turf: soft irregular clumps and sun-dried straw pockets, no directional hatch. */
function paintGrass(u: number, v: number): Rgb {
  const base = tileNoise(u, v, 6) * 0.55 + tileNoise(u, v, 15) * 0.45;
  let rgb = lerpRgb(hexRgb(0x6a8c48), hexRgb(0x9ab05e), base);
  const fine = tileNoise(u, v, 27);
  const pocket = (1 - fine) * (1 - fine);
  rgb = lerpRgb(rgb, hexRgb(0x587a3e), pocket * 0.4);
  const dry = tileNoise(u, v, 3);
  rgb = lerpRgb(rgb, hexRgb(0xb6ab6a), smoothstep(0.55, 0.88, dry) * 0.42);
  return rgb.map((c) => clamp255(c)) as Rgb;
}

/** Olive meadow: broader, lighter clumps than turf with a quiet straw cast; no baked dots. */
function paintMeadow(u: number, v: number): Rgb {
  const n = tileNoise(u, v, 3) * 0.6 + tileNoise(u, v, 8) * 0.4;
  let rgb = lerpRgb(hexRgb(MEADOW[1]), hexRgb(MEADOW[2]), n);
  const fine = tileNoise(u, v, 21);
  const pocket = (1 - fine) * (1 - fine);
  rgb = lerpRgb(rgb, hexRgb(0x6f8e46), pocket * 0.34);
  const straw = tileNoise(u, v, 2);
  rgb = lerpRgb(rgb, hexRgb(0xc2b878), smoothstep(0.5, 0.9, straw) * 0.36);
  return rgb.map((c) => clamp255(c)) as Rgb;
}

function paintForest(u: number, v: number): Rgb {
  const n = tileNoise(u, v, 5);
  const moss = tileNoise(u, v, 3);
  let rgb = lerpRgb(hexRgb(FOREST_FLOOR[1]), hexRgb(FOREST_FLOOR[0]), n);
  rgb = lerpRgb(rgb, hexRgb(0x5a7840), moss * moss * 0.55);
  const leaf = worley(u, v, 10);
  if (leaf.d < 0.34) {
    const tint = hexRgb(leaf.h > 0.5 ? 0x6a5430 : 0x3e4a28);
    const edge = smoothstep(0.1, 0.34, leaf.d);
    rgb = lerpRgb(tint, rgb, edge);
  }
  const twig = strokes(u, v, 6, 0.9, 0.03);
  return lerpRgb(rgb, hexRgb(0x4a3824), twig * 0.45).map((c) => clamp255(c)) as Rgb;
}

function paintDirt(u: number, v: number): Rgb {
  const n = tileNoise(u, v, 6) * 0.55 + tileNoise(u, v, 14) * 0.45;
  let rgb = lerpRgb(hexRgb(DIRT[1]), hexRgb(DIRT[0]), n);
  const clump = tileNoise(u, v, 3);
  rgb = lerpRgb(rgb, hexRgb(0x8a5a3c), clump * clump * 0.4);
  const pebble = worley(u, v, 18);
  if (pebble.d < 0.11) rgb = lerpRgb(hexRgb(0xa09484), rgb, 0.4 + (pebble.d / 0.11) * 0.6);
  return rgb.map((c) => clamp255(c)) as Rgb;
}

function paintPath(u: number, v: number): Rgb {
  const n = tileNoise(u, v, 5);
  const wear = tileNoise(u, v, 2);
  let rgb = lerpRgb(hexRgb(PATH_COLOR[1]), hexRgb(PATH_COLOR[0]), n);
  rgb = lerpRgb(rgb, hexRgb(PATH_COLOR[2]), wear * 0.35);
  // Wheel ruts as a soft, wide wear band rather than a dark repeating line.
  const track = Math.abs(Math.sin((v * 5 + tileNoise(u, v, 3) * 0.4) * Math.PI * 2));
  rgb = lerpRgb(rgb, hexRgb(0x9e8460), (1 - smoothstep(0, 0.3, track)) * 0.16);
  const pebble = worley(u, v, 16);
  if (pebble.d < 0.1) rgb = lerpRgb(hexRgb(pebble.h > 0.55 ? 0xdcd3c4 : 0x8c8274), rgb, 0.45 + pebble.d * 4);
  return rgb.map((c) => clamp255(c)) as Rgb;
}

/** Warm limestone: faint bedding and hairline seams, held to low local contrast. */
function paintRock(u: number, v: number): Rgb {
  const n = tileNoise(u, v, 4) * 0.7 + tileNoise(u, v, 10) * 0.3;
  let rgb = lerpRgb(hexRgb(LIMESTONE[1]), hexRgb(LIMESTONE[2]), n);
  const strata = Math.abs(Math.sin((v * 6 + tileNoise(u, v, 2) * 0.35) * Math.PI));
  rgb = lerpRgb(rgb, hexRgb(0x9c968a), (1 - smoothstep(0, 0.26, strata)) * 0.3);
  const crack = worley(u, v, 7);
  const edge = smoothstep(0.015, 0.09, crack.d);
  rgb = lerpRgb(hexRgb(0x8b857a), rgb, edge);
  const warm = tileNoise(u, v, 2);
  rgb = lerpRgb(rgb, hexRgb(LIMESTONE[0]), warm * 0.2);
  return rgb.map((c) => clamp255(c)) as Rgb;
}

function paintSand(u: number, v: number): Rgb {
  const grain = tileNoise(u, v, 22) * 0.55 + tileNoise(u, v, 40) * 0.45;
  const ripple = Math.sin((u * 8 + tileNoise(u, v, 3) * 1.4) * Math.PI * 2) * 0.5 + 0.5;
  let rgb = lerpRgb(hexRgb(SAND[1]), hexRgb(SAND[0]), grain);
  rgb = lerpRgb(rgb, hexRgb(0xc9ab72), (1 - ripple) * 0.18);
  return rgb.map((c) => clamp255(c)) as Rgb;
}

/** 0..1 coverage of a wrapping blade stroke centred in each cell. */
function strokes(u: number, v: number, cells: number, len: number, width: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let cover = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = x0 + i;
      const cy = y0 + j;
      const wx = mod(cx, cells);
      const wy = mod(cy, cells);
      const bx = cx + hash2(wx, wy);
      const by = cy + hash2(wx + 19, wy + 7);
      const ang = hash2(wx + 3, wy + 11) * Math.PI;
      const dx = x - bx;
      const dy = y - by;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const along = dx * c + dy * s;
      const across = -dx * s + dy * c;
      if (along > 0 && along < len) {
        const w = width * (1 - along / len);
        const d = Math.abs(across);
        if (d < w) cover = Math.max(cover, 1 - d / w);
      }
    }
  }
  return cover;
}

function worley(u: number, v: number, cells: number): { d: number; h: number } {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let best = 8;
  let h = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = x0 + i;
      const cy = y0 + j;
      const wx = mod(cx, cells);
      const wy = mod(cy, cells);
      const fx = cx + hash2(wx, wy);
      const fy = cy + hash2(wx + 5, wy + 13);
      const d = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      if (d < best) {
        best = d;
        h = hash2(wx + 9, wy + 2);
      }
    }
  }
  return { d: Math.sqrt(best), h };
}

/** Value noise that tiles across the unit square when `cells` is an integer. */
function tileNoise(u: number, v: number, cells: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = smooth(x - x0);
  const sy = smooth(y - y0);
  const n00 = hash2(mod(x0, cells), mod(y0, cells));
  const n10 = hash2(mod(x0 + 1, cells), mod(y0, cells));
  const n01 = hash2(mod(x0, cells), mod(y0 + 1, cells));
  const n11 = hash2(mod(x0 + 1, cells), mod(y0 + 1, cells));
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function hexRgb(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function wrap01(v: number): number {
  return v - Math.floor(v);
}
