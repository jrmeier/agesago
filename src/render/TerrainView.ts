import * as THREE from 'three';
import type { Heightfield } from '../core/types';
import { GRASS } from './palette';

/**
 * Terrain mesh displaced from the Heightfield (vertex colours by height/slope/forest)
 * plus an animated water plane at sea level. Owned by the Render lane (T4).
 * Public surface FROZEN: constructor, object, update.
 *
 * STUB: a flat green plane.
 */
export class TerrainView {
  readonly object = new THREE.Group();

  constructor(hf: Heightfield) {
    const geo = new THREE.PlaneGeometry(hf.width, hf.depth);
    geo.rotateX(-Math.PI / 2);
    geo.translate(hf.width / 2, hf.heightAt(0, 0), hf.depth / 2);
    this.object.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: GRASS[0] })));
  }

  /** Per-frame animation (water). `time` in seconds. */
  update(_time: number): void {}
}
