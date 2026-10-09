import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sky } from './Sky';

describe('Sky', () => {
  it('constructs a back-face dome and advances cloud time', () => {
    const sky = new Sky();
    expect(sky.object).toBeInstanceOf(THREE.Object3D);
    const mat = sky.object.material as THREE.ShaderMaterial;
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.fog).toBe(false);
    expect(mat.depthWrite).toBe(false);
    sky.update(3.5);
    expect(mat.uniforms.uTime.value).toBe(3.5);
    sky.update(4);
    expect(mat.uniforms.uTime.value).toBeCloseTo(4);
  });
});
