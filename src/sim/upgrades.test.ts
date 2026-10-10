import { describe, expect, it } from 'vitest';
import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import type { TechId } from '../core/techs';
import {
  GRASS_ONLY,
  type Building,
  type BuildingKind,
  type Heightfield,
  type MapLayout,
  type NodeKind,
  type PlayerId,
  type ResourceType,
  type SimEvent,
  type Unit,
  type UnitKind,
  type Vec2,
} from '../core/types';
import { UNITS } from '../core/units';
import { BALANCE } from './balance';
import { completeBuilding, layFoundation } from './systems/build';
import { carryCap } from './systems/gather';
import { completeResearch, statOf } from './systems/research';
import { unitRange, unitSight, unitSpeed } from './systems/stats';
import { AIPlayer } from '../ai/AIPlayer';
import { makeGame, run as runAI } from '../ai/harness';
import { EXPLORED } from './visibility';
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

/** Two players, Town Centers in far corners, no starting units, player 1's map explored and rich. */
function arena(opts: { w?: number; d?: number; nodes?: MapLayout['nodes']; tc?: Vec2 } = {}): World {
  const w = opts.w ?? 120;
  const d = opts.d ?? 120;
  const layout: MapLayout = {
    townCenter: opts.tc ?? { x: 4, z: 4 },
    villagers: [],
    scouts: [],
    extraStarts: [{ townCenter: { x: w - 4, z: d - 4 }, villagers: [], scouts: [] }],
    nodes: opts.nodes ?? [],
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

function research(world: World, owner: PlayerId, ...techs: TechId[]): void {
  for (const t of techs) completeResearch(world, owner, t);
}

/** A finished building dropped straight in (nav blocked like a real one). */
function building(world: World, kind: BuildingKind, pos: Vec2, owner: PlayerId = 1): Building {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  return b;
}

const alive = (world: World, list: Unit[]) => list.filter((u) => world.units.has(u.id));

// ---- Economy (M8-7 / M8-8) ----

/** 10 villagers working 10 nodes of `kind` in a ring around the Town Center for `seconds`. */
function gathered(kind: NodeKind, techs: TechId[], seconds: number): number {
  const center = { x: 30, z: 30 };
  const nodes = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return { kind, pos: { x: center.x + Math.sin(a) * 4.5, z: center.z + Math.cos(a) * 4.5 }, amount: 5000 };
  });
  const world = arena({ tc: center, nodes });
  research(world, 1, ...techs);
  const type: ResourceType = kind === 'tree' ? 'wood' : kind === 'berry' ? 'food' : (kind as ResourceType);
  const start = world.stock[type];
  const ids = [...world.nodes.keys()];
  ids.forEach((id, i) => {
    const n = world.nodes.get(id)!;
    const a = (i / 10) * Math.PI * 2;
    const v = world.spawnUnit('villager', { x: center.x + Math.sin(a) * 3.6, z: center.z + Math.cos(a) * 3.6 }, 1);
    world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: n.id });
  });
  run(world, seconds);
  return world.stock[type] - start;
}

/** 10 villagers each farming their own field around a granary for `seconds`. */
function farmed(techs: TechId[], seconds: number): number {
  const world = arena({ tc: { x: 100, z: 100 } });
  research(world, 1, ...techs);
  building(world, 'granary', { x: 40, z: 40 });
  const spots = [-10, -5.5, 5.5, 10].flatMap((dx) => [-5, 0, 5].map((dz) => ({ x: 40 + dx, z: 40 + dz })));
  const farms = spots.slice(0, 10).map((p) => building(world, 'farm', p));
  const start = world.stock.food;
  for (const f of farms) {
    const v = world.spawnUnit('villager', { x: f.pos.x, z: f.pos.z + 2.5 }, 1);
    world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: f.id });
  }
  run(world, seconds);
  return world.stock.food - start;
}

