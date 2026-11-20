import { BUILDINGS } from '../core/buildings';
import { AGE_NAMES, type Age } from '../core/techs';
import type { BuildingKind, EntityId, ResourceType, UnitKind, Vec2 } from '../core/types';
import { UNITS } from '../core/units';
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
/**
 * Capture toast (M18-4): "Your Barracks was captured by Rival 1" when we lost it, "Captured a
 * Barracks from Rival 1" (or "Captured a neutral Barracks") when we took it.
 */
export function captureText(kind: BuildingKind, lost: boolean, other: string | null): string {
  const name = BUILDINGS[kind].name;
  if (lost) return other ? `Your ${name} was captured by ${other}` : `Your ${name} was captured`;
  return other ? `Captured a ${name} from ${other}` : `Captured a neutral ${name}`;
}

export function deathText(count: number): string {
  return count === 1 ? 'A villager was killed' : `${count} villagers were killed`;
}

/**
 * The age-up toast: "Town Age unlocks: build Forge, Market · train Slinger" (buildings first, then
 * units), or "Entered the Empire Age" when the age opens nothing new.
 */
export function unlockText(age: Age, unlocks: { buildings: readonly BuildingKind[]; units: readonly UnitKind[] }): string {
  const parts: string[] = [];
  if (unlocks.buildings.length) parts.push(`build ${unlocks.buildings.map((k) => BUILDINGS[k].name).join(', ')}`);
  if (unlocks.units.length) parts.push(`train ${unlocks.units.map((k) => UNITS[k].name).join(', ')}`);
  return parts.length ? `${AGE_NAMES[age]} unlocks: ${parts.join(' · ')}` : `Entered the ${AGE_NAMES[age]}`;
}

/** A rival gave up (M16-10: a beaten computer player resigns). */
export function resignText(name: string): string {
  return `${name} resigned`;
}

export function destroyedText(kind: BuildingKind, count = 1): string {
  return count === 1 ? `Your ${BUILDINGS[kind].name} was destroyed` : `${count} buildings destroyed`;
}

export function depletedText(resource: ResourceType, dropKind: BuildingKind): string {
  return `${resource[0].toUpperCase()}${resource.slice(1)} near your ${BUILDINGS[dropKind].name} is exhausted`;
}

/** Positions are centres; callers supply only completed local drop sites. */
export function lastNodeNearDrop(
  depleted: Vec2, resource: ResourceType, drop: { pos: Vec2; kind: BuildingKind },
  remaining: Iterable<{ pos: Vec2; resource: ResourceType; amount: number }>,
): boolean {
  if (!BUILDINGS[drop.kind].drop?.includes(resource)) return false;
  if (resource === 'wood' && drop.kind !== 'storehouse') return false;
  const near = (p: Vec2) => Math.hypot(p.x - drop.pos.x, p.z - drop.pos.z) <= 12;
  if (!near(depleted)) return false;
  for (const node of remaining) {
    if (node.resource === resource && node.amount > 0 && near(node.pos)) return false;
  }
  return true;
}

/** Remember announcements only when shown; suppressed sites can qualify on a later event. */
export class DepletionLimiter {
  private readonly announced = new Set<string>();
  private last = -Infinity;

  shouldAlert(site: EntityId, resource: ResourceType, time: number): boolean {
    const key = `${site}:${resource}`;
    if (this.announced.has(key) || time - this.last < 20) return false;
    this.announced.add(key);
    this.last = time;
    return true;
  }
}
