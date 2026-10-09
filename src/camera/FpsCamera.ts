import type * as THREE from 'three';
import type { Heightfield } from '../core/types';
import type { Input } from '../input/Input';

/**
 * Terrain-following first-person observer: WASD move (blocked by water), arrows / drag look,
 * eye at max(heightAt, 0) + 1.7. Owned by the Controls lane (T5).
 *
 * STUB: does nothing.
 */
export class FpsCamera {
  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly hf: Heightfield
  ) {}

  update(_dt: number, _input: Input): void {}
}
