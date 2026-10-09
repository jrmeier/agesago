import * as THREE from 'three';
import type { Heightfield, Vec2 } from '../core/types';
import { RMB, LMB, type DragState, type Input } from '../input/Input';
import { pickGround3, screenRay, surfaceAt } from '../input/pickGround';

export const MIN_DISTANCE = 10;
export const MAX_DISTANCE = 40;
/** Edge-scroll band, in px from the window edge. */
export const EDGE_PX = 18;
/** Minimum clearance between the camera and the surface below it. */
const CLEARANCE = 2;
/** Log-distance change per wheel pixel. */
const ZOOM_PER_PX = 0.0015;
/** Smoothing rates (1/s) for zoom and focus-height follow. */
const ZOOM_RATE = 14;
const FOCUS_RATE = 6;
/** Pan speed (world units/s per unit of distance) for edge scroll and arrow keys. */
const SCROLL_SPEED = 1.1;

/** Edge-scroll direction in screen space: each axis −1, 0 or 1 (y down = toward the viewer). */
export function edgeScrollDir(x: number, y: number, w: number, h: number, margin = EDGE_PX): { x: number; y: number } {
  return {
    x: x < margin ? -1 : x > w - 1 - margin ? 1 : 0,
    y: y < margin ? -1 : y > h - 1 - margin ? 1 : 0,
  };
}

/**
 * Zoom about a fixed world point: scaling the camera pose about `anchor` by `k` keeps the
 * anchor on the same pixel because orientation is unchanged. Returns the new focus point.
 */
