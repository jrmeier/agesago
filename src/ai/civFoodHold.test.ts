import { describe, expect, it } from 'vitest';
import { CIVS } from '../core/civilizations';
import { GRASS_ONLY, type Difficulty, type Heightfield, type MapLayout } from '../core/types';
import { World, defaultPlayers } from '../sim/World';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { killUnit } from '../sim/systems/combat';
import { AIPlayer } from './AIPlayer';
import { snapshot, type Ctx } from './context';
import { run } from './harness';

/** A Town Age economy with a finished forge; food arrivals are controlled by each test. */
function town(villagers = 20, difficulty: Difficulty = 'moderate', time = 0) {
  const hf: Heightfield = {
    width: 150, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 150 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = {
    townCenter: { x: 20, z: 40 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 130, z: 40 }, villagers: [], scouts: [] }],
  };
  const players = defaultPlayers(2, ['hellenes', 'romans']).map((p) => ({ ...p, control: p.id === 1 ? 'ai' as const : 'human' as const }));
  const world = new World(hf, layout, players);
  world.time = time;
  world.players.get(1)!.age = 1;
  world.players.get(1)!.researched.add('townAge');
  completeBuilding(world, layFoundation(world, 'forge', { x: 30, z: 40 }, 0, 1));
  for (let i = 0; i < 4; i++) completeBuilding(world, layFoundation(world, 'house', { x: 10 + i * 7, z: 20 }, 0, 1));
  for (let i = 0; i < villagers; i++) world.spawnUnit('villager', { x: 15 + i % 5, z: 45 + Math.floor(i / 5) }, 1);
  Object.assign(world.stockOf(1), { food: 100, wood: 0, gold: 100, stone: 0 });
  const ai = new AIPlayer(world, 1, { difficulty, seed: 1 });
  const tc = world.townCenterOf(1)!;
  const pass = () => ai.economy.econPass(snapshot(world, 1));
  return { world, ai, tc, pass };
}

