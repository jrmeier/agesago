import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';

/**
 * Binds the existing DOM in index.html: #res-food/#res-wood/#res-gold/#res-pop,
 * #selection-panel (+ .hidden), #unit-name, #unit-status, #train-btn.
 * Updates from world.events and selection changes. Owned by the Controls lane (T6).
 * Public surface FROZEN: constructor, update.
 */
export class Hud {
  constructor(
    readonly world: World,
    readonly selection: Selection,
    readonly onTrain: () => void
  ) {}

  /** Per-frame refresh for things not driven by events (e.g. selected unit status). */
  update(): void {}
}
