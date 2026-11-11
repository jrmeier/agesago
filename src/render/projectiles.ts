import * as THREE from 'three';
import type { Quality } from '../core/quality';
import type { EntityId, ProjectileKind, Vec2 } from '../core/types';
import { projectileGeometry, type ProjKind } from './modelBridge';

export const LAUNCH_HEIGHT = 1.25;
export const IMPACT_HEIGHT = 0.8;

/** Peak height over the straight line: boulders lob high, bolts fly almost flat. */
export function arcHeight(kind: ProjectileKind, dist: number): number {
  if (kind === 'boulder') return Math.min(6, 1.2 + dist * 0.3);
  if (kind === 'bolt') return Math.min(0.9, 0.15 + dist * 0.035);
  return Math.min(2.8, 0.45 + dist * 0.15);
}

/** Where a shot lands; boulders and bolts land on the ground (y is the terrain there). */
export type LandFn = (kind: ProjKind, x: number, y: number, z: number, targetId: EntityId | null) => void;

const TINT: Partial<Record<ProjKind, number>> = { boulder: 0x8f8a80, bolt: 0x6b4a2e };
const DEFAULT_TINT = 0xd7c4a1;

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
  start: number | null;
  targetId: EntityId | null;
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
  targetId: EntityId | null;
  mat: THREE.MeshLambertMaterial;
}

/**
 * Pooled shots. `launch` queues a flight; `update` moves active meshes on a ballistic arc
 * and returns finished ones to the pool. The update loop does not allocate.
 *
 * Pass the sim clock to `update` and the event's sim time as `start`, so a shot takes exactly the
 * sim's flight time (at any game speed, and frozen while paused) and lands as the damage does.
 * `onLand` hears every shot that reaches its end (not one evicted early from a full pool).
 */
export class ProjectilePool {
  readonly object = new THREE.Group();
  private readonly pending: Pending[] = [];
  private readonly slots: Slot[] = [];
  private readonly max: number;
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly quat = new THREE.Quaternion();
  onLand: LandFn | null = null;

  constructor(parent: THREE.Object3D, quality?: Pick<Quality, 'tier'>) {
    this.object.name = 'projectiles';
    this.max = quality?.tier === 'low' ? 12 : quality?.tier === 'medium' ? 20 : 32;
    parent.add(this.object);
  }

  launch(
    kind: ProjKind,
    from: Vec2,
    to: Vec2,
    flight: number,
    groundY: (x: number, z: number) => number,
    opts?: { start?: number; targetId?: EntityId | null },
  ): void {
    if (this.pending.length >= this.max) this.pending.shift();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const siege = kind === 'boulder' || kind === 'bolt';
    this.pending.push({
      kind,
      x0: from.x,
      y0: groundY(from.x, from.z) + LAUNCH_HEIGHT,
      z0: from.z,
      x1: to.x,
      // A boulder or bolt comes down to the ground at its aim point.
      y1: groundY(to.x, to.z) + (siege ? 0.15 : IMPACT_HEIGHT),
      z1: to.z,
      flight: Math.max(0.05, flight),
      arc: arcHeight(kind, dist),
      start: opts?.start ?? null,
      targetId: opts?.targetId ?? null,
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
    slot.mat.color.setHex(TINT[shot.kind] ?? DEFAULT_TINT);
    slot.targetId = shot.targetId;
    slot.mesh.userData.projectileKind = shot.kind;
    slot.from.set(shot.x0, shot.y0, shot.z0);
    slot.to.set(shot.x1, shot.y1, shot.z1);
    slot.start = shot.start ?? time;
    slot.last = time;
    slot.flight = shot.flight;
    slot.arc = shot.arc;
    slot.angle = (shot.x0 + shot.z0) * 0.17;
    slot.spin = shot.kind === 'stone' ? 6.5 : shot.kind === 'boulder' ? 2.6 : 0;
    slot.active = true;
    slot.mesh.visible = true;
    this.place(slot, 0);
    // A shot armed after its whole flight (a long frame) still lands.
    this.step(slot, time);
  }

  private step(slot: Slot, time: number): void {
    if (!slot.active) return;
    const u = (time - slot.start) / slot.flight;
    if (u >= 1) {
      slot.active = false;
      slot.mesh.visible = false;
      this.onLand?.(slot.kind, slot.to.x, slot.to.y, slot.to.z, slot.targetId);
      return;
    }
    if (slot.spin) {
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
    if (slot.spin) {
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
    const mat = new THREE.MeshLambertMaterial({ color: DEFAULT_TINT });
    const mesh = new THREE.Mesh(projectileGeometry('arrow'), mat);
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
      targetId: null,
      mat,
    };
    this.slots.push(slot);
    return slot;
  }
}
