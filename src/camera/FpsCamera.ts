import type * as THREE from 'three';
import type { Heightfield, Vec2 } from '../core/types';
import { LMB, type Input } from '../input/Input';
import { surfaceAt } from '../input/pickGround';

export const EYE_HEIGHT = 1.7;
const WALK_SPEED = 5;
const RUN_FACTOR = 2.2;
const KEY_LOOK_SPEED = 1.8;
const DRAG_LOOK_PER_PX = 0.004;
const MAX_PITCH = 1.4;
const HEIGHT_RATE = 10;
/** Keep the observer this far inside the map edge. */
const MAP_MARGIN = 0.5;

/** Ground-plane forward and right unit vectors for a yaw (yaw 0 looks along −z). */
export function yawBasis(yaw: number): { forward: Vec2; right: Vec2 } {
  return {
    forward: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
    right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
  };
}

/**
 * Terrain-following first-person observer: WASD move (Shift runs; blocked by water and the
 * map edge, sliding along obstacles), arrows / LMB-drag look, eye at max(heightAt, 0) + 1.7.
 * Owned by the Controls lane (T5).
 */
export class FpsCamera {
  pos: Vec2 = { x: 0, z: 0 };
  yaw = 0;
  pitch = -0.12;
  private eyeY = EYE_HEIGHT;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly hf: Heightfield
  ) {}

  /** Place the observer at `at` (nudged onto dry land) looking along `yaw`. */
  enter(at: Vec2, yaw: number): void {
    this.pos = this.nearestDry(at);
    this.yaw = yaw;
    this.pitch = -0.12;
    this.eyeY = this.eyeTarget();
    this.apply();
  }

  update(dt: number, input: Input): void {
    const turn = (input.key('ArrowLeft') ? 1 : 0) - (input.key('ArrowRight') ? 1 : 0);
    const tilt = (input.key('ArrowUp') ? 1 : 0) - (input.key('ArrowDown') ? 1 : 0);
    this.yaw += turn * KEY_LOOK_SPEED * dt;
    this.pitch += tilt * KEY_LOOK_SPEED * dt;
    if (input.isDown(LMB)) {
      this.yaw -= input.moveX * DRAG_LOOK_PER_PX;
      this.pitch -= input.moveY * DRAG_LOOK_PER_PX;
    }
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));

    const fwd = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    const side = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
    if (fwd || side) {
      const { forward, right } = yawBasis(this.yaw);
      const step = ((input.shift ? RUN_FACTOR : 1) * WALK_SPEED * dt) / Math.hypot(fwd, side);
      this.move((forward.x * fwd + right.x * side) * step, (forward.z * fwd + right.z * side) * step);
    }

    this.eyeY += (this.eyeTarget() - this.eyeY) * (1 - Math.exp(-HEIGHT_RATE * dt));
    this.apply();
  }

  /** True if the observer may stand at (x, z). */
  canStand(x: number, z: number): boolean {
    return (
      x >= MAP_MARGIN &&
      z >= MAP_MARGIN &&
      x <= this.hf.width - MAP_MARGIN &&
      z <= this.hf.depth - MAP_MARGIN &&
      !this.hf.isWater(x, z)
    );
  }

  /** Try the full step, then each axis alone, so walls of water are slid along. */
  private move(dx: number, dz: number): void {
    const { x, z } = this.pos;
    if (this.canStand(x + dx, z + dz)) this.pos = { x: x + dx, z: z + dz };
    else if (this.canStand(x + dx, z)) this.pos = { x: x + dx, z };
    else if (this.canStand(x, z + dz)) this.pos = { x, z: z + dz };
  }

  private nearestDry(p: Vec2): Vec2 {
    if (this.canStand(p.x, p.z)) return { ...p };
    for (let r = 1; r < Math.max(this.hf.width, this.hf.depth); r++) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (this.canStand(x, z)) return { x, z };
      }
    }
    return { x: this.hf.width / 2, z: this.hf.depth / 2 };
  }

  private eyeTarget(): number {
    return surfaceAt(this.hf, this.pos.x, this.pos.z) + EYE_HEIGHT;
  }

  private apply(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.position.set(this.pos.x, this.eyeY, this.pos.z);
    this.camera.updateMatrixWorld();
  }
}
