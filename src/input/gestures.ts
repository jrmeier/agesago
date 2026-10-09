/** A press that moves no further than this (px) and lifts within TAP_MAX_MS is a tap. */
export const TAP_MAX_MOVE_PX = 10;
export const TAP_MAX_MS = 300;
/** Holding still this long (ms) arms a long-press (box select / toggle). */
export const LONG_PRESS_MS = 450;
/** Per-sample bound on the pinch spread ratio, so a glitchy sample cannot zoom wildly. */
const MAX_PINCH_STEP = 2;

/**
 * Touch gestures in canvas CSS px.
 * - tap: quick press-and-release without moving.
 * - longPress: a finger has been held still for LONG_PRESS_MS (feedback only).
 * - longPressTap: a long-press released without moving.
 * - box / boxEnd / boxCancel: long-press then drag, or a drag while a box is armed; (x0, y0) is the press point.
 * - armCancel: an armed box was cancelled by a tap or a second finger (not a tap, and not an order).
 * - panStart / pan / panEnd: grab-the-ground pan; panStart re-anchors (finger count changed).
 * - pinch: the two-finger spread changed by `scale` (> 1 = fingers apart = zoom in) about (x, y).
 */
export type GestureEvent =
  | { type: 'tap' | 'longPress' | 'longPressTap' | 'panStart' | 'pan'; x: number; y: number }
  | { type: 'box' | 'boxEnd'; x0: number; y0: number; x: number; y: number }
  | { type: 'boxCancel' | 'panEnd' | 'armCancel' }
  | { type: 'pinch'; x: number; y: number; scale: number };

interface Track {
  readonly id: number;
  readonly startX: number;
  readonly startY: number;
  readonly startT: number;
  x: number;
  y: number;
}

type Mode = 'idle' | 'pending' | 'held' | 'box' | 'pan' | 'multi';

/**
 * DOM-free touch gesture recogniser. Feed it timestamped pointer samples (canvas px, ms)
 * and call tick() every frame so a motionless long-press is detected; each call returns
 * the gestures it recognised. Only the first two active pointers are used.
 */
export class GestureRecognizer {
  private readonly tracks = new Map<number, Track>();
  private mode: Mode = 'idle';
  /** Next one-finger drag draws a selection box instead of panning. A tap cancels it. */
  private armed = false;
  /** Ids of the pointer pair driving a multi-touch gesture, and their last spread. */
  private pair: [number, number] | null = null;
  private spread = 0;

  /** Number of active pointers. */
  get count(): number {
    return this.tracks.size;
  }

  /** True while the next one-finger drag should box-select. */
  get boxArmed(): boolean {
    return this.armed;
  }

  /** Arm the next one-finger drag as a selection box. A tap, a second finger, or reset() disarms it. */
  armBox(): void {
    this.armed = true;
  }

  disarmBox(): void {
    this.armed = false;
  }

  down(id: number, x: number, y: number, t: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    if (this.tracks.has(id)) return out;
    this.tracks.set(id, { id, startX: x, startY: y, startT: t, x, y });
    if (this.tracks.size === 1) {
      this.mode = 'pending';
      return out;
    }
    if (this.tracks.size > 2) return out;
    if (this.mode === 'box') out.push({ type: 'boxCancel' });
    if (this.armed) {
      this.armed = false;
      out.push({ type: 'armCancel' });
    }
    this.mode = 'multi';
    this.repair(out);
    return out;
  }

  move(id: number, x: number, y: number, t: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    const p = this.tracks.get(id);
    if (!p) return out;
    p.x = x;
    p.y = y;
    switch (this.mode) {
      case 'pending':
        // Still pending past the deadline means it was motionless until this sample.
        if (t - p.startT >= LONG_PRESS_MS) {
          this.mode = 'held';
          out.push({ type: 'longPress', x: p.startX, y: p.startY });
          this.heldMoved(p, out);
        } else if (moved(p)) {
          if (this.armed) this.beginBox(p, out);
          else {
            this.mode = 'pan';
            out.push({ type: 'panStart', x: p.startX, y: p.startY }, { type: 'pan', x, y });
          }
        }
        break;
      case 'held':
        this.heldMoved(p, out);
        break;
      case 'box':
        out.push(boxEvent('box', p));
        break;
      case 'pan':
        out.push({ type: 'pan', x, y });
        break;
      case 'multi':
        if (this.pair?.includes(id)) this.pairMoved(out);
        break;
    }
    return out;
  }

  up(id: number, x: number, y: number, t: number): GestureEvent[] {
    const p = this.tracks.get(id);
    if (!p) return [];
    p.x = x;
    p.y = y;
    return this.lift(p, t, false);
  }

