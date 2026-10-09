import type { EntityViews, ScreenRect } from '../render/EntityViews';
import type { CameraRig } from '../camera/CameraRig';
import type { EntityId } from '../core/types';
import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';
import { explorerIds } from '../ui/format';
import type { GestureEvent } from './gestures';
import { LMB, RMB, type DragState, type Input } from './Input';
import { resolveOrder } from './orders';
import { pickGround, screenRay, toNdc } from './pickGround';
import { focusNextScout } from './scouts';

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
 * Player intent → sim commands: click / box / A select (RTS only), RMB on an explored node =
 * gather, on ground (explored or not) = move, T = train, E = explore, "." / Home = centre on
 * the next scout. Disabled in first-person mode (where A strafes).
 * Touch: tap selects a villager or orders the selection (gather / move); long-press toggles a
 * villager; long-press + drag box-selects. Also binds the touch buttons (#touch-select-all,
 * #touch-deselect, #touch-fps), the #explore-btn, and mirrors the camera mode as `fps-mode` on <body>.
 * Owned by the Controls lane (T6). Public surface FROZEN: constructor, update.
 */
export class Controls {
  private readonly box: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  /** Touch box-select in progress. */
  private touchBox: ScreenRect | null = null;

  constructor(readonly deps: ControlsDeps) {
    const { hud, world, selection, rig } = deps;
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    hud.appendChild(this.box);
    this.ring = document.createElement('div');
    this.ring.className = 'press-ring';
    hud.appendChild(this.ring);
    world.events.on('removed', (e) => selection.remove([e.id]));
    rig.onModeChange((mode) => {
      if (mode === 'fps') {
        this.touchBox = null;
        this.showBox(null);
      }
      this.syncMode();
    });
    bindButton('touch-select-all', () => selection.set(world.units.keys()));
    bindButton('touch-deselect', () => selection.clear());
    bindButton('touch-fps', () => rig.setMode(rig.mode === 'rts' ? 'fps' : 'rts'));
    bindButton('explore-btn', () => this.explore());
    this.syncMode();
  }

  /** Send the selected units that can explore off to auto-explore. */
  explore(): void {
    const { world, selection } = this.deps;
    const units = [...selection.ids].flatMap((id) => world.units.get(id) ?? []);
    const unitIds = explorerIds(units);
    if (unitIds.length) world.dispatch({ type: 'explore', unitIds });
  }

  update(_dt: number): void {
    const { input, rig, world } = this.deps;
    if (rig.mode !== 'rts') return;

    for (const g of input.touch.gestures) this.gesture(g);

    const left = input.drag(LMB);
    const selecting = left && !left.withSpace ? left : undefined;
    const mouseBox = selecting?.held && selecting.dragging ? dragRect(selecting) : null;
    this.showBox(mouseBox ?? this.touchBox);

    if (input.released(LMB) && selecting) {
      const kind = classifyRelease(selecting);
      if (kind === 'click') this.clickSelect(selecting.x, selecting.y, input.shift);
      else if (kind === 'drag') this.boxSelect(dragRect(selecting), input.shift);
    }

    if (input.keyPressed('KeyA')) this.deps.selection.set(world.units.keys());
    if (input.keyPressed('KeyT')) world.dispatch({ type: 'train', buildingId: world.townCenter.id });
    if (input.keyPressed('KeyE')) this.explore();
    if (input.keyPressed('Period') || input.keyPressed('NumpadDecimal') || input.keyPressed('Home')) {
      focusNextScout(world, rig);
    }

    const right = input.drag(RMB);
    if (input.released(RMB) && right && classifyRelease(right) === 'click') this.order(right.x, right.y);
  }

  private gesture(g: GestureEvent): void {
    switch (g.type) {
      case 'tap': {
        const id = this.unitAt(g.x, g.y);
        if (id !== null) this.deps.selection.set([id]);
        else this.order(g.x, g.y);
        break;
      }
      case 'longPress':
        this.pulse(g.x, g.y);
        break;
      case 'longPressTap': {
        const id = this.unitAt(g.x, g.y);
        if (id !== null) this.toggle(id);
        break;
      }
      case 'box':
        this.touchBox = rectBetween(g.x0, g.y0, g.x, g.y);
        break;
      case 'boxEnd':
        this.touchBox = null;
        this.boxSelect(rectBetween(g.x0, g.y0, g.x, g.y), false);
        break;
      case 'boxCancel':
        this.touchBox = null;
        break;
    }
  }

  private unitAt(x: number, y: number): EntityId | null {
    const { views, world, rig, input } = this.deps;
    const id = views.pick(toNdc(x, y, input.width, input.height), rig.camera);
    return id !== null && world.units.has(id) ? id : null;
  }

  private toggle(id: EntityId): void {
    const { selection } = this.deps;
    if (selection.has(id)) selection.remove([id]);
    else selection.add([id]);
  }

  private clickSelect(x: number, y: number, additive: boolean): void {
    const { selection } = this.deps;
    const id = this.unitAt(x, y);
    if (id !== null) {
      if (!additive) selection.set([id]);
      else this.toggle(id);
    } else if (!additive) {
      selection.clear();
    }
  }

  private boxSelect(rect: ScreenRect, additive: boolean): void {
    const { selection, views, world, rig, input } = this.deps;
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
    const node = id !== null ? world.nodes.get(id) : undefined;
    const nodeExplored = !!node && world.visibility.isExplored(node.pos.x, node.pos.z);
    const ground =
      node && nodeExplored ? null : pickGround(screenRay(rig.camera, x, y, input.width, input.height), rig.rts.hf);
    const cmd = resolveOrder(unitIds, { nodeId: node?.id ?? null, nodeExplored, ground });
    if (!cmd) return;
    world.dispatch(cmd);
    if (cmd.type === 'move') views.flashMarker(cmd.target);
  }

  private showBox(r: ScreenRect | null): void {
    const s = this.box.style;
    if (!r) {
      s.display = 'none';
      return;
    }
    const c = this.deps.canvas.getBoundingClientRect();
    s.display = 'block';
    s.left = `${c.left + r.x0}px`;
    s.top = `${c.top + r.y0}px`;
    s.width = `${r.x1 - r.x0}px`;
    s.height = `${r.y1 - r.y0}px`;
  }

  /** Long-press feedback: a ring under the finger, plus a short buzz where supported. */
  private pulse(x: number, y: number): void {
    const c = this.deps.canvas.getBoundingClientRect();
    this.ring.style.left = `${c.left + x}px`;
    this.ring.style.top = `${c.top + y}px`;
    this.ring.animate(
      [
        { opacity: 0.9, transform: 'translate(-50%, -50%) scale(0.4)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
      ],
      { duration: 380, easing: 'ease-out' }
    );
    if ('vibrate' in navigator) navigator.vibrate(12);
  }

  private syncMode(): void {
    const fps = this.deps.rig.mode === 'fps';
    document.body.classList.toggle('fps-mode', fps);
    document.getElementById('touch-fps')?.setAttribute('aria-pressed', String(fps));
  }
}

function dragRect(d: DragState): ScreenRect {
  return rectBetween(d.startX, d.startY, d.x, d.y);
}

function bindButton(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    fn();
  });
}
