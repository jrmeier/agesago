import { describe, expect, it } from 'vitest';
import { GAIA, GRASS_ONLY, type Heightfield, type MapLayout, type Unit } from '../core/types';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld, SAVE_VERSION } from './serialize';
import { applyDamage } from './systems/combat';
import { damageTo } from './systems/stats';
import { nodeApproach } from './systems/sites';
import { WILDLIFE_LEASH } from './systems/wildlife';
import { World } from './World';

const DT = 1 / BALANCE.tickRate;
const distance = (a: Unit, b: Unit) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
function field(water: (x: number, z: number) => boolean = () => false): Heightfield {
  return {
    width: 64, depth: 64, heightAt: (x, z) => water(x, z) ? -1 : 1,
    isWater: water, isWalkable: (x, z) => x >= 0 && z >= 0 && x < 64 && z < 64 && !water(x, z),
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}
function setup(nodes: MapLayout['nodes'] = [], hf = field(), twoPlayers = false): World {
  return new World(hf, {
    townCenter: { x: 10, z: 10 }, villagers: [{ x: 15, z: 15 }], scouts: [], nodes, props: [],
    extraStarts: twoPlayers ? [{ townCenter: { x: 52, z: 52 }, villagers: [{ x: 48, z: 48 }], scouts: [] }] : [],
  });
}
function run(world: World, seconds: number, check?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) { world.tick(DT); check?.(); }
}
const villager = (world: World) => [...world.units.values()].find((u) => u.kind === 'villager' && u.owner === 1)!;

