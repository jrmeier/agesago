import { describe, expect, it } from 'vitest';
import { BUILDINGS, CAPTURE, maxCapturePoints } from '../core/buildings';
import { captureRate, UNITS } from '../core/units';
import { GAIA, GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type SimEvent, type UnitKind, type Vec2 } from '../core/types';
import { BALANCE } from './balance';
import { deserializeWorld, SAVE_VERSION, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { canCapture, capturePointsOf, regenRate } from './systems/capture';
import { abandonBuilding } from './systems/decay';
import { EXPLORED } from './visibility';
import { defaultPlayers, World } from './World';

const DT = 1 / BALANCE.tickRate;
const P1_TC = { x: 20, z: 40 };
const P2_TC = { x: 100, z: 40 };
/** 40 units from both Town Centers: neutral ground. */
const NEUTRAL = { x: 60, z: 40 };
/** Inside player 2's borders. */
const P2_LAND = { x: 88, z: 40 };

function flat(): Heightfield {
  return {
    width: 120, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 120 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

/** Two rival players (or allies), Town Centers 80 apart with neutral land between, explored and rich. */
function arena(allied = false): World {
  const layout: MapLayout = {
    townCenter: P1_TC, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: P2_TC, villagers: [], scouts: [] }],
  };
  const players = defaultPlayers(2);
  if (allied) players[1].team = players[0].team;
  const w = new World(flat(), layout, players);
  for (const p of w.players.values()) {
    p.visibility.state.fill(EXPLORED);
    Object.assign(p.stock, { wood: 5000, food: 5000, gold: 5000, stone: 5000 });
  }
  w.seed = 1;
  return w;
}

function finished(w: World, kind: BuildingKind, pos: Vec2, owner: number): Building {
  const b = layFoundation(w, kind, pos, 0, owner);
  completeBuilding(w, b);
  b.hp = b.maxHp;
  return b;
}

/** `n` units of `kind` for player 1 just west of `b`. */
function squad(w: World, b: Building, kind: UnitKind = 'swordsman', n = 1, owner = 1): number[] {
  return Array.from({ length: n }, (_, i) => w.spawnUnit(kind, { x: b.pos.x - b.radius - 1.2, z: b.pos.z - 1 + i * 0.7 }, owner).id);
}

function run(w: World, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) w.tick(DT);
}

function record(w: World): SimEvent[] {
  const log: SimEvent[] = [];
  for (const t of ['captured', 'attacked', 'defeated', 'gameOver'] as const) w.events.on(t, (e) => log.push(e));
  return log;
}

describe('capture data (M18-4)', () => {
  it('walls, gates and farms cannot be captured; the rest default to half their hp', () => {
    const never = (Object.keys(BUILDINGS) as BuildingKind[]).filter((k) => maxCapturePoints(k) === 0).sort();
    expect(never).toEqual(['farm', 'gate', 'palisade', 'stoneWall']);
    expect(maxCapturePoints('house')).toBe(Math.round(BUILDINGS.house.hp * CAPTURE.cpPerHp));
    expect(maxCapturePoints('townCenter')).toBe(1200);
  });

  it('soldiers capture, champions twice as fast; villagers, priests, carts, ships and siege never', () => {
    expect(captureRate('swordsman')).toBe(2.5);
    expect(captureRate('archer')).toBe(2.5);
    expect(captureRate('horseman')).toBe(2.5);
    expect(captureRate('scout')).toBe(2.5);
    expect(captureRate('praetorian')).toBe(5);
    expect(captureRate('equites')).toBe(5);
    for (const k of ['villager', 'priest', 'tradeCart', 'trireme', 'fishingBoat', 'ram', 'catapult', 'sheep'] as UnitKind[]) {
      expect(captureRate(k), k).toBe(0);
    }
    expect(UNITS.villager.unitClass).toBe('villager');
  });
});

