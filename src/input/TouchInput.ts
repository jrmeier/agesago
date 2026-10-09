import { FpsTouch, STICK_RADIUS_PX, stickKnob, type StickVec } from './fpsTouch';
import { GestureRecognizer, type GestureEvent } from './gestures';

/** Mouse events this soon after a touch are treated as browser compatibility events and ignored. */
const COMPAT_MOUSE_MS = 800;

export type TouchMode = 'rts' | 'fps';

/**
 * Claims single-finger touches before gesture recognition (e.g. dragging a placement ghost).
 * down() returns true to take the pointer; it then gets move/up instead of the recogniser.
 */
export interface TouchGrab {
  down(x: number, y: number): boolean;
  move(x: number, y: number): void;
  up(): void;
}

/** Per-frame touch state read by Controls and the cameras. */
export interface TouchState {
  /** Gestures recognised since the last frame (RTS mode only). */
  readonly gestures: readonly GestureEvent[];
  /** Virtual-joystick movement vector (first-person mode); zero when idle. */
  readonly stick: StickVec;
  /** First-person look drag this frame, in CSS px. */
  readonly lookX: number;
  readonly lookY: number;
  /** The most recent pointer input was a touch (disables edge scroll). */
  readonly active: boolean;
}

/**
 * Pointer Events (pointerType 'touch') → gestures (RTS) or joystick + look (first person),
 * in canvas CSS px. Also draws the joystick and toggles the `touch` class on <body>
 * (set for coarse pointers or after any touch; cleared by a mouse press).
 */
export class TouchInput implements TouchState {
  active = false;
  lookX = 0;
  lookY = 0;
  private mode: TouchMode = 'rts';
  private lastTouch = -Infinity;
  private readonly frame: GestureEvent[] = [];
  private readonly recognizer = new GestureRecognizer();
  private readonly fps = new FpsTouch();
  private readonly ids = new Set<number>();
  private grabber: TouchGrab | null = null;
  /** Pointer currently owned by the grabber. */
  private grabbed: number | null = null;
  private readonly ring: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly off: (() => void)[] = [];

  constructor(private readonly dom: HTMLElement) {
    if (window.matchMedia?.('(pointer: coarse)').matches) setTouchClass(true);
    this.ring = document.createElement('div');
    this.ring.className = 'touch-stick';
    this.ring.style.width = this.ring.style.height = `${STICK_RADIUS_PX * 2}px`;
    this.knob = document.createElement('div');
    this.knob.className = 'touch-stick-knob';
    this.ring.appendChild(this.knob);
    document.body.appendChild(this.ring);

    this.listen(dom, 'pointerdown', this.onDown);
    this.listen(window, 'pointermove', this.onMove);
    this.listen(window, 'pointerup', this.onUp);
    this.listen(window, 'pointercancel', this.onCancel);
    this.listen(window, 'pointerdown', this.onAnyDown, true);
    // iOS Safari page pinch-zoom; touch-action covers the rest.
    this.listen(document, 'gesturestart', (e) => e.preventDefault());
  }

  get gestures(): readonly GestureEvent[] {
    if (this.mode === 'rts') this.frame.push(...this.recognizer.tick(performance.now()));
    return this.frame;
  }

  get stick(): StickVec {
    return this.fps.vector;
  }

  /** True if a mouse event is likely synthesised from a recent touch. */
  isCompatMouse(): boolean {
    return performance.now() - this.lastTouch < COMPAT_MOUSE_MS;
  }

  /** Route touches for a camera mode; abandons any gesture in progress. */
  setMode(mode: TouchMode): void {
    if (mode === this.mode) return;
    this.frame.push(...this.recognizer.reset());
    this.fps.reset();
    this.ids.clear();
    if (this.grabbed !== null) this.grabber?.up();
    this.grabbed = null;
    this.mode = mode;
    this.drawStick();
  }

  /** True while the next one-finger drag box-selects instead of panning. */
  get boxArmed(): boolean {
    return this.recognizer.boxArmed;
  }

  /** Arm the next one-finger drag as a selection box. A tap cancels it. */
  armBox(): void {
    this.recognizer.armBox();
  }

  disarmBox(): void {
    this.recognizer.disarmBox();
  }

  /** Install (or clear with null) a grabber that may claim new single-finger touches in RTS mode. */
  setGrabber(g: TouchGrab | null): void {
    if (this.grabbed !== null && g !== this.grabber) {
      this.ids.delete(this.grabbed);
      this.grabbed = null;
    }
    this.grabber = g;
  }

  endFrame(): void {
    this.frame.length = 0;
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose(): void {
    for (const fn of this.off) fn();
    this.off.length = 0;
    this.ring.remove();
  }

  private listen(target: EventTarget, type: string, fn: (e: PointerEvent) => void, capture = false): void {
    const opts = { capture, passive: false };
    target.addEventListener(type, fn as EventListener, opts);
    this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.dom.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onAnyDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.isCompatMouse()) return;
    this.active = false;
    setTouchClass(false);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    // Suppresses compatibility mouse events and native long-press / double-tap handling.
    e.preventDefault();
    this.lastTouch = performance.now();
    this.active = true;
    setTouchClass(true);
    this.ids.add(e.pointerId);
    const { x, y } = this.local(e);
    if (this.mode === 'rts' && this.grabber && this.recognizer.count === 0 && this.grabbed === null && this.grabber.down(x, y)) {
      this.grabbed = e.pointerId;
      return;
    }
    if (this.mode === 'rts') this.frame.push(...this.recognizer.down(e.pointerId, x, y, this.lastTouch));
    else {
      this.fps.down(e.pointerId, x, y, this.dom.clientWidth || window.innerWidth);
      this.drawStick();
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.ids.has(e.pointerId)) return;
    this.lastTouch = performance.now();
    const { x, y } = this.local(e);
    if (e.pointerId === this.grabbed) {
      this.grabber?.move(x, y);
      return;
    }
    if (this.mode === 'rts') {
      this.frame.push(...this.recognizer.move(e.pointerId, x, y, this.lastTouch));
      return;
    }
    this.fps.move(e.pointerId, x, y);
    const d = this.fps.takeLook();
    this.lookX += d.x;
    this.lookY += d.y;
    this.drawStick();
  };

  private onUp = (e: PointerEvent): void => this.lift(e, false);

  private onCancel = (e: PointerEvent): void => this.lift(e, true);

  private lift(e: PointerEvent, cancelled: boolean): void {
    if (!this.ids.delete(e.pointerId)) return;
    this.lastTouch = performance.now();
    if (e.pointerId === this.grabbed) {
      this.grabbed = null;
      this.grabber?.up();
      return;
    }
    if (this.mode === 'rts') {
      const { x, y } = this.local(e);
      this.frame.push(
        ...(cancelled ? this.recognizer.cancel(e.pointerId) : this.recognizer.up(e.pointerId, x, y, this.lastTouch))
      );
    } else {
      this.fps.up(e.pointerId);
      this.drawStick();
    }
  }

  private drawStick(): void {
    const s = this.fps.stick;
    this.ring.style.display = s ? 'block' : 'none';
    if (!s) return;
    const r = this.dom.getBoundingClientRect();
    const k = stickKnob(s.cx, s.cy, s.x, s.y);
    this.ring.style.left = `${r.left + s.cx - STICK_RADIUS_PX}px`;
    this.ring.style.top = `${r.top + s.cy - STICK_RADIUS_PX}px`;
    this.knob.style.transform = `translate(-50%, -50%) translate(${k.x}px, ${k.y}px)`;
  }
}

function setTouchClass(on: boolean): void {
  document.body.classList.toggle('touch', on);
}
