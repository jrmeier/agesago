import type { EntityViews } from '../render/EntityViews';
import type { CameraRig } from '../camera/CameraRig';
import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';
import type { Input } from './Input';

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

/**
 * Player intent → sim commands: click / box / A select (RTS only), RMB on node = gather,
 * on ground = move, T = train. Disabled in first-person mode.
 * Owned by the Controls lane (T6). Public surface FROZEN: constructor, update.
 */
export class Controls {
  constructor(readonly deps: ControlsDeps) {}

  update(_dt: number): void {}
}
