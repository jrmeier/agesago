import * as THREE from 'three';
import type { Vec2 } from '../core/types';
import { MOVE_MARKER, SELECTION } from './palette';
import { subdivide, type OrderRoute, type RouteKind } from './orderRoutes';

const ROUTE_COLOR: Record<RouteKind, number> = {
  move: MOVE_MARKER,
  patrol: SELECTION,
  guard: 0x8fd18a,
  pending: 0xf4f1e6,
};
/** Metres between terrain samples along a line. */
const STEP = 1.5;
/** Height of lines and slot rings above the ground. */
const LIFT = 0.12;
/** Line vertices drawn at most (pairs), so a huge selection cannot balloon the buffer. */
const MAX_VERTS = 8000;
/** Ghost slots drawn at most (a right-drag preview of a 200-unit army fits). */
const MAX_SLOTS = 256;

/**
 * Ground overlay for orders: route lines (move paths, patrol loops, guard links, patrol points being
 * picked) and the ghost slots of a right-drag formation preview, plus its facing arrow.
 * Pure presentation; EntityViews owns it and feeds it each frame.
 */
export class OrderOverlay {
  readonly object = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly positions = new Float32Array(MAX_VERTS * 3);
  private readonly colors = new Float32Array(MAX_VERTS * 3);
  private readonly slots: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.lines.name = 'order-routes';
    // Hidden while empty: the renderer then neither uploads the buffers nor issues a draw call,
    // so a scene with no orders costs nothing (the prettify benchmark's budgets).
    this.lines.visible = false;
    this.object.add(this.lines);

    const ring = new THREE.RingGeometry(0.28, 0.42, 20);
    ring.rotateX(-Math.PI / 2);
    this.slots = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({
      color: MOVE_MARKER, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false,
    }), MAX_SLOTS);
    this.slots.count = 0;
    this.slots.frustumCulled = false;
    this.slots.renderOrder = 5;
    this.slots.name = 'formation-slots';
    this.slots.visible = false;
    this.object.add(this.slots);
  }

  /** Lines currently drawn (segments), for tests and e2e. */
  get segmentCount(): number {
    return this.lines.geometry.drawRange.count / 2;
  }

  /** Ghost slots currently shown. */
  get slotCount(): number {
    return this.slots.count;
  }

  /** Replace the drawn lines. */
  setRoutes(routes: readonly OrderRoute[], groundY: (x: number, z: number) => number): void {
    let v = 0;
    for (const route of routes) {
      this.color.setHex(ROUTE_COLOR[route.kind]);
      const pts = subdivide(route.points, STEP);
      for (let i = 1; i < pts.length && v + 2 <= MAX_VERTS; i++) {
        v = this.vertex(v, pts[i - 1], groundY);
        v = this.vertex(v, pts[i], groundY);
      }
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, v);
    this.lines.visible = v > 0;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  /** Show ghost slots (null hides them). */
  setSlots(points: readonly Vec2[] | null, groundY: (x: number, z: number) => number): void {
    const n = Math.min(points?.length ?? 0, MAX_SLOTS);
    for (let i = 0; i < n; i++) {
      const p = points![i];
      this.dummy.position.set(p.x, groundY(p.x, p.z) + LIFT, p.z);
      this.dummy.updateMatrix();
      this.slots.setMatrixAt(i, this.dummy.matrix);
    }
    this.slots.count = n;
    this.slots.visible = n > 0;
    this.slots.instanceMatrix.needsUpdate = true;
  }

  private vertex(v: number, p: Vec2, groundY: (x: number, z: number) => number): number {
    const o = v * 3;
    this.positions[o] = p.x;
    this.positions[o + 1] = groundY(p.x, p.z) + LIFT;
    this.positions[o + 2] = p.z;
    this.colors[o] = this.color.r;
    this.colors[o + 1] = this.color.g;
    this.colors[o + 2] = this.color.b;
    return v + 1;
  }
}
