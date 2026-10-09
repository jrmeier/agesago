/** Virtual-joystick ring radius in CSS px: full deflection at this distance from the centre. */
export const STICK_RADIUS_PX = 56;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD_ZONE = 0.15;

export interface StickVec {
  /** Strafe right (+) / left (−). */
  x: number;
  /** Forward (+, thumb pushed up the screen) / back (−). */
  y: number;
}

/**
 * Joystick deflection → movement vector. Magnitude is 0 inside the dead zone, rises linearly
 * to 1 at the ring and is capped there; direction follows the thumb (screen up = forward).
 */
export function stickVector(cx: number, cy: number, x: number, y: number, radius = STICK_RADIUS_PX, dead = STICK_DEAD_ZONE): StickVec {
  const dx = (x - cx) / radius;
  const dy = (cy - y) / radius;
  const m = Math.hypot(dx, dy);
  if (m <= dead) return { x: 0, y: 0 };
  const k = (Math.min(m, 1) - dead) / (1 - dead) / m;
  return { x: dx * k, y: dy * k };
}

/** Knob offset from the ring centre, clamped to the ring. */
export function stickKnob(cx: number, cy: number, x: number, y: number, radius = STICK_RADIUS_PX): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const k = Math.min(1, radius / (Math.hypot(dx, dy) || 1));
  return { x: dx * k, y: dy * k };
}

/** Active joystick: centre where the thumb landed, and the thumb now. */
export interface StickTouch {
  readonly id: number;
  readonly cx: number;
  readonly cy: number;
  x: number;
  y: number;
}

/**
 * DOM-free first-person touch state: the first finger on the left half of the screen drives
 * the joystick, the first on the right half drags to look (look deltas accumulate until taken).
 */
export class FpsTouch {
  stick: StickTouch | null = null;
  private look: { id: number; x: number; y: number } | null = null;
  private lookDX = 0;
  private lookDY = 0;

  down(id: number, x: number, y: number, width: number): void {
    if (x < width / 2) {
      if (!this.stick) this.stick = { id, cx: x, cy: y, x, y };
    } else if (!this.look) {
      this.look = { id, x, y };
    }
  }

  move(id: number, x: number, y: number): void {
    if (this.stick?.id === id) {
      this.stick.x = x;
      this.stick.y = y;
    } else if (this.look?.id === id) {
      this.lookDX += x - this.look.x;
      this.lookDY += y - this.look.y;
      this.look.x = x;
      this.look.y = y;
    }
  }

  up(id: number): void {
    if (this.stick?.id === id) this.stick = null;
    if (this.look?.id === id) this.look = null;
  }

  /** Current movement vector (zero when the joystick is idle). */
  get vector(): StickVec {
    const s = this.stick;
    return s ? stickVector(s.cx, s.cy, s.x, s.y) : { x: 0, y: 0 };
  }

  /** Look drag accumulated since the last call, in px; resets the accumulator. */
  takeLook(): { x: number; y: number } {
    const d = { x: this.lookDX, y: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return d;
  }

  reset(): void {
    this.stick = null;
    this.look = null;
    this.takeLook();
  }
}
