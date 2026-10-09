import * as THREE from 'three';
import { MAP_D, MAP_W } from '../core/types';
import { SKY_HORIZON, SKY_TOP, SUN_COLOR } from './palette';

/**
 * WebGL renderer, scene, lights, sky and fog. Owned by the Render lane (T4).
 * Public surface FROZEN: constructor, scene, domElement, setSize, render.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  private readonly gl: THREE.WebGLRenderer;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl.setClearColor(SKY_HORIZON);
    this.gl.shadowMap.enabled = false;
    container.appendChild(this.gl.domElement);

    this.scene.fog = new THREE.Fog(SKY_HORIZON, 42, 118);
    this.scene.add(buildSky());

    const hemi = new THREE.HemisphereLight(SKY_TOP, 0x4e6238, 0.72);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(SUN_COLOR, 1.15);
    sun.castShadow = false;
    sun.position.set(MAP_W * 0.15, 58, -8);
    sun.target.position.set(MAP_W / 2, 0, MAP_D / 2);
    this.scene.add(sun, sun.target);
  }

  get domElement(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  setSize(width: number, height: number): void {
    this.gl.setSize(width, height);
  }

  render(camera: THREE.Camera): void {
    this.gl.render(this.scene, camera);
  }
}

/** Large inward sphere. Local +Y is up, so the gradient stays world-aligned as it follows the camera. */
function buildSky(): THREE.Mesh {
  const radius = 280;
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY_TOP);
  const horizon = new THREE.Color(SKY_HORIZON);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    const t = smoothstep(-0.04, 0.62, y);
    color.copy(horizon).lerp(top, t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const sky = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrix();
    sky.matrixWorld.copy(sky.matrix);
  };
  return sky;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
