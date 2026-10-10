import type { EntityViews, ScreenRect } from '../render/EntityViews';
import type { PickIntent } from '../render/picking';
import type { CameraRig } from '../camera/CameraRig';
import { BUILDINGS } from '../core/buildings';
import { GAIA, type Building, type BuildingKind, type Command, type EntityId, type PropPlacement, type Stance, type UnitKind, type Vec2 } from '../core/types';
import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';
import { Alerts } from '../ui/Alerts';
import { buildHotkeyCodes, kindForKey } from '../ui/build';
import { ageLockText, unitAge } from '../ui/research';
import { Discoveries } from '../ui/Discoveries';
import { explorerIds } from '../ui/format';
import { HotkeyHelp } from '../ui/hotkeyHelp';
import { canTrainAt, isMilitary, kindForSlotKey, trainBatch } from '../ui/military';
import { RallyFlag } from '../ui/RallyFlag';
import { SideRail } from '../ui/SideRail';
import { closeTouchMenus, touchMenuOpen } from '../ui/touchMenus';
import { ControlGroups, groupCentre } from './controlGroups';
import type { GestureEvent } from './gestures';
import { GROUP_KEYS, HOTKEYS, TRAIN_SLOT_KEYS, groupForKey } from './hotkeys';
import { IdleCycler, idleVillagers } from './idle';
import { LMB, RMB, type DragState, type Input } from './Input';
import { resolveAttackMove, resolveBuildingOrder, resolveOrder, resolveTargetOrder, resolveTradeOrder, type HitEntity } from './orders';
import { pickGround, projectToCanvas, screenRay, toNdc } from './pickGround';
import { Placement } from './Placement';
import { focusNextScout, onScoutFocus } from './scouts';

/** Two clicks / taps on the same unit within this many seconds select all of its kind on screen. */
const DOUBLE_CLICK_S = 0.35;
/** Seconds between idle-villager recounts. */
const IDLE_INTERVAL = 0.25;
/** Digit and numpad keys that select / assign control groups. */
const GROUP_CODES: readonly string[] = [...GROUP_KEYS, ...GROUP_KEYS.map((k) => k.replace('Digit', 'Numpad'))];

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

/** A selected own unit considered by a touch long-press. */
export interface LongPressUnit {
  id: EntityId;
  kind: UnitKind;
}

/**
 * Completed touch long-press (finger up, no drag). An own unit under the finger toggles.
 * Otherwise the selected soldiers attack-move to `ground`. Villagers and scouts stay put.
 * Null when no soldier can be sent or the press missed the map. A drag is a box, not this.
 */
export function resolveLongPress(args: {
  selected: readonly LongPressUnit[];
  ownUnitId: EntityId | null;
  ground: Vec2 | null;
}): { type: 'toggle'; id: EntityId } | Extract<Command, { type: 'attackMove' }> | null {
  if (args.ownUnitId !== null) return { type: 'toggle', id: args.ownUnitId };
  const soldiers = args.selected.filter((u) => isMilitary(u.kind)).map((u) => u.id);
  return resolveAttackMove(soldiers, args.ground);
}

