import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type PlayerId, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { isAnimal, rawDamage, UNIT_CRUSH_ARMOR, UNITS, type DamageTypes } from '../core/units';
import type { TechId } from '../core/techs';
import { BALANCE } from './balance';
import { completeBuilding, layFoundation } from './systems/build';
import { completeResearch } from './systems/research';
import { armorOf, damageTo, unitAttack } from './systems/stats';
import { defaultPlayers, World } from './World';

/**
 * M16-1: crush damage. Swords and arrows barely scratch buildings; crush (siege, plus the small
 * crush every soldier and villager carries) pulls them down. Unit-vs-unit fights are unchanged.
 */

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

function run(world: World, seconds: number, until?: () => boolean): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.tick(DT);
    if (until?.()) return (i + 1) * DT;
  }
  return seconds;
}

function building(world: World, kind: BuildingKind, pos: Vec2, owner: PlayerId = 1): Building {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  return b;
}

function squad(world: World, kind: UnitKind, owner: PlayerId, x: number, z: number, n: number): Unit[] {
  return Array.from({ length: n }, (_, i) => world.spawnUnit(kind, { x, z: z + (i - (n - 1) / 2) * 1.2 }, owner));
}

/** Seconds for `n` attackers striking together to destroy a full-hp `kind` with blows of `dmg` every `reload` s. */
function timeToKill(hp: number, dmg: number, reload: number, n: number): number {
  return Math.ceil(hp / (n * dmg)) * reload;
}

/** Seconds for 10 of `attacker` to destroy a fresh `kind` building (no research). */
function buildingTtk(attacker: UnitKind, kind: BuildingKind, n = 10): number {
  const b = { kind, owner: 1 } as Building;
  return timeToKill(BUILDINGS[kind].hp, damageTo(attacker, b), UNITS[attacker].reload, n);
}

/** The melee + pierce formula from before crush existed (min 1, plus class bonus). */
function legacyDamage(attacker: UnitKind, target: UnitKind, atk = UNITS[attacker].attack, arm: DamageTypes = UNITS[target].armor): number {
  const base = Math.max(0, atk.melee - arm.melee) + Math.max(0, atk.pierce - arm.pierce);
  return Math.max(1, base) + (UNITS[attacker].bonus[UNITS[target].unitClass] ?? 0);
}

const FIGHTERS = (Object.keys(UNITS) as UnitKind[]).filter((k) => {
  const a = UNITS[k].attack;
  return a.melee + a.pierce > 0;
});
const TARGETS = (Object.keys(UNITS) as UnitKind[]).filter((k) => !isAnimal(k) || k === 'boar');

