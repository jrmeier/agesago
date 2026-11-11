import { afterEach, describe, expect, it } from 'vitest';
import { AURAS, type AuraId, type AuraSpec } from '../core/auras';
import { BUILDINGS } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type PlayerId, type UnitKind, type Vec2 } from '../core/types';
import { UNITS } from '../core/units';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { AURA_PERIOD, activeAuras, auraSystem, recomputeAllAuras } from './systems/auras';
import { gatherInterval } from './systems/gather';
import { armorOf } from './systems/stats';
import { EXPLORED } from './visibility';
import { defaultPlayers, World } from './World';

const DT = 1 / BALANCE.tickRate;

function flat(w = 120, d = 120): Heightfield {
  return {
    width: w,
    depth: d,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function arena(teams?: number[]): World {
  const layout: MapLayout = {
    townCenter: { x: 6, z: 6 },
    villagers: [],
    scouts: [],
    extraStarts: [
      { townCenter: { x: 114, z: 114 }, villagers: [], scouts: [] },
      { townCenter: { x: 114, z: 6 }, villagers: [], scouts: [] },
    ],
    nodes: [],
    props: [],
  };
  const players = defaultPlayers(3);
  if (teams) players.forEach((p, i) => (p.team = teams[i]));
  const world = new World(flat(), layout, players);
  world.visibility.state.fill(EXPLORED);
  return world;
}

function building(world: World, kind: BuildingKind, pos: Vec2, owner: PlayerId = 1): Building {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  return b;
}

/** Advance only the aura system for one full re-scan period. */
function settle(world: World): void {
  for (let i = 0; i < AURA_PERIOD; i++) auraSystem(world, DT);
}

/** Tests can add their own auras; restore the tables afterwards. */
const restore: (() => void)[] = [];
afterEach(() => {
  while (restore.length) restore.pop()!();
});
function testAura(id: string, spec: AuraSpec, kind: UnitKind): AuraId {
  (AURAS as Record<string, AuraSpec>)[id] = spec;
  const prev = UNITS[kind].auras;
  UNITS[kind].auras = [...(prev ?? []), id as AuraId];
  restore.push(() => {
    delete (AURAS as Record<string, AuraSpec>)[id];
    UNITS[kind].auras = prev;
  });
  return id as AuraId;
}
const armorAura = (players: 'own' | 'allies', radius: AuraSpec['radius'] = 5): AuraSpec => ({
  name: 'Test Armour', description: '+2 melee armour', source: { unit: 'scout' }, radius, players,
  affects: ['allUnits'], modifiers: [{ target: 'allUnits', stat: 'armor.melee', op: 'add', value: 2 }],
});

describe('aura data', () => {
  it('temple heals and the Town Center speeds villagers', () => {
    expect(BUILDINGS.temple.auras).toContain('templeHealing');
    expect(AURAS.templeHealing).toMatchObject({ radius: 6, heal: 1, players: 'own' });
    expect(BUILDINGS.townCenter.auras).toContain('townCenterWork');
    expect(AURAS.townCenterWork.radius).toBe(10);
  });
});

describe('Town Center gather aura', () => {
  it('applies on entering the radius and lifts on leaving it', () => {
    const world = arena();
    const v = world.spawnUnit('villager', { x: 12, z: 6 }, 1);
    const base = BALANCE.gatherIntervals.wood;
    settle(world);
    expect(activeAuras(world, v.id)).toEqual(['townCenterWork']);
    expect(gatherInterval(world, v, 'wood', false)).toBeCloseTo(base / 1.05);
    v.pos = { x: 40, z: 40 };
    settle(world);
    expect(activeAuras(world, v.id)).toEqual([]);
    expect(gatherInterval(world, v, 'wood', false)).toBeCloseTo(base);
  });

  it('only reaches villagers of the owner', () => {
    const world = arena([1, 1, 2]);
    const ally = world.spawnUnit('villager', { x: 12, z: 6 }, 2);
    const soldier = world.spawnUnit('hoplite', { x: 12, z: 7 }, 1);
    settle(world);
    expect(activeAuras(world, ally.id)).toEqual([]);
    expect(activeAuras(world, soldier.id)).toEqual([]);
  });

  it('two Town Centers do not stack', () => {
    const world = arena();
    building(world, 'townCenter', { x: 18, z: 6 });
    const v = world.spawnUnit('villager', { x: 12, z: 6 }, 1);
    settle(world);
    expect(world.auraActive.get(v.id)?.get('townCenterWork')).toBe(2);
    expect(activeAuras(world, v.id)).toEqual(['townCenterWork']);
    expect(gatherInterval(world, v, 'wood', false)).toBeCloseTo(BALANCE.gatherIntervals.wood / 1.05);
  });

  it('ends when the source is destroyed', () => {
    const world = arena();
    const v = world.spawnUnit('villager', { x: 12, z: 6 }, 1);
    settle(world);
    expect(activeAuras(world, v.id)).toEqual(['townCenterWork']);
    const tc = world.townCenterOf(1)!.id;
    world.buildings.delete(tc);
    auraSystem(world, DT);
    expect(activeAuras(world, v.id)).toEqual([]);
    expect(world.auraSources.has(tc)).toBe(false);
  });
});

describe('temple healing aura', () => {
  it('heals own wounded units within 6 at 1 hp/s, not enemies or units out of range', () => {
    const world = arena();
    const temple = building(world, 'temple', { x: 60, z: 60 });
    const near = world.spawnUnit('hoplite', { x: 60, z: 65 }, 1);
    const far = world.spawnUnit('hoplite', { x: 60, z: 75 }, 1);
    const enemy = world.spawnUnit('hoplite', { x: 63, z: 60 }, 2);
    for (const u of [near, far, enemy]) u.hp = 10;
    settle(world);
    expect(activeAuras(world, near.id)).toContain('templeHealing');
    const before = near.hp;
    for (let i = 0; i < BALANCE.tickRate * 5; i++) auraSystem(world, DT);
    expect(near.hp - before).toBeCloseTo(5, 5);
    expect(far.hp).toBe(10);
    expect(enemy.hp).toBe(10);
    expect(temple.complete).toBe(true);
  });

  it('never heals past max hp, and a foundation does not heal', () => {
    const world = arena();
    building(world, 'temple', { x: 60, z: 60 });
    const u = world.spawnUnit('hoplite', { x: 60, z: 64 }, 1);
    u.hp = u.maxHp - 0.2;
    for (let i = 0; i < 40; i++) auraSystem(world, DT);
    expect(u.hp).toBe(u.maxHp);

    const w2 = arena();
    layFoundation(w2, 'temple', { x: 60, z: 60 }, 0, 1);
    const v = w2.spawnUnit('hoplite', { x: 60, z: 64 }, 1);
    v.hp = 10;
    settle(w2);
    expect(v.hp).toBe(10);
  });
});

describe('unit auras', () => {
  it("'own' reaches only the owner's units; 'allies' adds teammates but never enemies", () => {
    const own = testAura('testOwn', armorAura('own'), 'scout');
    const world = arena([1, 1, 2]);
    const src = world.spawnUnit('scout', { x: 60, z: 60 }, 1);
    const mine = world.spawnUnit('hoplite', { x: 62, z: 60 }, 1);
    const ally = world.spawnUnit('hoplite', { x: 60, z: 62 }, 2);
    const foe = world.spawnUnit('hoplite', { x: 58, z: 60 }, 3);
    settle(world);
    expect(activeAuras(world, mine.id)).toEqual([own]);
    expect(activeAuras(world, src.id)).toEqual([own]);
    expect(activeAuras(world, ally.id)).toEqual([]);
    expect(armorOf(world, mine).melee).toBe(UNITS.hoplite.armor.melee + 2);
    expect(armorOf(world, ally).melee).toBe(UNITS.hoplite.armor.melee);

    restore.pop()!();
    const allies = testAura('testAllies', armorAura('allies'), 'scout');
    recomputeAllAuras(world);
    expect(activeAuras(world, mine.id)).toEqual([allies]);
    expect(activeAuras(world, ally.id)).toEqual([allies]);
    expect(activeAuras(world, foe.id)).toEqual([]);
  });

  it('a dead or garrisoned source stops granting', () => {
    const id = testAura('testOwn', armorAura('own'), 'scout');
    const world = arena();
    const src = world.spawnUnit('scout', { x: 60, z: 60 }, 1);
    const mine = world.spawnUnit('hoplite', { x: 62, z: 60 }, 1);
    settle(world);
    expect(activeAuras(world, mine.id)).toEqual([id]);
    world.units.delete(src.id);
    auraSystem(world, DT);
    expect(activeAuras(world, mine.id)).toEqual([]);
  });

  it("'global' reaches every own unit and 'garrison' only those inside", () => {
    testAura('testGlobal', armorAura('own', 'global'), 'scout');
    const world = arena();
    world.spawnUnit('scout', { x: 10, z: 10 }, 1);
    const far = world.spawnUnit('hoplite', { x: 110, z: 60 }, 1);
    settle(world);
    expect(activeAuras(world, far.id)).toEqual(['testGlobal']);

    const tc = world.townCenterOf(1)!;
    (AURAS as Record<string, AuraSpec>).testGarrison = { ...armorAura('own', 'garrison'), affects: ['villager'] };
    const prev = BUILDINGS.townCenter.auras;
    BUILDINGS.townCenter.auras = ['testGarrison' as AuraId];
    restore.push(() => {
      BUILDINGS.townCenter.auras = prev;
      delete (AURAS as Record<string, AuraSpec>).testGarrison;
    });
    const inside = world.spawnUnit('villager', { x: 8, z: 8 }, 1);
    const outside = world.spawnUnit('villager', { x: 9, z: 9 }, 1);
    inside.state = 'garrisoned';
    inside.shelter = tc.id;
    recomputeAllAuras(world);
    expect(activeAuras(world, inside.id)).toContain('testGarrison');
    expect(activeAuras(world, outside.id)).not.toContain('testGarrison');
  });
});

describe('save/load and determinism', () => {
  it('recomputes the same auras after a load and stays in lockstep', () => {
    const seed = 4242;
    const { hf, layout } = generateMap(seed, 2);
    const world = new World(hf, layout, defaultPlayers(2));
    world.seed = seed;
    for (let i = 0; i < 40; i++) world.tick(DT);
    const villagers = [...world.units.values()].filter((u) => u.kind === 'villager' && u.owner === 1);
    expect(villagers.some((u) => activeAuras(world, u.id).includes('townCenterWork'))).toBe(true);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))), hf);
    for (const u of world.units.values()) expect(activeAuras(loaded, u.id)).toEqual(activeAuras(world, u.id));
    // Two identical runs agree tick for tick.
    const a = new World(hf, layout, defaultPlayers(2));
    const b = new World(hf, layout, defaultPlayers(2));
    for (let i = 0; i < 60; i++) { a.tick(DT); b.tick(DT); }
    expect([...a.auraActive].map(([id, m]) => [id, [...m]])).toEqual([...b.auraActive].map(([id, m]) => [id, [...m]]));
  });
});

