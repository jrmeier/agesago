import { describe, expect, it } from 'vitest';
import { AURAS, HERO_AURA_RADIUS } from '../core/auras';
import { CIV_IDS, type CivId } from '../core/civilizations';
import { GRASS_ONLY, type BuildingKind, type Heightfield, type MapLayout, type PlayerId, type RejectReason, type UnitKind, type Vec2 } from '../core/types';
import { canGuard, canPatrol, canRank, canWork, captureRate, CHAMPION_CAPTURE_MUL, CAPTURE_RATE, defaultFormation, HERO_COOLDOWN, heroKindFor, isHero, trainable, UNITS } from '../core/units';
import { auraRingRadius } from '../render/auraRings';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { AURA_PERIOD, activeAuras, auraSystem } from './systems/auras';
import { killUnit } from './systems/combat';
import { orderPriest } from './systems/explorationRewards';
import { heroBlock, heroCooldownLeft, heroOf } from './systems/heroes';
import { armorOf, attackOf, damageTo, unitReload, unitSpeed } from './systems/stats';
import { EXPLORED } from './visibility';
import { defaultPlayers, World } from './World';

/** M16-6: one hero per civ, one alive per player, a retrain cooldown, and each hero's aura. */

const DT = 1 / BALANCE.tickRate;
const HEROES = (Object.keys(UNITS) as UnitKind[]).filter(isHero);

function flat(w: number, d: number): Heightfield {
  return {
    width: w, depth: d, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d, forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

function arena(civs: CivId[] = ['hellenes', 'romans']): World {
  const w = 120;
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 }, villagers: [], scouts: [], props: [], nodes: [],
    extraStarts: [{ townCenter: { x: w - 4, z: w - 4 }, villagers: [], scouts: [] }],
  };
  const world = new World(flat(w, w), layout, defaultPlayers(2, civs));
  for (const p of [1, 2]) world.visibilityOf(p).state.fill(EXPLORED);
  for (const p of [1, 2]) Object.assign(world.stockOf(p), { wood: 9000, food: 9000, gold: 9000, stone: 9000 });
  for (const p of [1, 2]) world.players.get(p)!.age = 3;
  return world;
}

function building(world: World, kind: BuildingKind, pos: Vec2, owner: PlayerId = 1) {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  return b;
}

function rejections(world: World): RejectReason[] {
  const out: RejectReason[] = [];
  world.events.on('rejected', (e) => out.push(e.reason));
  return out;
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) world.tick(DT);
}

function settle(world: World): void {
  for (let i = 0; i < AURA_PERIOD; i++) auraSystem(world, DT);
}

describe('hero data', () => {
  it('gives every civilization exactly one Empire Age fortress hero with one described aura', () => {
    expect(HEROES).toHaveLength(CIV_IDS.length);
    for (const civ of CIV_IDS) {
      const heroes = trainable('fortress', civ).filter(isHero);
      expect(heroes).toHaveLength(1);
      expect(heroKindFor(civ)).toBe(heroes[0]);
      const spec = UNITS[heroes[0]];
      expect(spec.age).toBe(3);
      expect(spec.auras).toHaveLength(1);
      const aura = AURAS[spec.auras![0]];
      expect(aura.radius).toBe(HERO_AURA_RADIUS);
      expect(aura.description).toContain(spec.name);
      expect(aura.modifiers.length).toBeGreaterThan(0);
    }
    expect(heroKindFor()).toBe('leonidas');
  });

  it.each(HEROES)('%s is strong, never works, never ranks and shows an aura ring', (kind) => {
    expect(UNITS[kind].hp).toBeGreaterThan(UNITS.spartanHoplite.hp * 3);
    expect(canWork(kind)).toBe(false);
    expect(canRank(kind)).toBe(false);
    expect(auraRingRadius({ unit: kind })).toBeGreaterThan(HERO_AURA_RADIUS);
  });

  it('cannot be trained before the Empire Age', () => {
    const world = arena();
    world.players.get(1)!.age = 2;
    const fort = building(world, 'fortress', { x: 40, z: 40 });
    const reasons = rejections(world);
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas' });
    expect(reasons).toEqual(['age']);
  });
});

