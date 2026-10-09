import type * as THREE from 'three';
import type { Heightfield, Vec2 } from '../core/types';

/**
 * Intersect a ray with the heightfield surface (march + bisect). Returns the ground
 * point, or null if the ray misses the map. Owned by the Controls lane (T5/T6).
 *
 * STUB: intersects the plane y = heightAt(centre).
 */
export function pickGround(ray: THREE.Ray, hf: Heightfield): Vec2 | null {
  const y = hf.heightAt(hf.width / 2, hf.depth / 2);
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = (y - ray.origin.y) / ray.direction.y;
  if (t < 0) return null;
  const x = ray.origin.x + ray.direction.x * t;
  const z = ray.origin.z + ray.direction.z * t;
  if (x < 0 || z < 0 || x > hf.width || z > hf.depth) return null;
  return { x, z };
}
