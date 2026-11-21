import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout, type UnitKind } from '../core/types';
import { UNITS } from '../core/units';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { killUnit } from '../sim/systems/combat';
import { defaultPlayers, World } from '../sim/World';
import { perfBudget } from '../testing/perf';
import { AIPlayer } from './AIPlayer';
import { snapshot } from './context';
import { census, makeGame, run } from './harness';

/** Private planners/context, as in stall.test.ts, for driving a single decision. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inside = (ai: AIPlayer): any => ai as any;

const HOME = { x: 20, z: 40 };
const PRODUCTION = ['barracks', 'archeryRange', 'stable'] as const;
const SAMPLES = 60;

function arena(): World {
  const hf: Heightfield = {
    width: 150, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 150 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = {
    townCenter: HOME, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 130, z: 40 }, villagers: [], scouts: [] }],
  };
  const players = defaultPlayers(2).map((p, i) => ({ ...p, control: i === 0 ? 'ai' as const : 'human' as const }));
  return new World(hf, layout, players);
}

describe('M7-3: scripted early raid defence', () => {
  it('protects its town and economy on seeds 1–5 and clears at least four raids', () => {
    let cleared = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = makeGame(seed, ['ai', 'human']);
      const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed });
      run(world, [ai], 4 * 60);
      const tc = world.townCenterOf(1)!;
      const before = census(world, 1);
      // Approach from the map-centre side for either starting seat; rotate around blocked terrain.
      const inward = { x: world.hf.width / 2 - tc.pos.x, z: world.hf.depth / 2 - tc.pos.z };
      const approach = Math.atan2(inward.z, inward.x);
      const home = world.nav.nearestFree({ x: tc.pos.x, z: tc.pos.z + tc.radius + 1 })!;
      const positions = Array.from({ length: 24 }, (_, step) => {
        const angle = approach + step * Math.PI / 12;
        return Array.from({ length: 6 }, (_, i) => {
          const x = 18 + i % 3;
          const z = 14 + Math.floor(i / 3);
          return { x: tc.pos.x + x * Math.cos(angle) - z * Math.sin(angle), z: tc.pos.z + x * Math.sin(angle) + z * Math.cos(angle) };
        });
      }).find((group) => group.every((pos) => (pos.x - tc.pos.x) * inward.x + (pos.z - tc.pos.z) * inward.z > 0
        && world.nav.isFree(pos) && world.nav.connected(pos, home)));
      // A blocked or disconnected raid would make the defence assertion vacuous.
      expect(positions, `seed ${seed}: reachable raid spawn`).toBeDefined();
      const raid = positions!.map((pos) => world.spawnUnit('hoplite', pos, 2));
      world.dispatch({ type: 'attackMove', unitIds: raid.map((u) => u.id), target: { ...tc.pos } }, 2);
      let clearedAt: number | null = null;
      for (let elapsed = 5; elapsed <= 240; elapsed += 5) {
        run(world, [ai], 5);
        if (clearedAt === null && raid.every((u) => !world.units.has(u.id))) clearedAt = elapsed;
      }
      const after = census(world, 1);
      const dead = raid.filter((u) => !world.units.has(u.id)).length;
      console.log(`raid seed ${seed}: villagers/army ${before.villagers}/${before.army} -> ${after.villagers}/${after.army}, dead ${dead}/6, cleared ${clearedAt ?? '>240'}s, TC ${world.buildings.has(tc.id)}`);
      expect(world.buildings.get(tc.id)?.owner, `seed ${seed}: Town Center`).toBe(1);
      expect(tc.hp).toBeGreaterThan(0);
      expect(after.villagers, `seed ${seed}: economy recovers`).toBeGreaterThanOrEqual(before.villagers);
      expect(dead, `seed ${seed}: raiders killed`).toBeGreaterThanOrEqual(4);
      if (clearedAt !== null) cleared++;
      ai.dispose();
    }
    expect(cleared).toBeGreaterThanOrEqual(4);
  }, perfBudget(90_000));

  it('shelters nearby villagers after the reaction delay and releases them when the raid dies', () => {
    const world = arena();
    Object.assign(world.stockOf(1), { food: 0, wood: 0, gold: 0, stone: 0 });
    const tc = world.townCenterOf(1)!;
    expect(tc.complete).toBe(true);
    const villagers = Array.from({ length: 3 }, (_, i) => world.spawnUnit('villager', { x: 24, z: 41 + i }, 1));
    const raid = Array.from({ length: 2 }, (_, i) => world.spawnUnit('hoplite', { x: 30, z: 41 + i }, 2));
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed: 1, tune: { research: null } });
    const ctx = inside(ai).ctx;
    // Drive military passes at the reaction boundary, without the scheduler's interval rounding.
    run(world, [], 0.5, 0.125);
    expect(raid.every((u) => ai.intel.sees(u.pos.x, u.pos.z))).toBe(true);
    ai.military.pass(snapshot(world, 1));
    expect(ctx.sheltered.size).toBe(0);
    run(world, [], ai.profile.reaction, 0.125);
    ai.military.pass(snapshot(world, 1));
    expect(ctx.sheltered.size).toBeGreaterThan(0);
    expect(villagers.some((u) => u.state === 'toShelter' || u.state === 'garrisoned' || u.state === 'moving')).toBe(true);
    run(world, [], 3);
    expect(tc.occupants?.length).toBeGreaterThan(0);
    for (const u of raid) if (world.units.has(u.id)) killUnit(world, u);
    run(world, [ai], 2 * ai.profile.militaryInterval + 1);
    expect(ctx.sheltered.size).toBe(0);
    expect(tc.occupants ?? []).toHaveLength(0);
    for (const u of villagers) {
      expect(world.units.has(u.id)).toBe(true);
      expect(u.state).not.toBe('garrisoned');
      expect(u.state).not.toBe('toShelter');
    }
    ai.dispose();
  });
});

/** Real fog/intel scans, no research or production during the sampling setup. */
function choices(enemy: UnitKind | null, counters = true) {
  const world = arena();
  world.players.get(1)!.age = 1;
  Object.assign(world.stockOf(1), { food: 10_000, wood: 10_000, gold: 10_000, stone: 10_000 });
  PRODUCTION.forEach((kind, i) => {
    const b = layFoundation(world, kind, { x: 12 + i * 8, z: 28 }, 0, 1);
    completeBuilding(world, b);
    b.hp = b.maxHp;
  });
  const enemies = enemy ? Array.from({ length: 12 }, (_, i) => world.spawnUnit(enemy, { x: 27 + i % 3, z: 37 + Math.floor(i / 3) }, 2)) : [];
  const ai = new AIPlayer(world, 1, {
    difficulty: 'moderate', seed: 1,
    tune: { counters, research: null, militaryQueue: 0, targetVillagers: 0 },
  });
  run(world, [ai], 3);
  expect(enemies.every((u) => ai.intel.sees(u.pos.x, u.pos.z))).toBe(true);
  expect(ai.intel.enemyArmy()).toBe(enemies.length);
  const s = { ...snapshot(world, 1), army: [] };
  const picks = {} as Record<typeof PRODUCTION[number], UnitKind[]>;
  for (const building of PRODUCTION) {
    picks[building] = Array.from({ length: SAMPLES }, () => {
      const kind = ai.military.chooseUnit(building, s, world.stockOf(1), {});
      expect(kind).not.toBeNull();
      return kind!;
    });
  }
  console.log(`counter ${enemy ?? 'unseen'} (${counters}): ${JSON.stringify(Object.fromEntries(PRODUCTION.map((b) => [b, tally(picks[b])])))}`);
  ai.dispose();
  return picks;
}