  /** Pointer cancelled by the browser: end its gesture without a tap / selection result. */
  cancel(id: number): GestureEvent[] {
    const p = this.tracks.get(id);
    return p ? this.lift(p, 0, true) : [];
  }

  /** Detect a long-press while the finger is motionless (no move samples arrive). */
  tick(t: number): GestureEvent[] {
    if (this.mode !== 'pending') return [];
    const p = this.first();
    if (!p || t - p.startT < LONG_PRESS_MS) return [];
    this.mode = 'held';
    return [{ type: 'longPress', x: p.startX, y: p.startY }];
  }

  /** Abandon everything in progress (e.g. on a camera-mode switch). */
  reset(): GestureEvent[] {
    const out: GestureEvent[] = [];
    if (this.mode === 'box') out.push({ type: 'boxCancel' });
    if (this.mode === 'pan' || this.mode === 'multi') out.push({ type: 'panEnd' });
    this.tracks.clear();
    this.mode = 'idle';
    this.pair = null;
    this.armed = false;
    return out;
  }

  private lift(p: Track, t: number, cancelled: boolean): GestureEvent[] {
    const out: GestureEvent[] = [];
    this.tracks.delete(p.id);
    switch (this.mode) {
      case 'pending': {
        const dt = t - p.startT;
        if (cancelled || moved(p)) break;
        if (dt < TAP_MAX_MS) {
          if (this.armed) {
            this.armed = false;
            out.push({ type: 'armCancel' });
          } else out.push({ type: 'tap', x: p.startX, y: p.startY });
        } else if (dt >= LONG_PRESS_MS) {
          this.armed = false;
          out.push({ type: 'longPress', x: p.startX, y: p.startY }, { type: 'longPressTap', x: p.startX, y: p.startY });
        }
        break;
      }
      case 'held':
        this.armed = false;
        if (!cancelled) out.push({ type: 'longPressTap', x: p.startX, y: p.startY });
        break;
      case 'box':
        out.push(cancelled ? { type: 'boxCancel' } : boxEvent('boxEnd', p));
        break;
      case 'pan':
        out.push({ type: 'panEnd' });
        break;
      case 'multi': {
        const rest = this.first();
        if (!rest) {
          out.push({ type: 'panEnd' });
        } else if (this.tracks.size === 1) {
          // Keep panning with the remaining finger, re-anchored under it.
          this.mode = 'pan';
          this.pair = null;
          out.push({ type: 'panStart', x: rest.x, y: rest.y });
        } else if (this.pair?.includes(p.id)) {
          this.repair(out);
        }
        // Once multi-touch, a gesture never turns into a tap or selection.
        return out;
      }
    }
    this.mode = 'idle';
    this.pair = null;
    return out;
  }

  private heldMoved(p: Track, out: GestureEvent[]): void {
    if (!moved(p)) return;
    this.beginBox(p, out);
  }

  /** Start a selection box from the press point and drop any arm (it has been used). */
  private beginBox(p: Track, out: GestureEvent[]): void {
    this.armed = false;
    this.mode = 'box';
    out.push(boxEvent('box', p));
  }

  /** Re-pick the driving pair (first two pointers) and re-anchor the pan at their midpoint. */
  private repair(out: GestureEvent[]): void {
    const [a, b] = this.tracks.values();
    this.pair = [a.id, b.id];
    this.spread = Math.hypot(b.x - a.x, b.y - a.y);
    out.push({ type: 'panStart', ...midpoint(a, b) });
  }

  private pairMoved(out: GestureEvent[]): void {
    const a = this.tracks.get(this.pair![0])!;
    const b = this.tracks.get(this.pair![1])!;
    const mid = midpoint(a, b);
    const spread = Math.hypot(b.x - a.x, b.y - a.y);
    out.push({ type: 'pan', ...mid });
    if (this.spread > 0 && spread > 0 && spread !== this.spread) {
      const scale = Math.min(MAX_PINCH_STEP, Math.max(1 / MAX_PINCH_STEP, spread / this.spread));
      out.push({ type: 'pinch', ...mid, scale });
    }
    if (spread > 0) this.spread = spread;
  }

  private first(): Track | undefined {
    return this.tracks.values().next().value;
  }
}

function moved(p: Track): boolean {
  return Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_MOVE_PX;
}

function midpoint(a: Track, b: Track): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function boxEvent(type: 'box' | 'boxEnd', p: Track): GestureEvent {
  return { type, x0: p.startX, y0: p.startY, x: p.x, y: p.y };
}
