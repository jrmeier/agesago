import type { Vec2 } from '../core/types';

/**
 * A small banner planted on a selected building's rally point: the #rally-flag sprite, moved
 * over the canvas each frame by projecting the ground point (`project` returns client px, or
 * null when off-screen / behind the camera).
 */
export class RallyFlag {
  private readonly el = document.getElementById('rally-flag');
  private shown = false;
  private lastKey = '';

  constructor(private readonly project: (p: Vec2) => { x: number; y: number } | null) {
    if (this.el) this.el.style.display = 'none';
  }

  /** Show the flag at `p`, or hide it (null). */
  update(p: Vec2 | null): void {
    const el = this.el;
    if (!el) return;
    const at = p ? this.project(p) : null;
    if (!at) {
      if (this.shown) {
        el.style.display = 'none';
        this.shown = false;
      }
      return;
    }
    if (!this.shown) {
      el.style.display = 'block';
      this.shown = true;
    }
    const key = `${Math.round(at.x)},${Math.round(at.y)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
  }
}
