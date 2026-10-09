import * as THREE from 'three';
import { SKY_HORIZON, SKY_TOP, SUN_COLOR } from './palette';

/**
 * WebGL renderer, scene, lights, sky and fog. Owned by the Render lane (T4).
 * Public surface FROZEN: constructor, scene, domElement, setSize, render.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  private readonly gl: THREE.WebGLRenderer;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.gl.setClearColor(SKY_TOP);
    container.appendChild(this.gl.domElement);

    this.scene.fog = new THREE.Fog(SKY_HORIZON, 60, 140);
    this.scene.add(new THREE.HemisphereLight(SKY_TOP, 0x6a7a4a, 0.9));
    const sun = new THREE.DirectionalLight(SUN_COLOR, 1.6);
    sun.position.set(-30, 50, 20);
    this.scene.add(sun);
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
