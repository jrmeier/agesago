import { TouchInput } from './TouchInput';

/**
 * Raw pointer/keyboard state with per-frame edge events (pressed / released this frame,
 * wheel delta, drag tracking with the 5 px click-vs-drag threshold). Touch input lives in
 * `touch`; mouse events synthesised from touches are ignored.
 * Owned by the Controls lane (T5/T6). Internal API is up to the lane;
 * Game only relies on: constructor(dom), endFrame(), dispose().
 */
export const DRAG_THRESHOLD_PX = 5;

/** Mouse buttons as reported by MouseEvent.button. */
export const LMB = 0;
export const RMB = 2;

/** HUD elements that take clicks; the camera ignores the pointer while over them. */
const HUD_INTERACTIVE = 'button, a, input, select, textarea, [data-hud-interactive]';

/** True once the pointer has moved far enough from its press point to count as a drag. */
export function exceedsDragThreshold(sx: number, sy: number, x: number, y: number): boolean {
  return Math.hypot(x - sx, y - sy) > DRAG_THRESHOLD_PX;
}

/** Press-to-current tracking for one mouse button, in canvas CSS px. */
export interface DragState {
  readonly button: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  /** Latched true once the pointer passed DRAG_THRESHOLD_PX; a release without it is a click. */
  dragging: boolean;
  /** Button still held. */
  held: boolean;
  /** Space was held when the button went down (Space+LMB = pan). */
  readonly withSpace: boolean;
}

export class Input {
  /** Pointer position in canvas CSS px. */
  x = 0;
  y = 0;
  /** Pointer position in window client px (for edge scroll). */
  clientX = 0;
  clientY = 0;
  /** Pointer is inside the window. */
  inside = false;
  /** Pointer is over an interactive HUD element (e.g. #train-btn). */
  overHud = false;
  /** Pointer movement this frame in CSS px. */
  moveX = 0;
  moveY = 0;
  /** Wheel delta this frame in pixels (positive = scroll down / zoom out). */
  wheel = 0;
  /** Touch gestures (RTS) and joystick / look (first person). */
  readonly touch: TouchInput;

  private readonly buttons = new Set<number>();
  private readonly pressedButtons = new Set<number>();
  private readonly releasedButtons = new Set<number>();
  private readonly drags = new Map<number, DragState>();
  private readonly keys = new Set<string>();
  private readonly pressedKeys = new Set<string>();
  private readonly pressedMods = new Map<string, { ctrl: boolean; alt: boolean; shift: boolean }>();
  private readonly off: (() => void)[] = [];

