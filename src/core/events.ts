/** Minimal typed event bus. FROZEN after T1. */
export class EventBus<E extends { type: string }> {
  private handlers = new Map<string, Set<(e: never) => void>>();

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends E['type']>(type: T, fn: (e: Extract<E, { type: T }>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as (e: never) => void);
    return () => set.delete(fn as (e: never) => void);
  }

  emit(e: E): void {
    const set = this.handlers.get(e.type);
    if (!set) return;
    for (const fn of set) (fn as (e: E) => void)(e);
  }
}
