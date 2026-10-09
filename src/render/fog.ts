import * as THREE from 'three';
import type { Quality } from '../core/quality';
import { EXPLORED, VISIBLE, type Visibility } from '../sim/visibility';

/** Target brightness for an explored-but-out-of-sight cell. */
export const FOG_EXPLORED = 0.45;
/** Seconds for a cell to finish fading toward its new brightness. */
export const FOG_FADE_SECONDS = 0.4;

const DESATURATE = 0.4;
const HIDE_CUT = 0.36;

export interface FogPatchOptions {
  /** Drop fragments (and shadows) while the object's cell is still unexplored. */
  hideUnexplored?: boolean;
  /** Shadow-depth pass: discard only, leave the packed depth colour alone. */
  depth?: boolean;
}

interface FogShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/**
 * AoE-style fog of war for the view.
 *
 * `texture` is an R8 map of target brightness (0 unexplored, ~0.45 explored, 1 visible),
 * uploaded only when `visibility.version` changes. A second texture plus `uFogBlend`
 * fades each cell over {@link FOG_FADE_SECONDS} without uploading every frame.
 * Low quality uses the same textures and skips the animated edge warp.
 *
 * Wire-up in Game (integrator), after the views exist:
 * ```
 * this.fog = new FogOfWar(this.world.visibility, this.quality);
 * this.terrain.setFog(this.fog);
 * this.props.setFog(this.fog);
 * this.grass.setFog(this.fog);
 * this.views.setFog(this.fog);
 * ```
 * Each frame, after `world.tick` and before render:
 * ```
 * this.fog.update(dt);
 * this.props.syncFog();
 * this.grass.update(focus, time); // already in the loop; skips unexplored tufts
 * this.views.sync(...);           // already calls syncFog
 * ```
 */
export class FogOfWar {
  /** Target brightness, R8, one texel per visibility cell. */
  readonly texture: THREE.DataTexture;
  /** Brightness the fade is leaving. Mixed toward `texture` by `uniforms.uFogBlend`. */
  readonly fromTexture: THREE.DataTexture;
  readonly uniforms: {
    uFogMap: { value: THREE.Texture };
    uFogFrom: { value: THREE.Texture };
    uFogSize: { value: THREE.Vector2 };
    uFogBlend: { value: number };
    uFogTime: { value: number };
  };
  /** True on the phone tier: same mask, no animated warp. */
  readonly cheap: boolean;
  private readonly fromF: Float32Array;
  private readonly targetF: Float32Array;
  private readonly fromBytes: Uint8Array;
  private readonly toBytes: Uint8Array;
  private blend = 1;
  private uploadedVersion = -1;
  private time = 0;

  constructor(
    readonly visibility: Visibility,
    quality?: Pick<Quality, 'tier'>,
  ) {
    this.cheap = quality?.tier === 'low';
    const n = visibility.state.length;
    this.fromF = new Float32Array(n);
    this.targetF = new Float32Array(n);
    this.fromBytes = new Uint8Array(n);
    this.toBytes = new Uint8Array(n);
    this.fromTexture = fogTexture(this.fromBytes, visibility.cols, visibility.rows);
    this.texture = fogTexture(this.toBytes, visibility.cols, visibility.rows);
    this.uniforms = {
      uFogMap: { value: this.texture },
      uFogFrom: { value: this.fromTexture },
      uFogSize: { value: new THREE.Vector2(visibility.cols, visibility.rows) },
      uFogBlend: { value: 0 },
      uFogTime: { value: 0 },
    };
  }

  get version(): number {
    return this.visibility.version;
  }