describe('economy techs', () => {
  it('Bronze Axe gives at least 14% more wood for 10 villagers over 5 minutes', () => {
    const base = gathered('tree', [], 300);
    const axe = gathered('tree', ['bronzeAxe'], 300);
    expect(axe / base).toBeGreaterThanOrEqual(1.14);
  });

  it('Bronze Picks and Stone Chisels speed up gold and stone the same way', () => {
    expect(gathered('gold', ['bronzePicks'], 300) / gathered('gold', [], 300)).toBeGreaterThanOrEqual(1.14);
    expect(gathered('stone', ['stoneChisels'], 300) / gathered('stone', [], 300)).toBeGreaterThanOrEqual(1.14);
  });

  it('Threshing Floor speeds up berries but not farms', () => {
    expect(gathered('berry', ['threshingFloor'], 300) / gathered('berry', [], 300)).toBeGreaterThanOrEqual(1.14);
    expect(farmed(['threshingFloor'], 120)).toBe(farmed([], 120));
  });

  it('Ox Plough works farms faster', () => {
    expect(farmed(['oxPlough'], 120) / farmed([], 120)).toBeGreaterThanOrEqual(1.09);
  });

  it('farm food upgrades apply to new farms and reseeds', () => {
    const world = arena({ tc: { x: 30, z: 30 } });
    research(world, 1, 'oxPlough');
    const before = building(world, 'farm', { x: 50, z: 50 });
    expect(before.food).toBe(FARM_FOOD + 75);
    research(world, 1, 'ironPloughshare');
    expect(before.food).toBe(FARM_FOOD + 75); // not topped up
    const after = building(world, 'farm', { x: 60, z: 50 });
    expect(after.food).toBe(FARM_FOOD + 200);
    // Reseed a fallow field.
    before.food = 0;
    const v = world.spawnUnit('villager', { x: 50, z: 53 }, 1);
    world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: before.id });
    expect(before.food).toBe(FARM_FOOD + 200);
  });

  it('Woven Tunics raises villager HP, keeping a wounded villager at the same ratio', () => {
    const world = arena();
    const v = world.spawnUnit('villager', { x: 50, z: 50 }, 1);
    v.hp = UNITS.villager.hp / 5; // 20%
    research(world, 1, 'wovenTunics');
    expect(v.maxHp).toBe(UNITS.villager.hp + 15);
    expect(v.hp).toBe(Math.round((UNITS.villager.hp + 15) / 5));
    const fresh = world.spawnUnit('villager', { x: 52, z: 50 }, 1);
    expect(fresh.maxHp).toBe(UNITS.villager.hp + 15);
    expect(fresh.hp).toBe(fresh.maxHp);
    // Another player's villagers are untouched.
    const theirs = world.spawnUnit('villager', { x: 60, z: 50 }, 2);
    expect(theirs.maxHp).toBe(UNITS.villager.hp);
  });

  it('Donkey Packs: villagers carry 3 more and walk 10% faster', () => {
    const world = arena();
    const v = world.spawnUnit('villager', { x: 50, z: 50 }, 1);
    expect(carryCap(world, v, 'wood')).toBe(BALANCE.carryCap);
    research(world, 1, 'donkeyPacks');
    expect(carryCap(world, v, 'wood')).toBe(BALANCE.carryCap + 3);
    expect(unitSpeed(v, world)).toBeCloseTo(UNITS.villager.speed * 1.1);
    // And it really walks faster.
    const w2 = arena();
    const a = w2.spawnUnit('villager', { x: 20, z: 50 }, 1);
    research(w2, 1, 'donkeyPacks');
    const b = w2.spawnUnit('villager', { x: 20, z: 60 }, 2);
    w2.dispatch({ type: 'move', unitIds: [a.id], target: { x: 80, z: 50 } }, 1);
    w2.dispatch({ type: 'move', unitIds: [b.id], target: { x: 80, z: 60 } }, 2);
    run(w2, 10);
    expect((a.pos.x - 20) / (b.pos.x - 20)).toBeCloseTo(1.1, 1);
  });

  it('a villager with Donkey Packs fills up to the bigger load before walking back', () => {
    const nodes = [{ kind: 'tree' as NodeKind, pos: { x: 36, z: 30 }, amount: 500 }];
    const world = arena({ tc: { x: 30, z: 30 }, nodes });
    research(world, 1, 'donkeyPacks');
    const v = world.spawnUnit('villager', { x: 34, z: 30 }, 1);
    world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: [...world.nodes.keys()][0] });
    let max = 0;
    run(world, 60, () => {
      max = Math.max(max, v.carry?.amount ?? 0);
      return false;
    });
    expect(max).toBe(BALANCE.carryCap + 3);
  });

  it('Town Watch: the Town Center sees 4 further', () => {
    const world = arena({ tc: { x: 60, z: 60 } });
    world.players.get(1)!.age = 1;
    const sight = BUILDINGS.townCenter.sight;
    world.visibility.state.fill(0);
    world.updateFog();
    expect(world.visibility.isVisible(60, 60 + sight + 2)).toBe(false);
    research(world, 1, 'townWatch');
    world.updateFog();
    expect(world.visibility.isVisible(60, 60 + sight + 2)).toBe(true);
    expect(statOf(world, 1, { building: 'watchTower' }, 'sight', BUILDINGS.watchTower.sight)).toBe(BUILDINGS.watchTower.sight + 4);
  });

  it('Census trains villagers 10% faster', () => {
    const world = arena({ tc: { x: 30, z: 30 } });
    research(world, 1, 'census');
    const tc = world.townCenterOf(1)!;
    world.dispatch({ type: 'train', buildingId: tc.id });
    run(world, UNITS.villager.trainTime / 1.1 + 0.1);
    expect(tc.queue).toBe(0);
  });
});

