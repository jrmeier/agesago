import * as THREE from 'three';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind, EntityId, ResourceType, Stockpile, Vec2 } from '../core/types';
import type { CameraRig } from '../camera/CameraRig';
import type { EntityViews } from '../render/EntityViews';
import { wallSegments } from '../sim/systems/walls';
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
 * (views.showGhost, or views.showLine for a wall) and its verdict (world.canPlace +
 * affordability) current, and drives the #place-bar (name, reason, ⟳ / ✕ / ✓ buttons) and
 * the `placing` class on <body>. A line kind also sets `placing-line` and is laid by dragging.
 * Controls feeds it pointer positions and decides when to confirm or cancel.
 */
export class Placement implements TouchGrab {
  kind: BuildingKind | null = null;
  rot = 0;
  pos: Vec2 | null = null;
  ok = false;
  reason = '';
  /** True while a wall drag is in progress (mouse or touch). */
  lineDrag = false;
  private builders: EntityId[] = [];
  private ghostKey = '';
  private anchor: Vec2 | null = null;
  private end: Vec2 | null = null;
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

  /** Palisades and stone walls are dragged out as a line of segments. */
  get line(): boolean {
    return !!this.kind && !!BUILDINGS[this.kind].line;
  }

  /** Enter placement for `kind`, to be built by `builders`; the ghost starts at `at` if given. */
  start(kind: BuildingKind, builders: readonly EntityId[], at: Vec2 | null): void {
    this.kind = kind;
    this.builders = [...builders];
    this.pos = null;
    this.ghostKey = '';
    this.endLineDrag();
    setText(this.nameEl, BUILDINGS[kind].name);
    document.body.classList.add('placing');
    document.body.classList.toggle('placing-line', !!BUILDINGS[kind].line);
    if (this.bar) this.bar.hidden = false;
    if (at) this.moveTo(at);
    else this.refresh();
  }

  cancel(): void {
    if (!this.active) return;
    this.kind = null;
    this.pos = null;
    this.builders = [];
    this.endLineDrag();
    this.deps.views.hideGhost();
    document.body.classList.remove('placing', 'placing-line');
    if (this.bar) this.bar.hidden = true;
  }

  /** Start a wall at `g`. Further movement extends it; release builds it. */
  beginLine(g: Vec2): void {
    if (!this.line) return;
    this.anchor = { x: g.x, z: g.z };
    this.end = { x: g.x, z: g.z };
    this.lineDrag = true;
    this.ghostKey = '';
    this.refresh();
  }

  /** Move the far end of the wall drag. */
  extendLine(g: Vec2): void {
    if (!this.line) return;
    if (!this.anchor) this.beginLine(g);
    this.end = { x: g.x, z: g.z };
    this.ghostKey = '';
    this.refresh();
  }

