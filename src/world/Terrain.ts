import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Biome, HEIGHT_SCALE, Landscape } from './Landscape';
import { WATER_COLOR, WATER_DEEP } from './config';

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Builds and owns the smooth 3D landscape: ground, water, forests and grass. */
export class Terrain {
  readonly group = new THREE.Group();

  /** The ground mesh — used for move-target picking via raycast. */
  ground!: THREE.Mesh;

  private water!: THREE.Mesh;
  private waterGeom!: THREE.PlaneGeometry;
  private waterBaseZ!: Float32Array;
  private wind = { value: 0 };

  constructor(private land: Landscape) {
    this.buildGround();
    this.buildWater();
    this.buildGrass();
  }

  heightAt(x: number, z: number): number {
    return this.land.heightAt(x, z);
  }

  private buildGround(): void {
    const vx = this.land.width + 1;
    const vz = this.land.height + 1;
    const positions = new Float32Array(vx * vz * 3);

    for (let gz = 0; gz < vz; gz++) {
      for (let gx = 0; gx < vx; gx++) {
        const i = (gz * vx + gx) * 3;
        positions[i] = gx;
        positions[i + 1] = this.land.heights[gz * vx + gx];
        positions[i + 2] = gz;
      }
    }

    const indices: number[] = [];
    for (let z = 0; z < this.land.height; z++) {
      for (let x = 0; x < this.land.width; x++) {
        const a = z * vx + x;
        const b = a + 1;
        const c = a + vx;
        const d = c + 1;
        indices.push(a, c, b, c, d, b);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    // Height/slope/moisture-based vertex colors + tiling UVs for the detail map.
    const normals = geom.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(vx * vz * 3);
    const uvs = new Float32Array(vx * vz * 2);
    const grassDry = new THREE.Color(0x84ab52);
    const grassLush = new THREE.Color(0x5f9d3f);
    const sand = new THREE.Color(0xe0cd93);
    const rock = new THREE.Color(0x9a9182);
    const c = new THREE.Color();
    const wl = this.land.waterLevel;

    for (let gz = 0; gz < vz; gz++) {
      for (let gx = 0; gx < vx; gx++) {
        const vi = gz * vx + gx;
        const h = positions[vi * 3 + 1];
        const slopeY = normals.getY(vi);
        const m = this.land.moistureAt(gx, gz);

        c.copy(grassDry).lerp(grassLush, m);
        c.lerp(new THREE.Color(0x8f8b4a), smoothstep(HEIGHT_SCALE * 0.45, HEIGHT_SCALE * 0.72, h) * 0.5);
        c.lerp(sand, smoothstep(wl + 0.9, wl + 0.1, h));
        c.lerp(rock, smoothstep(0.9, 0.7, slopeY));

        const jitter = (Math.sin(gx * 12.9 + gz * 78.2) * 0.5 + 0.5) * 0.06 - 0.03;
        colors[vi * 3] = Math.max(0, c.r + jitter);
        colors[vi * 3 + 1] = Math.max(0, c.g + jitter);
        colors[vi * 3 + 2] = Math.max(0, c.b + jitter);

        uvs[vi * 2] = gx;
        uvs[vi * 2 + 1] = gz;
      }
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const detail = this.makeGroundDetail();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detail,
      roughness: 0.97,
      metalness: 0,
    });
    this.ground = new THREE.Mesh(geom, mat);
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    this.group.add(this.ground);
  }

  private buildWater(): void {
    this.waterGeom = new THREE.PlaneGeometry(this.land.width, this.land.height, 64, 44);
    const pos = this.waterGeom.attributes.position as THREE.BufferAttribute;
    this.waterBaseZ = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) this.waterBaseZ[i] = pos.getZ(i);

    const mat = new THREE.MeshStandardMaterial({
      color: WATER_COLOR,
      roughness: 0.15,
      metalness: 0.5,
      transparent: true,
      opacity: 0.85,
    });
    this.water = new THREE.Mesh(this.waterGeom, mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(this.land.width / 2, this.land.waterLevel, this.land.height / 2);
    this.water.receiveShadow = true;
    this.group.add(this.water);

    // Darker underlay so deep water reads with depth.
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(this.land.width, this.land.height),
      new THREE.MeshBasicMaterial({ color: WATER_DEEP })
    );
    under.rotation.x = -Math.PI / 2;
    under.position.set(this.land.width / 2, this.land.waterLevel - 0.35, this.land.height / 2);
    this.group.add(under);
  }