// ---- Age gating (M8-6) ----

describe('age gating', () => {
  it('rejects buildings and units from a later age with reason "age"', () => {
    const world = arena({ tc: { x: 30, z: 30 } });
    const log: SimEvent[] = [];
    world.events.on('rejected', (e) => log.push(e));
    const v = world.spawnUnit('villager', { x: 40, z: 40 }, 1);
    const wood = world.stock.wood;
    world.dispatch({ type: 'build', unitIds: [v.id], kind: 'archeryRange', pos: { x: 50, z: 50 }, rot: 0 });
    expect(log.at(-1)).toEqual({ type: 'rejected', reason: 'age' });
    expect(world.stock.wood).toBe(wood);
    world.dispatch({ type: 'buildWall', unitIds: [v.id], kind: 'stoneWall', from: { x: 50, z: 60 }, to: { x: 60, z: 60 } });
    expect(log.at(-1)).toEqual({ type: 'rejected', reason: 'age' });
    const barracks = building(world, 'barracks', { x: 60, z: 40 });
    world.dispatch({ type: 'train', buildingId: barracks.id, unit: 'swordsman' });
    expect(log.at(-1)).toEqual({ type: 'rejected', reason: 'age' });
    expect(barracks.queue).toBe(0);
    world.dispatch({ type: 'train', buildingId: barracks.id, unit: 'hoplite' });
    expect(barracks.queue).toBe(1);
    // Town Age unlocks them.
    world.players.get(1)!.age = 1;
    world.dispatch({ type: 'train', buildingId: barracks.id, unit: 'swordsman' });
    expect(barracks.queue).toBe(2);
    const n = world.buildings.size;
    world.dispatch({ type: 'build', unitIds: [v.id], kind: 'archeryRange', pos: { x: 50, z: 50 }, rot: 0 });
    expect(world.buildings.size).toBe(n + 1);
  });
});

