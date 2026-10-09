/**
 * Raw pointer/keyboard state with per-frame edge events (pressed / released this frame,
 * wheel delta, drag tracking with the 5 px click-vs-drag threshold).
 * Owned by the Controls lane (T5/T6). Internal API is up to the lane;
 * Game only relies on: constructor(dom), endFrame(), dispose().
 */
export const DRAG_THRESHOLD_PX = 5;

export class Input {
  constructor(readonly dom: HTMLElement) {}

  /** Clear per-frame edge state. Called by Game once at the end of every frame. */
  endFrame(): void {}

  dispose(): void {}
}