export function zoomFocusAbout(focus: THREE.Vector3, anchor: THREE.Vector3, k: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(focus).sub(anchor).multiplyScalar(k).add(anchor);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Overhead RTS controller: zoom-to-cursor (against the terrain), RMB-drag and Space+drag
 * pan, touch pan / pinch-zoom, edge scroll (ignoring HUD buttons and touch), map/zoom clamps. Owned by the Controls lane (T5).
 * The camera looks along −z with a fixed pitch; screen up is world −z.
 */
export class RtsCamera {
  target: Vec2;
  distance = 26;
  readonly pitch = (52 * Math.PI) / 180;
  /** Height of the focus point; eases toward the surface under the target. */
  focusY: number;
  /** Wheel zoom (log distance) not yet applied; consumed smoothly. */
  private pendingZoom = 0;
  /** Grab-the-ground pan in progress: the world point held under the cursor. */
  private grab: { button: number; point: THREE.Vector3 } | null = null;
  /** Touch pan in progress: the world point held under the finger / pinch midpoint. */
  private touchGrab: THREE.Vector3 | null = null;
  private readonly back: THREE.Vector3;
  private readonly ray = new THREE.Ray();
  private readonly plane = new THREE.Plane();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly hf: Heightfield,
    target: Vec2
  ) {
    this.target = { ...target };
    this.focusY = surfaceAt(hf, target.x, target.z);
    this.back = new THREE.Vector3(0, Math.sin(this.pitch), Math.cos(this.pitch));
    this.apply();
  }

  update(dt: number, input: Input): void {
    this.apply();
    this.updatePan(input);
    this.updateTouch(input);

    if (!this.grab && !this.touchGrab) {
      let sx = 0;
      let sy = 0;
      if (input.inside && !input.overHud && !input.touch.active && !input.isDown(LMB) && !input.isDown(RMB)) {
        const e = edgeScrollDir(input.clientX, input.clientY, input.viewWidth, input.viewHeight);
        sx += e.x;
        sy += e.y;
      }
      sx += (input.key('ArrowRight') ? 1 : 0) - (input.key('ArrowLeft') ? 1 : 0);
      sy += (input.key('ArrowDown') ? 1 : 0) - (input.key('ArrowUp') ? 1 : 0);
      if (sx || sy) {
        const v = (SCROLL_SPEED * this.distance * dt) / Math.hypot(sx, sy);
        this.target.x += sx * v;
        this.target.z += sy * v;
      }
    }

    if (input.wheel) this.pendingZoom += input.wheel * ZOOM_PER_PX;
    if (Math.abs(this.pendingZoom) > 1e-4) {
      const step = this.pendingZoom * (1 - Math.exp(-ZOOM_RATE * dt));
      this.pendingZoom -= step;
      this.zoomAt(input.x, input.y, input.width, input.height, Math.exp(step));
      if ((this.distance <= MIN_DISTANCE && this.pendingZoom < 0) || (this.distance >= MAX_DISTANCE && this.pendingZoom > 0)) {
        this.pendingZoom = 0;
      }
    } else {
      this.pendingZoom = 0;
    }

    this.clampTarget();
    const ground = surfaceAt(this.hf, this.target.x, this.target.z);
    this.focusY += (ground - this.focusY) * (1 - Math.exp(-FOCUS_RATE * dt));
    this.apply();
  }

  /**
   * Multiply the distance by `factor` (clamped), keeping the surface point under canvas pixel
   * (x, y) fixed on screen. Falls back to zooming about the focus if the cursor misses the map.
   */
  zoomAt(x: number, y: number, width: number, height: number, factor: number): void {
    this.apply();
    const d = clamp(this.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    const k = d / this.distance;
    if (k === 1) return;
    const anchor = pickGround3(screenRay(this.camera, x, y, width, height, this.ray), this.hf);
    if (anchor) {
      const f = zoomFocusAbout(this.focus(), anchor, k);
      this.target.x = f.x;
      this.target.z = f.z;
      this.focusY = f.y;
    }
    this.distance = d;
    // Re-seat the focus on the surface without moving the camera, so nothing drifts afterwards.
    for (let i = 0; i < 3; i++) this.slideFocus(surfaceAt(this.hf, this.target.x, this.target.z));
    this.apply();
  }

  /** Snap any in-flight smoothing (used when the rig hands control back). */
  settle(): void {
    this.pendingZoom = 0;
    this.grab = null;
    this.touchGrab = null;
    this.focusY = surfaceAt(this.hf, this.target.x, this.target.z);
    this.apply();
  }

  /** Current focus point (target at focusY). */
  focus(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.target.x, this.focusY, this.target.z);
  }

  private updatePan(input: Input): void {
    if (this.grab && !input.isDown(this.grab.button)) this.grab = null;
    if (!this.grab) {
      const d = this.panDrag(input);
      if (d) {
        const hit = this.planeHit(input, d.startX, d.startY, null);
        if (hit) this.grab = { button: d.button, point: hit };
      }
    }
    if (this.grab) this.dragTo(input, this.grab.point, input.x, input.y);
  }

  /**
   * Touch: one- or two-finger pan holds the grabbed ground point under the finger (or
   * midpoint); pinch zooms about the midpoint with the same math as zoom-to-cursor.
   */
  private updateTouch(input: Input): void {
    for (const g of input.touch.gestures) {
      switch (g.type) {
        case 'panStart':
          this.touchGrab = this.planeHit(input, g.x, g.y, null);
          break;
        case 'pan':
          if (this.touchGrab) this.dragTo(input, this.touchGrab, g.x, g.y);
          break;
        case 'pinch':
          this.zoomAt(g.x, g.y, input.width, input.height, 1 / g.scale);
          this.touchGrab = this.planeHit(input, g.x, g.y, null) ?? this.touchGrab;
          break;
        case 'panEnd':
          this.touchGrab = null;
          break;
      }
    }
  }

  /** Move the target so the world `point` sits under canvas pixel (x, y). */
  private dragTo(input: Input, point: THREE.Vector3, x: number, y: number): void {
    const now = this.planeHit(input, x, y, point.y);
    if (!now) return;
    this.target.x += point.x - now.x;
    this.target.z += point.z - now.z;
    this.clampTarget();
    this.apply();
  }

  /** A held drag that should pan: RMB past the threshold, or LMB started with Space held. */
  private panDrag(input: Input): DragState | null {
    const r = input.drag(RMB);
    if (r?.held && r.dragging) return r;
    const l = input.drag(LMB);
    if (l?.held && l.withSpace) return l;
    return null;
  }

  /** Point under a pixel: on the terrain when `y` is null, else on the horizontal plane at `y`. */
  private planeHit(input: Input, px: number, py: number, y: number | null): THREE.Vector3 | null {
    screenRay(this.camera, px, py, input.width, input.height, this.ray);
    if (y === null) {
      const hit = pickGround3(this.ray, this.hf);
      if (hit) return hit;
      y = this.focusY;
    }
    this.plane.set(new THREE.Vector3(0, 1, 0), -y);
    return this.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  /** Move the focus to height `y` by sliding along the view axis — the image does not change. */
  private slideFocus(y: number): void {
    const s = (this.focusY - y) / this.back.y;
    const d = this.distance + s;
    if (d < MIN_DISTANCE || d > MAX_DISTANCE) return;
    this.target.x -= this.back.x * s;
    this.target.z -= this.back.z * s;
    this.focusY = y;
    this.distance = d;
  }

  private clampTarget(): void {
    this.target.x = clamp(this.target.x, 0, this.hf.width);
    this.target.z = clamp(this.target.z, 0, this.hf.depth);
  }

  private apply(): void {
    const cam = this.camera;
    cam.position.copy(this.focus()).addScaledVector(this.back, this.distance);
    const x = clamp(cam.position.x, 0, this.hf.width);
    const z = clamp(cam.position.z, 0, this.hf.depth);
    const floor = surfaceAt(this.hf, x, z) + CLEARANCE;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.target.x, this.focusY, this.target.z);
    cam.updateMatrixWorld();
  }
}
