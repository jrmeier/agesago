import { beforeAll, describe, expect, it } from 'vitest';
import type { Heightfield, MapLayout, ResourceNode } from '../core/types';
import { generateMap } from './mapgen';
import { deserializeWorld, SAVE_VERSION, serializeWorld } from './serialize';
import { World } from './World';
import { completeBuilding, layFoundation } from './systems/build';
import { applyDamage } from './systems/combat';
import { completeResearch, statOf } from './systems/research';

const SEED = 17;
const DT = 0.05;
let hf: Heightfield;
let layout: MapLayout;

beforeAll(() => {
  ({ hf, layout } = generateMap(SEED, 2));
});

function fresh(): World {
  const world = new World(hf, layout);
  world.seed = SEED;
  return world;
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.tick(DT);
}

/** Hash the entire JSON snapshot, including every queue, timer, fog cell and system map. */
function hash(w: World): number {
  const json = JSON.stringify(serializeWorld(w));
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 16777619);
  return h >>> 0;
}

function active(): World {
  const w = fresh();
  // A small controlled arena in the generated starting clearings, with actual seeded scenery.
  w.nodes.clear();
  for (const u of w.units.values()) u.stance = 'passive';
  const tc = w.townCenter!;
  const workers = [...w.units.values()].filter((u) => u.owner === 1 && u.kind === 'villager');
  const [gatherer, builder, farmer] = workers;
  gatherer.pos = { x: tc.pos.x + 6, z: tc.pos.z + 6 };
  const tree: ResourceNode = {
    id: w.allocId(), kind: 'tree', type: 'wood', amount: 80, radius: 0.5,
    pos: { x: gatherer.pos.x, z: gatherer.pos.z + 1 },
  };
  w.nodes.set(tree.id, tree);
  w.dispatch({ type: 'gather', unitIds: [gatherer.id], nodeId: tree.id });
  const house = layFoundation(w, 'house', { x: tc.pos.x + 7, z: tc.pos.z - 5 }, Math.PI / 2, 1);
  builder.pos = { x: house.pos.x, z: house.pos.z + 3 };
  w.dispatch({ type: 'construct', unitIds: [builder.id], buildingId: house.id });
  const farm = layFoundation(w, 'farm', { x: tc.pos.x - 7, z: tc.pos.z + 7 }, 0, 1);
  completeBuilding(w, farm);
  farmer.pos = { x: farm.pos.x, z: farm.pos.z };
  w.dispatch({ type: 'gather', unitIds: [farmer.id], nodeId: farm.id });
  const housing = layFoundation(w, 'house', { x: tc.pos.x - 7, z: tc.pos.z - 6 }, 0, 1);
  completeBuilding(w, housing);
  w.stock.food = 100;
  w.dispatch({ type: 'rally', buildingId: tc.id, pos: tree.pos, targetId: tree.id });
  w.dispatch({ type: 'train', buildingId: tc.id });
  w.dispatch({ type: 'train', buildingId: tc.id });
  const scout = [...w.units.values()].find((u) => u.owner === 1 && u.kind === 'scout')!;
  w.dispatch({ type: 'explore', unitIds: [scout.id] });
  const enemyTC = w.townCenterOf(2)!;
  const archer = w.spawnUnit('archer', { x: enemyTC.pos.x - 8, z: enemyTC.pos.z + 7 }, 1);
  const enemy = w.spawnUnit('hoplite', { x: enemyTC.pos.x - 3, z: enemyTC.pos.z + 7 }, 2);
  enemy.stance = 'passive';
  archer.stance = 'standGround';
  w.updateFog();
  w.dispatch({ type: 'attack', unitIds: [archer.id], targetId: enemy.id });
  run(w, 43);
  // Force a second economy worker to flee with a resume job at the save boundary.
  applyDamage(w, gatherer, 1, archer.id, 2, { x: gatherer.pos.x - 2, z: gatherer.pos.z });
  // The next archer shot is due now; save with its flight unresolved.
  w.combatState.get(archer.id)!.cooldown = 0;
  w.tick(DT);
  expect(w.projectiles.length).toBeGreaterThan(0);
  expect(w.gatherState.size).toBeGreaterThan(0);
  expect(w.buildState.size).toBeGreaterThan(0);
  expect(w.farmers.size).toBeGreaterThan(0);
  expect(w.fleeState.size).toBeGreaterThan(0);
  expect(w.exploreState.size).toBeGreaterThan(0);
  expect(tc.queue).toBe(2);
  return w;
}