describe('T123: one bounded food hold for the first civilization tech', () => {
  it('buys food with surplus gold while keeping the technology itself affordable', () => {
    const { world, ai, pass } = town();
    completeBuilding(world, layFoundation(world, 'market', { x: 37, z: 40 }, 0, 1));
    Object.assign(world.stockOf(1), { food: 50, gold: 375 });
    pass();
    ai.research.pass(snapshot(world, 1));
    expect(world.stockOf(1).food).toBeGreaterThanOrEqual(225);
    expect(world.stockOf(1).gold).toBeGreaterThanOrEqual(100);
    world.time += ai.profile.research!.gap + 1;
    ai.research.pass(snapshot(world, 1));
    expect(ai.research.started.some(({ tech }) => tech === CIVS.hellenes.tech)).toBe(true);
    ai.dispose();
  });

  it('can fund a needed market before earmarking wood for expansion', () => {
    const { world, ai, tc } = town();
    Object.assign(world.stockOf(1), { food: 50, wood: 175, gold: 375 });
    const ctx = (ai as unknown as { ctx: Ctx }).ctx;
    ctx.townReserve = { wood: 275 };
    world.players.get(1)!.visibility.update([{ pos: tc.pos, sight: 35 }]);
    ai.intel.scan();
    ai.intel.refreshNodes();
    ai.research.pass(snapshot(world, 1));
    expect([...world.buildings.values()].some(b => b.owner === 1 && b.kind === 'market')).toBe(true);
    ai.dispose();
  });
  it('leaves the tech and one villager affordable, then resumes training when research starts', () => {
    const { world, ai, tc, pass } = town();
    world.stockOf(1).food = 200;
    pass();
    expect(tc.queue).toBe(0);
    expect(world.stockOf(1).food).toBe(200);
    world.stockOf(1).food = 225;
    ai.research.pass(snapshot(world, 1));
    expect(ai.research.started[0]?.tech).toBe(CIVS.hellenes.tech);
    expect(world.stockOf(1).food).toBe(50);
    pass();
    expect(tc.queue).toBe(1);
    ai.dispose();
  });

  it('does not hold below the existing Town Age villager threshold', () => {
    const { ai, tc, pass } = town(19);
    expect(ai.profile.research!.townAgeAt).toBe(20);
    pass();
    expect(tc.queue).toBe(2);
    ai.dispose();
  });

  it('does not hold while the gold cost is missing', () => {
    const { world, ai, tc, pass } = town();
    world.stockOf(1).gold = 99;
    pass();
    expect(tc.queue).toBe(2);
    ai.dispose();
  });

  it('leaves easy training unchanged', () => {
    const { ai, tc, pass } = town(20, 'easy');
    pass();
    expect(tc.queue).toBe(1);
    ai.dispose();
  });

  it('expires at 60 seconds and never starts a second hold', () => {
    const { world, ai, tc, pass } = town();
    pass();
    expect(tc.queue).toBe(0);
    world.time = 60;
    pass();
    expect(tc.queue).toBe(2);
    run(world, [], 20);
    expect(tc.queue).toBe(0);
    world.stockOf(1).food = 100;
    pass();
    expect(tc.queue).toBe(2);
    ai.dispose();
  });

  it('ignores incidental damage, pauses immediately for a raid, and resumes its unused budget', () => {
    const { world, ai, tc, pass } = town();
    pass();
    expect(tc.queue).toBe(0);
    world.events.emit({ type: 'attacked', owner: 1, id: tc.id, pos: tc.pos });
    pass();
    expect(tc.queue).toBe(0);
    const raider = world.spawnUnit('hoplite', { x: tc.pos.x + 5, z: tc.pos.z }, 2);
    run(world, [], 0.1);
    world.events.emit({ type: 'attacked', owner: 1, id: tc.id, pos: tc.pos });
    pass();
    expect(tc.queue).toBe(2);
    killUnit(world, raider);
    run(world, [], 31);
    world.stockOf(1).food = 100;
    const before = tc.queue;
    pass();
    expect(tc.queue).toBe(before);
    ai.dispose();
  });

  it('yields to T120 defence food priority without replacing its reserve', () => {
    const { world, ai, tc, pass } = town();
    pass();
    const ctx = (ai as unknown as { ctx: Ctx }).ctx;
    ctx.defenceHold = 100;
    world.stockOf(1).food = 150;
    pass();
    expect(tc.queue).toBe(1);
    expect(world.stockOf(1).food).toBe(100);
    ai.dispose();
  });

  it('defers the hardest opening food reserve while its army has priority', () => {
    const { ai, pass } = town(20, 'hardest');
    const ctx = (ai as unknown as { ctx: Ctx }).ctx;
    ctx.armyFirst = true;
    pass();
    expect(ctx.openingCivFood).toBe(0);
    ctx.armyFirst = false;
    pass();
    expect(ctx.openingCivFood).toBeGreaterThan(0);
    ai.dispose();
  });

  it('keeps the research food out of military queues until the army needs it for defence', () => {
    const { world, ai, tc, pass } = town();
    const barracks = layFoundation(world, 'barracks', { x: 28, z: 30 }, 0, 1);
    completeBuilding(world, barracks);
    for (let i = 0; i < 3; i++) world.spawnUnit('hoplite', { x: 28 + i, z: 34 }, 1);
    Object.assign(world.stockOf(1), { food: 200, wood: 200 });
    pass();
    ai.military.pass(snapshot(world, 1));
    expect(barracks.queue).toBe(0);
    world.spawnUnit('hoplite', { x: tc.pos.x + 5, z: tc.pos.z }, 2);
    run(world, [], 0.1);
    world.events.emit({ type: 'attacked', owner: 1, id: tc.id, pos: tc.pos });
    ai.military.pass(snapshot(world, 1));
    expect(barracks.queue).toBeGreaterThan(0);
    ai.dispose();
  });

  it('does not grant another opening hold when an AI is attached to a running or loaded game', () => {
    const { ai, tc, pass } = town(20, 'moderate', 10);
    pass();
    expect(tc.queue).toBe(2);
    ai.dispose();
  });
});
