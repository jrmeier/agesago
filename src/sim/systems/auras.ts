import { AURAS, type AuraId, type AuraSpec } from '../../core/auras';
import { BUILDINGS } from '../../core/buildings';
import { matches, type Stat, type Subject } from '../../core/techs';
import { GAIA, type Building, type EntityId, type Unit } from '../../core/types';
import { UNITS } from '../../core/units';
import { rectDistance } from '../nav';
import type { World } from '../World';
import { buildingRect } from './sites';

/**
 * Aura system (M16-4), after 0 A.D.'s Auras component. Each source re-scans who it reaches on
 * a staggered cadence (every AURA_PERIOD ticks, spread by entity id) and records, per affected
 * entity, how many sources grant each aura id. Stats read through auraStat(); healing auras
 * restore hp every tick. One aura id counts once per entity however many sources grant it.
 *
 * Nothing here is saved: deserializeWorld calls recomputeAllAuras() after a load.
 */

/** Ticks between re-scans of one source. */
export const AURA_PERIOD = 10;

/** Per-source bookkeeping: affected entity ids per aura it emits. */
export type AuraSourceState = Map<AuraId, EntityId[]>;

function aurasOf(e: Unit | Building): readonly AuraId[] | undefined {
  return 'stance' in e ? UNITS[e.kind].auras : BUILDINGS[e.kind].auras;
}

/** Is `e` currently able to emit its auras? (Complete buildings; living units outside buildings.) */
function emits(e: Unit | Building): boolean {
  if (e.hp <= 0) return false;
  return 'stance' in e ? e.state !== 'garrisoned' : e.complete;
}

function sourceOf(world: World, id: EntityId): Unit | Building | undefined {
  return world.units.get(id) ?? world.buildings.get(id);
}

function subjectOf(e: Unit | Building): Subject {
  return 'stance' in e ? { unit: e.kind } : { building: e.kind };
}

function reachesOwner(world: World, aura: AuraSpec, src: Unit | Building, owner: number): boolean {
  if (owner === src.owner) return true;
  return aura.players === 'allies' && owner !== GAIA && src.owner !== GAIA && !world.areEnemies(src.owner, owner);
}

function affected(aura: AuraSpec, e: Unit | Building): boolean {
  const s = subjectOf(e);
  for (const t of aura.affects) if (matches(t, s)) return true;
  return false;
}

/** Edge distance between a source and a candidate (building footprints count from their edge). */
function gap(src: Unit | Building, e: Unit | Building): number {
  const eR = 'stance' in e ? UNITS[e.kind].radius : 0;
  if ('stance' in src) {
    const d = 'stance' in e ? Math.hypot(e.pos.x - src.pos.x, e.pos.z - src.pos.z) : rectDistance(src.pos, buildingRect(e));
    return d - eR - UNITS[src.kind].radius;
  }
  return rectDistance(e.pos, buildingRect(src)) - eR;
}

/** Entity ids `aura` on `src` reaches right now, in world map order (deterministic). */
function scan(world: World, aura: AuraSpec, src: Unit | Building): EntityId[] {
  const out: EntityId[] = [];
  if (aura.radius === 'garrison') {
    if ('stance' in src) {
      for (const id of src.passengers ?? []) {
        const u = world.units.get(id);
        if (u && reachesOwner(world, aura, src, u.owner) && affected(aura, u)) out.push(id);
      }
    } else {
      for (const u of world.units.values()) {
        if (u.state === 'garrisoned' && u.shelter === src.id && reachesOwner(world, aura, src, u.owner) && affected(aura, u)) out.push(u.id);
      }
    }
    return out;
  }
  const radius = aura.radius;
  for (const u of world.units.values()) {
    if (u.hp <= 0 || u.state === 'garrisoned' || !reachesOwner(world, aura, src, u.owner) || !affected(aura, u)) continue;
    if (radius === 'global' || gap(src, u) <= radius) out.push(u.id);
  }
  if (aura.affects.some((t) => t === 'allBuildings' || t in BUILDINGS)) {
    for (const b of world.buildings.values()) {
      if (!reachesOwner(world, aura, src, b.owner) || !affected(aura, b)) continue;
      if (radius === 'global' || gap(src, b) <= radius) out.push(b.id);
    }
  }
  return out;
}

