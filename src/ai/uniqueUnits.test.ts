import { describe, expect, it, vi } from 'vitest';
import { TECHS, TECH_IDS } from '../core/techs';
import { CIV_IDS, CIVS, type CivId } from '../core/civilizations';
import { GRASS_ONLY, type Difficulty, type Heightfield, type MapLayout, type Age } from '../core/types';
import { UNITS } from '../core/units';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { defaultPlayers, World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { snapshot, type Ctx } from './context';
import { run } from './harness';
import { makeProfile } from './profile';

const HOME = { x: 20, z: 40 };
const PRODUCTION = ['barracks', 'archeryRange', 'stable'] as const;
function scenario(civ: CivId, difficulty: Difficulty, age: Age = 1, research = false) {
  const hf: Heightfield = {
    width: 150, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 150 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = {
    townCenter: HOME, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 130, z: 40 }, villagers: [], scouts: [] }],
  };
  const world = new World(hf, layout, defaultPlayers(2, [civ, civ]));
  world.players.get(1)!.age = age;
  Object.assign(world.stockOf(1), { food: 10_000, wood: 10_000, gold: 10_000, stone: 10_000 });
  for (const [i, kind] of [...PRODUCTION, ...Array(12).fill('house') as 'house'[]].entries()) {
    const b = layFoundation(world, kind, { x: 8 + i % 5 * 7, z: 12 + Math.floor(i / 5) * 7 }, 0, 1);
    completeBuilding(world, b);
    b.hp = b.maxHp;
  }
  const ai = new AIPlayer(world, 1, { difficulty, seed: 1, tune: { ...(research ? {} : { research: null }), targetVillagers: 0, firstAttack: Infinity } });
  const unique = CIVS[civ].unit;
  const choose = () => ai.military.chooseUnit(UNITS[unique].trainedAt!, snapshot(world, 1), world.stockOf(1), {});
  return { world, ai, unique, choose };
}

/** City Age with generic lines complete, so the elite rule must stand on its own. */
function fieldedElite(civ: CivId, difficulty: Difficulty) {
  const setup = scenario(civ, difficulty, 2, true);
  const { world, unique } = setup;
  const elite = TECH_IDS.find((t) => TECHS[t].civ === civ && TECHS[t].line?.unit === unique)!;
  for (const t of TECH_IDS) {
    const spec = TECHS[t];
    if (t !== elite && spec.ageUp === undefined && (spec.age ?? 0) <= 2 && (!spec.civ || spec.civ === civ)) world.players.get(1)!.researched.add(t);
  }
  for (let i = 0; i < 3; i++) world.spawnUnit(unique, { x: 50 + i, z: 50 }, 1);
  return { ...setup, elite, ctx: (setup.ai as unknown as { ctx: Ctx }).ctx };
}

