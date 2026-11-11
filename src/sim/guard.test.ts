import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Command, type Heightfield, type MapLayout, type PlayerId, type SimEvent, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { validCommand } from '../network/protocol';
import { BALANCE } from './balance';
import { completeBuilding, layFoundation } from './systems/build';
import { applyDamage } from './systems/combat';
import { deserializeWorld, serializeWorld } from './serialize';
import { edgeDistance } from './systems/stats';
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

/** Three players (1 and 3 allied), Town Centers tucked in corners, no starting units. */
function arena(): World {
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 },
    villagers: [],
    scouts: [],
    extraStarts: [
      { townCenter: { x: 116, z: 116 }, villagers: [], scouts: [] },
      { townCenter: { x: 4, z: 116 }, villagers: [], scouts: [] },
    ],
    nodes: [],
    props: [],
  };
  const players = defaultPlayers(3);
  players[2].team = players[0].team;
  return new World(flat(), layout, players);
}

const spawn = (world: World, kind: UnitKind, owner: PlayerId, p: Vec2): Unit => world.spawnUnit(kind, p, owner);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const guarding = (world: World, u: Unit) => (world.combatState.get(u.id)?.order === 'guard' ? world.combatState.get(u.id)?.guard : undefined);

function run(world: World, seconds: number, until?: () => boolean): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.tick(DT);
    if (until?.()) return (i + 1) * DT;
  }
  return seconds;
}

