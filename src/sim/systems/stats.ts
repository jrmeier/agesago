import { BUILDINGS } from '../../core/buildings';
import type { Building, BuildingKind, PlayerId, Unit, UnitKind, Vec2 } from '../../core/types';
import { UNITS } from '../../core/units';
import { BALANCE } from '../balance';
import { rectDistance } from '../nav';
import type { World } from '../World';
import { buildingStat, unitStat } from './research';
import { buildingRect } from './sites';

/**
 * Per-unit stat lookups (Sim lane). Every moddable stat goes through the owner's research
 * (statOf / unitStat / buildingStat). The `world` argument is optional only so pure callers
 * (old tests, previews) still get the base table values; the sim always passes it.
 */

/** Loaded villagers walk this much slower (BALANCE.villagerSpeedLoaded / villagerSpeed). */
const LOADED_FACTOR = BALANCE.villagerSpeedLoaded / BALANCE.villagerSpeed;

/** Walking speed of `u` right now: its (researched) speed, slower for a villager carrying resources. */
export function unitSpeed(u: Unit, world?: World): number {
  const spec = UNITS[u.kind].speed;
  const base = world ? unitStat(world, u.owner, u.kind, 'speed', spec) : spec;
  return u.kind === 'villager' && u.carry && u.carry.amount > 0 ? base * LOADED_FACTOR : base;
}

/** Sight radius of a unit kind for `owner`. */
export function unitSight(world: World, owner: PlayerId, kind: UnitKind): number {
  return unitStat(world, owner, kind, 'sight', UNITS[kind].sight);
}

/** Sight radius of a building kind for `owner`. */
export function buildingSight(world: World, owner: PlayerId, kind: BuildingKind): number {
  return buildingStat(world, owner, kind, 'sight', BUILDINGS[kind].sight);
}

/** Attack range (edge to edge) of a unit kind for `owner`. */
export function unitRange(world: World, owner: PlayerId, kind: UnitKind): number {
  return unitStat(world, owner, kind, 'range', UNITS[kind].range);
}

/** Max hit points of a unit kind for `owner`. */
export function unitMaxHp(world: World, owner: PlayerId, kind: UnitKind): number {
  return Math.round(unitStat(world, owner, kind, 'hp', UNITS[kind].hp));
}

/** Max hit points of a building kind for `owner`. */
export function buildingMaxHp(world: World, owner: PlayerId, kind: BuildingKind): number {
  return Math.round(buildingStat(world, owner, kind, 'hp', BUILDINGS[kind].hp));
}

/** Garrison capacity of a building kind for `owner` (0: none). */
export function garrisonCap(world: World, owner: PlayerId, kind: BuildingKind): number {
  const base = BUILDINGS[kind].garrison ?? 0;
  return base > 0 ? Math.round(buildingStat(world, owner, kind, 'garrison', base)) : 0;
}

/** Attack of a unit kind for `owner` (base table values without `world`). */
export function unitAttack(world: World | undefined, owner: PlayerId, kind: UnitKind): { melee: number; pierce: number } {
  const a = UNITS[kind].attack;
  if (!world) return a;
  return {
    melee: unitStat(world, owner, kind, 'attack.melee', a.melee),
    pierce: unitStat(world, owner, kind, 'attack.pierce', a.pierce),
  };
}

/** Armour of a unit or building with its owner's research (base table values without `world`). */
export function armorOf(world: World | undefined, t: Unit | Building): { melee: number; pierce: number } {
  if ('stance' in t) {
    const a = UNITS[t.kind].armor;
    if (!world) return a;
    return {
      melee: unitStat(world, t.owner, t.kind, 'armor.melee', a.melee),
      pierce: unitStat(world, t.owner, t.kind, 'armor.pierce', a.pierce),
    };
  }
  const a = BUILDINGS[t.kind].armor;
  if (!world) return a;
  return {
    melee: buildingStat(world, t.owner, t.kind, 'armor.melee', a.melee),
    pierce: buildingStat(world, t.owner, t.kind, 'armor.pierce', a.pierce),
  };
}

/** A building's ranged attack for its owner (arrows, range, pierce), or undefined if it has none. */
export function buildingAttack(
  world: World,
  b: Building
): { pierce: number; range: number; reload: number; arrows: number } | undefined {
  const a = BUILDINGS[b.kind].attack;
  if (!a) return undefined;
  return {
    pierce: buildingStat(world, b.owner, b.kind, 'attack.pierce', a.pierce),
    range: buildingStat(world, b.owner, b.kind, 'range', a.range),
    reload: a.reload,
    arrows: Math.round(buildingStat(world, b.owner, b.kind, 'arrows', a.arrows)),
  };
}

/** Collision/selection radius of a unit. */
export function unitRadius(u: Unit): number {
  return UNITS[u.kind].radius;
}

/** Ranged units fire projectiles; the rest strike in melee. */
export function isRanged(kind: UnitKind): boolean {
  return UNITS[kind].projectile !== undefined;
}

/**
 * Damage of one `attacker` blow against `target`: (attack − armour) per type, at least 1, plus
 * the class bonus against units (buildings get none). With `world`, both sides' research
 * applies; `owner` is the attacker's owner.
 */
export function damageTo(attacker: UnitKind, target: Unit | Building, world?: World, owner: PlayerId = 0): number {
  const atk = unitAttack(world, owner, attacker);
  const arm = armorOf(world, target);
  const base = Math.max(0, atk.melee - arm.melee) + Math.max(0, atk.pierce - arm.pierce);
  const bonus = 'stance' in target ? (UNITS[attacker].bonus[UNITS[target.kind].unitClass] ?? 0) : 0;
  return Math.max(1, base) + bonus;
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
