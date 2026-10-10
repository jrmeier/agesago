import { describe, expect, it } from 'vitest';
import { BUILDINGS, footprintRadius } from '../core/buildings';
import { GRASS_ONLY, type Building, type Heightfield, type MapLayout } from '../core/types';
import { resolveTradeOrder } from '../input/orders';
import { World, defaultPlayers } from '../sim/World';
import { marketRows, selectedMarket, tributePreview, tributeTargets } from './market';

function world(): World {
  const hf: Heightfield = {
    width: 80, depth: 80, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80, forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = {
    townCenter: { x: 20, z: 20 }, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 60, z: 60 }, villagers: [], scouts: [] }],
  };
  return new World(hf, layout, defaultPlayers(2));
}

function market(w: World, owner = 1, complete = true): Building {
  const b: Building = {
    id: w.allocId(), kind: 'market', owner, hp: BUILDINGS.market.hp, maxHp: BUILDINGS.market.hp, pos: { x: 40, z: 40 },
    rot: 0, radius: footprintRadius('market'), complete, buildProgress: complete ? 1 : 0, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

describe('market panel model', () => {
  it('shows buy / sell prices and why a button is disabled', () => {
    const w = world();
    market(w);
    w.stock.gold = 50;
    w.stock.wood = 250;
    w.stock.food = 0;
    const rows = marketRows(w, 1);
    expect(rows.map((r) => r.resource)).toEqual(['food', 'wood', 'stone']);
    const wood = rows.find((r) => r.resource === 'wood')!;
    expect(wood).toMatchObject({ buy: 100, sell: 70, buyWhy: 'Need 100 gold', sellWhy: null });
    expect(rows[0].sellWhy).toBe('Need 100 food');
  });

  it('needs a finished market', () => {
    const w = world();
    market(w, 1, false);
    w.stock.wood = 500;
    expect(marketRows(w, 1)[1].sellWhy).toBe('Needs a market');
  });

  it('lists tribute targets and previews the fee', () => {
    const w = world();
    // Enemies are never offered; an ally is.
    expect(tributeTargets(w, 1)).toEqual([]);
    (w.players.get(2)!.player as { team: number }).team = w.players.get(1)!.player.team;
    expect(tributeTargets(w, 1).map((t) => t.id)).toEqual([2]);
    w.stock.stone = 300;
    expect(tributePreview(w, 1, 'stone', 500)).toEqual({ sent: 300, received: 210, fee: 0.3 });
  });

  it('only opens for a single own finished market', () => {
    const w = world();
    const mine = market(w);
    const theirs = market(w, 2);
    expect(selectedMarket(w, new Set([mine.id]), 1)).toBe(mine);
    expect(selectedMarket(w, new Set([theirs.id]), 1)).toBeNull();
    expect(selectedMarket(w, new Set([mine.id, 1]), 1)).toBeNull();
  });
});

describe('trade order', () => {
  const enemy = (o: number) => o === 2;
  const m = { id: 7, kind: 'market' as const, complete: true, owner: 1 };

  it('sends trade carts to an own or allied market', () => {
    expect(resolveTradeOrder([3, 4], m, enemy)).toEqual({ type: 'trade', unitIds: [3, 4], marketId: 7 });
    expect(resolveTradeOrder([3], { ...m, owner: 3 }, enemy)).not.toBeNull();
  });

  it('ignores enemy markets, foundations, other buildings and no carts', () => {
    expect(resolveTradeOrder([3], { ...m, owner: 2 }, enemy)).toBeNull();
    expect(resolveTradeOrder([3], { ...m, complete: false }, enemy)).toBeNull();
    expect(resolveTradeOrder([3], { ...m, kind: 'house' }, enemy)).toBeNull();
    expect(resolveTradeOrder([], m, enemy)).toBeNull();
    expect(resolveTradeOrder([3], undefined, enemy)).toBeNull();
  });
});