describe('AI and age gating', () => {
  it('an AI never asks for buildings or units beyond its age', () => {
    const world = makeGame(2, ['ai', 'ai']);
    const ais = [1, 2].map((p) => new AIPlayer(world, p, { difficulty: 'hard', seed: p }));
    let ageRejects = 0;
    world.events.on('rejected', (e) => {
      if (e.reason === 'age') ageRejects++;
    });
    runAI(world, ais, 12 * 60);
    expect(ageRejects).toBe(0);
    const kinds = new Set([...world.buildings.values()].filter((b) => b.owner === 1).map((b) => b.kind));
    expect(kinds.has('barracks')).toBe(true);
    // The AI ages up (M8-16): nothing it owns may be from a later age than its own.
    const age = (p: number) => world.players.get(p)?.age ?? 0;
    for (const b of world.buildings.values()) expect(BUILDINGS[b.kind].age ?? 0).toBeLessThanOrEqual(age(b.owner));
    for (const u of world.units.values()) expect(UNITS[u.kind].age ?? 0).toBeLessThanOrEqual(age(u.owner));
    for (const ai of ais) ai.dispose();
  }, 120_000);
});

// ---- Combat: forge, unit lines, academy (M8-9 / M8-10 / M8-13) ----

/** Deterministic jitter for "seeds". */
function rng(seed: number): () => number {
  let s = seed * 2654435761 >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function battle(
  k1: UnitKind,
  t1: TechId[],
  k2: UnitKind,
  t2: TechId[],
  opts: { gap?: number; w?: number; seed?: number; time?: number } = {}
): { won1: boolean; left1: number; left2: number } {
  const w = opts.w ?? 120;
  const world = arena({ w });
  for (const p of [1, 2]) world.players.get(p)!.age = 3;
  research(world, 1, ...t1);
  research(world, 2, ...t2);
  // Seed 0: the exact line-up of combat.test.ts's counter battles; others jitter it.
  const r = opts.seed ? rng(opts.seed) : () => 0.5;
  const gap = opts.gap ?? 5;
  const z = 60;
  const x = w / 2;
  const squad = (kind: UnitKind, owner: PlayerId, cx: number) =>
    Array.from({ length: 5 }, (_, i) => world.spawnUnit(kind, { x: cx + (r() - 0.5) * 0.8, z: z + (i - 2) * 1.2 + (r() - 0.5) * 0.4 }, owner));
  const s1 = squad(k1, 1, x - gap / 2);
  const s2 = squad(k2, 2, x + gap / 2);
  world.updateFog();
  run(world, opts.time ?? 180, () => !alive(world, s1).length || !alive(world, s2).length);
  return { won1: alive(world, s1).length > 0 && !alive(world, s2).length, left1: alive(world, s1).length, left2: alive(world, s2).length };
}

describe('forge', () => {
  it('5 hoplites with Bronze Weapons + Linen Corslet beat 5 plain hoplites in at least 90% of seeds 1–20', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (battle('hoplite', ['bronzeWeapons', 'linenCorslet'], 'hoplite', [], { seed }).won1) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(18);
  });

  it('upgrades raise attack and armour through damage', () => {
    const world = arena();
    for (const p of [1, 2]) world.players.get(p)!.age = 3;
    const a = world.spawnUnit('hoplite', { x: 50, z: 50 }, 1);
    const b = world.spawnUnit('hoplite', { x: 51, z: 50 }, 2);
    world.dispatch({ type: 'stance', unitIds: [b.id], stance: 'passive' }, 2);
    research(world, 1, 'bronzeWeapons');
    research(world, 2, 'linenCorslet');
    // (5 + 1) − (1 + 1) = 4
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: b.id });
    run(world, 0.2);
    expect(b.hp).toBe(UNITS.hoplite.hp - 4);
  });

  it('Fletching extends archer range and stand-ground acquire distance', () => {
    const world = arena();
    world.players.get(1)!.age = 1;
    const a = world.spawnUnit('archer', { x: 50, z: 50 }, 1);
    world.dispatch({ type: 'stance', unitIds: [a.id], stance: 'standGround' });
    world.spawnUnit('scout', { x: 54, z: 50 }, 1); // a spotter
    // Edge distance 7.5: just beyond base range 7, inside 8.
    const e = world.spawnUnit('hoplite', { x: 50 + 7.5 + UNITS.archer.radius + UNITS.hoplite.radius, z: 50 }, 2);
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.updateFog();
    run(world, 1);
    expect(a.state).toBe('idle');
    research(world, 1, 'fletching');
    expect(statOf(world, 1, { unit: 'archer' }, 'range', UNITS.archer.range)).toBe(UNITS.archer.range + 1);
    run(world, 3);
    expect(a.target).toBe(e.id);
    expect(e.hp).toBeLessThan(UNITS.hoplite.hp);
  });

  it('an aggressive archer engages at its full upgraded range, past its sight', () => {
    const world = arena();
    world.players.get(1)!.age = 2;
    const a = world.spawnUnit('archer', { x: 50, z: 50 }, 1);
    world.spawnUnit('scout', { x: 54, z: 50 }, 1); // a spotter
    for (const t of ['fletching', 'barbedPoints', 'compositeArcher'] as const) research(world, 1, t);
    // Edge distance 9.5: beyond sight 8, inside upgraded range 10.
    const e = world.spawnUnit('hoplite', { x: 50 + 9.5 + UNITS.archer.radius + UNITS.hoplite.radius, z: 50 }, 2);
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.updateFog();
    run(world, 3);
    expect(a.target).toBe(e.id);
    expect(e.hp).toBeLessThan(UNITS.hoplite.hp);
  });
});

