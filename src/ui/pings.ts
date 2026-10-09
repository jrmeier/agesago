import type { Vec2 } from '../core/types';

export type PingKind = 'attack' | 'death';

export interface Ping {
  pos: Vec2;
  kind: PingKind;
}

/** Pings waiting for the minimap, per world (Controls raises them; Minimap drains them). */
const pending = new WeakMap<object, Ping[]>();
/** Most pings kept while nobody drains them (e.g. the minimap is collapsed). */
const MAX_PENDING = 8;

/** Flash a ping on `world`'s minimap. */
export function pushPing(world: object, pos: Vec2, kind: PingKind): void {
  let list = pending.get(world);
  if (!list) pending.set(world, (list = []));
  list.push({ pos: { ...pos }, kind });
  if (list.length > MAX_PENDING) list.splice(0, list.length - MAX_PENDING);
}

/** Take every ping raised since the last call. */
export function takePings(world: object): Ping[] {
  const list = pending.get(world);
  if (!list?.length) return [];
  pending.set(world, []);
  return list;
}
