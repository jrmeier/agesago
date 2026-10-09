import type { EntityViews, ScreenRect } from '../render/EntityViews';
import type { CameraRig } from '../camera/CameraRig';
import type { BuildingKind, EntityId, PropPlacement, Vec2 } from '../core/types';
import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';
import { BUILD_HOTKEYS, kindForKey } from '../ui/build';
import { Discoveries } from '../ui/Discoveries';
import { explorerIds } from '../ui/format';
import type { GestureEvent } from './gestures';
import { LMB, RMB, type DragState, type Input } from './Input';
import { resolveBuildingOrder, resolveOrder } from './orders';
import { pickGround, screenRay, toNdc } from './pickGround';
import { Placement } from './Placement';
import { focusNextScout, onScoutFocus } from './scouts';

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
  /**
   * Map scenery (layout.props). Enables ruins / standing-stone / hamlet discovery toasts;
   * without it only distant gold and stone deposits are announced.
   */
  props?: readonly PropPlacement[];
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
 * gather, on a foundation / farm = construct / farm, on ground (explored or not) = move,
 * T = train, E = explore, "." / Home = centre on and select the next scout. Clicking a
 * building selects it. With villagers selected, H / S / G / M / P (or the #build-grid buttons)
 * enter placement mode: the ghost follows the cursor, R or Shift+wheel rotates, LMB places
 * (Shift keeps placing), RMB / Esc cancels. Disabled in first-person mode (where A strafes).
 * Touch: tap selects a unit, orders the selection (gather / construct / farm / move), or with
 * no units selected selects the tapped building;
 * long-press toggles a villager; long-press + drag box-selects. While placing, a tap moves the
 * ghost, a finger on the ghost drags it, and #place-bar's ⟳ / ✕ / ✓ rotate, cancel, confirm.
 * Also binds the touch buttons (#touch-select-all, #touch-deselect, #touch-fps), #explore-btn,
 * #cancel-build-btn, runs discovery toasts, and mirrors the camera mode as `fps-mode` on <body>.
 * Owned by the Controls lane (T6). Public surface FROZEN: constructor, update.
 */
export class Controls {
  private readonly box: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  /** Touch box-select in progress. */
  private touchBox: ScreenRect | null = null;
  readonly placement: Placement;
  private readonly discoveries: Discoveries;
  private time = 0;

  constructor(readonly deps: ControlsDeps) {
    const { hud, world, selection, rig, input, views } = deps;
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    hud.appendChild(this.box);
    this.ring = document.createElement('div');
    this.ring.className = 'press-ring';
    hud.appendChild(this.ring);
    this.placement = new Placement({ world, views, rig });
    this.placement.groundAt = (x, y) => this.groundAt(x, y);
    this.placement.viewport = () => ({ width: input.width, height: input.height });
    input.touch.setGrabber(this.placement);
    this.discoveries = new Discoveries(hud, world, (p) => rig.focusOn(p), deps.props ?? []);

    world.events.on('removed', (e) => selection.remove([e.id]));
    onScoutFocus(world, (id) => selection.set([id]));
    selection.onChange(() => {
      if (this.placement.active && !this.villagerIds().length) this.placement.cancel();
    });
    rig.onModeChange((mode) => {
      if (mode === 'fps') {
        this.touchBox = null;
        this.showBox(null);
        this.placement.cancel();
      }
      this.syncMode();
    });
    bindButton('touch-select-all', () => selection.set(world.units.keys()));
    bindButton('touch-deselect', () => selection.clear());
    bindButton('touch-fps', () => rig.setMode(rig.mode === 'rts' ? 'fps' : 'rts'));
    bindButton('explore-btn', () => this.explore());
    bindButton('cancel-build-btn', () => this.cancelSelectedFoundation());
    bindButton('place-rotate', () => this.placement.rotate(1));
    bindButton('place-cancel', () => this.placement.cancel());
    bindButton('place-confirm', () => this.placement.confirm(false));
    document.getElementById('build-grid')?.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('[data-build]');
      if (!btn) return;
      btn.blur();
      this.beginPlacement(btn.dataset.build as BuildingKind);
    });
    this.syncMode();
  }

  /** Send the selected units that can explore off to auto-explore. */
  explore(): void {
    const { world, selection } = this.deps;
    const units = [...selection.ids].flatMap((id) => world.units.get(id) ?? []);
    const unitIds = explorerIds(units);
    if (unitIds.length) world.dispatch({ type: 'explore', unitIds });
  }

  update(dt: number): void {
    const { input, rig, world } = this.deps;
    this.time += dt;
    this.discoveries.update(this.time);
    if (rig.mode !== 'rts') return;

    if (this.placement.active) {
      this.updatePlacement();
      return;
    }

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
    for (const code of Object.values(BUILD_HOTKEYS)) {
      const kind = input.keyPressed(code) ? kindForKey(code) : null;
      if (kind) this.beginPlacement(kind);
    }

    const right = input.drag(RMB);
    if (input.released(RMB) && right && classifyRelease(right) === 'click') this.order(right.x, right.y);
  }

  /** Enter placement for `kind` if villagers are selected. Mouse: the ghost starts under the cursor. */
  private beginPlacement(kind: BuildingKind): void {
    const { input, rig } = this.deps;
    const builders = this.villagerIds();
    if (!builders.length) return;
    this.showBox(null);
    this.touchBox = null;
    const at = input.touch.active || input.overHud || !input.inside ? { ...rig.rts.target } : this.groundAt(input.x, input.y);
    this.placement.start(kind, builders, at ?? { ...rig.rts.target });
  }

  private updatePlacement(): void {
    const { input } = this.deps;
    const p = this.placement;
    this.showBox(null);
    if (input.keyPressed('Escape')) {
      p.cancel();
      return;
    }
    if (input.keyPressed('KeyR')) p.rotate(1);
    if (input.wheel && input.shift) {
      p.rotate(Math.sign(input.wheel));
      input.wheel = 0; // Shift+wheel rotates instead of zooming.
    }
    for (const g of input.touch.gestures) {
      if (g.type !== 'tap') continue;
      const ground = this.groundAt(g.x, g.y);
      if (ground) p.moveTo(ground);
    }
    if (!input.touch.active && input.inside && !input.overHud) {
      const ground = this.groundAt(input.x, input.y);
      if (ground) p.moveTo(ground);
      else p.refresh();
    } else {
      p.refresh();
    }
    const left = input.drag(LMB);
    if (input.released(LMB) && left && !left.withSpace && classifyRelease(left) === 'click') p.confirm(input.shift);
    const right = input.drag(RMB);
    if (input.released(RMB) && right && classifyRelease(right) === 'click') p.cancel();
  }

  private gesture(g: GestureEvent): void {
    switch (g.type) {
      case 'tap': {
        const id = this.unitAt(g.x, g.y);
        if (id !== null) {
          this.deps.selection.set([id]);
          break;
        }
        // With units selected a tap orders them (construct / farm / move); otherwise it selects the building.
        const b = this.buildingAt(g.x, g.y);
        if (b !== null && !this.selectedUnitIds().length) this.deps.selection.set([b]);
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

  private pickAt(x: number, y: number): EntityId | null {
    const { views, rig, input } = this.deps;
    return views.pick(toNdc(x, y, input.width, input.height), rig.camera);
  }

  private unitAt(x: number, y: number): EntityId | null {
    const id = this.pickAt(x, y);
    return id !== null && this.deps.world.units.has(id) ? id : null;
  }

  private buildingAt(x: number, y: number): EntityId | null {
    const id = this.pickAt(x, y);
    return id !== null && this.deps.world.buildings.has(id) ? id : null;
  }

  private groundAt(x: number, y: number): Vec2 | null {
    const { rig, input } = this.deps;
    return pickGround(screenRay(rig.camera, x, y, input.width, input.height), rig.rts.hf);
  }

  /** Selected villagers (the ones that can build). */
  private villagerIds(): EntityId[] {
    const { world, selection } = this.deps;
    return [...selection.ids].filter((id) => world.units.get(id)?.kind === 'villager');
  }

  private selectedUnitIds(): EntityId[] {
    const { world, selection } = this.deps;
    return [...selection.ids].filter((id) => world.units.has(id));
  }

  private toggle(id: EntityId): void {
    const { selection } = this.deps;
    if (selection.has(id)) selection.remove([id]);
    else selection.add([id]);
  }

  private clickSelect(x: number, y: number, additive: boolean): void {
    const { selection, world } = this.deps;
    const id = this.pickAt(x, y);
    if (id !== null && world.units.has(id)) {
      if (!additive) selection.set([id]);
      else this.toggle(id);
    } else if (id !== null && world.buildings.has(id)) {
      selection.set([id]);
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
    const { views, world } = this.deps;
    const unitIds = this.selectedUnitIds();
    if (!unitIds.length) return;
    const id = this.pickAt(x, y);
    const building = id !== null ? world.buildings.get(id) : undefined;
    const buildCmd = building ? resolveBuildingOrder(this.villagerIds(), building) : null;
    let movers = unitIds;
    if (buildCmd) {
      world.dispatch(buildCmd);
      // Scouts (which can't build or farm) just walk over.
      movers = unitIds.filter((u) => world.units.get(u)?.kind !== 'villager');
      if (!movers.length) return;
    }
    const node = id !== null ? world.nodes.get(id) : undefined;
    const nodeExplored = !!node && world.visibility.isExplored(node.pos.x, node.pos.z);
    const ground = node && nodeExplored ? null : this.groundAt(x, y);
    const cmd = resolveOrder(movers, { nodeId: node?.id ?? null, nodeExplored, ground });
    if (!cmd) return;
    world.dispatch(cmd);
    if (cmd.type === 'move') views.flashMarker(cmd.target);
  }

  /** Cancel the selected building if it is an unfinished foundation (refunds its cost). */
  private cancelSelectedFoundation(): void {
    const { world, selection } = this.deps;
    for (const id of selection.ids) {
      const b = world.buildings.get(id);
      if (b && !b.complete) {
        world.dispatch({ type: 'cancelBuild', buildingId: b.id });
        return;
      }
    }
  }

  private showBox(r: ScreenRect | null): void {
    const s = this.box.style;
    if (!r) {
      if (s.display !== 'none') s.display = 'none';
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
