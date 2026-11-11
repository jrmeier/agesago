import type { PlayerId, Unit } from '../../core/types';
import { isHero } from '../../core/units';
import type { World } from '../World';

/**
 * Heroes (M16-6): each player fields at most one hero at a time (alive, or queued at a
 * fortress), and after it falls must wait HERO_COOLDOWN seconds before training the next.
 * The cooldown's end is PlayerState.heroReadyAt (saved), set by killUnit.
 */

/** `owner`'s living hero, if any (in unit-map order; there is at most one). */
export function heroOf(world: World, owner: PlayerId): Unit | undefined {
  for (const u of world.units.values()) if (u.owner === owner && u.hp > 0 && isHero(u.kind)) return u;
  return undefined;
}

/** Is a hero waiting in any of `owner`'s training queues? */
export function heroQueued(world: World, owner: PlayerId): boolean {
  for (const b of world.buildings.values()) if (b.owner === owner && b.queueKinds?.some(isHero)) return true;
  return false;
}

/** Seconds until `owner` may train a hero again (0: ready). */
export function heroCooldownLeft(world: World, owner: PlayerId): number {
  return Math.max(0, (world.players.get(owner)?.heroReadyAt ?? 0) - world.time);
}

/** Why `owner` cannot queue a hero right now: 'limit' (one alive or queued), 'hero-cooldown', or null. */
export function heroBlock(world: World, owner: PlayerId): 'limit' | 'hero-cooldown' | null {
  if (heroOf(world, owner) || heroQueued(world, owner)) return 'limit';
  return heroCooldownLeft(world, owner) > 1e-9 ? 'hero-cooldown' : null;
}
