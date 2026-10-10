import * as THREE from 'three';
import type { Quality } from '../core/quality';
import { SEA_LEVEL, type Heightfield, type Vec2 } from '../core/types';
import type { Visibility } from '../sim/visibility';
import { applyFog, createFogDepthMaterial, isConcealed, type FogOfWar } from './fog';
import { WILDFLOWERS } from './palette';
import { coverTint } from './textures';

/** Cell size for stable grass chunks. Tufts are hashed inside a cell and do not reshuffle as the camera moves. */
export const GRASS_CELL = 8;

export interface GrassTuft {
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
  tall: number;
  kind: 'grass' | 'flower';
  /** sRGB 0..1. */
  color: { r: number; g: number; b: number };
}

const FLOWER_RGB = WILDFLOWERS.map((hex) => ({
  r: ((hex >> 16) & 255) / 255,
  g: ((hex >> 8) & 255) / 255,
  b: (hex & 255) / 255,
}));

/**
 * Deterministic tufts around `focus`, only where grass or meadow shows through
 * and never on path, rock, sand, water, or under trees. Empty when density or radius is 0.
 * Tufts on unexplored cells are skipped when `visibility` is passed.
 */
export function collectGrass(hf: Heightfield, quality: Quality, focus: Vec2, visibility?: Visibility): GrassTuft[] {
  if (quality.grassDensity <= 0 || quality.grassRadius <= 0) return [];
  const out: GrassTuft[] = [];
  const radius = quality.grassRadius;
  const r2 = radius * radius;
  const perCell = Math.max(1, Math.round(GRASS_CELL * GRASS_CELL * quality.grassDensity));
  const cx0 = Math.floor((focus.x - radius) / GRASS_CELL);
  const cx1 = Math.floor((focus.x + radius) / GRASS_CELL);
  const cz0 = Math.floor((focus.z - radius) / GRASS_CELL);
  const cz1 = Math.floor((focus.z + radius) / GRASS_CELL);

  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const minX = cx * GRASS_CELL;
      const minZ = cz * GRASS_CELL;
      const maxX = minX + GRASS_CELL;
      const maxZ = minZ + GRASS_CELL;
      if (maxX < 0 || maxZ < 0 || minX > hf.width || minZ > hf.depth) continue;
      const nearX = clamp(focus.x, minX, maxX);
      const nearZ = clamp(focus.z, minZ, maxZ);
      if ((nearX - focus.x) ** 2 + (nearZ - focus.z) ** 2 > r2) continue;

      for (let i = 0; i < perCell; i++) {
        const x = minX + hash01(cx, cz, i) * GRASS_CELL;
        const z = minZ + hash01(cx, cz, i + 101) * GRASS_CELL;
        const dx = x - focus.x;
        const dz = z - focus.z;
        if (dx * dx + dz * dz > r2) continue;
        if (x < 0 || z < 0 || x > hf.width || z > hf.depth) continue;
        if (visibility && isConcealed(visibility, x, z)) continue;
        const y = hf.heightAt(x, z);
        if (y < SEA_LEVEL || hf.isWater(x, z)) continue;
        if (hf.forestDensity(x, z) > 0.45) continue;
        const g = hf.ground(x, z);
        if (g.path > 0.34 || g.rock > 0.34 || g.sand > 0.4) continue;
        const meadow = g.meadow > 0 ? g.meadow : 0;
        const grass = g.grass > 0 ? g.grass : 0;
        const cover = grass + meadow;
        if (cover < 0.2) continue;
        if (hash01(cx, cz, i + 250) > cover) continue;

        const roll = hash01(cx, cz, i + 17);
        const flower = meadow > 0.15 && hash01(cx, cz, i + 777) < meadow * 0.18;
        const yaw = hash01(cx, cz, i + 40) * Math.PI * 2;
        const scale = 0.75 + hash01(cx, cz, i + 60) * 0.5;
        if (flower) {
          const idx = Math.floor(hash01(cx, cz, i + 900) * FLOWER_RGB.length) % FLOWER_RGB.length;
          out.push({
            x,
            z,
            y,
            yaw,
            scale: scale * 0.95,
            tall: 0.9 + roll * 0.35,
            kind: 'flower',
            color: FLOWER_RGB[idx],
          });
        } else {
          out.push({
            x,
            z,
            y,
            yaw,
            scale,
            tall: (0.65 + roll * 0.4) * (1 + meadow * 0.85),
            kind: 'grass',
            color: coverTint(x, z, meadow / Math.max(cover, 1e-4)),
          });
        }
      }
    }
  }
  return out;
}

