import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { TECHS } from '../core/techs';
import {
  GRASS_ONLY, MAP_D, MAP_W,
  type Building, type BuildingKind, type Heightfield, type MapLayout, type PlayerId, type SimEvent, type Unit, type UnitKind, type Vec2,
} from '../core/types';
import { canWork, popCost, trainable, UNITS } from '../core/units';
import { BALANCE } from './balance';
import { deserializeWorld, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { completeResearch } from './systems/research';
import { packTime } from './systems/siege';
import { damageTo, unitAttack, unitMaxHp } from './systems/stats';
import { defaultPlayers, World } from './World';

/**
 * M16-2 siege: the workshop and its ram, catapult and bolt shooter (pop costs, pack/unpack,
 * ram targeting, splash, piercing bolts, techs, saves).
 */

const DT = 1 / BALANCE.tickRate;

function flat(): Heightfield {
  return {
    width: MAP_W,
    depth: MAP_D,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= MAP_W && z <= MAP_D,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

/** Two players, Town Centers in far corners, no starting units; both in the City Age. */
function arena(): World {
  const layout: MapLayout = {
    townCenter: { x: 6, z: 6 },
    villagers: [],
    scouts: [],
    extraStarts: [{ townCenter: { x: MAP_W - 6, z: MAP_D - 6 }, villagers: [], scouts: [] }],
    nodes: [],
    props: [],
  };
  const w = new World(flat(), layout, defaultPlayers(2));
  w.seed = 1;
  for (const p of [1, 2]) w.players.get(p)!.age = 2;
  // Everything visible: these tests are about siege, not scouting.
  for (const p of [1, 2]) w.visibilityOf(p).state.fill(2);
  return w;
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

function spawn(world: World, kind: UnitKind, owner: PlayerId, x: number, z: number, stance: Unit['stance'] = 'aggressive'): Unit {
  const u = world.spawnUnit(kind, { x, z }, owner);
  u.stance = stance;
  return u;
}

function events<T extends SimEvent['type']>(world: World, type: T): Extract<SimEvent, { type: T }>[] {
  const out: Extract<SimEvent, { type: T }>[] = [];
  world.events.on(type, (e) => out.push(e as Extract<SimEvent, { type: T }>));
  return out;
}

describe('siege workshop', () => {
  it('trains the ram, catapult and bolt shooter, from the City Age only', () => {
    expect(trainable('siegeWorkshop')).toEqual(['ram', 'catapult', 'boltShooter']);
    expect(BUILDINGS.siegeWorkshop.age).toBe(2);
    expect(BUILDINGS.siegeWorkshop.cost.wood).toBeGreaterThan(0);
    expect(BUILDINGS.siegeWorkshop.cost.stone).toBeGreaterThan(0);
    for (const k of ['ram', 'catapult', 'boltShooter'] as UnitKind[]) {
      expect(UNITS[k].unitClass).toBe('siege');
      expect(UNITS[k].age).toBe(2);
      expect(canWork(k)).toBe(false);
    }

    const w = arena();
    const ws = building(w, 'siegeWorkshop', { x: 60, z: 60 });
    Object.assign(w.stockOf(1), { food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    for (let i = 0; i < 4; i++) building(w, 'house', { x: 40 + i * 4, z: 40 });
    const rejected = events(w, 'rejected');
    w.players.get(1)!.age = 1;
    w.dispatch({ type: 'train', buildingId: ws.id, unit: 'ram' });
    expect(rejected.map((e) => e.reason)).toEqual(['age']);
    w.players.get(1)!.age = 2;
    for (const unit of ['ram', 'catapult', 'boltShooter'] as UnitKind[]) w.dispatch({ type: 'train', buildingId: ws.id, unit });
    expect(ws.queueKinds).toEqual(['ram', 'catapult', 'boltShooter']);
    run(w, 30 + 40 + 30 + 1);
    const kinds = [...w.units.values()].filter((u) => u.owner === 1).map((u) => u.kind).sort();
    expect(kinds).toEqual(['boltShooter', 'catapult', 'ram']);
  });

  it('siege takes several population slots: ram 3, catapult 3, bolt shooter 2', () => {
    expect([popCost('ram'), popCost('catapult'), popCost('boltShooter'), popCost('swordsman'), popCost('deer')]).toEqual([3, 3, 2, 1, 0]);
    const w = arena();
    const ws = building(w, 'siegeWorkshop', { x: 60, z: 60 });
    Object.assign(w.stockOf(1), { food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    // Town Center: 5 pop. Three swordsmen leave room for one bolt shooter but not a ram.
    for (let i = 0; i < 3; i++) spawn(w, 'swordsman', 1, 30 + i, 30);
    expect(w.popOf(1)).toBe(3);
    const rejected = events(w, 'rejected');
    w.dispatch({ type: 'train', buildingId: ws.id, unit: 'ram' });
    expect(rejected.map((e) => e.reason)).toEqual(['pop-cap']);
    w.dispatch({ type: 'train', buildingId: ws.id, unit: 'boltShooter' });
    expect(ws.queue).toBe(1);
    // The queued bolt shooter's 2 slots count before it exists: the cap (5) is now full.
    const ws2 = building(w, 'siegeWorkshop', { x: 70, z: 70 });
    w.dispatch({ type: 'train', buildingId: ws2.id, unit: 'boltShooter' });
    expect(rejected.map((e) => e.reason)).toEqual(['pop-cap', 'pop-cap']);
    run(w, 31);
    expect(w.popOf(1)).toBe(5);
    spawn(w, 'ram', 1, 34, 30);
    expect(w.popOf(1)).toBe(8);
  });
});

describe('packing siege', () => {
  it('a catapult unpacks (3 s) before its first shot and cannot move while deployed', () => {
    const w = arena();
    const cat = spawn(w, 'catapult', 1, 60, 60);
    const target = building(w, 'house', { x: 60, z: 72 }, 2);
    const shots = events(w, 'projectile');
    w.dispatch({ type: 'attack', unitIds: [cat.id], targetId: target.id });
    run(w, 0.2);
    expect(cat.state).toBe('unpacking');
    run(w, 2.6);
    expect(shots).toHaveLength(0);
    expect(cat.deployed).toBeUndefined();
    run(w, 0.4);
    expect(cat.deployed).toBe(true);
    expect(shots.length).toBe(1);
    expect(shots[0].kind).toBe('boulder');

    // Ordered to move: packs in place for 3 s, then walks.
    const at = { ...cat.pos };
    w.dispatch({ type: 'move', unitIds: [cat.id], target: { x: 60, z: 40 } });
    run(w, 0.1);
    expect(cat.state).toBe('packing');
    run(w, 2.7);
    expect(cat.pos).toEqual(at);
    run(w, 1);
    expect(cat.deployed).toBeUndefined();
    expect(cat.state).toBe('moving');
    expect(cat.pos.z).toBeLessThan(at.z);
  });

  it('a stop order during a pack keeps the engine deployed; Quick Rigging halves pack time', () => {
    const w = arena();
    const bolt = spawn(w, 'boltShooter', 1, 60, 60);
    bolt.deployed = true;
    w.dispatch({ type: 'move', unitIds: [bolt.id], target: { x: 60, z: 40 } });
    run(w, 1);
    expect(bolt.state).toBe('packing');
    w.dispatch({ type: 'stop', unitIds: [bolt.id] });
    run(w, 0.1);
    expect(bolt.deployed).toBe(true);
    expect(bolt.packTimer).toBeUndefined();
    expect(bolt.state).toBe('idle');

    expect(packTime(w, 1, 'catapult')).toBe(3);
    completeResearch(w, 1, 'quickRigging');
    expect(packTime(w, 1, 'catapult')).toBe(1.5);
    w.dispatch({ type: 'move', unitIds: [bolt.id], target: { x: 60, z: 40 } });
    run(w, 1.4);
    expect(bolt.state).toBe('packing');
    run(w, 0.3);
    expect(bolt.state).toBe('moving');
  });

  it('a catapult will not shoot inside its minimum range', () => {
    const w = arena();
    const cat = spawn(w, 'catapult', 1, 60, 60, 'standGround');
    cat.deployed = true;
    const foe = spawn(w, 'swordsman', 2, 60, 63, 'passive');
    const shots = events(w, 'projectile');
    run(w, 3);
    expect(shots).toHaveLength(0);
    // Out past the minimum range (and inside the catapult's own sight) it fires.
    foe.pos = { x: 60, z: 68 };
    foe.prevPos = { ...foe.pos };
    run(w, 3);
    expect(shots.length).toBeGreaterThan(0);
  });
});

describe('the ram', () => {
  it('only attacks buildings and siege: orders on soldiers are rejected and it ignores them', () => {
    const w = arena();
    const ram = spawn(w, 'ram', 1, 60, 60);
    const sw = spawn(w, 'swordsman', 2, 61.5, 60, 'passive');
    const rejected = events(w, 'rejected');
    w.dispatch({ type: 'attack', unitIds: [ram.id], targetId: sw.id });
    expect(rejected.map((e) => e.reason)).toEqual(['invalid-target']);
    // Idle and aggressive beside an enemy soldier: it doesn't engage, even when hit.
    run(w, 2);
    expect(ram.state).toBe('idle');
    sw.stance = 'aggressive';
    run(w, 4);
    expect(ram.target).toBeNull();
    expect(ram.hp).toBeLessThan(ram.maxHp);

    // A mixed selection: the ram ignores the order, the swordsman takes it.
    const mine = spawn(w, 'swordsman', 1, 59, 62);
    w.dispatch({ type: 'attack', unitIds: [ram.id, mine.id], targetId: sw.id });
    expect(mine.target).toBe(sw.id);
    expect(ram.target).toBeNull();

    // It does go for an enemy catapult and enemy buildings.
    const cat = spawn(w, 'catapult', 2, 64, 60, 'passive');
    w.dispatch({ type: 'attack', unitIds: [ram.id], targetId: cat.id });
    expect(ram.target).toBe(cat.id);
    expect(damageTo('ram', cat)).toBe(50 - 4);
  });

  it('3 rams destroy a stone wall segment in under 20 s; 10 swordsmen need over 60 s', () => {
    const w = arena();
    const wall = building(w, 'stoneWall', { x: 60, z: 60 });
    const rams = [0, 1, 2].map((i) => spawn(w, 'ram', 2, 62.5, 59 + i * 1.5));
    w.dispatch({ type: 'attack', unitIds: rams.map((r) => r.id), targetId: wall.id }, 2);
    const t = run(w, 30, () => !w.buildings.has(wall.id));
    console.log(`3 rams: stone wall down in ${t.toFixed(1)}s`);
    expect(w.buildings.has(wall.id)).toBe(false);
    expect(t).toBeLessThan(20);

    const w2 = arena();
    const wall2 = building(w2, 'stoneWall', { x: 60, z: 60 });
    const sw = Array.from({ length: 10 }, (_, i) => spawn(w2, 'swordsman', 2, 62 + (i % 2) * 0.8, 57 + (i >> 1) * 1.2));
    w2.dispatch({ type: 'attack', unitIds: sw.map((u) => u.id), targetId: wall2.id }, 2);
    run(w2, 60);
    expect(w2.buildings.has(wall2.id)).toBe(true);
  });
});

describe('counters', () => {
  it('cavalry and melee infantry get a bonus against siege; arrows barely scratch a ram', () => {
    const w = arena();
    const ram = spawn(w, 'ram', 2, 60, 60);
    for (const k of ['swordsman', 'hoplite', 'legionary', 'raider', 'phalangiteGuard', 'horseman', 'scout'] as UnitKind[]) {
      expect(UNITS[k].bonus.siege, k).toBeGreaterThan(0);
      expect(damageTo(k, ram), k).toBeGreaterThanOrEqual(UNITS[k].bonus.siege! + 1);
    }
    expect(damageTo('archer', ram)).toBe(1);
    // Ten swordsmen make short work of an unescorted ram.
    const sw = Array.from({ length: 10 }, (_, i) => spawn(w, 'swordsman', 1, 58 + (i % 3), 57 + (i / 3 | 0)));
    w.dispatch({ type: 'attack', unitIds: sw.map((u) => u.id), targetId: ram.id });
    const t = run(w, 30, () => !w.units.has(ram.id));
    expect(w.units.has(ram.id)).toBe(false);
    expect(t).toBeLessThan(10);
  });
});

describe('siege shots', () => {
  it('a boulder splashes everyone near the impact, own units included, with falloff', () => {
    const w = arena();
    const cat = spawn(w, 'catapult', 1, 60, 50, 'passive');
    cat.deployed = true;
    const foe = spawn(w, 'swordsman', 2, 60, 64, 'passive');
    const own = spawn(w, 'swordsman', 1, 61.2, 64, 'passive');
    const far = spawn(w, 'swordsman', 2, 66, 64, 'passive');
    w.dispatch({ type: 'attack', unitIds: [cat.id], targetId: foe.id });
    run(w, 2);
    const foeLoss = foe.maxHp - foe.hp;
    const ownLoss = own.maxHp - own.hp;
    expect(foeLoss).toBe(damageTo('catapult', foe));
    expect(ownLoss).toBeGreaterThan(0);
    expect(ownLoss).toBeLessThan(foeLoss);
    expect(far.hp).toBe(far.maxHp);
  });

  it('a bolt pierces a line of enemies, up to 3, nearest first', () => {
    const w = arena();
    const bolt = spawn(w, 'boltShooter', 1, 60, 50, 'passive');
    bolt.deployed = true;
    // Five enemies in a file straight down the line of fire; the shooter aims at the second.
    const file = [56, 58, 60, 62, 64].map((z) => spawn(w, 'swordsman', 2, 60, z, 'passive'));
    w.dispatch({ type: 'attack', unitIds: [bolt.id], targetId: file[1].id });
    run(w, 2);
    const hurt = file.map((u) => u.maxHp - u.hp);
    const one = damageTo('boltShooter', file[0]);
    expect(hurt).toEqual([one, one, one, 0, 0]);
    // An enemy off to the side is untouched.
    const side = spawn(w, 'swordsman', 2, 64, 57, 'passive');
    run(w, 4.1);
    expect(side.hp).toBe(side.maxHp);
  });
});

describe('siege techs', () => {
  it('Torsion Springs +20% attack, Reinforced Frames +20% HP, at the workshop in the City Age', () => {
    for (const t of ['torsionSprings', 'reinforcedFrames', 'quickRigging'] as const) {
      expect(TECHS[t].at).toBe('siegeWorkshop');
      expect(TECHS[t].age).toBe(2);
    }
    const w = arena();
    completeResearch(w, 1, 'torsionSprings');
    expect(unitAttack(w, 1, 'ram').crush).toBeCloseTo(60);
    expect(unitAttack(w, 1, 'boltShooter').pierce).toBeCloseTo(30);
    expect(unitAttack(w, 1, 'swordsman').crush).toBe(2);
    completeResearch(w, 1, 'reinforcedFrames');
    expect(unitMaxHp(w, 1, 'ram')).toBe(420);
    expect(unitMaxHp(w, 1, 'swordsman')).toBe(UNITS.swordsman.hp);
  });
});

describe('siege saves and determinism', () => {
  it('pack state survives a save; corrupt pack state is rejected; versions 2-8 load', () => {
    const w = arena();
    const cat = spawn(w, 'catapult', 1, 60, 60);
    const bolt = spawn(w, 'boltShooter', 1, 64, 60);
    bolt.deployed = true;
    const house = building(w, 'house', { x: 60, z: 72 }, 2);
    w.dispatch({ type: 'attack', unitIds: [cat.id], targetId: house.id });
    w.dispatch({ type: 'move', unitIds: [bolt.id], target: { x: 64, z: 40 } });
    run(w, 1);
    expect(cat.state).toBe('unpacking');
    expect(bolt.state).toBe('packing');
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    const restored = deserializeWorld(data, flat());
    const rc = restored.units.get(cat.id)!;
    expect(rc.state).toBe('unpacking');
    expect(rc.packTimer).toBeCloseTo(cat.packTimer!);
    // Both continue identically.
    run(w, 5);
    run(restored, 5);
    expect(JSON.stringify(serializeWorld(restored))).toBe(JSON.stringify(serializeWorld(w)));

    const bad = JSON.parse(JSON.stringify(data));
    bad.units.find((u: Unit) => u.id === cat.id).packTimer = -1;
    expect(() => deserializeWorld(bad, flat())).toThrow('siege pack state');
    const sw = w.spawnUnit('swordsman', { x: 30, z: 30 }, 1);
    const withSw = JSON.parse(JSON.stringify(serializeWorld(w)));
    withSw.units.find((u: Unit) => u.id === sw.id).deployed = true;
    expect(() => deserializeWorld(withSw, flat())).toThrow('siege pack state');

    // Every pre-siege version (v2 research .. v8 wonders) still loads.
    const plain = arena();
    spawn(plain, 'swordsman', 1, 30, 30);
    for (const version of [2, 3, 4, 5, 6, 7, 8]) {
      const old = JSON.parse(JSON.stringify(serializeWorld(plain)));
      old.version = version;
      expect(deserializeWorld(old, flat()).popOf(1)).toBe(1);
    }
  }, 30_000);

  it('a siege battle is deterministic', () => {
    const battle = () => {
      const w = arena();
      building(w, 'stoneWall', { x: 60, z: 66 }, 2);
      spawn(w, 'ram', 1, 60, 62);
      const cat = spawn(w, 'catapult', 1, 52, 50);
      const bolt = spawn(w, 'boltShooter', 1, 68, 50);
      for (let i = 0; i < 6; i++) spawn(w, i % 2 ? 'swordsman' : 'horseman', 2, 56 + i * 1.5, 72);
      for (const u of [cat, bolt]) w.dispatch({ type: 'attackMove', unitIds: [u.id], target: { x: 60, z: 80 } });
      run(w, 25);
      return JSON.stringify(serializeWorld(w));
    };
    expect(battle()).toBe(battle());
  });
});
