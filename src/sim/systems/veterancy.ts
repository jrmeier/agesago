import type { EntityId, Rank, Unit } from '../../core/types';
import { canRank, RANKS, xpValue } from '../../core/units';
import { BALANCE } from '../balance';
import type { World } from '../World';
import { unitMaxHp } from './stats';

/**
 * Veterancy (M15-1, after 0 A.D.'s Promotion + Loot components). A killed unit's experience
 * (xpValue) is split among the soldiers that hurt it within BALANCE.xpWindow seconds, in
 * proportion to the damage each dealt; soldiers rank Basic → Advanced → Elite at RANKS
 * thresholds and heal to full on promotion. Rank bonuses themselves are read through statOf.
 */

/** One soldier's recent damage to a victim. */
export interface DamageShare {
  by: EntityId;
  damage: number;
  /** Sim time of its latest hit. */
  at: number;
}

/** Note that soldier `by` dealt `amount` to unit `victim` (no-op for non-soldiers). */
export function recordDamage(world: World, victim: EntityId, by: EntityId | null, amount: number): void {
  if (by === null || amount <= 0) return;
  const attacker = world.units.get(by);
  if (!attacker || !canRank(attacker.kind)) return;
  let log = world.damageLog.get(victim);
  if (!log) world.damageLog.set(victim, (log = []));
  const stale = world.time - BALANCE.xpWindow;
  const e = log.find((s) => s.by === by);
  if (e) {
    e.damage = e.at < stale ? amount : e.damage + amount;
    e.at = world.time;
  } else {
    // Drop stale entries first so the record stays small.
    for (let i = log.length - 1; i >= 0; i--) if (log[i].at < stale) log.splice(i, 1);
    log.push({ by, damage: amount, at: world.time });
  }
}

/** `victim` died: pay its experience to the soldiers who recently hurt it, then forget its log. */
export function awardKill(world: World, victim: Unit): void {
  const log = world.damageLog.get(victim.id);
  world.damageLog.delete(victim.id);
  const xp = xpValue(victim.kind);
  if (!log || xp <= 0) return;
  const stale = world.time - BALANCE.xpWindow;
  let total = 0;
  for (const s of log) if (s.at >= stale && world.units.has(s.by)) total += s.damage;
  if (total <= 0) return;
  // Log order is first-hit order: deterministic.
  for (const s of log) {
    const u = world.units.get(s.by);
    if (s.at < stale || !u || u.owner === victim.owner) continue;
    gainXp(world, u, (xp * s.damage) / total);
  }
}

/** Add experience to a soldier and promote it through any rank thresholds it passed. */
export function gainXp(world: World, u: Unit, amount: number): void {
  if (!canRank(u.kind) || amount <= 0) return;
  u.xp = (u.xp ?? 0) + amount;
  let rank = u.rank ?? 0;
  const before = rank;
  while (rank < 2 && u.xp >= RANKS[rank + 1].xp - 1e-9) rank++;
  if (rank === before) return;
  promote(world, u, rank as Rank);
}

/** Set a unit's rank, refresh its max HP and heal it to full. */
export function promote(world: World, u: Unit, rank: Rank): void {
  u.rank = rank;
  u.maxHp = unitMaxHp(world, u.owner, u.kind, rank);
  u.hp = u.maxHp;
  world.events.emit({ type: 'promoted', id: u.id, owner: u.owner, rank });
}