describe('crush damage: units fight exactly as before', () => {
  it('every attacker × unit pair deals the pre-crush damage (base tables)', () => {
    const world = arena();
    for (const t of TARGETS) {
      const target = world.spawnUnit(t, { x: 60, z: 60 }, 2);
      for (const a of FIGHTERS) expect(damageTo(a, target), `${a} → ${t}`).toBe(legacyDamage(a, t));
      world.units.delete(target.id);
    }
  });

  it('and with forge and unit-line research on both sides', () => {
    const world = arena();
    for (const p of [1, 2] as PlayerId[]) {
      world.players.get(p)!.age = 3;
      const techs: TechId[] = ['bronzeWeapons', 'ironWeapons', 'linenCorslet', 'bronzeScale', 'fletching', 'paddedJerkin', 'wovenTunics'];
      for (const t of techs) completeResearch(world, p, t);
    }
    for (const t of TARGETS) {
      const target = world.spawnUnit(t, { x: 60, z: 60 }, 2);
      const arm = armorOf(world, target);
      for (const a of FIGHTERS) {
        const want = legacyDamage(a, t, unitAttack(world, 1, a), arm);
        expect(damageTo(a, target, world, 1), `${a} → ${t}`).toBe(want);
      }
      world.units.delete(target.id);
    }
  });

  it('keeps the time-to-kill table from before crush (seconds, one on one)', () => {
    // Values recorded on main before M16-1: ceil(hp / damage) × reload.
    const table: [UnitKind, UnitKind, number][] = [
      ['swordsman', 'hoplite', 16],
      ['hoplite', 'horseman', 14],
      ['horseman', 'archer', 5.7],
      ['archer', 'swordsman', 40],
      ['slinger', 'swordsman', 20],
      ['villager', 'villager', 18],
      ['legionary', 'raider', 16],
      ['phalangiteGuard', 'horseman', 12],
    ];
    const world = arena();
    for (const [a, t, secs] of table) {
      const target = world.spawnUnit(t, { x: 60, z: 60 }, 2);
      const ttk = timeToKill(UNITS[t].hp, damageTo(a, target), UNITS[a].reload, 1);
      expect(ttk, `${a} → ${t}`).toBeCloseTo(secs, 5);
      world.units.delete(target.id);
    }
  });

  it('simulated skirmishes end the same way (within 1%)', () => {
    // [attackers, defenders, seconds until one side is gone, surviving hp] recorded on main before M16-1 (after M15-1 veterancy).
    const cases: [UnitKind, UnitKind, number, number][] = [
      ['swordsman', 'hoplite', SKIRMISH.swordVsHoplite[0], SKIRMISH.swordVsHoplite[1]],
      ['horseman', 'archer', SKIRMISH.horseVsArcher[0], SKIRMISH.horseVsArcher[1]],
      ['hoplite', 'horseman', SKIRMISH.hopliteVsHorse[0], SKIRMISH.hopliteVsHorse[1]],
    ];
    for (const [a, b, secs, hp] of cases) {
      const [t, left] = skirmish(a, b);
      expect(Math.abs(t - secs) / secs, `${a} vs ${b} time ${t}`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(left - hp) / Math.max(1, hp), `${a} vs ${b} hp ${left}`).toBeLessThanOrEqual(0.01);
    }
  });
});

/** Baseline skirmish results (5 v 5 standing 8 apart, both sides ordered to attack). */
const SKIRMISH = {
  swordVsHoplite: [18.3, 180],
  horseVsArcher: [6.6, 478],
  hopliteVsHorse: [23.15, 122],
};

/** 5 `a` vs 5 `b`: seconds until one side is wiped out, and the winners' total hp. */
function skirmish(a: UnitKind, b: UnitKind): [number, number] {
  const world = arena();
  const left = squad(world, a, 1, 56, 60, 5);
  const right = squad(world, b, 2, 64, 60, 5);
  const alive = (l: Unit[]) => l.filter((u) => world.units.has(u.id));
  world.dispatch({ type: 'attack', unitIds: left.map((u) => u.id), targetId: right[2].id }, 1);
  world.dispatch({ type: 'attack', unitIds: right.map((u) => u.id), targetId: left[2].id }, 2);
  const t = run(world, 180, () => alive(left).length === 0 || alive(right).length === 0);
  const hp = [...alive(left), ...alive(right)].reduce((s, u) => s + u.hp, 0);
  return [t, hp];
}

