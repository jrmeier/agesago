import { describe, expect, it } from 'vitest';
import { BUILDINGS, MARKET, footprintRadius } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type SimEvent } from '../core/types';
import { World, defaultPlayers } from './World';
import { completeResearch } from './systems/research';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld } from './serialize';
import { LOT, buyCost, sellGain, tradeGold } from './systems/market';

function flat(): Heightfield {
  return {
    width: 120,
    depth: 120,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 120 && z <= 120,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

/** Two players: 1 at (20,20), 2 at (100,100). `allied` puts them on one team. */
function world(allied = false): World {
  const layout: MapLayout = {
    townCenter: { x: 20, z: 20 },
    villagers: [{ x: 20, z: 25 }],
    scouts: [],
    nodes: [],
    props: [],
    extraStarts: [{ townCenter: { x: 100, z: 100 }, villagers: [{ x: 100, z: 95 }], scouts: [] }],
  };
  const players = defaultPlayers(2);
  if (allied) players[1].team = players[0].team;
  return new World(flat(), layout, players);
}

function addBuilding(w: World, kind: BuildingKind, x: number, z: number, owner = 1): Building {
  const b: Building = {
    id: w.allocId(), kind, owner, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

function on<T extends SimEvent['type']>(w: World, type: T): Extract<SimEvent, { type: T }>[] {
  const out: Extract<SimEvent, { type: T }>[] = [];
  w.events.on(type, (e) => out.push(e as Extract<SimEvent, { type: T }>));
  return out;
}

function run(w: World, seconds: number) {
  for (let t = 0; t < seconds * 20; t++) w.tick(0.05);
}

describe('market buy/sell', () => {
  it('needs a finished market', () => {
    const w = world();
    const rejected = on(w, 'rejected');
    w.stock.wood = 500;
    w.dispatch({ type: 'marketTrade', resource: 'wood', side: 'sell' });
    expect(w.stock.wood).toBe(500);
    expect(rejected.at(-1)?.reason).toBe('requires');
    const m = addBuilding(w, 'market', 40, 40);
    m.complete = false;
    w.dispatch({ type: 'marketTrade', resource: 'wood', side: 'sell' });
    expect(w.stock.wood).toBe(500);
  });

  it('sells at price × sellFactor, buys at price, and moves the price each lot', () => {
    const w = world();
    addBuilding(w, 'market', 40, 40);
    const prices = on(w, 'marketPrices');
    const p = w.players.get(1)!;
    w.stock.wood = 1000;
    w.stock.gold = 0;
    w.dispatch({ type: 'marketTrade', resource: 'wood', side: 'sell' });
    expect(w.stock.wood).toBe(900);
    expect(w.stock.gold).toBe(sellGain(MARKET.basePrice));
    expect(p.prices.wood).toBeCloseTo(MARKET.basePrice * (1 - MARKET.priceStep));
    expect(prices.at(-1)).toMatchObject({ owner: 1, prices: { wood: 97, food: 100, stone: 100 } });

    w.stock.gold = 500;
    const price = p.prices.food;
    w.dispatch({ type: 'marketTrade', resource: 'food', side: 'buy' });
    expect(w.stock.gold).toBe(500 - buyCost(price));
    expect(w.stock.food).toBeGreaterThanOrEqual(LOT);
    expect(p.prices.food).toBeGreaterThan(price);
  });

  it('repeated sells lower the price to the floor, and it recovers over time', () => {
    const w = world();
    addBuilding(w, 'market', 40, 40);
    const p = w.players.get(1)!;
    w.stock.wood = 100_000;
    let last = p.prices.wood;
    for (let i = 0; i < 10; i++) {
      w.dispatch({ type: 'marketTrade', resource: 'wood', side: 'sell' });
      expect(p.prices.wood).toBeLessThan(last);
      last = p.prices.wood;
    }
    for (let i = 0; i < 100; i++) w.dispatch({ type: 'marketTrade', resource: 'wood', side: 'sell' });
    expect(p.prices.wood).toBe(MARKET.minPrice);
    run(w, 60);
    expect(p.prices.wood).toBeGreaterThan(MARKET.minPrice);
    expect(p.prices.wood).toBeLessThan(MARKET.basePrice);
    const mid = p.prices.wood;
    run(w, 600);
    expect(p.prices.wood).toBeGreaterThan(mid);
    expect(p.prices.wood).toBeGreaterThan(MARKET.basePrice - 10);
  });

  it('buys push the price up to the cap', () => {
    const w = world();
    addBuilding(w, 'market', 40, 40);
    w.stock.gold = 1_000_000;
    for (let i = 0; i < 200; i++) w.dispatch({ type: 'marketTrade', resource: 'stone', side: 'buy' });
    expect(w.players.get(1)!.prices.stone).toBe(MARKET.maxPrice);
  });

  it('never lets gold go negative, and rejects selling under a lot', () => {
    const w = world();
    addBuilding(w, 'market', 40, 40);
    const rejected = on(w, 'rejected');
    w.stock.gold = 99;
    w.stock.food = 0;
    w.dispatch({ type: 'marketTrade', resource: 'food', side: 'buy' });
    expect(w.stock.gold).toBe(99);
    expect(w.stock.food).toBe(0);
    expect(rejected.at(-1)?.reason).toBe('insufficient-resources');
    w.stock.gold = 1000;
    for (let i = 0; i < 50; i++) w.dispatch({ type: 'marketTrade', resource: 'food', side: 'buy' });
    expect(w.stock.gold).toBeGreaterThanOrEqual(0);
    w.stock.stone = 99;
    w.dispatch({ type: 'marketTrade', resource: 'stone', side: 'sell' });
    expect(w.stock.stone).toBe(99);
  });

  it('Merchant Guilds halves the price step', () => {
    const w = world();
    addBuilding(w, 'market', 40, 40);
    completeResearch(w, 1, 'merchantGuilds');
    w.stock.wood = 100;
    w.dispatch({ type: 'marketTrade', resource: 'wood', side: 'sell' });
    expect(w.players.get(1)!.prices.wood).toBeCloseTo(MARKET.basePrice * (1 - MARKET.priceStep / 2));
  });
});

describe('tribute', () => {
  it('needs a market and loses the fee on the way', () => {
    const w = world(true);
    const tributes = on(w, 'tribute');
    w.stock.wood = 1000;
    w.dispatch({ type: 'tribute', to: 2, resource: 'wood', amount: 500 });
    expect(w.stock.wood).toBe(1000);
    addBuilding(w, 'market', 40, 40);
    const before = w.stockOf(2).wood;
    w.dispatch({ type: 'tribute', to: 2, resource: 'wood', amount: 500 });
    expect(w.stock.wood).toBe(500);
    expect(w.stockOf(2).wood - before).toBe(Math.floor(500 * (1 - MARKET.tributeFee)));
    expect(tributes.at(-1)).toMatchObject({ from: 1, to: 2, resource: 'wood', amount: 350 });
  });

  it('Coinage lowers the fee', () => {
    const w = world(true);
    addBuilding(w, 'market', 40, 40);
    completeResearch(w, 1, 'coinage');
    w.stock.gold = 1000;
    const before = w.stockOf(2).gold;
    w.dispatch({ type: 'tribute', to: 2, resource: 'gold', amount: 100 });
    expect(w.stockOf(2).gold - before).toBe(90);
  });

  it('clamps to what you have and rejects sending to yourself', () => {
    const w = world(true);
    addBuilding(w, 'market', 40, 40);
    w.stock.stone = 40;
    const before = w.stockOf(2).stone;
    w.dispatch({ type: 'tribute', to: 2, resource: 'stone', amount: 500 });
    expect(w.stock.stone).toBe(0);
    expect(w.stockOf(2).stone - before).toBe(28);
    w.stock.food = 300;
    w.dispatch({ type: 'tribute', to: 1, resource: 'food', amount: 100 });
    expect(w.stock.food).toBe(300);
  });

  it('refuses to pay an enemy', () => {
    const w = world(false);
    addBuilding(w, 'market', 40, 40);
    w.stock.wood = 1000;
    const before = w.stockOf(2).wood;
    w.dispatch({ type: 'tribute', to: 2, resource: 'wood', amount: 500 });
    expect(w.stock.wood).toBe(1000);
    expect(w.stockOf(2).wood).toBe(before);
  });

  it('rejects resources that are not real (prototype keys)', () => {
    const w = world(true);
    addBuilding(w, 'market', 40, 40);
    const gold = w.stock.gold;
    w.dispatch({ type: 'marketTrade', resource: 'constructor' as never, side: 'sell' });
    w.dispatch({ type: 'tribute', to: 2, resource: 'constructor' as never, amount: 1 });
    expect(w.stock.gold).toBe(gold);
    expect(Object.keys(w.stock).sort()).toEqual(['food', 'gold', 'stone', 'wood']);
  });
});

describe('trade carts', () => {
  /** A cart at home trading with a market `dist` away along x; returns gold earned in `seconds`. */
  function income(dist: number, seconds: number, allied = true): { gold: number; trips: number } {
    const w = world(allied);
    const home = addBuilding(w, 'market', 20, 50, 1);
    const far = addBuilding(w, 'market', 20 + dist, 50, allied ? 2 : 1);
    const cart = w.spawnUnit('tradeCart', { x: 20, z: 54 }, 1);
    const traded = on(w, 'traded');
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: far.id });
    expect(cart.tradeWith).toBe(far.id);
    const start = w.stock.gold;
    run(w, seconds);
    expect(traded.every((e) => e.gold === tradeGold(home, far))).toBe(true);
    return { gold: w.stock.gold - start, trips: traded.length };
  }

  it('walks out and back, earning gold that grows with distance', () => {
    const near = income(20, 120);
    const far = income(60, 120);
    expect(near.trips).toBeGreaterThan(0);
    expect(far.trips).toBeGreaterThan(0);
    expect(tradeGold({ pos: { x: 0, z: 0 } } as Building, { pos: { x: 60, z: 0 } } as Building))
      .toBeGreaterThan(tradeGold({ pos: { x: 0, z: 0 } } as Building, { pos: { x: 20, z: 0 } } as Building));
    // Per trip pays more far away (time per trip is longer, so compare per trip).
    expect(far.gold / far.trips).toBeGreaterThan(near.gold / near.trips);
  });

  it('can trade between two of your own markets', () => {
    expect(income(40, 90, false).trips).toBeGreaterThan(0);
  });

  it('rejects enemy markets', () => {
    const w = world(false);
    addBuilding(w, 'market', 20, 50, 1);
    const enemy = addBuilding(w, 'market', 70, 50, 2);
    const cart = w.spawnUnit('tradeCart', { x: 20, z: 54 }, 1);
    const rejected = on(w, 'rejected');
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: enemy.id });
    expect(cart.tradeWith).toBeUndefined();
    expect(rejected.at(-1)?.reason).toBe('invalid-target');
  });

  it('needs a home market', () => {
    const w = world(true);
    const ally = addBuilding(w, 'market', 70, 50, 2);
    const cart = w.spawnUnit('tradeCart', { x: 20, z: 54 }, 1);
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: ally.id });
    expect(cart.tradeWith).toBeUndefined();
  });

  it('goes idle when the target market is destroyed', () => {
    const w = world(true);
    addBuilding(w, 'market', 20, 50, 1);
    const far = addBuilding(w, 'market', 70, 50, 2);
    const cart = w.spawnUnit('tradeCart', { x: 20, z: 54 }, 1);
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: far.id });
    run(w, 2);
    expect(cart.state).toBe('moving');
    w.buildings.delete(far.id);
    run(w, 0.1);
    expect(cart.tradeWith).toBeUndefined();
    expect(cart.state).toBe('idle');
  });

  it('another order takes the cart off its route', () => {
    const w = world(true);
    addBuilding(w, 'market', 20, 50, 1);
    const far = addBuilding(w, 'market', 70, 50, 2);
    const cart = w.spawnUnit('tradeCart', { x: 20, z: 54 }, 1);
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: far.id });
    w.dispatch({ type: 'move', unitIds: [cart.id], target: { x: 30, z: 70 } });
    expect(cart.tradeWith).toBeUndefined();
  });
});

describe('saves', () => {
  it('keep prices and a cart\'s trade partner', () => {
    const { hf, layout } = generateMap(7, 2);
    const w = new World(hf, layout);
    w.seed = 7;
    const p = w.players.get(1)!;
    p.prices.wood = 61.5;
    p.prices.stone = 212;
    const cart = w.spawnUnit('tradeCart', w.townCenter!.pos, 1);
    cart.tradeWith = 1;
    const back = deserializeWorld(serializeWorld(w), hf);
    expect(back.players.get(1)!.prices).toEqual({ food: 100, wood: 61.5, stone: 212 });
    expect(back.units.get(cart.id)?.tradeWith).toBe(1);
  });
});
