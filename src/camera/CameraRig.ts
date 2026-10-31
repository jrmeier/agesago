import * as THREE from 'three';
import type { EntityId, Heightfield, Vec2 } from '../core/types';
import type { Input } from '../input/Input';
import { FollowCamera, type FollowTarget } from './FollowCamera';
import { RtsCamera } from './RtsCamera';

export type CameraMode = 'rts' | 'pov' | 'third';
export const CAMERA_LABELS: Record<CameraMode, string> = { rts: 'Overhead', pov: 'Villager POV', third: 'Third-person' };

/** Three gameplay views. Follow resolution is read-only and supplied by the game. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  mode: CameraMode = 'rts';
  readonly rts: RtsCamera;
  readonly follow: FollowCamera;
  followedId: EntityId | null = null;
  resolveTarget: (id: EntityId | null, alpha: number) => FollowTarget | null = () => null;
  feedback: (message: string) => void = () => {};
  private alpha = 1;
  private readonly listeners = new Set<(mode: CameraMode) => void>();

  constructor(hf: Heightfield, private readonly input: Input, initialTarget: Vec2) {
    this.rts = new RtsCamera(this.camera, hf, initialTarget);
    this.follow = new FollowCamera(this.camera, hf);
  }

  update(dt: number, alpha = 1): void {
    this.alpha = alpha;
    if (this.input.keyPressed('KeyF')) this.cycleMode();
    if (this.mode === 'rts') this.rts.update(dt, this.input);
    else {
      const target = this.resolveTarget(this.followedId, alpha);
      if (!target) {
        this.setMode('rts');
        this.feedback('Villager unavailable — returned to Overhead.');
      } else this.follow.update(dt, this.input, target, this.mode);
    }
  }

  cycleMode(): void { this.setMode(this.mode === 'rts' ? 'pov' : this.mode === 'pov' ? 'third' : 'rts'); }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    if (mode !== 'rts') {
      const target = this.resolveTarget(this.followedId, this.alpha);
      if (!target) {
        if (this.mode !== 'rts') this.setMode('rts');
        this.feedback('No available own villager to follow.');
        return;
      }
      if (this.mode === 'rts') this.follow.enter();
      this.follow.pitch = mode === 'third' ? -0.35 : -0.15;
      this.followedId = target.id;
      this.follow.apply(target, mode);
    } else {
      this.followedId = null;
      this.rts.settle();
    }
    this.mode = mode;
    this.input.cancelPointer();
    this.input.touch.setMode(mode === 'rts' ? 'rts' : 'follow');
    for (const fn of this.listeners) fn(mode);
  }

  onModeChange(fn: (mode: CameraMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  focusOn(p: Vec2): void { if (this.mode === 'rts') this.rts.focusOn(p); }
  viewFootprint(): Vec2[] { return this.rts.viewFootprint(); }
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
