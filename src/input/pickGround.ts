import * as THREE from 'three';
import { SEA_LEVEL, type Heightfield, type Vec2 } from '../core/types';

const STEP = 0.5;
const BISECT_ITERS = 12;
const MAX_DIST = 400;

/** Visible surface height: the ground, or the water plane where the ground is below sea level. */
export function surfaceAt(hf: Heightfield, x: number, z: number): number {
  return Math.max(hf.heightAt(x, z), SEA_LEVEL);
}

/**
 * Intersect a ray with the heightfield surface (water counts as surface at SEA_LEVEL):
 * march in STEP increments inside the map bounds, then bisect. Returns the ground point,
 * or null if the ray misses the map. Owned by the Controls lane (T5/T6).
 */
export function pickGround(ray: THREE.Ray, hf: Heightfield): Vec2 | null {
  const hit = pickGround3(ray, hf);
  return hit && { x: hit.x, z: hit.z };
}

/** Like pickGround, but returns the 3D hit point (y = surface height). */
export function pickGround3(ray: THREE.Ray, hf: Heightfield): THREE.Vector3 | null {
  const o = ray.origin;
  const d = ray.direction;
  // Clip the ray to the map's x/z slab.
  let t0 = 0;
  let t1 = MAX_DIST;
  for (const [p, v, max] of [
    [o.x, d.x, hf.width],
    [o.z, d.z, hf.depth],
  ]) {
    if (Math.abs(v) < 1e-9) {
      if (p < 0 || p > max) return null;
      continue;
    }
    let a = (0 - p) / v;
    let b = (max - p) / v;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (t0 > t1) return null;

  const above = (t: number) => o.y + d.y * t - surfaceAt(hf, o.x + d.x * t, o.z + d.z * t);
  if (above(t0) <= 0) return pointAt(ray, t0);
  let prev = t0;
  for (let t = t0 + STEP; ; t += STEP) {
    const tt = Math.min(t, t1);
    if (above(tt) <= 0) {
      let lo = prev;
      let hi = tt;
      for (let i = 0; i < BISECT_ITERS; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      const p = pointAt(ray, hi);
      p.y = surfaceAt(hf, p.x, p.z);
      return p;
    }
    if (tt >= t1) return null;
    prev = tt;
  }
}

/** Canvas CSS px → normalised device coordinates. */
export function toNdc(x: number, y: number, width: number, height: number, out = new THREE.Vector2()): THREE.Vector2 {
  return out.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
}

/** World-space ray through a canvas pixel. The camera's matrices must be current. */
export function screenRay(
  camera: THREE.Camera,
  x: number,
  y: number,
  width: number,
  height: number,
  out = new THREE.Ray()
): THREE.Ray {
  const ndc = toNdc(x, y, width, height);
  out.origin.setFromMatrixPosition(camera.matrixWorld);
  out.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(out.origin).normalize();
  return out;
}

const projected = new THREE.Vector3();

/** World point → canvas CSS px, or null when behind the camera or off-screen. */
export function projectToCanvas(
  camera: THREE.Camera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number
): { x: number; y: number } | null {
  projected.set(x, y, z).project(camera);
  if (projected.z > 1 || projected.z < -1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05) return null;
  return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
}

function pointAt(ray: THREE.Ray, t: number): THREE.Vector3 {
  return ray.at(t, new THREE.Vector3());
}
