import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { GAIA, GRASS_ONLY, type Heightfield, type MapLayout, type SimEvent } from '../core/types';
import { UNITS } from '../core/units';
import { BALANCE } from './balance';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { applyDamage, lootFor } from './systems/combat';
import { defaultPlayers, World } from './World';

function flat(w = 120, d = 120): Heightfield {
  return {
    width: w, depth: d, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

/** Three players (1 and 3 allied), no starting units, empty stockpiles. */
function arena(): World {
  const layout: MapLayout = {
    townCenter: { x: 6, z: 6 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [
      { townCenter: { x: 114, z: 114 }, villagers: [], scouts: [] },
      { townCenter: { x: 114, z: 6 }, villagers: [], scouts: [] },
    ],
  };
  const players = defaultPlayers(3);
  players[2].team = players[0].team;
  const w = new World(flat(), layout, players);
  for (const p of w.players.values()) for (const r of ['food', 'wood', 'gold', 'stone'] as const) p.stock[r] = 0;
  return w;
}

const kill = (w: World, t: { hp: number; pos: { x: number; z: number } } & Parameters<typeof applyDamage>[1], by: number) =>
  applyDamage(w, t, t.hp, null, by, { x: t.pos.x + 1, z: t.pos.z });

const building = (w: World, kind: keyof typeof BUILDINGS, owner: number, x: number, z: number) => {
  const b = layFoundation(w, kind, { x, z }, 0, owner);
  completeBuilding(w, b);
  return b;
};

describe('loot (M15-5)', () => {
  it('pays the killer a floored share of an enemy unit cost and announces it', () => {
    const w = arena();
    const events: SimEvent[] = [];
    w.events.on('looted', (e) => events.push(e));
    w.events.on('stockpile', (e) => events.push(e));
    const hoplite = w.spawnUnit('hoplite', { x: 60, z: 60 }, 2);
    kill(w, hoplite, 1);
    const cost = UNITS.hoplite.cost;
    const expected = {
      food: Math.floor(cost.food! * BALANCE.lootFraction.unit),
      wood: Math.floor(cost.wood! * BALANCE.lootFraction.unit),
    };
    expect(expected).toEqual({ food: 5, wood: 3 });
    expect(w.stockOf(1)).toEqual({ food: 5, wood: 3, gold: 0, stone: 0 });
    expect(w.players.get(1)!.looted).toEqual({ food: 5, wood: 3, gold: 0, stone: 0 });
    expect(w.units.has(hoplite.id)).toBe(false);
    const looted = events.find((e) => e.type === 'looted');
    expect(looted).toEqual({ type: 'looted', owner: 1, pos: { x: 60, z: 60 }, loot: { food: 5, wood: 3 } });
    // The local player's HUD hears about the new stockpile.
    expect(events.some((e) => e.type === 'stockpile' && e.stock.food === 5)).toBe(true);
  });

  it('pays a share of a razed enemy building cost', () => {
    const w = arena();
    const barracks = building(w, 'barracks', 2, 60, 60);
    kill(w, barracks, 1);
    expect(w.buildings.has(barracks.id)).toBe(false);
    const wood = Math.floor(BUILDINGS.barracks.cost.wood! * BALANCE.lootFraction.building);
    expect(wood).toBeGreaterThan(0);
    expect(w.stockOf(1).wood).toBe(wood);
    expect(w.players.get(1)!.looted.wood).toBe(wood);
  });

  it('gives nothing for wildlife, own or allied entities, walls, or gaia killers', () => {
    const w = arena();
    const looted: SimEvent[] = [];
    w.events.on('looted', (e) => looted.push(e));
    kill(w, w.spawnUnit('boar', { x: 60, z: 60 }, GAIA), 1);
    kill(w, w.spawnUnit('hoplite', { x: 62, z: 60 }, 1), 1);
    kill(w, w.spawnUnit('hoplite', { x: 64, z: 60 }, 3), 1);
    kill(w, w.spawnUnit('hoplite', { x: 66, z: 60 }, 2), GAIA);
    kill(w, building(w, 'palisade', 2, 40, 40), 1);
    kill(w, building(w, 'stoneWall', 2, 44, 40), 1);
    expect(looted).toEqual([]);
    expect(w.stockOf(1)).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
    expect(w.players.get(1)!.looted).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
    // A carcass still drops for the hunted boar (normal hunting is unchanged).
    expect([...w.nodes.values()].some((n) => n.kind === 'carcass')).toBe(true);
  });

  it('lootFor floors per resource and lists only resources worth at least one', () => {
    const w = arena();
    const villager = w.spawnUnit('villager', { x: 60, z: 60 }, 2);
    expect(lootFor(w, villager, 1)).toEqual({ food: 5 });
    const house = building(w, 'house', 2, 50, 50);
    expect(lootFor(w, house, 1)).toEqual({ wood: Math.floor(BUILDINGS.house.cost.wood! * BALANCE.lootFraction.building) });
  });

  it('accumulates totals for the endgame across kills and players', () => {
    const w = arena();
    for (let i = 0; i < 3; i++) kill(w, w.spawnUnit('villager', { x: 60 + i * 2, z: 60 }, 2), 1);
    kill(w, w.spawnUnit('villager', { x: 30, z: 30 }, 1), 2);
    expect(w.players.get(1)!.looted.food).toBe(15);
    expect(w.players.get(2)!.looted.food).toBe(5);
    expect(w.players.get(3)!.looted.food).toBe(0);
  });
});

describe('loot totals in saves', () => {
  let map: ReturnType<typeof generateMap>;
  beforeAll(() => {
    map = generateMap(17, 2);
  }, 30_000);

  it('round-trips looted totals and loads pre-loot (v2-v6) saves with zero', () => {
    const w = new World(map.hf, map.layout);
    w.seed = 17;
    const enemy = [...w.units.values()].find((u) => u.owner === 2 && u.kind === 'villager')!;
    kill(w, enemy, 1);
    expect(w.players.get(1)!.looted.food).toBe(5);
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    const restored = deserializeWorld(data, map.hf);
    expect(restored.players.get(1)!.looted).toEqual({ food: 5, wood: 0, gold: 0, stone: 0 });
    expect(serializeWorld(restored)).toEqual(serializeWorld(w));

    // Every pre-loot version (v2 research .. v6 repair) loads with zero; any stray total is dropped.
    for (const version of [2, 3, 4, 5, 6]) {
      const legacy = JSON.parse(JSON.stringify(data));
      legacy.version = version;
      if (version < 6) for (const p of legacy.players) delete p.looted;
      const old = deserializeWorld(legacy, map.hf);
      expect(old.players.get(1)!.looted).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
    }

    data.players[0].looted = { food: -1, wood: 0, gold: 0, stone: 0 };
    expect(() => deserializeWorld(data, map.hf)).toThrow('looted');
  }, 30_000);
});
