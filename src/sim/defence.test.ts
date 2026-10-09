import { describe, expect, it } from 'vitest';
import { footprint } from '../core/buildings';
import {
  GRASS_ONLY,
  type Building,
  type Heightfield,
  type MapLayout,
  type SimEvent,
  type Vec2,
} from '../core/types';
import { BALANCE } from './balance';
import { rectDistance } from './nav';
import { applyDamage } from './systems/combat';
import { completeBuilding, layFoundation } from './systems/build';
import { route } from './systems/passage';
import { buildingRect } from './systems/sites';
import { wallSegments } from './systems/walls';
import { EXPLORED } from './visibility';
import { defaultPlayers, World } from './World';

const DT = 1 / BALANCE.tickRate;

function flat(w: number, d: number): Heightfield {
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

/** Two players, Town Centers in opposite corners, the whole map explored, a fat stockpile. */
function field(w = 64, d = 48): World {
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 },
    villagers: [],
    scouts: [],
    extraStarts: [{ townCenter: { x: w - 4, z: d - 4 }, villagers: [], scouts: [] }],
    nodes: [],
    props: [],
  };
  const world = new World(flat(w, d), layout, defaultPlayers(2));
  world.visibility.state.fill(EXPLORED);
  Object.assign(world.stock, { wood: 5000, food: 5000, gold: 5000, stone: 5000 });
  return world;
}

function run(world: World, seconds: number, until?: () => boolean): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.tick(DT);
    if (until?.()) return;
  }
}

function rect(kind: Building['kind'], pos: Vec2, rot: number): { x0: number; z0: number; x1: number; z1: number } {
  const { hw, hd } = footprint(kind, rot);
  return { x0: pos.x - hw, z0: pos.z - hd, x1: pos.x + hw, z1: pos.z + hd };
}