  /** Drop the drag without leaving placement (a click that never became a drag). */
  endLineDrag(): void {
    this.anchor = null;
    this.end = null;
    this.lineDrag = false;
    this.ghostKey = '';
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
    if (!this.kind) return;
    if (this.line) {
      this.refreshLine();
      return;
    }
    const { world, views } = this.deps;
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
   * A line kind dispatches 'buildWall' instead. `keep` (Shift) stays in placement for another.
   * Returns true if something was placed.
   */
  confirm(keep: boolean): boolean {
    if (this.line) return this.confirmLine(keep);
    const { world } = this.deps;
    if (!this.kind || !this.pos) return false;
    this.refresh();
    if (!this.ok) {
      this.shake();
      return false;
    }
    const unitIds = this.livingBuilders();
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

  /**
   * Lay the dragged wall. With no drag, ✓ places one segment at the ghost.
   * Shift stays in placement and clears the anchor so the next drag starts clean.
   */
  confirmLine(keep: boolean): boolean {
    const { world } = this.deps;
    if (!this.kind) return false;
    const from = this.lineDrag ? this.anchor : this.pos;
    const to = this.lineDrag ? (this.end ?? this.anchor) : this.pos;
    if (!from || !to) {
      this.shake();
      return false;
    }
    this.refresh();
    if (!this.ok) {
      this.shake();
      this.endLineDrag();
      this.refresh();
      return false;
    }
    const unitIds = this.livingBuilders();
    if (!unitIds.length) {
      this.cancel();
      return false;
    }
    world.dispatch({ type: 'buildWall', unitIds, kind: this.kind, from: { ...from }, to: { ...to } });
    if (keep) {
      if (this.end) this.pos = { x: this.end.x, z: this.end.z };
      this.endLineDrag();
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
    if (!this.active) return false;
    if (this.line) {
      const g = this.groundAt(x, y);
      if (!g) return false;
      this.beginLine(g);
      return true;
    }
    const s = this.screenPos();
    if (!s || Math.hypot(s.x - x, s.y - y) > GRAB_PX) return false;
    this.grabOffset = { x: s.x - x, y: s.y - y };
    return true;
  }

  move(x: number, y: number): void {
    if (this.line) {
      const g = this.groundAt(x, y);
      if (g) this.extendLine(g);
      return;
    }
    const g = this.groundAt(x + this.grabOffset.x, y + this.grabOffset.y);
    if (g) this.moveTo(g);
  }

  up(): void {
    // Touch release builds the line. The synthesised mouse-up that follows is ignored by Input.
    if (this.line && this.lineDrag) this.confirmLine(false);
  }

  private livingBuilders(): EntityId[] {
    return this.builders.filter((id) => this.deps.world.units.get(id)?.kind === 'villager');
  }

  /** Wall preview. Cost is subtracted per accepted segment, so later ones can show as unaffordable. */
  private refreshLine(): void {
    const { world, views } = this.deps;
    const kind = this.kind;
    if (!kind) return;
    const from = this.lineDrag && this.anchor ? this.anchor : this.pos;
    const to = this.lineDrag && this.end ? this.end : this.pos;
    if (!from || !to) {
      this.ok = false;
      this.reason = 'Drag a line';
      setText(this.reasonEl, this.reason);
      this.bar?.classList.toggle('invalid', true);
      views.hideGhost();
      return;
    }
    const cost = BUILDINGS[kind].cost;
    const stock: Stockpile = { ...world.stock };
    const spots: { pos: Vec2; rot: number; valid: boolean }[] = [];
    let okCount = 0;
    let firstBad = '';
    for (const s of wallSegments(kind, from, to)) {
      const check = world.canPlace(kind, s.pos, s.rot);
      let valid = false;
      let text = '';
      if (check.ok || check.reason === 'insufficient-resources') {
        const v = placementVerdict(check.ok ? { ok: true } : check, cost, stock);
        valid = v.ok;
        text = v.text;
        if (valid) spend(stock, cost);
      } else {
        text = placementVerdict(check, cost, stock).text;
      }
      if (valid) okCount++;
      else if (!firstBad) firstBad = text;
      spots.push({ pos: s.pos, rot: s.rot, valid });
    }
    this.ok = okCount > 0;
    const noun = okCount === 1 ? 'segment' : 'segments';
    this.reason = this.ok ? `${okCount} ${noun}${firstBad ? ` · ${firstBad}` : ''}` : firstBad || 'Can’t build here';
    setText(this.reasonEl, this.reason);
    this.bar?.classList.toggle('invalid', !this.ok);
    views.showLine(kind, spots);
  }

  private shake(): void {
    this.bar?.animate(
      [{ transform: 'translateX(-50%)' }, { transform: 'translateX(calc(-50% - 6px))' }, { transform: 'translateX(calc(-50% + 6px))' }, { transform: 'translateX(-50%)' }],
      { duration: 240 }
    );
  }
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function spend(stock: Stockpile, cost: Partial<Stockpile>): void {
  for (const [k, n] of Object.entries(cost) as [ResourceType, number][]) stock[k] -= n;
}
