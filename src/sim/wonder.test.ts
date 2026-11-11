import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { GRASS_ONLY, type Building, type Heightfield, type MapLayout, type SimEvent } from '../core/types';
import { generateMap } from './mapgen';
import { deserializeWorld, SAVE_VERSION, serializeWorld } from './serialize';
import { ageLocked, completeBuilding, layFoundation } from './systems/build';
import { destroyBuilding } from './systems/combat';
import { DEFAULT_WONDER_SECONDS, normalizeWonderRules } from './systems/victory';
import { World, defaultPlayers } from './World';

const DT = 0.05;

function arena(teams = [1, 2]): World {
  const hf: Heightfield = {
    width: 80, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const starts = teams.map((_, i) => ({
    townCenter: { x: 10 + 25 * i, z: 10 }, villagers: [{ x: 10 + 25 * i, z: 15 }], scouts: [],
  }));
  const layout: MapLayout = { ...starts[0], extraStarts: starts.slice(1), nodes: [], props: [] };
  return new World(hf, layout, defaultPlayers(teams.length).map((p, i) => ({ ...p, team: teams[i] })));
}

function wonderEvents(world: World): SimEvent[] {
  const events: SimEvent[] = [];
  for (const type of ['wonderStarted', 'wonderCancelled', 'gameOver'] as const) world.events.on(type, (e) => events.push(e));
  return events;
}

function finishedWonder(world: World, owner: number, x = 40, z = 50): Building {
  const b = layFoundation(world, 'wonder', { x, z }, 0, owner);
  completeBuilding(world, b);
  // Full hp: these spots are outside the owner's territory, and territory decay (M18-3) would
  // otherwise wear a fresh foundation's hp down within the countdown.
  b.hp = b.maxHp;
  return b;
}

function runFor(world: World, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n && !world.gameOver; i++) world.tick(DT);
}

describe('wonder building', () => {
  it('is an expensive, slow Empire Age monument with a large footprint', () => {
    const spec = BUILDINGS.wonder;
    expect(spec.age).toBe(3);
    expect(spec.cost).toEqual({ food: 1000, wood: 1000, stone: 1000, gold: 1000 });
    expect(spec.buildTime).toBeGreaterThanOrEqual(400);
    expect(spec.size.w * spec.size.d).toBeGreaterThanOrEqual(36);
    expect(spec.hp).toBeGreaterThan(BUILDINGS.townCenter.hp);
    const w = arena();
    expect(ageLocked(w, 'wonder', 1)).toBe(true);
    w.players.get(1)!.age = 3;
    expect(ageLocked(w, 'wonder', 1)).toBe(false);
  });
});

describe('wonder victory', () => {
  it('defaults to on with a 300 s countdown and clamps bad options', () => {
    expect(arena().wonderRules).toEqual({ enabled: true, seconds: DEFAULT_WONDER_SECONDS });
    expect(normalizeWonderRules({ enabled: false, seconds: 5 })).toEqual({ enabled: false, seconds: 60 });
    expect(normalizeWonderRules({ enabled: 'yes', seconds: Number.NaN })).toEqual({ enabled: true, seconds: 300 });
    expect(normalizeWonderRules(null)).toEqual({ enabled: true, seconds: 300 });
  });

  it('starts the countdown when a wonder completes and announces it to everyone', () => {
    const w = arena();
    const events = wonderEvents(w);
    const foundation = layFoundation(w, 'wonder', { x: 40, z: 50 }, 0, 1);
    runFor(w, 2);
    expect(w.wonder).toBeNull();
    completeBuilding(w, foundation);
    expect(w.wonder).toEqual({ building: foundation.id, owner: 1, pos: { x: 40, z: 50 }, remaining: 300 });
    expect(foundation.completedAt).toBe(w.time);
    expect(events).toEqual([{ type: 'wonderStarted', id: foundation.id, owner: 1, pos: { x: 40, z: 50 }, remaining: 300 }]);
    runFor(w, 10);
    expect(w.wonder!.remaining).toBeCloseTo(290, 5);
  });

  it("wins for the owner's team when the countdown reaches zero", () => {
    const w = arena([1, 2, 1]);
    w.wonderRules = { enabled: true, seconds: 60 };
    const events = wonderEvents(w);
    finishedWonder(w, 3);
    runFor(w, 59);
    expect(w.gameOver).toBeNull();
    runFor(w, 2);
    expect(w.gameOver).toEqual({ winners: [1, 3], reason: 'wonder' });
    expect(events.filter((e) => e.type === 'gameOver')).toEqual([{ type: 'gameOver', winners: [1, 3], reason: 'wonder' }]);
    const at = w.time;
    w.tick(DT);
    expect(events.filter((e) => e.type === 'gameOver')).toHaveLength(1);
    expect(w.time).toBeGreaterThan(at);
  });

  it('cancels the countdown when the wonder is destroyed', () => {
    const w = arena();
    w.wonderRules = { enabled: true, seconds: 60 };
    const events = wonderEvents(w);
    const b = finishedWonder(w, 2);
    runFor(w, 30);
    destroyBuilding(w, b);
    w.tick(DT);
    expect(w.wonder).toBeNull();
    expect(events.filter((e) => e.type === 'wonderCancelled')).toEqual([{ type: 'wonderCancelled', id: b.id, owner: 2, pos: { x: 40, z: 50 } }]);
    runFor(w, 120);
    expect(w.gameOver).toBeNull();
  });

  it('counts the earliest finished wonder; the next one restarts the clock when it falls', () => {
    const w = arena();
    w.wonderRules = { enabled: true, seconds: 120 };
    const first = finishedWonder(w, 2, 40, 50);
    runFor(w, 20);
    const second = finishedWonder(w, 1, 60, 50);
    expect(w.wonder).toMatchObject({ building: first.id, owner: 2 });
    runFor(w, 10);
    destroyBuilding(w, first);
    runFor(w, 1.5);
    expect(w.wonder).toMatchObject({ building: second.id, owner: 1 });
    expect(w.wonder!.remaining).toBeGreaterThan(118);
    runFor(w, 120);
    expect(w.gameOver).toEqual({ winners: [1], reason: 'wonder' });
  });

  it('does nothing when the match option is off', () => {
    const w = arena();
    w.wonderRules = { enabled: false, seconds: 60 };
    const events = wonderEvents(w);
    finishedWonder(w, 1);
    runFor(w, 120);
    expect(w.wonder).toBeNull();
    expect(w.gameOver).toBeNull();
    expect(events).toEqual([]);
  });

  it('picks up a wonder placed already complete by a scenario', () => {
    const w = arena();
    const b = layFoundation(w, 'wonder', { x: 40, z: 50 }, 0, 2);
    b.complete = true;
    b.buildProgress = 1;
    runFor(w, 1.5);
    expect(w.wonder).toMatchObject({ building: b.id, owner: 2 });
  });

  it('a resigning owner loses the wonder and its countdown', () => {
    const w = arena([1, 2, 3]);
    finishedWonder(w, 2);
    w.dispatch({ type: 'resign' }, 2);
    w.tick(DT);
    expect(w.wonder).toBeNull();
    expect(w.gameOver).toBeNull();
  });
});