describe('capture points (M18-4)', () => {
  it('a capture order drains the owner and fills the attacker, then the building changes hands', () => {
    const w = arena();
    const house = finished(w, 'house', NEUTRAL, 2);
    const max = maxCapturePoints('house');
    const log = record(w);
    const ids = squad(w, house, 'swordsman', 2);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: house.id }, 1);
    expect(w.combatState.get(ids[0])?.capture).toBe(true);
    run(w, 10);
    const cp = capturePointsOf(w, house);
    expect(cp[1]).toBeGreaterThan(0);
    expect(cp[1] + cp[2]).toBeCloseTo(max, 6);
    expect(house.owner).toBe(2);
    // Only territory decay (it stands cut off), no blows.
    expect(house.hp).toBeGreaterThan(house.maxHp * 0.95);
    const popBefore = { p1: w.popCapOf(1), p2: w.popCapOf(2) };
    run(w, max / 5);
    expect(house.owner).toBe(1);
    expect(house.capture).toBeUndefined();
    expect(log.find((e) => e.type === 'captured')).toEqual({ type: 'captured', id: house.id, kind: 'house', owner: 1, previousOwner: 2, pos: house.pos });
    expect(log.some((e) => e.type === 'attacked' && e.owner === 2)).toBe(true);
    expect(w.popCapOf(1)).toBe(popBefore.p1 + BUILDINGS.house.popBonus);
    expect(w.popCapOf(2)).toBe(popBefore.p2 - BUILDINGS.house.popBonus);
    // The house now projects player 1's territory, and the capturers stand down.
    expect(w.territoryOwner(house.pos)).toBe(1);
    run(w, 1);
    for (const id of ids) {
      expect(w.units.get(id)!.state).toBe('idle');
      expect(w.combatState.get(id)?.capture).toBeUndefined();
    }
  });

  it('an attack order hits the building and leaves its capture points alone', () => {
    const w = arena();
    const house = finished(w, 'house', NEUTRAL, 2);
    const ids = squad(w, house, 'swordsman', 2);
    w.dispatch({ type: 'attack', unitIds: ids, targetId: house.id }, 1);
    run(w, 10);
    expect(house.hp).toBeLessThan(house.maxHp);
    expect(house.capture).toBeUndefined();
    expect(house.owner).toBe(2);
  });

  it('capture of an uncapturable building, and by units without a capture attack, attacks instead', () => {
    const w = arena();
    const wall = finished(w, 'palisade', NEUTRAL, 2);
    const ids = squad(w, wall, 'swordsman', 1);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: wall.id }, 1);
    expect(w.combatState.get(ids[0])?.capture).toBeUndefined();
    run(w, 6);
    expect(wall.hp).toBeLessThan(wall.maxHp);

    const house = finished(w, 'house', { x: 60, z: 20 }, 2);
    const [villager] = squad(w, house, 'villager', 1);
    const [soldier] = squad(w, house, 'swordsman', 1);
    w.dispatch({ type: 'capture', unitIds: [villager, soldier], targetId: house.id }, 1);
    expect(w.combatState.get(villager)?.order).toBe('attack');
    expect(w.combatState.get(villager)?.capture).toBeUndefined();
    expect(w.combatState.get(soldier)?.capture).toBe(true);
  });

  it('nobody captures their own or an ally\'s building, nor a foundation', () => {
    const w = arena(true);
    const house = finished(w, 'house', NEUTRAL, 2);
    expect(canCapture(w, 1, house)).toBe(false);
    expect(canCapture(w, 2, house)).toBe(false);
    const rival = arena();
    const site = layFoundation(rival, 'house', NEUTRAL, 0, 2);
    expect(canCapture(rival, 1, site)).toBe(false);
    completeBuilding(rival, site);
    expect(canCapture(rival, 1, site)).toBe(true);
  });

  it('garrisoned units win points back for the owner, enough to hold off one soldier', () => {
    const w = arena();
    const tower = finished(w, 'watchTower', NEUTRAL, 2);
    const guards = [0, 1].map((i) => w.spawnUnit('villager', { x: tower.pos.x + tower.radius + 1, z: tower.pos.z + i }, 2).id);
    w.dispatch({ type: 'garrison', unitIds: guards, buildingId: tower.id }, 2);
    run(w, 3);
    expect(tower.occupants).toHaveLength(2);
    expect(regenRate(w, tower)).toBe(2 * CAPTURE.garrisonRegen);
    // The tower's arrows would kill the attacker: hold fire for this test.
    tower.cooldown = 1e9;
    const ids = squad(w, tower, 'swordsman', 1);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: tower.id }, 1);
    run(w, 30);
    expect(tower.owner).toBe(2);
    expect(capturePointsOf(w, tower)[1]).toBeLessThan(1);
    // Without the garrison the same soldier takes it.
    w.dispatch({ type: 'ungarrison', buildingId: tower.id }, 2);
    for (const id of guards) w.units.delete(id);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: tower.id }, 1);
    run(w, maxCapturePoints('watchTower') / 2.5 + 2);
    expect(tower.owner).toBe(1);
  });

  it('own connected territory regenerates slowly; a cut-off outpost does not', () => {
    const w = arena();
    const home = finished(w, 'house', P2_LAND, 2);
    const away = finished(w, 'house', NEUTRAL, 2);
    const max = maxCapturePoints('house');
    for (const b of [home, away]) b.capture = [0, 100, max - 100];
    expect(regenRate(w, home)).toBe(CAPTURE.territoryRegen);
    expect(regenRate(w, away)).toBe(0);
    run(w, 10);
    expect(capturePointsOf(w, home)[2]).toBeCloseTo(max - 100 + 10 * CAPTURE.territoryRegen, 6);
    expect(capturePointsOf(w, away)[2]).toBeCloseTo(max - 100, 6);
    run(w, 100);
    expect(home.capture).toBeUndefined();
  });

  it('a building on a rival\'s territory slowly goes to the territory owner', () => {
    const w = arena();
    const outpost = finished(w, 'barracks', P2_LAND, 1);
    const max = maxCapturePoints('barracks');
    expect(w.territoryOwner(outpost.pos)).toBe(2);
    run(w, 5);
    expect(capturePointsOf(w, outpost)[2]).toBeCloseTo(5 * CAPTURE.enemyTerritoryRegen, 6);
    outpost.capture = [0, 3, max - 3];
    const log = record(w);
    run(w, 4);
    expect(outpost.owner).toBe(2);
    expect(log.find((e) => e.type === 'captured')).toMatchObject({ owner: 2, previousOwner: 1 });
  });

  it('abandoned (Gaia) buildings can be captured, and drift to whoever owns the land', () => {
    const w = arena();
    const ruin = finished(w, 'barracks', NEUTRAL, 2);
    abandonBuilding(w, ruin);
    expect(ruin.owner).toBe(GAIA);
    expect(canCapture(w, 1, ruin)).toBe(true);
    const ids = squad(w, ruin, 'praetorian', 4);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: ruin.id }, 1);
    run(w, maxCapturePoints('barracks') / 20 + 3);
    expect(ruin.owner).toBe(1);

    const land = finished(w, 'storehouse', P2_LAND, 1);
    abandonBuilding(w, land);
    land.capture = [2, 0, maxCapturePoints('storehouse') - 2];
    run(w, 3);
    expect(land.owner).toBe(2);
  });
});