describe('one hero per player', () => {
  it('rejects a second hero while one is queued or alive, at any fortress', () => {
    const world = arena();
    const fort = building(world, 'fortress', { x: 40, z: 40 });
    const fort2 = building(world, 'fortress', { x: 60, z: 40 });
    const reasons = rejections(world);
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas' });
    expect(reasons).toEqual([]);
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas' });
    world.dispatch({ type: 'train', buildingId: fort2.id, unit: 'leonidas' });
    expect(reasons).toEqual(['limit', 'limit']);
    expect(fort.queue + fort2.queue).toBe(1);
    run(world, UNITS.leonidas.trainTime + 1);
    expect(heroOf(world, 1)?.kind).toBe('leonidas');
    world.dispatch({ type: 'train', buildingId: fort2.id, unit: 'leonidas' });
    expect(reasons).toEqual(['limit', 'limit', 'limit']);
    // Champions are not limited by the hero rule.
    world.dispatch({ type: 'train', buildingId: fort2.id, unit: 'spartanHoplite' });
    expect(reasons).toHaveLength(3);
  });

  it('queues one hero from a batch order (Shift-click or the touch ×5)', () => {
    const world = arena();
    const fort = building(world, 'fortress', { x: 40, z: 40 });
    const gold = world.stockOf(1).gold;
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas', count: 5 });
    expect(fort.queue).toBe(1);
    expect(fort.queueCounts).toEqual([1]);
    expect(world.stockOf(1).gold).toBe(gold - UNITS.leonidas.cost.gold!);
  });

  it('keeps players apart: the enemy may field its own hero', () => {
    const world = arena();
    world.spawnUnit('leonidas', { x: 30, z: 30 }, 1);
    expect(heroBlock(world, 1)).toBe('limit');
    expect(heroBlock(world, 2)).toBeNull();
  });
});

describe('hero retrain cooldown', () => {
  it(`blocks training for ${HERO_COOLDOWN} s after the hero falls, then allows it`, () => {
    const world = arena();
    const fort = building(world, 'fortress', { x: 40, z: 40 });
    const hero = world.spawnUnit('leonidas', { x: 30, z: 30 }, 1);
    world.time = 50;
    killUnit(world, hero);
    expect(world.players.get(1)!.heroReadyAt).toBe(50 + HERO_COOLDOWN);
    expect(heroCooldownLeft(world, 1)).toBe(HERO_COOLDOWN);
    const reasons = rejections(world);
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas' });
    expect(reasons).toEqual(['hero-cooldown']);
    world.time = 50 + HERO_COOLDOWN - 1;
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas' });
    expect(reasons).toEqual(['hero-cooldown', 'hero-cooldown']);
    world.time = 50 + HERO_COOLDOWN;
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'leonidas' });
    expect(reasons).toHaveLength(2);
    expect(fort.queueKinds).toEqual(['leonidas']);
  });

  it('only a hero death starts the cooldown', () => {
    const world = arena();
    killUnit(world, world.spawnUnit('spartanHoplite', { x: 30, z: 30 }, 1));
    expect(heroCooldownLeft(world, 1)).toBe(0);
  });

  it('saves the cooldown and loads pre-hero (v14) saves ready', () => {
    const seed = 4242;
    const { hf, layout } = generateMap(seed, 2);
    const world = new World(hf, layout, defaultPlayers(2));
    world.seed = seed;
    world.tick(DT);
    const hero = world.spawnUnit('leonidas', layout.townCenter, 1);
    killUnit(world, hero);
    const readyAt = world.players.get(1)!.heroReadyAt;
    expect(readyAt).toBeGreaterThan(HERO_COOLDOWN - 1);
    const data = JSON.parse(JSON.stringify(serializeWorld(world)));
    const loaded = deserializeWorld(data, hf);
    expect(loaded.players.get(1)!.heroReadyAt).toBe(readyAt);
    expect(loaded.players.get(2)!.heroReadyAt).toBe(0);
    const old = JSON.parse(JSON.stringify(data));
    old.version = 14;
    for (const p of old.players) delete p.heroReadyAt;
    expect(deserializeWorld(old, hf).players.get(1)!.heroReadyAt).toBe(0);
    const bad = JSON.parse(JSON.stringify(data));
    bad.players[0].heroReadyAt = -5;
    expect(() => deserializeWorld(bad, hf)).toThrow('hero cooldown');
  }, 30_000);
});

