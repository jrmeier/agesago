import { describe, expect, it } from 'vitest';
import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import {
  DEFAULT_SEED,
  GRASS_ONLY,
  type Building,
  type Heightfield,
  type MapLayout,
  type SimEvent,
  type Unit,
  type Vec2,
} from '../core/types';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { NavGrid } from './nav';
import { EXPLORED } from './visibility';
import { World } from './World';

const DT = 1 / BALANCE.tickRate;

/** Flat 64×48 field; `water` marks lake, `steep` marks dry but unwalkable ground. */
function field(
  water: (x: number, z: number) => boolean = () => false,
  steep: (x: number, z: number) => boolean = () => false
): Heightfield {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x <= 64 && z <= 48;
  return {
    width: 64,
    depth: 48,
    heightAt: (x, z) => (water(x, z) ? -1 : 0.5),
    isWater: water,
    isWalkable: (x, z) => inside(x, z) && !water(x, z) && !steep(x, z),
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function layout(villagers: Vec2[], nodes: MapLayout['nodes'] = [], props: MapLayout['props'] = []): MapLayout {
  return { townCenter: { x: 32, z: 24 }, villagers, scouts: [], nodes, props };
}

/** World on `hf` with the whole map explored and a fat stockpile. */
function world(l: MapLayout, hf = field()): World {
  const w = new World(hf, l);
  w.visibility.state.fill(EXPLORED);
  Object.assign(w.stock, { wood: 1000, food: 1000, gold: 1000, stone: 1000 });
  return w;
}

function record(w: World): SimEvent[] {
  const log: SimEvent[] = [];
  for (const t of ['spawned', 'removed', 'stockpile', 'constructed', 'rejected'] as const) w.events.on(t, (e) => log.push(e));
  return log;
}

function run(w: World, seconds: number, each?: () => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    w.tick(DT);
    each?.();
  }
}

function runUntil(w: World, cond: () => boolean, maxSeconds = 120): number {
  let t = 0;
  while (!cond() && t < maxSeconds) {
    w.tick(DT);
    t += DT;
  }
  return t;
}

const units = (w: World) => [...w.units.values()];
const newest = (w: World): Building => [...w.buildings.values()].pop()!;

describe('canPlace', () => {
  it('accepts open explored ground and snaps nothing away', () => {
    const w = world(layout([]));
    expect(w.canPlace('house', { x: 20, z: 20 }, 0)).toEqual({ ok: true });
    expect(w.canPlace('farm', { x: 20, z: 34 }, 1.3)).toEqual({ ok: true });
  });

  it('rejects footprints leaving the map', () => {
    const w = world(layout([]));
    expect(w.canPlace('house', { x: 1, z: 20 }, 0)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(w.canPlace('farm', { x: 30, z: 47 }, 0)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('rejects any water or steep sample inside the footprint', () => {
    const pond = (x: number, z: number) => Math.hypot(x - 10, z - 10) < 0.4;
    const cliff = (x: number) => x > 50 && x < 50.3;
    const w = world(layout([]), field(pond, cliff));
    // The pond is smaller than the footprint, so only interior sampling finds it.
    expect(w.canPlace('farm', { x: 11, z: 11 }, 0)).toEqual({ ok: false, reason: 'water' });
    expect(w.canPlace('house', { x: 51, z: 20 }, 0)).toEqual({ ok: false, reason: 'slope' });
    expect(w.canPlace('house', { x: 54, z: 20 }, 0)).toEqual({ ok: true });
  });

  it('rejects unexplored ground (before revealing water there)', () => {
    const lake = (x: number) => x > 55;
    const w = new World(field(lake), layout([{ x: 32, z: 29 }]));
    Object.assign(w.stock, { wood: 1000 });
    expect(w.canPlace('house', { x: 32, z: 33 }, 0).ok).toBe(true);
    expect(w.canPlace('house', { x: 5, z: 5 }, 0)).toEqual({ ok: false, reason: 'unexplored' });
    expect(w.canPlace('house', { x: 58, z: 5 }, 0)).toEqual({ ok: false, reason: 'unexplored' });
  });

  it('rejects overlap with buildings, foundations, nodes and blocking props; units do not block', () => {
    const w = world(
      layout(
        [{ x: 20, z: 40 }],
        [{ kind: 'tree', pos: { x: 10, z: 30 }, amount: 100 }],
        [
          { kind: 'boulder', pos: { x: 50, z: 30 }, rot: 0, scale: 1, blockRadius: 1 },
          { kind: 'reeds', pos: { x: 50, z: 40 }, rot: 0, scale: 1, blockRadius: 0 },
        ]
      )
    );
    expect(w.canPlace('house', { x: 33, z: 25 }, 0)).toEqual({ ok: false, reason: 'occupied' }); // TC
    expect(w.canPlace('house', { x: 32, z: 24 + 1.6 + 1.3 }, 0).ok).toBe(true); // flush against the TC
    expect(w.canPlace('house', { x: 11.5, z: 30 }, 0)).toEqual({ ok: false, reason: 'occupied' });
    expect(w.canPlace('house', { x: 51.5, z: 30.5 }, 0)).toEqual({ ok: false, reason: 'occupied' });
    expect(w.canPlace('house', { x: 50, z: 40 }, 0).ok).toBe(true); // walk-through reeds
    expect(w.canPlace('house', { x: 20, z: 40 }, 0).ok).toBe(true); // a villager stands there
    w.dispatch({ type: 'build', unitIds: [], kind: 'house', pos: { x: 20, z: 20 }, rot: 0 });
    expect(w.canPlace('farm', { x: 22, z: 21 }, 0)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('rejects when the stockpile cannot cover the cost', () => {
    const w = world(layout([]));
    w.stock.wood = BUILDINGS.storehouse.cost.wood! - 1;
    expect(w.canPlace('storehouse', { x: 20, z: 20 }, 0)).toEqual({ ok: false, reason: 'insufficient-resources' });
    expect(w.canPlace('house', { x: 20, z: 20 }, 0).ok).toBe(true);
  });

  it('is fast enough to call every frame on the generated map', () => {
    const { hf, layout: l } = generateMap(DEFAULT_SEED);
    const w = new World(hf, l);
    w.visibility.state.fill(EXPLORED);
    w.stock.wood = 1000;
    const tc = w.townCenter!.pos;
    const kinds = ['farm', 'house', 'storehouse'] as const;
    for (let i = 0; i < 200; i++) w.canPlace(kinds[i % 3], { x: tc.x + (i % 20) - 10, z: tc.z + 8 }, 0); // warm up
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) w.canPlace(kinds[i % 3], { x: tc.x - 30 + (i % 60), z: tc.z - 20 + ((i * 7) % 40) }, 0);
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(0.3);
  });
});

describe('build command', () => {
  it('pays, lays a foundation that blocks nav, nudges units off it and emits spawned + stockpile', () => {
    const w = world(layout([{ x: 20, z: 20 }, { x: 10, z: 10 }]));
    const log = record(w);
    const [stander, builder] = units(w);
    w.dispatch({ type: 'build', unitIds: [builder.id], kind: 'house', pos: { x: 20, z: 20 }, rot: 0.2 });
    const b = newest(w);
    expect(b).toMatchObject({ kind: 'house', complete: false, buildProgress: 0, rot: 0 });
    expect(w.stock.wood).toBe(1000 - BUILDINGS.house.cost.wood!);
    expect(log[0]).toEqual({ type: 'spawned', id: b.id, kind: 'house' });
    expect(log[1]).toMatchObject({ type: 'stockpile', stock: { wood: w.stock.wood } });
    expect(w.nav.isFree({ x: 20, z: 20 })).toBe(false);
    expect(w.nav.isWalkableCell({ x: 20.6, z: 19.4 })).toBe(false);
    // The villager standing on the site was pushed to its edge, onto free ground.
    expect(w.nav.isFree(stander.pos)).toBe(true);
    expect(Math.max(Math.abs(stander.pos.x - 20), Math.abs(stander.pos.z - 20))).toBeLessThan(1.3 + 1);
    expect(builder.state).toBe('toBuild');
  });

  it('re-routes a walker whose path now crosses the foundation', () => {
    const w = world(layout([{ x: 10, z: 20 }]));
    const [u] = units(w);
    w.dispatch({ type: 'move', unitIds: [u.id], target: { x: 22, z: 20 } });
    expect(u.path).toEqual([{ x: 22, z: 20 }]);
    w.dispatch({ type: 'build', unitIds: [], kind: 'storehouse', pos: { x: 16, z: 20 }, rot: 0 });
    expect(u.path.length).toBeGreaterThan(1);
    let inside = false;
    run(w, 10, () => {
      if (Math.abs(u.pos.x - 16) < 1.5 && Math.abs(u.pos.z - 20) < 1.5) inside = true;
    });
    expect(inside).toBe(false);
    expect(u.pos).toEqual({ x: 22, z: 20 });
  });

  it('rejects blocked sites and unaffordable buildings without paying', () => {
    const w = world(layout([{ x: 10, z: 10 }]));
    const log = record(w);
    const id = units(w)[0].id;
    w.dispatch({ type: 'build', unitIds: [id], kind: 'house', pos: { x: 32, z: 24 }, rot: 0 });
    w.dispatch({ type: 'build', unitIds: [id], kind: 'townCenter', pos: { x: 10, z: 30 }, rot: 0 });
    w.stock.wood = 10;
    w.dispatch({ type: 'build', unitIds: [id], kind: 'house', pos: { x: 15, z: 15 }, rot: 0 });
    expect(log).toEqual([
      { type: 'rejected', reason: 'blocked-site' },
      { type: 'rejected', reason: 'invalid-target' },
      { type: 'rejected', reason: 'insufficient-resources' },
    ]);
    expect(w.stock.wood).toBe(10);
    expect(w.buildings.size).toBe(1);
  });

  it('builders walk to the footprint edge, build, and the house raises the pop cap', () => {
    const w = world(layout([{ x: 12, z: 12 }]));
    const log = record(w);
    const [u] = units(w);
    expect(w.popCap).toBe(5);
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'house', pos: { x: 16, z: 16 }, rot: 0 });
    const b = newest(w);
    runUntil(w, () => u.state === 'building');
    const edge = Math.max(Math.abs(u.pos.x - 16), Math.abs(u.pos.z - 16)) - 1.3;
    expect(edge).toBeGreaterThan(BALANCE.villagerRadius - 1e-6);
    expect(edge).toBeLessThan(BALANCE.villagerRadius + BALANCE.reach);
    const t = runUntil(w, () => b.complete);
    expect(t).toBeCloseTo(BUILDINGS.house.buildTime, 0);
    expect(log).toContainEqual({ type: 'constructed', id: b.id });
    expect(log.filter((e) => e.type === 'stockpile').pop()).toMatchObject({ popCap: 10 });
    expect(w.popCap).toBe(10);
    expect(u.state).toBe('idle');
    // Sight from BUILDINGS.sight once complete.
    run(w, 0.1);
    w.visibility.state.fill(EXPLORED);
    w.updateFog();
    u.pos = { x: 60, z: 45 };
    w.updateFog();
    expect(w.visibility.isVisible(16, 16 + BUILDINGS.house.sight - 0.6)).toBe(true);
    expect(w.visibility.isVisible(16, 16 + BUILDINGS.house.sight + 1)).toBe(false);
  });

  it('progress per second scales as builders^0.75 / buildTime', () => {
    const rate = (n: number) => {
      const starts = Array.from({ length: n }, (_, i) => ({ x: 14 + i * 0.8, z: 13 }));
      const w = world(layout(starts));
      const ids = units(w).map((u) => u.id);
      w.dispatch({ type: 'build', unitIds: ids, kind: 'storehouse', pos: { x: 16, z: 16 }, rot: 0 });
      const b = newest(w);
      runUntil(w, () => units(w).every((u) => u.state === 'building'));
      const p0 = b.buildProgress;
      run(w, 2);
      return (b.buildProgress - p0) / 2;
    };
    const one = rate(1);
    expect(one).toBeCloseTo(1 / BUILDINGS.storehouse.buildTime, 6);
    expect(rate(4) / one).toBeCloseTo(Math.pow(4, 0.75), 3);
    // Builders spread around the edge instead of stacking.
  });

  it('spreads a group of builders along the edge', () => {
    const starts = Array.from({ length: 4 }, (_, i) => ({ x: 14 + i * 0.3, z: 10 }));
    const w = world(layout(starts));
    w.dispatch({ type: 'build', unitIds: units(w).map((u) => u.id), kind: 'house', pos: { x: 16, z: 16 }, rot: 0 });
    runUntil(w, () => units(w).every((u) => u.state === 'building'));
    const us = units(w);
    for (let i = 0; i < us.length; i++)
      for (let j = i + 1; j < us.length; j++)
        expect(Math.hypot(us[i].pos.x - us[j].pos.x, us[i].pos.z - us[j].pos.z)).toBeGreaterThan(0.5);
  });

  it("'construct' sends helpers to an existing foundation", () => {
    const w = world(layout([{ x: 12, z: 12 }, { x: 22, z: 12 }]));
    const [a, b] = units(w);
    w.dispatch({ type: 'build', unitIds: [a.id], kind: 'house', pos: { x: 16, z: 16 }, rot: 0 });
    const site = newest(w);
    w.dispatch({ type: 'construct', unitIds: [b.id], buildingId: site.id });
    expect(b.state).toBe('toBuild');
    const t = runUntil(w, () => site.complete);
    expect(t).toBeLessThan(BUILDINGS.house.buildTime * 0.75);
    expect(a.state).toBe('idle');
    expect(b.state).toBe('idle');
  });

  it('a builder given another order stops contributing', () => {
    const w = world(layout([{ x: 14, z: 13 }]));
    const [u] = units(w);
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'house', pos: { x: 16, z: 16 }, rot: 0 });
    const b = newest(w);
    runUntil(w, () => u.state === 'building');
    run(w, 2);
    w.dispatch({ type: 'move', unitIds: [u.id], target: { x: 5, z: 5 } });
    const p = b.buildProgress;
    run(w, 3);
    expect(b.buildProgress).toBe(p);
    expect(w.buildState.has(u.id)).toBe(false);
  });

  it('cancelBuild refunds the full cost, removes the foundation, frees nav and idles builders', () => {
    const w = world(layout([{ x: 14, z: 13 }]));
    const log = record(w);
    const [u] = units(w);
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'storehouse', pos: { x: 16, z: 16 }, rot: 0 });
    const b = newest(w);
    runUntil(w, () => u.state === 'building');
    run(w, 3);
    w.dispatch({ type: 'cancelBuild', buildingId: b.id });
    expect(w.stock.wood).toBe(1000);
    expect(w.buildings.has(b.id)).toBe(false);
    expect(log).toContainEqual({ type: 'removed', id: b.id });
    expect(log.filter((e) => e.type === 'stockpile').pop()).toMatchObject({ stock: { wood: 1000 } });
    expect(w.nav.isFree({ x: 16, z: 16 })).toBe(true);
    expect(w.nav.findPath({ x: 12, z: 16 }, { x: 20, z: 16 })).toEqual([{ x: 20, z: 16 }]);
    expect(u.state).toBe('idle');
    // Complete buildings cannot be cancelled.
    w.dispatch({ type: 'cancelBuild', buildingId: w.townCenter!.id });
    expect(log.pop()).toEqual({ type: 'rejected', reason: 'invalid-target' });
    expect(w.buildings.has(w.townCenter!.id)).toBe(true);
  });
});

describe('NavGrid rectangles', () => {
  const corridor = (_x: number, z: number) => z < 20 || z > 24; // dry strip 20 ≤ z ≤ 24, water elsewhere

  it('blocking a corridor splits its region and removing it rejoins', () => {
    const hf = field(corridor);
    const nav = new NavGrid(hf);
    const a = { x: 10, z: 22 };
    const b = { x: 50, z: 22 };
    expect(nav.connected(a, b)).toBe(true);
    const v0 = nav.version;
    nav.addRect(7, { x0: 29, z0: 19, x1: 31, z1: 25 });
    expect(nav.version).toBeGreaterThan(v0);
    expect(nav.connected(a, b)).toBe(false);
    expect(nav.findPath(a, b)).toBeNull();
    nav.removeRect(7);
    expect(nav.connected(a, b)).toBe(true);
    expect(nav.findPath(a, b)).toEqual([b]);
  });

  it('incremental labels agree with a from-scratch grid after many adds and removes', () => {
    const hf = field(corridor);
    const nav = new NavGrid(hf);
    const rects = [
      { x0: 5, z0: 21, x1: 7, z1: 23 },
      { x0: 20, z0: 18, x1: 22, z1: 26 },
      { x0: 40, z0: 21.5, x1: 42, z1: 22.5 },
      { x0: 21, z0: 18, x1: 24, z1: 26 },
    ];
    rects.forEach((r, i) => nav.addRect(i, r));
    nav.removeRect(1);
    nav.removeRect(0);
    nav.removeRect(3);
    // Reference: same state built fresh (rect 2 only).
    const ref = new NavGrid(hf);
    ref.addRect(2, rects[2]);
    const pts: Vec2[] = [];
    for (let x = 1; x < 64; x += 1.7) for (let z = 19.5; z < 25; z += 0.5) pts.push({ x, z });
    for (const p of pts) {
      expect(nav.isWalkableCell(p)).toBe(ref.isWalkableCell(p));
      for (const q of pts.slice(0, 20)) expect(nav.connected(p, q)).toBe(ref.connected(p, q));
    }
  });

  it('overlapping rectangles keep shared cells blocked until both are gone', () => {
    const nav = new NavGrid(field());
    nav.addRect(1, { x0: 10, z0: 10, x1: 12, z1: 12 });
    nav.addRect(2, { x0: 11, z0: 10, x1: 13, z1: 12 });
    nav.removeRect(1);
    expect(nav.isWalkableCell({ x: 11.6, z: 11 })).toBe(false);
    expect(nav.isWalkableCell({ x: 10.25, z: 11 })).toBe(true);
    nav.removeRect(2);
    expect(nav.isWalkableCell({ x: 11.6, z: 11 })).toBe(true);
  });

  it('adding a building on open ground is cheap', () => {
    const { hf, layout: l } = generateMap(DEFAULT_SEED);
    const w = new World(hf, l);
    const tc = w.townCenter!.pos;
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      w.nav.addRect(1000 + i, { x0: tc.x + 6, z0: tc.z + 6, x1: tc.x + 9, z1: tc.z + 9 });
      w.nav.removeRect(1000 + i);
    }
    expect((performance.now() - t0) / 50).toBeLessThan(2);
  });
});

