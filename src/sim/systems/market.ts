import { MARKET } from '../../core/buildings';
import type {
  Building,
  EntityId,
  MarketResource,
  PlayerId,
  RejectReason,
  ResourceType,
  Unit,
} from '../../core/types';
import { rectDistance } from '../nav';
import type { World } from '../World';
import { releaseCombat } from './combat';
import { route } from './passage';
import { statOf } from './research';
import { buildingRect, siteApproach } from './sites';

/**
 * Market (M8-12): buy/sell lots of 100 for gold, tribute between players, and trade carts that
 * walk between two markets for gold. Prices live on PlayerState.prices (gold per 100, kept as
 * floats; trades charge them rounded). Trade carts are stateless apart from Unit.tradeWith:
 * on each arrival the cart works out which end it reached from where it stands.
 */

/** Resources sold at the market, in panel order. */
export const MARKET_RESOURCES: readonly MarketResource[] = ['food', 'wood', 'stone'];
/** Every trade moves this much of a resource. */
export const LOT = 100;
/** Arrivals farther than this from a market's footprint don't count as reaching it. */
const ARRIVE_SLACK = 2.5;

const reject = (world: World, owner: PlayerId, reason: RejectReason) => {
  if (owner === world.localPlayer) world.events.emit({ type: 'rejected', reason });
};

const isMarket = (b: Building | undefined): b is Building => !!b && b.kind === 'market' && b.complete;

/** Does `owner` have a finished market? */
export function hasMarket(world: World, owner: PlayerId): boolean {
  for (const b of world.buildings.values()) if (b.owner === owner && isMarket(b)) return true;
  return false;
}

/** Price change per trade for `owner` (Merchant Guilds halves it). */
export function priceStepOf(world: World, owner: PlayerId): number {
  return Math.max(0, statOf(world, owner, 'player', 'priceStep', MARKET.priceStep));
}

/** Fraction of a tribute `owner` loses in transit (Coinage lowers it). */
export function tributeFeeOf(world: World, owner: PlayerId): number {
  return Math.min(1, Math.max(0, statOf(world, owner, 'player', 'tributeFee', MARKET.tributeFee)));
}

/** Gold it costs to buy 100 at `price`. */
export function buyCost(price: number): number {
  return Math.round(price);
}

/** Gold you get for selling 100 at `price`. */
export function sellGain(price: number): number {
  return Math.round(price * MARKET.sellFactor);
}

/** Why `owner` can't buy/sell 100 `resource` right now, or null if they can. */
export function marketTradeBlock(
  world: World,
  owner: PlayerId,
  resource: MarketResource,
  side: 'buy' | 'sell'
): RejectReason | null {
  const p = world.players.get(owner);
  if (!p || !(resource in p.prices)) return 'invalid-target';
  if (!hasMarket(world, owner)) return 'requires';
  if (side === 'buy' && p.stock.gold < buyCost(p.prices[resource])) return 'insufficient-resources';
  if (side === 'sell' && p.stock[resource] < LOT) return 'insufficient-resources';
  return null;
}

function roundedPrices(prices: Record<MarketResource, number>): Record<MarketResource, number> {
  return { food: Math.round(prices.food), wood: Math.round(prices.wood), stone: Math.round(prices.stone) };
}

/** Last rounded prices emitted per player, so drift only reports visible changes. */
const lastEmitted = new WeakMap<World, Map<PlayerId, string>>();

function emitPrices(world: World, owner: PlayerId): void {
  const p = world.players.get(owner);
  if (!p) return;
  const prices = roundedPrices(p.prices);
  let seen = lastEmitted.get(world);
  if (!seen) lastEmitted.set(world, (seen = new Map()));
  seen.set(owner, `${prices.food},${prices.wood},${prices.stone}`);
  world.events.emit({ type: 'marketPrices', owner, prices });
}

const clampPrice = (v: number) => Math.min(MARKET.maxPrice, Math.max(MARKET.minPrice, v));

/** 'marketTrade': buy or sell one lot at the issuer's prices. */
export function orderMarketTrade(world: World, owner: PlayerId, resource: MarketResource, side: 'buy' | 'sell'): void {
  const block = marketTradeBlock(world, owner, resource, side);
  if (block) {
    reject(world, owner, block);
    return;
  }
  const p = world.players.get(owner)!;
  const price = p.prices[resource];
  const step = MARKET.basePrice * priceStepOf(world, owner);
  if (side === 'buy') {
    p.stock.gold -= buyCost(price);
    p.stock[resource] += LOT;
    p.prices[resource] = clampPrice(price + step);
  } else {
    p.stock[resource] -= LOT;
    p.stock.gold += sellGain(price);
    p.prices[resource] = clampPrice(price - step);
  }
  if (owner === world.localPlayer) world.emitStock();
  emitPrices(world, owner);
}

/** 'tribute': send up to `amount` of a resource (clamped to stock); the fee is lost on the way. */
export function orderTribute(world: World, from: PlayerId, to: PlayerId, resource: ResourceType, amount: number): void {
  const giver = world.players.get(from);
  const taker = world.players.get(to);
  if (!giver || !taker || from === to || world.isDefeated(to) || !(resource in giver.stock)) {
    reject(world, from, 'invalid-target');
    return;
  }
  if (!hasMarket(world, from)) {
    reject(world, from, 'requires');
    return;
  }
  const sent = Math.floor(Math.min(Number.isFinite(amount) ? amount : 0, giver.stock[resource]));
  if (sent <= 0) {
    reject(world, from, 'insufficient-resources');
    return;
  }
  const received = Math.floor(sent * (1 - tributeFeeOf(world, from)));
  giver.stock[resource] -= sent;
  taker.stock[resource] += received;
  if (from === world.localPlayer || to === world.localPlayer) world.emitStock();
  world.events.emit({ type: 'tribute', from, to, resource, amount: received });
}

