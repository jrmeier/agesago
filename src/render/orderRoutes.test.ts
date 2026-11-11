import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield } from '../core/types';
import { defaultPlayers, World } from '../sim/World';
import { MAX_ROUTE_UNITS, orderRoutes, subdivide } from './orderRoutes';

function world(): World {
  const hf: Heightfield = {
    width: 120, depth: 120, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 120 && z <= 120, forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  return new World(hf, {
    townCenter: { x: 6, z: 6 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 114, z: 114 }, villagers: [], scouts: [] }],
  }, defaultPlayers(2));
}

describe('order routes', () => {
  it('draws a walking unit\'s path, a patrol loop from where it stands, and a guard link', () => {
    const w = world();
    const walker = w.spawnUnit('swordsman', { x: 30, z: 30 });
    const patroller = w.spawnUnit('swordsman', { x: 40, z: 30 });
    const guard = w.spawnUnit('swordsman', { x: 50, z: 30 });
    const ward = w.spawnUnit('villager', { x: 56, z: 34 });
    const idle = w.spawnUnit('swordsman', { x: 60, z: 30 });
    w.dispatch({ type: 'move', unitIds: [walker.id], target: { x: 30, z: 60 } });
    w.dispatch({ type: 'patrol', unitIds: [patroller.id], waypoints: [{ x: 40, z: 50 }, { x: 60, z: 50 }] });
    w.dispatch({ type: 'guard', unitIds: [guard.id], targetId: ward.id });
    const routes = orderRoutes(w, [walker.id, patroller.id, guard.id, idle.id]);
    expect(routes.map((r) => r.kind)).toEqual(['move', 'patrol', 'guard']);

    const move = routes[0].points;
    expect(move[0]).toEqual({ x: 30, z: 30 });
    expect(move.at(-1)!.z).toBeCloseTo(60, 0);

    // Patrol: unit → next point → … → back round to the next point again (a closed loop).
    const loop = routes[1].points;
    expect(loop[0]).toEqual({ x: 40, z: 30 });
    expect(loop.length).toBe(1 + patroller.patrol!.route.length + 1);
    expect(loop[1]).toEqual(loop.at(-1));

    expect(routes[2].points).toEqual([{ x: 50, z: 30 }, { x: 56, z: 34 }]);
  });

  it('skips enemy and garrisoned units and caps how many lines a big selection draws', () => {
    const w = world();
    const enemy = w.spawnUnit('swordsman', { x: 80, z: 80 }, 2);
    w.dispatch({ type: 'move', unitIds: [enemy.id], target: { x: 80, z: 100 } }, 2);
    expect(orderRoutes(w, [enemy.id])).toEqual([]);
    const army = Array.from({ length: 40 }, (_, i) => w.spawnUnit('swordsman', { x: 20 + (i % 10) * 2, z: 20 + Math.floor(i / 10) * 2 }));
    w.dispatch({ type: 'move', unitIds: army.map((u) => u.id), target: { x: 80, z: 40 } });
    expect(orderRoutes(w, army.map((u) => u.id)).length).toBe(MAX_ROUTE_UNITS);
  });

  it('subdivides long legs so the line can follow the ground', () => {
    const pts = subdivide([{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 1 }], 1.5);
    expect(pts.length).toBe(1 + 4 + 1);
    expect(pts[2]).toEqual({ x: 3, z: 0 });
    expect(pts.at(-1)).toEqual({ x: 6, z: 1 });
  });
});
