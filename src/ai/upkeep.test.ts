import { describe, expect, it } from 'vitest';
import { BUILDINGS, footprintRadius } from '../core/buildings';
import type { Building, BuildingKind } from '../core/types';
import { killUnit } from '../sim/systems/combat';
import type { World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { snapshot } from './context';
import { makeGame, run } from './harness';
import { MAX_REPAIRERS, REPAIR_CALM } from './upkeep';

const UPGRADED_BY = 20 * 60;

function upgraded(world: World, player: number): string[] {
  const out: string[] = [];
  for (const b of world.buildings.values()) if (b.owner === player && b.complete && (b.tier ?? 0) > 0) out.push(`${b.kind}:${b.tier}`);
  return out;
}

describe('upkeep AI: building upgrades (moderate, headless, idle human)', () => {
  // M13-3/M13-6 moved the City Age from about 20 to 12–15 min, and the Town Age economy now spends
  // its wood on buildings and techs, so the first upgrade lands around the City Age rather than
  // before it. The check is upgraded by UPGRADED_BY (the City Age time this was written against),
  // with the City Age reached by then.
  it.each([1, 2, 3, 4, 5])('seed %i: has an upgraded building by 20 min, past the City Age', (seed) => {
    const world = makeGame(seed, ['ai', 'human']);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed });
    const player = world.players.get(1)!;
    let aiMs = 0;
    let ticks = 0;
    let cityAt = 0;
    while (world.time < UPGRADED_BY && (upgraded(world, 1).length === 0 || player.age < 2)) {
      const st = run(world, [ai], 10);
      aiMs += st.aiMs.get(1)!;
      ticks += st.updates;
      if (!cityAt && player.age >= 2) cityAt = world.time;
    }
    const tiers = upgraded(world, 1);
    const msPerTick = aiMs / ticks;
    console.log(
      `seed ${seed}: City ${(cityAt / 60).toFixed(1)} min, first upgrade done by ${(world.time / 60).toFixed(1)} min, upgraded [${tiers.join(' ')}], ` +
        `started ${ai.upkeep.upgrades.map((u) => `${u.kind}:${u.tier}@${(u.at / 60).toFixed(1)}`).join(' ')}, AI ${msPerTick.toFixed(4)} ms/tick`
    );
    expect(player.age).toBeGreaterThanOrEqual(2);
    expect(tiers.length).toBeGreaterThanOrEqual(1);
    expect(msPerTick).toBeLessThan(1);
    ai.dispose();
  }, 180_000);
});

function addBuilding(w: World, kind: BuildingKind, x: number, z: number, owner = 1): Building {
  const b: Building = {
    id: w.allocId(), kind, owner, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

describe('upkeep AI: upgrade choices', () => {
  function cityGame() {
    const world = makeGame(2, ['ai', 'human']);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed: 2 });
    world.players.get(1)!.age = 2;
    const tc = world.townCenterOf(1)!;
    tc.tier = 2; // the TC rule is satisfied, so it doesn't compete
    const barracks = addBuilding(world, 'barracks', tc.pos.x + 12, tc.pos.z);
    for (let i = 0; i < 6; i++) world.spawnUnit('hoplite', { x: tc.pos.x + 8, z: tc.pos.z + i }, 1);
    Object.assign(world.stockOf(1), { food: 0, wood: 400, gold: 300, stone: 0 });
    // The tests reach into the AI's shared context to set what the research planner would.
    const ctx = (ai as unknown as { ctx: { reserve: object; upgradeHold: number | null } }).ctx;
    return { world, ai, barracks, ctx };
  }

  it('takes a barracks with an army of its units to level 2 in the City Age', () => {
    const { world, ai, barracks } = cityGame();
    expect(ai.upkeep.choose(snapshot(world, 1))?.id).toBe(barracks.id);
    ai.upkeep.pass(snapshot(world, 1));
    expect(barracks.upgrading?.to).toBe(1);
    expect(ai.upkeep.upgrades.map((u) => u.kind)).toEqual(['barracks']);
    ai.dispose();
  });

  it('leaves the age-up reserve alone', () => {
    const { world, ai, ctx } = cityGame();
    ctx.reserve = { wood: 300 };
    expect(ai.upkeep.choose(snapshot(world, 1))).toBeNull();
    ai.dispose();
  });

  it('holds a busy building idle so the upgrade can start', () => {
    const { world, ai, barracks, ctx } = cityGame();
    world.stockOf(1).food = 200;
    for (let i = 0; i < 3; i++) addBuilding(world, 'house', barracks.pos.x + 8, barracks.pos.z + 4 * i);
    world.dispatch({ type: 'train', buildingId: barracks.id, unit: 'hoplite' }, 1);
    expect(barracks.queue).toBe(1);
    ai.upkeep.pass(snapshot(world, 1));
    expect(ctx.upgradeHold).toBe(barracks.id);
    expect(barracks.upgrading).toBeUndefined();
    ai.dispose();
  });
});

describe('upkeep AI: repairs', () => {
  it('repairs a damaged Town Center once no enemies are in sight', () => {
    const world = makeGame(1, ['ai', 'human']);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed: 1 });
    run(world, [ai], 60);
    const tc = world.townCenterOf(1)!;
    tc.hp = Math.round(tc.maxHp * 0.5);
    // Repairing a Town Center costs wood and stone; the AI has no stone this early.
    const stock = world.stockOf(1);
    stock.wood += 200;
    stock.stone += 100;
    const repairers = () => [...world.units.values()].filter((u) => u.owner === 1 && (u.state === 'toRepair' || u.state === 'repairing')).length;

    // An enemy soldier stands in sight next to the Town Center: no repairs while it is there.
    const foe = world.spawnUnit('hoplite', { x: tc.pos.x + tc.radius + 3, z: tc.pos.z }, 2);
    foe.hp = foe.maxHp = 1e6; // the TC's arrows don't end the test early
    world.refreshFog();
    run(world, [ai], 20);
    expect(repairers()).toBe(0);
    const before = tc.hp;
    expect(before).toBeLessThan(tc.maxHp);

    // It leaves: after the calm period villagers repair, Town Center first.
    killUnit(world, foe);
    world.refreshFog();
    run(world, [ai], REPAIR_CALM + 8);
    expect(repairers()).toBeGreaterThan(0);
    expect(repairers()).toBeLessThanOrEqual(MAX_REPAIRERS);
    run(world, [ai], 30);
    expect(tc.hp).toBeGreaterThan(before);
    expect(ai.upkeep.repairs).toBeGreaterThan(0);
    ai.dispose();
  }, 60_000);
});