  /**
   * Advance the fade. Copies `visibility.state` into the textures only when `version` changes.
   * `dt` is seconds.
   */
  update(dt: number): void {
    if (this.visibility.version !== this.uploadedVersion) this.commit();
    const step = Math.max(0, dt) / FOG_FADE_SECONDS;
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + step);
      this.uniforms.uFogBlend.value = this.blend;
    }
    if (!this.cheap) {
      this.time += Math.max(0, dt);
      this.uniforms.uFogTime.value = this.time;
    }
  }

  /** Displayed brightness at a world position, 0..1, after the current fade. */
  brightnessAt(x: number, z: number): number {
    const col = Math.floor(x);
    const row = Math.floor(z);
    const { cols, rows } = this.visibility;
    if (col < 0 || row < 0 || col >= cols || row >= rows) return 0;
    const i = row * cols + col;
    return this.fromF[i] + (this.targetF[i] - this.fromF[i]) * this.blend;
  }

  private commit(): void {
    const state = this.visibility.state;
    const blend = this.blend;
    for (let i = 0; i < state.length; i++) {
      const shown = this.fromF[i] + (this.targetF[i] - this.fromF[i]) * blend;
      this.fromF[i] = shown;
      this.fromBytes[i] = quantize(shown);
      const target = targetBrightness(state[i]);
      this.targetF[i] = target;
      this.toBytes[i] = quantize(target);
    }
    this.blend = 0;
    this.uniforms.uFogBlend.value = 0;
    this.uploadedVersion = this.visibility.version;
    this.fromTexture.needsUpdate = true;
    this.texture.needsUpdate = true;
  }
}

/** 0 unexplored, {@link FOG_EXPLORED} explored, 1 visible. */
export function targetBrightness(state: number): number {
  if (state === VISIBLE) return 1;
  if (state === EXPLORED) return FOG_EXPLORED;
  return 0;
}

/** Resource nodes, stumps, props and grass on an unexplored cell must not draw. */
export function isConcealed(visibility: Visibility, x: number, z: number): boolean {
  return !visibility.isExplored(x, z);
}

/** Copy `base`, or the same pose with zero scale when the cell is still concealed. */
export function matrixForConcealment(base: THREE.Matrix4, concealed: boolean, out: THREE.Matrix4): THREE.Matrix4 {
  if (!concealed) return out.copy(base);
  base.decompose(scratchPos, scratchQuat, scratchScale);
  scratchDummy.position.copy(scratchPos);
  scratchDummy.quaternion.copy(scratchQuat);
  scratchDummy.scale.set(0, 0, 0);
  scratchDummy.updateMatrix();
  return out.copy(scratchDummy.matrix);
}

const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchDummy = new THREE.Object3D();

/**
 * Chain fog into a material's shader. Existing `onBeforeCompile` hooks (terrain splat,
 * water, grass wind) run first. Instanced meshes sample fog at `instanceMatrix`.
 */
export function applyFog(material: THREE.Material, fog: FogOfWar, options: FogPatchOptions = {}): void {
  if (material.userData.agFog) return;
  material.userData.agFog = 1;
  const hide = options.hideUnexplored === true;
  const depth = options.depth === true;
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(material, shader, renderer);
    patchFogShader(shader as FogShader, fog, hide, depth);
  };
  material.customProgramCacheKey = function () {
    return `${prevKey()}|${prevCompile.toString()}|agfog|h${hide ? 1 : 0}|d${depth ? 1 : 0}|c${fog.cheap ? 1 : 0}`;
  };
  material.needsUpdate = true;
}

/** Depth material that discards unexplored instances so they cast no shadow. */
export function createFogDepthMaterial(fog: FogOfWar): THREE.MeshDepthMaterial {
  const depth = new THREE.MeshDepthMaterial();
  applyFog(depth, fog, { hideUnexplored: true, depth: true });
  return depth;
}

function patchFogShader(shader: FogShader, fog: FogOfWar, hide: boolean, depth: boolean): void {
  shader.uniforms.uFogMap = fog.uniforms.uFogMap;
  shader.uniforms.uFogFrom = fog.uniforms.uFogFrom;
  shader.uniforms.uFogSize = fog.uniforms.uFogSize;
  shader.uniforms.uFogBlend = fog.uniforms.uFogBlend;
  if (!fog.cheap) shader.uniforms.uFogTime = fog.uniforms.uFogTime;

  shader.vertexShader = varyings + injectVertex(shader.vertexShader);
  shader.fragmentShader = fragmentPrelude(fog.cheap) + shader.fragmentShader;
  if (hide) {
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {\n${concealBody(fog.cheap)}`);
  }
  if (!depth) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      `${colorBody(fog.cheap)}\n#include <tonemapping_fragment>`,
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FOG_FRAGMENT);
  }
}

const varyings = /* glsl */ `
varying vec3 vFogWorld;
varying vec3 vFogAnchor;
`;