describe('population', () => {
  it('starts at 4/5 (3 villagers + scout, TC gives 5) and training stops at the cap', () => {
    const { hf, layout: l } = generateMap(DEFAULT_SEED);
    const w = new World(hf, l);
    const log = record(w);
    expect(w.pop).toBe(4);
    expect(w.popCap).toBe(BUILDINGS.townCenter.popBonus);
    w.stock.food = 500;
    w.dispatch({ type: 'train', buildingId: w.townCenter!.id });
    w.dispatch({ type: 'train', buildingId: w.townCenter!.id });
    expect(w.townCenter!.queue).toBe(1);
    expect(w.stock.food).toBe(450);
    expect(log).toContainEqual({ type: 'rejected', reason: 'pop-cap' });
  });

  it('a finished house lets training continue; a foundation does not', () => {
    const w = world(layout([{ x: 14, z: 13 }, { x: 40, z: 40 }, { x: 41, z: 40 }, { x: 42, z: 40 }, { x: 43, z: 40 }]));
    const log = record(w);
    const [builder] = units(w);
    w.dispatch({ type: 'build', unitIds: [builder.id], kind: 'house', pos: { x: 16, z: 16 }, rot: 0 });
    w.dispatch({ type: 'train', buildingId: w.townCenter!.id });
    expect(log.pop()).toEqual({ type: 'rejected', reason: 'pop-cap' });
    runUntil(w, () => newest(w).complete);
    w.dispatch({ type: 'train', buildingId: w.townCenter!.id });
    expect(w.townCenter!.queue).toBe(1);
  });
});

