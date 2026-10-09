import { describe, expect, it, vi } from 'vitest';
import { GRASS_ONLY, type Heightfield, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { UNITS } from '../core/units';
import { BALANCE } from './balance';
import { World } from './World';
import { formationOffset, formationSlots, movementSystem, orderMove, speedOf } from './systems/movement';

const DT = 0.05;
function field(water: (x: number, z: number) => boolean = () => false): Heightfield {
  return { width: 176, depth: 176, heightAt: () => 0.5, isWater: water,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < 176 && z < 176 && !water(x, z),
    forestDensity: () => 0, ground: () => GRASS_ONLY };
}
function worldOn(hf = field()): World {
  return new World(hf, { townCenter: { x: 160, z: 160 }, villagers: [], scouts: [], nodes: [], props: [] });
}
function run(world: World, seconds: number): Unit[] {
  const arrived: Unit[] = [];
  for (let t = 0; t < seconds / DT; t++) arrived.push(...movementSystem(world, DT));
  return arrived;
}
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

describe('formation orders', () => {
  it('keeps legacy public helpers and uses every unit kind’s speed', () => {
    expect(formationOffset(0)).toEqual({ x: 0, z: 0 });
    const world = worldOn();
    for (const kind of Object.keys(UNITS) as UnitKind[]) {
      const u = world.spawnUnit(kind, { x: 10, z: 10 + world.units.size * 5 });
      expect(speedOf(u)).toBe(UNITS[kind].speed);
      orderMove(world, [u.id], { x: 100, z: u.pos.z });
    }
    run(world, 1);
    for (const u of world.units.values()) expect(u.pos.x).toBeCloseTo(10 + UNITS[u.kind].speed, 8);
    const villager = [...world.units.values()].find((u) => u.kind === 'villager')!;
    villager.carry = { type: 'wood', amount: 1 };
    expect(speedOf(villager)).toBeCloseTo(BALANCE.villagerSpeedLoaded);
  });

  it('puts melee in front of ranged rows, facing east or north regardless of selection order', () => {
    const world = worldOn();
    const units = ['archer', 'hoplite', 'slinger', 'horseman', 'swordsman', 'archer'].map((kind, i) =>
      world.spawnUnit(kind as UnitKind, { x: 10, z: 20 + i * 2 }));
    for (const target of [{ x: 100, z: 25 }, { x: 10, z: 100 }]) {
      const slots = formationSlots(world.nav, units, target) as Vec2[];
      const forward = { x: target.x - 10, z: target.z - 25 };
      const projection = (p: Vec2) => p.x * forward.x + p.z * forward.z;
      const ranged = slots.filter((_, i) => UNITS[units[i].kind].unitClass === 'archer').map(projection);
      const melee = slots.filter((_, i) => UNITS[units[i].kind].unitClass !== 'archer').map(projection);
      expect(Math.min(...melee)).toBeGreaterThan(Math.max(...ranged));
      for (const p of slots) {
        expect(world.nav.isFree(p)).toBe(true);
        expect(p.x % 0.5).toBe(0.25);
        expect(p.z % 0.5).toBe(0.25);
      }
      expect(new Set(slots.map((p) => `${p.x},${p.z}`)).size).toBe(units.length);
    }
  });

  it('snaps blocked destinations to distinct reachable slots without crossing water or buildings', () => {
    const world = worldOn(field((x) => x >= 40 && x <= 46));
    world.nav.addRect(999, { x0: 32, x1: 35, z0: 20, z1: 28 });
    const units = Array.from({ length: 12 }, (_, i) => world.spawnUnit('villager', { x: 10 + i % 4, z: 20 + Math.floor(i / 4) }));
    orderMove(world, units.map((u) => u.id), { x: 42, z: 24 });
    const ends = units.map((u) => u.path.at(-1)!);
    expect(new Set(ends.map((p) => `${p.x},${p.z}`)).size).toBe(units.length);
    for (const p of ends) { expect(world.nav.isFree(p)).toBe(true); expect(p.x).toBeLessThan(40); }
    for (let t = 0; t < 800; t++) {
      movementSystem(world, DT);
      for (const u of units) expect(world.nav.isFree(u.pos)).toBe(true);
    }
    for (const u of units) expect(u.state).toBe('idle');
  });

  it('caps a mixed group at its slowest speed and drops the cap when another system replaces its path', () => {
    const world = worldOn();
    const slow = world.spawnUnit('hoplite', { x: 10, z: 20 });
    const fast = world.spawnUnit('horseman', { x: 10, z: 25 });
    orderMove(world, [slow.id, fast.id, fast.id], { x: 120, z: 22.5 });
    const starts = [slow, fast].map((u) => ({ ...u.pos }));
    run(world, 1);
    [slow, fast].forEach((u, i) => expect(distance(u.pos, starts[i])).toBeCloseTo(UNITS.hoplite.speed, 8));
    fast.path = [{ x: 120, z: fast.pos.z }];
    const x = fast.pos.x;
    run(world, 1);
    expect(fast.pos.x - x).toBeCloseTo(UNITS.horseman.speed, 8);
  });

  it('slows on approach, arrives once, and settles without orbiting or permanent stacking', () => {
    const world = worldOn();
    const units = Array.from({ length: 16 }, (_, i) => world.spawnUnit('hoplite', { x: 10 + i % 4, z: 20 + Math.floor(i / 4) }));
    orderMove(world, units.map((u) => u.id), { x: 30, z: 25 });
    const ends = units.map((u) => ({ ...u.path.at(-1)! }));
    const arrived = run(world, 25);
    expect(arrived.length).toBe(units.length);
    units.forEach((u, i) => { expect(u.pos).toEqual(ends[i]); expect(u.state).toBe('idle'); });
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      expect(distance(units[i].pos, units[j].pos)).toBeGreaterThan(UNITS.hoplite.radius * 2);
    }
    expect(run(world, 3)).toEqual([]);
    units.forEach((u, i) => expect(u.pos).toEqual(ends[i]));

    const solo = world.spawnUnit('villager', { x: 70, z: 70 });
    orderMove(world, [solo.id], { x: 71, z: 70 });
    run(world, 0.25);
    const before = solo.pos.x;
    movementSystem(world, DT);
    expect(solo.pos.x - before).toBeLessThan(UNITS.villager.speed * DT);
    run(world, 2);
    expect(solo.pos).toEqual({ x: 71, z: 70 });
  });
});