describe('wildlife and fishing', () => {
  it('keeps an undisturbed deer inside its persisted leash', () => {
    const world = setup();
    const deer = world.spawnUnit('deer', { x: 40, z: 40 });
    expect(deer.owner).toBe(GAIA);
    const home = { ...deer.pos };
    run(world, 120, () => expect(Math.hypot(deer.pos.x - home.x, deer.pos.z - home.z)).toBeLessThanOrEqual(WILDLIFE_LEASH));
    expect(deer.pos).not.toEqual(home);
    expect(deer.leashAnchor).toEqual(home);
  });

  it('flees a nearby villager and never fights, even after being hit', () => {
    const world = setup();
    const worker = villager(world);
    const deer = world.spawnUnit('deer', { x: 19, z: 15 });
    const before = distance(deer, worker);
    applyDamage(world, deer, 1, worker.id, worker.owner, worker.pos);
    run(world, 2, () => { expect(deer.target).toBeNull(); expect(deer.state).not.toBe('attacking'); });
    expect(distance(deer, worker)).toBeGreaterThan(before + 3);
    expect(worker.hp).toBe(worker.maxHp);
  });

  it('makes a boar in range attack through the normal damage path', () => {
    const world = setup();
    const worker = villager(world);
    const boar = world.spawnUnit('boar', { x: 16, z: 15 });
    const expected = worker.hp - damageTo('boar', worker);
    world.tick(DT);
    expect(boar.state).toBe('attacking');
    expect(boar.target).toBe(worker.id);
    expect(worker.hp).toBe(expected);
  });

  it('makes a boar flee outside 3 and retaliate when attacked outside that range', () => {
    const world = setup();
    const worker = villager(world);
    const boar = world.spawnUnit('boar', { x: 20, z: 15 });
    run(world, 0.5);
    expect(distance(boar, worker)).toBeGreaterThan(5);
    expect(boar.target).toBeNull();
    applyDamage(world, boar, 1, worker.id, worker.owner, worker.pos);
    expect(boar.state).toBe('attacking');
    expect(boar.target).toBe(worker.id);
    run(world, 5);
    expect(worker.hp).toBeLessThan(worker.maxHp);
  });

  it('converts a sheep in player 1 sight, but leaves a sheep in the dark neutral', () => {
    const world = setup();
    const seen = world.spawnUnit('sheep', { x: 18, z: 15 });
    const dark = world.spawnUnit('sheep', { x: 40, z: 40 });
    world.updateFog();
    world.tick(DT);
    expect(seen.owner).toBe(1);
    expect(dark.owner).toBe(GAIA);
    expect(world.pop).toBe(1);
  });

  it('gives player 2 a sheep only player 2 currently sees', () => {
    const world = setup([], field(), true);
    const sheep = world.spawnUnit('sheep', { x: 46, z: 48 });
    // Previously explored by player 1 is insufficient.
    world.visibilityOf(1).update([{ pos: sheep.pos, sight: 3 }]);
    world.visibilityOf(1).update([]);
    world.tick(DT);
    expect(sheep.owner).toBe(2);
    run(world, 1);
    expect(sheep.owner).toBe(2);
  });

  it('does not let a herdable alone keep a conquered player alive', () => {
    const world = setup([], field(), true);
    const sheep = world.spawnUnit('sheep', { x: 18, z: 15 });
    world.tick(DT);
    expect(sheep.owner).toBe(1);
    world.units.delete(villager(world).id);
    world.buildings.delete(world.townCenter.id);
    world.victoryClock = 0;
    world.tick(DT);
    expect(world.isDefeated(1)).toBe(true);
  });

  it('killing a deer leaves food at its death position that a villager gathers and deposits', () => {
    const world = setup();
    const worker = villager(world);
    const deer = world.spawnUnit('deer', { x: 16, z: 15 });
    const stock = world.stock.food;
    // Lethal blow through applyDamage, the same path combat uses.
    deer.hp = damageTo('villager', deer);
    world.dispatch({ type: 'attack', unitIds: [worker.id], targetId: deer.id });
    world.tick(DT);
    const death = { ...deer.pos };
    expect(world.units.has(deer.id)).toBe(false);
    const carcass = [...world.nodes.values()].find((n) => n.kind === 'carcass')!;
    expect(carcass.pos).toEqual(death);
    expect(carcass.type).toBe('food');
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: carcass.id });
    run(world, 40);
    expect(carcass.amount).toBeLessThan(140);
    expect(world.stock.food).toBeGreaterThan(stock);
  });

  it('gathers fish from the nearest walkable shore and deposits food', () => {
    const hf = field((x, z) => x >= 23 && x < 35 && z >= 9 && z < 25);
    const world = setup([{ kind: 'fish', pos: { x: 26, z: 15 }, amount: 40 }], hf);
    const worker = villager(world);
    const fish = [...world.nodes.values()][0];
    const shore = nodeApproach(world, worker.pos, fish)!;
    expect(shore.x).toBe(22.75);
    expect(hf.isWalkable(shore.x, shore.z)).toBe(true);
    const stock = world.stock.food;
    let gathered = false;
    world.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: fish.id });
    run(world, 70, () => {
      expect(hf.isWalkable(worker.pos.x, worker.pos.z)).toBe(true);
      if (worker.state === 'gathering') {
        gathered = true;
        expect(Math.hypot(worker.pos.x - shore.x, worker.pos.z - shore.z)).toBeLessThan(0.7);
      }
    });
    expect(gathered).toBe(true);
    expect(world.stock.food).toBeGreaterThan(stock);
    expect(fish.amount).toBeLessThan(40);
  });

  it('round-trips wildlife anchors and new food nodes without changing save version', () => {
    const { hf, layout } = generateMap(1);
    const world = new World(hf, layout);
    world.seed = 1;
    const deer = [...world.units.values()].find((u) => u.kind === 'deer')!;
    const home = { ...deer.leashAnchor! };
    deer.pos.x += 1;
    const dead = world.spawnUnit('boar', { x: 50, z: 50 });
    applyDamage(world, dead, dead.hp, null, 1, { x: 51, z: 50 });
    const data = serializeWorld(world);
    const restored = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(SAVE_VERSION).toBe(1);
    expect(restored.units.get(deer.id)!.leashAnchor).toEqual(home);
    expect([...restored.nodes.values()]).toEqual([...world.nodes.values()]);
    expect(serializeWorld(restored)).toEqual(data);
  });
});