describe('aura cost', () => {
  it('200 units and 20 sources stay under 0.1 ms per tick', () => {
    testAura('testOwn', armorAura('allies', 8), 'scout');
    const world = arena([1, 1, 2]);
    for (let i = 0; i < 10; i++) building(world, 'temple', { x: 10 + i * 10, z: 40 }, 1 + (i % 2));
    for (let i = 0; i < 10; i++) world.spawnUnit('scout', { x: 10 + i * 10, z: 60 }, 1);
    const kinds: UnitKind[] = ['villager', 'hoplite', 'archer', 'horseman'];
    const units = Array.from({ length: 200 }, (_, i) =>
      world.spawnUnit(kinds[i % 4], { x: 10 + (i % 20) * 5, z: 30 + Math.floor(i / 20) * 4 }, 1 + (i % 3)));
    for (const u of units) u.hp = 1;
    for (let i = 0; i < 50; i++) auraSystem(world, DT);
    let ms = Infinity;
    for (let batch = 0; batch < 10; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) auraSystem(world, DT);
      ms = Math.min(ms, (performance.now() - t0) / 20);
    }
    console.log(`auras, 200 units + 20 sources: ${ms.toFixed(4)} ms/tick`);
    expect(world.auraSources.size).toBeGreaterThanOrEqual(20);
    expect(ms).toBeLessThan(0.1);
  });
});
