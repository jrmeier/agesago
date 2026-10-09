import * as THREE from 'three';
import type { Quality } from '../core/quality';
import type { Vec2 } from '../core/types';
import { projectileGeometry, type ProjKind } from './modelBridge';

export const LAUNCH_HEIGHT = 1.25;
export const IMPACT_HEIGHT = 0.8;

interface Pending {
  kind: ProjKind;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  flight: number;
  arc: number;
}

interface Slot {
  mesh: THREE.Mesh;
  active: boolean;
  kind: ProjKind;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  last: number;
  flight: number;
  arc: number;
  spin: number;
  angle: number;
}

/**
 * Pooled shots. `launch` queues a flight; `update` moves active meshes on a ballistic arc
 * and returns finished ones to the pool. The update loop does not allocate.
 */
export class ProjectilePool {
  readonly object = new THREE.Group();
  private readonly pending: Pending[] = [];
  private readonly slots: Slot[] = [];
  private readonly max: number;
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly quat = new THREE.Quaternion();

  constructor(parent: THREE.Object3D, quality?: Pick<Quality, 'tier'>) {
    this.object.name = 'projectiles';
    this.max = quality?.tier === 'low' ? 12 : quality?.tier === 'medium' ? 20 : 32;
    parent.add(this.object);
  }

  launch(kind: ProjKind, from: Vec2, to: Vec2, flight: number, groundY: (x: number, z: number) => number): void {
    if (this.pending.length >= this.max) this.pending.shift();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    this.pending.push({
      kind,
      x0: from.x,
      y0: groundY(from.x, from.z) + LAUNCH_HEIGHT,
      z0: from.z,
      x1: to.x,
      y1: groundY(to.x, to.z) + IMPACT_HEIGHT,
      z1: to.z,
      flight: Math.max(0.05, flight),
      arc: Math.min(2.8, 0.45 + dist * 0.15),
    });
  }

  update(time: number): void {
    for (let i = 0; i < this.pending.length; i++) this.arm(this.pending[i], time);
    this.pending.length = 0;
    for (let i = 0; i < this.slots.length; i++) this.step(this.slots[i], time);
  }

  private arm(shot: Pending, time: number): void {
    let slot = this.free();
    if (!slot) {
      if (this.slots.length < this.max) slot = this.makeSlot();
      else slot = this.oldest();
    }
    slot.kind = shot.kind;
    slot.mesh.geometry = projectileGeometry(shot.kind);
    slot.mesh.userData.projectileKind = shot.kind;
    slot.from.set(shot.x0, shot.y0, shot.z0);
    slot.to.set(shot.x1, shot.y1, shot.z1);
    slot.start = time;
    slot.last = time;
    slot.flight = shot.flight;
    slot.arc = shot.arc;
    slot.angle = (shot.x0 + shot.z0) * 0.17;
    slot.spin = shot.kind === 'stone' ? 6.5 : 0;
    slot.active = true;
    slot.mesh.visible = true;
    this.place(slot, 0);
  }

  private step(slot: Slot, time: number): void {
    if (!slot.active) return;
    const u = (time - slot.start) / slot.flight;
    if (u >= 1) {
      slot.active = false;
      slot.mesh.visible = false;
      return;
    }
    if (slot.kind === 'stone') {
      const dt = Math.min(0.25, Math.max(0, time - slot.last));
      slot.angle += dt * slot.spin;
    }
    slot.last = time;
    this.place(slot, u < 0 ? 0 : u);
  }

  private place(slot: Slot, u: number): void {
    const arc = Math.sin(Math.PI * u) * slot.arc;
    const mesh = slot.mesh;
    mesh.position.set(
      slot.from.x + (slot.to.x - slot.from.x) * u,
      slot.from.y + (slot.to.y - slot.from.y) * u + arc,
      slot.from.z + (slot.to.z - slot.from.z) * u,
    );
    if (slot.kind === 'stone') {
      mesh.rotation.set(slot.angle, slot.angle * 0.73, slot.angle * 0.41);
      return;
    }
    const inv = 1 / slot.flight;
    const vy = (slot.to.y - slot.from.y) * inv + slot.arc * Math.PI * Math.cos(Math.PI * u) * inv;
    this.dir.set((slot.to.x - slot.from.x) * inv, vy, (slot.to.z - slot.from.z) * inv);
    if (this.dir.lengthSq() < 1e-8) this.dir.set(0, 1, 0);
    else this.dir.normalize();
    mesh.quaternion.copy(this.quat.setFromUnitVectors(this.up, this.dir));
  }

  private free(): Slot | undefined {
    for (let i = 0; i < this.slots.length; i++) if (!this.slots[i].active) return this.slots[i];
    return undefined;
  }

  private oldest(): Slot {
    let best = this.slots[0];
    for (let i = 1; i < this.slots.length; i++) if (this.slots[i].start < best.start) best = this.slots[i];
    return best;
  }

  private makeSlot(): Slot {
    const mesh = new THREE.Mesh(
      projectileGeometry('arrow'),
      new THREE.MeshLambertMaterial({ color: 0xd7c4a1 }),
    );
    mesh.name = 'projectile';
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noShadow = 1;
    this.object.add(mesh);
    const slot: Slot = {
      mesh,
      active: false,
      kind: 'arrow',
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      start: 0,
      last: 0,
      flight: 1,
      arc: 1,
      spin: 0,
      angle: 0,
    };
    this.slots.push(slot);
    return slot;
  }
}