// ---- Trade carts ----

/** Can `owner`'s carts trade with `b`? Own or allied finished markets only. */
export function canTradeWith(world: World, owner: PlayerId, b: Building | undefined): b is Building {
  return isMarket(b) && b.owner !== 0 && !world.areEnemies(owner, b.owner) && !world.isDefeated(b.owner);
}

/** The cart's home: the nearest of its owner's finished markets other than the one it trades with. */
export function homeMarket(world: World, u: Unit, exclude: EntityId | undefined): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings.values()) {
    if (b.owner !== u.owner || b.id === exclude || !isMarket(b)) continue;
    const d = Math.hypot(b.pos.x - u.pos.x, b.pos.z - u.pos.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Gold a cart earns per round trip between two markets. */
export function tradeGold(home: Building, target: Building): number {
  return Math.round(MARKET.goldPerDistance * Math.hypot(home.pos.x - target.pos.x, home.pos.z - target.pos.z));
}

const gap = (u: Unit, b: Building) => rectDistance(u.pos, buildingRect(b));

function sendTo(world: World, u: Unit, b: Building): boolean {
  const path = route(world, u.owner, u.pos, siteApproach(u.pos, b));
  if (!path) return false;
  u.path = path;
  world.setState(u, 'moving');
  return true;
}

function stopTrading(world: World, u: Unit): void {
  delete u.tradeWith;
  u.path = [];
  world.setState(u, 'idle');
}

/** 'trade': carts walk between their home market and `marketId` (own or allied, never an enemy's). */
export function orderTrade(world: World, unitIds: EntityId[], marketId: EntityId, by: PlayerId): void {
  const target = world.buildings.get(marketId);
  const carts = unitIds.map((id) => world.units.get(id)).filter((u): u is Unit => !!u && u.kind === 'tradeCart');
  if (!carts.length || !canTradeWith(world, by, target)) {
    reject(world, by, 'invalid-target');
    return;
  }
  releaseCombat(world, carts.map((u) => u.id));
  let sent = 0;
  let homeless = 0;
  for (const u of carts) {
    const home = homeMarket(world, u, target.id);
    if (!home) {
      homeless++;
      continue;
    }
    u.target = null;
    u.tradeWith = target.id;
    // Already at the far end: start by heading home.
    const leg = gap(u, target) <= ARRIVE_SLACK ? home : target;
    if (sendTo(world, u, leg)) sent++;
    else delete u.tradeWith;
  }
  if (!sent) reject(world, by, homeless === carts.length ? 'requires' : 'unreachable');
}

/** Any order other than 'trade' (or a stance change) takes carts off their route. */
export function releaseTrade(world: World, unitIds: readonly EntityId[]): void {
  for (const id of unitIds) {
    const u = world.units.get(id);
    if (u?.tradeWith !== undefined) delete u.tradeWith;
  }
}

/** On arrival at either end turn around; paid at home. A lost market (or ally) sends the cart idle. */
function tradeSystem(world: World, arrived: readonly Unit[]): void {
  for (const u of world.units.values()) {
    if (u.tradeWith === undefined) continue;
    if (!canTradeWith(world, u.owner, world.buildings.get(u.tradeWith))) stopTrading(world, u);
  }
  for (const u of arrived) {
    if (u.tradeWith === undefined || !world.units.has(u.id)) continue;
    const target = world.buildings.get(u.tradeWith)!;
    const home = homeMarket(world, u, target.id);
    if (!home) {
      stopTrading(world, u);
      continue;
    }
    const toTarget = gap(u, target);
    const toHome = gap(u, home);
    let next: Building;
    if (toTarget < toHome && toTarget <= ARRIVE_SLACK) {
      next = home;
    } else {
      if (toHome <= ARRIVE_SLACK) {
        const gold = tradeGold(home, target);
        const p = world.players.get(u.owner);
        if (p && gold > 0) {
          p.stock.gold += gold;
          if (u.owner === world.localPlayer) world.emitStock();
          world.events.emit({ type: 'traded', owner: u.owner, id: u.id, gold });
        }
      }
      next = target;
    }
    if (!sendTo(world, u, next)) stopTrading(world, u);
  }
}

/** Prices drift back toward base (MARKET.recovery of the gap per second). */
function priceSystem(world: World, dt: number): void {
  const k = Math.min(1, MARKET.recovery * dt);
  for (const [id, p] of world.players) {
    let moved = false;
    for (const r of MARKET_RESOURCES) {
      const gapToBase = MARKET.basePrice - p.prices[r];
      if (gapToBase === 0) continue;
      p.prices[r] = Math.abs(gapToBase) < 0.01 ? MARKET.basePrice : p.prices[r] + gapToBase * k;
      moved = true;
    }
    if (!moved) continue;
    const r = roundedPrices(p.prices);
    if (lastEmitted.get(world)?.get(id) !== `${r.food},${r.wood},${r.stone}`) emitPrices(world, id);
  }
}

/** Market tick: price recovery and trade-cart round trips. Runs after movement. */
export function marketSystem(world: World, dt: number, arrived: readonly Unit[]): void {
  priceSystem(world, dt);
  tradeSystem(world, arrived);
}
