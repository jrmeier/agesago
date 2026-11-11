import { describe, expect, it } from 'vitest';
import { findSpot } from '../ai/placement';
import { Intel } from '../ai/intel';
import { BUILDINGS, TERRITORY } from '../core/buildings';
import { GAIA, GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type SimEvent, type Vec2 } from '../core/types';
import { placementVerdict } from '../ui/build';
import { BALANCE } from './balance';
import { deserializeWorld, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { decaying } from './systems/decay';
import { EXPLORED } from './visibility';
import { defaultPlayers, World } from './World';

const DT = 1 / BALANCE.tickRate;
const P1_TC = { x: 20, z: 40 };
const P2_TC = { x: 100, z: 40 };
/** 40 units from both Town Centers: neutral ground. */
const NEUTRAL = { x: 60, z: 40 };

function flat(): Heightfield {
  return {
    width: 120, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 120 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

/** Two players, Town Centers 80 apart with neutral land between, explored and rich. */
function arena(): World {
  const layout: MapLayout = {
    townCenter: P1_TC, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: P2_TC, villagers: [], scouts: [] }],
  };
  const w = new World(flat(), layout, defaultPlayers(2));
  for (const p of w.players.values()) {
    p.visibility.state.fill(EXPLORED);
    Object.assign(p.stock, { wood: 5000, food: 5000, gold: 5000, stone: 5000 });
  }
  w.seed = 1;
  w.players.get(1)!.age = 1;
  return w;
}

/** A finished building at full hp, dropped in without placement rules. */
function finished(w: World, kind: BuildingKind, pos: Vec2, owner = 1): Building {
  const b = layFoundation(w, kind, pos, 0, owner);
  completeBuilding(w, b);
  b.hp = b.maxHp;
  return b;
}

function run(w: World, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) w.tick(DT);
}

function record(w: World): SimEvent[] {
  const log: SimEvent[] = [];
  for (const t of ['rejected', 'died', 'removed', 'abandoned', 'projectile'] as const) w.events.on(t, (e) => log.push(e));
  return log;
}

