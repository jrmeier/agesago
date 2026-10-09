import type { Vec2 } from '../core/types';
import { directionWord } from './discover';

/** Seconds before another "under attack" alert for the same place. */
export const ALERT_COOLDOWN = 12;
/** An attack farther than this from every recent alert counts as a new place. */
export const ALERT_RADIUS = 20;
/** Never two alerts closer together than this, even for different places. */
export const ALERT_MIN_GAP = 3;

/**
 * Rate limiter for "You are under attack!": the sim emits 'attacked' on every hit, but the
 * player should hear about a fight once, then again only if it is still going after
 * ALERT_COOLDOWN, or if a second front opens ALERT_RADIUS away.
 */
export class AlertLimiter {
  private recent: { pos: Vec2; time: number }[] = [];
  private lastAny = -Infinity;

  constructor(
    readonly cooldown = ALERT_COOLDOWN,
    readonly radius = ALERT_RADIUS,
    readonly minGap = ALERT_MIN_GAP
  ) {}

  /** Should an attack at `pos` at `time` (s) raise an alert? Records it if so. */
  shouldAlert(pos: Vec2, time: number): boolean {
    this.recent = this.recent.filter((a) => time - a.time < this.cooldown);
    if (time - this.lastAny < this.minGap) return false;
    if (this.recent.some((a) => Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z) <= this.radius)) return false;
    this.recent.push({ pos: { ...pos }, time });
    this.lastAny = time;
    return true;
  }
}

/** "You are under attack! (north-east)" relative to home; "(at your town)" when close by. */
export function attackText(home: Vec2, pos: Vec2): string {
  const dir = directionWord(home, pos);
  return `You are under attack! (${dir === 'nearby' ? 'at your town' : dir})`;
}

/**
 * Batches bursts of the same small news ("a villager was killed"): the first event shows at
 * once, later ones within `gap` seconds are counted and announced together when it passes.
 */
export class BurstCounter {
  private held = 0;
  private last = -Infinity;

  constructor(readonly gap = 4) {}

  /** An event happened at `time`: returns how many to announce now, or 0 to hold it. */
  add(time: number): number {
    if (time - this.last >= this.gap && !this.held) {
      this.last = time;
      return 1;
    }
    this.held++;
    return 0;
  }

  /** Call every frame: returns the held count once the gap has passed (then 0 again). */
  poll(time: number): number {
    if (!this.held || time - this.last < this.gap) return 0;
    const n = this.held;
    this.held = 0;
    this.last = time;
    return n;
  }
}

/** "A villager was killed" / "3 villagers were killed". */
export function deathText(count: number): string {
  return count === 1 ? 'A villager was killed' : `${count} villagers were killed`;
}