describe('wonder save/load', () => {
  const SEED = 17;
  let hf: Heightfield;
  let layout: MapLayout;
  beforeAll(() => {
    ({ hf, layout } = generateMap(SEED, 2));
  });
  function saveable(): World {
    const w = new World(hf, layout);
    w.seed = SEED;
    return w;
  }
  const at = () => ({ x: layout.townCenter.x + 12, z: layout.townCenter.z + 12 });

  it('round-trips the rules and the running countdown, then finishes on time', () => {
    const w = saveable();
    w.wonderRules = { enabled: true, seconds: 90 };
    const b = finishedWonder(w, 2, at().x, at().z);
    runFor(w, 30);
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.wonderRules).toEqual({ enabled: true, seconds: 90 });
    expect(data.systems.wonder).toEqual({ building: b.id, owner: 2, pos: at(), remaining: w.wonder!.remaining });
    const loaded = deserializeWorld(data, hf);
    expect(loaded.wonderRules).toEqual({ enabled: true, seconds: 90 });
    expect(loaded.wonder).toEqual(w.wonder);
    expect(loaded.buildings.get(b.id)!.completedAt).toBe(b.completedAt);
    runFor(w, 61);
    runFor(loaded, 61);
    expect(loaded.gameOver).toEqual({ winners: [2], reason: 'wonder' });
    expect(loaded.gameOver).toEqual(w.gameOver);
    expect(loaded.time).toBeCloseTo(w.time, 6);
  });

  it('keeps a disabled option across a save', () => {
    const w = saveable();
    w.wonderRules = { enabled: false, seconds: 600 };
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), hf);
    expect(loaded.wonderRules).toEqual({ enabled: false, seconds: 600 });
  });

  it('loads pre-wonder saves (v2-v7) with the default rules and no countdown', () => {
    const w = saveable();
    w.wonderRules = { enabled: false, seconds: 600 };
    const current = JSON.parse(JSON.stringify(serializeWorld(w)));
    // Every older version loads; wonder fields a pre-wonder save can't have are dropped.
    for (const version of [2, 3, 4, 5, 6, 7]) {
      const data = JSON.parse(JSON.stringify(current));
      data.version = version;
      const loaded = deserializeWorld(data, hf);
      expect(loaded.wonderRules).toEqual({ enabled: true, seconds: 300 });
      expect(loaded.wonder).toBeNull();
    }
  }, 30_000);

  it('rejects a countdown for a building that is not a wonder', () => {
    const w = saveable();
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    data.systems.wonder = { building: w.townCenterOf(1)!.id, owner: 1, remaining: 10 };
    expect(() => deserializeWorld(data, hf)).toThrow('Invalid save: wonder countdown');
  });
});