  constructor(readonly dom: HTMLElement) {
    this.touch = new TouchInput(dom);
    this.listen(dom, 'mousedown', this.onDown);
    this.listen(window, 'mousemove', this.onMove);
    this.listen(window, 'mouseup', this.onUp);
    this.listen(document, 'mouseout', this.onOut);
    this.listen(dom, 'wheel', this.onWheel, { passive: false });
    this.listen(dom, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', this.onKeyDown);
    this.listen(window, 'keyup', this.onKeyUp);
    this.listen(window, 'blur', this.onBlur);
  }

  /** Canvas size in CSS px. */
  get width(): number {
    return this.dom.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.dom.clientHeight || window.innerHeight;
  }

  /** Window size in CSS px. */
  get viewWidth(): number {
    return window.innerWidth;
  }

  get viewHeight(): number {
    return window.innerHeight;
  }

  isDown(button: number): boolean {
    return this.buttons.has(button);
  }

  pressed(button: number): boolean {
    return this.pressedButtons.has(button);
  }

  released(button: number): boolean {
    return this.releasedButtons.has(button);
  }

  /** Drag state for a button pressed on the canvas; kept through its release frame. */
  drag(button: number): DragState | undefined {
    return this.drags.get(button);
  }

  /** Key held, by KeyboardEvent.code (e.g. 'KeyW', 'Space', 'ShiftLeft'). */
  key(code: string): boolean {
    return this.keys.has(code);
  }

  /** Key went down this frame (auto-repeat ignored). */
  keyPressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  /**
   * Modifiers held when `code` went down this frame (null if it didn't). Read from the event,
   * so a quick Ctrl+1 whose Ctrl is released before the next frame still counts as Ctrl+1.
   */
  keyMods(code: string): { ctrl: boolean; alt: boolean; shift: boolean } | null {
    return this.pressedMods.get(code) ?? null;
  }

  get space(): boolean {
    return this.keys.has('Space');
  }

  get shift(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Ctrl, or Cmd on a Mac (control-group assign, Ctrl+right-click attack-move). */
  get ctrl(): boolean {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('MetaLeft') || this.keys.has('MetaRight');
  }

  get alt(): boolean {
    return this.keys.has('AltLeft') || this.keys.has('AltRight');
  }

  /** Clear per-frame edge state. Called by Game once at the end of every frame. */
  endFrame(): void {
    this.pressedButtons.clear();
    this.releasedButtons.clear();
    this.pressedKeys.clear();
    this.pressedMods.clear();
    this.wheel = 0;
    this.moveX = 0;
    this.moveY = 0;
    for (const [b, d] of this.drags) if (!d.held) this.drags.delete(b);
    this.touch.endFrame();
  }

  dispose(): void {
    for (const fn of this.off) fn();
    this.off.length = 0;
    this.touch.dispose();
  }

  private listen<K extends keyof WindowEventMap>(
    target: EventTarget,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions
  ): void {
    target.addEventListener(type, fn as EventListener, opts);
    this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private setPointer(e: MouseEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.clientX = e.clientX;
    this.clientY = e.clientY;
    this.x = e.clientX - r.left;
    this.y = e.clientY - r.top;
    this.inside = true;
  }

  private onDown = (e: MouseEvent): void => {
    if (this.touch.isCompatMouse()) return;
    this.setPointer(e);
    this.buttons.add(e.button);
    this.pressedButtons.add(e.button);
    this.drags.set(e.button, {
      button: e.button,
      startX: this.x,
      startY: this.y,
      x: this.x,
      y: this.y,
      dragging: false,
      held: true,
      withSpace: this.space,
    });
    if (document.activeElement instanceof HTMLElement && document.activeElement !== this.dom) {
      document.activeElement.blur();
    }
  };

  private onMove = (e: MouseEvent): void => {
    if (this.touch.isCompatMouse()) return;
    this.setPointer(e);
    this.moveX += e.movementX;
    this.moveY += e.movementY;
    this.overHud = e.target instanceof Element && e.target.closest(HUD_INTERACTIVE) !== null;
    for (const d of this.drags.values()) {
      if (!d.held) continue;
      d.x = this.x;
      d.y = this.y;
      if (!d.dragging) d.dragging = exceedsDragThreshold(d.startX, d.startY, d.x, d.y);
    }
  };

  private onUp = (e: MouseEvent): void => {
    if (!this.buttons.delete(e.button)) return;
    this.setPointer(e);
    this.releasedButtons.add(e.button);
    const d = this.drags.get(e.button);
    if (d) d.held = false;
  };

  private onOut = (e: MouseEvent): void => {
    if (!e.relatedTarget) this.inside = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setPointer(e);
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    this.wheel += e.deltaY * scale;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTextField(e.target)) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    // Ctrl / Cmd / Alt + digit assigns a control group; keep the browser's hands off where it lets us.
    if ((e.ctrlKey || e.metaKey || e.altKey) && /^(Digit|Numpad)[1-9]$/.test(e.code)) e.preventDefault();
    if (e.repeat) return;
    // macOS sends no keyup for keys released while Cmd is held, so a stale entry may linger.
    if (this.keys.has(e.code) && !e.metaKey) return;
    this.keys.add(e.code);
    this.pressedKeys.add(e.code);
    this.pressedMods.set(e.code, { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey });
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') e.preventDefault();
    this.keys.delete(e.code);
    if (e.key === 'Meta') {
      // Drop keys whose keyup macOS swallowed while Cmd was down (modifiers keep their own state).
      for (const k of [...this.keys]) if (!/^(Shift|Control|Alt|Meta)/.test(k)) this.keys.delete(k);
    }
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.inside = false;
    // Abandon in-progress presses rather than reporting releases, so focus loss issues no click.
    this.buttons.clear();
    this.drags.clear();
  };
}

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