describe('unit lines', () => {
  it('upgrading keeps every unit at the same HP ratio', () => {
    const world = arena();
    world.players.get(1)!.age = 3;
    const h = world.spawnUnit('hoplite', { x: 50, z: 50 }, 1);
    h.hp = h.maxHp / 2;
    research(world, 1, 'veteranHoplite');
    expect(h.maxHp).toBe(Math.round(UNITS.hoplite.hp * 1.25));
    expect(h.hp / h.maxHp).toBeCloseTo(0.5, 1);
    research(world, 1, 'phalangite');
    expect(h.maxHp).toBe(Math.round(UNITS.hoplite.hp * 1.25 * 1.25));
    expect(h.hp / h.maxHp).toBeCloseTo(0.5, 1);
    expect(world.spawnUnit('hoplite', { x: 52, z: 50 }, 1).hp).toBe(h.maxHp);
  });

  it('counters still hold at upgraded tiers', () => {
    expect(battle('hoplite', ['veteranHoplite'], 'horseman', ['companionCavalry']).won1).toBe(true);
    expect(battle('hoplite', ['veteranHoplite'], 'scout', ['lightCavalry']).won1).toBe(true);
    expect(battle('horseman', ['companionCavalry'], 'archer', ['compositeArcher'], { gap: 7 }).won1).toBe(true);
    // Archers kite: tougher Veteran Hoplites take longer to whittle down, and a straggler that
    // gives up the chase out of sight may survive, but the archers win the exchange outright.
    const kite = battle('archer', ['compositeArcher'], 'hoplite', ['veteranHoplite'], { gap: 7.5, w: 240, time: 400 });
    expect(kite.left1).toBeGreaterThanOrEqual(4);
    expect(kite.left2).toBeLessThanOrEqual(1);
  });
});

