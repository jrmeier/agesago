import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout, type PlayerId, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { validCommand } from '../network/protocol';
import { BALANCE } from './balance';
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

/** Two players, Town Centers tucked in far corners, no starting units. */
function arena(): World {
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 },
    villagers: [],
    scouts: [],
    extraStarts: [{ townCenter: { x: 116, z: 116 }, villagers: [], scouts: [] }],
    nodes: [],
    props: [],
  };
  return new World(flat(), layout, defaultPlayers(2));
}

const spawn = (world: World, kind: UnitKind, owner: PlayerId, p: Vec2): Unit => world.spawnUnit(kind, p, owner);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Tick `seconds`, recording each time `u` comes within 2.5 of a point (consecutive repeats collapsed). */
function visits(world: World, u: Unit, points: Vec2[], seconds: number): number[] {
  const seen: number[] = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    world.tick(DT);
    const k = points.findIndex((p) => dist(u.pos, p) < 2.5);
    if (k >= 0 && seen[seen.length - 1] !== k) seen.push(k);
  }
  return seen;
}

describe('patrol', () => {
  it('walks back and forth to a single waypoint until told otherwise', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 30, z: 60 });
    const start = { ...h.pos };
    const far = { x: 50, z: 60 };
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: [far] });
    expect(h.state).toBe('moving');
    expect(h.patrol?.route.length).toBe(2);
    const seen = visits(world, h, [start, far], 40);
    expect(seen.slice(0, 5)).toEqual([0, 1, 0, 1, 0]);
    expect(h.patrol).toBeDefined();
    expect(world.combatState.get(h.id)?.order).toBe('attackMove');
  });

  it('loops through several waypoints and back to the start', () => {
    const world = arena();
    const h = spawn(world, 'swordsman', 1, { x: 30, z: 40 });
    const pts = [{ ...h.pos }, { x: 45, z: 40 }, { x: 45, z: 55 }, { x: 30, z: 55 }];
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: pts.slice(1) });
    expect(h.patrol?.route.length).toBe(4);
    const seen = visits(world, h, pts, 60);
    expect(seen.slice(0, 6)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('any other order ends the patrol; a stance change does not', () => {
    const world = arena();
    const [a, b] = [spawn(world, 'hoplite', 1, { x: 30, z: 60 }), spawn(world, 'hoplite', 1, { x: 30, z: 64 })];
    const order = () => world.dispatch({ type: 'patrol', unitIds: [a.id, b.id], waypoints: [{ x: 60, z: 60 }] });
    order();
    world.dispatch({ type: 'stance', unitIds: [a.id], stance: 'defensive' });
    expect(a.patrol).toBeDefined();
    world.dispatch({ type: 'move', unitIds: [a.id], target: { x: 20, z: 20 } });
    expect(a.patrol).toBeUndefined();
    expect(b.patrol).toBeDefined();
    world.dispatch({ type: 'stop', unitIds: [b.id] });
    expect(b.patrol).toBeUndefined();
    expect(world.combatState.get(b.id)?.order ?? null).toBeNull();
    order();
    world.dispatch({ type: 'attackMove', unitIds: [a.id], target: { x: 50, z: 50 } });
    expect(a.patrol).toBeUndefined();
    expect(world.combatState.get(a.id)?.dest).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    // The attack-move finishes and stays finished instead of looping.
    for (let i = 0; i < 30 / DT; i++) world.tick(DT);
    expect(a.state).toBe('idle');
    expect(world.combatState.get(a.id)?.order ?? null).toBeNull();
  });

  it('fights enemies met on the route, then goes back to patrolling', () => {
    const world = arena();
    const h = spawn(world, 'swordsman', 1, { x: 20, z: 60 });
    const far = { x: 60, z: 60 };
    const e = spawn(world, 'villager', 2, { x: 40, z: 62 });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: [far] });
    let fought = false;
    for (let i = 0; i < 30 / DT && world.units.has(e.id); i++) {
      world.tick(DT);
      if (h.state === 'attacking') fought = true;
    }
    expect(fought).toBe(true);
    expect(world.units.has(e.id)).toBe(false);
    world.tick(DT); // the fight ends on the next combat pass
    expect(h.patrol).toBeDefined();
    expect(h.state).toBe('moving');
    expect(world.combatState.get(h.id)?.order).toBe('attackMove');
    const seen = visits(world, h, [{ x: 20, z: 60 }, far], 40);
    expect(seen).toContain(1);
    expect(seen).toContain(0);
  });

  it('passive patrollers walk past enemies', () => {
    const world = arena();
    const h = spawn(world, 'swordsman', 1, { x: 20, z: 60 });
    const e = spawn(world, 'villager', 2, { x: 40, z: 62 });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'stance', unitIds: [h.id], stance: 'passive' });
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: [{ x: 60, z: 60 }] });
    for (let i = 0; i < 15 / DT; i++) {
      world.tick(DT);
      expect(h.state).not.toBe('attacking');
    }
    expect(e.hp).toBe(e.maxHp);
  });

  it('ignores villagers and empty orders; clamps off-map points', () => {
    const world = arena();
    const v = spawn(world, 'villager', 1, { x: 30, z: 60 });
    world.dispatch({ type: 'patrol', unitIds: [v.id], waypoints: [{ x: 50, z: 60 }] });
    expect(v.patrol).toBeUndefined();
    const h = spawn(world, 'hoplite', 1, { x: 30, z: 70 });
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: [] });
    expect(h.patrol).toBeUndefined();
    // Off-map points are clamped to the map edge.
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: [{ x: 500, z: -500 }] });
    expect(h.patrol?.route[1]).toEqual({ x: 120, z: 0 });
  });

  it('an enemy cannot patrol your units', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 30, z: 60 });
    world.dispatch({ type: 'patrol', unitIds: [h.id], waypoints: [{ x: 50, z: 60 }] }, 2);
    expect(h.patrol).toBeUndefined();
  });

  it('the network protocol accepts well-formed patrol commands only', () => {
    expect(validCommand({ type: 'patrol', unitIds: [1, 2], waypoints: [{ x: 1, z: 2 }, { x: 3, z: 4 }] })).toBe(true);
    expect(validCommand({ type: 'patrol', unitIds: [1], waypoints: [] })).toBe(false);
    expect(validCommand({ type: 'patrol', unitIds: [1], waypoints: [{ x: 'a', z: 2 }] })).toBe(false);
    expect(validCommand({ type: 'patrol', unitIds: [1] })).toBe(false);
    expect(validCommand({ type: 'patrol', unitIds: [1], waypoints: Array.from({ length: 17 }, () => ({ x: 1, z: 1 })) })).toBe(false);
  });
});
