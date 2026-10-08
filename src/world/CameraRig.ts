import * as THREE from 'three';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Fixed-angle RTS camera: zoom-to-cursor, grab-pan, and edge-scroll. */
export class CameraRig {
  private focus = new THREE.Vector3();
  private distance = 13;
  private readonly minDistance = 7;
  private readonly maxDistance = 18;
  private readonly yaw = Math.PI * 0.25;
  private readonly pitch = THREE.MathUtils.degToRad(56);

  private raycaster = new THREE.Raycaster();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private mapW: number,
    private mapH: number
  ) {
    this.focus.set(mapW / 2, 0, mapH / 2);
    this.apply();
  }

  zoom(ndc: THREE.Vector2, deltaY: number): void {
    const before = this.groundPoint(ndc);
    const factor = deltaY > 0 ? 1.1 : 1 / 1.1;
    const next = THREE.MathUtils.clamp(this.distance * factor, this.minDistance, this.maxDistance);
    if (next === this.distance) return;

    if (before) {
      const ratio = next / this.distance;
      this.focus.x = before.x + (this.focus.x - before.x) * ratio;
      this.focus.z = before.z + (this.focus.z - before.z) * ratio;
    }
    this.distance = next;
    this.clampFocus();
    this.apply();
  }

  panByGround(prev: THREE.Vector2, cur: THREE.Vector2): void {
    const g1 = this.groundPoint(prev);
    const g2 = this.groundPoint(cur);
    if (!g1 || !g2) return;
    this.focus.x += g1.x - g2.x;
    this.focus.z += g1.z - g2.z;
    this.clampFocus();
    this.apply();
  }

  edgeScroll(dt: number, ndcX: number, ndcY: number): void {
    const t = 0.9;
    let ex = 0;
    let ey = 0;
    if (ndcX > t) ex = 1;
    else if (ndcX < -t) ex = -1;
    if (ndcY > t) ey = 1;
    else if (ndcY < -t) ey = -1;
    if (ex === 0 && ey === 0) return;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const speed = this.distance * 0.5 * dt;
    this.focus.addScaledVector(forward, ey * speed);
    this.focus.addScaledVector(right, ex * speed);
    this.clampFocus();
    this.apply();
  }

  /** Raycast the y=0 ground plane from a normalized device coordinate. */
  groundPoint(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(GROUND, hit) ? hit : null;
  }

  focusOn(x: number, z: number): void {
    this.focus.set(x, 0, z);
    this.clampFocus();
    this.apply();
  }

  private clampFocus(): void {
    this.focus.x = THREE.MathUtils.clamp(this.focus.x, 4, this.mapW - 4);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, 4, this.mapH - 4);
  }

  private apply(): void {
    const hor = Math.cos(this.pitch) * this.distance;
    const hgt = Math.sin(this.pitch) * this.distance;
    this.camera.position.set(
      this.focus.x + hor * Math.cos(this.yaw),
      hgt,
      this.focus.z + hor * Math.sin(this.yaw)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.focus);
  }
}
