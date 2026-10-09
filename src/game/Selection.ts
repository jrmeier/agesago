import type { EntityId } from '../core/types';

/**
 * Currently selected unit ids. UI state, not sim state. Owned by the Controls lane (T6).
 * Public surface FROZEN: ids, set, clear, onChange.
 */
export class Selection {
  private current = new Set<EntityId>();
  private listeners = new Set<(ids: ReadonlySet<EntityId>) => void>();

  get ids(): ReadonlySet<EntityId> {
    return this.current;
  }

  set(ids: Iterable<EntityId>): void {
    this.current = new Set(ids);
    for (const fn of this.listeners) fn(this.current);
  }

  clear(): void {
    this.set([]);
  }

  onChange(fn: (ids: ReadonlySet<EntityId>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
