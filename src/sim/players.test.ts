import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout } from '../core/types';
import { BALANCE, startingStockPresets } from './balance';
import { World, defaultPlayers } from './World';

function flat(): Heightfield {
  return {
    width: 80,
    depth: 80,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function twoPlayers(): World {
  const layout: MapLayout = {
    townCenter: { x: 15, z: 15 },
    villagers: [{ x: 15, z: 20 }],
    scouts: [],
    extraStarts: [{ townCenter: { x: 65, z: 65 }, villagers: [{ x: 65, z: 60 }], scouts: [] }],
    nodes: [],
    props: [],
  };
  return new World(flat(), layout);
}

describe('players and ownership', () => {
  it('gives each start its own Town Center, units, stock, fog and pop', () => {
    const w = twoPlayers();
    expect(w.players.size).toBe(2);
    expect(w.townCenterOf(1)!.pos).toEqual({ x: 15, z: 15 });
    expect(w.townCenterOf(2)!.pos).toEqual({ x: 65, z: 65 });
    expect(w.townCenter!.owner).toBe(1);
    expect(w.popOf(1)).toBe(1);
    expect(w.popOf(2)).toBe(1);
    w.stockOf(2).food = 500;
    expect(w.stock.food).toBe(BALANCE.startingStock.food);
    expect(w.visibilityOf(1).isVisible(15, 15)).toBe(true);
    expect(w.visibilityOf(1).isExplored(65, 65)).toBe(false);
    expect(w.visibilityOf(2).isVisible(65, 65)).toBe(true);
    expect(w.areEnemies(1, 2)).toBe(true);
    expect(w.areEnemies(1, 0)).toBe(false);
  });

  it('ignores commands for units and buildings the issuer does not own', () => {
    const w = twoPlayers();
    const mine = [...w.units.values()].find((u) => u.owner === 1)!;
    const theirs = [...w.units.values()].find((u) => u.owner === 2)!;
    w.dispatch({ type: 'move', unitIds: [mine.id, theirs.id], target: { x: 30, z: 30 } });
    expect(mine.path.length).toBeGreaterThan(0);
    expect(theirs.path.length).toBe(0);

    w.stockOf(1).food = 100;
    w.dispatch({ type: 'train', buildingId: w.townCenterOf(2)!.id });
    expect(w.townCenterOf(2)!.queue).toBe(0);
    w.stockOf(2).food = 100;
    w.dispatch({ type: 'train', buildingId: w.townCenterOf(2)!.id }, 2);
    expect(w.townCenterOf(2)!.queue).toBe(1);
    expect(w.stockOf(2).food).toBe(50);
    expect(w.stockOf(1).food).toBe(100);
  });

  it('trains units that spawn for the building owner', () => {
    const w = twoPlayers();
    w.stockOf(2).food = 50;
    w.dispatch({ type: 'train', buildingId: w.townCenterOf(2)!.id }, 2);
    for (let i = 0; i < 20 * 9; i++) w.tick(0.05);
    expect(w.popOf(2)).toBe(2);
    expect(w.popOf(1)).toBe(1);
  });
});

describe('training queues', () => {
  it('cancels a queued unit and refunds its cost', () => {
    const w = twoPlayers();
    const tc = w.townCenterOf(1)!;
    w.stock.food = 150;
    w.dispatch({ type: 'train', buildingId: tc.id });
    w.dispatch({ type: 'train', buildingId: tc.id });
    expect(tc.queue).toBe(2);
    expect(w.stock.food).toBe(50);
    w.dispatch({ type: 'cancelTrain', buildingId: tc.id, index: 1 });
    expect(tc.queue).toBe(1);
    expect(tc.queueKinds).toEqual(['villager']);
    expect(w.stock.food).toBe(100);
    // Another player can't cancel it.
    w.dispatch({ type: 'cancelTrain', buildingId: tc.id, index: 0 }, 2);
    expect(tc.queue).toBe(1);
  });
});


describe('new-game player options', () => {
  it('assigns difficulty only to AI and teams to the requested groups', () => {
    const roster = defaultPlayers(4, undefined, { difficulty: 'hard', teams: 'pairs' });
    expect(roster.map(p => p.team)).toEqual([1, 1, 2, 2]);
    expect(roster.map(p => p.difficulty)).toEqual([undefined, 'hard', 'hard', 'hard']);
    expect(defaultPlayers(3).map(p => p.team)).toEqual([1, 2, 3]);
    expect(defaultPlayers(3)[1].difficulty).toBe('moderate');
    expect(defaultPlayers(3, undefined, { teams: 'pairs' }).map(p => p.team)).toEqual([1, 2, 3]);
    expect(defaultPlayers(4, undefined, { teams: 'allied-rivals' }).map(p => p.team)).toEqual([1, 2, 2, 2]);
  });

  it('treats allied rivals as friends and awards victory to their team', () => {
    const layout: MapLayout = {
      townCenter: { x: 10, z: 10 }, villagers: [], scouts: [], nodes: [], props: [],
      extraStarts: [20, 40].map(x => ({ townCenter: { x, z: 50 }, villagers: [], scouts: [] })),
    };
    const w = new World(flat(), layout, defaultPlayers(3, undefined, { teams: 'allied-rivals' }));
    expect(w.areEnemies(2, 3)).toBe(false);
    expect(w.areEnemies(1, 2)).toBe(true);
    expect(w.areEnemies(1, 3)).toBe(true);
    const soldier = w.spawnUnit('hoplite', { x: 30, z: 50 }, 2);
    w.dispatch({ type: 'attack', unitIds: [soldier.id], targetId: w.townCenterOf(3)!.id }, 2);
    expect(w.combatState.has(soldier.id)).toBe(false);
    w.dispatch({ type: 'resign' }, 1);
    expect(w.gameOver).toEqual({ winners: [2, 3], reason: 'resign' });
  });

  it.each(['low', 'standard', 'high'] as const)('gives every player independent %s stock', preset => {
    const layout: MapLayout = {
      townCenter: { x: 15, z: 15 }, villagers: [], scouts: [], nodes: [], props: [],
      extraStarts: [{ townCenter: { x: 65, z: 65 }, villagers: [], scouts: [] }],
    };
    const w = new World(flat(), layout, defaultPlayers(2), preset);
    const multiplier = preset === 'low' ? 0.5 : preset === 'high' ? 3 : 1;
    for (const { stock } of w.players.values()) {
      expect(stock).toEqual(startingStockPresets[preset]);
      expect(stock).toEqual({ food: 200 * multiplier, wood: 200 * multiplier, gold: 100 * multiplier, stone: 100 * multiplier });
    }
    w.stock.food = 0;
    expect(w.stockOf(2).food).toBe(200 * multiplier);
    expect(startingStockPresets[preset].food).toBe(200 * multiplier);
  });
});
