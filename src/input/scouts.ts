import type { EntityId, Unit, Vec2 } from '../core/types';

type Located = Pick<Unit, 'id' | 'pos'>;

/** The scout after `lastId` in id order, wrapping round; the first one if `lastId` is unknown. */
export function nextScout<T extends Located>(scouts: readonly T[], lastId: EntityId | null): T | null {
  if (!scouts.length) return null;
  const sorted = [...scouts].sort((a, b) => a.id - b.id);
  if (lastId === null) return sorted[0];
  return sorted.find((s) => s.id > lastId) ?? sorted[0];
}

/** Last scout centred per world, so the hotkey and the minimap button cycle together. */
const lastFocused = new WeakMap<object, EntityId>();

/** Per-world listeners told which scout was just jumped to (Controls selects it). */
const focusListeners = new WeakMap<object, Set<(id: EntityId) => void>>();

/** Subscribe to scout jumps on `world` (hotkey or minimap button). Returns an unsubscribe function. */
export function onScoutFocus(world: object, fn: (id: EntityId) => void): () => void {
  let set = focusListeners.get(world);
  if (!set) focusListeners.set(world, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

/**
 * Centre the camera on the next scout (cycling if there are several) and tell onScoutFocus
 * listeners, which select it. Shared by the "." / Home hotkeys and the minimap's find-scout
 * button. Returns the scout id, or null.
 */
export function focusNextScout(
  world: { readonly units: ReadonlyMap<EntityId, Unit> },
  rig: { focusOn(p: Vec2): void }
): EntityId | null {
  const scouts = [...world.units.values()].filter((u) => u.kind === 'scout');
  const s = nextScout(scouts, lastFocused.get(world) ?? null);
  if (!s) return null;
  lastFocused.set(world, s.id);
  rig.focusOn(s.pos);
  for (const fn of focusListeners.get(world) ?? []) fn(s.id);
  return s.id;
}