const grassGeometry = tuftGeometry();
const flowerGeometry = bloomGeometry();

/**
 * Instanced grass and wildflowers inside `quality.grassRadius` of the camera focus.
 * Cells regenerate from a stable hash, so tufts don't shuffle as the camera moves.
 * Wind sways tips in the vertex shader. No-op when `grassDensity` is 0.
 */
export class GrassField {
  readonly object = new THREE.Group();
  private readonly capacity: number;
  private readonly grassMat: THREE.MeshLambertMaterial;
  private readonly flowerMat: THREE.MeshLambertMaterial;
  private readonly time: { value: number };
  private grassMesh: THREE.InstancedMesh | null = null;
  private flowerMesh: THREE.InstancedMesh | null = null;
  private windowKey = '';
  private fog: FogOfWar | null = null;
  private depthMaterial: THREE.Material | null = null;

  constructor(
    private readonly hf: Heightfield,
    private readonly quality: Quality,
  ) {
    this.time = { value: 0 };
    const per = Math.max(1, Math.round(GRASS_CELL * GRASS_CELL * Math.max(quality.grassDensity, 0)));
    const side = Math.ceil((quality.grassRadius * 2) / GRASS_CELL) + 2;
    this.capacity = quality.grassDensity > 0 && quality.grassRadius > 0 ? Math.max(1, per * side * side) : 0;
    this.grassMat = windMaterial('grass', this.time);
    this.flowerMat = windMaterial('flower', this.time);
    this.object.name = 'grass';
  }

  /** Fog the tufts and skip any that stand on unexplored ground. */
  setFog(fog: FogOfWar): void {
    this.fog = fog;
    applyFog(this.grassMat, fog, { hideUnexplored: true });
    applyFog(this.flowerMat, fog, { hideUnexplored: true });
    this.depthMaterial = createFogDepthMaterial(fog);
    if (this.grassMesh) this.grassMesh.customDepthMaterial = this.depthMaterial;
    if (this.flowerMesh) this.flowerMesh.customDepthMaterial = this.depthMaterial;
    this.windowKey = '';
  }

  /** Rebuild chunks when the focus crosses a cell boundary, and advance the wind clock. */
  update(focus: Vec2, time: number): void {
    this.time.value = time;
    if (this.capacity === 0) return;
    const key = `${windowKey(focus, this.quality.grassRadius)}|${this.fog ? this.fog.version : '-'}`;
    if (key === this.windowKey && this.grassMesh) return;
    this.windowKey = key;
    const tufts = collectGrass(this.hf, this.quality, focus, this.fog?.visibility);
    const blades: GrassTuft[] = [];
    const flowers: GrassTuft[] = [];
    for (const tuft of tufts) {
      if (tuft.kind === 'flower') flowers.push(tuft);
      else blades.push(tuft);
    }
    this.grassMesh = this.fill(this.grassMesh, grassGeometry, this.grassMat, blades, 'grass');
    this.flowerMesh = this.fill(this.flowerMesh, flowerGeometry, this.flowerMat, flowers, 'flowers');
  }