function grant(world: World, id: EntityId, aura: AuraId, delta: 1 | -1): void {
  let m = world.auraActive.get(id);
  if (!m) {
    if (delta < 0) return;
    world.auraActive.set(id, (m = new Map()));
  }
  const n = (m.get(aura) ?? 0) + delta;
  if (n > 0) m.set(aura, n);
  else {
    m.delete(aura);
    if (m.size === 0) world.auraActive.delete(id);
  }
}

/** Withdraw everything source `id` grants. */
function dropSource(world: World, id: EntityId): void {
  const st = world.auraSources.get(id);
  if (!st) return;
  for (const [aura, ids] of st) for (const e of ids) grant(world, e, aura, -1);
  world.auraSources.delete(id);
}

/** Re-scan one source and update the entities it reaches. */
function refreshSource(world: World, src: Unit | Building): void {
  const ids = aurasOf(src);
  if (!ids?.length || !emits(src)) {
    dropSource(world, src.id);
    return;
  }
  const old = world.auraSources.get(src.id);
  const next: AuraSourceState = new Map();
  for (const aura of ids) {
    const now = scan(world, AURAS[aura], src);
    next.set(aura, now);
    for (const e of now) grant(world, e, aura, 1);
  }
  if (old) for (const [aura, prev] of old) for (const e of prev) grant(world, e, aura, -1);
  world.auraSources.set(src.id, next);
}

/** Recompute every source at once (after a load, or in tests). */
export function recomputeAllAuras(world: World): void {
  world.auraSources.clear();
  world.auraActive.clear();
  for (const b of world.buildings.values()) if (aurasOf(b)?.length) refreshSource(world, b);
  for (const u of world.units.values()) if (aurasOf(u)?.length) refreshSource(world, u);
}

/** Per tick: drop dead sources, re-scan the sources whose slot is due, apply healing. */
export function auraSystem(world: World, dt: number): void {
  const slot = world.auraTicks++ % AURA_PERIOD;
  for (const id of world.auraSources.keys()) {
    const src = sourceOf(world, id);
    if (!src || !emits(src)) dropSource(world, id);
  }
  for (const b of world.buildings.values()) {
    if (b.id % AURA_PERIOD === slot && aurasOf(b)?.length) refreshSource(world, b);
  }
  for (const u of world.units.values()) {
    if (u.id % AURA_PERIOD === slot && aurasOf(u)?.length) refreshSource(world, u);
  }
  for (const [id, auras] of world.auraActive) {
    let heal = 0;
    for (const a of auras.keys()) heal += AURAS[a].heal ?? 0;
    if (heal === 0) continue;
    const u = world.units.get(id);
    if (u && u.hp > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + heal * dt);
  }
}

/** Aura ids active on entity `id`, in grant order (each once). */
export function activeAuras(world: World, id: EntityId): AuraId[] {
  const m = world.auraActive.get(id);
  return m ? [...m.keys()] : [];
}

/**
 * `value` (already resolved through research) with the auras active on `e` applied:
 * (value + Σadd) × Πmul. One map lookup when nothing reaches `e`.
 */
export function auraStat(world: World, e: Unit | Building, stat: Stat, value: number): number {
  const m = world.auraActive.get(e.id);
  if (!m) return value;
  const s = subjectOf(e);
  let a = 0;
  let mul = 1;
  for (const id of m.keys()) {
    for (const mod of AURAS[id].modifiers) {
      if (mod.stat !== stat || !matches(mod.target, s)) continue;
      if (mod.op === 'add') a += mod.value;
      else mul *= mod.value;
    }
  }
  return (value + a) * mul;
}
