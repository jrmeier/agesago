import * as THREE from 'three';
import type { Quality } from '../core/quality';
import { SEA_LEVEL, type Heightfield } from '../core/types';
import { applyFog, type FogOfWar } from './fog';
import { SKY_HORIZON, SKY_TOP, WATER_COLOR, WATER_DEEP } from './palette';
import { sunDirection } from './Sky';

const BED_MIN = -8;
const BED_SPAN = 14;
const MARGIN = 6;

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uBed;
uniform vec4 uBedRect;
uniform float uBedMin;
uniform float uBedSpan;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uOpacity;
varying vec3 vWorld;

float agHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float agNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = agHash(i);
  float b = agHash(i + vec2(1.0, 0.0));
  float c = agHash(i + vec2(0.0, 1.0));
  float d = agHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = (vWorld.xz - uBedRect.xy) / max(uBedRect.zw, vec2(0.001));
  float bed = texture2D(uBed, clamp(uv, 0.001, 0.999)).r * uBedSpan + uBedMin;
  float depth = max(0.0, -bed);

  vec2 p1 = vWorld.xz * 0.16 + vec2(uTime * 0.07, uTime * 0.025);
  vec2 p2 = vWorld.xz * 0.37 - vec2(uTime * 0.04, uTime * 0.08);
  float e = 0.18;
  float n1 = agNoise(p1);
  float n2 = agNoise(p2);
  float rip = n1 * 0.62 + n2 * 0.38;
  float dx = (agNoise(p1 + vec2(e, 0.0)) - n1) + (agNoise(p2 + vec2(e, 0.0)) - n2);
  float dz = (agNoise(p1 + vec2(0.0, e)) - n1) + (agNoise(p2 + vec2(0.0, e)) - n2);
  vec3 n = normalize(vec3(-dx * 2.4, 1.0, -dz * 2.4));

  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.2);
  vec3 water = mix(uShallow, uDeep, smoothstep(0.05, 2.6, depth));
  water *= 0.82 + rip * 0.36;
  float skyH = clamp(viewDir.y * 0.85 + 0.15, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, skyH);
  vec3 col = mix(water, sky, fres * 0.62);
  col += vec3(0.7, 0.9, 0.84) * smoothstep(0.68, 0.94, rip) * (1.0 - fres) * 0.28;

  vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 70.0);
  col += vec3(1.0, 0.86, 0.58) * spec * 1.05;

  float shore = smoothstep(0.0, 0.12, depth) * (1.0 - smoothstep(0.2, 1.15, depth));
  shore *= 1.0 - smoothstep(0.02, 0.7, max(bed, 0.0));
  float pulse = 0.6 + 0.4 * sin(uTime * 1.6 + agNoise(vWorld.xz * 0.31) * 6.283);
  float band = smoothstep(0.38, 0.8, agNoise(vWorld.xz * 0.85 + vec2(uTime * 0.18, 0.0)));
  col = mix(col, vec3(0.95, 0.96, 0.93), shore * band * pulse);

  float inland = smoothstep(0.0, 0.45, bed);
  float alpha = mix(0.22, 0.86, smoothstep(0.0, 1.05, depth));
  alpha *= 1.0 - inland * 0.92;
  alpha *= uOpacity;

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Sea-level water. High and medium tiers use a depth-tinted shader (bed height baked
 * from the heightfield, scrolling ripple normals, Fresnel, sun glint, shoreline foam).
 * Low tier is a cheap animated plane. Covers a slightly expanded water bounding box.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly positions: THREE.BufferAttribute;
  private readonly xz: Float32Array;
  private readonly plain: THREE.MeshLambertMaterial;
  private readonly fancy: THREE.ShaderMaterial | null;
  private readonly time?: { value: number };
  private fogMask: FogOfWar | null = null;

  constructor(hf: Heightfield, quality: Quality) {
    const bounds = waterBounds(hf, MARGIN);
    const region = bounds ?? { minX: 0, maxX: hf.width, minZ: 0, maxZ: hf.depth };
    const width = Math.max(2, region.maxX - region.minX);
    const depth = Math.max(2, region.maxZ - region.minZ);
    const segX = bounds ? Math.min(64, Math.max(8, Math.round(width / 2))) : 24;
    const segZ = bounds ? Math.min(48, Math.max(8, Math.round(depth / 2))) : 18;
    const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate((region.minX + region.maxX) / 2, SEA_LEVEL, (region.minZ + region.maxZ) / 2);

    this.positions = geo.attributes.position as THREE.BufferAttribute;
    this.xz = new Float32Array(this.positions.count * 2);
    for (let i = 0; i < this.positions.count; i++) {
      this.xz[i * 2] = this.positions.getX(i);
      this.xz[i * 2 + 1] = this.positions.getZ(i);
    }

    this.plain = new THREE.MeshLambertMaterial({
      color: WATER_COLOR,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const fancyOn = quality.fancyWater && bounds !== null;
    if (fancyOn && bounds) {
      this.time = { value: 0 };
      const bed = bakeBed(hf, bounds, quality.tier === 'high' ? 256 : 128);
      this.fancy = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        opacity: 0.92,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uBed: { value: bed },
          uBedRect: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) },
          uBedMin: { value: BED_MIN },
          uBedSpan: { value: BED_SPAN },
          uTime: this.time,
          uSunDir: { value: sunDirection() },
          uShallow: { value: new THREE.Color(WATER_COLOR) },
          uDeep: { value: new THREE.Color(WATER_DEEP) },
          uHorizon: { value: new THREE.Color(SKY_HORIZON) },
          uZenith: { value: new THREE.Color(SKY_TOP) },
          uOpacity: { value: 0.92 },
        },
        vertexShader,
        fragmentShader,
      });
    } else {
      this.fancy = null;
    }

    this.mesh = new THREE.Mesh(geo, this.fancy ?? this.plain);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 2;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = bounds !== null;
  }

  /** True when the detailed shader was built and can be shown without a reload. */
  hasFancy(): boolean {
    return this.fancy != null;
  }

  /**
   * Swap to the cheap plane, or back to the shader when it was built.
   * `next` means the shader was never constructed, so detailed water waits for the next match.
   */
  setFancy(on: boolean): 'live' | 'next' {
    if (on && !this.fancy) return 'next';
    this.mesh.material = on && this.fancy ? this.fancy : this.plain;
    if (this.fogMask) applyFog(this.mesh.material, this.fogMask);
    return 'live';
  }

  /** Shade the sea with fog of war. Unexplored water becomes the black map, not a hole. */
  setFog(fog: FogOfWar): void {
    this.fogMask = fog;
    applyFog(this.mesh.material as THREE.Material, fog);
  }

  /** Geometric swell plus, on the fancy shader, ripple time. `time` is seconds. */
  update(time: number): void {
    const arr = this.positions.array as Float32Array;
    const xz = this.xz;
    const n = xz.length / 2;
    for (let i = 0; i < n; i++) {
      const x = xz[i * 2];
      const z = xz[i * 2 + 1];
      arr[i * 3 + 1] =
        SEA_LEVEL + Math.sin(x * 0.55 + time * 1.25) * 0.045 + Math.cos(z * 0.7 - time * 0.95) * 0.03;
    }
    this.positions.needsUpdate = true;
    if (this.time) this.time.value = time;
  }
}

