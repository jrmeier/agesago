import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type FormationKind, type Heightfield, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { defaultFormation, UNITS } from '../core/units';
import { validCommand } from '../network/protocol';
import { defaultPlayers, World } from './World';
import { formationLayout, formationSlots, movementSystem, orderMove } from './systems/movement';
import { orderAttackMove } from './systems/combat';

const DT = 0.05;
function field(): Heightfield {
  return { width: 176, depth: 176, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < 176 && z < 176,
    forestDensity: () => 0, ground: () => GRASS_ONLY };
}
function worldOn(hf = field()): World {
  return new World(hf, { townCenter: { x: 170, z: 170 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 170, z: 6 }, villagers: [], scouts: [] }] }, defaultPlayers(2));
}
function squad(world: World, kinds: UnitKind[], at: Vec2, owner = 1): Unit[] {
  return kinds.map((kind, i) => world.spawnUnit(kind, { x: at.x + (i % 8) * 1.2, z: at.z + Math.floor(i / 8) * 1.2 }, owner));
}
const mix = (n: number): UnitKind[] => Array.from({ length: n }, (_, i) => (['hoplite', 'archer', 'horseman', 'swordsman', 'slinger'] as UnitKind[])[i % 5]);
/** Local frame of `p` relative to `target` for travel along +x: [lateral (right = -z), ahead]. */
const frame = (p: Vec2, target: Vec2) => ({ lateral: -(p.z - target.z), ahead: p.x - target.x });

describe('formation slots', () => {
  const kinds: FormationKind[] = ['none', 'line', 'column', 'box'];
  for (const formation of kinds) {
    it.each([1, 5, 20, 50])(`${formation}: %i units get distinct free slots near the target`, (n) => {
      const world = worldOn();
      const units = squad(world, mix(n), { x: 20, z: 80 });
      const target = { x: 100, z: 84 };
      const slots = formationSlots(world.nav, units, target, formation) as Vec2[];
      expect(slots.every(Boolean)).toBe(true);
      if (n === 1) { expect(slots[0]).toEqual(target); return; }
      expect(new Set(slots.map((p) => `${p.x},${p.z}`)).size).toBe(n);
      for (const p of slots) {
        expect(world.nav.isFree(p)).toBe(true);
        expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(4 + n);
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThan(0.75);
      }
      const local = slots.map((p) => frame(p, target));
      const width = Math.max(...local.map((p) => p.lateral)) - Math.min(...local.map((p) => p.lateral));
      const depth = Math.max(...local.map((p) => p.ahead)) - Math.min(...local.map((p) => p.ahead));
      const layout = formationLayout(units, formation);
      expect(layout.length).toBe(n);
      if (formation === 'line') {
        expect(new Set(layout.filter((s) => s.role !== 'cavalry').map((s) => s.ahead)).size).toBeLessThanOrEqual(n >= 20 ? 4 : 2);
        expect(width).toBeGreaterThanOrEqual(depth);
      }
      if (formation === 'column') {
        const lat = layout.map((s) => s.lateral);
        expect(Math.max(...lat) - Math.min(...lat)).toBeLessThanOrEqual(2);
        if (n >= 5) expect(depth).toBeGreaterThan(width);
      }
      if (formation === 'box' && n >= 20) {
        // Hollow: nothing inside the perimeter ring.
        const lat = layout.map((s) => s.lateral), ahead = layout.map((s) => s.ahead);
        const inside = layout.filter((s) => s.lateral > Math.min(...lat) && s.lateral < Math.max(...lat)
          && s.ahead > Math.min(...ahead) && s.ahead < Math.max(...ahead));
        expect(inside).toEqual([]);
      }
    });
  }

  it('line: melee in front, ranged behind, cavalry on both flanks, for any selection order', () => {
    const world = worldOn();
    const kinds: UnitKind[] = ['archer', 'horseman', 'hoplite', 'slinger', 'horseman', 'swordsman', 'archer', 'hoplite', 'scout', 'swordsman'];
    for (const order of [kinds, [...kinds].reverse()]) {
      world.units.clear();
      const units = squad(world, order, { x: 20, z: 80 });
      const target = { x: 100, z: 84 };
      const slots = formationSlots(world.nav, units, target, 'line') as Vec2[];
      const of = (cls: string) => units.flatMap((u, i) => UNITS[u.kind].unitClass === cls ? [frame(slots[i], target)] : []);
      const infantry = of('infantry'), archers = of('archer'), cavalry = of('cavalry');
      expect(Math.min(...infantry.map((p) => p.ahead))).toBeGreaterThan(Math.max(...archers.map((p) => p.ahead)));
      const left = Math.min(...infantry.map((p) => p.lateral)), right = Math.max(...infantry.map((p) => p.lateral));
      expect(cavalry.length).toBe(3);
      expect(cavalry.filter((p) => p.lateral < left).length).toBe(2);
      expect(cavalry.filter((p) => p.lateral > right).length).toBe(1);
      // Wings stand level with the melee ranks (within one nav cell of snapping), not behind the archers.
      expect(Math.min(...cavalry.map((p) => p.ahead))).toBeGreaterThanOrEqual(Math.min(...infantry.map((p) => p.ahead)) - 0.5);
    }
  });

  it('is deterministic: the same group and order give the same slots', () => {
    const plan = () => {
      const world = worldOn();
      const units = squad(world, mix(37), { x: 20, z: 80 });
      return ['line', 'column', 'box', 'none'].map((f) => formationSlots(world.nav, units, { x: 90, z: 40 }, f as FormationKind));
    };
    expect(plan()).toEqual(plan());
  });

  it('defaults to line for soldiers only and none for villagers or single units', () => {
    expect(defaultFormation(['hoplite', 'archer', 'horseman'])).toBe('line');
    expect(defaultFormation(['hoplite', 'villager'])).toBe('none');
    expect(defaultFormation(['hoplite'])).toBe('none');
    expect(defaultFormation(['trireme', 'trireme'])).toBe('none');
  });

  it('validates formation and facing on network commands', () => {
    const base = { type: 'move', unitIds: [1, 2], target: { x: 1, z: 2 } };
    expect(validCommand({ ...base, formation: 'box', facing: 1.5 })).toBe(true);
    expect(validCommand({ ...base, type: 'attackMove', formation: 'column' })).toBe(true);
    expect(validCommand({ ...base, formation: 'wedge' })).toBe(false);
    expect(validCommand({ ...base, facing: Number.NaN })).toBe(false);
    expect(validCommand({ ...base, facing: '1' })).toBe(false);
  });
});

