import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_UPGRADES, footprintRadius } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type Stockpile } from '../core/types';
import { World } from '../sim/World';
import {
  UPGRADING_TEXT,
  cancelSelectedUpgrades,
  statRowsText,
  upgradeEntry,
  upgradeFraction,
  upgradeLabel,
  upgradeLockText,
  upgradeSelected,
  upgradeStatRows,
  upgradeTargets,
  upgradeTip,
} from './buildingUpgrade';

const LARGE_HOUSE = BUILDING_UPGRADES.house![0];
const RICH: Stockpile = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
const view = (over: Partial<{ age: 0 | 1 | 2 | 3; stock: Stockpile }> = {}) => ({
  age: over.age ?? 1,
  researched: new Set<never>(),
  stock: over.stock ?? RICH,
});

function world(): World {
  const flat: Heightfield = {
    width: 80,
    depth: 80,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = { townCenter: { x: 20, z: 20 }, villagers: [{ x: 20, z: 25 }], scouts: [], nodes: [], props: [] };
  const w = new World(flat, layout);
  w.seed = 1;
  w.players.get(1)!.age = 1;
  return w;
}

function addBuilding(w: World, kind: BuildingKind, x: number, z: number): Building {
  const b: Building = {
    id: w.allocId(), kind, owner: 1, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

describe('upgrade stat rows', () => {
  it('lists only the stats the next tier changes, before → after', () => {
    const hp = BUILDINGS.house.hp;
    const rows = upgradeStatRows('house', 0);
    expect(rows).toEqual([
      { label: 'HP', before: String(hp), after: String(Math.round(hp * 1.5)) },
      { label: 'Pop', before: `+${BUILDINGS.house.popBonus}`, after: `+${BUILDINGS.house.popBonus + 5}` },
    ]);
    expect(statRowsText(rows)).toBe(`HP ${hp} → ${Math.round(hp * 1.5)} · Pop +5 → +10`);
  });

  it('shows the tower chain\'s range and arrows (M14-2)', () => {
    const tower = BUILDINGS.watchTower;
    const hp = Math.round(tower.hp * 1.4);
    expect(upgradeStatRows('watchTower', 0)).toEqual([
      { label: 'HP', before: String(tower.hp), after: String(hp) },
      { label: 'Arrows', before: String(tower.attack!.arrows), after: String(tower.attack!.arrows + 1) },
      { label: 'Range', before: String(tower.attack!.range), after: String(tower.attack!.range + 1) },
    ]);
  });

  it('shows the military level 2 train speed (M14-2)', () => {
    for (const kind of ['barracks', 'archeryRange', 'stable'] as const) {
      expect(upgradeStatRows(kind, 0)).toContainEqual({ label: 'Train speed', before: '100%', after: '120%' });
    }
    expect(statRowsText(upgradeStatRows('barracks', 0))).toContain('Train speed 100% → 120%');
  });

  it('is empty without a next tier', () => {
    expect(upgradeStatRows('house', 1)).toEqual([]);
    expect(upgradeStatRows('farm', 0)).toEqual([]);
  });
});

describe('upgrade lock text', () => {
  it('words each sim block reason', () => {
    expect(upgradeLockText(LARGE_HOUSE, null, view())).toBe('');
    expect(upgradeLockText(LARGE_HOUSE, 'age', view({ age: 0 }))).toBe('Requires Town Age');
    expect(upgradeLockText(LARGE_HOUSE, 'insufficient-resources', view({ stock: { food: 0, wood: 10, gold: 0, stone: 50 } }))).toBe(
      'Not enough wood'
    );
    expect(upgradeLockText(LARGE_HOUSE, 'busy', view())).toBe('Busy: empty the queue first');
    expect(upgradeLockText(LARGE_HOUSE, 'busy', view(), true)).toBe(UPGRADING_TEXT);
    expect(upgradeLockText(LARGE_HOUSE, 'max-tier', view())).toBe('Fully upgraded');
    expect(upgradeLockText({ ...LARGE_HOUSE, requires: ['bronzeAxe'] }, 'requires', view())).toBe('Requires Bronze Axe');
  });
});

describe('upgrade entry', () => {
  it('splits hard locks from unaffordable and is null at max tier', () => {
    const house = { kind: 'house' as const, tier: 0 };
    expect(upgradeEntry(house, null, view())).toMatchObject({ locked: false, unaffordable: false, reason: '' });
    expect(upgradeEntry(house, 'age', view({ age: 0 }))).toMatchObject({ locked: true, reason: 'Requires Town Age' });
    expect(upgradeEntry(house, 'insufficient-resources', view({ stock: { food: 0, wood: 0, gold: 0, stone: 0 } }))).toMatchObject({
      locked: false,
      unaffordable: true,
      reason: 'Not enough wood and stone',
    });
    expect(upgradeEntry({ kind: 'house', tier: 1 }, 'max-tier', view())).toBeNull();
  });

  it('builds a tooltip with the hotkey, stats, cost, time and reason', () => {
    const e = upgradeEntry({ kind: 'house', tier: 0 }, 'age', view({ age: 0 }))!;
    expect(upgradeTip(e, '60 wood, 20 stone', '20s', '⇧U')).toBe(
      `Upgrade to Large House (⇧U): ${statRowsText(e.rows)}. 60 wood, 20 stone · 20s. Requires Town Age.`
    );
  });
});

describe('upgrade progress', () => {
  it('labels and measures the running upgrade', () => {
    const b = { kind: 'house' as const, upgrading: { to: 1, progress: LARGE_HOUSE.time * 0.4 } };
    expect(upgradeFraction(b)).toBeCloseTo(0.4);
    expect(upgradeLabel(b)).toBe('Upgrading to Large House 40%');
    expect(upgradeFraction({ kind: 'house' })).toBe(0);
    expect(upgradeLabel({ kind: 'house' })).toBe('');
  });
});

describe('multi-select upgrade targets', () => {
  const houses = [1, 2, 3].map((id) => ({ id, kind: 'house' as const, tier: 0 }));

  it('takes every same-kind, same-tier building that can start, while the stock covers one more', () => {
    expect(upgradeTargets(houses[0], houses, () => null, RICH)).toEqual([1, 2, 3]);
    // Wood for two: 60 each.
    expect(upgradeTargets(houses[0], houses, () => null, { ...RICH, wood: 130 })).toEqual([1, 2]);
    // A busy one is skipped, other kinds and tiers too.
    const mixed = [...houses, { id: 4, kind: 'barracks' as const, tier: 0 }, { id: 5, kind: 'house' as const, tier: 1 }];
    expect(upgradeTargets(houses[0], mixed, (id) => (id === 2 ? 'busy' : null), RICH)).toEqual([1, 3]);
  });

  it('dispatches one command per building, and cancels each', () => {
    const w = world();
    Object.assign(w.stock, RICH);
    const a = addBuilding(w, 'house', 40, 40);
    const b = addBuilding(w, 'house', 50, 40);
    const store = addBuilding(w, 'storehouse', 60, 40);
    expect(upgradeSelected(w, [a.id, store.id, b.id])).toBe(2);
    expect(a.upgrading?.to).toBe(1);
    expect(b.upgrading?.to).toBe(1);
    expect(w.stock.wood).toBe(1000 - 2 * LARGE_HOUSE.cost.wood!);
    cancelSelectedUpgrades(w, [a.id, b.id]);
    expect(a.upgrading).toBeUndefined();
    expect(b.upgrading).toBeUndefined();
    expect(w.stock.wood).toBe(1000);
  });

  it('does nothing for a building without an upgrade chain', () => {
    const w = world();
    Object.assign(w.stock, RICH);
    const store = addBuilding(w, 'storehouse', 40, 40);
    expect(upgradeSelected(w, [store.id])).toBe(0);
    expect(w.stock).toEqual(RICH);
  });
});
