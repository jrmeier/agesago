import type { EntityId, PlayerId, Unit } from '../core/types';
import { nextScout } from './scouts';

/** `owner`'s villagers standing idle, in id order. */
export function idleVillagers<T extends Pick<Unit, 'id' | 'kind' | 'owner' | 'state'>>(
  units: Iterable<T>,
  owner: PlayerId
): T[] {
  const out: T[] = [];
  for (const u of units) if (u.kind === 'villager' && u.owner === owner && u.state === 'idle') out.push(u);
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Cycles through idle villagers for the idle button and ",": each call returns the idle
 * villager after the last one returned (id order, wrapping), or null when nobody is idle.
 */
export class IdleCycler {
  private last: EntityId | null = null;

  next<T extends Pick<Unit, 'id' | 'pos'>>(idle: readonly T[]): T | null {
    const u = nextScout(idle, this.last);
    this.last = u?.id ?? null;
    return u;
  }
}