describe('crush damage: buildings need siege to fall', () => {
  it('soldiers and warships carry a little crush; ranged units none', () => {
    const c = (k: UnitKind) => UNITS[k].attack.crush ?? 0;
    for (const k of ['hoplite', 'swordsman', 'legionary', 'raider', 'phalangiteGuard', 'trireme'] as UnitKind[]) expect(c(k)).toBe(2);
    for (const k of ['horseman', 'scout', 'villager'] as UnitKind[]) expect(c(k)).toBe(1);
    for (const k of ['archer', 'slinger', 'immortal'] as UnitKind[]) expect(c(k)).toBe(0);
    // Default unit crush armour soaks the soldiers' crush, so only siege crushes units.
    for (const k of FIGHTERS) expect(c(k)).toBeLessThanOrEqual(UNIT_CRUSH_ARMOR);
  });

  it('10 swordsmen: stone wall > 60 s, Town Center > 3 min, house < 40 s', () => {
    const wall = buildingTtk('swordsman', 'stoneWall');
    const tc = buildingTtk('swordsman', 'townCenter');
    const house = buildingTtk('swordsman', 'house');
    console.log(`10 swordsmen: stone wall ${wall}s, Town Center ${tc}s, house ${house}s`);
    expect(wall).toBeGreaterThan(60);
    expect(tc).toBeGreaterThan(180);
    expect(house).toBeLessThan(40);
    // Walls, towers and the Town Center shrug off swords better than a house does.
    for (const k of ['stoneWall', 'watchTower', 'townCenter', 'gate'] as BuildingKind[]) {
      expect(buildingTtk('swordsman', k)).toBeGreaterThan(60);
    }
  });

  it('arrows do the minimum to every building', () => {
    for (const k of Object.keys(BUILDINGS) as BuildingKind[]) {
      const b = { kind: k, owner: 1 } as Building;
      expect(damageTo('archer', b), k).toBe(1);
      expect(damageTo('slinger', b), k).toBe(1);
    }
  });

  it('undefended buildings still fall slowly to villagers and cavalry', () => {
    expect(buildingTtk('villager', 'house')).toBeLessThan(120);
    expect(buildingTtk('horseman', 'house')).toBeLessThan(60);
    expect(Number.isFinite(buildingTtk('villager', 'townCenter'))).toBe(true);
  });

  it('a crush-50 siege engine tears buildings down fast (formula check ahead of M16-2)', () => {
    const ram: DamageTypes = { melee: 0, pierce: 0, crush: 50 };
    const hit = (k: BuildingKind) => Math.max(1, rawDamage(ram, armorOf(undefined, { kind: k, owner: 1 } as Building)));
    // 4 rams striking every 2.5 s.
    const ttk = (k: BuildingKind) => timeToKill(BUILDINGS[k].hp, hit(k), 2.5, 4);
    console.log(`4 crush-50 rams: stone wall ${ttk('stoneWall')}s, Town Center ${ttk('townCenter')}s`);
    expect(ttk('stoneWall')).toBeLessThan(buildingTtk('swordsman', 'stoneWall') / 5);
    expect(ttk('townCenter')).toBeLessThan(40);
    // Against units, crush 50 less the default crush armour.
    expect(rawDamage(ram, { melee: 0, pierce: 0, crush: UNIT_CRUSH_ARMOR })).toBe(50 - UNIT_CRUSH_ARMOR);
  });

  it('Masonry, Architecture and Fortified Walls add crush armour', () => {
    const world = arena();
    world.players.get(1)!.age = 3;
    const wall = building(world, 'stoneWall', { x: 50, z: 50 });
    const house = building(world, 'house', { x: 60, z: 50 });
    expect(armorOf(world, wall).crush).toBe(0);
    completeResearch(world, 1, 'masonry');
    expect(armorOf(world, house).crush).toBe(1);
    completeResearch(world, 1, 'architecture');
    expect(armorOf(world, house).crush).toBe(2);
    completeResearch(world, 1, 'fortifiedWalls');
    expect(armorOf(world, wall).crush).toBe(4);
    expect(armorOf(world, house).crush).toBe(2);
    // Fully upgraded walls cannot be hurt by a soldier's crush at all: swords do the minimum.
    expect(damageTo('swordsman', wall, world, 2)).toBe(1);
  });

  it('in the sim: 10 swordsmen raze a house in under 40 s but a stone wall stands after 60 s', () => {
    const world = arena();
    const house = building(world, 'house', { x: 60, z: 60 });
    const sw = squad(world, 'swordsman', 2, 64, 60, 10);
    world.dispatch({ type: 'attack', unitIds: sw.map((u) => u.id), targetId: house.id }, 2);
    const t = run(world, 60, () => !world.buildings.has(house.id));
    expect(world.buildings.has(house.id)).toBe(false);
    expect(t).toBeLessThan(40);

    const w2 = arena();
    const wall = building(w2, 'stoneWall', { x: 60, z: 60 });
    const sw2 = squad(w2, 'swordsman', 2, 63, 60, 10);
    w2.dispatch({ type: 'attack', unitIds: sw2.map((u) => u.id), targetId: wall.id }, 2);
    run(w2, 60);
    expect(w2.buildings.has(wall.id)).toBe(true);
    expect(wall.hp).toBeLessThan(wall.maxHp);
  });
});
