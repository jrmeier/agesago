import * as THREE from 'three';
import { SEA_LEVEL, type Heightfield } from '../core/types';
import { WATER_COLOR } from './palette';
import { sampleTerrain, terrainVertexSrgb, type Rgb } from './terrainColor';

const STEP = 0.5;
const SKIRT_DROP = 4;

/**
 * Terrain mesh displaced from the Heightfield (vertex colours by height/slope/forest)
 * plus an animated water plane at sea level. Owned by the Render lane (T4).
 * Public surface FROZEN: constructor, object, update.
 */
export class TerrainView {
  readonly object = new THREE.Group();
  private readonly waterPos: THREE.BufferAttribute;
  private readonly waterXZ: Float32Array;
  private readonly waterMap: THREE.Texture;

  constructor(hf: Heightfield) {
    this.object.add(buildTerrain(hf));
    const water = buildWater(hf);
    this.object.add(water.mesh);
    this.waterPos = water.position;
    this.waterXZ = water.xz;
    this.waterMap = water.map;
  }

  /** Per-frame animation (water). `time` in seconds. */
  update(time: number): void {
    const arr = this.waterPos.array as Float32Array;
    const xz = this.waterXZ;
    const n = xz.length / 2;
    for (let i = 0; i < n; i++) {
      const x = xz[i * 2];
      const z = xz[i * 2 + 1];
      arr[i * 3 + 1] =
        SEA_LEVEL + Math.sin(x * 0.55 + time * 1.25) * 0.045 + Math.cos(z * 0.7 - time * 0.95) * 0.03;
    }
    this.waterPos.needsUpdate = true;
    this.waterMap.offset.x = time * 0.018;
    this.waterMap.offset.y = time * 0.012;
  }
}

function buildTerrain(hf: Heightfield): THREE.Mesh {
  const nx = Math.round(hf.width / STEP) + 1;
  const nz = Math.round(hf.depth / STEP) + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const edge: { x: number; y: number; z: number; color: Rgb }[][] = [[], [], [], []];

  const color = new THREE.Color();
  const write = (x: number, y: number, z: number, u: number, v: number, tint: Rgb) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    color.setRGB(tint.r, tint.g, tint.b, THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1)) * hf.width;
      const z = (j / (nz - 1)) * hf.depth;
      const sample = sampleTerrain(hf, x, z);
      const tint = terrainVertexSrgb(sample);
      write(x, sample.height, z, i / (nx - 1), j / (nz - 1), tint);
      if (j === 0) edge[0].push({ x, y: sample.height, z, color: tint });
      if (j === nz - 1) edge[1].push({ x, y: sample.height, z, color: tint });
      if (i === 0) edge[2].push({ x, y: sample.height, z, color: tint });
      if (i === nx - 1) edge[3].push({ x, y: sample.height, z, color: tint });
    }
  }

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + nx;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, c, b, d);
    }
  }

  // Skirts drop from each map edge so the terrain reads as a slab. Pattern B winds the face inward.
  addSkirt(edge[0], true, positions, colors, uvs, indices, color);
  addSkirt(edge[1], false, positions, colors, uvs, indices, color);
  addSkirt(edge[2], false, positions, colors, uvs, indices, color);
  addSkirt(edge[3], true, positions, colors, uvs, indices, color);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const detail = detailTexture();
  detail.repeat.set(hf.width / 2.5, hf.depth / 2.5);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      map: detail,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  );
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function addSkirt(
  edge: { x: number; y: number; z: number; color: Rgb }[],
  inward: boolean,
  positions: number[],
  colors: number[],
  uvs: number[],
  indices: number[],
  color: THREE.Color,
): void {
  const base = positions.length / 3;
  for (let i = 0; i < edge.length; i++) {
    const p = edge[i];
    const u = edge.length <= 1 ? 0 : i / (edge.length - 1);
    const top = scaleRgb(p.color, 0.72);
    const bot = scaleRgb(p.color, 0.4);
    positions.push(p.x, p.y, p.z, p.x, p.y - SKIRT_DROP, p.z);
    uvs.push(u, 0, u, 1);
    color.setRGB(top.r, top.g, top.b, THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
    color.setRGB(bot.r, bot.g, bot.b, THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
  }
  for (let i = 0; i < edge.length - 1; i++) {
    const t0 = base + i * 2;
    const b0 = t0 + 1;
    const t1 = t0 + 2;
    const b1 = t0 + 3;
    if (inward) indices.push(t0, b0, t1, t1, b0, b1);
    else indices.push(t0, t1, b0, t1, b1, b0);
  }
}

function buildWater(hf: Heightfield): { mesh: THREE.Mesh; position: THREE.BufferAttribute; xz: Float32Array; map: THREE.Texture } {
  const geo = new THREE.PlaneGeometry(hf.width, hf.depth, 40, 30);
  geo.rotateX(-Math.PI / 2);
  geo.translate(hf.width / 2, SEA_LEVEL, hf.depth / 2);
  const position = geo.attributes.position as THREE.BufferAttribute;
  const xz = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    xz[i * 2] = position.getX(i);
    xz[i * 2 + 1] = position.getZ(i);
  }
  const map = waterTexture();
  map.repeat.set(8, 6);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      color: WATER_COLOR,
      map,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, position, xz, map };
}

function detailTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = tileNoise(u, v, 5) * 0.45 + tileNoise(u, v, 11) * 0.35 + tileNoise(u, v, 23) * 0.2;
      const value = Math.round(236 + (n - 0.5) * 22);
      const i = (y * size + x) * 4;
      img.data[i] = value;
      img.data[i + 1] = value;
      img.data[i + 2] = value;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Value noise that tiles across the unit square when `cells` is an integer. */
function tileNoise(u: number, v: number, cells: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = smooth(x - x0);
  const sy = smooth(y - y0);
  const wrap = (i: number) => ((i % cells) + cells) % cells;
  const n00 = hash2(wrap(x0), wrap(y0));
  const n10 = hash2(wrap(x0 + 1), wrap(y0));
  const n01 = hash2(wrap(x0), wrap(y0 + 1));
  const n11 = hash2(wrap(x0 + 1), wrap(y0 + 1));
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hash2(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function waterTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const wave = Math.sin(u * 4) * 0.5 + Math.sin(v * 6 + u * 2) * 0.35 + Math.cos(u * 2 - v * 3) * 0.25;
      const value = Math.round(186 + wave * 48);
      const i = (y * size + x) * 4;
      img.data[i] = value;
      img.data[i + 1] = value + 8;
      img.data[i + 2] = Math.min(255, value + 18);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function scaleRgb(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}