/**
 * Player intent → sim commands: click / box / A select (RTS only; boxes and A take only the
 * local player's units, a click may inspect a visible enemy), RMB on a visible enemy unit or
 * building = attack, on an explored node = gather, on a foundation / farm = construct / farm,
 * on ground (explored or not) = move; Ctrl+RMB = attack-move. With only an own training
 * building selected, RMB sets its rally point (on a node / unit / building: rally to it) and
 * a flag marks it. Q (or the command-card button) arms attack-move: the next click / tap on
 * the ground attack-moves there (on an enemy: attacks it); Esc / RMB disarms. X = stop;
 * stance buttons set the stance of the selected soldiers. Z / C / V train the selected
 * building's units (Shift: five). Ctrl / Cmd / Alt + 1–9 assign a control group (Shift adds),
 * 1–9 select it, a quick second press centres on it; the side rail's group buttons do the
 * same by tap (long-press assigns). "," and the idle button cycle idle villagers. Double-click
 * (double-tap) a unit selects all of that kind on screen. T = train villager, E = explore,
 * "." / Home = next scout. Shift+/ (or the ? button) opens the hotkey list; Esc closes it.
 * Clicking a visible building selects it. A last-seen enemy
 * building is not a target until it is in sight again. With villagers selected,
 * H / S / G / M / P / B / Y / K (or the #build-grid buttons) enter placement mode: the ghost
 * follows the cursor, R or Shift+wheel rotates, LMB places (Shift keeps placing), RMB / Esc
 * cancels. Disabled in first-person mode (where A strafes).
 * Touch: tap selects a unit, attacks a visible enemy with units selected, orders the selection
 * (gather / construct / farm / move), sets a selected building's rally point, or with no units
 * selected selects the tapped visible building / enemy. A tap while a Build / Train / Orders sheet is
 * open closes it and does not order. A long-press on an own unit toggles it; released on the ground,
 * it attack-moves the selected soldiers. Long-press + drag, or the Box button then a drag,
 * box-selects (a tap cancels Box). The Orders sheet button only arms the next tap.
 * #select-same-btn selects every
 * visible own unit of the selected kind. While placing, a tap moves the ghost, a finger on the
 * ghost drags it, and #place-bar's ⟳ / ✕ / ✓ rotate, cancel, confirm.
 * Also binds the touch buttons (#touch-box, #touch-select-all, #touch-deselect, #touch-fps), #explore-btn,
 * #cancel-build-btn, #command-card, the side rail, runs discovery toasts and combat alerts, and
 * mirrors the camera mode as `fps-mode` on <body> (and attack-move targeting as `targeting`).
 * Owned by the Controls lane (T6). Public surface FROZEN: constructor, update.
 */
export class Controls {
  private readonly box: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  /** Touch box-select in progress. */
  private touchBox: ScreenRect | null = null;
  /** Last painted state of the Box button and its hint, so a frame does not rewrite the DOM. */
  private boxArmOn: boolean | null = null;
  readonly placement: Placement;
  private readonly discoveries: Discoveries;
  private readonly alerts: Alerts;
  readonly groups = new ControlGroups();
  private readonly help = new HotkeyHelp();
  private readonly rail: SideRail;
  private readonly rallyFlag: RallyFlag;
  private readonly idle = new IdleCycler();
  /** Rally points this client set, shown until the sim reports Building.rally itself. */
  private readonly rallyEcho = new Map<EntityId, Vec2>();
  /** Attack-move armed: the next ground click / tap attack-moves. */
  private targeting = false;
  /** Pause menu is up: orders and placement wait. Camera input is skipped by Game. */
  private suspended = false;
  /** Help, placement, or targeting already used Escape this frame, so it must not also pause. */
  escapeUsed = false;
  private lastClick: { id: EntityId; time: number } | null = null;
  private lastIdleCount = -Infinity;
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
    this.alerts = new Alerts(this.discoveries.root, world, (p) => rig.focusOn(p));
    this.rail = new SideRail({
      idle: () => this.nextIdle(),
      group: (n, assign) => (assign ? this.assignGroup(n, false) : this.recallGroup(n)),
      assign: (n) => this.assignGroup(n, false),
    });
    this.rallyFlag = new RallyFlag((p) => this.project(p));