describe('drop sites', () => {
  it('deposits at the nearest complete drop site accepting the carried type', () => {
    const w = world(layout([{ x: 10, z: 30 }], [{ kind: 'tree', pos: { x: 8, z: 36 }, amount: 200 }]));
    const [u] = units(w);
    w.dispatch({ type: 'build', unitIds: [], kind: 'storehouse', pos: { x: 8, z: 40 }, rot: 0 });
    const store = newest(w);
    w.dispatch({ type: 'build', unitIds: [], kind: 'granary', pos: { x: 12, z: 36 }, rot: 0 });
    const granary = newest(w);
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: [...w.nodes.keys()][0] });
    // Foundation storehouse: still walks to the TC.
    runUntil(w, () => u.state === 'toDrop');
    expect(w.gatherState.get(u.id)!.drop).toBe(w.townCenter!.id);
    // Complete it (and the granary, which takes no wood): the next trip ends there.
    store.complete = granary.complete = true;
    store.buildProgress = granary.buildProgress = 1;
    runUntil(w, () => u.state === 'toNode');
    runUntil(w, () => u.state === 'toDrop');
    expect(w.gatherState.get(u.id)!.drop).toBe(store.id);
    const wood = w.stock.wood;
    runUntil(w, () => w.stock.wood > wood);
    expect(Math.hypot(u.pos.x - 8, u.pos.z - 40)).toBeLessThan(3);
  });

  it('a storehouse next to a forest shortens trips', () => {
    const forest = Array.from({ length: 8 }, (_, i) => ({ kind: 'tree' as const, pos: { x: 6 + (i % 4) * 1.5, z: 40 + Math.floor(i / 4) * 1.5 }, amount: 200 }));
    const gathered = (withStore: boolean) => {
      const w = world(layout([{ x: 10, z: 36 }, { x: 11, z: 36 }], forest));
      w.stock.wood = 1000;
      if (withStore) {
        w.dispatch({ type: 'build', unitIds: [], kind: 'storehouse', pos: { x: 14, z: 41 }, rot: 0 });
        const s = newest(w);
        s.complete = true;
        s.buildProgress = 1;
      }
      const start = w.stock.wood;
      w.dispatch({ type: 'gather', unitIds: units(w).map((u) => u.id), nodeId: [...w.nodes.keys()][0] });
      run(w, 120);
      return w.stock.wood - start;
    };
    const far = gathered(false);
    const near = gathered(true);
    expect(near).toBeGreaterThan(far * 1.5);
  });

  it('a finished storehouse sends its builder to the nearest tree', () => {
    const w = world(layout([{ x: 14, z: 36 }], [
      { kind: 'tree', pos: { x: 8, z: 42 }, amount: 100 },
      { kind: 'gold', pos: { x: 20, z: 40 }, amount: 100 },
    ]));
    const [u] = units(w);
    const tree = [...w.nodes.keys()][0];
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'storehouse', pos: { x: 14, z: 40 }, rot: 0 });
    runUntil(w, () => newest(w).complete);
    expect(u.state).toBe('toNode');
    expect(u.gatherNode).toBe(tree);
  });

  it('a removed drop site sends carriers to the next one', () => {
    const w = world(layout([{ x: 10, z: 30 }], [{ kind: 'tree', pos: { x: 8, z: 36 }, amount: 200 }]));
    const [u] = units(w);
    w.dispatch({ type: 'build', unitIds: [], kind: 'storehouse', pos: { x: 8, z: 40 }, rot: 0 });
    const store = newest(w);
    store.complete = true;
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: [...w.nodes.keys()][0] });
    runUntil(w, () => u.state === 'toDrop');
    store.complete = false; // pretend it is a foundation again, then cancel it
    w.dispatch({ type: 'cancelBuild', buildingId: store.id });
    const wood = w.stock.wood;
    runUntil(w, () => w.stock.wood > wood, 60);
    expect(w.stock.wood).toBe(wood + BALANCE.carryCap);
  });
});

