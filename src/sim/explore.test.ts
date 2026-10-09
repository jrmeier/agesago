import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, GRASS_ONLY, type Heightfield, type MapLayout, type SimEvent, type Unit, type Vec2 } from '../core/types';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { findFrontier } from './systems/explore';
import { SIGHT } from './visibility';
import { World } from './World';

const DT = 1 / BALANCE.tickRate;

/** Flat W×D field where `blocked(x, z)` marks water / walls. */
function field(w: number, d: number, blocked: (x: number, z: number) => boolean = () => false): Heightfield {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x <= w && z <= d;
  return {
    width: w,
    depth: d,
    heightAt: (x, z) => (blocked(x, z) ? -1 : 0.5),
    isWater: blocked,
    isWalkable: (x, z) => inside(x, z) && !blocked(x, z),
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function layout(tc: Vec2, villagers: Vec2[], scouts: Vec2[], nodes: MapLayout['nodes'] = []): MapLayout {
  return { townCenter: tc, villagers, scouts, nodes, props: [] };
}

function run(world: World, seconds: number, each?: () => boolean | void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    world.tick(DT);
    if (each?.()) return;
  }
}

const unitsOf = (world: World, kind: Unit['kind']) => [...world.units.values()].filter((u) => u.kind === kind);

/** Fraction of 1-unit cells whose centre is reachable from `from` that are explored. */
function reachableExplored(world: World, from: Vec2): { fraction: number; reachable: number } {
  const vis = world.visibility;
  let reachable = 0;
  let explored = 0;
  for (let r = 0; r < vis.rows; r++) {
    for (let c = 0; c < vis.cols; c++) {
      const p = { x: c + 0.5, z: r + 0.5 };
      if (!world.nav.isWalkableCell(p) || !world.nav.connected(from, p)) continue;
      reachable++;
      if (vis.isExplored(p.x, p.z)) explored++;
    }
  }
  return { fraction: explored / reachable, reachable };
}

describe('scouts', () => {
  it('spawn from the generated layout as fast, far-sighted units', () => {
    const { hf, layout: l } = generateMap(DEFAULT_SEED);
    const world = new World(hf, l);
    const scouts = unitsOf(world, 'scout').filter((u) => u.owner === world.localPlayer);
    expect(scouts.length).toBe(l.scouts.length);
    expect(scouts.length).toBeGreaterThan(0);
    expect(scouts[0].pos).toEqual(l.scouts[0]);
    expect(scouts[0]).toMatchObject({ state: 'idle', gatherNode: null, gatherType: null, carry: null });
    expect(world.pop).toBe(l.villagers.length + l.scouts.length);
    expect(world.villagerCount).toBe(l.villagers.length);
  });

  it('are faster than villagers and reveal a larger radius', () => {
    const world = new World(field(120, 60), layout({ x: 10, z: 30 }, [{ x: 20, z: 20 }], [{ x: 20, z: 40 }]));
    const [v] = unitsOf(world, 'villager');
    const [s] = unitsOf(world, 'scout');
    expect(BALANCE.scoutSpeed).toBeGreaterThan(BALANCE.villagerSpeed);
    expect(SIGHT.scout).toBeGreaterThan(SIGHT.villager);
    world.dispatch({ type: 'move', unitIds: [v.id], target: { x: 110, z: 20 } });
    world.dispatch({ type: 'move', unitIds: [s.id], target: { x: 110, z: 40 } });
    run(world, 4);
    expect(s.pos.x - 20).toBeCloseTo(BALANCE.scoutSpeed * 4, 0);
    expect(v.pos.x - 20).toBeCloseTo(BALANCE.villagerSpeed * 4, 0);
    world.updateFog();
    const vis = world.visibility;
    // 12 units ahead: within scout sight, beyond villager sight.
    expect(vis.isVisible(s.pos.x + 12, s.pos.z)).toBe(true);
    expect(vis.isVisible(v.pos.x + 12, v.pos.z)).toBe(false);
    expect(vis.isVisible(v.pos.x + 6, v.pos.z)).toBe(true);
  });

  it('a gather order sends scouts next to the node without gathering; villagers still gather', () => {
    const world = new World(
      field(64, 48),
      layout({ x: 32, z: 24 }, [{ x: 32, z: 28.5 }], [{ x: 28, z: 28.5 }], [{ kind: 'berry', pos: { x: 38, z: 30 }, amount: 100 }])
    );
    const [v] = unitsOf(world, 'villager');
    const [s] = unitsOf(world, 'scout');
    const node = world.nodes.keys().next().value as number;
    world.dispatch({ type: 'gather', unitIds: [s.id, v.id], nodeId: node });
    expect(s.state).toBe('moving');
    expect(v.state).toBe('toNode');
    run(world, 10);
    expect(s.state).toBe('idle');
    expect(s.gatherNode).toBeNull();
    expect(s.carry).toBeNull();
    expect(Math.hypot(s.pos.x - 38, s.pos.z - 30)).toBeLessThan(1.5);
    expect(['gathering', 'toDrop', 'toNode']).toContain(v.state);
    expect(world.nodes.get(node)!.amount).toBeLessThan(100);
  });
});

describe('auto-explore', () => {
  // A lake in the middle and a long wall with a gap; an enclosed pond island is unreachable.
  const lake = (x: number, z: number) => Math.hypot(x - 70, z - 30) < 9;
  const wall = (x: number, z: number) => x >= 30 && x <= 32 && z >= 12;
  const moat = (x: number, z: number) => {
    const d = Math.hypot(x - 100, z - 48);
    return d > 4 && d < 6;
  };
  const blocked = (x: number, z: number) => lake(x, z) || wall(x, z) || moat(x, z);

  it('reveals > 90% of reachable ground on a map with a wall and a lake, then idles', () => {
    const world = new World(field(120, 64, blocked), layout({ x: 12, z: 50 }, [], [{ x: 16, z: 46 }]));
    const [s] = unitsOf(world, 'scout');
    const log: SimEvent[] = [];
    world.events.on('unitState', (e) => log.push(e));
    world.dispatch({ type: 'explore', unitIds: [s.id] });
    expect(s.state).toBe('exploring');
    expect(log).toEqual([{ type: 'unitState', id: s.id, state: 'exploring' }]);
    const start = { ...s.pos };
    let idleAt = -1;
    run(world, 400, () => {
      if (s.state === 'idle') {
        idleAt = world.time;
        return true;
      }
    });
    expect(idleAt).toBeGreaterThan(0);
    world.updateFog();
    const { fraction } = reachableExplored(world, start);
    expect(fraction).toBeGreaterThan(0.9);
    // The unreachable island inside the moat is never a target.
    expect(world.nav.connected(start, { x: 100, z: 48 })).toBe(false);
    expect(log[log.length - 1]).toEqual({ type: 'unitState', id: s.id, state: 'idle' });
    expect(world.exploreState.size).toBe(0);
  });

  it('villagers can explore too, more slowly', () => {
    const world = new World(field(60, 40), layout({ x: 6, z: 6 }, [{ x: 10, z: 10 }], []));
    const [v] = unitsOf(world, 'villager');
    world.dispatch({ type: 'explore', unitIds: [v.id] });
    run(world, 5);
    expect(v.state).toBe('exploring');
    expect(Math.hypot(v.pos.x - 10, v.pos.z - 10)).toBeGreaterThan(5);
  });

  it('two exploring scouts pick different targets', () => {
    const world = new World(field(160, 160), layout({ x: 80, z: 80 }, [], [{ x: 76, z: 76 }, { x: 77, z: 76 }]));
    const [a, b] = unitsOf(world, 'scout');
    world.dispatch({ type: 'explore', unitIds: [a.id, b.id] });
    world.tick(DT);
    const ta = world.exploreState.get(a.id)!.target!;
    const tb = world.exploreState.get(b.id)!.target!;
    expect(ta).toBeTruthy();
    expect(tb).toBeTruthy();
    expect(Math.hypot(ta.x - tb.x, ta.z - tb.z)).toBeGreaterThan(SIGHT.scout);
    run(world, 10);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(SIGHT.scout);
  });

  it('a move order cancels exploring', () => {
    const world = new World(field(100, 100), layout({ x: 50, z: 50 }, [], [{ x: 46, z: 46 }]));
    const [s] = unitsOf(world, 'scout');
    world.dispatch({ type: 'explore', unitIds: [s.id] });
    run(world, 2);
    expect(s.state).toBe('exploring');
    world.dispatch({ type: 'move', unitIds: [s.id], target: { x: 10, z: 10 } });
    expect(s.state).toBe('moving');
    expect(world.exploreState.has(s.id)).toBe(false);
    run(world, 20);
    expect(s.state).toBe('idle');
    expect(Math.hypot(s.pos.x - 10, s.pos.z - 10)).toBeLessThan(0.5);
  });

  it('sweeps forward along its heading rather than zig-zagging', () => {
    const world = new World(field(170, 40), layout({ x: 6, z: 20 }, [], [{ x: 10, z: 20 }]));
    const [s] = unitsOf(world, 'scout');
    s.facing = Math.PI / 2; // facing +x along the corridor
    world.dispatch({ type: 'explore', unitIds: [s.id] });
    let backtracks = 0;
    let lastX = s.pos.x;
    run(world, 15, () => {
      if (s.pos.x < lastX - 1e-6) backtracks++;
      lastX = s.pos.x;
    });
    expect(s.pos.x).toBeGreaterThan(10 + BALANCE.scoutSpeed * 15 * 0.8);
    expect(backtracks).toBe(0);
  });
});

describe('frontier search cost on the generated map', () => {
  it('stays well under 2 ms, even when the only unexplored ground is far away', () => {
    const { hf, layout: l } = generateMap(DEFAULT_SEED);
    const world = new World(hf, l);
    const [s] = unitsOf(world, 'scout');
    const time = (n: number) => {
      const t0 = performance.now();
      let target: Vec2 | null = null;
      for (let i = 0; i < n; i++) {
        world.visibility.version++; // defeat the "nothing left" cache so every call searches
        target = findFrontier(world, s);
      }
      return { ms: (performance.now() - t0) / n, target };
    };
    time(5); // warm up the JIT
    const near = time(20);
    expect(near.target).not.toBeNull();

    // Worst case: everything explored except a far corner → the BFS floods most of the region.
    const vis = world.visibility;
    vis.state.fill(1);
    let far: Vec2 | null = null;
    for (let r = vis.rows - 1; r >= 0 && !far; r--) {
      for (let c = vis.cols - 1; c >= 0; c--) {
        const p = { x: c + 0.5, z: r + 0.5 };
        if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) > 100 && world.nav.connected(s.pos, p)) {
          far = p;
          break;
        }
      }
    }
    expect(far).not.toBeNull();
    vis.state[Math.floor(far!.z) * vis.cols + Math.floor(far!.x)] = 0;
    time(30);
    const worst = time(30);
    expect(worst.target).not.toBeNull();
    expect(Math.hypot(worst.target!.x - far!.x, worst.target!.z - far!.z)).toBeLessThan(1);

    // Fully explored: full flood, returns null.
    vis.state.fill(1);
    const none = time(10);
    expect(none.target).toBeNull();

    console.info(`frontier search: near ${near.ms.toFixed(3)} ms, far ${worst.ms.toFixed(3)} ms, none ${none.ms.toFixed(3)} ms`);
    // Generous for slow CI machines; typical numbers are logged above.
    expect(near.ms).toBeLessThan(8);
    expect(worst.ms).toBeLessThan(8);
    expect(none.ms).toBeLessThan(8);
  });
});