describe('academy', () => {
  /** Shots that hit a scout crossing an archer's line of fire, out of `shots`. */
  function hitRate(techs: TechId[]): number {
    let hits = 0;
    let shots = 0;
    for (let trial = 0; trial < 40; trial++) {
      const world = arena();
      for (const p of [1, 2]) world.players.get(p)!.age = 2;
      research(world, 1, ...techs);
      const a = world.spawnUnit('archer', { x: 40, z: 60 }, 1);
      world.dispatch({ type: 'stance', unitIds: [a.id], stance: 'standGround' });
      const range = 4 + (trial % 4) * 0.9;
      const t = world.spawnUnit('scout', { x: 40 + range, z: 40 + (trial % 10) * 0.7 }, 2);
      t.hp = t.maxHp = 10_000;
      world.dispatch({ type: 'stance', unitIds: [t.id], stance: 'passive' }, 2);
      world.dispatch({ type: 'move', unitIds: [t.id], target: { x: 40 + range, z: 110 } }, 2);
      let damaged = 0;
      let fired = 0;
      world.events.on('projectile', () => fired++);
      world.events.on('damaged', (e) => {
        if (e.id === t.id) damaged++;
      });
      run(world, 10);
      hits += damaged;
      shots += fired;
    }
    expect(shots).toBeGreaterThan(20);
    return hits / shots;
  }

  it('Ballistics: archers lead a scout walking in a straight line', () => {
    const without = hitRate([]);
    const withB = hitRate(['ballistics']);
    console.log(`hit rate vs a crossing scout: ${(without * 100).toFixed(0)}% → ${(withB * 100).toFixed(0)}% with Ballistics`);
    expect(without).toBeLessThan(0.5);
    expect(withB).toBeGreaterThan(0.9);
  });

  it('Masonry, Architecture, Treadwheel Crane and Surveying apply through statOf', () => {
    const world = arena();
    world.players.get(1)!.age = 3;
    const house = building(world, 'house', { x: 50, z: 50 });
    house.hp = house.maxHp * 0.75;
    research(world, 1, 'masonry');
    expect(house.maxHp).toBe(Math.round(BUILDINGS.house.hp * 1.1));
    expect(house.hp / house.maxHp).toBeCloseTo(0.75, 2);
    expect(statOf(world, 1, { building: 'house' }, 'armor.pierce', BUILDINGS.house.armor.pierce)).toBe(BUILDINGS.house.armor.pierce + 1);
    research(world, 1, 'architecture');
    expect(house.maxHp).toBe(Math.round(BUILDINGS.house.hp * 1.1 * 1.1));
    expect(statOf(world, 1, { building: 'barracks' }, 'armor.melee', 1)).toBe(3);
    research(world, 1, 'treadwheelCrane', 'surveying');
    expect(statOf(world, 1, { building: 'house' }, 'buildRate', 1)).toBeCloseTo(1.2);
    expect(statOf(world, 1, { building: 'farm' }, 'buildRate', 1)).toBeCloseTo(1.8);
  });

  it('Treadwheel Crane makes construction 20% faster', () => {
    function buildTime(techs: TechId[]): number {
      const world = arena({ tc: { x: 100, z: 100 } });
      world.players.get(1)!.age = 2;
      research(world, 1, ...techs);
      const v = world.spawnUnit('villager', { x: 40, z: 44 }, 1);
      world.dispatch({ type: 'build', unitIds: [v.id], kind: 'house', pos: { x: 40, z: 40 }, rot: 0 });
      const b = [...world.buildings.values()].find((x) => x.kind === 'house')!;
      let t = 0;
      run(world, 60, () => {
        t += DT;
        return b.complete;
      });
      return t;
    }
    const base = buildTime([]);
    const crane = buildTime(['treadwheelCrane']);
    // Walking up takes the same time either way.
    expect(base - crane).toBeCloseTo(BUILDINGS.house.buildTime * (1 - 1 / 1.2), 0);
  });

  it('Machicolations is a no-op: towers already have no minimum range', () => {
    const world = arena();
    world.players.get(1)!.age = 1;
    const tower = building(world, 'watchTower', { x: 50, z: 50 });
    const e = world.spawnUnit('hoplite', { x: 50, z: 51.8 }, 2);
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.updateFog();
    run(world, 3);
    expect(e.hp).toBeLessThan(UNITS.hoplite.hp);
    expect(tower.complete).toBe(true);
  });
});

// ---- Building upgrades (M8-11) ----

