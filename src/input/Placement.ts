import * as THREE from 'three';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind, EntityId, Vec2 } from '../core/types';
import type { CameraRig } from '../camera/CameraRig';
import type { EntityViews } from '../render/EntityViews';
import type { World } from '../sim/World';
import { placementVerdict } from '../ui/build';
import type { TouchGrab } from './TouchInput';
import { placementPos, rotateQuarter } from './placeMath';
import { surfaceAt } from './pickGround';

/** A touch this close (CSS px) to the ghost's centre picks it up for dragging. */
const GRAB_PX = 72;

export interface PlacementDeps {
  world: World;
  views: EntityViews;
  rig: CameraRig;
}

/**
 * Building placement mode: holds the kind, rotation and ghost position, keeps the ghost
 * (views.showGhost) and its verdict (world.canPlace + affordability) current, and drives the
 * #place-bar (name, reason, ⟳ / ✕ / ✓ buttons) and the `placing` class on <body>.
 * Controls feeds it pointer positions and decides when to confirm or cancel.
 */
export class Placement implements TouchGrab {
  kind: BuildingKind | null = null;
  rot = 0;
  pos: Vec2 | null = null;
  ok = false;
  reason = '';
  private builders: EntityId[] = [];
  private ghostKey = '';
  private grabOffset = { x: 0, y: 0 };
  private readonly bar = document.getElementById('place-bar');
  private readonly nameEl = document.getElementById('place-name');
  private readonly reasonEl = document.getElementById('place-reason');
  private readonly tmp = new THREE.Vector3();
  /** Ground point under a canvas pixel (supplied by Controls). */
  groundAt: (x: number, y: number) => Vec2 | null = () => null;
  /** Canvas size in CSS px (supplied by Controls). */
  viewport: () => { width: number; height: number } = () => ({ width: 1, height: 1 });

  constructor(private readonly deps: PlacementDeps) {}

  get active(): boolean {
    return this.kind !== null;
  }

  /** Enter placement for `kind`, to be built by `builders`; the ghost starts at `at` if given. */
  start(kind: BuildingKind, builders: readonly EntityId[], at: Vec2 | null): void {
    this.kind = kind;
    this.builders = [...builders];
    this.pos = null;
    this.ghostKey = '';
    setText(this.nameEl, BUILDINGS[kind].name);
    document.body.classList.add('placing');
    if (this.bar) this.bar.hidden = false;
    if (at) this.moveTo(at);
    else this.refresh();
  }

  cancel(): void {
    if (!this.active) return;
    this.kind = null;
    this.pos = null;
    this.builders = [];
    this.deps.views.hideGhost();
    document.body.classList.remove('placing');
    if (this.bar) this.bar.hidden = true;
  }

  rotate(dir = 1): void {
    if (!this.kind) return;
    this.rot = rotateQuarter(this.rot, dir);
    if (this.pos) this.moveTo(this.pos);
  }

  /** Put the ghost over ground point `g` (clamped into the map and snapped). */
  moveTo(g: Vec2): void {
    if (!this.kind) return;
    const { hf } = this.deps.world;
    this.pos = placementPos(this.kind, g, this.rot, hf.width, hf.depth);
    this.refresh();
  }

  /** Re-check the spot (stock and fog change under a still ghost) and update the ghost and bar. */
  refresh(): void {
    const { world, views } = this.deps;
    if (!this.kind) return;
    if (!this.pos) {
      this.ok = false;
      this.reason = 'Choose a spot';
    } else {
      const v = placementVerdict(world.canPlace(this.kind, this.pos, this.rot), BUILDINGS[this.kind].cost, world.stock);
      this.ok = v.ok;
      this.reason = v.text;
    }
    setText(this.reasonEl, this.reason);
    this.bar?.classList.toggle('invalid', !this.ok);
    const key = this.pos ? `${this.kind}|${this.pos.x}|${this.pos.z}|${this.rot}|${this.ok}` : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (this.pos) views.showGhost(this.kind, this.pos, this.rot, this.ok);
    else views.hideGhost();
  }

  /**
   * Place the foundation if the spot is valid: dispatch 'build' with the builders still alive.
   * `keep` (Shift) stays in placement for another. Returns true if something was placed.
   */
  confirm(keep: boolean): boolean {
    const { world } = this.deps;
    if (!this.kind || !this.pos) return false;
    this.refresh();
    if (!this.ok) {
      this.bar?.animate(
        [{ transform: 'translateX(-50%)' }, { transform: 'translateX(calc(-50% - 6px))' }, { transform: 'translateX(calc(-50% + 6px))' }, { transform: 'translateX(-50%)' }],
        { duration: 240 }
      );
      return false;
    }
    const unitIds = this.builders.filter((id) => world.units.get(id)?.kind === 'villager');
    if (!unitIds.length) {
      this.cancel();
      return false;
    }
    world.dispatch({ type: 'build', unitIds, kind: this.kind, pos: { ...this.pos }, rot: this.rot });
    if (keep) {
      this.ghostKey = '';
      this.refresh();
    } else {
      this.cancel();
    }
    return true;
  }

  /** The ghost centre in canvas CSS px, or null when it's off screen / not placed. */
  screenPos(): { x: number; y: number } | null {
    if (!this.pos) return null;
    const { rig, world } = this.deps;
    const v = this.tmp.set(this.pos.x, surfaceAt(world.hf, this.pos.x, this.pos.z), this.pos.z).project(rig.camera);
    if (v.z > 1) return null;
    const { width, height } = this.viewport();
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  }

  // ---- TouchGrab: one finger on the ghost drags it instead of panning ----

  down(x: number, y: number): boolean {
    const s = this.screenPos();
    if (!this.active || !s || Math.hypot(s.x - x, s.y - y) > GRAB_PX) return false;
    this.grabOffset = { x: s.x - x, y: s.y - y };
    return true;
  }

  move(x: number, y: number): void {
    const g = this.groundAt(x + this.grabOffset.x, y + this.grabOffset.y);
    if (g) this.moveTo(g);
  }

  up(): void {}
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}
