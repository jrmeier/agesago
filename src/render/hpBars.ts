import * as THREE from 'three';

/** Green → yellow → red fill for a hit-point fraction in 0..1. */
export const HP_GREEN = 0x3cba4a;
export const HP_YELLOW = 0xe0c240;
export const HP_RED = 0xd24b45;

const GREEN = new THREE.Color(HP_GREEN);
const YELLOW = new THREE.Color(HP_YELLOW);
const RED = new THREE.Color(HP_RED);

const CAP = 256;
const BAR_H = 0.07;

/**
 * Pooled billboard bars. One background draw and one coloured fill draw.
 * `begin` / `push` / `end` reuse matrices and a single colour — nothing is allocated per frame.
 */
export class HealthBars {
  readonly object = new THREE.Group();
  private readonly bg: THREE.InstancedMesh;
  private readonly fill: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly orient = new THREE.Quaternion();
  private readonly right = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private used = 0;

  constructor(parent: THREE.Object3D) {
    this.object.name = 'hp-bars';
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.userData.shared = 1;
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x24180f,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.bg = new THREE.InstancedMesh(geo, bgMat, CAP);
    this.fill = new THREE.InstancedMesh(geo, fillMat, CAP);
    this.bg.name = 'hp-bg';
    this.fill.name = 'hp-fill';
    this.bg.count = 0;
    this.fill.count = 0;
    this.bg.frustumCulled = false;
    this.fill.frustumCulled = false;
    this.bg.matrixAutoUpdate = false;
    this.fill.matrixAutoUpdate = false;
    this.bg.userData.noShadow = 1;
    this.fill.userData.noShadow = 1;
    this.bg.renderOrder = 6;
    this.fill.renderOrder = 7;
    this.bg.visible = false;
    this.fill.visible = false;
    this.object.add(this.bg, this.fill);
    parent.add(this.object);
  }

  /** Screen-align every bar to `camera` for this frame. */
  begin(camera: THREE.Camera): void {
    this.used = 0;
    this.orient.copy(camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.orient);
    this.forward.set(0, 0, 1).applyQuaternion(this.orient);
  }

  /** Add one bar. `fraction` is hp/maxHp. Ignored once the pool is full. */
  push(x: number, y: number, z: number, fraction: number, width: number): void {
    if (this.used >= CAP) return;
    const i = this.used++;
    const t = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    this.dummy.position.set(x, y, z);
    this.dummy.quaternion.copy(this.orient);
    this.dummy.scale.set(width, BAR_H, 1);
    this.dummy.updateMatrix();
    this.bg.setMatrixAt(i, this.dummy.matrix);

    const span = Math.max(0.05, t) * width;
    this.dummy.position.set(x, y, z).addScaledVector(this.right, -(width - span) * 0.5).addScaledVector(this.forward, 0.02);
    this.dummy.scale.set(span, BAR_H * 0.62, 1);
    this.dummy.updateMatrix();
    this.fill.setMatrixAt(i, this.dummy.matrix);
    this.fill.setColorAt(i, hpColor(t, this.color));
  }

  end(): void {
    this.bg.count = this.used;
    this.fill.count = this.used;
    const show = this.used > 0;
    this.bg.visible = show;
    this.fill.visible = show;
    if (!show) return;
    this.bg.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
  }
}

export function hpColor(fraction: number, out: THREE.Color): THREE.Color {
  const t = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  if (t >= 0.5) return out.copy(YELLOW).lerp(GREEN, (t - 0.5) * 2);
  return out.copy(RED).lerp(YELLOW, t * 2);
}
