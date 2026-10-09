import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout } from '../core/types';
import { World } from './World';

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
    expect(w.townCenter.owner).toBe(1);
    expect(w.popOf(1)).toBe(1);
    expect(w.popOf(2)).toBe(1);
    w.stockOf(2).food = 500;
    expect(w.stock.food).toBe(0);
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