describe('guard order', () => {
  it('follows a walking unit at about guardDistance and stops beside it', () => {
    const world = arena();
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 30, z: 40 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    expect(guarding(world, g)).toBe(v.id);
    world.dispatch({ type: 'move', unitIds: [v.id], target: { x: 70, z: 60 } });
    let far = 0;
    run(world, 30, () => {
      far = Math.max(far, dist(g.pos, v.pos));
      return v.state === 'idle';
    });
    run(world, 5);
    expect(dist(v.pos, { x: 70, z: 60 })).toBeLessThan(1.5);
    expect(dist(g.pos, v.pos)).toBeLessThanOrEqual(BALANCE.guardDistance + BALANCE.guardSlack + 0.5);
    expect(g.state).toBe('idle');
    expect(guarding(world, g)).toBe(v.id);
  });

  it('can guard an allied unit and stays by a guarded building', () => {
    const world = arena();
    const ally = spawn(world, 'villager', 3, { x: 60, z: 30 });
    const g = spawn(world, 'hoplite', 1, { x: 40, z: 30 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: ally.id });
    run(world, 10);
    expect(dist(g.pos, ally.pos)).toBeLessThanOrEqual(BALANCE.guardDistance + BALANCE.guardSlack + 0.5);

    const house = layFoundation(world, 'house', { x: 30, z: 70 }, 0, 1);
    completeBuilding(world, house);
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: house.id });
    run(world, 40, () => g.state === 'idle');
    expect(guarding(world, g)).toBe(house.id);
    expect(edgeDistance(g, house)).toBeLessThanOrEqual(BALANCE.guardDistance + BALANCE.guardSlack + 0.5);
  });

  it('rejects enemy, Gaia and missing targets', () => {
    const world = arena();
    const log: SimEvent[] = [];
    world.events.on('rejected', (e) => log.push(e));
    const g = spawn(world, 'hoplite', 1, { x: 30, z: 30 });
    const enemy = spawn(world, 'villager', 2, { x: 35, z: 30 });
    const deer = spawn(world, 'deer', 0, { x: 30, z: 35 });
    for (const targetId of [enemy.id, deer.id, 9999]) world.dispatch({ type: 'guard', unitIds: [g.id], targetId });
    expect(log).toHaveLength(3);
    expect(guarding(world, g)).toBeUndefined();
  });

  it('engages whatever damages the guarded unit, then returns to it', () => {
    const world = arena();
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 38, z: 40 });
    // Defensive: the guard would not pick this fight on its own.
    world.dispatch({ type: 'stance', unitIds: [g.id], stance: 'defensive' });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    const raider = spawn(world, 'villager', 2, { x: 40, z: 46 });
    run(world, 1);
    expect(g.state).toBe('idle');
    world.dispatch({ type: 'stance', unitIds: [raider.id], stance: 'passive' }, 2);
    applyDamage(world, v, 1, raider.id, 2, raider.pos);
    expect(g.state).toBe('attacking');
    expect(g.target).toBe(raider.id);
    run(world, 40, () => !world.units.has(raider.id));
    expect(world.units.has(raider.id)).toBe(false);
    run(world, 15);
    expect(guarding(world, g)).toBe(v.id);
    expect(dist(g.pos, v.pos)).toBeLessThanOrEqual(BALANCE.guardDistance + BALANCE.guardSlack + 0.5);
  });

  it('ignores attackers beyond the leash', () => {
    const world = arena();
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 38, z: 40 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    const far = spawn(world, 'archer', 2, { x: 38, z: 40 + BALANCE.leash + 5 });
    applyDamage(world, v, 1, far.id, 2, far.pos);
    expect(g.target).toBeNull();
    expect(g.state).not.toBe('attacking');
  });

  it('defends a guarded building from real attackers', () => {
    const world = arena();
    const house = layFoundation(world, 'house', { x: 40, z: 40 }, 0, 1);
    completeBuilding(world, house);
    const g = spawn(world, 'swordsman', 1, { x: 40, z: 45 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: house.id });
    run(world, 3);
    const raider = spawn(world, 'hoplite', 2, { x: 40, z: 30 });
    world.dispatch({ type: 'attack', unitIds: [raider.id], targetId: house.id }, 2);
    run(world, 60, () => !world.units.has(raider.id));
    expect(world.units.has(raider.id)).toBe(false);
    expect(world.buildings.has(house.id)).toBe(true);
    expect(guarding(world, g)).toBe(house.id);
  });

  it('is released when the guarded unit dies: guards go idle where they are', () => {
    const world = arena();
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 30, z: 40 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    world.dispatch({ type: 'move', unitIds: [v.id], target: { x: 80, z: 40 } });
    run(world, 2);
    expect(g.state).toBe('moving');
    applyDamage(world, v, v.hp, null, 2, v.pos);
    run(world, DT);
    expect(guarding(world, g)).toBeUndefined();
    expect(g.state).toBe('idle');
    const at = { ...g.pos };
    run(world, 5);
    expect(dist(g.pos, at)).toBeLessThan(0.5);
  });

  it('is released by any new order, but not by a stance change', () => {
    const world = arena();
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 38, z: 40 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    world.dispatch({ type: 'stance', unitIds: [g.id], stance: 'defensive' });
    expect(guarding(world, g)).toBe(v.id);
    world.dispatch({ type: 'move', unitIds: [g.id], target: { x: 20, z: 20 } });
    expect(guarding(world, g)).toBeUndefined();
    run(world, 10);
    world.dispatch({ type: 'move', unitIds: [v.id], target: { x: 80, z: 80 } });
    run(world, 10);
    expect(dist(g.pos, { x: 20, z: 20 })).toBeLessThan(2);

    const orders: Command[] = [{ type: 'stop', unitIds: [g.id] }, { type: 'attackMove', unitIds: [g.id], target: { x: 30, z: 30 } }];
    for (const cmd of orders) {
      world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
      expect(guarding(world, g)).toBe(v.id);
      world.dispatch(cmd);
      expect(guarding(world, g)).toBeUndefined();
    }
  });

  it('survives save and load and keeps guarding', () => {
    const world = arena();
    world.seed = 7;
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 30, z: 40 });
    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    run(world, 1);
    const data = serializeWorld(world);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(data)), flat());
    expect(loaded.combatState.get(g.id)).toMatchObject({ order: 'guard', guard: v.id });
    expect(serializeWorld(loaded)).toEqual(data);
    loaded.dispatch({ type: 'move', unitIds: [v.id], target: { x: 70, z: 70 } });
    run(loaded, 30);
    expect(dist(loaded.units.get(g.id)!.pos, loaded.units.get(v.id)!.pos)).toBeLessThanOrEqual(BALANCE.guardDistance + BALANCE.guardSlack + 0.5);
  });

  it('loads pre-guard saves (v2-v11) and rejects a malformed guard', () => {
    const world = arena();
    world.seed = 7;
    const v = spawn(world, 'villager', 1, { x: 40, z: 40 });
    const g = spawn(world, 'hoplite', 1, { x: 38, z: 40 });
    world.dispatch({ type: 'attack', unitIds: [g.id], targetId: spawn(world, 'villager', 2, { x: 50, z: 40 }).id });
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const old = JSON.parse(JSON.stringify(serializeWorld(world)));
      old.version = version;
      expect(deserializeWorld(old, flat()).combatState.get(g.id)?.order).toBe('attack');
    }

    world.dispatch({ type: 'guard', unitIds: [g.id], targetId: v.id });
    // A guard in a pre-guard (v11) save can't be real: it loads as no order.
    const stray = JSON.parse(JSON.stringify(serializeWorld(world)));
    stray.version = 11;
    expect(deserializeWorld(stray, flat()).combatState.get(g.id)?.order ?? null).toBeNull();
    const bad = JSON.parse(JSON.stringify(serializeWorld(world)));
    for (const [id, cs] of bad.systems.combat) if (id === g.id) delete cs.guard;
    expect(() => deserializeWorld(bad, flat())).toThrow('Invalid save: guard order');
  }, 30_000);

  it('is a valid network command', () => {
    expect(validCommand({ type: 'guard', unitIds: [1, 2], targetId: 3 })).toBe(true);
    expect(validCommand({ type: 'guard', unitIds: [1] })).toBe(false);
  });
});
