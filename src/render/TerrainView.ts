import * as THREE from 'three';
import { detectQuality, type Quality } from '../core/quality';
import { type Heightfield } from '../core/types';
import { applyFog, type FogOfWar } from './fog';
import { packSplat } from './terrainColor';
import { createGroundTextures, GROUND_UV_SCALE, type GroundTextures } from './textures';
import { Water } from './Water';

const STEP = 0.5;
const SKIRT_DROP = 4;
const APRON_COLOR = 0x15110d;

interface EdgeVert {
  x: number;
  y: number;
  z: number;
  s0: [number, number, number, number];
  s1: [number, number, number, number];
}

/**
 * Splat-textured terrain mesh plus sea-level water.
 * Vertex weights come from `Heightfield.ground`; the shader adds macro variation,
 * slope rock, and an underwater tint. Public surface: constructor, object, update, setFog, setFancyWater.
 * `quality` defaults to {@link detectQuality} so the current game loop still picks a tier.
 */
export class TerrainView {
  readonly object = new THREE.Group();
  private readonly water: Water;
  private readonly ground: THREE.Mesh;

  constructor(hf: Heightfield, quality: Quality = detectQuality()) {
    this.ground = buildTerrain(hf, quality);
    this.object.add(this.ground);
    this.water = new Water(hf, quality);
    this.object.add(this.water.mesh);
    this.object.add(buildApron(hf));
  }

  /** Per-frame water motion. `time` in seconds. */
  update(time: number): void {
    this.water.update(time);
  }

  /** Darken the heightfield and the sea with the shared fog mask. */
  setFog(fog: FogOfWar): void {
    applyFog(this.ground.material as THREE.Material, fog);
    this.water.setFog(fog);
  }

  /** Show or hide the detailed water shader. `next` means it was never built. */
  setFancyWater(on: boolean): 'live' | 'next' {
    return this.water.setFancy(on);
  }
}