describe('capture consequences (M18-4)', () => {
  it('refunds queues to the old owner, ejects the garrison and keeps the tier', () => {
    const w = arena();
    const barracks = finished(w, 'barracks', NEUTRAL, 2);
    w.players.get(2)!.age = 1;
    const stock = { ...w.stockOf(2) };
    w.dispatch({ type: 'train', buildingId: barracks.id, unit: 'swordsman' }, 2);
    w.dispatch({ type: 'train', buildingId: barracks.id, unit: 'swordsman' }, 2);
    expect(barracks.queue).toBe(2);
    const tower = finished(w, 'watchTower', { x: 60, z: 20 }, 2);
    tower.tier = 1;
    const guard = w.spawnUnit('villager', { x: tower.pos.x + tower.radius + 1, z: tower.pos.z }, 2);
    w.dispatch({ type: 'garrison', unitIds: [guard.id], buildingId: tower.id }, 2);
    run(w, 2);
    expect(tower.occupants).toEqual([guard.id]);
    const max = { barracks: maxCapturePoints('barracks'), tower: maxCapturePoints('watchTower') };
    barracks.capture = [0, max.barracks - 0.01, 0.01];
    tower.capture = [0, max.tower - 0.01, 0.01];
    tower.cooldown = 1e9;
    const a = squad(w, barracks, 'swordsman', 1);
    const b = squad(w, tower, 'swordsman', 3);
    // Passive, so they leave the ejected villager alone once the tower is theirs.
    w.dispatch({ type: 'stance', unitIds: b, stance: 'passive' }, 1);
    w.dispatch({ type: 'capture', unitIds: a, targetId: barracks.id }, 1);
    w.dispatch({ type: 'capture', unitIds: b, targetId: tower.id }, 1);
    run(w, 3);
    expect(barracks.owner).toBe(1);
    expect(barracks.queue).toBe(0);
    expect(barracks.queueKinds).toEqual([]);
    expect(w.stockOf(2)).toEqual(stock);
    expect(tower.owner).toBe(1);
    expect(tower.tier).toBe(1);
    expect(tower.occupants).toEqual([]);
    expect(w.units.get(guard.id)!.state).not.toBe('garrisoned');
    expect(w.units.get(guard.id)!.owner).toBe(2);
  });

  it('capturing the last Town Center of a player with nothing else defeats them', () => {
    const w = arena();
    const log = record(w);
    const tc = w.townCenterOf(2)!;
    tc.cooldown = 1e9;
    const ids = squad(w, tc, 'praetorian', 10);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: tc.id }, 1);
    for (let i = 0; i < 60 * 20 && tc.owner === 2; i++) {
      tc.cooldown = 1e9;
      w.tick(DT);
    }
    expect(tc.owner).toBe(1);
    run(w, 2);
    expect(log).toContainEqual({ type: 'defeated', player: 2, reason: 'conquest' });
    expect(w.gameOver).toEqual({ winners: [1], reason: 'conquest' });
  });

  it('capture points and capture orders survive save/load in lockstep', () => {
    const w = arena();
    const house = finished(w, 'house', NEUTRAL, 2);
    const ids = squad(w, house, 'swordsman', 2);
    w.dispatch({ type: 'capture', unitIds: ids, targetId: house.id }, 1);
    run(w, 12);
    expect(house.capture).toBeDefined();
    const save = serializeWorld(w);
    expect(save.version).toBe(SAVE_VERSION);
    const copy = deserializeWorld(save, flat());
    expect(copy.buildings.get(house.id)!.capture).toEqual(house.capture);
    expect(copy.combatState.get(ids[0])?.capture).toBe(true);
    run(w, 60);
    run(copy, 60);
    expect(copy.buildings.get(house.id)!.owner).toBe(house.owner);
    expect(house.owner).toBe(1);
    expect(serializeWorld(copy)).toEqual(serializeWorld(w));
  });

  it('an older (pre-capture, v13) save loads with every building fully its owner\'s', () => {
    const w = arena();
    const house = finished(w, 'house', NEUTRAL, 2);
    house.capture = [0, 10, maxCapturePoints('house') - 10];
    const save = serializeWorld(w);
    save.version = 13;
    const copy = deserializeWorld(save, flat());
    expect(copy.buildings.get(house.id)!.capture).toBeUndefined();
  });
});