describe('hero auras', () => {
  /** A buffed unit beside the hero, a twin outside the radius and an enemy beside it. */
  function setup(hero: UnitKind, kind: UnitKind) {
    const world = arena();
    world.spawnUnit(hero, { x: 50, z: 50 }, 1);
    const near = world.spawnUnit(kind, { x: 52, z: 50 }, 1);
    const far = world.spawnUnit(kind, { x: 50 + HERO_AURA_RADIUS + 6, z: 80 }, 1);
    const enemy = world.spawnUnit(kind, { x: 50, z: 52 }, 2);
    settle(world);
    return { world, near, far, enemy };
  }

  it('Leonidas: own soldiers nearby get +2 melee and pierce armour', () => {
    const { world, near, far, enemy } = setup('leonidas', 'hoplite');
    expect(activeAuras(world, near.id)).toEqual(['leonidasHoldTheLine']);
    const base = armorOf(world, far);
    expect(armorOf(world, near)).toEqual({ ...base, melee: base.melee + 2, pierce: base.pierce + 2 });
    expect(armorOf(world, enemy)).toEqual(base);
  });

  it('Scipio: own infantry nearby attack 20% faster', () => {
    const { world, near, far, enemy } = setup('scipio', 'swordsman');
    expect(unitReload(world, far)).toBe(UNITS.swordsman.reload);
    expect(unitReload(world, near)).toBeCloseTo(UNITS.swordsman.reload / 1.2, 6);
    expect(unitReload(world, enemy)).toBe(UNITS.swordsman.reload);
  });

  it('Scipio: the faster swing shows in a real fight', () => {
    const world = arena();
    // The hero stands by (passive) so only the two swordsmen strike.
    world.spawnUnit('scipio', { x: 50, z: 50 }, 1).stance = 'passive';
    const drilled = world.spawnUnit('swordsman', { x: 52, z: 50 }, 1);
    const plain = world.spawnUnit('swordsman', { x: 52, z: 90 }, 1);
    const dummyA = world.spawnUnit('swordsman', { x: 52.8, z: 50 }, 2);
    const dummyB = world.spawnUnit('swordsman', { x: 52.8, z: 90 }, 2);
    for (const d of [dummyA, dummyB]) {
      d.maxHp = d.hp = 100000;
      d.stance = 'passive';
    }
    world.dispatch({ type: 'attack', unitIds: [drilled.id], targetId: dummyA.id });
    world.dispatch({ type: 'attack', unitIds: [plain.id], targetId: dummyB.id });
    run(world, 30);
    const a = 100000 - dummyA.hp;
    const b = 100000 - dummyB.hp;
    expect(b).toBeGreaterThan(0);
    expect(a / b).toBeGreaterThan(1.12);
    expect(a / b).toBeLessThan(1.3);
  });

  it('Cyrus: own cavalry nearby move 15% faster; infantry do not', () => {
    const { world, near, far, enemy } = setup('cyrus', 'horseman');
    expect(unitSpeed(near, world)).toBeCloseTo(unitSpeed(far, world) * 1.15, 6);
    expect(unitSpeed(enemy, world)).toBe(unitSpeed(far, world));
    const foot = world.spawnUnit('swordsman', { x: 51, z: 48 }, 1);
    settle(world);
    expect(activeAuras(world, foot.id)).toEqual([]);
  });

  it('Vercingetorix: own infantry and cavalry nearby hit with +3 melee', () => {
    const { world, near, far, enemy } = setup('vercingetorix', 'swordsman');
    expect(attackOf(world, near).melee).toBe(attackOf(world, far).melee + 3);
    expect(attackOf(world, enemy).melee).toBe(attackOf(world, far).melee);
    expect(damageTo('swordsman', enemy, world, 1, 0, near)).toBe(damageTo('swordsman', enemy, world, 1, 0, far) + 3);
    // Without the striking unit (old callers), damage is the unbuffed value.
    expect(damageTo('swordsman', enemy, world, 1, 0)).toBe(damageTo('swordsman', enemy, world, 1, 0, far));
  });

  it('drops the aura when the hero falls', () => {
    const { world, near, far } = setup('leonidas', 'hoplite');
    killUnit(world, heroOf(world, 1)!);
    settle(world);
    expect(activeAuras(world, near.id)).toEqual([]);
    expect(armorOf(world, near)).toEqual(armorOf(world, far));
  });
});

describe('heroes and priests', () => {
  it('cannot be converted', () => {
    const world = arena();
    const priest = world.spawnUnit('priest', { x: 50, z: 50 }, 2);
    const hero = world.spawnUnit('leonidas', { x: 53, z: 50 }, 1);
    const reasons = rejections(world);
    orderPriest(world, [priest.id], 'convert', hero.id, 2);
    expect(reasons).toEqual(['invalid-target']);
  });
});

describe('heroes with capture, formations and orders (M18-4, M17)', () => {
  it('capture like champions, march in line with soldiers, and take patrol and guard orders', () => {
    for (const kind of HEROES) {
      expect(captureRate(kind)).toBe(CAPTURE_RATE[UNITS[kind].unitClass]! * CHAMPION_CAPTURE_MUL);
      expect(canPatrol(kind) && canGuard(kind)).toBe(true);
      expect(defaultFormation([kind, 'hoplite'])).toBe('line');
    }
  });
});