  /** A tiled, slightly warm detail texture that multiplies the biome vertex colors. */
  private makeGroundDetail(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgb(214, 208, 190)';
    ctx.fillRect(0, 0, 128, 128);

    // Mottled patches for organic variation.
    for (let i = 0; i < 900; i++) {
      const v = 150 + Math.floor(Math.random() * 105);
      ctx.fillStyle = `rgba(${v}, ${v - 6}, ${v - 20}, 0.5)`;
      const r = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.arc(Math.random() * 128, Math.random() * 128, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Faint blade streaks for a grassy feel.
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      ctx.strokeStyle = `rgba(120, 150, 110, 0.28)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() * 4 - 2), y - 3 - Math.random() * 3);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.6, 0.6);
    tex.anisotropy = 8;
    return tex;
  }

  private buildGrass(): void {
    const tex = this.makeGrassTexture();
    const blade = new THREE.PlaneGeometry(0.6, 0.55);
    blade.translate(0, 0.275, 0);
    const blade2 = blade.clone();
    blade2.rotateY(Math.PI / 2);
    const tuft = mergeGeometries([blade, blade2])!;

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 1,
      emissive: new THREE.Color(0x3a6b24),
      emissiveIntensity: 0.55,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.wind;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
           float ph = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.4;
           float sway = sin(uTime * 1.6 + ph) * 0.14 + sin(uTime * 3.1 + ph) * 0.05;
           transformed.x += sway * max(position.y, 0.0);
           #endif`
        );
    };

    const spots: { x: number; z: number }[] = [];
    for (let z = 0; z < this.land.height; z++) {
      for (let x = 0; x < this.land.width; x++) {
        const b = this.land.biome[z * this.land.width + x];
        if (b !== Biome.Grass && b !== Biome.Forest) continue;
        const n = ((x * 3 + z * 5) % 4) + 1; // 1..4 tufts per cell
        for (let k = 0; k < n; k++) spots.push({ x, z });
      }
    }

    const mesh = new THREE.InstancedMesh(tuft, mat, spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach((s, i) => {
      const hx = (Math.sin(s.x * 12.1 + s.z * 4.7 + i) * 0.5 + 0.5);
      const hz = (Math.sin(s.x * 7.3 + s.z * 9.1 + i * 1.7) * 0.5 + 0.5);
      const wx = s.x + hx;
      const wz = s.z + hz;
      const y = this.land.heightAt(wx, wz);
      const sc = 0.7 + hx * 0.7;
      dummy.position.set(wx, y, wz);
      dummy.scale.set(sc, sc * (0.9 + hz * 0.5), sc);
      dummy.rotation.set(0, hx * Math.PI, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private makeGrassTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    const blades = 8;
    for (let i = 0; i < blades; i++) {
      const x = 5 + (i / blades) * 54 + Math.random() * 4;
      const g = 165 + Math.floor(Math.random() * 70);
      ctx.strokeStyle = `rgb(${70 + Math.random() * 40}, ${g}, ${55 + Math.random() * 30})`;
      ctx.lineWidth = 2 + Math.random() * 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.quadraticCurveTo(x + (Math.random() * 10 - 5), 34, x + (Math.random() * 14 - 7), 5);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(time: number): void {
    this.wind.value = time;

    const pos = this.waterGeom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const wave = Math.sin(x * 0.5 + time * 1.3) * 0.05 + Math.cos(y * 0.6 + time * 1.0) * 0.04;
      pos.setZ(i, this.waterBaseZ[i] + wave);
    }
    pos.needsUpdate = true;
    this.waterGeom.computeVertexNormals();
  }
}