function buildTerrain(hf: Heightfield, quality: Quality): THREE.Mesh {
  const nx = Math.round(hf.width / STEP) + 1;
  const nz = Math.round(hf.depth / STEP) + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const splat0: number[] = [];
  const splat1: number[] = [];
  const indices: number[] = [];
  const edge: EdgeVert[][] = [[], [], [], []];

  const write = (x: number, y: number, z: number, u: number, v: number, s0: EdgeVert['s0'], s1: EdgeVert['s1']) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    splat0.push(s0[0], s0[1], s0[2], s0[3]);
    splat1.push(s1[0], s1[1], s1[2], s1[3]);
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1)) * hf.width;
      const z = (j / (nz - 1)) * hf.depth;
      const y = hf.heightAt(x, z);
      const packed = packSplat(hf.ground(x, z), 0);
      const u = i / (nx - 1);
      const v = j / (nz - 1);
      write(x, y, z, u, v, packed.splat0, packed.splat1);
      const vert: EdgeVert = { x, y, z, s0: packed.splat0, s1: packed.splat1 };
      if (j === 0) edge[0].push(vert);
      if (j === nz - 1) edge[1].push(vert);
      if (i === 0) edge[2].push(vert);
      if (i === nx - 1) edge[3].push(vert);
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

  addSkirt(edge[0], true, positions, uvs, splat0, splat1, indices);
  addSkirt(edge[1], false, positions, uvs, splat0, splat1, indices);
  addSkirt(edge[2], false, positions, uvs, splat0, splat1, indices);
  addSkirt(edge[3], true, positions, uvs, splat0, splat1, indices);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('splat0', new THREE.Float32BufferAttribute(splat0, 4));
  geo.setAttribute('splat1', new THREE.Float32BufferAttribute(splat1, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.shadowSide = THREE.FrontSide;
  applySplat(material, createGroundTextures(quality));

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = quality.shadows;
  mesh.receiveShadow = quality.shadows;
  mesh.name = 'terrain';
  return mesh;
}

function addSkirt(
  edge: EdgeVert[],
  inward: boolean,
  positions: number[],
  uvs: number[],
  splat0: number[],
  splat1: number[],
  indices: number[],
): void {
  const base = positions.length / 3;
  for (let i = 0; i < edge.length; i++) {
    const p = edge[i];
    const u = edge.length <= 1 ? 0 : i / (edge.length - 1);
    positions.push(p.x, p.y, p.z, p.x, p.y - SKIRT_DROP, p.z);
    uvs.push(u, 0, u, 1);
    splat0.push(p.s0[0], p.s0[1], p.s0[2], p.s0[3], p.s0[0], p.s0[1], p.s0[2], p.s0[3]);
    splat1.push(p.s1[0], p.s1[1], p.s1[2], 0.2, p.s1[0], p.s1[1], p.s1[2], 0.5);
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

function applySplat(material: THREE.MeshLambertMaterial, textures: GroundTextures): void {
  const uniforms = {
    uGrassMap: { value: textures.grass },
    uMeadowMap: { value: textures.meadow },
    uForestMap: { value: textures.forest },
    uDirtMap: { value: textures.dirt },
    uRockMap: { value: textures.rock },
    uSandMap: { value: textures.sand },
    uPathMap: { value: textures.path },
    uTile: { value: GROUND_UV_SCALE },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      /* glsl */ `
attribute vec4 splat0;
attribute vec4 splat1;
varying vec4 vSplat0;
varying vec4 vSplat1;
varying vec3 vWorldPos;
varying float vSlope;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
vSlope = 1.0 - clamp(normalize(mat3(modelMatrix) * objectNormal).y, 0.0, 1.0);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSplat0 = splat0;
vSplat1 = splat1;`,
      );
    shader.fragmentShader =
      /* glsl */ `
uniform sampler2D uGrassMap;
uniform sampler2D uMeadowMap;
uniform sampler2D uForestMap;
uniform sampler2D uDirtMap;
uniform sampler2D uRockMap;
uniform sampler2D uSandMap;
uniform sampler2D uPathMap;
uniform float uTile;
varying vec4 vSplat0;
varying vec4 vSplat1;
varying vec3 vWorldPos;
varying float vSlope;
float agHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float agNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(agHash(i), agHash(i + vec2(1.0, 0.0)), f.x), mix(agHash(i + vec2(0.0, 1.0)), agHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `{
  vec2 tuv = vWorldPos.xz * uTile;
  vec3 grassCol = texture2D(uGrassMap, tuv).rgb;
  vec3 meadowCol = texture2D(uMeadowMap, tuv).rgb;
  vec3 forestCol = texture2D(uForestMap, tuv).rgb;
  vec3 dirtCol = texture2D(uDirtMap, tuv).rgb;
  vec3 rockCol = texture2D(uRockMap, tuv).rgb;
  vec3 sandCol = texture2D(uSandMap, tuv).rgb;
  vec3 pathCol = texture2D(uPathMap, tuv).rgb;
  vec3 splatCol = grassCol * vSplat0.x + meadowCol * vSplat0.y + forestCol * vSplat0.z + dirtCol * vSplat0.w
    + rockCol * vSplat1.x + sandCol * vSplat1.y + pathCol * vSplat1.z;
  float broad = agNoise(vWorldPos.xz * 0.012);
  float mid = agNoise(vWorldPos.xz * 0.034 + 5.1);
  float macro = broad * 0.62 + mid * 0.38;
  splatCol *= 0.84 + macro * 0.32;
  splatCol.r += (broad - 0.5) * 0.04;
  float rock = smoothstep(0.2, 0.58, vSlope) * (1.0 - clamp(vSplat1.y, 0.0, 1.0));
  splatCol = mix(splatCol, rockCol, rock);
  float under = smoothstep(0.08, -1.7, vWorldPos.y);
  splatCol = mix(splatCol, splatCol * vec3(0.42, 0.55, 0.58) + vec3(0.02, 0.045, 0.06), under);
  splatCol *= 1.0 - clamp(vSplat1.w, 0.0, 0.82);
  diffuseColor.rgb *= splatCol;
}`,
    );
  };
}

/** Off-map darkness framing the playable area, so the world edge reads as a border, not a hole into the sky. */
function buildApron(hf: Heightfield): THREE.Mesh {
  const reach = 400;
  const y = -SKIRT_DROP + 0.5;
  const w = hf.width;
  const d = hf.depth;
  // Four quads around the map rectangle (x, z extents), wound to face up.
  const quads = [
    [-reach, -reach, w + reach, 0],
    [-reach, d, w + reach, d + reach],
    [-reach, 0, 0, d],
    [w, 0, w + reach, d],
  ];
  const positions: number[] = [];
  for (const [x0, z0, x1, z1] of quads) {
    positions.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const apron = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: APRON_COLOR, fog: true }));
  apron.name = 'apron';
  return apron;
}

