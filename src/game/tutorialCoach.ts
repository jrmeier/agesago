import type { EntityId } from '../core/types';
import type { World } from '../sim/World';
import {
  advance,
  hintId,
  hintText,
  HINTS_KEY,
  loadDismissed,
  objective,
  rememberDismissed,
  type TutorialBaseline,
  type TutorialFacts,
  type TutorialStep,
} from './tutorial';

/**
 * Guides one practice match. It watches sim events, and it does not write the resume slot.
 * Dismissed hints stay dismissed in this browser.
 */
export class TutorialCoach {
  private step: TutorialStep = 'gather';
  private readonly baseline: TutorialBaseline;
  private readonly dismissed: Set<string>;
  private granted = false;
  private raidSpawned = false;
  private readonly raiders: EntityId[] = [];
  private readonly off: Array<() => void> = [];

  constructor(private readonly world: World) {
    const stock = world.stockOf(world.localPlayer);
    if (stock.food < 50) stock.food = 50;
    world.emitStock();
    this.baseline = { villagers: world.villagerCount, food: world.stockOf(world.localPlayer).food };
    this.dismissed = loadDismissed(readHints());
    const root = document.getElementById('tutorial');
    if (!root) return;
    root.hidden = false;
    const ask = document.querySelector('#new-match-ask .confirm-copy');
    if (ask) ask.textContent = 'Leave the tutorial? The saved match in this browser stays.';
    document.getElementById('tutorial-skip')?.addEventListener('click', () => location.reload());
    document.getElementById('tutorial-dismiss')?.addEventListener('click', () => this.dismiss());
    for (const type of ['unitState', 'spawned', 'constructed', 'died', 'stockpile'] as const) {
      this.off.push(world.events.on(type, () => this.refresh()));
    }
    this.refresh();
  }

  dispose(): void {
    for (const stop of this.off) stop();
    const root = document.getElementById('tutorial');
    if (root) root.hidden = true;
  }

  private dismiss(): void {
    const id = hintId(this.step);
    if (!id || this.dismissed.has(id)) return;
    this.dismissed.add(id);
    try {
      localStorage.setItem(HINTS_KEY, rememberDismissed(this.dismissed, id));
    } catch {
      // The hint still hides for this match.
    }
    this.paint();
  }

  private refresh(): void {
    const was = this.step;
    this.step = advance(was, this.facts(), this.baseline);
    if (was !== this.step && this.past('house') && !this.granted) this.grantTimber();
    if (this.step === 'raid' && !this.raidSpawned) {
      this.beginRaid();
      this.step = advance(this.step, this.facts(), this.baseline);
    }
    this.paint();
  }

  private past(step: TutorialStep): boolean {
    return TUTORIAL_INDEX[this.step] > TUTORIAL_INDEX[step];
  }

  private facts(): TutorialFacts {
    const local = this.world.localPlayer;
    const stock = this.world.stockOf(local);
    let gathering = false;
    let houses = 0;
    let barracks = 0;
    let scoutMoving = false;
    for (const unit of this.world.units.values()) {
      if (unit.owner !== local) continue;
      if (unit.kind === 'villager' && (unit.state === 'toNode' || unit.state === 'gathering' || unit.state === 'toDrop')) {
        gathering = true;
      }
      if (unit.kind === 'scout' && (unit.state === 'moving' || unit.state === 'exploring')) scoutMoving = true;
    }
    for (const building of this.world.buildings.values()) {
      if (building.owner !== local || !building.complete) continue;
      if (building.kind === 'house') houses += 1;
      if (building.kind === 'barracks') barracks += 1;
    }
    let raidersAlive = 0;
    for (const id of this.raiders) if (this.world.units.has(id)) raidersAlive += 1;
    return {
      wood: stock.wood,
      food: stock.food,
      villagers: this.world.villagerCount,
      gathering,
      houses,
      scoutMoving,
      barracks,
      raidSpawned: this.raidSpawned,
      raidersAlive,
    };
  }

  /** The barracks lesson is about placing it, not chopping 175 wood. */
  private grantTimber(): void {
    this.granted = true;
    const stock = this.world.stockOf(this.world.localPlayer);
    if (stock.wood < 175) stock.wood = 175;
    this.world.emitStock();
  }

  private beginRaid(): void {
    if (this.raidSpawned) return;
    const tc = this.world.townCenter;
    const rival = [...this.world.players.keys()].find((id) => id !== this.world.localPlayer);
    if (!tc || rival == null) return;
    this.raidSpawned = true;
    const spots = [
      { x: tc.pos.x + 14, z: tc.pos.z + 3 },
      { x: tc.pos.x + 14, z: tc.pos.z - 3 },
    ];
    for (const spot of spots) {
      const unit = this.world.spawnUnit('swordsman', this.stand(spot), rival);
      this.raiders.push(unit.id);
    }
    this.world.spawnUnit('hoplite', this.stand({ x: tc.pos.x + 3.5, z: tc.pos.z + 3.5 }));
    this.world.dispatch({ type: 'attack', unitIds: [...this.raiders], targetId: tc.id }, rival);
  }

  private stand(spot: { x: number; z: number }): { x: number; z: number } {
    const hf = this.world.hf;
    if (hf.isWalkable(spot.x, spot.z)) return spot;
    for (let r = 1; r <= 8; r += 1) {
      for (let a = 0; a < 8; a += 1) {
        const p = { x: spot.x + Math.cos(a) * r, z: spot.z + Math.sin(a) * r };
        if (hf.isWalkable(p.x, p.z)) return p;
      }
    }
    return spot;
  }

  private paint(): void {
    const root = document.getElementById('tutorial');
    if (!root) return;
    root.dataset.step = this.step;
    const title = document.getElementById('tutorial-objective');
    if (title) title.textContent = objective(this.step);
    const hint = document.getElementById('tutorial-hint');
    const text = hintText(this.step, document.body.classList.contains('touch'), this.dismissed);
    if (hint) {
      hint.hidden = text.length === 0;
      hint.textContent = text;
    }
    const dismiss = document.getElementById('tutorial-dismiss');
    if (dismiss) dismiss.hidden = text.length === 0;
    const skip = document.getElementById('tutorial-skip');
    if (skip) skip.textContent = this.step === 'done' ? 'Back to title' : 'Skip';
  }
}

const TUTORIAL_INDEX: Record<TutorialStep, number> = {
  gather: 0,
  train: 1,
  house: 2,
  scout: 3,
  barracks: 4,
  raid: 5,
  done: 6,
};

function readHints(): string | null {
  try {
    return localStorage.getItem(HINTS_KEY);
  } catch {
    return null;
  }
}