describe('territory placement rule (M18-3)', () => {
  it('outposts, docks and Town Centers may also go on neutral land; everything else needs own land', () => {
    const neutralOk = (Object.keys(BUILDINGS) as BuildingKind[]).filter((k) => BUILDINGS[k].placeIn === 'ownOrNeutral').sort();
    expect(neutralOk).toEqual(['dock', 'townCenter', 'watchTower']);
  });

  it('allows own territory, rejects neutral and enemy territory with a reason', () => {
    const w = arena();
    expect(w.territoryOwner(NEUTRAL)).toBe(GAIA);
    expect(w.canPlace('house', { x: 30, z: 40 }, 0, 1)).toEqual({ ok: true });
    expect(w.canPlace('house', NEUTRAL, 0, 1)).toEqual({ ok: false, reason: 'territory' });
    expect(w.canPlace('farm', NEUTRAL, 0, 1)).toEqual({ ok: false, reason: 'territory' });
    expect(w.canPlace('barracks', NEUTRAL, 0, 1)).toEqual({ ok: false, reason: 'territory' });
    expect(w.canPlace('house', { x: 90, z: 40 }, 0, 1)).toEqual({ ok: false, reason: 'enemy-territory' });
    expect(w.canPlace('house', { x: 90, z: 40 }, 0, 2)).toEqual({ ok: true });
  });

  it('watch towers and Town Centers may claim neutral land, never enemy land', () => {
    const w = arena();
    expect(w.canPlace('watchTower', NEUTRAL, 0, 1)).toEqual({ ok: true });
    expect(w.canPlace('watchTower', { x: 90, z: 40 }, 0, 1)).toEqual({ ok: false, reason: 'enemy-territory' });
    expect(w.canPlace('townCenter', NEUTRAL, 0, 1)).toEqual({ ok: true });
    expect(w.canPlace('townCenter', { x: 95, z: 52 }, 0, 1)).toEqual({ ok: false, reason: 'enemy-territory' });
  });

  it(`a Town Center keeps ${TERRITORY.townCenterSpacing} units from every other Town Center`, () => {
    const w = arena();
    // Own territory, but 25 from the own Town Center.
    expect(w.canPlace('townCenter', { x: 20, z: 15 }, 0, 1)).toEqual({ ok: false, reason: 'town-spacing' });
    expect(w.canPlace('townCenter', { x: 20 + TERRITORY.townCenterSpacing + 1, z: 40 }, 0, 1)).toEqual({ ok: true });
    // A foundation counts too.
    layFoundation(w, 'townCenter', NEUTRAL, 0, 1);
    expect(w.canPlace('townCenter', { x: NEUTRAL.x, z: NEUTRAL.z + 20 }, 0, 1)).toEqual({ ok: false, reason: 'town-spacing' });
  });

  it("'build' outside territory is rejected with reason 'territory' and costs nothing", () => {
    const w = arena();
    const log = record(w);
    const v = w.spawnUnit('villager', { x: 30, z: 45 }, 1);
    const stock = { ...w.stock };
    const n = w.buildings.size;
    w.dispatch({ type: 'build', unitIds: [v.id], kind: 'house', pos: NEUTRAL, rot: 0 });
    w.dispatch({ type: 'buildWall', unitIds: [v.id], kind: 'palisade', from: { x: 55, z: 30 }, to: { x: 65, z: 30 } });
    expect(log).toEqual([{ type: 'rejected', reason: 'territory' }, { type: 'rejected', reason: 'territory' }]);
    expect(w.buildings.size).toBe(n);
    expect(w.stock).toEqual(stock);
    w.dispatch({ type: 'build', unitIds: [v.id], kind: 'watchTower', pos: NEUTRAL, rot: 0 });
    expect(w.buildings.size).toBe(n + 1);
  });

  it('the ghost explains a territory rejection', () => {
    const cost = { wood: 10 };
    const stock = { food: 0, wood: 99, gold: 0, stone: 0 };
    expect(placementVerdict({ ok: false, reason: 'territory' }, cost, stock)).toEqual({ ok: false, text: 'Must be in your territory' });
    expect(placementVerdict({ ok: false, reason: 'enemy-territory' }, cost, stock).text).toMatch(/another player’s territory/);
    expect(placementVerdict({ ok: false, reason: 'town-spacing' }, cost, stock).text).toMatch(/Too close to another Town Center/);
  });

  it('AI spot search only offers spots its owner may build on', () => {
    const w = arena();
    const intel = new Intel(w, 1, true);
    intel.refreshNodes();
    // Searching from the neutral middle: a house must fall back inside player 1's land.
    const house = findSpot(w, intel, 1, { kind: 'house', center: { x: 50, z: 40 }, minR: 0, maxR: 30, clearOfNodes: 1, gap: 1, maxChecks: 50 });
    expect(house).not.toBeNull();
    expect(w.territoryOwner(house!)).toBe(1);
    expect(w.canPlace('house', house!, 0, 1).ok).toBe(true);
    const tower = findSpot(w, intel, 1, { kind: 'watchTower', center: NEUTRAL, minR: 0, maxR: 5, clearOfNodes: 1, gap: 1 });
    expect(tower).not.toBeNull();
    expect(w.territoryOwner(tower!)).toBe(GAIA);
  });
});

