import * as THREE from 'three';
import { detectQuality, type Quality } from '../core/quality';
import { MAP_D, MAP_W, type Vec2 } from '../core/types';
import { FOG_COLOR, SKY_HORIZON, SUN_COLOR } from './palette';
import { Sky, sunDirection } from './Sky';

const SHADOW_EXTENT = 35;

/**
 * WebGL renderer, scene, soft gold sun, cool sky fill, limestone haze, and sky dome.
 * `update(focus, time)` follows the camera with the shadow map and drifts the clouds.
 * If a frame reaches `render` without `update`, the sun follows the camera and the
 * sky clock advances on its own so the current game loop still moves.
 * Public: constructor(container, quality?), scene, sun, webgl, domElement, setSize, update, render.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly webgl: THREE.WebGLRenderer;
  private readonly sky: Sky;
  private readonly quality: Quality;
  private readonly toSun = sunDirection();
  private readonly focus = { x: MAP_W / 2, z: MAP_D / 2 };
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly snapped = new THREE.Vector3();
  private time = 0;
  private lastNow = 0;
  private posed = false;

  constructor(container: HTMLElement, quality: Quality = detectQuality()) {
    this.quality = quality;
    this.webgl = new THREE.WebGLRenderer({
      antialias: quality.tier !== 'low',
      alpha: false,
    });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.2;
    this.webgl.shadowMap.enabled = quality.shadows;
    // r185 deprecates PCFSoftShadowMap and implements the soft filter as PCFShadowMap.
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.setClearColor(SKY_HORIZON);
    container.appendChild(this.webgl.domElement);

    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0085);

    this.sky = new Sky();
    this.scene.add(this.sky.object);

    // Cool open-sky fill from above, neutral earth bounce from below, so shade reads
    // as blue-grey daylight rather than orange murk.
    const hemi = new THREE.HemisphereLight(0xb9c9de, 0x8a7f6a, 1.25);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(SUN_COLOR, 2.15);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.intensity = 0.88;
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.sun.shadow.bias = -0.00035;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 2;
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -SHADOW_EXTENT;
      cam.right = SHADOW_EXTENT;
      cam.top = SHADOW_EXTENT;
      cam.bottom = -SHADOW_EXTENT;
      cam.near = 0.5;
      cam.far = 220;
      cam.updateProjectionMatrix();
    }
    this.scene.add(this.sun, this.sun.target);
    this.applyFrame();
  }

  get domElement(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  setSize(width: number, height: number): void {
    this.webgl.setSize(width, height);
  }

  /** Point the shadow frustum at `focus` and advance clouds. `time` is seconds. */
  update(focus: Vec2, time: number): void {
    this.focus.x = focus.x;
    this.focus.z = focus.z;
    this.time = time;
    this.posed = true;
    this.applyFrame();
  }

  render(camera: THREE.Camera): void {
    if (!this.posed) {
      const now = performance.now() / 1000;
      if (this.lastNow > 0) this.time += Math.min(0.05, Math.max(0, now - this.lastNow));
      this.lastNow = now;
      this.focus.x = camera.position.x;
      this.focus.z = camera.position.z;
      this.applyFrame();
    }
    this.posed = false;
    this.webgl.render(this.scene, camera);
  }

  private applyFrame(): void {
    this.sky.update(this.time);
    if (!this.quality.shadows || this.quality.shadowMapSize <= 0) {
      this.sun.position.set(this.focus.x, 0, this.focus.z).addScaledVector(this.toSun, 110);
      this.sun.target.position.set(this.focus.x, 0, this.focus.z);
      return;
    }
    this.followShadow();
  }

  /** Keep a 70-unit ortho shadow map on the focus, snapped to the texel grid. */
  private followShadow(): void {
    const sun = this.sun;
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    sun.target.position.set(this.focus.x, 0, this.focus.z);
    sun.position.set(this.focus.x, 0, this.focus.z).addScaledVector(this.toSun, 110);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();

    cam.position.copy(sun.position);
    cam.lookAt(sun.target.position);
    cam.updateMatrixWorld();

    const texel = (SHADOW_EXTENT * 2) / this.quality.shadowMapSize;
    const e = cam.matrixWorld.elements;
    this.camRight.set(e[0], e[1], e[2]);
    this.camUp.set(e[4], e[5], e[6]);
    this.camForward.set(e[8], e[9], e[10]);

    const pos = cam.position;
    let cx = Math.round(pos.dot(this.camRight) / texel) * texel;
    let cy = Math.round(pos.dot(this.camUp) / texel) * texel;
    const cz = pos.dot(this.camForward);
    this.snapped
      .set(0, 0, 0)
      .addScaledVector(this.camRight, cx)
      .addScaledVector(this.camUp, cy)
      .addScaledVector(this.camForward, cz)
      .sub(pos);
    sun.position.add(this.snapped);
    sun.target.position.add(this.snapped);
  }
}