describe('world save/load', () => {
  it('round trips through JSON and runs combat, economy, farming, building, training and exploring in lockstep', () => {
    const a = active();
    const save = JSON.parse(JSON.stringify(serializeWorld(a)));
    const b = deserializeWorld(save, hf);
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];
    for (const type of ['projectile', 'damaged', 'died', 'removed', 'spawned', 'constructed', 'defeated', 'gameOver', 'attacked'] as const) {
      a.events.on(type, (e) => eventsA.push(e));
      b.events.on(type, (e) => eventsB.push(e));
    }
    for (let i = 0; i < 400; i++) {
      a.tick(DT);
      b.tick(DT);
      expect(hash(b), `tick ${i}`).toBe(hash(a));
    }
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
    expect(eventsB).toEqual(eventsA);
    expect(eventsA.some((e) => (e as { type: string }).type === 'spawned')).toBe(true);
    expect(eventsA.some((e) => (e as { type: string }).type === 'constructed')).toBe(true);
  }, 20000);

  it('detaches both snapshots and loaded worlds from their sources', () => {
    const a = fresh();
    const save = serializeWorld(a);
    const b = deserializeWorld(save, hf);
    const first = save.units[0];
    b.units.get(first.id)!.pos.x += 5;
    b.stock.food = 500;
    b.visibility.state.fill(2);
    expect(a.units.get(first.id)!.pos).toEqual(first.pos);
    expect(save.players[0].stock.food).toBe(0);
    expect(a.stock.food).toBe(0);
    a.units.get(first.id)!.path.push({ x: 1, z: 2 });
    expect(first.path).toEqual([]);
  });

  it('regenerates terrain/scenery and rebuilds only surviving non-walkable buildings', () => {
    const a = fresh();
    const removed = a.townCenterOf(2)!;
    a.buildings.delete(removed.id);
    a.nav.removeRect(removed.id);
    const p = a.townCenter!.pos;
    const house = layFoundation(a, 'house', { x: p.x + 7, z: p.z + 2 }, Math.PI / 2, 1);
    const farm = layFoundation(a, 'farm', { x: p.x - 7, z: p.z + 2 }, 0, 1);
    const b = deserializeWorld(serializeWorld(a));
    expect(b.hf.heightAt(73, 91)).toBe(a.hf.heightAt(73, 91));
    expect(b.nav.obstacles).toEqual(a.nav.obstacles);
    expect(b.nav.isFree(house.pos)).toBe(false);
    expect(b.nav.isFree(farm.pos)).toBe(true);
    expect(b.nav.isFree(removed.pos)).toBe(true);
    expect(b.allocId()).toBe(a.allocId());
  });

  it('retains a terminal result and emits no duplicate defeat/gameOver after loading', () => {
    const a = fresh();
    a.dispatch({ type: 'resign' }, 2);
    const b = deserializeWorld(serializeWorld(a), hf);
    const events: unknown[] = [];
    b.events.on('defeated', (e) => events.push(e));
    b.events.on('gameOver', (e) => events.push(e));
    run(b, 30);
    b.dispatch({ type: 'resign' }, 2);
    expect(b.isDefeated(2)).toBe(true);
    expect(b.gameOver).toEqual({ winners: [1], reason: 'resign' });
    expect(events).toEqual([]);
  });

  it('round-trips research, ages, prices and research queues, and reads stats fresh after a load', () => {
    const a = fresh();
    const p = a.players.get(1)!;
    p.age = 1;
    completeResearch(a, 1, 'bronzeAxe');
    completeResearch(a, 2, 'wovenTunics');
    p.prices.wood = 130;
    const tc = a.townCenter!;
    Object.assign(a.stock, { food: 1000, wood: 1000 });
    a.dispatch({ type: 'research', buildingId: tc.id, tech: 'census' });
    run(a, 20);
    expect(tc.research).toEqual(['census']);
    const save = JSON.parse(JSON.stringify(serializeWorld(a)));
    const b = deserializeWorld(save, hf);
    const q = b.players.get(1)!;
    expect([...q.researched]).toEqual(['bronzeAxe']);
    expect([...b.players.get(2)!.researched]).toEqual(['wovenTunics']);
    expect(q.age).toBe(1);
    expect(q.prices.wood).toBe(p.prices.wood); // prices drift toward base while ticking
    expect(q.prices.wood).toBeGreaterThan(100);
    expect(b.townCenter!.research).toEqual(['census']);
    expect(b.townCenter!.researchProgress).toBeCloseTo(1);
    expect(statOf(b, 1, { unit: 'villager' }, 'gather.wood', 1)).toBeCloseTo(1.2);
    expect(statOf(b, 2, { unit: 'villager' }, 'hp', 25)).toBe(40);
    expect(hash(b)).toBe(hash(a));
    run(a, 800);
    run(b, 800);
    expect(b.players.get(1)!.researched.has('census')).toBe(true);
    expect(hash(b)).toBe(hash(a));
  });

  it('rejects saves from before research with a clear message', () => {
    const old = { ...serializeWorld(fresh()), version: 1 };
    expect(() => deserializeWorld(old, hf)).toThrow('before ages and research');
  });

  it('rejects unsupported versions before regenerating a map', () => {
    expect(() => deserializeWorld({ version: SAVE_VERSION + 1 } as never)).toThrow(`Unsupported save version ${SAVE_VERSION + 1}; expected ${SAVE_VERSION}`);
    expect(() => deserializeWorld({ version: 0 } as never)).toThrow('Unsupported save version 0');
  });

  it('requires an explicit seed and rejects corrupt fog or id allocation', () => {
    const a = fresh();
    a.seed = null;
    expect(() => serializeWorld(a)).toThrow('set world.seed');
    a.seed = SEED;
    const save = serializeWorld(a);
    save.clocks.nextId = 1;
    expect(() => deserializeWorld(save, hf)).toThrow('entity ids or nextId');
    const badFog = serializeWorld(a);
    badFog.players[0].visibility.runs = [2, badFog.width * badFog.depth + 1];
    expect(() => deserializeWorld(badFog, hf)).toThrow('visibility runs');
  });

  it('rejects prototype-key techs and bad prices instead of crashing later', () => {
    const a = fresh();
    const proto = JSON.parse(JSON.stringify(serializeWorld(a)));
    proto.players[0].researched = ['constructor'];
    expect(() => deserializeWorld(proto, hf)).toThrow('researched techs');
    const prices = JSON.parse(JSON.stringify(serializeWorld(a)));
    prices.players[0].prices.wood = 'lots';
    expect(() => deserializeWorld(prices, hf)).toThrow('prices');
  }, 30_000);

  it('reports a typical two-player save size with compressed fog', () => {
    const a = fresh();
    run(a, 40);
    const save = serializeWorld(a);
    const bytes = new TextEncoder().encode(JSON.stringify(save)).length;
    console.info(`Typical ${a.units.size}-unit / ${a.nodes.size}-node save: ${(bytes / 1024).toFixed(1)} KiB`);
    expect(bytes).toBeLessThan(1024 * 1024);
    expect(save.players[0].visibility.runs.length).toBeLessThan(a.visibility.state.length / 10);
  });

  it('documents the movement contract gap: mixed-speed formations lose their private speed cap on load', () => {
    const a = fresh();
    const tc = a.townCenter!.pos;
    const v = a.spawnUnit('villager', { x: tc.x + 6, z: tc.z + 5 });
    const scout = a.spawnUnit('scout', { x: tc.x + 7, z: tc.z + 5 });
    a.dispatch({ type: 'move', unitIds: [v.id, scout.id], target: { x: tc.x + 9, z: tc.z - 6 } });
    run(a, 5);
    const b = deserializeWorld(serializeWorld(a), hf);
    a.tick(DT);
    b.tick(DT);
    expect(b.units.get(scout.id)!.pos).not.toEqual(a.units.get(scout.id)!.pos);
  });

  it('documents the exploration contract gap: the private empty-frontier cache changes the search budget', () => {
    // A half-cell barrier splits navigation but not the coarser fog BFS. Empty searches
    // in either region flood most fog cells, so two misses exceed the per-tick work budget.
    const splitHF: Heightfield = {
      ...hf,
      isWalkable: (x, z) => x >= 0 && z >= 0 && x < hf.width && z < hf.depth && !(x >= 88 && x <= 88.5),
    };
    const a = new World(splitHF, layout);
    a.seed = SEED;
    a.visibility.state.fill(1);
    a.visibility.version++;
    a.updateFog();
    const ids = [...a.units.values()].filter((u) => u.owner === 1).map((u) => u.id);
    ids.forEach((id, i) => {
      a.units.get(id)!.pos = { x: i % 2 ? 100 : 70, z: 80 + i * 2 };
    });
    a.updateFog();
    a.dispatch({ type: 'explore', unitIds: [ids[0]] });
    a.tick(DT); // caches the fact that this entire connected region has no frontier
    expect(a.exploreState.size).toBe(0);
    const b = deserializeWorld(serializeWorld(a), splitHF);
    a.dispatch({ type: 'explore', unitIds: ids });
    b.dispatch({ type: 'explore', unitIds: ids });
    a.tick(DT);
    b.tick(DT);
    // A skips cached empty searches. B floods the region, exhausting its work budget.
    expect(b.exploreState.size).toBeGreaterThan(a.exploreState.size);
  });
});