describe('local steering and jam recovery', () => {
  it('separates overlapping movers and lets idle units yield without entering water or a footprint', () => {
    const world = worldOn(field((_, z) => z < 10));
    world.nav.addRect(999, { x0: 14, x1: 16, z0: 10, z1: 12 });
    const movers = Array.from({ length: 6 }, () => world.spawnUnit('villager', { x: 10, z: 10.4 }));
    const idle = world.spawnUnit('villager', { x: 12, z: 10.4 });
    const idleStart = { ...idle.pos };
    orderMove(world, movers.map((u) => u.id), { x: 22, z: 10.4 });
    for (let t = 0; t < 400; t++) {
      movementSystem(world, DT);
      for (const u of world.units.values()) expect(world.nav.isFree(u.pos)).toBe(true);
    }
    expect(distance(idle.pos, idleStart)).toBeGreaterThan(0.05);
    expect(idle.state).toBe('idle');
    for (const u of movers) expect(u.state).toBe('idle');
  });

  it.each(['ford', 'doorway'])('gets 50 units through a three-unit-wide %s within 60 seconds', (kind) => {
    const water = (x: number, z: number) => x >= 29 && x <= 31 && (z < 28.5 || z > 31.5);
    const world = worldOn(kind === 'ford' ? field(water) : field());
    if (kind === 'doorway') {
      world.nav.addRect(998, { x0: 29, x1: 31, z0: 0, z1: 28.5 });
      world.nav.addRect(999, { x0: 29, x1: 31, z0: 31.5, z1: 176 });
    }
    const units = Array.from({ length: 50 }, (_, i) => world.spawnUnit('villager', { x: 10 + i % 5, z: 25 + Math.floor(i / 5) }));
    orderMove(world, units.map((u) => u.id), { x: 50, z: 30 });
    const ends = units.map((u) => ({ ...u.path.at(-1)! }));
    const arrived = new Set<number>();
    for (let t = 0; t < 1200; t++) {
      for (const u of movementSystem(world, DT)) arrived.add(u.id);
      for (const u of units) expect(world.nav.isFree(u.pos)).toBe(true);
      if (arrived.size === units.length) break;
    }
    expect(arrived.size).toBe(units.length);
    expect(run(world, 3)).toEqual([]); // arrived units return to slots after yielding to the last arrivals
    units.forEach((u, i) => { expect(u.state).toBe('idle'); expect(distance(u.pos, ends[i])).toBeLessThan(0.1); });
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      expect(distance(units[i].pos, units[j].pos)).toBeGreaterThan(0.55);
    }
  });

  it('repaths stalled units around a new obstruction after roughly 1.5 seconds, with a tick budget', () => {
    const world = worldOn();
    const units = Array.from({ length: 10 }, (_, i) => world.spawnUnit('villager', { x: 10, z: 20 + i * 2 }));
    for (const u of units) orderMove(world, [u.id], { x: 40, z: u.pos.z });
    world.nav.addRect(999, { x0: 10.5, x1: 12, z0: 18, z1: 42 });
    const findPath = vi.spyOn(world.nav, 'findPath');
    run(world, 1);
    expect(findPath).not.toHaveBeenCalled();
    let most = 0;
    for (let t = 0; t < 60; t++) {
      const before = findPath.mock.calls.length;
      movementSystem(world, DT);
      most = Math.max(most, findPath.mock.calls.length - before);
    }
    expect(findPath.mock.calls.length).toBeGreaterThanOrEqual(units.length);
    expect(most).toBeLessThanOrEqual(3);
    run(world, 35);
    for (const u of units) expect(u.state).toBe('idle');
  });

  it('keeps movement plus separation cheap for 200 moving units', () => {
    const world = worldOn();
    const units = Array.from({ length: 200 }, (_, i) => world.spawnUnit('hoplite', { x: 10 + i % 20 * 0.65, z: 30 + Math.floor(i / 20) * 0.65 }));
    orderMove(world, units.map((u) => u.id), { x: 150, z: 45 });
    run(world, 1); // warm up; excludes path planning and world/fog systems from the timing
    const start = performance.now();
    for (let i = 0; i < 200; i++) movementSystem(world, DT);
    const ms = (performance.now() - start) / 200;
    console.info(`movement + separation, 200 units: ${ms.toFixed(3)} ms/tick`);
    expect(units.every((u) => u.path.length > 0)).toBe(true);
    expect(ms).toBeLessThan(12); // generous on CI; desktop target is ~3 ms
  });
});
