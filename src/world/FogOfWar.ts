import * as THREE from 'three';

const SHROUD = 'vec3(0.025, 0.03, 0.04)';
const EXPLORED_DIM = 0.34;

/**
 * RTS fog of war: unexplored cells are black, explored-but-unseen cells
 * stay dim, and tiles around units light up as they walk.
 */
export class FogOfWar {
  readonly texture: THREE.DataTexture;

  private explored: Uint8Array;
  private visible: Float32Array;
  private pixels: Uint8Array;
  private dirty = true;

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.explored = new Uint8Array(width * height);
    this.visible = new Float32Array(width * height);
    this.pixels = new Uint8Array(width * height * 4);

    this.texture = new THREE.DataTexture(this.pixels, width, height, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  clearVisibility(): void {
    this.visible.fill(0);
    this.dirty = true;
  }

  /** Reveal a soft circle of current vision and permanently mark those cells explored. */
  reveal(wx: number, wz: number, radius: number): void {
    const x0 = Math.max(0, Math.floor(wx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(wx + radius));
    const z0 = Math.max(0, Math.floor(wz - radius));
    const z1 = Math.min(this.height - 1, Math.ceil(wz + radius));

    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - wx, z + 0.5 - wz);
        if (d > radius) continue;
        const t = 1 - d / radius;
        const vis = t * t * (3 - 2 * t);
        const i = z * this.width + x;
        this.explored[i] = 1;
        if (vis > this.visible[i]) this.visible[i] = vis;
      }
    }
    this.dirty = true;
  }

  isExplored(wx: number, wz: number): boolean {
    const x = Math.floor(wx);
    const z = Math.floor(wz);
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return false;
    return this.explored[z * this.width + x] !== 0;
  }

  isVisible(wx: number, wz: number): boolean {
    const x = Math.floor(wx);
    const z = Math.floor(wz);
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return false;
    return this.visible[z * this.width + x] > 0.18;
  }

  upload(): void {
    if (!this.dirty) return;
    const { width: w, height: h, pixels, explored, visible } = this;
    for (let i = 0, n = w * h; i < n; i++) {
      const o = i * 4;
      pixels[o] = explored[i] ? 255 : 0;
      pixels[o + 1] = Math.min(255, Math.round(visible[i] * 255));
      pixels[o + 2] = 0;
      pixels[o + 3] = 255;
    }
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  attachToObject(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) this.attachToMaterial(mat);
    });
  }

  attachToMaterial(material: THREE.Material): void {
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev.call(material, shader, renderer);
      this.inject(shader);
    };
    const prevKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${prevKey()}|fow`;
    material.needsUpdate = true;
  }

  private inject(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uFogMap = { value: this.texture };
    shader.uniforms.uMapSize = { value: new THREE.Vector2(this.width, this.height) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vFowWorld;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         {
           vec4 fowPos = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
           fowPos = instanceMatrix * fowPos;
           #endif
           vFowWorld = (modelMatrix * fowPos).xyz;
         }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vFowWorld;
         uniform sampler2D uFogMap;
         uniform vec2 uMapSize;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           vec2 fuv = vec2(vFowWorld.x / uMapSize.x, vFowWorld.z / uMapSize.y);
           vec2 fog = texture2D(uFogMap, clamp(fuv, 0.0, 1.0)).rg;
           float reveal = max(fog.g, fog.r * ${EXPLORED_DIM.toFixed(2)});
           gl_FragColor.rgb = mix(${SHROUD}, gl_FragColor.rgb, reveal);
         }`
      );
  }
}
