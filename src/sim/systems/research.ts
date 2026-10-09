import { BUILDINGS } from '../../core/buildings';
import { TECHS, applyStat, type Stat, type Subject, type TechId } from '../../core/techs';
import type { Age, Building, BuildingKind, EntityId, PlayerId, RejectReason } from '../../core/types';
import type { World } from '../World';
import { affordable, pay } from './build';
import { applyResearch } from './upgrades';

/**
 * Research queue (M8-5, integrator contract). A building researches its queue head; while
 * anything is queued its unit training waits. Effects are applied by upgrades.ts
 * (applyResearch) and read through statOf().
 */

/** Most techs a building may have queued at once. */
export const MAX_RESEARCH_QUEUE = 5;

/** Building kinds that don't count toward the "two buildings from your current age" rule. */
const NOT_AGE_BUILDINGS = new Set<BuildingKind>(['townCenter', 'house', 'farm', 'palisade', 'stoneWall', 'gate']);

export function ageOf(world: World, owner: PlayerId): Age {
  return world.players.get(owner)?.age ?? 0;
}

/** Distinct completed building kinds `owner` has from age `age` that count for aging up. */
export function ageBuildings(world: World, owner: PlayerId, age: Age): BuildingKind[] {
  const kinds = new Set<BuildingKind>();
  for (const b of world.buildings.values()) {
    if (b.owner !== owner || !b.complete || NOT_AGE_BUILDINGS.has(b.kind)) continue;
    if ((BUILDINGS[b.kind].age ?? 0) === age) kinds.add(b.kind);
  }
  return [...kinds];
}

/** Buildings from the current age needed before aging up. */
export const AGE_BUILDINGS_NEEDED = 2;

/** True when `owner` has `tech` queued at any of their buildings. */
export function isQueued(world: World, owner: PlayerId, tech: TechId): boolean {
  for (const b of world.buildings.values()) if (b.owner === owner && b.research?.includes(tech)) return true;
  return false;
}

/**
 * Can `owner` start `tech` now (ignoring cost when `ignoreCost`)? Used by the sim, AI and HUD
 * (to grey buttons and explain why). Does not check that a particular building exists.
 */
export function researchBlock(
  world: World,
  owner: PlayerId,
  tech: TechId,
  ignoreCost = false
): RejectReason | null {
  const p = world.players.get(owner);
  if (!p) return 'invalid-target';
  const spec = TECHS[tech];
  if (p.researched.has(tech) || isQueued(world, owner, tech)) return 'researched';
  if (p.age < spec.age) return 'age';
  if (spec.requires?.some((t) => !p.researched.has(t))) return 'requires';
  if (spec.ageUp !== undefined) {
    if (spec.ageUp !== p.age + 1) return 'age';
    if (ageBuildings(world, owner, p.age).length < AGE_BUILDINGS_NEEDED) return 'requires';
  }
  if (!ignoreCost && !affordable(world, spec.cost, owner)) return 'insufficient-resources';
  return null;
}

function emitProgress(world: World, b: Building): void {
  if (b.owner !== world.localPlayer) return;
  const head = b.research?.[0];
  if (!head) return;
  world.events.emit({
    type: 'researchProgress',
    buildingId: b.id,
    tech: head,
    queue: b.research!.length,
    progress: b.researchProgress ?? 0,
    total: TECHS[head].time,
  });
}

function reject(world: World, owner: PlayerId, reason: RejectReason): void {
  if (owner === world.localPlayer) world.events.emit({ type: 'rejected', reason });
}

