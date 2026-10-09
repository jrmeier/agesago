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
    if (this.current.size) this.set([]);
  }

  has(id: EntityId): boolean {
    return this.current.has(id);
  }

  /** Add ids to the current selection. */
  add(ids: Iterable<EntityId>): void {
    this.set([...this.current, ...ids]);
  }

  /** Drop ids from the selection; notifies only if something was removed. */
  remove(ids: Iterable<EntityId>): void {
    const next = new Set(this.current);
    for (const id of ids) next.delete(id);
    if (next.size !== this.current.size) this.set(next);
  }

  onChange(fn: (ids: ReadonlySet<EntityId>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