    world.events.on('removed', (e) => {
      selection.remove([e.id]);
      this.groups.remove(e.id);
      this.rallyEcho.delete(e.id);
    });
    onScoutFocus(world, (id) => selection.set([id]));
    selection.onChange(() => {
      if (this.placement.active && !this.villagerIds().length) this.placement.cancel();
      if (this.targeting && !this.ownUnitIds().length) this.setTargeting(false);
    });
    rig.onModeChange((mode) => {
      if (mode === 'fps') {
        this.touchBox = null;
        this.showBox(null);
        this.placement.cancel();
        this.setTargeting(false);
        input.touch.disarmBox();
      }
      this.syncMode();
      this.syncBoxArm();
    });
    bindButton('touch-box', () => this.toggleBoxArm());
    bindButton('select-same-btn', () => this.selectSameKind());
    bindButton('touch-select-all', () => this.selectAllOwn());
    bindButton('touch-deselect', () => selection.clear());
    bindButton('touch-fps', () => rig.setMode(rig.mode === 'rts' ? 'fps' : 'rts'));
    bindButton('explore-btn', () => this.explore());
    bindButton('cancel-build-btn', () => this.cancelSelectedFoundation());
    bindButton('town-bell-btn', () => this.deps.world.dispatch({ type: 'townBell' }));
    bindButton('ungarrison-btn', () => this.ungarrison());
    bindButton('place-rotate', () => this.placement.rotate(1));
    bindButton('place-cancel', () => this.placement.cancel());
    bindButton('place-confirm', () => this.placement.confirm(false));
    document.getElementById('build-grid')?.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('[data-build]');
      if (!btn) return;
      btn.blur();
      this.beginPlacement(btn.dataset.build as BuildingKind);
    });
    document.getElementById('command-card')?.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('[data-cmd], [data-stance]');
      if (!btn) return;
      btn.blur();
      if (btn.dataset.cmd === 'attackMove') this.setTargeting(!this.targeting);
      else if (btn.dataset.cmd === 'stop') this.stop();
      else if (btn.dataset.stance) this.setStance(btn.dataset.stance as Stance);
    });
    this.syncMode();
  }

  /** Send the selected units that can explore off to auto-explore. */
  explore(): void {
    const { world } = this.deps;
    const units = this.ownUnitIds().flatMap((id) => world.units.get(id) ?? []);
    const unitIds = explorerIds(units);
    if (unitIds.length) world.dispatch({ type: 'explore', unitIds });
  }

  /**
   * Freeze orders while the pause menu is open. Drops an in-progress placement or attack-move
   * so Escape belongs to the menu. Help can still close on its own Escape.
   */
  hold(on: boolean): void {
    this.suspended = on;
    if (!on) return;
    if (this.placement.active) this.placement.cancel();
    if (this.targeting) this.setTargeting(false);
    this.deps.input.touch.disarmBox();
    this.touchBox = null;
    this.showBox(null);
  }

  update(dt: number): void {
    const { input, rig } = this.deps;
    this.escapeUsed = false;
    this.time += dt;
    this.discoveries.update(this.time);
    this.alerts.update(this.time);
    this.updateRail();
    this.rallyFlag.update(rig.mode === 'rts' ? this.rallyPoint() : null);
    const slash = input.keyMods('Slash');
    if (slash?.shift && !slash.ctrl && !slash.alt) this.help.toggle();
    if (this.help.open) {
      if (input.keyPressed('Escape')) {
        this.help.close();
        this.escapeUsed = true;
      }
      this.syncBoxArm();
      return;
    }
    if (this.suspended) {
      this.syncBoxArm();
      return;
    }
    if (rig.mode !== 'rts') {
      this.syncBoxArm();
      return;
    }

    if (this.placement.active) {
      if (this.placement.line) this.updateLinePlacement();
      else this.updatePlacement();
      if (input.keyPressed('Escape')) this.escapeUsed = true;
      this.syncBoxArm();
      return;
    }

    for (const g of input.touch.gestures) this.gesture(g);

    const left = input.drag(LMB);
    const selecting = left && !left.withSpace ? left : undefined;
    const mouseBox = selecting?.held && selecting.dragging && !this.targeting ? dragRect(selecting) : null;
    this.showBox(mouseBox ?? this.touchBox);

    if (input.released(LMB) && selecting) {
      const kind = classifyRelease(selecting);
      if (kind === 'click' && this.targeting) this.targetClick(selecting.x, selecting.y, input.shift);
      else if (kind === 'click') this.clickSelect(selecting.x, selecting.y, input.shift);
      else if (kind === 'drag' && !this.targeting) this.boxSelect(dragRect(selecting), input.shift);
    }

    this.hotkeys();

    const right = input.drag(RMB);
    if (input.released(RMB) && right && classifyRelease(right) === 'click') {
      if (this.targeting) this.setTargeting(false);
      else this.order(right.x, right.y, input.ctrl);
    }
    this.syncBoxArm();
  }

  private hotkeys(): void {
    const { input, rig, world } = this.deps;
    /** Pressed this frame without Ctrl / Cmd / Alt (those combos belong to the browser or groups). */
    const plain = (code: string) => {
      const m = input.keyMods(code);
      return !!m && !m.ctrl && !m.alt;
    };
    if (input.keyPressed(HOTKEYS.cancel) && this.targeting) {
      this.setTargeting(false);
      this.escapeUsed = true;
    }
    if (plain(HOTKEYS.selectAll)) this.selectAllOwn();
    if (input.keyPressed(HOTKEYS.trainVillager)) {
      const tc = world.townCenterOf(world.localPlayer);
      if (tc) world.dispatch({ type: 'train', buildingId: tc.id });
    }
    if (input.keyPressed(HOTKEYS.explore)) this.explore();
    if (input.keyPressed(HOTKEYS.attackMove) && this.ownUnitIds().length) this.setTargeting(!this.targeting);
    if (input.keyPressed(HOTKEYS.stop)) this.stop();
    if (input.keyPressed(HOTKEYS.idleVillager)) this.nextIdle();
    if (input.keyPressed(HOTKEYS.scout) || input.keyPressed('NumpadDecimal') || input.keyPressed(HOTKEYS.scoutAlt)) {
      focusNextScout(world, rig);
    }
    if (plain(HOTKEYS.townBell)) world.dispatch({ type: 'townBell' });
    for (const code of buildHotkeyCodes()) {
      const kind = plain(code) ? kindForKey(code, !!input.keyMods(code)?.shift) : null;
      if (kind) this.beginPlacement(kind);
    }
    const trainer = this.rallyBuilding();
    if (trainer) {
      for (const code of TRAIN_SLOT_KEYS) {
        const unit = plain(code) ? kindForSlotKey(trainer.kind, code) : null;
        if (!unit || ageLockText(unitAge(unit), world.players.get(world.localPlayer)?.age ?? 0)) continue;
        const n = trainBatch(!!input.keyMods(code)?.shift);
        for (let i = 0; i < n; i++) world.dispatch({ type: 'train', buildingId: trainer.id, unit });
      }
    }
    for (const code of GROUP_CODES) {
      const m = input.keyMods(code);
      if (!m) continue;
      const n = groupForKey(code);
      if (m.ctrl || m.alt) this.assignGroup(n, m.shift);
      else this.recallGroup(n);
    }
  }

  /** Enter placement for `kind` if villagers are selected. Mouse: the ghost starts under the cursor. */
  private beginPlacement(kind: BuildingKind): void {
    const { input, rig } = this.deps;
    const builders = this.villagerIds();
    if (!builders.length) return;
    // Age-locked kinds stay greyed in the build menu ("Requires Town Age").
    const age = this.deps.world.players.get(this.deps.world.localPlayer)?.age ?? 0;
    if (ageLockText(BUILDINGS[kind].age, age)) return;
    this.showBox(null);
    this.touchBox = null;
    this.deps.input.touch.disarmBox();
    closeTouchMenus();
    this.setTargeting(false);
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
    if (input.keyPressed(HOTKEYS.rotate)) p.rotate(1);
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

  /**
   * Wall placement. A drag lays the line and release builds it; a click does not.
   * Touch drags are claimed by Placement, and the mouse events they synthesise are ignored.
   */
  private updateLinePlacement(): void {
    const { input } = this.deps;
    const p = this.placement;
    this.showBox(null);
    if (input.keyPressed('Escape')) {
      p.cancel();
      return;
    }
    const right = input.drag(RMB);
    if (input.released(RMB) && right && classifyRelease(right) === 'click') {
      p.cancel();
      return;
    }
    if (input.touch.isCompatMouse()) {
      p.refresh();
      return;
    }
    const left = input.drag(LMB);
    if (input.pressed(LMB) && left && !left.withSpace && input.inside && !input.overHud) {
      const g = this.groundAt(left.startX, left.startY);
      if (g) p.beginLine(g);
    }
    if (left && left.dragging && !left.withSpace && input.inside && !input.overHud) {
      const g = this.groundAt(left.x, left.y);
      if (g) p.extendLine(g);
    } else if (!left?.held && !input.touch.active && input.inside && !input.overHud) {
      const g = this.groundAt(input.x, input.y);
      if (g) p.moveTo(g);
      else p.refresh();
    } else {
      p.refresh();
    }
    if (input.released(LMB) && left && !left.withSpace) {
      if (left.dragging) p.confirmLine(input.shift);
      else p.endLineDrag();
    }
  }

  private gesture(g: GestureEvent): void {
    const { selection, world } = this.deps;
    switch (g.type) {
      case 'tap': {
        // A sheet is in the way: the tap dismisses it. The next tap orders.
        if (touchMenuOpen()) {
          closeTouchMenus();
          break;
        }
        if (this.targeting) {
          this.targetClick(g.x, g.y, false);
          break;
        }
        const ownUnits = this.ownUnitIds().length > 0;
        // Selected units can order work through friendly units overlapping the target.
        const picked = this.pickAt(g.x, g.y, ownUnits ? 'order' : 'select');
        const id = this.unitFromPick(picked);
        if (id !== null) {
          const own = world.units.get(id)?.owner === world.localPlayer;
          if (own) this.selectUnit(id);
          else if (ownUnits) this.order(g.x, g.y, false);
          else selection.set([id]);
          break;
        }
        // With units selected a tap orders them (attack / construct / farm / move); otherwise it selects the building.
        const b = this.buildingFromPick(picked);
        if (b !== null && !ownUnits) selection.set([b]);
        else this.order(g.x, g.y, false);
        break;
      }
      case 'longPress':
        // Ring while the finger is down. The order is the release; a drag from here is a box.
        this.pulse(g.x, g.y);
        break;
      case 'longPressTap': {
        const id = this.unitAt(g.x, g.y);
        const action = resolveLongPress({
          selected: this.ownUnitIds().flatMap((unitId) => {
            const u = world.units.get(unitId);
            return u ? [{ id: unitId, kind: u.kind }] : [];
          }),
          ownUnitId: id !== null && this.isOwnUnit(id) ? id : null,
          ground: this.groundAt(g.x, g.y),
        });
        if (!action) break;
        if (action.type === 'toggle') this.toggle(action.id);
        else {
          world.dispatch(action);
          this.deps.views.flashMarker(action.target);
          this.setTargeting(false);
        }
        break;
      }
      case 'box':
        if (!this.touchBox) closeTouchMenus();
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

  private pickAt(x: number, y: number, intent: PickIntent = 'select'): EntityId | null {
    const { views, rig, input } = this.deps;
    return views.pick(toNdc(x, y, input.width, input.height), rig.camera, intent);
  }

  /** A unit under the pointer: any of ours, or someone else's only where we can see it. */
  private unitAt(x: number, y: number): EntityId | null {
    return this.unitFromPick(this.pickAt(x, y));
  }

  private unitFromPick(id: EntityId | null): EntityId | null {
    const u = id !== null ? this.deps.world.units.get(id) : undefined;
    if (!u) return null;
    return u.owner === this.deps.world.localPlayer || this.deps.world.visibility.isVisible(u.pos.x, u.pos.z) ? u.id : null;
  }

  /** Enemy buildings count only while their cell is visible. */
  private buildingFromPick(id: EntityId | null): EntityId | null {
    const b = id !== null ? this.deps.world.buildings.get(id) : undefined;
    if (!b) return null;
    if (b.owner !== this.deps.world.localPlayer && !this.deps.world.visibility.isVisible(b.pos.x, b.pos.z)) return null;
    return b.id;
  }

  private groundAt(x: number, y: number): Vec2 | null {
    const { rig, input } = this.deps;
    return pickGround(screenRay(rig.camera, x, y, input.width, input.height), rig.rts.hf);
  }

  /** Ground point → client px (for the rally flag). */
  private project(p: Vec2): { x: number; y: number } | null {
    const { rig, input, canvas } = this.deps;
    const y = Math.max(0, rig.rts.hf.heightAt(p.x, p.z));
    const at = projectToCanvas(rig.camera, p.x, y, p.z, input.width, input.height);
    if (!at) return null;
    const c = canvas.getBoundingClientRect();
    return { x: c.left + at.x, y: c.top + at.y };
  }

  /** What targeting needs to know about an entity id (nodes count as gaia, visible once explored). */
  private hitEntity(id: EntityId | null): HitEntity | null {
    if (id === null) return null;
    const { world } = this.deps;
    const vis = world.visibility;
    const u = world.units.get(id);
    if (u) return { id, kind: u.kind, owner: u.owner, pos: u.pos, visible: u.owner === world.localPlayer || vis.isVisible(u.pos.x, u.pos.z) };
    const b = world.buildings.get(id);
    if (b) return { id, owner: b.owner, pos: b.pos, visible: b.owner === world.localPlayer || vis.isVisible(b.pos.x, b.pos.z) };
    const n = world.nodes.get(id);
    if (n) return { id, owner: GAIA, pos: n.pos, visible: vis.isExplored(n.pos.x, n.pos.z) };
    return null;
  }

  private isOwnUnit(id: EntityId): boolean {
    return this.deps.world.units.get(id)?.owner === this.deps.world.localPlayer;
  }

  /** Selected units the local player owns (enemy selections are inspect-only). */
  private ownUnitIds(): EntityId[] {
    return [...this.deps.selection.ids].filter((id) => this.isOwnUnit(id));
  }

  /** Selected own villagers (the ones that can build). */
  private villagerIds(): EntityId[] {
    const { world } = this.deps;
    return this.ownUnitIds().filter((id) => world.units.get(id)?.kind === 'villager');
  }

  /** The selected own building that trains units (and so has a rally point), if that is the selection. */
  private rallyBuilding(): Building | null {
    const { world, selection } = this.deps;
    if (selection.ids.size !== 1) return null;
    const [id] = selection.ids;
    const b = world.buildings.get(id);
    return b && b.owner === world.localPlayer && canTrainAt(b) ? b : null;
  }

  private rallyPoint(): Vec2 | null {
    const b = this.rallyBuilding();
    if (!b) return null;
    return b.rally?.pos ?? this.rallyEcho.get(b.id) ?? null;
  }

  /** Box button: the next one-finger drag selects units. A tap cancels, and does not order. */
  private toggleBoxArm(): void {
    const { input, rig } = this.deps;
    if (rig.mode !== 'rts') return;
    if (input.touch.boxArmed) input.touch.disarmBox();
    else {
      input.touch.armBox();
      closeTouchMenus();
    }
    this.syncBoxArm();
  }

  /** Paint the Box button and the "drag around your units" hint from the recogniser. */
  private syncBoxArm(): void {
    const on = this.deps.rig.mode === 'rts' && (this.deps.input.touch.boxArmed || this.touchBox !== null);
    if (on === this.boxArmOn) return;
    this.boxArmOn = on;
    document.getElementById('touch-box')?.setAttribute('aria-pressed', String(on));
    const hint = document.getElementById('select-hint');
    if (hint) hint.hidden = !on;
  }

  private selectAllOwn(): void {
    const { world, selection } = this.deps;
    selection.set(
      [...world.units.values()]
        .filter((u) => u.owner === world.localPlayer && u.state !== 'garrisoned')
        .map((u) => u.id)
    );
  }

  /** The selected own building villagers can shelter in. */
  private shelterBuilding(): Building | null {
    const { world, selection } = this.deps;
    if (selection.ids.size !== 1) return null;
    const [id] = selection.ids;
    const b = world.buildings.get(id);
    if (!b || b.owner !== world.localPlayer || !b.complete || !(BUILDINGS[b.kind].garrison ?? 0)) return null;
    return b;
  }

  /** Empty the selected shelter. */
  private ungarrison(): void {
    const b = this.shelterBuilding();
    if (b && b.occupants?.length) this.deps.world.dispatch({ type: 'ungarrison', buildingId: b.id });
  }

  private toggle(id: EntityId): void {
    const { selection } = this.deps;
    if (selection.has(id)) selection.remove([id]);
    else selection.add([id]);
  }

  /** Select one own unit; a quick second click / tap on it selects every own unit of its kind on screen. */
  private selectUnit(id: EntityId): void {
    const { world, selection } = this.deps;
    const prev = this.lastClick;
    this.lastClick = { id, time: this.time };
    if (prev && prev.id === id && this.time - prev.time <= DOUBLE_CLICK_S) {
      this.lastClick = null;
      const kind = world.units.get(id)?.kind;
      const ids = kind ? this.ownIdsOfKindOnScreen(kind) : [];
      selection.set(ids.length ? ids : [id]);
      return;
    }
    selection.set([id]);
  }

  /** Every own, non-garrisoned unit of `kind` currently on screen. */
  private ownIdsOfKindOnScreen(kind: UnitKind): EntityId[] {
    const { world, views, rig, input } = this.deps;
    return views
      .idsInRect({ x0: 0, y0: 0, x1: input.width, y1: input.height }, rig.camera, { width: input.width, height: input.height })
      .filter((u) => {
        const unit = world.units.get(u);
        return unit?.owner === world.localPlayer && unit.kind === kind && unit.state !== 'garrisoned';
      });
  }

  /** Select every visible own unit of the same kind as the current selection. */
  private selectSameKind(): void {
    const { world, selection } = this.deps;
    const own = this.ownUnitIds().flatMap((id) => world.units.get(id) ?? []);
    const kind = own[0]?.kind;
    if (!kind || own.some((u) => u.kind !== kind)) return;
    const ids = this.ownIdsOfKindOnScreen(kind);
    if (ids.length) selection.set(ids);
  }

  private clickSelect(x: number, y: number, additive: boolean): void {
    const { selection } = this.deps;
    const picked = this.pickAt(x, y);
    const unit = this.unitFromPick(picked);
    const building = unit === null ? this.buildingFromPick(picked) : null;
    if (unit !== null && this.isOwnUnit(unit)) {
      if (!additive) this.selectUnit(unit);
      else if (this.ownUnitIds().length === selection.ids.size) this.toggle(unit);
      else selection.set([unit]);
    } else if (unit !== null) {
      selection.set([unit]);
    } else if (building !== null) {
      selection.set([building]);
    } else if (!additive) {
      selection.clear();
    }
  }

  private boxSelect(rect: ScreenRect, additive: boolean): void {
    const { selection, views, world, rig, input } = this.deps;
    const ids = views
      .idsInRect(rect, rig.camera, { width: input.width, height: input.height })
      .filter((id) => this.isOwnUnit(id));
    if (!ids.length && !additive) {
      // An empty box over nothing of ours keeps an enemy inspection from lingering.
      if ([...selection.ids].some((id) => !this.isOwnUnit(id) && world.units.has(id))) selection.clear();
      return;
    }
    if (additive && this.ownUnitIds().length === selection.ids.size) selection.add(ids);
    else selection.set(ids);
  }

  /** RMB / tap order at a screen point. `attackMove`: Ctrl+RMB. */
  private order(x: number, y: number, attackMove: boolean): void {
    const { views, world } = this.deps;
    const unitIds = this.ownUnitIds();
    const ground = this.groundAt(x, y);
    if (attackMove) {
      const cmd = resolveAttackMove(unitIds, ground);
      if (cmd) {
        world.dispatch(cmd);
        views.flashMarker(cmd.target);
      }
      return;
    }
    const id = this.pickAt(x, y, unitIds.length ? 'order' : 'select');
    const hit = this.hitEntity(id);
    const rally = unitIds.length ? null : this.rallyBuilding();
    const targetCmd = resolveTargetOrder({ unitIds, rallyBuildingId: rally?.id ?? null }, hit, ground, (owner) =>
      world.areEnemies(world.localPlayer, owner)
    );
    if (targetCmd) {
      world.dispatch(targetCmd);
      if (targetCmd.type === 'rally') {
        this.rallyEcho.set(targetCmd.buildingId, { ...targetCmd.pos });
        views.flashMarker(targetCmd.pos);
      }
      return;
    }
    if (!unitIds.length) return;
    const building = id !== null ? world.buildings.get(id) : undefined;
    const ownBuilding = building && building.owner === world.localPlayer ? building : undefined;
    const buildCmd = ownBuilding ? resolveBuildingOrder(this.villagerIds(), ownBuilding) : null;
    let movers = unitIds;
    // Trade carts onto an own or allied market trade with it (M8-12); everyone else carries on.
    const carts = unitIds.filter((u) => world.units.get(u)?.kind === 'tradeCart');
    const tradeCmd = resolveTradeOrder(carts, building, (o) => world.areEnemies(world.localPlayer, o));
    if (tradeCmd) {
      world.dispatch(tradeCmd);
      movers = movers.filter((u) => !carts.includes(u));
      if (!movers.length) return;
    }
    if (buildCmd) {
      world.dispatch(buildCmd);
      // Scouts and soldiers (which can't build or farm) just walk over.
      movers = movers.filter((u) => world.units.get(u)?.kind !== 'villager');
      if (!movers.length) return;
    }
    const node = id !== null ? world.nodes.get(id) : undefined;
    const nodeExplored = !!node && world.visibility.isExplored(node.pos.x, node.pos.z);
    const cmd = resolveOrder(movers, { nodeId: node?.id ?? null, nodeExplored, ground: node && nodeExplored ? null : ground });
    if (!cmd) return;
    world.dispatch(cmd);
    if (cmd.type === 'move') views.flashMarker(cmd.target);
  }

  /** Attack-move armed: a click / tap attacks a visible enemy under it, otherwise attack-moves there. */
  private targetClick(x: number, y: number, keepArmed: boolean): void {
    const { world, views } = this.deps;
    const unitIds = this.ownUnitIds();
    const hit = this.hitEntity(this.pickAt(x, y));
    const attack = resolveTargetOrder({ unitIds, rallyBuildingId: null }, hit, null, (o) => world.areEnemies(world.localPlayer, o));
    const cmd = attack ?? resolveAttackMove(unitIds, this.groundAt(x, y));
    if (cmd) {
      world.dispatch(cmd);
      if (cmd.type === 'attackMove') views.flashMarker(cmd.target);
    }
    if (!keepArmed) this.setTargeting(false);
  }

  private setTargeting(on: boolean): void {
    if (on && !this.ownUnitIds().length) on = false;
    this.targeting = on;
    document.body.classList.toggle('targeting', on);
    const btn = document.querySelector('#command-card [data-cmd="attackMove"]');
    btn?.setAttribute('aria-pressed', String(on));
  }

  private stop(): void {
    const unitIds = this.ownUnitIds();
    if (unitIds.length) this.deps.world.dispatch({ type: 'stop', unitIds });
    this.setTargeting(false);
  }

  /** Stances apply to the selected soldiers and scouts (villagers stay passive). */
  private setStance(stance: Stance): void {
    const { world } = this.deps;
    const unitIds = this.ownUnitIds().filter((id) => world.units.get(id)?.kind !== 'villager');
    if (unitIds.length) world.dispatch({ type: 'stance', unitIds, stance });
  }

  /** Ctrl+digit / long-press: put the selected own units (or own building) in group `n`. */
  private assignGroup(n: number, add: boolean): void {
    const { world, selection } = this.deps;
    const own = [...selection.ids].filter((id) => (world.units.get(id) ?? world.buildings.get(id))?.owner === world.localPlayer);
    if (add) this.groups.add(n, own);
    else this.groups.assign(n, own);
  }

  /** Digit / group button: select group `n`; a quick second press centres the camera on it. */
  private recallGroup(n: number): void {
    const { world, selection, rig } = this.deps;
    const ids = this.groups.get(n).filter((id) => {
      const u = world.units.get(id);
      if (u) return u.state !== 'garrisoned';
      return world.buildings.has(id);
    });
    if (!ids.length) return;
    if (this.groups.press(n, this.time) === 'centre') {
      const c = groupCentre(ids, (id) => (world.units.get(id) ?? world.buildings.get(id))?.pos);
      if (c) rig.focusOn(c);
    }
    selection.set(ids);
  }

  /** Select and centre on the next idle villager. */
  private nextIdle(): void {
    const { world, selection, rig } = this.deps;
    const u = this.idle.next(idleVillagers(world.units.values(), world.localPlayer));
    if (!u) return;
    selection.set([u.id]);
    rig.focusOn(u.pos);
  }

  private updateRail(): void {
    const { world } = this.deps;
    if (this.time - this.lastIdleCount >= IDLE_INTERVAL) {
      this.lastIdleCount = this.time;
      this.rail.setIdle(idleVillagers(world.units.values(), world.localPlayer).length);
    }
    this.rail.setGroups(this.groups.sizes());
  }

  /** Cancel the selected building if it is an unfinished foundation (refunds its cost). */
  private cancelSelectedFoundation(): void {
    const { world, selection } = this.deps;
    for (const id of selection.ids) {
      const b = world.buildings.get(id);
      if (b && !b.complete && b.owner === world.localPlayer) {
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
