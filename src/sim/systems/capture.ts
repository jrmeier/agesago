import { CAPTURE, maxCapturePoints } from '../../core/buildings';
import { GAIA, type Building, type PlayerId } from '../../core/types';
import type { World } from '../World';
import { orderCancelUpgrade } from './buildingUpgrade';
import { ejectAll } from './defence';
import { releaseTending } from './livestock';
import { orderCancelResearch } from './research';
import { orderCancelTrain } from './train';

/**
 * Building capture (M18-4, after 0 A.D.'s Capturable). Every complete building with
 * maxCapturePoints > 0 splits that many capture points (cp) between the players (Gaia included).
 * The owner holds them all until someone captures: a capturing unit takes cp from every player
 * hostile to it (proportionally, as 0 A.D.'s Reduce does) and adds what it took to its own
 * player. Garrisoned units and the owner's territory win cp back for the owner; a building on
 * another player's land slowly goes to that territory's owner. When the owner's share hits 0
 * the player holding the most takes the building (captureBuilding).
 */

/** Can `kind`'s buildings ever be captured (walls, gates and farms can't)? */
export function capturable(b: Building): boolean {
  return b.complete && b.hp > 0 && maxCapturePoints(b.kind) > 0;
}

/** Does capturing by `by` take points from `holder`? Gaia is everyone's rival here, allies are not. */
function rivals(world: World, by: PlayerId, holder: PlayerId): boolean {
  return by !== holder && (by === GAIA || holder === GAIA || world.areEnemies(by, holder));
}

/** May `by`'s units capture `b` (an enemy's or a neutral building)? */
export function canCapture(world: World, by: PlayerId, b: Building): boolean {
  return by !== GAIA && capturable(b) && rivals(world, by, b.owner);
}

/** Capture points per player (index = player id), owner full when untouched. A fresh copy. */
export function capturePointsOf(world: World, b: Building): number[] {
  const slots = slotCount(world, b);
  const cp = new Array<number>(slots).fill(0);
  if (b.capture) for (let i = 0; i < b.capture.length && i < slots; i++) cp[i] = b.capture[i];
  else cp[b.owner] = maxCapturePoints(b.kind);
  return cp;
}

function slotCount(world: World, b: Building): number {
  let n = Math.max(b.owner, (b.capture?.length ?? 0) - 1);
  for (const id of world.players.keys()) n = Math.max(n, id);
  return n + 1;
}

/**
 * `by` captures `amount` cp of `b` (0 A.D. Capturable.Reduce): the amount is spread evenly over
 * the rivals that still hold any (a rival running dry passes its share on), and everything taken
 * goes to `by`. Changes the owner when its share reaches 0. Returns the cp taken.
 */
export function reduceCapturePoints(world: World, b: Building, amount: number, by: PlayerId): number {
  if (amount <= 0 || !capturable(b)) return 0;
  const cp = capturePointsOf(world, b);
  const max = maxCapturePoints(b.kind);
  let holders = 0;
  for (let i = 0; i < cp.length; i++) if (cp[i] > 0 && rivals(world, by, i)) holders++;
  if (!holders) return 0;
  let share = amount / holders;
  let taken = 0;
  while (share > 1e-6) {
    holders = 0;
    for (let i = 0; i < cp.length; i++) {
      if (cp[i] <= 0 || !rivals(world, by, i)) continue;
      if (cp[i] > share) {
        cp[i] -= share;
        taken += share;
        holders++;
      } else {
        taken += cp[i];
        cp[i] = 0;
      }
    }
    share = holders ? (amount - taken) / holders : 0;
  }
  if (taken <= 0) return 0;
  cp[by] += taken;
  // Keep the total exact, so rounding never leaves a sliver behind.
  let sum = 0;
  for (const v of cp) sum += v;
  cp[by] += max - sum;
  store(b, cp, max);
  if (cp[b.owner] <= 1e-6) {
    let best = b.owner;
    for (let i = 0; i < cp.length; i++) if (cp[i] > cp[best] + 1e-9) best = i;
    if (best !== b.owner) captureBuilding(world, b, best);
  }
  return taken;
}

/** Save cp on the building; back to absent once the owner holds them all again. */
function store(b: Building, cp: number[], max: number): void {
  if (cp[b.owner] >= max - 1e-6) delete b.capture;
  else b.capture = cp;
}

/**
 * How many cp per second the owner wins back on its own: each occupant, plus the home territory
 * (connected to a root; a cut-off outpost is decaying and gets no help).
 */
export function regenRate(world: World, b: Building): number {
  if (b.owner === GAIA) return 0;
  let rate = (b.occupants?.length ?? 0) * CAPTURE.garrisonRegen;
  if (world.territoryOwner(b.pos) === b.owner && world.isConnected(b.pos)) rate += CAPTURE.territoryRegen;
  return rate;
}

/**
 * Per tick: owners win back cp (garrison, own territory) on buildings someone has been
 * capturing, and a building on a rival's territory drifts to that territory's owner.
 */
export function captureSystem(world: World, dt: number): void {
  for (const b of [...world.buildings.values()]) {
    if (!capturable(b)) continue;
    if (b.capture) {
      const rate = regenRate(world, b);
      if (rate > 0) reduceCapturePoints(world, b, rate * dt, b.owner);
    }
    const land = world.territoryOwner(b.pos);
    if (land !== GAIA && land !== b.owner && rivals(world, land, b.owner) && world.buildings.get(b.id) === b) {
      reduceCapturePoints(world, b, CAPTURE.enemyTerritoryRegen * dt, land);
    }
  }
}

/**
 * Hand `b` to `to`. The old owner gets its queued training, research and upgrade refunded and
 * its garrison stepped out; rally, farmer and tending claims go. Tier and hp stay. Pop cap,
 * territory, fog and the victory check follow the new owner on their own. Emits 'captured'.
 */
export function captureBuilding(world: World, b: Building, to: PlayerId): void {
  const prev = b.owner;
  if (prev === to) return;
  if (prev !== GAIA) {
    while (b.queueKinds?.length) orderCancelTrain(world, b.id, b.queueKinds.length - 1);
    while (b.research?.length) orderCancelResearch(world, b.id, b.research.length - 1);
    if (b.upgrading) orderCancelUpgrade(world, b.id, prev);
  }
  b.queue = 0;
  b.queueKinds = [];
  delete b.queueCounts;
  b.productionQueue = [];
  b.progress = 0;
  delete b.research;
  delete b.researchProgress;
  delete b.upgrading;
  ejectAll(world, b);
  const tenders = [...world.units.values()].filter((u) => u.tendingCorral === b.id).map((u) => u.id);
  if (tenders.length) releaseTending(world, tenders);
  world.farmers.delete(b.id);
  b.owner = to;
  b.rally = undefined;
  b.cooldown = 0;
  const max = maxCapturePoints(b.kind);
  if (b.capture && b.capture[to] >= max - 1e-6) delete b.capture;
  world.events.emit({ type: 'captured', id: b.id, kind: b.kind, owner: to, previousOwner: prev, pos: { x: b.pos.x, z: b.pos.z } });
  world.refreshFog();
  if (prev === world.localPlayer || to === world.localPlayer) world.emitStock();
}