describe('farms', () => {
  function farmWorld(extra: Vec2[] = []) {
    const w = world(layout([{ x: 26, z: 30 }, ...extra]));
    const [u] = units(w);
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'farm', pos: { x: 26, z: 34 }, rot: 0 });
    const farm = newest(w);
    return { w, u, farm };
  }

  it('is walkable, and its builder starts farming it when done', () => {
    const { w, u, farm } = farmWorld();
    expect(w.nav.isFree(farm.pos)).toBe(true);
    runUntil(w, () => farm.complete);
    expect(farm.food).toBe(FARM_FOOD);
    expect(u.state).toBe('toNode');
    expect(u.gatherNode).toBe(farm.id);
    runUntil(w, () => u.state === 'gathering');
    expect(Math.abs(u.pos.x - 26) <= 2 && Math.abs(u.pos.z - 34) <= 2).toBe(true);
    const food = w.stock.food;
    runUntil(w, () => w.stock.food > food, 60);
    expect(w.stock.food).toBe(food + BALANCE.carryCap);
    expect(farm.food).toBeLessThanOrEqual(FARM_FOOD - BALANCE.carryCap);
  });

  it('takes one farmer at a time', () => {
    const { w, u, farm } = farmWorld([{ x: 20, z: 30 }]);
    const other = units(w)[1];
    const log = record(w);
    runUntil(w, () => farm.complete);
    w.dispatch({ type: 'gather', unitIds: [other.id], nodeId: farm.id });
    expect(log).toContainEqual({ type: 'rejected', reason: 'occupied' });
    expect(other.state).toBe('idle');
    // Once the farmer leaves, the farm is free again.
    w.dispatch({ type: 'move', unitIds: [u.id], target: { x: 10, z: 10 } });
    w.dispatch({ type: 'gather', unitIds: [other.id], nodeId: farm.id });
    expect(other.gatherNode).toBe(farm.id);
    expect(w.farmers.get(farm.id)).toBe(other.id);
  });

  it('a group order on a farm fills other free farms nearby', () => {
    const w = world(layout([{ x: 20, z: 30 }, { x: 21, z: 30 }]));
    w.dispatch({ type: 'build', unitIds: [], kind: 'farm', pos: { x: 20, z: 36 }, rot: 0 });
    const a = newest(w);
    w.dispatch({ type: 'build', unitIds: [], kind: 'farm', pos: { x: 25, z: 36 }, rot: 0 });
    const b = newest(w);
    for (const f of [a, b]) {
      f.complete = true;
      f.food = FARM_FOOD;
    }
    const [u1, u2] = units(w);
    w.dispatch({ type: 'gather', unitIds: [u1.id, u2.id], nodeId: a.id });
    expect(u1.gatherNode).toBe(a.id);
    expect(u2.gatherNode).toBe(b.id);
  });

  it('depletes to a fallow field, and construct reseeds it for its wood cost', () => {
    const { w, u, farm } = farmWorld();
    runUntil(w, () => farm.complete);
    farm.food = 4;
    runUntil(w, () => farm.food === 0);
    expect(w.buildings.has(farm.id)).toBe(true);
    runUntil(w, () => u.state === 'idle', 60);
    expect(w.stock.food).toBe(1000 + 4);
    const wood = w.stock.wood;
    w.dispatch({ type: 'construct', unitIds: [u.id], buildingId: farm.id });
    expect(w.stock.wood).toBe(wood - BUILDINGS.farm.cost.wood!);
    expect(farm.food).toBe(FARM_FOOD);
    expect(u.gatherNode).toBe(farm.id);
    // Not affordable: rejected, nothing changes.
    farm.food = 0;
    w.stock.wood = 0;
    const log = record(w);
    w.dispatch({ type: 'construct', unitIds: [u.id], buildingId: farm.id });
    expect(log).toEqual([{ type: 'rejected', reason: 'insufficient-resources' }]);
    expect(farm.food).toBe(0);
  });

  it('the farmer drops food at a granary when it is nearer than the TC', () => {
    const w = world(layout([{ x: 10, z: 40 }]));
    const [u] = units(w);
    w.dispatch({ type: 'build', unitIds: [], kind: 'farm', pos: { x: 10, z: 36 }, rot: 0 });
    const farm = newest(w);
    w.dispatch({ type: 'build', unitIds: [], kind: 'granary', pos: { x: 15, z: 36 }, rot: 0 });
    const granary = newest(w);
    farm.complete = granary.complete = true;
    farm.food = FARM_FOOD;
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: farm.id });
    runUntil(w, () => u.state === 'toDrop');
    expect(w.gatherState.get(u.id)!.drop).toBe(granary.id);
  });
});

