import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_UPGRADES, footprintRadius, nextUpgrade, popBonusOf, tierStats } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type RejectReason, type SimEvent } from '../core/types';
import { validCommand } from '../network/protocol';
import { World } from './World';
import { deserializeWorld, serializeWorld } from './serialize';
import { applyDamage } from './systems/combat';
import { upgradeBlock } from './systems/buildingUpgrade';
import { armorOf, buildingMaxHp } from './systems/stats';

const LARGE_HOUSE = BUILDING_UPGRADES.house![0];

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

function world(): World {
  const layout: MapLayout = { townCenter: { x: 20, z: 20 }, villagers: [{ x: 20, z: 25 }], scouts: [], nodes: [], props: [] };
  const w = new World(flat(), layout);
  w.seed = 1;
  return w;
}

/** A finished building straight into the world (test shortcut). */
function addBuilding(w: World, kind: BuildingKind, x: number, z: number, owner = 1): Building {
  const b: Building = {
    id: w.allocId(), kind, owner, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

/** Age 1 with plenty of everything. */
function ready(): { w: World; house: Building } {
  const w = world();
  w.players.get(1)!.age = 1;
  Object.assign(w.stock, { food: 1000, wood: 1000, gold: 1000, stone: 1000 });
  return { w, house: addBuilding(w, 'house', 40, 40) };
}

function rejections(w: World): RejectReason[] {
  const out: RejectReason[] = [];
  w.events.on('rejected', (e) => out.push(e.reason));
  return out;
}

function run(w: World, seconds: number): void {
  for (let t = 0; t < Math.round(seconds * 20); t++) w.tick(0.05);
}

describe('upgrade table', () => {
  it('chains advance one tier at a time and stack their effects', () => {
    for (const chain of Object.values(BUILDING_UPGRADES)) chain!.forEach((u, i) => expect(u.tier).toBe(i + 1));
    expect(nextUpgrade('house', 0)).toBe(LARGE_HOUSE);
    expect(nextUpgrade('house', 1)).toBeUndefined();
    expect(nextUpgrade('storehouse')).toBeUndefined();
    expect(tierStats('house', 1)).toMatchObject({ hpMul: 1.5, popBonus: 5 });
    expect(popBonusOf('house', 0)).toBe(5);
    expect(popBonusOf('house', 1)).toBe(10);
  });

  it('the new commands pass lockstep validation', () => {
    expect(validCommand({ type: 'upgradeBuilding', buildingId: 3 })).toBe(true);
    expect(validCommand({ type: 'cancelUpgrade', buildingId: 3 })).toBe(true);
    expect(validCommand({ type: 'upgradeBuilding', buildingId: 'x' })).toBe(false);
  });
});

describe('upgradeBuilding', () => {
  it('rejects with a reason: unaffordable, wrong age, busy, not complete, not owner, top tier', () => {
    const { w, house } = ready();
    const reasons = rejections(w);
    const try_ = (b: Building) => w.dispatch({ type: 'upgradeBuilding', buildingId: b.id });

    w.players.get(1)!.age = 0;
    try_(house);
    w.players.get(1)!.age = 1;

    Object.assign(w.stock, { wood: 0 });
    try_(house);
    Object.assign(w.stock, { wood: 1000 });

    const foundation = addBuilding(w, 'house', 50, 40);
    foundation.complete = false;
    try_(foundation);

    try_(addBuilding(w, 'house', 60, 40, 2));
    try_(addBuilding(w, 'storehouse', 40, 60));

    const top = addBuilding(w, 'house', 40, 50);
    top.tier = 1;
    try_(top);

    expect(upgradeBlock(w, addBuilding(w, 'granary', 60, 60), 1)).toBe('max-tier');

    // A building with something in its production queue is busy.
    house.queue = 1;
    house.queueKinds = ['villager'];
    house.productionQueue = ['train'];
    try_(house);
    house.queue = 0;
    delete house.queueKinds;
    delete house.productionQueue;

    try_(house);
    try_(house);

    expect(reasons).toEqual(['age', 'insufficient-resources', 'invalid-target', 'invalid-target', 'max-tier', 'max-tier', 'busy', 'busy']);
    expect(house.upgrading).toEqual({ to: 1, progress: 0 });
  });

  it('pays on start, emits progress, and blocks training and research while upgrading', () => {
    const { w, house } = ready();
    const tc = w.townCenter!;
    const progress: SimEvent[] = [];
    w.events.on('upgradeProgress', (e) => progress.push(e));
    const reasons = rejections(w);
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    expect(w.stock.wood).toBe(1000 - LARGE_HOUSE.cost.wood!);
    expect(w.stock.stone).toBe(1000 - LARGE_HOUSE.cost.stone!);
    run(w, 5);
    const last = progress.at(-1) as Extract<SimEvent, { type: 'upgradeProgress' }>;
    expect(last.tier).toBe(1);
    expect(last.total).toBe(LARGE_HOUSE.time);
    expect(last.progress).toBeCloseTo(5, 5);

    // Houses neither train nor research, so mark the Town Center as upgrading to check the gate.
    tc.upgrading = { to: 1, progress: 0 };
    w.dispatch({ type: 'train', buildingId: tc.id });
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'census' });
    expect(tc.queue).toBe(0);
    expect(tc.research).toBeUndefined();
    expect(reasons).toEqual(['busy', 'busy']);
  });

  it('cancel refunds in full and frees the building', () => {
    const { w, house } = ready();
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    run(w, 10);
    w.dispatch({ type: 'cancelUpgrade', buildingId: house.id });
    expect(house.upgrading).toBeUndefined();
    expect(w.stock.wood).toBe(1000);
    expect(w.stock.stone).toBe(1000);
    run(w, 30);
    expect(house.tier ?? 0).toBe(0);
    const reasons = rejections(w);
    w.dispatch({ type: 'cancelUpgrade', buildingId: house.id });
    expect(reasons).toEqual(['invalid-target']);
  });

  it('completion applies the tier: hp fraction kept, pop cap raised, event emitted', () => {
    const { w, house } = ready();
    const capBefore = w.popCapOf(1);
    house.hp = Math.round(house.maxHp / 2);
    const done: SimEvent[] = [];
    w.events.on('buildingUpgraded', (e) => done.push(e));
    const stock: SimEvent[] = [];
    w.events.on('stockpile', (e) => stock.push(e));
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    run(w, LARGE_HOUSE.time + 0.1);
    expect(house.tier).toBe(1);
    expect(house.upgrading).toBeUndefined();
    expect(done).toEqual([{ type: 'buildingUpgraded', id: house.id, owner: 1, tier: 1 }]);
    const newMax = buildingMaxHp(w, 1, 'house', 1);
    expect(newMax).toBe(Math.round(BUILDINGS.house.hp * 1.5));
    expect(house.maxHp).toBe(newMax);
    expect(house.hp).toBe(Math.round(newMax / 2));
    expect(w.popCapOf(1)).toBe(capBefore + 5);
    expect((stock.at(-1) as Extract<SimEvent, { type: 'stockpile' }>).popCap).toBe(capBefore + 5);
    expect(armorOf(w, house)).toEqual(BUILDINGS.house.armor);
    const reasons = rejections(w);
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    expect(reasons).toEqual(['max-tier']);
  });

  it('a building destroyed mid-upgrade refunds nothing', () => {
    const { w, house } = ready();
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    run(w, 5);
    applyDamage(w, house, house.hp, null, 2, { x: 45, z: 40 });
    run(w, 1);
    expect(w.buildings.has(house.id)).toBe(false);
    run(w, LARGE_HOUSE.time);
    expect(w.stock.wood).toBe(1000 - LARGE_HOUSE.cost.wood!);
    expect(w.stock.stone).toBe(1000 - LARGE_HOUSE.cost.stone!);
  });
});