/** Expanded axis-aligned bounds of `isWater`, or null when the map is dry. */
export function waterBounds(hf: Heightfield, margin: number): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let found = false;
  const step = 1;
  for (let z = 0; z <= hf.depth; z += step) {
    for (let x = 0; x <= hf.width; x += step) {
      if (!hf.isWater(x, z)) continue;
      found = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!found) return null;
  return {
    minX: Math.max(0, minX - margin),
    maxX: Math.min(hf.width, maxX + margin),
    minZ: Math.max(0, minZ - margin),
    maxZ: Math.min(hf.depth, maxZ + margin),
  };
}

function bakeBed(hf: Heightfield, bounds: Bounds, res: number): THREE.DataTexture {
  const data = new Uint8Array(res * res * 4);
  const spanX = Math.max(0.001, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0.001, bounds.maxZ - bounds.minZ);
  for (let j = 0; j < res; j++) {
    const z = bounds.minZ + ((j + 0.5) / res) * spanZ;
    for (let i = 0; i < res; i++) {
      const x = bounds.minX + ((i + 0.5) / res) * spanX;
      const h = hf.heightAt(x, z);
      const t = Math.min(1, Math.max(0, (h - BED_MIN) / BED_SPAN));
      const b = Math.round(t * 255);
      const o = (j * res + i) * 4;
      data[o] = b;
      data[o + 1] = b;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
