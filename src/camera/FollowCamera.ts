import * as THREE from 'three';
import type { EntityId, Heightfield, Unit } from '../core/types';
import { LMB, type Input } from '../input/Input';
import { surfaceAt } from '../input/pickGround';

export type FollowMode = 'pov' | 'third';
export interface FollowTarget { id: EntityId; x: number; y: number; z: number; facing: number }
export const VILLAGER_EYE_HEIGHT = 0.852;

/** Same ground position and facing used by EntityViews.placeUnit. No simulation writes. */
export function villagerPose(unit: Unit, hf: Heightfield, alpha: number): FollowTarget {
  const t = Math.max(0, Math.min(1, alpha));
  const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * t;
  const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * t;
  return { id: unit.id, x, y: surfaceAt(hf, x, z), z, facing: unit.facing };
}

/** Camera-only look offsets relative to the worker's rendered facing (+z at zero). */
export class FollowCamera {
  obstacleDistance: (from: THREE.Vector3, to: THREE.Vector3) => number = () => Infinity;
  yawOffset = 0;
  pitch = -0.15;
  distance = 3.5;
  yaw = 0;
  readonly pos = { x: 0, z: 0 };
  constructor(readonly camera: THREE.PerspectiveCamera, readonly hf: Heightfield) {}

  enter(): void { this.yawOffset = 0; this.pitch = -0.15; }

  update(dt: number, input: Input, target: FollowTarget, mode: FollowMode): void {
    this.yawOffset += ((input.key('ArrowLeft') ? 1 : 0) - (input.key('ArrowRight') ? 1 : 0)) * dt * 1.8;
    this.pitch += ((input.key('ArrowUp') ? 1 : 0) - (input.key('ArrowDown') ? 1 : 0)) * dt * 1.8;
    if (input.isDown(LMB)) {
      this.yawOffset -= input.moveX * 0.004;
      this.pitch -= input.moveY * 0.004;
    }
    this.yawOffset -= input.touch.lookX * 0.006;
    this.pitch -= input.touch.lookY * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch, mode === 'third' ? -1.1 : -1.3, mode === 'third' ? 0.3 : 1.3);
    if (mode === 'third') this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(input.wheel * 0.0015), 2, 10);
    this.apply(target, mode);
  }

  apply(target: FollowTarget, mode: FollowMode): void {
    this.pos.x = target.x; this.pos.z = target.z;
    this.yaw = target.facing + Math.PI + this.yawOffset;
    const eye = new THREE.Vector3(target.x, target.y + VILLAGER_EYE_HEIGHT, target.z);
    this.camera.position.copy(eye);
    if (mode === 'third') {
      // Prefer directly behind. If scenery blocks that boom, find a clear shoulder angle
      // instead of placing the camera inside the Town Center beside a starting worker.
      let bestDistance = -1;
      const baseYaw = this.yaw;
      for (const offset of [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2, Math.PI]) {
        const yaw = baseYaw + offset;
        const backward = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(yaw) * Math.cos(this.pitch));
        let clear = 0;
        const candidate = new THREE.Vector3();
        for (let d = 0.1; d <= this.distance; d += 0.1) {
          candidate.copy(eye).addScaledVector(backward, d);
          if (candidate.x < 0.2 || candidate.z < 0.2 || candidate.x > this.hf.width - 0.2 || candidate.z > this.hf.depth - 0.2 || candidate.y < surfaceAt(this.hf, candidate.x, candidate.z) + 0.45) break;
          clear = d;
        }
        candidate.copy(eye).addScaledVector(backward, clear);
        clear = Math.max(0, Math.min(clear, this.obstacleDistance(eye, candidate) - 0.25));
        if (clear > bestDistance) {
          bestDistance = clear;
          this.camera.position.copy(eye).addScaledVector(backward, clear);
          this.yaw = yaw;
        }
        if (clear >= this.distance - 0.11) break;
      }
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld(true);
  }
}