describe('T122: unique-unit recruitment', () => {
  it('gives moderate ranged unique units a larger share and honors explicit tuning', () => {
    expect(makeProfile('moderate', undefined, undefined, 'persians').uniqueShare).toBe(0.265);
    expect(makeProfile('moderate', undefined, undefined, 'romans').uniqueShare).toBe(0.25);
    expect(makeProfile('hard', undefined, undefined, 'persians').uniqueShare).toBe(makeProfile('hard').uniqueShare);
    expect(makeProfile('moderate', undefined, { uniqueShare: 0 }, 'persians').uniqueShare).toBe(0);
  });

  for (const difficulty of ['moderate', 'hard'] as const) {
    it.each(CIV_IDS)(`${difficulty}, %s: fields three unique units within two minutes of unlocking them`, (civ) => {
      const { world, ai, unique } = scenario(civ, difficulty);
      for (let t = 0; t < 120; t += ai.profile.militaryInterval) {
        ai.military.pass(snapshot(world, 1));
        run(world, [], ai.profile.militaryInterval);
      }
      expect([...world.units.values()].filter((u) => u.owner === 1 && u.kind === unique).length).toBeGreaterThanOrEqual(3);
      ai.dispose();
    });

    it.each(CIV_IDS)(`${difficulty}, %s: maintains its unique share in a growing mixed army`, (civ) => {
      const { world, ai, unique } = scenario(civ, difficulty);
      for (let i = 0; i < 60; i++) {
        const building = PRODUCTION[i % PRODUCTION.length];
        const kind = ai.military.chooseUnit(building, snapshot(world, 1), world.stockOf(1), {})!;
        world.spawnUnit(kind, { x: 50 + i % 10, z: 50 + Math.floor(i / 10) }, 1);
      }
      const army = snapshot(world, 1).army;
      const count = army.filter((u) => u.kind === unique).length;
      const minimumCount = difficulty === 'moderate'
        ? Math.floor(ai.profile.uniqueShare * army.length)
        : Math.ceil(0.3 * army.length);
      expect(count).toBeGreaterThanOrEqual(minimumCount);
      ai.dispose();
    });
  }

  it.each(CIV_IDS)('%s: hard trains its unique unit and starts the elite upgrade in City Age', (civ) => {
    const { world, ai, unique } = scenario(civ, 'hard', 2, true);
    const b = layFoundation(world, 'forge', { x: 15, z: 48 }, 0, 1);
    completeBuilding(world, b);
    b.hp = b.maxHp;
    const elite = TECH_IDS.find((t) => TECHS[t].civ === civ && TECHS[t].line?.unit === unique)!;
    run(world, [ai], 240);
    expect(ai.research.started.some((s) => s.tech === elite)).toBe(true);
    ai.dispose();
  });

  it.each(CIV_IDS)('%s: the civilization forge tech stays ahead of a wanted elite upgrade', (civ) => {
    const { world, ai, unique } = scenario(civ, 'hardest', 2, true);
    const b = layFoundation(world, 'forge', { x: 15, z: 48 }, 0, 1);
    completeBuilding(world, b);
    b.hp = b.maxHp;
    for (let i = 0; i < 3; i++) world.spawnUnit(unique, { x: 50 + i, z: 50 }, 1);
    ai.research.pass(snapshot(world, 1));
    expect(ai.research.started[0]?.tech).toBe(CIVS[civ].tech);
    ai.dispose();
  });

  for (const difficulty of ['easy', 'hard'] as const) {
    it.each(CIV_IDS)(`${difficulty}, %s: elite adoption after the generic City Age line`, (civ) => {
      const { world, ai, elite } = fieldedElite(civ, difficulty);
      ai.research.pass(snapshot(world, 1));
      expect(ai.research.started.some((s) => s.tech === elite)).toBe(difficulty === 'hard');
      ai.dispose();
    });
  }

  for (const difficulty of ['easy', 'hard'] as const) {
    it.each(CIV_IDS)(`${difficulty}, %s: elite research and the Empire Age bank`, (civ) => {
      const { world, ai, unique, elite, ctx } = fieldedElite(civ, difficulty);
      // Easy has enough units for its original gate: only the spending policy differs.
      if (difficulty === 'easy') for (let i = 3; i < ai.profile.research!.lineUnits; i++) world.spawnUnit(unique, { x: 50 + i, z: 50 }, 1);
      Object.assign(world.stockOf(1), { food: 1000, wood: 1000, gold: 1000, stone: 1000 });
      ctx.reserve = { ...TECHS.empireAge.cost };
      const s = snapshot(world, 1), p = ai.profile.research!;
      const pick = ai.research.choose(s, ai.research.facts(s, p), p);
      expect(pick?.tech).toBe(difficulty === 'hard' ? elite : undefined);
      expect(ctx.reserve).toEqual(TECHS.empireAge.cost);
      ai.dispose();
    });
  }

  it.each(['expansion', 'construction'] as const)('keeps the %s reserve when budgeting for an elite upgrade', (kind) => {
    const { world, ai, ctx } = fieldedElite('persians', 'hard');
    Object.assign(world.stockOf(1), { food: 1000, wood: 400, gold: 1000, stone: 1000 });
    ctx.reserve = { ...TECHS.empireAge.cost };
    if (kind === 'expansion') ctx.townReserve = { wood: 275, stone: 100 };
    else ctx.saving = { kind: 'siegeWorkshop', cost: { wood: 300, stone: 150 } };
    const s = snapshot(world, 1), p = ai.profile.research!;
    expect(ai.research.choose(s, ai.research.facts(s, p), p)).toBeNull();
    ai.dispose();
  });

  it('keeps villager food when budgeting for an elite upgrade', () => {
    const { world, ai, ctx } = fieldedElite('celts', 'hard');
    ai.profile.targetVillagers = 48;
    Object.assign(world.stockOf(1), { food: 349, wood: 1000, gold: 1000, stone: 1000 });
    ctx.reserve = { ...TECHS.empireAge.cost };
    const s = snapshot(world, 1), p = ai.profile.research!;
    expect(ai.research.choose(s, ai.research.facts(s, p), p)).toBeNull();
    ai.dispose();
  });

  it.each(CIV_IDS)('%s: respects the age gate and reserved resources', (civ) => {
    const { world, ai, unique, choose } = scenario(civ, 'moderate', 0);
    expect(choose()).not.toBe(unique);
    world.players.get(1)!.age = 1;
    const reserve = { ...world.stockOf(1) };
    expect(ai.military.chooseUnit(UNITS[unique].trainedAt!, snapshot(world, 1), world.stockOf(1), reserve)).toBeNull();
    ai.dispose();
  });

  it.each(['romans', 'celts'] as const)('%s: still chooses spears against mass cavalry', (civ) => {
    const { ai, choose } = scenario(civ, 'hard');
    vi.spyOn(ai.intel, 'enemyMix').mockReturnValue({ infantry: 0, archer: 0, cavalry: 30, villager: 0, wildlife: 0, ship: 0, siege: 0 });
    expect(Array.from({ length: 20 }, choose)).toEqual(Array(20).fill('hoplite'));
    ai.dispose();
  });

  it('Hellenes still choose swords against mass infantry', () => {
    const { ai, choose } = scenario('hellenes', 'hard');
    vi.spyOn(ai.intel, 'enemyMix').mockReturnValue({ infantry: 30, archer: 0, cavalry: 0, villager: 0, wildlife: 0, ship: 0, siege: 0 });
    expect(Array.from({ length: 20 }, choose)).toEqual(Array(20).fill('swordsman'));
    ai.dispose();
  });

  it('Persians still choose slingers against mass infantry', () => {
    const { ai, choose } = scenario('persians', 'hard');
    vi.spyOn(ai.intel, 'enemyMix').mockReturnValue({ infantry: 30, archer: 0, cavalry: 0, villager: 0, wildlife: 0, ship: 0, siege: 0 });
    expect(Array.from({ length: 20 }, choose)).toEqual(Array(20).fill('slinger'));
    ai.dispose();
  });

  it('counts queued unique units before filling another barracks', () => {
    const { world, ai, unique, choose } = scenario('celts', 'moderate');
    for (let i = 0; i < 10; i++) world.spawnUnit('slinger', { x: 50 + i, z: 50 }, 1);
    const b = [...world.buildings.values()].find((b) => b.owner === 1 && b.kind === 'barracks')!;
    world.dispatch({ type: 'train', buildingId: b.id, unit: unique, count: 5 }, 1);
    expect(b.queue).toBe(5);
    expect(choose()).not.toBe(unique);
    ai.dispose();
  });

  it('keeps a stronger training choice when gold is scarce and other resources are abundant', () => {
    const { world, ai, unique, choose } = scenario('celts', 'moderate');
    expect(choose()).toBe(unique);
    world.stockOf(1).gold = UNITS[unique].cost.gold!;
    expect(choose()).not.toBe(unique);
    ai.dispose();
  });

  it('uses standard counter choices when defending troops urgently need reinforcements', () => {
    const pressured = scenario('celts', 'moderate');
    const control = scenario('celts', 'moderate');
    const ctx = (pressured.ai as unknown as { ctx: Ctx }).ctx;
    ctx.armyFirst = true;
    ctx.defenceHold = 100;
    control.ai.profile.uniqueShare = 0;
    expect(Array.from({ length: 20 }, pressured.choose)).toEqual(Array.from({ length: 20 }, control.choose));
    pressured.ai.dispose();
    control.ai.dispose();
  });

  it('resumes unique recruitment during raid recovery once troops can afford the choice', () => {
    const { ai, choose, unique } = scenario('celts', 'moderate');
    const ctx = (ai as unknown as { ctx: Ctx }).ctx;
    ctx.armyFirst = true;
    expect(choose()).toBe(unique);
    ai.dispose();
  });

  it.each(CIV_IDS)('%s: easy keeps its seeded random choices independent of army composition', (civ) => {
    const a = scenario(civ, 'easy');
    const b = scenario(civ, 'easy');
    for (let i = 0; i < 20; i++) b.world.spawnUnit(b.unique, { x: 50 + i % 10, z: 50 }, 1);
    const choicesA = Array.from({ length: 30 }, a.choose);
    const choicesB = Array.from({ length: 30 }, b.choose);
    expect(choicesA).toEqual(choicesB);
    expect(new Set(choicesA).size).toBeGreaterThan(1);
    a.ai.dispose(); b.ai.dispose();
  });
});