/** Points along a path, dense enough to catch a cut through a wall. */
function samples(path: readonly Vec2[]): Vec2[] {
  if (!path.length) return [];
  const out: Vec2[] = [{ ...path[0] }];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function cuts(path: readonly Vec2[], r: { x0: number; z0: number; x1: number; z1: number }, pad = 0.08): boolean {
  return samples(path).some((p) => p.x > r.x0 + pad && p.x < r.x1 - pad && p.z > r.z0 + pad && p.z < r.z1 - pad);
}

function finish(world: World, kind: Building['kind'], pos: Vec2, owner = 1): Building {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  return b;
}

describe('wall lines', () => {
  it('tiles an axis-aligned drag edge to edge, and a short drag is one segment', () => {
    const across = wallSegments('palisade', { x: 10, z: 20 }, { x: 16, z: 20.2 });
    expect(across.map((s) => s.pos)).toEqual([
      { x: 10, z: 20 },
      { x: 12, z: 20 },
      { x: 14, z: 20 },
      { x: 16, z: 20 },
    ]);
    expect(across.every((s) => s.rot === 0)).toBe(true);
    for (let i = 1; i < across.length; i++) {
      const prev = rect('palisade', across[i - 1].pos, across[i - 1].rot);
      const next = rect('palisade', across[i].pos, across[i].rot);
      expect(next.x0).toBeCloseTo(prev.x1);
      expect(next.z0).toBeCloseTo(prev.z0);
    }

    const down = wallSegments('stoneWall', { x: 10, z: 20 }, { x: 10.2, z: 26 });
    expect(down.map((s) => s.pos)).toEqual([
      { x: 10, z: 20 },
      { x: 10, z: 22 },
      { x: 10, z: 24 },
      { x: 10, z: 26 },
    ]);
    expect(down.every((s) => s.rot === Math.PI / 2)).toBe(true);
    expect(wallSegments('palisade', { x: 8, z: 8 }, { x: 8.1, z: 8.1 })).toHaveLength(1);
  });

  it('blocks the nav grid as soon as the foundations are laid', () => {
    const w = field();
    const builder = w.spawnUnit('villager', { x: 24, z: 4 }, 1);
    w.dispatch({ type: 'buildWall', unitIds: [builder.id], kind: 'palisade', from: { x: 8, z: 12 }, to: { x: 40, z: 12 } });
    const walls = [...w.buildings.values()].filter((b) => b.kind === 'palisade');
    expect(walls.length).toBeGreaterThan(10);
    for (const b of walls) expect(w.nav.isWalkableCell(b.pos)).toBe(false);

    const path = w.nav.findPath({ x: 24, z: 4 }, { x: 24, z: 20 });
    expect(path).not.toBeNull();
    const pts = path!;
    for (const b of walls) expect(cuts(pts, buildingRect(b))).toBe(false);
    const xs = samples(pts).map((p) => p.x);
    expect(Math.min(...xs) < 8 || Math.max(...xs) > 40).toBe(true);
  });
});

describe('gates', () => {
  function walled(): { w: World; gate: Building } {
    const w = field();
    const builder = w.spawnUnit('villager', { x: 4, z: 20 }, 1);
    w.dispatch({ type: 'buildWall', unitIds: [builder.id], kind: 'palisade', from: { x: 8, z: 12 }, to: { x: 22, z: 12 } });
    w.dispatch({ type: 'buildWall', unitIds: [builder.id], kind: 'palisade', from: { x: 26, z: 12 }, to: { x: 40, z: 12 } });
    const gate = layFoundation(w, 'gate', { x: 24, z: 12 }, 0, 1);
    return { w, gate };
  }

  it('blocks while under construction, then lets only its owner through', () => {
    const { w, gate } = walled();
    expect(w.nav.isWalkableCell(gate.pos)).toBe(false);
    completeBuilding(w, gate);
    expect(w.nav.isWalkableCell(gate.pos)).toBe(true);

    const hole = buildingRect(gate);
    const own = route(w, 1, { x: 24, z: 6 }, { x: 24, z: 18 });
    const enemy = route(w, 2, { x: 24, z: 6 }, { x: 24, z: 18 });
    expect(own).not.toBeNull();
    expect(enemy).not.toBeNull();
    // A clear run comes back as just the goal, so include the start when sampling.
    const south = { x: 24, z: 6 };
    expect(cuts([south, ...own!], hole, 0)).toBe(true);
    expect(cuts([south, ...enemy!], hole, 0)).toBe(false);

    const friend = w.spawnUnit('villager', { x: 24, z: 7 }, 1);
    const foe = w.spawnUnit('villager', { x: 24, z: 5 }, 2);
    w.dispatch({ type: 'move', unitIds: [friend.id], target: { x: 24, z: 20 } });
    w.dispatch({ type: 'move', unitIds: [foe.id], target: { x: 24, z: 20 } }, 2);
    const seen: Vec2[] = [];
    run(w, 8, () => {
      seen.push({ x: foe.pos.x, z: foe.pos.z });
      return friend.pos.z > 16;
    });
    expect(friend.pos.z).toBeGreaterThan(14);
    expect(seen.some((p) => cuts([p], hole, 0))).toBe(false);
  });
});

describe('garrison and the town bell', () => {
  it('takes a villager inside a tower and puts them back outside', () => {
    const w = field();
    const tower = finish(w, 'watchTower', { x: 30, z: 24 });
    const v = w.spawnUnit('villager', { x: 30, z: 24 }, 1);
    w.dispatch({ type: 'garrison', unitIds: [v.id], buildingId: tower.id });
    expect(v.state).toBe('garrisoned');
    expect(tower.occupants).toContain(v.id);
    expect(v.pos).toEqual({ x: 30, z: 24 });

    w.dispatch({ type: 'ungarrison', buildingId: tower.id });
    expect(tower.occupants ?? []).toHaveLength(0);
    expect(v.state).toBe('idle');
    expect(v.shelter ?? null).toBeNull();
    expect(rectDistance(v.pos, buildingRect(tower))).toBeGreaterThan(0);
  });

  it('sends each villager into the nearest shelter, and the overflow to the next one', () => {
    const w = field();
    const tc = w.townCenterOf(1)!;
    const tower = finish(w, 'watchTower', { x: 30, z: 30 });
    const byTower = w.spawnUnit('villager', { x: 30, z: 32 }, 1);
    const byTc = w.spawnUnit('villager', { x: tc.pos.x + 2.4, z: tc.pos.z }, 1);
    w.dispatch({ type: 'townBell' });
    run(w, 8, () => byTower.state === 'garrisoned' && byTc.state === 'garrisoned');
    expect(byTower.state).toBe('garrisoned');
    expect(byTower.shelter).toBe(tower.id);
    expect(byTc.state).toBe('garrisoned');
    expect(byTc.shelter).toBe(tc.id);

    for (let i = tower.occupants?.length ?? 0; i < 5; i++) {
      const u = w.spawnUnit('villager', { x: 30, z: 30 }, 1);
      w.dispatch({ type: 'garrison', unitIds: [u.id], buildingId: tower.id });
    }
    expect(tower.occupants).toHaveLength(5);
    const extra = w.spawnUnit('villager', { x: 30, z: 33 }, 1);
    w.dispatch({ type: 'townBell' });
    run(w, 30, () => extra.state === 'garrisoned');
    expect(extra.shelter).toBe(tc.id);
    expect(extra.state).toBe('garrisoned');
    expect(tower.occupants).toHaveLength(5);
  });

  it('kills the villagers inside a tower when the tower falls', () => {
    const w = field();
    const tower = finish(w, 'watchTower', { x: 30, z: 24 });
    const v = w.spawnUnit('villager', { x: 30, z: 24 }, 1);
    w.dispatch({ type: 'garrison', unitIds: [v.id], buildingId: tower.id });
    tower.hp = 1;
    applyDamage(w, tower, 10000, null, 2, { x: tower.pos.x, z: tower.pos.z });
    expect(w.units.has(v.id)).toBe(false);
    expect(w.buildings.has(tower.id)).toBe(false);
  });
});

describe('tower fire', () => {
  it('shoots one arrow with nobody inside, and one more per villager', () => {
    const w = field();
    finish(w, 'watchTower', { x: 32, z: 24 });
    const enemy = w.spawnUnit('hoplite', { x: 32, z: 28 }, 2);
    w.updateFog();
    const shots: SimEvent[] = [];
    w.events.on('projectile', (e) => shots.push(e));
    w.tick(DT);
    expect(shots.filter((e) => e.type === 'projectile')).toHaveLength(1);
    const before = enemy.hp;
    run(w, 1);
    expect(enemy.hp).toBeLessThanOrEqual(before - 5);

    const manned = field();
    const tower2 = finish(manned, 'watchTower', { x: 32, z: 24 });
    for (let i = 0; i < 2; i++) {
      const u = manned.spawnUnit('villager', { x: 32, z: 24 }, 1);
      manned.dispatch({ type: 'garrison', unitIds: [u.id], buildingId: tower2.id });
    }
    const foe = manned.spawnUnit('hoplite', { x: 32, z: 28 }, 2);
    manned.updateFog();
    const volley: SimEvent[] = [];
    manned.events.on('projectile', (e) => volley.push(e));
    manned.tick(DT);
    expect(volley.filter((e) => e.type === 'projectile')).toHaveLength(3);
    const hp = foe.hp;
    run(manned, 1);
    expect(foe.hp).toBeLessThan(hp);
  });
});