describe('building upgrades', () => {
  function volley(techs: TechId[]): number {
    const world = arena();
    world.players.get(1)!.age = 3;
    research(world, 1, ...techs);
    building(world, 'watchTower', { x: 50, z: 50 });
    for (let i = 0; i < 3; i++) {
      const e = world.spawnUnit('hoplite', { x: 54 + i, z: 50 }, 2);
      world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    }
    world.updateFog();
    let n = 0;
    world.events.on('projectile', () => n++);
    run(world, 0.5);
    return n;
  }

  it('Guard Tower fires one more arrow, Fortress Tower one more again', () => {
    const base = volley([]);
    expect(base).toBe(BUILDINGS.watchTower.attack!.arrows);
    expect(volley(['guardTower'])).toBe(base + 1);
    expect(volley(['guardTower', 'fortressTower'])).toBe(base + 2);
  });

  it('Guard Tower: +40% HP on standing towers and +1 range', () => {
    const world = arena();
    world.players.get(1)!.age = 3;
    const t = building(world, 'watchTower', { x: 50, z: 50 });
    research(world, 1, 'guardTower');
    expect(t.maxHp).toBe(Math.round(BUILDINGS.watchTower.hp * 1.4));
    expect(t.hp).toBe(t.maxHp);
    expect(statOf(world, 1, { building: 'watchTower' }, 'range', BUILDINGS.watchTower.attack!.range)).toBe(BUILDINGS.watchTower.attack!.range + 1);
    // A tower founded after the upgrade is built up to the new maximum.
    const site = layFoundation(world, 'watchTower', { x: 60, z: 50 }, 0, 1);
    expect(site.maxHp).toBe(t.maxHp);
  });

  it('Fortified Town Center: +20% HP, +1 arrow and 2 more beds', () => {
    const world = arena({ tc: { x: 30, z: 30 } });
    world.players.get(1)!.age = 3;
    const tc = world.townCenterOf(1)!;
    research(world, 1, 'fortifiedTownCenter');
    expect(tc.maxHp).toBe(Math.round(BUILDINGS.townCenter.hp * 1.2));
    const vs = Array.from({ length: 12 }, (_, i) => world.spawnUnit('villager', { x: 26 + (i % 6), z: 34 + Math.floor(i / 6) }, 1));
    world.dispatch({ type: 'garrison', unitIds: vs.map((v) => v.id), buildingId: tc.id });
    run(world, 10);
    expect(tc.occupants?.length).toBe(12);
  });

  it('Fortified Walls: +60% HP on walls', () => {
    const world = arena();
    world.players.get(1)!.age = 3;
    const wall = building(world, 'palisade', { x: 50, z: 50 });
    research(world, 1, 'fortifiedWalls');
    expect(wall.maxHp).toBe(Math.round(BUILDINGS.palisade.hp * 1.6));
  });
});

// ---- Cost ----

describe('statOf cost', () => {
  it('stat lookups for 200 units stay under 0.1 ms per tick', () => {
    const world = arena();
    research(world, 1, 'bronzeWeapons', 'linenCorslet', 'donkeyPacks', 'bronzeAxe');
    const kinds: UnitKind[] = ['villager', 'hoplite', 'archer', 'horseman'];
    const units = Array.from({ length: 200 }, (_, i) => world.spawnUnit(kinds[i % 4], { x: 10 + (i % 20) * 2, z: 10 + Math.floor(i / 20) * 2 }, 1));
    const lookups = () => {
      let s = 0;
      for (const u of units) {
        s += unitSpeed(u, world);
        s += unitSight(world, u.owner, u.kind);
        s += unitRange(world, u.owner, u.kind);
        s += carryCap(world, u, 'wood');
      }
      return s;
    };
    for (let i = 0; i < 50; i++) lookups();
    // Best of several batches: the machine running the suite may be busy.
    let ms = Infinity;
    for (let batch = 0; batch < 10; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) lookups();
      ms = Math.min(ms, (performance.now() - t0) / 20);
    }
    console.log(`statOf, 200 units × 4 stats: ${ms.toFixed(4)} ms/tick`);
    expect(ms).toBeLessThan(0.1);
  });

  it('statOf without research returns the base value', () => {
    const world = arena();
    expect(statOf(world, 1, { unit: 'hoplite' }, 'hp', 55)).toBe(55);
    expect(statOf(world, 2, 'player', 'tributeFee', 0.3)).toBe(0.3);
  });
});
