import * as THREE from 'three';
import type { Rank } from '../core/types';

/**
 * Veterancy visuals (M15-2): pooled billboard chevrons over Advanced and Elite soldiers, and a
 * short sparkle where a unit was promoted. Same begin / push / end pattern as the HP bars, so a
 * frame costs two instanced draws for chevrons and one for sparkles, with nothing allocated.
 */

/** Advanced: silver. Elite: gold. */
export const CHEVRON_ADVANCED = 0xdfe6ee;
export const CHEVRON_ELITE = 0xf4c542;

/** Seconds a promotion sparkle lasts. */
export const PROMOTION_SECONDS = 1.1;
/** Sparkle motes per promotion. */
export const SPARKLES = 6;

const CHEVRON_CAP = 512;
const SPARKLE_CAP = 16 * SPARKLES;
/** Vertical gap between the two Elite chevrons, as a fraction of the chevron width. */
const STACK = 0.34;

/** Chevrons drawn over a unit of `rank`. */
export function chevronCount(rank: Rank | undefined): number {
  return rank === 2 ? 2 : rank === 1 ? 1 : 0;
}

export function chevronColor(rank: Rank): number {
  return rank === 2 ? CHEVRON_ELITE : CHEVRON_ADVANCED;
}

/**
 * Chevron width in world units for a camera `distance` away. Grows with distance so a mark stays
 * readable at RTS zoom, and shrinks up close so it stays small in first person.
 */
export function chevronSize(distance: number): number {
  const s = distance * 0.0125;
  return s < 0.16 ? 0.16 : s > 0.55 ? 0.55 : s;
}

/** Shape of a promotion sparkle `age` seconds in; null once it is over. */
export function promotionGlow(age: number): { rise: number; spread: number; scale: number; intensity: number } | null {
  if (age < 0 || age >= PROMOTION_SECONDS) return null;
  const t = age / PROMOTION_SECONDS;
  return {
    rise: 0.2 + 1.3 * t,
    spread: 0.25 + 0.35 * t,
    scale: 0.22 * (1 - 0.5 * t),
    // Quick flash in, slower fade out.
    intensity: t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85,
  };
}

/** An upward chevron centred on the origin, 1 wide, in the XY plane. */
export function chevronGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.12);
  shape.lineTo(0, 0.24);
  shape.lineTo(0.5, -0.12);
  shape.lineTo(0.5, -0.32);
  shape.lineTo(0, 0.04);
  shape.lineTo(-0.5, -0.32);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.translate(0, 0.04, 0);
  geo.userData.shared = 1;
  return geo;
}

function sparkleGeometry(): THREE.BufferGeometry {
  // A four-pointed star.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.lineTo(0.12, 0.12);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.12, -0.12);
  shape.lineTo(0, -0.5);
  shape.lineTo(-0.12, -0.12);
  shape.lineTo(-0.5, 0);
  shape.lineTo(-0.12, 0.12);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.userData.shared = 1;
  return geo;
}

function overlay(mesh: THREE.InstancedMesh, name: string, order: number): void {
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.userData.noShadow = 1;
  mesh.renderOrder = order;
  mesh.visible = false;
}

export class RankChevrons {
  readonly object = new THREE.Group();
  private readonly back: THREE.InstancedMesh;
  private readonly fill: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly orient = new THREE.Quaternion();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private used = 0;

  constructor(parent: THREE.Object3D) {
    this.object.name = 'rank-chevrons';
    const geo = chevronGeometry();
    const backMat = new THREE.MeshBasicMaterial({
      color: 0x1d140c,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.back = new THREE.InstancedMesh(geo, backMat, CHEVRON_CAP);
    this.fill = new THREE.InstancedMesh(geo, fillMat, CHEVRON_CAP);
    overlay(this.back, 'rank-back', 6);
    overlay(this.fill, 'rank-fill', 7);
    this.object.add(this.back, this.fill);
    parent.add(this.object);
  }

  begin(camera: THREE.Camera): void {
    this.used = 0;
    this.orient.copy(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.orient);
    this.forward.set(0, 0, 1).applyQuaternion(this.orient);
    camera.getWorldPosition(this.eye);
  }

  /** Chevrons for one unit whose mark sits at (x, y, z). Rank 0 adds nothing. */
  push(x: number, y: number, z: number, rank: Rank | undefined): void {
    const n = chevronCount(rank);
    if (n === 0) return;
    const dx = x - this.eye.x;
    const dy = y - this.eye.y;
    const dz = z - this.eye.z;
    const size = chevronSize(Math.sqrt(dx * dx + dy * dy + dz * dz));
    this.color.setHex(chevronColor(rank as Rank));
    for (let k = 0; k < n; k++) {
      if (this.used >= CHEVRON_CAP) return;
      const i = this.used++;
      this.dummy.quaternion.copy(this.orient);
      this.dummy.position.set(x, y, z).addScaledVector(this.up, k * STACK * size);
      this.dummy.scale.set(size * 1.22, size * 1.3, 1);
      this.dummy.updateMatrix();
      this.back.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.addScaledVector(this.forward, 0.01);
      this.dummy.scale.set(size, size, 1);
      this.dummy.updateMatrix();
      this.fill.setMatrixAt(i, this.dummy.matrix);
      this.fill.setColorAt(i, this.color);
    }
  }

  end(): void {
    this.back.count = this.used;
    this.fill.count = this.used;
    const show = this.used > 0;
    this.back.visible = show;
    this.fill.visible = show;
    if (!show) return;
    this.back.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
  }
}

interface Burst {
  x: number;
  y: number;
  z: number;
  born: number;
  color: number;
}

/** Brief rising sparkles where a soldier was promoted. */
export class PromotionSparkles {
  readonly object = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly bursts: Burst[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(parent: THREE.Object3D) {
    this.object.name = 'promotion-sparkles';
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(sparkleGeometry(), mat, SPARKLE_CAP);
    overlay(this.mesh, 'promotion-sparkle', 8);
    this.object.add(this.mesh);
    parent.add(this.object);
  }

  /** Bursts still playing. */
  get active(): number {
    return this.bursts.length;
  }

  /** Start a burst at a unit's feet. The oldest is dropped when the pool is full. */
  burst(x: number, y: number, z: number, rank: Rank, time: number): void {
    if (this.bursts.length * SPARKLES >= SPARKLE_CAP) this.bursts.shift();
    this.bursts.push({ x, y, z, born: time, color: chevronColor(rank) });
  }

  update(time: number, camera: THREE.Camera): void {
    let used = 0;
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      const glow = promotionGlow(time - burst.born);
      if (!glow) {
        this.bursts.splice(b, 1);
        continue;
      }
      // Additive blending: darkening the colour fades the mote.
      this.color.setHex(burst.color).multiplyScalar(glow.intensity);
      for (let k = 0; k < SPARKLES; k++) {
        const a = (k / SPARKLES) * Math.PI * 2 + glow.rise * 1.6;
        const lift = glow.rise * (0.7 + 0.3 * ((k * 7) % 3) / 2);
        this.dummy.position.set(burst.x + Math.cos(a) * glow.spread, burst.y + lift, burst.z + Math.sin(a) * glow.spread);
        this.dummy.quaternion.copy(camera.quaternion);
        this.dummy.scale.setScalar(glow.scale);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(used, this.dummy.matrix);
        this.mesh.setColorAt(used, this.color);
        used += 1;
      }
    }
    this.mesh.count = used;
    this.mesh.visible = used > 0;
    if (used === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
