import { describe, expect, it } from 'vitest';
import { BUILDINGS, TERRITORY } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type PlayerId, type Vec2 } from '../core/types';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { destroyBuilding } from './systems/combat';
import { completeResearch } from './systems/research';
import { territoryInfluence } from './territory';
import { defaultPlayers, World } from './World';
import { perfBudget } from '../testing/perf';

const DT = 1 / BALANCE.tickRate;

/** Flat land; water at and beyond x = `waterFrom`. */
function flat(w = 120, d = 120, waterFrom = Infinity): Heightfield {
  return {
    width: w,
    depth: d,
    heightAt: (x) => (x >= waterFrom ? -1 : 0.5),
    isWater: (x) => x >= waterFrom,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d && x < waterFrom,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

/** One Town Center per entry in `tcs` (player i + 1), on a flat map. */
function arena(tcs: Vec2[], hf = flat()): World {
  const [first, ...rest] = tcs;
  const layout: MapLayout = {
    townCenter: first,
    villagers: [],
    scouts: [],
    extraStarts: rest.map((townCenter) => ({ townCenter, villagers: [], scouts: [] })),
    nodes: [],
    props: [],
  };
  return new World(hf, layout, defaultPlayers(tcs.length));
}

function building(world: World, kind: BuildingKind, pos: Vec2, owner: PlayerId = 1): Building {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  return b;
}

const TC_RADIUS = BUILDINGS.townCenter.territory!.radius;

describe('territory (M18-1)', () => {
  it('has influence data per building: Town Center root, minor buildings small, walls and farms none', () => {
    expect(BUILDINGS.townCenter.territory).toMatchObject({ root: true });
    for (const kind of ['palisade', 'stoneWall', 'gate', 'farm'] as const) expect(BUILDINGS[kind].territory).toBeUndefined();
    for (const kind of ['house', 'barracks', 'storehouse', 'dock', 'watchTower'] as const) {
      const t = BUILDINGS[kind].territory!;
      expect(t.root).toBeFalsy();
      expect(t.radius).toBeGreaterThanOrEqual(6);
      expect(t.radius).toBeLessThanOrEqual(10);
    }
  });

  it('a Town Center owns a disc around it, connected; beyond its radius is neutral', () => {
    const world = arena([{ x: 60.5, z: 60.5 }]);
    expect(world.territoryOwner({ x: 60.5, z: 60.5 })).toBe(1);
    expect(world.isConnected({ x: 60.5, z: 60.5 })).toBe(true);
    expect(world.territoryOwner({ x: 60.5 + TC_RADIUS - 1, z: 60.5 })).toBe(1);
    expect(world.territoryOwner({ x: 60.5 + TC_RADIUS + 1, z: 60.5 })).toBe(0);
    expect(world.isConnected({ x: 60.5 + TC_RADIUS + 1, z: 60.5 })).toBe(false);
    expect(world.territoryOwner({ x: -5, z: 10 })).toBe(0);
  });

  it('grows when a building completes, not while it is a foundation', () => {
    const world = arena([{ x: 30.5, z: 60.5 }]);
    const edge = { x: 30.5 + TC_RADIUS + 4, z: 60.5 };
    expect(world.territoryOwner(edge)).toBe(0);
    const version = world.territory.version;
    const b = layFoundation(world, 'barracks', { x: 30.5 + TC_RADIUS - 2, z: 60.5 }, 0, 1);
    world.tick(DT);
    expect(world.territory.version).toBe(version); // a foundation changes nothing, so no recompute
    expect(world.territoryOwner(edge)).toBe(0);
    completeBuilding(world, b);
    world.tick(DT);
    expect(world.territoryOwner(edge)).toBe(1);
    expect(world.isConnected(edge)).toBe(true);
    // Idle ticks do not recompute.
    const after = world.territory.version;
    for (let i = 0; i < 20; i++) world.tick(DT);
    expect(world.territory.version).toBe(after);
  });

  it('contested ground goes to the stronger pull; an exact tie is neutral', () => {
    const world = arena([{ x: 30.5, z: 60.5 }, { x: 70.5, z: 60.5 }]);
    // x = 50.5 is a cell centre equidistant from both Town Centers.
    expect(world.territoryOwner({ x: 50.5, z: 60.5 })).toBe(0);
    expect(world.territoryOwner({ x: 49.5, z: 60.5 })).toBe(1);
    expect(world.territoryOwner({ x: 51.5, z: 60.5 })).toBe(2);
    // A player-2 house near the line pushes the border toward player 1.
    building(world, 'house', { x: 52, z: 60.5 }, 2);
    world.tick(DT);
    expect(world.territoryOwner({ x: 50.5, z: 60.5 })).toBe(2);
    expect(world.territoryOwner({ x: 49.5, z: 60.5 })).toBe(2);
    expect(world.territoryOwner({ x: 40.5, z: 60.5 })).toBe(1);
  });

  it('losing the root leaves buildings standing on unconnected territory', () => {
    const world = arena([{ x: 30.5, z: 60.5 }, { x: 100.5, z: 100.5 }]);
    const near = building(world, 'barracks', { x: 30.5 + TC_RADIUS - 2, z: 60.5 });
    // A house far from any root: its own little patch is owned but never connected.
    const far = building(world, 'house', { x: 90, z: 20 });
    world.tick(DT);
    expect(world.territoryOwner(near.pos)).toBe(1);
    expect(world.isConnected(near.pos)).toBe(true);
    expect(world.territoryOwner(far.pos)).toBe(1);
    expect(world.isConnected(far.pos)).toBe(false);
    destroyBuilding(world, world.townCenterOf(1)!);
    world.tick(DT);
    expect(world.territoryOwner(near.pos)).toBe(1);
    expect(world.isConnected(near.pos)).toBe(false);
    expect(world.territoryOwner({ x: 30.5, z: 60.5 })).toBe(0);
    // The other player's root still holds.
    expect(world.isConnected({ x: 100.5, z: 100.5 })).toBe(true);
  });

  it('ageing up grows the Town Center radius by 25% per age', () => {
    const world = arena([{ x: 60.5, z: 60.5 }]);
    const p = { x: 60.5 + TC_RADIUS * 1.2, z: 60.5 };
    expect(world.territoryOwner(p)).toBe(0);
    completeResearch(world, 1, 'townAge');
    world.tick(DT);
    expect(world.territoryOwner(p)).toBe(1);
    const tc = world.townCenterOf(1)!;
    expect(territoryInfluence(tc, 3)!.radius).toBeCloseTo(TC_RADIUS * (1 + 3 * TERRITORY.ageRadiusBonus));
    // Other buildings do not scale with age.
    expect(territoryInfluence(building(world, 'house', { x: 50, z: 50 }), 3)).toBe(BUILDINGS.house.territory);
  });

  it('reaches only TERRITORY.waterReach cells over water', () => {
    const world = arena([{ x: 50.5, z: 60.5 }], flat(120, 120, 60));
    const reach = TERRITORY.waterReach * TERRITORY.cell;
    expect(world.territoryOwner({ x: 59.5, z: 60.5 })).toBe(1);
    expect(world.territoryOwner({ x: 60 + reach - 0.5, z: 60.5 })).toBe(1);
    expect(world.territoryOwner({ x: 60 + reach + 0.5, z: 60.5 })).toBe(0);
    expect(world.territoryOwner({ x: 60 + reach + 4.5, z: 60.5 })).toBe(0);
  });

  it('island maps: deep water between islands stays neutral', () => {
    const { hf, layout } = generateMap(9, 2, { size: 'small', type: 'islands' });
    const world = new World(hf, layout);
    const t = world.territory;
    for (let i = 0; i < t.owner.length; i++) {
      if (!t.owner[i]) continue;
      const x = (i % t.cols) + 0.5;
      const z = Math.floor(i / t.cols) + 0.5;
      if (!hf.isWater(x, z)) continue;
      // An owned water cell has land within waterReach (4-neighbour steps ≥ straight-line distance).
      let near = false;
      const r = TERRITORY.waterReach;
      for (let dz = -r; dz <= r && !near; dz++) for (let dx = -r; dx <= r && !near; dx++) {
        if (Math.abs(dx) + Math.abs(dz) <= r && !hf.isWater(x + dx, z + dz)) near = true;
      }
      expect(near).toBe(true);
    }
  });

  it('is deterministic: same buildings in the same order give the same grid, and recompute is idempotent', () => {
    const make = () => {
      const { hf, layout } = generateMap(3, 2);
      const world = new World(hf, layout);
      const tc1 = world.townCenterOf(1)!.pos;
      const tc2 = world.townCenterOf(2)!.pos;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        for (const [owner, c] of [[1, tc1], [2, tc2]] as const) {
          const pos = world.nav.nearestFree({ x: c.x + Math.cos(a) * 16, z: c.z + Math.sin(a) * 16 }) ?? c;
          building(world, 'house', pos, owner);
        }
      }
      world.tick(DT);
      return world;
    };
    const a = make();
    const b = make();
    expect(Buffer.from(a.territory.owner).equals(Buffer.from(b.territory.owner))).toBe(true);
    expect(Buffer.from(a.territory.connected).equals(Buffer.from(b.territory.connected))).toBe(true);
    const before = Uint8Array.from(a.territory.owner);
    a.territory.recompute(a);
    expect(Buffer.from(a.territory.owner).equals(Buffer.from(before))).toBe(true);
  });

  it('is not saved but recomputes identically after load', () => {
    const { hf, layout } = generateMap(5, 2);
    const world = new World(hf, layout);
    world.seed = 5;
    const tc = world.townCenterOf(1)!.pos;
    building(world, 'barracks', world.nav.nearestFree({ x: tc.x + 18, z: tc.z }) ?? tc);
    building(world, 'house', world.nav.nearestFree({ x: tc.x + 45, z: tc.z + 10 }) ?? tc);
    completeResearch(world, 2, 'townAge');
    world.tick(DT);
    const save = serializeWorld(world);
    expect(JSON.stringify(save)).not.toContain('territory');
    const loaded = deserializeWorld(save, hf);
    expect(Buffer.from(loaded.territory.owner).equals(Buffer.from(world.territory.owner))).toBe(true);
    expect(Buffer.from(loaded.territory.connected).equals(Buffer.from(world.territory.connected))).toBe(true);
    // Both keep evolving in step.
    for (const w of [world, loaded]) destroyBuilding(w, w.townCenterOf(1)!);
    world.tick(DT);
    loaded.tick(DT);
    expect(Buffer.from(loaded.territory.connected).equals(Buffer.from(world.territory.connected))).toBe(true);
  });

  it('bench: recompute on the largest map stays well inside a tick; idle sync is near free', () => {
    const { hf, layout } = generateMap(1, 4, { size: 'giant' });
    const world = new World(hf, layout);
    for (const [id, p] of world.players) {
      p.age = 3;
      const c = world.townCenterOf(id)!.pos;
      // 60 buildings per player in rings around the Town Center.
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 * 3;
        const r = 8 + (i % 20) * 1.5;
        const pos = world.nav.nearestFree({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }) ?? c;
        building(world, i % 3 ? 'house' : 'barracks', pos, id);
      }
    }
    world.territory.recompute(world);
    let full = Infinity;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      world.territory.recompute(world);
      full = Math.min(full, performance.now() - t0);
    }
    let idle = Infinity;
    for (let batch = 0; batch < 10; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) world.territory.sync(world);
      idle = Math.min(idle, (performance.now() - t0) / 20);
    }
    console.log(`territory, giant map, 4 players × 61 buildings: recompute ${full.toFixed(3)} ms, idle sync ${idle.toFixed(4)} ms`);
    // A tick is 50 ms; a recompute happens only on a completion, death, conversion or age-up.
    expect(full).toBeLessThan(perfBudget(10));
    expect(idle).toBeLessThan(perfBudget(0.1));
  });
});
