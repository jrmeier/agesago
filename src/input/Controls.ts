import type { EntityViews, ScreenRect } from '../render/EntityViews';
import type { CameraRig } from '../camera/CameraRig';
import type { EntityId } from '../core/types';
import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';
import { LMB, RMB, type DragState, type Input } from './Input';
import { pickGround, screenRay, toNdc } from './pickGround';

export interface ControlsDeps {
  world: World;
  views: EntityViews;
  rig: CameraRig;
  input: Input;
  selection: Selection;
  /** The canvas element (for pixel → NDC conversion). */
  canvas: HTMLElement;
  /** The `.select-box` overlay parent (the #hud element). */
  hud: HTMLElement;
}

/** What a finished press was: a click, a drag (box / pan), or nothing. */
export function classifyRelease(d: Pick<DragState, 'dragging' | 'held'> | undefined): 'click' | 'drag' | null {
  if (!d || d.held) return null;
  return d.dragging ? 'drag' : 'click';
}

/** Normalised rectangle between two corners. */
export function rectBetween(ax: number, ay: number, bx: number, by: number): ScreenRect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/**
 * Player intent → sim commands: click / box / A select (RTS only), RMB on node = gather,
 * on ground = move, T = train. Disabled in first-person mode (where A strafes).
 * Owned by the Controls lane (T6). Public surface FROZEN: constructor, update.
 */
export class Controls {
  private readonly box: HTMLDivElement;

  constructor(readonly deps: ControlsDeps) {
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    deps.hud.appendChild(this.box);
    deps.world.events.on('removed', (e) => deps.selection.remove([e.id]));
    deps.rig.onModeChange((mode) => {
      if (mode === 'fps') this.showBox(null);
    });
  }

  update(_dt: number): void {
    const { input, rig, world } = this.deps;
    if (rig.mode !== 'rts') return;

    const left = input.drag(LMB);
    const selecting = left && !left.withSpace ? left : undefined;
    this.showBox(selecting?.held && selecting.dragging ? selecting : null);

    if (input.released(LMB) && selecting) {
      const kind = classifyRelease(selecting);
      if (kind === 'click') this.clickSelect(selecting.x, selecting.y, input.shift);
      else if (kind === 'drag') this.boxSelect(selecting, input.shift);
    }

    if (input.keyPressed('KeyA')) this.deps.selection.set(world.units.keys());
    if (input.keyPressed('KeyT')) world.dispatch({ type: 'train', buildingId: world.townCenter.id });

    const right = input.drag(RMB);
    if (input.released(RMB) && right && classifyRelease(right) === 'click') this.order(right.x, right.y);
  }

  private clickSelect(x: number, y: number, additive: boolean): void {
    const { selection, views, world, rig, input } = this.deps;
    const id = views.pick(toNdc(x, y, input.width, input.height), rig.camera);
    if (id !== null && world.units.has(id)) {
      if (!additive) selection.set([id]);
      else if (selection.has(id)) selection.remove([id]);
      else selection.add([id]);
    } else if (!additive) {
      selection.clear();
    }
  }

  private boxSelect(d: DragState, additive: boolean): void {
    const { selection, views, world, rig, input } = this.deps;
    const rect = rectBetween(d.startX, d.startY, d.x, d.y);
    const ids = views
      .idsInRect(rect, rig.camera, { width: input.width, height: input.height })
      .filter((id) => world.units.has(id));
    if (additive) selection.add(ids);
    else selection.set(ids);
  }

  private order(x: number, y: number): void {
    const { selection, views, world, rig, input } = this.deps;
    const unitIds: EntityId[] = [...selection.ids].filter((id) => world.units.has(id));
    if (!unitIds.length) return;
    const id = views.pick(toNdc(x, y, input.width, input.height), rig.camera);
    if (id !== null && world.nodes.has(id)) {
      world.dispatch({ type: 'gather', unitIds, nodeId: id });
      return;
    }
    const target = pickGround(screenRay(rig.camera, x, y, input.width, input.height), rig.rts.hf);
    if (!target) return;
    world.dispatch({ type: 'move', unitIds, target });
    views.flashMarker(target);
  }

  private showBox(d: DragState | null): void {
    const s = this.box.style;
    if (!d) {
      s.display = 'none';
      return;
    }
    const r = rectBetween(d.startX, d.startY, d.x, d.y);
    const c = this.deps.canvas.getBoundingClientRect();
    s.display = 'block';
    s.left = `${c.left + r.x0}px`;
    s.top = `${c.top + r.y0}px`;
    s.width = `${r.x1 - r.x0}px`;
    s.height = `${r.y1 - r.y0}px`;
  }
}