  private fill(
    mesh: THREE.InstancedMesh | null,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    tufts: GrassTuft[],
    name: string,
  ): THREE.InstancedMesh {
    const cap = Math.max(this.capacity, tufts.length, 1);
    if (!mesh || mesh.instanceMatrix.count < cap) {
      if (mesh) this.object.remove(mesh);
      const geo = geometry.clone();
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      mesh = new THREE.InstancedMesh(geo, material, cap);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial;
      mesh.count = 0;
      this.object.add(mesh);
    }
    const n = Math.min(tufts.length, mesh.instanceMatrix.count);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const tint = mesh.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < n; i++) {
      const tuft = tufts[i];
      dummy.position.set(tuft.x, tuft.y, tuft.z);
      dummy.rotation.set(0, tuft.yaw, 0);
      dummy.scale.set(tuft.scale, tuft.scale * tuft.tall, tuft.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setRGB(tuft.color.r, tuft.color.g, tuft.color.b, THREE.SRGBColorSpace);
      tint.setXYZ(i, color.r, color.g, color.b);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    tint.needsUpdate = true;
    return mesh;
  }
}

function windowKey(focus: Vec2, radius: number): string {
  const cx0 = Math.floor((focus.x - radius) / GRASS_CELL);
  const cx1 = Math.floor((focus.x + radius) / GRASS_CELL);
  const cz0 = Math.floor((focus.z - radius) / GRASS_CELL);
  const cz1 = Math.floor((focus.z + radius) / GRASS_CELL);
  return `${cx0}:${cx1}:${cz0}:${cz1}`;
}

function hash01(a: number, b: number, c: number): number {
  let n = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function windMaterial(kind: 'grass' | 'flower', time: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  // Root-to-tip tint stays within the ground tint's own range: a slightly cooler root,
  // a slightly straw-lit tip, no near-black multiplier.
  const tint =
    kind === 'grass'
      ? 'vColor.rgb = aTint * mix(vec3(0.82, 0.86, 0.76), vec3(0.96, 1.0, 0.84), uv.y);'
      : 'vColor.rgb = mix(vec3(0.42, 0.52, 0.3), aTint, smoothstep(0.4, 0.62, uv.y));';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    // Blades are thin double-sided quads; their own face normals leave the back half of
    // every tuft unlit by the sun. Light them mostly with the ground's up normal, keeping a
    // small share of the blade's own horizontal lean so tufts read as 3D rather than flat
    // cutouts, and skip the double-sided flip so both faces shade like the meadow beneath.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
objectNormal = normalize(vec3(objectNormal.x * 0.2, 1.0, objectNormal.z * 0.2));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vNormal );
vec3 nonPerturbedNormal = normal;`,
    );
    shader.vertexShader =
      /* glsl */ `
uniform float uTime;
attribute vec3 aTint;
float agHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float agNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(agHash(i), agHash(i + vec2(1.0, 0.0)), f.x), mix(agHash(i + vec2(0.0, 1.0)), agHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_COLOR
${tint}
#endif
{
#ifdef USE_INSTANCING
  vec3 wpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vec3 wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
  float gust = agNoise(wpos.xz * 0.1 + vec2(uTime * 0.38, uTime * 0.07));
  float travel = agNoise(wpos.xz * 0.045 + vec2(-uTime * 0.16, uTime * 0.11));
  float tip = uv.y * uv.y;
  float amp = tip * (0.16 + 0.42 * travel);
  transformed.x += (gust - 0.5) * amp;
  transformed.z += (travel - 0.5) * amp * 0.75;
}`,
    );
  };
  return material;
}

function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const blades = 3;
  for (let i = 0; i < blades; i++) {
    const yaw = (i / blades) * Math.PI;
    const h = 0.26 + (i % 2) * 0.06;
    const w = 0.04;
    const lean = 0.04 + i * 0.02;
    quad(
      positions,
      uvs,
      colors,
      yaw,
      [
        [-w, 0, 0],
        [w, 0, 0],
        [w * 0.28 + lean, h, 0.02],
        [-w * 0.28 + lean, h, -0.01],
      ],
      [1, 1, 1],
    );
  }
  return finishGeometry(positions, uvs, colors);
}

function bloomGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  quad(
    positions,
    uvs,
    colors,
    0,
    [
      [-0.012, 0, 0],
      [0.012, 0, 0],
      [0.012, 0.46, 0],
      [-0.012, 0.46, 0],
    ],
    [1, 1, 1],
    0,
    0.42,
  );
  for (let i = 0; i < 3; i++) {
    const yaw = (i / 3) * Math.PI;
    quad(
      positions,
      uvs,
      colors,
      yaw,
      [
        [-0.09, 0.4, 0],
        [0.09, 0.4, 0],
        [0.045, 0.68, 0.02],
        [-0.045, 0.68, -0.01],
      ],
      [1, 1, 1],
      0.72,
      1,
    );
  }
  return finishGeometry(positions, uvs, colors);
}

function quad(
  positions: number[],
  uvs: number[],
  colors: number[],
  yaw: number,
  corners: [number, number, number][],
  color: [number, number, number],
  uvBottom = 0,
  uvTop = 1,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rot = (p: [number, number, number]): [number, number, number] => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
  const [a, b, d, e] = corners.map(rot) as [number, number, number][];
  const tris: [number, number, number][] = [
    [0, 0, uvBottom],
    [1, 1, uvBottom],
    [2, 1, uvTop],
    [0, 0, uvBottom],
    [2, 1, uvTop],
    [3, 0, uvTop],
  ];
  const pts = [a, b, d, e];
  for (const [pi, uu, vv] of tris) {
    const p = pts[pi];
    positions.push(p[0], p[1], p[2]);
    uvs.push(uu, vv);
    colors.push(color[0], color[1], color[2]);
  }
}

function finishGeometry(positions: number[], uvs: number[], colors: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
