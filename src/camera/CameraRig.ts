import * as THREE from 'three';
import type { Heightfield, Vec2 } from '../core/types';
import type { Input } from '../input/Input';
import { FpsCamera } from './FpsCamera';
import { RtsCamera } from './RtsCamera';

export type CameraMode = 'rts' | 'fps';

/**
 * Owns the PerspectiveCamera and the active controller; F (or the touch button, via setMode)
 * toggles RTS ↔ first person (restoring the RTS pose on return). Owned by the Controls lane (T5).
 * Public surface FROZEN: constructor, camera, mode, update, setAspect.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  mode: CameraMode = 'rts';
  readonly rts: RtsCamera;
  readonly fps: FpsCamera;
  private readonly listeners = new Set<(mode: CameraMode) => void>();

  constructor(
    hf: Heightfield,
    private readonly input: Input,
    initialTarget: Vec2
  ) {
    this.rts = new RtsCamera(this.camera, hf, initialTarget);
    this.fps = new FpsCamera(this.camera, hf);
  }

  update(dt: number): void {
    if (this.input.keyPressed('KeyF')) this.setMode(this.mode === 'rts' ? 'fps' : 'rts');
    (this.mode === 'rts' ? this.rts : this.fps).update(dt, this.input);
  }

  /** Switch modes. Entering FPS starts at the RTS target facing the same way (−z); the RTS pose is kept for the return. */
  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.input.touch.setMode(mode);
    if (mode === 'fps') this.fps.enter(this.rts.target, 0);
    else this.rts.settle();
    for (const fn of this.listeners) fn(mode);
  }

  /** Subscribe to mode changes. Returns an unsubscribe function. */
  onModeChange(fn: (mode: CameraMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Centre the RTS view on ground point `p` (e.g. from a minimap click). Ignored in first person. */
  focusOn(p: Vec2): void {
    if (this.mode === 'rts') this.rts.focusOn(p);
  }

  /** Ground quad (TL, TR, BR, BL) seen by the RTS camera. */
  viewFootprint(): Vec2[] {
    return this.rts.viewFootprint();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
