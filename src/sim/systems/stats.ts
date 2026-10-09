import { BUILDINGS } from '../../core/buildings';
import type { Building, Unit, UnitKind, Vec2 } from '../../core/types';
import { UNITS, damage } from '../../core/units';
import { BALANCE } from '../balance';
import { rectDistance } from '../nav';
import { buildingRect } from './sites';

/**
 * Per-unit stat lookups (Sim lane). The Steering lane's movement.ts should call unitSpeed()
 * instead of the BALANCE villager/scout speeds so every kind walks at UNITS[kind].speed.
 */

/** Loaded villagers walk this much slower (BALANCE.villagerSpeedLoaded / villagerSpeed). */
const LOADED_FACTOR = BALANCE.villagerSpeedLoaded / BALANCE.villagerSpeed;

/** Walking speed of `u` right now: UNITS[kind].speed, slower for a villager carrying resources. */
export function unitSpeed(u: Unit): number {
  const base = UNITS[u.kind].speed;
  return u.kind === 'villager' && u.carry && u.carry.amount > 0 ? base * LOADED_FACTOR : base;
}

/** Collision/selection radius of a unit. */
export function unitRadius(u: Unit): number {
  return UNITS[u.kind].radius;
}

/** Ranged units fire projectiles; the rest strike in melee. */
export function isRanged(kind: UnitKind): boolean {
  return UNITS[kind].projectile !== undefined;
}

/** Damage of one `attacker` blow against `target` (buildings: their armour, no class bonus). */
export function damageTo(attacker: UnitKind, target: Unit | Building): number {
  if ('stance' in target) {
    const spec = UNITS[target.kind];
    return damage(attacker, spec.unitClass, spec.armor);
  }
  // damage() adds the class bonus last; buildings get none, so take it back off.
  const cls = UNITS.villager.unitClass;
  return damage(attacker, cls, BUILDINGS[target.kind].armor) - (UNITS[attacker].bonus[cls] ?? 0);
}

/** Edge-to-edge distance from unit `u` to a unit or building target (0 when touching). */
export function edgeDistance(u: Unit, target: Unit | Building): number {
  if ('stance' in target) {
    return Math.hypot(target.pos.x - u.pos.x, target.pos.z - u.pos.z) - unitRadius(u) - unitRadius(target);
  }
  return rectDistance(u.pos, buildingRect(target)) - unitRadius(u);
}

/** Point of `target` nearest to `from` (a unit's centre, or the closest point of a footprint). */
export function nearestPoint(from: Vec2, target: Unit | Building): Vec2 {
  if ('stance' in target) return target.pos;
  const r = buildingRect(target);
  return { x: Math.min(r.x1, Math.max(r.x0, from.x)), z: Math.min(r.z1, Math.max(r.z0, from.z)) };
}
