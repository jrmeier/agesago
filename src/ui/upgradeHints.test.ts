import { describe, expect, it } from 'vitest';
import { BUILDINGS, footprintRadius } from '../core/buildings';
import { TECHS, type TechId } from '../core/techs';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type Stockpile } from '../core/types';
import { upgradeBlock } from '../sim/systems/buildingUpgrade';
import { researchBlock } from '../sim/systems/research';
import { World } from '../sim/World';
import { unlockText } from './alertRules';
import type { TechView } from './research';
import {
  ageChipText,
  ageProgress,
  ageUnlocks,
  badgedBuildings,
  canQueueResearch,
  nextAgeUp,
  readyTechs,
  readyTitle,
  techViewOf,
} from './upgradeHints';

const stock = (s: Partial<Stockpile> = {}): Stockpile => ({ food: 0, wood: 0, gold: 0, stone: 0, ...s });
const rich = stock({ food: 9999, wood: 9999, gold: 9999, stone: 9999 });
const view = (v: Partial<TechView> = {}): TechView => ({
  age: 0,
  researched: new Set<TechId>(),
  queued: new Set<TechId>(),
  stock: rich,
  ageBuildings: 0,
  ageBuildingsNeeded: 2,
  ...v,
});

function world(): World {
  const hf: Heightfield = {
    width: 80,
    depth: 80,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = { townCenter: { x: 20, z: 20 }, villagers: [{ x: 20, z: 25 }], scouts: [], nodes: [], props: [] };
  return new World(hf, layout);
}

function addBuilding(w: World, kind: BuildingKind, x: number, z: number, owner = 1, complete = true): Building {
  const b: Building = {
    id: w.allocId(), kind, owner, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete, buildProgress: complete ? 1 : 0.5, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

describe('ready techs and badges', () => {
  it('lists only techs the sim would start now', () => {
    expect(readyTechs('storehouse', view(), () => null)).toContain('bronzeAxe');
    expect(readyTechs('storehouse', view(), () => 'insufficient-resources')).toEqual([]);
    // Iron Axe waits on Bronze Axe and the Town Age, so it is not even listed.
    expect(readyTechs('storehouse', view(), () => null)).not.toContain('ironAxe');
  });

  it('skips foundations and buildings whose queue is full or held by an age-up', () => {
    expect(canQueueResearch({ complete: false })).toBe(false);
    expect(canQueueResearch({ complete: true })).toBe(true);
    expect(canQueueResearch({ complete: true, research: ['bronzeAxe'] })).toBe(true);
    expect(canQueueResearch({ complete: true, research: ['townAge'] })).toBe(false);
    expect(canQueueResearch({ complete: true, research: Array(5).fill('bronzeAxe') })).toBe(false);
  });

  it('badges own complete buildings with an affordable, startable tech', () => {
    const w = world();
    const local = w.localPlayer;
    const store = addBuilding(w, 'storehouse', 30, 30, local);
    const house = addBuilding(w, 'house', 34, 30, local);
    const site = addBuilding(w, 'storehouse', 40, 30, local, false);
    const enemy = addBuilding(w, 'storehouse', 60, 60, local + 1);
    const blockOf = (t: TechId) => researchBlock(w, local, t);
    const poor = () => badgedBuildings(w.buildings.values(), local, techViewOf(w, local), blockOf);

    Object.assign(w.stockOf(local), stock());
    expect(poor()).toEqual([]);

    Object.assign(w.stockOf(local), rich);
    const ids = poor();
    expect(ids).toContain(store.id);
    expect(ids).not.toContain(house.id);
    expect(ids).not.toContain(site.id);
    expect(ids).not.toContain(enemy.id);
  });

  it('also badges a building that can start its own next upgrade now (M14-3 tiers)', () => {
    const w = world();
    const local = w.localPlayer;
    const house = addBuilding(w, 'house', 34, 30, local);
    const other = addBuilding(w, 'house', 38, 30, local);
    const site = addBuilding(w, 'house', 42, 30, local, false);
    const blockOf = (t: TechId) => researchBlock(w, local, t);
    const canUpgrade = (b: Building) => upgradeBlock(w, b, local) === null;
    const badged = () => badgedBuildings(w.buildings.values(), local, techViewOf(w, local), blockOf, canUpgrade);
    Object.assign(w.stockOf(local), rich);

    // Village Age: Large House needs the Town Age, and a house has no techs.
    expect(badged()).not.toContain(house.id);
    w.players.get(local)!.age = 1;
    expect(badged()).toEqual(expect.arrayContaining([house.id, other.id]));
    expect(badged()).not.toContain(site.id);
    // Without the upgrade check only techs count, as before.
    expect(badgedBuildings(w.buildings.values(), local, techViewOf(w, local), blockOf)).not.toContain(house.id);

    // Already upgrading, or at the top of its chain: no badge. Too poor: no badge.
    house.upgrading = { to: 1, progress: 0 };
    other.tier = 1;
    expect(badged()).not.toContain(house.id);
    expect(badged()).not.toContain(other.id);
    house.upgrading = undefined;
    Object.assign(w.stockOf(local), stock());
    expect(badged()).not.toContain(house.id);
  });

  it('counts each kind once and names the ready techs for the panel', () => {
    let calls = 0;
    const blockOf = () => {
      calls++;
      return null;
    };
    const stores = [1, 2, 3].map((id) => ({ id, owner: 1, kind: 'storehouse' as const, complete: true }));
    expect(badgedBuildings(stores, 1, view(), blockOf)).toEqual([1, 2, 3]);
    expect(calls).toBe(readyTechs('storehouse', view(), () => null).length);
    expect(readyTitle(['bronzeAxe'])).toBe('Upgrade available: Bronze Axe');
    expect(readyTitle([])).toBe('');
  });
});

describe('age-progress chip', () => {
  it('finds the next age-up and stops in the last age', () => {
    expect(nextAgeUp(0)).toBe('townAge');
    expect(nextAgeUp(2)).toBe('empireAge');
    expect(nextAgeUp(3)).toBeNull();
    expect(ageProgress(view({ age: 3 }))).toBeNull();
  });

  it('shows the building count and the shortfall', () => {
    // Costs come from the table (M13-3 retuned them): 120 food short of the Town Age.
    const p = ageProgress(view({ stock: stock({ food: TECHS.townAge.cost.food! - 120 }), ageBuildings: 1 }))!;
    expect(p).toMatchObject({ tech: 'townAge', next: 1, built: 1, needed: 2, ready: false, advancing: false });
    expect(p.short).toEqual([{ type: 'food', amount: 120 }]);
    const t = ageChipText(p);
    expect(t.text).toBe('Town Age · 1/2 buildings · need 120 food');
    expect(t.short).toBe('Town 1/2\n−120 food');
    expect(t.title).toContain('Build 2 different Village Age buildings (1/2)');
    expect(t.title).toContain('Still need 120 food');
  });

  it('caps the count, and says ready or advancing', () => {
    const ready = ageProgress(view({ ageBuildings: 5 }))!;
    expect(ready.built).toBe(2);
    expect(ready.ready).toBe(true);
    expect(ageChipText(ready).text).toBe('Town Age ready');
    const going = ageProgress(view({ ageBuildings: 2, queued: new Set<TechId>(['townAge']) }))!;
    expect(going.ready).toBe(false);
    expect(ageChipText(going).text).toBe('Advancing to the Town Age');
  });

  it('lists every missing resource for later ages', () => {
    const city = TECHS.cityAge.cost;
    const p = ageProgress(view({ age: 1, stock: stock({ food: city.food! - 800 }), ageBuildings: 2 }))!;
    expect(p.short).toEqual([
      { type: 'food', amount: 800 },
      { type: 'gold', amount: city.gold },
    ]);
    expect(ageChipText(p).text).toBe(`City Age · 2/2 buildings · need 800 food, ${city.gold} gold`);
  });

  it('reads the live world through techViewOf', () => {
    const w = world();
    const local = w.localPlayer;
    addBuilding(w, 'storehouse', 30, 30, local);
    const v = techViewOf(w, local);
    expect(v.ageBuildings).toBe(1);
    expect(v.ageBuildingsNeeded).toBe(2);
    expect(v.stock).toBe(w.stock);
  });
});

describe('age-up unlocks', () => {
  it('lists the buildings and units an age opens', () => {
    const town = ageUnlocks(1);
    expect(town.buildings.length).toBeGreaterThan(0);
    for (const k of town.buildings) expect(BUILDINGS[k].age).toBe(1);
    expect(town.buildings).not.toContain('barracks');
    expect(ageUnlocks(0).buildings).toContain('barracks');
    // Civ units only for their own civ.
    expect(ageUnlocks(1, 'romans').units).toContain('legionary');
    expect(ageUnlocks(1, 'romans').units).not.toContain('raider');
    expect(ageUnlocks(1).units).not.toContain('legionary');
  });

  it('words the toast', () => {
    expect(unlockText(1, { buildings: ['forge', 'market'], units: ['legionary'] })).toBe(
      'Town Age unlocks: build Forge, Market · train Legionary'
    );
    expect(unlockText(2, { buildings: [], units: [] })).toBe('Entered the City Age');
    expect(unlockText(1, { buildings: [], units: ['legionary'] })).toBe('Town Age unlocks: train Legionary');
  });
});