describe('formation movement', () => {
  function arrivals(world: World, units: Unit[], seconds: number): Map<number, number> {
    const at = new Map<number, number>();
    for (let t = 0; t < seconds / DT && at.size < units.length; t++) {
      for (const u of movementSystem(world, DT)) if (!at.has(u.id)) at.set(u.id, t * DT);
    }
    return at;
  }

  it('mixed infantry and cavalry share the slowest speed and arrive within 1 s of each other', () => {
    const world = worldOn();
    const units = squad(world, ['hoplite', 'horseman', 'swordsman', 'horseman', 'archer', 'scout', 'hoplite', 'horseman', 'slinger', 'hoplite'], { x: 20, z: 80 });
    orderMove(world, units.map((u) => u.id), { x: 110, z: 82 }, { formation: 'line' });
    const cap = Math.min(...units.map((u) => UNITS[u.kind].speed));
    for (const u of units) {
      expect(u.formation?.id).toBe(Math.min(...units.map((v) => v.id)));
      expect(u.formation!.speed!).toBeLessThanOrEqual(cap);
    }
    expect(Math.max(...units.map((u) => u.formation!.speed!))).toBe(cap);
    const at = arrivals(world, units, 90);
    expect(at.size).toBe(units.length);
    const times = [...at.values()];
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(1);
    for (const u of units) expect(u.formation).toBeUndefined();
  });

  it("'none' keeps each unit's own speed", () => {
    const world = worldOn();
    const [slow, fast] = squad(world, ['hoplite', 'horseman'], { x: 20, z: 80 });
    orderMove(world, [slow.id, fast.id], { x: 110, z: 80 }, { formation: 'none' });
    expect(slow.formation?.speed).toBeUndefined();
    const x0 = fast.pos.x;
    for (let t = 0; t < 20; t++) movementSystem(world, DT);
    expect(fast.pos.x - x0).toBeGreaterThan(UNITS.hoplite.speed * 1.2);
  });

  it('arrives facing the travel direction, or the facing override', () => {
    const world = worldOn();
    const units = squad(world, mix(12), { x: 40, z: 40 });
    orderMove(world, units.map((u) => u.id), { x: 60, z: 90 }, { formation: 'box' });
    arrivals(world, units, 60);
    const heading = Math.atan2(60 - 43.6, 90 - 40.6);
    for (const u of units) { expect(u.state).toBe('idle'); expect(u.facing).toBeCloseTo(heading, 1); }
    orderMove(world, units.map((u) => u.id), { x: 30, z: 90 }, { formation: 'column', facing: Math.PI / 2 });
    arrivals(world, units, 60);
    for (const u of units) expect(u.facing).toBeCloseTo(Math.PI / 2, 8);
  });

  it('a new order or another system replacing the path clears the formation cap', () => {
    const world = worldOn();
    const [slow, fast] = squad(world, ['hoplite', 'horseman'], { x: 20, z: 80 });
    orderMove(world, [slow.id, fast.id], { x: 110, z: 80 }, { formation: 'line' });
    expect(fast.formation).toBeDefined();
    fast.path = [{ x: 140, z: 120 }];
    movementSystem(world, DT);
    expect(fast.formation).toBeUndefined();
    orderMove(world, [fast.id], { x: 20, z: 20 });
    expect(fast.formation).toBeUndefined();
  });

  it.each(['line', 'column', 'box'] as FormationKind[])('%s: 30 units cross a wood without anyone getting stuck', (formation) => {
    const world = worldOn();
    // Deterministic scatter of tree trunks (one nav cell each) between the group and the target.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 700; i++) {
      const x = 40 + Math.floor(rand() * 100) * 0.5, z = 50 + Math.floor(rand() * 120) * 0.5;
      world.nav.addRect(1000 + i, { x0: x, x1: x + 0.5, z0: z, z1: z + 0.5 });
    }
    const units = squad(world, mix(30), { x: 15, z: 70 });
    const target = { x: 100, z: 80 };
    orderMove(world, units.map((u) => u.id), target, { formation });
    expect(units.every((u) => u.path.length > 0)).toBe(true);
    const at = arrivals(world, units, 120);
    expect(at.size).toBe(units.length);
    for (const u of units) {
      expect(world.nav.isFree(u.pos)).toBe(true);
      expect(Math.hypot(u.pos.x - target.x, u.pos.z - target.z)).toBeLessThan(15);
    }
  });

  it('attack-move marches in formation and combat breaks it', () => {
    const world = worldOn();
    const units = squad(world, ['hoplite', 'horseman', 'swordsman', 'archer'], { x: 20, z: 80 });
    const enemy = world.spawnUnit('hoplite', { x: 60, z: 82 }, 2);
    orderAttackMove(world, units.map((u) => u.id), { x: 110, z: 82 }, { formation: 'line' });
    expect(units.every((u) => u.formation!.speed! <= UNITS.hoplite.speed)).toBe(true);
    for (let t = 0; t < 400 && !units.some((u) => u.target === enemy.id); t++) world.tick(DT);
    const fighting = units.filter((u) => u.target === enemy.id);
    expect(fighting.length).toBeGreaterThan(0);
    for (const u of fighting) expect(u.formation).toBeUndefined();
  });
});

describe('formation planning cost', () => {
  it('plans a 200-unit line move cheaply', () => {
    const world = worldOn();
    const units = Array.from({ length: 200 }, (_, i) => world.spawnUnit(mix(200)[i], { x: 10 + i % 20 * 0.65, z: 30 + Math.floor(i / 20) * 0.65 }));
    const ids = units.map((u) => u.id);
    orderMove(world, ids, { x: 150, z: 45 }, { formation: 'line' }); // warm up
    const start = performance.now();
    for (let i = 0; i < 5; i++) orderMove(world, ids, { x: 150 - i, z: 45 + i }, { formation: 'line' });
    const ms = (performance.now() - start) / 5;
    console.info(`orderMove plan, 200 units (line): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(250);
  });
});
