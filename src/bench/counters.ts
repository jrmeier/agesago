import type { CivId } from '../core/civilizations';
import { TECHS, type TechId } from '../core/techs';
import { GRASS_ONLY, type Age, type Building, type BuildingKind, type Heightfield, type MapLayout, type PlayerId, type Unit, type UnitKind } from '../core/types';
import { UNITS } from '../core/units';
import { BALANCE } from '../sim/balance';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { clearStatCache } from '../sim/systems/research';
import { EXPLORED } from '../sim/visibility';
import { defaultPlayers, World } from '../sim/World';

/**
 * Cost-for-cost counter fights (M16-9). Two equal-budget groups on open flat ground, both
 * attack-moving at each other from a realistic engagement gap, in the City Age by default.
 * Optional unit-line tiers grant both sides the same line upgrades, without forge research.
 * The counter table (src/core/counters.ts, shown in docs/BALANCE.md and the in-game help) is
 * checked against these fights by src/bench/counters.test.ts; `npm run bench:counters` prints it.
 */

const DT = 1 / BALANCE.tickRate;
const W = 160;

export type LineTier = 0 | 1 | 2 | 3;
export const LINE_UNITS: readonly UnitKind[] = ['hoplite', 'swordsman', 'archer', 'slinger', 'scout', 'horseman'];

export const costOf = (k: UnitKind) => Object.values(UNITS[k].cost).reduce((a, b) => a + (b ?? 0), 0);

function flat(): Heightfield {
  return {
    width: W, depth: W, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= W && z <= W, forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

function arena(age: Age, civs?: CivId[]): World {
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 }, villagers: [], scouts: [], props: [], nodes: [],
    extraStarts: [{ townCenter: { x: W - 4, z: W - 4 }, villagers: [], scouts: [] }],
  };
  const world = new World(flat(), layout, defaultPlayers(2, civs));
  for (const p of [1, 2]) {
    world.visibilityOf(p).state.fill(EXPLORED);
    world.players.get(p)!.age = age;
  }
  return world;
}

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** A block of `n` units, `cols` deep, facing the other side, its front rank at x = `front`. */
function squad(world: World, k: UnitKind, n: number, owner: PlayerId, front: number, r: () => number, cols = 3): Unit[] {
  const dir = owner === 1 ? -1 : 1;
  const rows = Math.ceil(n / cols);
  const gap = Math.max(1.2, UNITS[k].radius * 2.4);
  return Array.from({ length: n }, (_, i) => world.spawnUnit(k, {
    x: front + dir * (i % cols) * gap + (r() - 0.5) * 0.5,
    z: W / 2 + (Math.floor(i / cols) - (rows - 1) / 2) * gap + (r() - 0.5) * 0.4,
  }, owner));
}

function tick(world: World, seconds: number, until: () => boolean): number {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    world.tick(DT);
    if (until()) return (i + 1) * DT;
  }
  return seconds;
}

export interface FightResult {
  a: UnitKind; b: UnitKind; na: number; nb: number; spentA: number; spentB: number;
  /** Fraction of each side's spent resources still standing (survivors weighted by hp left). */
  leftA: number; leftB: number;
  /** a's share of the value left: 1 a clean win for a, 0 a clean win for b. */
  share: number;
  seconds: number;
}

/**
 * `a` against `b`, each with about `budget` resources. `a` gets floor(budget / cost) units and
 * `b` ceil(budget / cost), so rounding never favours the side being tested. Mean over `seeds`
 * jittered line-ups, each played from both sides.
 */
export function fight(a: UnitKind, b: UnitKind, budget = 1200, opts: { seeds?: number; age?: Age; gap?: number; civs?: CivId[]; sides?: PlayerId[]; tier?: LineTier } = {}): FightResult {
  const seeds = opts.seeds ?? 3;
  const tier = opts.tier ?? 0;
  const na = Math.max(1, Math.floor(budget / costOf(a)));
  const nb = Math.max(1, Math.ceil(budget / costOf(b)));
  let leftA = 0, leftB = 0, seconds = 0;
  // Each line-up is played twice with the sides swapped, so neither map side is favoured.
  const sides = opts.sides ?? [1, 2];
  for (let seed = 1; seed <= seeds; seed++) for (const pa of sides) {
    const pb: PlayerId = pa === 1 ? 2 : 1;
    const world = arena(Math.max(opts.age ?? 2, Math.min(3, tier)) as Age, opts.civs);
    for (const id of Object.keys(TECHS) as TechId[]) {
      const line = TECHS[id].line;
      if (!line || !LINE_UNITS.includes(line.unit) || line.tier > tier) continue;
      for (const p of [1, 2]) world.players.get(p)!.researched.add(id);
    }
    clearStatCache(world);
    const r = lcg(seed * 7919);
    const gap = opts.gap ?? 16;
    const front = (p: PlayerId) => W / 2 + (p === 1 ? -gap / 2 : gap / 2);
    const sa = squad(world, a, na, pa, front(pa), r);
    const sb = squad(world, b, nb, pb, front(pb), r);
    const toward = (p: PlayerId) => ({ x: W / 2 + (p === 1 ? 30 : -30), z: W / 2 });
    world.dispatch({ type: 'attackMove', unitIds: sa.map((u) => u.id), target: toward(pa) }, pa);
    world.dispatch({ type: 'attackMove', unitIds: sb.map((u) => u.id), target: toward(pb) }, pb);
    world.updateFog();
    const alive = (l: Unit[]) => l.filter((u) => world.units.has(u.id));
    seconds += tick(world, 400, () => !alive(sa).length || !alive(sb).length);
    const value = (l: Unit[], n: number) => alive(l).reduce((t, u) => t + u.hp / u.maxHp, 0) / n;
    leftA += value(sa, na);
    leftB += value(sb, nb);
  }
  leftA /= sides.length * seeds; leftB /= sides.length * seeds;
  return {
    a, b, na, nb, spentA: na * costOf(a), spentB: nb * costOf(b), leftA, leftB,
    share: leftA + leftB > 0 ? leftA / (leftA + leftB) : 0.5, seconds: seconds / (sides.length * seeds),
  };
}

export interface RazeResult { kind: UnitKind; n: number; spent: number; target: BuildingKind; seconds: number | null; lost: number }

/**
 * About `budget` resources of `kind` attacking an enemy `target` (no garrison, no research,
 * full hp, shooting back if it can). `seconds` to raze, null if not razed within `limit`; `lost`
 * is the fraction of the group's value lost on the way.
 */
export function raze(kind: UnitKind, target: BuildingKind, budget = 900, limit = 300): RazeResult {
  const n = Math.max(1, Math.round(budget / costOf(kind)));
  const world = arena(2);
  const b: Building = layFoundation(world, target, { x: W / 2 + 6, z: W / 2 }, 0, 2);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  const units = squad(world, kind, n, 1, W / 2 - 6, lcg(17));
  world.dispatch({ type: 'attack', unitIds: units.map((u) => u.id), targetId: b.id });
  world.updateFog();
  const t = tick(world, limit, () => !world.buildings.has(b.id));
  const left = units.filter((u) => world.units.has(u.id)).reduce((s, u) => s + u.hp / u.maxHp, 0) / n;
  return { kind, n, spent: n * costOf(kind), target, seconds: world.buildings.has(b.id) ? null : t, lost: 1 - left };
}

/** Generic (non-civ) land units and one champion pair for the full matrix. */
export const MATRIX_UNITS: UnitKind[] = ['hoplite', 'swordsman', 'slinger', 'archer', 'scout', 'horseman', 'catapult', 'boltShooter', 'praetorian', 'equites'];