describe('stone', () => {
  it('is quarried like gold, slower, and dropped at a mining camp', () => {
    const w = world(layout([{ x: 10, z: 40 }], [{ kind: 'stone', pos: { x: 8, z: 44 }, amount: 350 }]));
    w.stock.stone = 0;
    const [u] = units(w);
    const quarry = [...w.nodes.values()][0];
    expect(quarry).toMatchObject({ type: 'stone', radius: 0.7 });
    w.dispatch({ type: 'build', unitIds: [], kind: 'miningCamp', pos: { x: 12, z: 44 }, rot: 0 });
    const camp = newest(w);
    camp.complete = true;
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: quarry.id });
    runUntil(w, () => u.state === 'gathering');
    const t = runUntil(w, () => u.state === 'toDrop');
    expect(t).toBeCloseTo(BALANCE.carryCap * BALANCE.gatherIntervals.stone, 0);
    expect(BALANCE.gatherIntervals.stone).toBeGreaterThan(BALANCE.gatherIntervals.gold);
    expect(w.gatherState.get(u.id)!.drop).toBe(camp.id);
    runUntil(w, () => w.stock.stone > 0);
    expect(w.stock.stone).toBe(BALANCE.carryCap);
    run(w, 30);
    expect(w.stock.stone).toBeGreaterThanOrEqual(3 * BALANCE.carryCap);
    expect(quarry.amount).toBe(350 - w.stock.stone - (u.carry?.amount ?? 0));
  });

  it('falls back to the TC without a mining camp', () => {
    const w = world(layout([{ x: 28, z: 30 }], [{ kind: 'stone', pos: { x: 26, z: 33 }, amount: 350 }]));
    const [u] = units(w) as Unit[];
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: [...w.nodes.keys()][0] });
    runUntil(w, () => u.state === 'toDrop');
    expect(w.gatherState.get(u.id)!.drop).toBe(w.townCenter!.id);
  });
});