function tally(picks: UnitKind[]): Partial<Record<UnitKind, number>> {
  const counts: Partial<Record<UnitKind, number>> = {};
  for (const kind of picks) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

describe('M7-3: counter-unit selection', () => {
  it('chooses hoplites against cavalry at least 70% of the time', () => {
    expect(tally(choices('horseman').barracks).hoplite ?? 0).toBeGreaterThanOrEqual(SAMPLES * 0.7);
  });

  it.each(['hoplite', 'swordsman'] as const)('chooses slingers and swordsmen against %s infantry', (enemy) => {
    const picks = choices(enemy);
    expect(tally(picks.archeryRange).slinger ?? 0).toBeGreaterThanOrEqual(SAMPLES * 0.7);
    const barracks = tally(picks.barracks);
    expect(barracks.swordsman ?? 0).toBeGreaterThan(barracks.hoplite ?? 0);
  });

  it('chooses stable cavalry against archers and switches the range from slingers to archers', () => {
    const archers = choices('archer');
    const infantry = choices('swordsman');
    expect(archers.stable.every((kind) => UNITS[kind].unitClass === 'cavalry')).toBe(true);
    // Equal samples per building fix the cavalry share at 1/3; compare a real choice instead.
    expect(tally(archers.archeryRange).archer ?? 0).toBeGreaterThan(tally(infantry.archeryRange).archer ?? 0);
  });

  it('picks each barracks unit 30–70% of the time with counters disabled', () => {
    const counts = tally(choices('horseman', false).barracks);
    for (const kind of ['hoplite', 'swordsman'] as const) {
      expect(counts[kind] ?? 0).toBeGreaterThanOrEqual(SAMPLES * 0.3);
      expect(counts[kind] ?? 0).toBeLessThanOrEqual(SAMPLES * 0.7);
    }
  });

  it('returns a unit from each building with nothing seen', () => {
    const picks = choices(null);
    for (const building of PRODUCTION) expect(picks[building]).toHaveLength(SAMPLES);
  });
});
