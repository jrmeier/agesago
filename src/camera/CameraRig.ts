import * as THREE from 'three';
import type { Heightfield, Vec2 } from '../core/types';
import type { Input } from '../input/Input';
import { FpsCamera } from './FpsCamera';
import { RtsCamera } from './RtsCamera';

export type CameraMode = 'rts' | 'fps';

/**
 * Owns the PerspectiveCamera and the active controller; F toggles RTS ↔ first person
 * (restoring the RTS pose on return). Owned by the Controls lane (T5).
 * Public surface FROZEN: constructor, camera, mode, update, setAspect.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  mode: CameraMode = 'rts';
  private readonly rts: RtsCamera;
  private readonly fps: FpsCamera;

  constructor(
    hf: Heightfield,
    private readonly input: Input,
    initialTarget: Vec2
  ) {
    this.rts = new RtsCamera(this.camera, hf, initialTarget);
    this.fps = new FpsCamera(this.camera, hf);
  }

  update(dt: number): void {
    (this.mode === 'rts' ? this.rts : this.fps).update(dt, this.input);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
