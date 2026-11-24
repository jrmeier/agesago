import { describe, expect, it } from 'vitest';
import { BUILDINGS, footprintRadius } from '../core/buildings';
import { TECHS } from '../core/techs';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type SimEvent } from '../core/types';
import { popCost, UNITS } from '../core/units';
import { BALANCE } from './balance';
import { deserializeWorld, SAVE_VERSION, serializeWorld } from './serialize';
import { batchTime, buildingQueuedPop, queuedPop } from './systems/train';
import { World } from './World';

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
  w.seed = 17;
  Object.assign(w.stock, { food: 2000, wood: 2000, gold: 2000 });
  // Room for 24 more units (Town Center + four houses).
  for (let i = 0; i < 4; i++) addBuilding(w, 'house', 60 + (i % 2) * 8, 60 + Math.floor(i / 2) * 8);
  return w;
}

/** Drop a finished building straight into the world (test shortcut, no nav update). */
function addBuilding(w: World, kind: BuildingKind, x: number, z: number): Building {
  const b: Building = {
    id: w.allocId(), kind, owner: 1, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

function run(w: World, seconds: number) {
  for (let t = 0; t < Math.round(seconds * 20); t++) w.tick(0.05);
}

const villagers = (w: World) => [...w.units.values()].filter((u) => u.owner === 1 && u.kind === 'villager').length;
const T = UNITS.villager.trainTime;
const FOOD = UNITS.villager.cost.food!;

describe('batch training', () => {
  it('trains a batch in unitTime × count^batchExponent, all units appearing together', () => {
    expect(BALANCE.batchExponent).toBe(0.8);
    expect(batchTime(10, 1)).toBe(10);
    expect(batchTime(10, 5)).toBeCloseTo(10 * 5 ** 0.8);
    expect(batchTime(10, 5)).toBeLessThan(50);
    const w = world();
    const tc = w.townCenter!;
    const start = villagers(w);
    w.dispatch({ type: 'train', buildingId: tc.id, unit: 'villager', count: 5 });
    expect(tc.queue).toBe(5);
    expect(tc.queueKinds).toEqual(['villager']);
    expect(tc.queueCounts).toEqual([5]);
    expect(tc.productionQueue).toEqual(['train']);
    const total = batchTime(T, 5);
    run(w, total - 0.5);
    expect(villagers(w)).toBe(start);
    run(w, 0.6);
    expect(villagers(w)).toBe(start + 5);
    expect(tc.queue).toBe(0);
    expect(tc.queueCounts).toEqual([]);
  });

  it('reports the whole batch time in training progress events', () => {
    const w = world();
    const tc = w.townCenter!;
    const events: SimEvent[] = [];
    w.events.on('rejected', (e) => events.push(e));
    w.events.on('trainProgress', (e) => events.push(e));
    w.dispatch({ type: 'train', buildingId: tc.id, count: 3 });
    const progress = events.filter((e) => e.type === 'trainProgress');
    expect(progress.at(-1)).toMatchObject({ queue: 3, total: batchTime(T, 3) });
  });

  it('charges the whole batch up front and refunds all of it on cancel', () => {
    const w = world();
    const tc = w.townCenter!;
    const food = w.stock.food;
    w.dispatch({ type: 'train', buildingId: tc.id, count: 4 });
    expect(w.stock.food).toBe(food - 4 * FOOD);
    run(w, 2);
    w.dispatch({ type: 'cancelTrain', buildingId: tc.id, index: 0 });
    expect(w.stock.food).toBe(food);
    expect(tc.queue).toBe(0);
    expect(tc.progress).toBe(0);
    expect(tc.productionQueue).toEqual([]);
  });

  it('rejects a batch the stockpile cannot fully pay for, or an out-of-range count', () => {
    const w = world();
    const tc = w.townCenter!;
    const events: SimEvent[] = [];
    w.events.on('rejected', (e) => events.push(e));
    w.events.on('trainProgress', (e) => events.push(e));
    w.stock.food = FOOD * 4;
    w.dispatch({ type: 'train', buildingId: tc.id, count: 5 });
    expect(tc.queue).toBe(0);
    expect(w.stock.food).toBe(FOOD * 4);
    expect(events).toContainEqual({ type: 'rejected', reason: 'insufficient-food' });
    w.stock.food = 5000;
    w.dispatch({ type: 'train', buildingId: tc.id, count: BALANCE.maxTrainBatch + 1 });
    w.dispatch({ type: 'train', buildingId: tc.id, count: 0 });
    expect(tc.queue).toBe(0);
  });

  it('shift-batches join the last unstarted entry of the same kind, up to the batch limit', () => {
    const w = world();
    const tc = w.townCenter!;
    w.dispatch({ type: 'train', buildingId: tc.id, count: 5 });
    w.dispatch({ type: 'train', buildingId: tc.id, count: 5 }); // head not started yet: joins
    expect(tc.queueCounts).toEqual([10]);
    w.dispatch({ type: 'train', buildingId: tc.id, count: 5 }); // would exceed 10: new batch
    expect(tc.queueCounts).toEqual([10, 5]);
    expect(tc.queue).toBe(15);
    w.dispatch({ type: 'train', buildingId: tc.id }); // single orders (the AI's) never join
    expect(tc.queueCounts).toEqual([10, 5, 1]);
    expect(tc.productionQueue).toEqual(['train', 'train', 'train']);

    const b = world();
    const btc = b.townCenter!;
    b.dispatch({ type: 'train', buildingId: btc.id, count: 2 });
    run(b, 1);
    b.dispatch({ type: 'train', buildingId: btc.id, count: 5 }); // head has started: new batch
    expect(btc.queueCounts).toEqual([2, 5]);
    b.dispatch({ type: 'research', buildingId: btc.id, tech: 'wovenTunics' });
    b.dispatch({ type: 'train', buildingId: btc.id, count: 5 }); // research after it: new batch
    expect(btc.queueCounts).toEqual([2, 5, 5]);
    expect(btc.productionQueue).toEqual(['train', 'train', 'research', 'train']);
  });

  it('reserves pop for the whole batch when ordered', () => {
    const w = world();
    const tc = w.townCenter!;
    const events: SimEvent[] = [];
    w.events.on('rejected', (e) => events.push(e));
    w.events.on('trainProgress', (e) => events.push(e));
    while (w.popCapOf(1) - w.popOf(1) > 3) w.spawnUnit('villager', { x: 40, z: 40 }, 1);
    w.dispatch({ type: 'train', buildingId: tc.id, count: 4 });
    expect(tc.queue).toBe(0);
    expect(events).toContainEqual({ type: 'rejected', reason: 'pop-cap' });
    w.dispatch({ type: 'train', buildingId: tc.id, count: 3 });
    expect(tc.queue).toBe(3);
  });

  it('counts each batch at its kind\'s pop cost: a batch of siege takes UnitSpec.pop slots per unit (M16-2)', () => {
    const w = world();
    w.players.get(1)!.age = 2;
    Object.assign(w.stock, { food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    const shop = addBuilding(w, 'siegeWorkshop', 40, 40);
    const ram = popCost('ram');
    expect(ram).toBeGreaterThan(1);
    w.dispatch({ type: 'train', buildingId: shop.id, unit: 'ram', count: 2 });
    w.dispatch({ type: 'train', buildingId: w.townCenter!.id, count: 3 });
    expect(shop.queue).toBe(2);
    expect(buildingQueuedPop(shop)).toBe(2 * ram);
    expect(queuedPop(w, 1)).toBe(2 * ram + 3);
    // A ram batch needs pop room for every slot of every ram, not just one per ram.
    while (w.popCapOf(1) - w.popOf(1) - queuedPop(w, 1) > 2 * ram - 1) w.spawnUnit('villager', { x: 40, z: 60 }, 1);
    w.dispatch({ type: 'train', buildingId: shop.id, unit: 'ram', count: 2 });
    expect(shop.queue).toBe(2);
    // Legacy queues with no kinds are one villager each.
    expect(buildingQueuedPop({ queue: 3 })).toBe(3);
  });

  it('holds an unstarted batch until there is pop room for all of it', () => {
    const w = world();
    const tc = w.townCenter!;
    const events: SimEvent[] = [];
    w.events.on('rejected', (e) => events.push(e));
    w.events.on('trainProgress', (e) => events.push(e));
    w.dispatch({ type: 'train', buildingId: tc.id, count: 3 });
    // Pop fills up before the batch starts (e.g. a house is lost): leave room for two only.
    while (w.popCapOf(1) - w.popOf(1) > 2) w.spawnUnit('villager', { x: 40, z: 40 }, 1);
    const before = villagers(w);
    events.length = 0;
    run(w, batchTime(T, 3) + 2);
    expect(tc.progress).toBe(0);
    expect(villagers(w)).toBe(before);
    expect(events.filter((e) => e.type === 'rejected' && e.reason === 'pop-cap')).toHaveLength(1);
    const house = addBuilding(w, 'house', 40, 20);
    run(w, batchTime(T, 3) + 0.1);
    expect(villagers(w)).toBe(before + 3);
    expect(tc.queue).toBe(0);
    w.buildings.delete(house.id);
  });

  it('keeps FIFO order with research interleaved between batches', () => {
    const w = world();
    const tc = w.townCenter!;
    const start = villagers(w);
    w.dispatch({ type: 'train', buildingId: tc.id, count: 2 });
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'wovenTunics' });
    w.dispatch({ type: 'train', buildingId: tc.id, count: 3 });
    expect(tc.productionQueue).toEqual(['train', 'research', 'train']);
    run(w, batchTime(T, 2) + 0.1);
    expect(villagers(w)).toBe(start + 2);
    expect(tc.productionQueue).toEqual(['research', 'train']);
    expect(tc.queue).toBe(3);
    expect(tc.progress).toBe(0);
    run(w, TECHS.wovenTunics.time);
    expect(w.players.get(1)!.researched.has('wovenTunics')).toBe(true);
    expect(villagers(w)).toBe(start + 2);
    // Cancelling the batch by its entry index refunds three units and leaves research order intact.
    const food = w.stock.food;
    w.dispatch({ type: 'cancelTrain', buildingId: tc.id, index: 0 });
    expect(w.stock.food).toBe(food + 3 * FOOD);
    expect(tc.productionQueue).toEqual([]);
  });

  it('round-trips batches through a save and loads older saves as single-unit entries', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(13); // batches arrived in v13
    const w = world();
    const tc = w.townCenter!;
    w.dispatch({ type: 'train', buildingId: tc.id, count: 4 });
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'wovenTunics' });
    w.dispatch({ type: 'train', buildingId: tc.id });
    run(w, 2);
    const save = JSON.parse(JSON.stringify(serializeWorld(w)));
    const loaded = deserializeWorld(save, flat());
    const ltc = loaded.townCenter!;
    expect(ltc.queueCounts).toEqual([4, 1]);
    expect(ltc.queue).toBe(5);
    expect(ltc.productionQueue).toEqual(['train', 'research', 'train']);
    const trained = (x: World) => ({ villagers: villagers(x), queue: x.townCenter!.queue, order: x.townCenter!.productionQueue });
    run(w, batchTime(T, 4) - 1);
    run(loaded, batchTime(T, 4) - 1);
    expect(trained(loaded)).toEqual(trained(w));
    expect(ltc.queue).toBe(1);
    run(w, 60);
    run(loaded, 60);
    expect(trained(loaded)).toEqual(trained(w));
    expect(ltc.queue).toBe(0);

    const corrupt = JSON.parse(JSON.stringify(save));
    corrupt.buildings.find((b: Building) => b.kind === 'townCenter').queueCounts = [3, 1];
    expect(() => deserializeWorld(corrupt, flat())).toThrow('Invalid save: training batches');

    // A pre-batch save: no counts, one unit per queue entry (a stray count is dropped).
    const v3 = world();
    const v3tc = v3.townCenter!;
    v3.dispatch({ type: 'train', buildingId: v3tc.id });
    v3.dispatch({ type: 'train', buildingId: v3tc.id });
    // Every pre-batch version (v2..v12) loads with single-unit entries.
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const prior = JSON.parse(JSON.stringify(serializeWorld(v3)));
      prior.version = version;
      expect(deserializeWorld(prior, flat()).townCenter!.queueCounts).toBeUndefined();
    }
    const old = JSON.parse(JSON.stringify(serializeWorld(v3)));
    old.version = 12;
    const legacy = deserializeWorld(old, flat());
    const ltc3 = legacy.townCenter!;
    expect(ltc3.queueCounts).toBeUndefined();
    expect(ltc3.queue).toBe(2);
    const start = villagers(legacy);
    run(legacy, T + 0.1);
    expect(villagers(legacy)).toBe(start + 1);
    expect(ltc3.queue).toBe(1);
    const food = legacy.stock.food;
    legacy.dispatch({ type: 'cancelTrain', buildingId: ltc3.id, index: 0 });
    expect(legacy.stock.food).toBe(food + FOOD);
    expect(ltc3.queue).toBe(0);
  }, 30_000);
});

it('mirrored towns spawn units on mirrored free ground, including occupied first choices (T119D)', async () => {
  const { defaultPlayers } = await import('./World');
  const { spawnPoint } = await import('./systems/train');
  const layout: MapLayout = { townCenter: { x: 20, z: 30 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 60, z: 50 }, villagers: [], scouts: [] }] };
  const w = new World(flat(), layout, defaultPlayers(2));
  for (let i = 0; i < 8; i++) {
    const a = spawnPoint(w, w.townCenterOf(1)!, 'villager');
    const b = spawnPoint(w, w.townCenterOf(2)!, 'villager');
    expect(b.x).toBeCloseTo(80 - a.x, 10);
    expect(b.z).toBeCloseTo(80 - a.z, 10);
    w.spawnVillager(a, 1);
    w.spawnVillager(b, 2);
  }
});