const VERTEX_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  vFogAnchor = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFogWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#elif defined(USE_BATCHING)
  vFogAnchor = (modelMatrix * batchingMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFogWorld = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
#else
  vFogAnchor = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

function injectVertex(src: string): string {
  if (src.includes('#include <project_vertex>')) {
    return src.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
  }
  if (src.includes('vWorld = world.xyz;')) {
    return src.replace('vWorld = world.xyz;', 'vWorld = world.xyz;\n  vFogWorld = vWorld;\n  vFogAnchor = vWorld;');
  }
  return src.replace('void main() {', `void main() {\n${VERTEX_BODY}`);
}

function fragmentPrelude(cheap: boolean): string {
  const noise = cheap
    ? ''
    : /* glsl */ `
float agFogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float agFogNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(agFogHash(i), agFogHash(i + vec2(1.0, 0.0)), f.x),
             mix(agFogHash(i + vec2(0.0, 1.0)), agFogHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
  const sample = cheap
    ? /* glsl */ `
  vec2 uv = clamp(xz / agSize, vec2(0.0), vec2(1.0));
`
    : /* glsl */ `
  vec2 uv = xz / agSize;
  float n1 = agFogNoise(xz * 0.09 + vec2(uFogTime * 0.017, 2.3));
  float n2 = agFogNoise(xz * 0.09 + vec2(-1.7, -uFogTime * 0.013));
  uv += (vec2(n1, n2) - 0.5) * (1.7 / agSize);
  uv = clamp(uv, vec2(0.0), vec2(1.0));
`;
  return /* glsl */ `
#define AG_FOG_CHEAP ${cheap ? 1 : 0}
uniform sampler2D uFogMap;
uniform sampler2D uFogFrom;
uniform vec2 uFogSize;
uniform float uFogBlend;
${cheap ? '' : 'uniform float uFogTime;'}
varying vec3 vFogWorld;
varying vec3 vFogAnchor;
float agFogBright = 1.0;
${noise}
float agFogSample(vec2 xz) {
  vec2 agSize = max(uFogSize, vec2(1.0));
  ${sample}
  return mix(texture2D(uFogFrom, uv).r, texture2D(uFogMap, uv).r, uFogBlend);
}
`;
}

function concealBody(cheap: boolean): string {
  if (cheap) return `  if (agFogSample(vFogAnchor.xz) < ${HIDE_CUT.toFixed(2)}) discard;\n`;
  return /* glsl */ `
  {
    float agAnchor = agFogSample(vFogAnchor.xz);
    float agReveal = smoothstep(0.2, 0.42, agAnchor);
    if (agReveal < 0.999 && agFogHash(gl_FragCoord.xy) > agReveal) discard;
  }
`;
}

function colorBody(cheap: boolean): string {
  const parchment = cheap
    ? ''
    : /* glsl */ `
  float agFiber = agFogNoise(vFogWorld.xz * 0.085);
  float agGrain = agFogNoise(vFogWorld.xz * 0.27 + vec2(4.2, 1.1));
  agShroud += vec3(0.026, 0.018, 0.010) * agFiber + vec3(0.006, 0.008, 0.014) * agGrain;
`;
  return /* glsl */ `
  /* ag-fog */
  agFogBright = agFogSample(vFogWorld.xz);
  {
    vec3 agRgb = gl_FragColor.rgb;
    float agLuma = dot(agRgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 agExplored = mix(vec3(agLuma), agRgb, ${DESATURATE.toFixed(1)}) * ${FOG_EXPLORED.toFixed(2)};
    vec3 agShroud = vec3(0.012, 0.016, 0.030);
    ${parchment}
    float agDist = smoothstep(16.0, 82.0, distance(cameraPosition.xz, vFogWorld.xz));
    agShroud = mix(agShroud, vec3(0.105, 0.064, 0.040), agDist);
    float agSeen = smoothstep(0.0, 0.42, agFogBright);
    float agSight = smoothstep(0.42, 0.98, agFogBright);
    agRgb = mix(mix(agShroud, agExplored, agSeen), agRgb, agSight);
    gl_FragColor.rgb = agRgb;
    gl_FragColor.a = mix(max(gl_FragColor.a, 0.9), gl_FragColor.a, agSeen);
  }
`;
}

/** Scene haze: unexplored ground fades to a dark warm brown instead of a black hole. */
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec3 agHaze = mix(vec3(0.102, 0.062, 0.040), fogColor, smoothstep(0.18, 0.75, agFogBright));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, agHaze, fogFactor);
#endif
`;

function fogTexture(data: Uint8Array, cols: number, rows: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.generateMipmaps = false;
  return tex;
}

function quantize(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