describe('territory decay (M18-3)', () => {
  it('buildings off connected own territory lose 1% max hp per 5 s; buildings at home do not', () => {
    const w = arena();
    const home = finished(w, 'barracks', { x: 30, z: 40 });
    const away = finished(w, 'barracks', NEUTRAL);
    run(w, 0.05);
    // The outpost's own influence claims its cell, but it is cut off from every Town Center.
    expect(w.territoryOwner(NEUTRAL)).toBe(1);
    expect(w.isConnected(NEUTRAL)).toBe(false);
    expect(decaying(w, away)).toBe(true);
    expect(decaying(w, home)).toBe(false);
    const start = away.hp;
    run(w, 10);
    expect(start - away.hp).toBeCloseTo(away.maxHp * 0.02, 0);
    expect(home.hp).toBe(home.maxHp);
  });

  it('any occupant stops decay; it resumes when they leave', () => {
    const w = arena();
    const tower = finished(w, 'watchTower', NEUTRAL);
    const v = w.spawnUnit('villager', { x: NEUTRAL.x, z: NEUTRAL.z + 2.5 }, 1);
    w.dispatch({ type: 'garrison', unitIds: [v.id], buildingId: tower.id });
    for (let i = 0; i < 200 && v.state !== 'garrisoned'; i++) w.tick(DT);
    expect(v.state).toBe('garrisoned');
    const held = tower.hp;
    run(w, 20);
    expect(tower.hp).toBe(held);
    w.dispatch({ type: 'ungarrison', buildingId: tower.id });
    run(w, 5);
    expect(tower.hp).toBeLessThan(held);
  });

  it('Town Centers never decay, even on land they do not hold', () => {
    const w = arena();
    // A Town Center inside the enemy's pull, and the grid hand-edited so its cell is lost.
    const tc = finished(w, 'townCenter', { x: 60, z: 70 });
    run(w, 0.05);
    w.territory.owner[w.territory.cellAt(tc.pos)] = 2;
    w.territory.connected[w.territory.cellAt(tc.pos)] = 0;
    expect(decaying(w, tc)).toBe(false);
    run(w, 10);
    expect(tc.hp).toBe(tc.maxHp);
  });

  it('fortresses are roots: they anchor their own territory and never decay', () => {
    const w = arena();
    w.players.get(1)!.age = 2;
    expect(BUILDINGS.fortress.territory).toMatchObject({ root: true });
    const fort = finished(w, 'fortress', NEUTRAL);
    const tower = finished(w, 'barracks', { x: NEUTRAL.x + 8, z: NEUTRAL.z });
    run(w, 0.05);
    expect(w.isConnected(NEUTRAL)).toBe(true);
    expect(decaying(w, fort)).toBe(false);
    expect(decaying(w, tower)).toBe(false);
    run(w, 10);
    expect(fort.hp).toBe(fort.maxHp);
  });

  it('a decayed house collapses: destroyed, its pop room gone', () => {
    const w = arena();
    const log = record(w);
    const house = finished(w, 'house', NEUTRAL);
    const cap = w.popCapOf(1);
    house.hp = 0.5;
    run(w, 1);
    expect(w.buildings.has(house.id)).toBe(false);
    expect(log.filter((e) => e.type === 'died' && e.id === house.id)).toHaveLength(1);
    expect(w.popCapOf(1)).toBe(cap - BUILDINGS.house.popBonus);
  });

  it('a decayed barracks turns neutral: queues dropped, no territory, no further decay, anyone may tear it down', () => {
    const w = arena();
    const log = record(w);
    const b = finished(w, 'barracks', NEUTRAL);
    // A batch (M15-4) in the queue: queueCounts must go with the rest, or the save is invalid.
    w.dispatch({ type: 'train', buildingId: b.id, unit: 'hoplite', count: 3 });
    expect(b.queue).toBe(3);
    expect(b.queueCounts).toEqual([3]);
    b.hp = 0.5;
    run(w, 1);
    expect(w.buildings.get(b.id)).toBe(b);
    expect(b.owner).toBe(GAIA);
    expect(b.hp).toBeCloseTo(b.maxHp * TERRITORY.neutralHp);
    expect(b.queue).toBe(0);
    expect(b.queueKinds).toEqual([]);
    expect(b.queueCounts).toEqual([]);
    expect(() => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), w.hf)).not.toThrow();
    expect(log).toContainEqual({ type: 'abandoned', id: b.id, kind: 'barracks', owner: 1, pos: NEUTRAL });
    expect(log.some((e) => e.type === 'died')).toBe(false);
    expect(w.territoryOwner(NEUTRAL)).toBe(GAIA);
    const hp = b.hp;
    run(w, 10);
    expect(b.hp).toBe(hp);
    // Either player may knock the ruin down by explicit order.
    const sw = w.spawnUnit('swordsman', { x: NEUTRAL.x + 3, z: NEUTRAL.z }, 2);
    w.dispatch({ type: 'attack', unitIds: [sw.id], targetId: b.id }, 2);
    expect(log.some((e) => e.type === 'rejected')).toBe(false);
    run(w, 5);
    expect(b.hp).toBeLessThan(hp);
  });

  it('an abandoned watch tower holds its fire', () => {
    const w = arena();
    const log = record(w);
    const tower = finished(w, 'watchTower', NEUTRAL);
    tower.hp = 0.5;
    run(w, 1);
    expect(tower.owner).toBe(GAIA);
    w.spawnUnit('swordsman', { x: NEUTRAL.x + 4, z: NEUTRAL.z }, 2);
    w.spawnUnit('swordsman', { x: NEUTRAL.x - 4, z: NEUTRAL.z }, 1);
    run(w, 6);
    expect(log.filter((e) => e.type === 'projectile')).toEqual([]);
  });

  it('decay and neutral buildings survive save/load and stay in lockstep', () => {
    const w = arena();
    const a = finished(w, 'barracks', NEUTRAL);
    const t = finished(w, 'stable', { x: 60, z: 20 });
    a.hp = 0.5;
    run(w, 1);
    expect(a.owner).toBe(GAIA);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), flat());
    expect(loaded.buildings.get(a.id)!.owner).toBe(GAIA);
    run(w, 20);
    run(loaded, 20);
    expect(loaded.buildings.get(t.id)!.hp).toBeCloseTo(t.hp, 9);
    expect(loaded.buildings.get(t.id)!.hp).toBeLessThan(t.maxHp);
  });
});