/** 'research' command: queue `tech` at a complete building of the right kind; pays up front. */
export function orderResearch(world: World, buildingId: EntityId, tech: TechId): void {
  const b = world.buildings.get(buildingId);
  const spec = TECHS[tech];
  if (!b || !spec || !b.complete || spec.at !== b.kind) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  // An age-up blocks its Town Center's research queue, and only one age-up may run at once.
  if ((b.research?.length ?? 0) >= MAX_RESEARCH_QUEUE || b.research?.some((t) => TECHS[t].ageUp !== undefined)) {
    reject(world, b.owner, 'busy');
    return;
  }
  if (spec.ageUp !== undefined) {
    for (const o of world.buildings.values()) {
      if (o.owner === b.owner && o.research?.some((t) => TECHS[t].ageUp !== undefined)) {
        reject(world, b.owner, 'busy');
        return;
      }
    }
  }
  const block = researchBlock(world, b.owner, tech);
  if (block) {
    reject(world, b.owner, block);
    return;
  }
  pay(world, spec.cost, 1, b.owner);
  (b.research ??= []).push(tech);
  if (b.research.length === 1) b.researchProgress = 0;
  if (b.owner === world.localPlayer) world.emitStock();
  emitProgress(world, b);
}

/** 'cancelResearch': drop entry `index` and refund it in full. */
export function orderCancelResearch(world: World, buildingId: EntityId, index: number): void {
  const b = world.buildings.get(buildingId);
  const q = b?.research;
  if (!b || !q || index < 0 || index >= q.length) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  const [tech] = q.splice(index, 1);
  if (index === 0) b.researchProgress = 0;
  if (q.length === 0) {
    delete b.research;
    delete b.researchProgress;
  }
  pay(world, TECHS[tech].cost, -1, b.owner);
  if (b.owner === world.localPlayer) world.emitStock();
  emitProgress(world, b);
}

/** Advance each building's research head; on completion record it and apply its effects. */
export function researchSystem(world: World, dt: number): void {
  for (const b of world.buildings.values()) {
    const head = b.research?.[0];
    if (!head || !b.complete) continue;
    b.researchProgress = (b.researchProgress ?? 0) + dt;
    if (b.researchProgress >= TECHS[head].time - 1e-9) {
      b.research!.shift();
      b.researchProgress = 0;
      if (b.research!.length === 0) {
        delete b.research;
        delete b.researchProgress;
      }
      completeResearch(world, b.owner, head);
    } else {
      emitProgress(world, b);
    }
  }
}

/** Record `tech` for `owner`, advance the age if it is one, and apply its effects. */
export function completeResearch(world: World, owner: PlayerId, tech: TechId): void {
  const p = world.players.get(owner);
  if (!p || p.researched.has(tech)) return;
  p.researched.add(tech);
  statCache.get(world)?.delete(owner);
  applyResearch(world, owner, tech);
  world.events.emit({ type: 'researched', owner, tech });
  const age = TECHS[tech].ageUp;
  if (age !== undefined && age > p.age) {
    p.age = age;
    world.events.emit({ type: 'agedUp', owner, age });
  }
}

// ---- statOf: base value with the owner's research applied ----

const statCache = new WeakMap<World, Map<PlayerId, Map<string, number>>>();

/** Forget cached stats (after loading a save or editing `researched` directly in tests). */
export function clearStatCache(world: World): void {
  statCache.delete(world);
}

/**
 * `base` with `owner`'s researched modifiers applied: (base + Σadd) × Πmul. Cached per
 * player, subject, stat and base; invalidated whenever that player completes research.
 */
export function statOf(world: World, owner: PlayerId, subject: Subject, stat: Stat, base: number): number {
  const p = world.players.get(owner);
  if (!p || p.researched.size === 0) return base;
  let perWorld = statCache.get(world);
  if (!perWorld) statCache.set(world, (perWorld = new Map()));
  let cache = perWorld.get(owner);
  if (!cache) perWorld.set(owner, (cache = new Map()));
  const key = `${subject === 'player' ? 'p' : 'unit' in subject ? `u:${subject.unit}` : `b:${subject.building}`}|${stat}|${base}`;
  let v = cache.get(key);
  if (v === undefined) {
    v = applyStat(p.researched, subject, stat, base);
    cache.set(key, v);
  }
  return v;
}
