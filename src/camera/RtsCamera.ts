import type * as THREE from 'three';
import type { Heightfield, Vec2 } from '../core/types';
import type { Input } from '../input/Input';

/**
 * Overhead RTS controller: zoom-to-cursor (against the terrain), RMB-drag and Space+drag
 * pan, edge scroll (ignoring HUD buttons), map/zoom clamps. Owned by the Controls lane (T5).
 *
 * STUB: fixed pose looking at the target.
 */
export class RtsCamera {
  target: Vec2;
  distance = 26;
  readonly pitch = (52 * Math.PI) / 180;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly hf: Heightfield,
    target: Vec2
  ) {
    this.target = { ...target };
  }

  update(_dt: number, _input: Input): void {
    const y = this.hf.heightAt(this.target.x, this.target.z);
    this.camera.position.set(
      this.target.x,
      y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.pitch) * this.distance
    );
    this.camera.lookAt(this.target.x, y, this.target.z);
  }
}
