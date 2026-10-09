import type { EntityId } from '../core/types';

/** Two presses of the same group key within this many seconds centre the camera on it. */
export const DOUBLE_TAP_S = 0.4;

/**
 * Control groups 1..9: plain bookkeeping, no DOM. An id lives in at most one group (assigning
 * steals it, as in most RTS games); dead ids are dropped with remove(). press() tells the
 * caller whether a group key press is a select or a double-tap "centre on it".
 */
export class ControlGroups {
  private readonly groups = new Map<number, EntityId[]>();
  private lastPress: { group: number; time: number } | null = null;
  private version = 0;

  /** Bumped on every change, so a UI can redraw only when needed. */
  get rev(): number {
    return this.version;
  }

  /** Replace group `n` with `ids` (removing them from any other group). Empty `ids` clears it. */
  assign(n: number, ids: Iterable<EntityId>): void {
    if (!valid(n)) return;
    const list = [...new Set(ids)];
    const taken = new Set(list);
    for (const [g, members] of this.groups) {
      if (g === n) continue;
      const kept = members.filter((id) => !taken.has(id));
      if (kept.length !== members.length) this.set(g, kept);
    }
    this.set(n, list);
  }

  /** Add `ids` to group `n` (Shift+Ctrl+digit). */
  add(n: number, ids: Iterable<EntityId>): void {
    this.assign(n, [...this.get(n), ...ids]);
  }

  get(n: number): readonly EntityId[] {
    return this.groups.get(n) ?? [];
  }

  /** Group sizes 1..9 (index 0 = group 1). */
  sizes(): number[] {
    return Array.from({ length: 9 }, (_, i) => this.get(i + 1).length);
  }

  /** Forget a dead or removed entity everywhere. */
  remove(id: EntityId): void {
    for (const [g, members] of this.groups) {
      const i = members.indexOf(id);
      if (i >= 0) this.set(g, members.filter((m) => m !== id));
    }
  }

  /** A group key went down at `time` (s): 'centre' on a quick second press, else 'select'. */
  press(n: number, time: number): 'select' | 'centre' {
    const prev = this.lastPress;
    this.lastPress = { group: n, time };
    if (prev && prev.group === n && time - prev.time <= DOUBLE_TAP_S) {
      this.lastPress = null;
      return 'centre';
    }
    return 'select';
  }

  private set(n: number, ids: EntityId[]): void {
    if (ids.length) this.groups.set(n, ids);
    else this.groups.delete(n);
    this.version++;
  }
}

function valid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 9;
}

/** Mean position of the ids that still resolve, or null. */
export function groupCentre(
  ids: readonly EntityId[],
  posOf: (id: EntityId) => { x: number; z: number } | undefined
): { x: number; z: number } | null {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const id of ids) {
    const p = posOf(id);
    if (!p) continue;
    x += p.x;
    z += p.z;
    n++;
  }
  return n ? { x: x / n, z: z / n } : null;
}