describe('upgrade saves', () => {
  it('round-trips tier and upgrade progress, and finishes identically', () => {
    const { w, house } = ready();
    const done = addBuilding(w, 'house', 40, 50);
    done.tier = 1;
    done.maxHp = buildingMaxHp(w, 1, 'house', 1);
    done.hp = done.maxHp;
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    run(w, 7);
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    const restored = deserializeWorld(data, flat());
    expect(restored.buildings.get(house.id)!.upgrading).toEqual(house.upgrading);
    expect(restored.buildings.get(done.id)!.tier).toBe(1);
    expect(restored.popCapOf(1)).toBe(w.popCapOf(1));
    run(w, 20);
    run(restored, 20);
    expect(restored.buildings.get(house.id)!.tier).toBe(1);
    expect(serializeWorld(restored)).toEqual(serializeWorld(w));
  });

  it('loads version 2 saves with every building at tier 0 and no upgrade running', () => {
    const { w, house } = ready();
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    data.version = 2;
    const restored = deserializeWorld(data, flat());
    const b = restored.buildings.get(house.id)!;
    expect(b.tier).toBeUndefined();
    expect(b.upgrading).toBeUndefined();
    expect(restored.popCapOf(1)).toBe(w.popCapOf(1));
  });

  it('loads version 3 saves (before veterancy) keeping building tiers and upgrades', () => {
    const { w, house } = ready();
    w.dispatch({ type: 'upgradeBuilding', buildingId: house.id });
    run(w, 7);
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    data.version = 3;
    delete data.systems.damageLog;
    const restored = deserializeWorld(data, flat());
    expect(restored.buildings.get(house.id)!.upgrading).toEqual(house.upgrading);
    expect(restored.popCapOf(1)).toBe(w.popCapOf(1));
  });

  it('rejects corrupt tiers and upgrades', () => {
    const { w, house } = ready();
    house.tier = 2;
    expect(() => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), flat())).toThrow('building tier');
    house.tier = 1;
    house.upgrading = { to: 2, progress: 0 };
    expect(() => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), flat())).toThrow('building upgrade');
  });
});
