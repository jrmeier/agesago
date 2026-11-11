import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_UPGRADES, buildingTitle, footprintRadius, nextUpgrade, popBonusOf } from '../core/buildings';
import { TECHS, TECH_IDS, type TechId } from '../core/techs';
import { GRASS_ONLY, type Age, type Building, type BuildingKind, type Heightfield, type MapLayout, type RejectReason } from '../core/types';
import { UNITS } from '../core/units';
import { lockText } from '../ui/research';
import { World } from './World';
import { deserializeWorld, serializeWorld } from './serialize';
import { upgradeBlock } from './systems/buildingUpgrade';
import { researchBlock } from './systems/research';
import { armorOf, buildingAttack, buildingMaxHp, garrisonCap } from './systems/stats';
import { trainTime } from './systems/train';

/** Upgrade chains for towers, walls, the Town Center and military buildings (M14-2). */

function flat(): Heightfield {
  return {
    width: 80,
    depth: 80,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

/** A world at `age` with plenty of everything. */
function world(age: Age): World {
  const layout: MapLayout = { townCenter: { x: 20, z: 20 }, villagers: [{ x: 20, z: 25 }], scouts: [], nodes: [], props: [] };
  const w = new World(flat(), layout);
  w.seed = 1;
  w.players.get(1)!.age = age;
  Object.assign(w.stock, { food: 5000, wood: 5000, gold: 5000, stone: 5000 });
  return w;
}

function addBuilding(w: World, kind: BuildingKind, x: number, z: number, owner = 1): Building {
  const b: Building = {
    id: w.allocId(), kind, owner, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

function run(w: World, seconds: number): void {
  for (let t = 0; t < Math.round(seconds * 20); t++) w.tick(0.05);
}

function rejections(w: World): RejectReason[] {
  const out: RejectReason[] = [];
  w.events.on('rejected', (e) => out.push(e.reason));
  return out;
}

/** Start `b`'s next upgrade and run until it completes; asserts it paid the spec's cost. */
function upgrade(w: World, b: Building): void {
  const spec = nextUpgrade(b.kind, b.tier)!;
  const before = { ...w.stock };
  w.dispatch({ type: 'upgradeBuilding', buildingId: b.id });
  for (const [r, n] of Object.entries(spec.cost)) expect(w.stock[r as keyof typeof before]).toBe(before[r as keyof typeof before] - n);
  run(w, spec.time + 0.1);
  expect(b.tier).toBe(spec.tier);
}

describe('chain table', () => {
  it('every chain step has a cost, time, age gate and stat change, and ages never go down', () => {
    const kinds = Object.keys(BUILDING_UPGRADES) as BuildingKind[];
    expect(kinds.sort()).toEqual(['archeryRange', 'barracks', 'house', 'palisade', 'stable', 'stoneWall', 'townCenter', 'watchTower']);
    for (const kind of kinds) {
      let age = 0;
      BUILDING_UPGRADES[kind]!.forEach((u, i) => {
        expect(u.tier).toBe(i + 1);
        expect(Object.values(u.cost).reduce((a, n) => a + (n ?? 0), 0)).toBeGreaterThan(0);
        expect(u.time).toBeGreaterThan(0);
        expect(u.age).toBeGreaterThanOrEqual(Math.max(age, BUILDINGS[kind].age ?? 0));
        expect(Object.keys(u.effects).length).toBeGreaterThan(0);
        expect(buildingTitle(kind, u.tier)).toBe(u.title);
        age = u.age;
      });
    }
  });

  it('the academy tower techs are gone', () => {
    expect(Object.hasOwn(TECHS, 'guardTower')).toBe(false);
    expect(Object.hasOwn(TECHS, 'fortressTower')).toBe(false);
  });
});

describe('watch tower → Guard Tower → Fortress Tower', () => {
  it('is gated by age and stacks hp, arrows, range and armour per tower', () => {
    const w = world(1);
    const tower = addBuilding(w, 'watchTower', 40, 40);
    const other = addBuilding(w, 'watchTower', 50, 40);
    const base = buildingAttack(w, tower)!;
    expect(upgradeBlock(w, tower, 1)).toBe('age');
    w.players.get(1)!.age = 2;
    upgrade(w, tower);
    expect(tower.maxHp).toBe(Math.round(BUILDINGS.watchTower.hp * 1.4));
    expect(buildingAttack(w, tower)).toMatchObject({ arrows: base.arrows + 1, range: base.range + 1 });
    // Only that tower: the global tech is gone.
    expect(buildingAttack(w, other)).toEqual(base);
    expect(other.maxHp).toBe(BUILDINGS.watchTower.hp);
    expect(upgradeBlock(w, tower, 1)).toBe('age');
    w.players.get(1)!.age = 3;
    upgrade(w, tower);
    expect(buildingTitle('watchTower', tower.tier)).toBe('Fortress Tower');
    expect(tower.maxHp).toBe(Math.round(BUILDINGS.watchTower.hp * 1.4 * 1.5));
    expect(buildingAttack(w, tower)).toMatchObject({ arrows: base.arrows + 2, range: base.range + 1 });
    const a = BUILDINGS.watchTower.armor;
    expect(armorOf(w, tower)).toEqual({ melee: a.melee + 2, pierce: a.pierce + 2, crush: 0 }); // tower tiers add no crush armour (M16-1)
    expect(upgradeBlock(w, tower, 1)).toBe('max-tier');
  });
});

describe('walls', () => {
  it('a palisade becomes a Reinforced Palisade in the Town Age', () => {
    const w = world(0);
    const wall = addBuilding(w, 'palisade', 40, 40);
    expect(upgradeBlock(w, wall, 1)).toBe('age');
    w.players.get(1)!.age = 1;
    upgrade(w, wall);
    expect(wall.maxHp).toBe(Math.round(BUILDINGS.palisade.hp * 1.5));
    expect(armorOf(w, wall)).toEqual({ melee: BUILDINGS.palisade.armor.melee + 1, pierce: BUILDINGS.palisade.armor.pierce + 1, crush: 0 });
  });

  it('a stone wall becomes a Fortified Stone Wall in the City Age', () => {
    const w = world(1);
    const wall = addBuilding(w, 'stoneWall', 40, 40);
    expect(upgradeBlock(w, wall, 1)).toBe('age');
    w.players.get(1)!.age = 2;
    upgrade(w, wall);
    expect(wall.maxHp).toBe(Math.round(BUILDINGS.stoneWall.hp * 1.4));
    expect(armorOf(w, wall).pierce).toBe(BUILDINGS.stoneWall.armor.pierce + 1);
  });
});

describe('Town Center tiers', () => {
  it('Town, City and Empire tiers add hp, arrows and garrison, one age each', () => {
    const w = world(0);
    const tc = w.townCenter!;
    const hp0 = tc.maxHp;
    const base = buildingAttack(w, tc)!;
    const garrison0 = garrisonCap(w, 1, 'townCenter', 0);
    expect(upgradeBlock(w, tc, 1)).toBe('age');
    w.players.get(1)!.age = 1;
    upgrade(w, tc);
    expect(tc.maxHp).toBe(Math.round(hp0 * 1.15));
    expect(buildingAttack(w, tc)!.arrows).toBe(base.arrows + 1);
    expect(garrisonCap(w, 1, 'townCenter', tc.tier)).toBe(garrison0 + 5);
    expect(upgradeBlock(w, tc, 1)).toBe('age');
    w.players.get(1)!.age = 2;
    upgrade(w, tc);
    expect(buildingAttack(w, tc)!.arrows).toBe(base.arrows + 2);
    expect(garrisonCap(w, 1, 'townCenter', tc.tier)).toBe(garrison0 + 10);
    expect(armorOf(w, tc).pierce).toBe(BUILDINGS.townCenter.armor.pierce + 1);
    w.players.get(1)!.age = 3;
    upgrade(w, tc);
    expect(buildingTitle('townCenter', 3)).toBe('Imperial Palace');
    expect(tc.maxHp).toBe(Math.round(BUILDINGS.townCenter.hp * 1.15 * 1.15 * 1.2));
    expect(buildingAttack(w, tc)!.arrows).toBe(base.arrows + 4);
    expect(popBonusOf('townCenter', 3)).toBe(BUILDINGS.townCenter.popBonus);
  });

  it('a busy Town Center cannot start its upgrade', () => {
    const w = world(1);
    const tc = w.townCenter!;
    w.dispatch({ type: 'train', buildingId: tc.id });
    expect(upgradeBlock(w, tc, 1)).toBe('busy');
  });
});

describe('military buildings level 2', () => {
  const cases: [BuildingKind, keyof typeof UNITS][] = [['barracks', 'hoplite'], ['archeryRange', 'archer'], ['stable', 'horseman']];

  it.each(cases)('%s level 2 trains %s 20%% faster from the City Age', (kind, unit) => {
    const w = world(1);
    const b = addBuilding(w, kind, 40, 40);
    const slow = trainTime(w, b, unit);
    expect(slow).toBe(UNITS[unit].trainTime);
    expect(upgradeBlock(w, b, 1)).toBe('age');
    w.players.get(1)!.age = 2;
    upgrade(w, b);
    expect(trainTime(w, b, unit)).toBeCloseTo(slow / 1.2, 9);
    expect(b.maxHp).toBe(Math.round(BUILDINGS[kind].hp * 1.1));
    // A unit really comes out sooner than the base train time.
    const count = (): number => [...w.units.values()].filter((u) => u.kind === unit).length;
    w.dispatch({ type: 'train', buildingId: b.id, unit });
    run(w, slow / 1.2 + 0.2);
    expect(count()).toBe(1);
  });

  it('tier-3 unit-line techs need a level-2 building of their kind, with readable lock text', () => {
    const tier3 = TECH_IDS.filter((t) => TECHS[t].line?.tier === 3);
    expect(tier3.length).toBe(6);
    for (const tech of tier3) {
      const spec = TECHS[tech];
      const w = world(3);
      for (const r of spec.requires ?? []) w.players.get(1)!.researched.add(r);
      const b = addBuilding(w, spec.at, 40, 40);
      expect(researchBlock(w, 1, tech)).toBe('requires');
      const text = lockText(tech, 'requires', {
        age: 3, researched: w.players.get(1)!.researched, queued: new Set(), stock: w.stock, ageBuildings: 0,
      });
      expect(text).toBe(`Requires a ${buildingTitle(spec.at, 1)} (${BUILDINGS[spec.at].name} level 2)`);
      // An unfinished upgrade or someone else's level-2 building doesn't count.
      b.upgrading = { to: 1, progress: 1 };
      addBuilding(w, spec.at, 60, 60, 2).tier = 1;
      expect(researchBlock(w, 1, tech)).toBe('requires');
      delete b.upgrading;
      b.tier = 1;
      expect(researchBlock(w, 1, tech)).toBeNull();
    }
    expect(lockText('silverShield', 'requires', { age: 3, researched: new Set(), queued: new Set(), stock: world(3).stock, ageBuildings: 0 }))
      .toBe('Requires Phalangites');
  });

  it('dispatching a tier-3 tech without the level-2 building is rejected', () => {
    const w = world(3);
    const b = addBuilding(w, 'barracks', 40, 40);
    for (const t of ['veteranHoplite', 'phalangite'] as TechId[]) w.players.get(1)!.researched.add(t);
    const reasons = rejections(w);
    w.dispatch({ type: 'research', buildingId: b.id, tech: 'silverShield' });
    expect(reasons).toEqual(['requires']);
    expect(b.research).toBeUndefined();
  });
});

describe('save migration from the academy tower techs (v4 → v5, and older)', () => {
  /** A v4 save (or `version`) in which player 1 researched `techs` (ids that no longer exist) with two towers. */
  function legacySave(techs: string[], version = 4) {
    const w = world(3);
    const towers = [addBuilding(w, 'watchTower', 40, 40), addBuilding(w, 'watchTower', 50, 40)];
    const foundation = addBuilding(w, 'watchTower', 60, 40);
    foundation.complete = false;
    foundation.buildProgress = 0.5;
    const enemy = addBuilding(w, 'watchTower', 40, 60, 2);
    // Under the old global tech, towers' maxHp already carried the hp multiplier.
    const hpMul = techs.includes('fortressTower') ? 1.4 * 1.5 : techs.includes('guardTower') ? 1.4 : 1;
    for (const t of towers) t.maxHp = t.hp = Math.round(BUILDINGS.watchTower.hp * hpMul);
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    data.version = version;
    data.players.find((p: { player: { id: number } }) => p.player.id === 1).researched.push(...techs);
    return { data, towers, foundation, enemy };
  }

  it('Guard Tower research loads as tier-1 towers', () => {
    const { data, towers, foundation, enemy } = legacySave(['ballistics', 'guardTower']);
    const w = deserializeWorld(data, flat());
    for (const t of towers) {
      const b = w.buildings.get(t.id)!;
      expect(b.tier).toBe(1);
      expect(b.maxHp).toBe(buildingMaxHp(w, 1, 'watchTower', 1));
      expect(buildingAttack(w, b)!.arrows).toBe(BUILDINGS.watchTower.attack!.arrows + 1);
    }
    expect(w.buildings.get(foundation.id)!.tier).toBe(1);
    expect(w.buildings.get(enemy.id)!.tier).toBeUndefined();
    expect([...w.players.get(1)!.researched]).toEqual(['ballistics']);
    // The migrated world saves as a valid current save and keeps running (this test world has one player).
    w.buildings.delete(enemy.id);
    run(w, 1);
    expect(deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), flat()).buildings.get(towers[0].id)!.tier).toBe(1);
  });

  it('Fortress Tower research loads as tier-2 towers', () => {
    const { data, towers } = legacySave(['guardTower', 'fortressTower'], 3);
    const w = deserializeWorld(data, flat());
    for (const t of towers) {
      const b = w.buildings.get(t.id)!;
      expect(b.tier).toBe(2);
      expect(b.maxHp).toBe(buildingMaxHp(w, 1, 'watchTower', 2));
    }
    expect(w.players.get(1)!.researched.size).toBe(0);
  });

  it('a queued legacy tower tech is dropped and refunded', () => {
    const w0 = world(3);
    const academy = addBuilding(w0, 'academy', 40, 40);
    const data = JSON.parse(JSON.stringify(serializeWorld(w0)));
    data.version = 4;
    const a = data.buildings.find((b: Building) => b.id === academy.id);
    Object.assign(a, { research: ['guardTower', 'masonry'], researchProgress: 12, productionQueue: ['research', 'research'] });
    const w = deserializeWorld(data, flat());
    const b = w.buildings.get(academy.id)!;
    expect(b.research).toEqual(['masonry']);
    expect(b.productionQueue).toEqual(['research']);
    expect(b.researchProgress).toBe(0);
    expect(w.players.get(1)!.stock).toMatchObject({ food: 5100, wood: 5250 });
    run(w, TECHS.masonry.time + 0.2);
    expect(w.players.get(1)!.researched.has('masonry')).toBe(true);
  });
});
