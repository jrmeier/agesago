import { BUILDINGS, tierStats } from '../../core/buildings';
import type { Building, BuildingKind, PlayerId, Rank, Unit, UnitKind, Vec2 } from '../../core/types';
import { UNITS, crushOf, rawDamage, unitArmor, type DamageTypes } from '../../core/units';
import { BALANCE } from '../balance';
import { rectDistance } from '../nav';
import type { World } from '../World';
import { buildingStat, unitStat } from './research';
import { auraStat } from './auras';
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
  const base = world ? auraStat(world, u, 'speed', unitStat(world, u.owner, u.kind, 'speed', spec)) : spec;
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

/** Max hit points of a unit kind for `owner` at veterancy `rank`. */
export function unitMaxHp(world: World, owner: PlayerId, kind: UnitKind, rank: Rank = 0): number {
  return Math.round(unitStat(world, owner, kind, 'hp', UNITS[kind].hp, rank));
}

/**
 * Per-building upgrade tiers (M14-1) change the base value before research applies, so every
 * building stat below takes the building's `tier` (absent: 0, the base table).
 */

/** Max hit points of a building kind at upgrade `tier` for `owner`. */
export function buildingMaxHp(world: World, owner: PlayerId, kind: BuildingKind, tier = 0): number {
  return Math.round(buildingStat(world, owner, kind, 'hp', BUILDINGS[kind].hp * tierStats(kind, tier).hpMul));
}

/** Garrison capacity of a building kind at upgrade `tier` for `owner` (0: none). */
export function garrisonCap(world: World, owner: PlayerId, kind: BuildingKind, tier = 0): number {
  const base = BUILDINGS[kind].garrison ?? 0;
  return base > 0 ? Math.round(buildingStat(world, owner, kind, 'garrison', base + tierStats(kind, tier).garrison)) : 0;
}

/** Attack of a unit kind for `owner` at veterancy `rank`: melee / pierce / crush (base table values without `world`). */
export function unitAttack(world: World | undefined, owner: PlayerId, kind: UnitKind, rank: Rank = 0): Required<DamageTypes> {
  const a = UNITS[kind].attack;
  const crush = crushOf(a);
  if (!world) return { melee: a.melee, pierce: a.pierce, crush };
  return {
    melee: unitStat(world, owner, kind, 'attack.melee', a.melee, rank),
    pierce: unitStat(world, owner, kind, 'attack.pierce', a.pierce, rank),
    crush: unitStat(world, owner, kind, 'attack.crush', crush, rank),
  };
}

/**
 * Attack of the living unit `u`: its kind's researched, ranked attack with the auras on it
 * applied (M16-6 heroes). Same as unitAttack when no aura reaches `u`.
 */
export function attackOf(world: World, u: Unit): Required<DamageTypes> {
  const a = unitAttack(world, u.owner, u.kind, u.rank);
  if (!world.auraActive.has(u.id)) return a;
  return {
    melee: auraStat(world, u, 'attack.melee', a.melee),
    pierce: auraStat(world, u, 'attack.pierce', a.pierce),
    crush: auraStat(world, u, 'attack.crush', a.crush),
  };
}

/** Seconds between `u`'s attacks: its table reload, researched, with its auras applied. */
export function unitReload(world: World, u: Unit): number {
  return auraStat(world, u, 'reload', unitStat(world, u.owner, u.kind, 'reload', UNITS[u.kind].reload));
}

/**
 * Armour of a unit or building with its owner's research (base table values without `world`).
 * Missing crush armour is UNIT_CRUSH_ARMOR for units and 0 for buildings.
 */
export function armorOf(world: World | undefined, t: Unit | Building): Required<DamageTypes> {
  if ('stance' in t) {
    const a = unitArmor(t.kind);
    if (!world) return a;
    return {
      melee: auraStat(world, t, 'armor.melee', unitStat(world, t.owner, t.kind, 'armor.melee', a.melee, t.rank)),
      pierce: auraStat(world, t, 'armor.pierce', unitStat(world, t.owner, t.kind, 'armor.pierce', a.pierce, t.rank)),
      crush: auraStat(world, t, 'armor.crush', unitStat(world, t.owner, t.kind, 'armor.crush', a.crush, t.rank)),
    };
  }
  const a = BUILDINGS[t.kind].armor;
  const tier = tierStats(t.kind, t.tier);
  const melee = a.melee + tier.armorMelee;
  const pierce = a.pierce + tier.armorPierce;
  const crush = crushOf(a);
  if (!world) return { melee, pierce, crush };
  return {
    melee: auraStat(world, t, 'armor.melee', buildingStat(world, t.owner, t.kind, 'armor.melee', melee)),
    pierce: auraStat(world, t, 'armor.pierce', buildingStat(world, t.owner, t.kind, 'armor.pierce', pierce)),
    crush: auraStat(world, t, 'armor.crush', buildingStat(world, t.owner, t.kind, 'armor.crush', crush)),
  };
}

/** A building's ranged attack for its owner (arrows, range, pierce), or undefined if it has none. */
export function buildingAttack(
  world: World,
  b: Building
): { pierce: number; range: number; reload: number; arrows: number } | undefined {
  const a = BUILDINGS[b.kind].attack;
  if (!a) return undefined;
  const tier = tierStats(b.kind, b.tier);
  return {
    pierce: buildingStat(world, b.owner, b.kind, 'attack.pierce', a.pierce + tier.attack),
    range: buildingStat(world, b.owner, b.kind, 'range', a.range + tier.range),
    reload: a.reload,
    arrows: Math.round(buildingStat(world, b.owner, b.kind, 'arrows', a.arrows + tier.arrows)),
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
 * Damage of one `attacker` blow against `target`: (attack − armour) per type (melee, pierce,
 * crush), at least 1, plus the class bonus against units (buildings get none). With `world`,
 * both sides' research applies; `owner` is the attacker's owner and `rank` its veterancy.
 * `by`, the striking unit when it still lives, adds the auras on it (attackOf).
 */
export function damageTo(attacker: UnitKind, target: Unit | Building, world?: World, owner: PlayerId = 0, rank: Rank = 0, by?: Unit): number {
  const attack = world && by && by.kind === attacker && by.owner === owner ? attackOf(world, by) : unitAttack(world, owner, attacker, rank);
  const base = rawDamage(attack, armorOf(world, target));
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
