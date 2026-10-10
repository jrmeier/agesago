import * as THREE from 'three';
import { SKY_HORIZON, SKY_TOP } from './palette';

/** Late-afternoon elevation, radians. Low enough for long shadows. */
export const SUN_ELEVATION = 0.34;
/** Azimuth of the sun, radians. Direction is from the ground toward the sun. */
export const SUN_AZIMUTH = -0.95;

/** Unit vector from the ground toward the late-afternoon sun. */
export function sunDirection(target = new THREE.Vector3()): THREE.Vector3 {
  const ce = Math.cos(SUN_ELEVATION);
  return target.set(ce * Math.sin(SUN_AZIMUTH), Math.sin(SUN_ELEVATION), ce * Math.cos(SUN_AZIMUTH)).normalize();
}

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
varying vec3 vDir;

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
float agFbm(vec2 p) {
  return agNoise(p) * 0.65 + agNoise(p * 2.05 + 4.1) * 0.35;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float t = smoothstep(-0.12, 0.55, h);
  vec3 col = mix(uHorizon, uZenith, t);
  float band = exp(-abs(h) * 3.2);
  col = mix(col, uHorizon * vec3(1.04, 0.99, 0.9), band * 0.35);
  float below = 1.0 - smoothstep(-0.5, -0.02, h);
  col = mix(col, mix(uHorizon, uZenith, 0.42), below * 0.55);

  float sun = dot(dir, normalize(uSunDir));
  float disc = smoothstep(0.9978, 0.9994, sun);
  float glow = pow(max(sun, 0.0), 72.0);
  float halo = pow(max(sun, 0.0), 7.0);
  col += vec3(1.0, 0.9, 0.7) * halo * 0.14;
  col += vec3(1.0, 0.92, 0.74) * glow * 0.5;
  col += vec3(1.0, 0.97, 0.88) * disc;

  float skyMask = smoothstep(-0.06, 0.16, h);
  vec2 cuv = dir.xz / max(h, 0.08);
  vec2 drift = vec2(uTime * 0.012, uTime * 0.004);
  float c = agFbm(cuv * 1.35 + drift);
  float clouds = smoothstep(0.56, 0.78, c) * skyMask;
  vec3 cloudLit = mix(uHorizon, vec3(1.0), 0.55);
  col = mix(col, cloudLit, clouds * 0.62);
  float shade = smoothstep(0.5, 0.7, agFbm(cuv * 1.35 + drift + vec2(0.18, -0.06)));
  col = mix(col, col * vec3(0.84, 0.84, 0.86), shade * clouds * 0.4);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Inward sky dome: Aegean blue zenith, pale limestone horizon, a sun disc aligned with
 * {@link sunDirection}, and slow procedural clouds. Follows the camera.
 */
export class Sky {
  readonly object: THREE.Mesh;
  private readonly time: { value: number };
  private readonly sun: { value: THREE.Vector3 };

  constructor() {
    this.time = { value: 0 };
    this.sun = { value: sunDirection() };
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: this.time,
        uSunDir: this.sun,
        uZenith: { value: new THREE.Color(SKY_TOP) },
        uHorizon: { value: new THREE.Color(SKY_HORIZON) },
      },
      vertexShader,
      fragmentShader,
    });
    this.object = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 20), material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1;
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      this.object.position.copy(camera.position);
      this.object.updateMatrix();
      this.object.matrixWorld.copy(this.object.matrix);
    };
  }

  /** Advance the cloud drift. `time` is seconds. */
  update(time: number): void {
    this.time.value = time;
  }
}
