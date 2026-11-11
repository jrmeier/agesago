import { GAIA, type Building, type EntityId, type PlayerId, type Vec2, type VictoryReason } from '../../core/types';
import { isAnimal } from '../../core/units';
import type { World } from '../World';
import { destroyBuilding, killUnit } from './combat';

export { DEFAULT_WONDER_SECONDS, defaultWonderRules, normalizeWonderRules, WONDER_SECONDS_MAX, WONDER_SECONDS_MIN, type WonderRules } from '../../core/wonder';

export interface GameResult {
  winners: PlayerId[];
  reason: VictoryReason;
}

/** The running wonder countdown: `building` (owned by `owner`) wins at `remaining` = 0. */
export interface WonderCountdown {
  building: EntityId;
  owner: PlayerId;
  /** Where the wonder stands (kept for the cancel ping after it is gone). */
  pos: Vec2;
  remaining: number;
}

function standing(world: World, c: WonderCountdown): Building | undefined {
  const b = world.buildings.get(c.building);
  return b && b.complete && b.kind === 'wonder' && b.owner === c.owner && !world.isDefeated(b.owner) ? b : undefined;
}

/** Earliest finished wonder still standing (ties by id, so every peer picks the same one). */
function earliestWonder(world: World): Building | undefined {
  let best: Building | undefined;
  for (const b of world.buildings.values()) {
    if (b.kind !== 'wonder' || !b.complete || b.owner === GAIA || world.isDefeated(b.owner)) continue;
    const t = b.completedAt ?? Infinity, bt = best?.completedAt ?? Infinity;
    if (!best || t < bt || (t === bt && b.id < best.id)) best = b;
  }
  return best;
}

function startCountdown(world: World, b: Building): void {
  world.wonder = { building: b.id, owner: b.owner, pos: { ...b.pos }, remaining: world.wonderRules.seconds };
  world.events.emit({ type: 'wonderStarted', id: b.id, owner: b.owner, pos: { ...b.pos }, remaining: world.wonderRules.seconds });
}

/** A wonder finished construction. Starts the countdown unless an earlier wonder already counts. */
export function wonderCompleted(world: World, b: Building): void {
  if (b.kind !== 'wonder') return;
  b.completedAt ??= world.time;
  if (!world.wonderRules.enabled || world.gameOver || world.wonder) return;
  startCountdown(world, b);
}

/**
 * Every tick: cancel the countdown when its wonder falls, hand it to the next-earliest standing
 * wonder (with a fresh timer), and award the match to the owner's team when it reaches zero.
 */
export function wonderSystem(world: World, dt: number): void {
  if (world.gameOver || !world.wonderRules.enabled) return;
  const c = world.wonder;
  if (c && !standing(world, c)) {
    world.wonder = null;
    world.events.emit({ type: 'wonderCancelled', id: c.building, owner: c.owner, pos: { ...c.pos } });
  }
  if (!world.wonder) {
    // Finished wonders normally announce themselves (wonderCompleted); this also covers
    // wonders placed complete by scenarios or earlier wonders still standing after a cancel.
    if (world.victoryClock > dt) return;
    const next = earliestWonder(world);
    if (!next) return;
    next.completedAt ??= world.time;
    startCountdown(world, next);
    return;
  }
  world.wonder.remaining = Math.max(0, world.wonder.remaining - dt);
  if (world.wonder.remaining > 0) return;
  const owner = world.wonder.owner;
  const winners = [...world.players.keys()].filter((id) => !world.isDefeated(id) && !world.areEnemies(owner, id));
  world.gameOver = { winners, reason: 'wonder' };
  world.events.emit({ type: 'gameOver', winners: [...winners], reason: 'wonder' });
}

function defeat(world: World, player: PlayerId, reason: 'conquest' | 'resign'): void {
  if (world.isDefeated(player)) return;
  world.defeatedPlayers.add(player);
  world.events.emit({ type: 'defeated', player, reason });
}

/** One scan per simulated second; maps may also be edited by scenario/test setup. */
export function victorySystem(world: World, dt: number, reason: 'conquest' | 'resign' = 'conquest'): void {
  if (world.gameOver) return;
  wonderSystem(world, dt);
  if (world.gameOver) return;
  world.victoryClock -= dt;
  if (world.victoryClock > 0) return;
  world.victoryClock = 1;
  const present = new Set<PlayerId>();
  for (const u of world.units.values()) if (!isAnimal(u.kind)) present.add(u.owner);
  for (const b of world.buildings.values()) if (b.owner !== GAIA) present.add(b.owner);
  for (const id of world.players.keys()) if (!present.has(id)) defeat(world, id, 'conquest');

  const winners = [...world.players.keys()].filter((id) => !world.isDefeated(id));
  // A match started without rival towns is a playable practice map.
  if (world.players.size === 1 && winners.length === 1) return;
  // With zero survivors the terminal result is a draw.
  if (winners.some((a, i) => winners.slice(i + 1).some((b) => world.areEnemies(a, b)))) return;
  world.gameOver = { winners, reason };
  world.events.emit({ type: 'gameOver', winners: [...winners], reason });
}

/** Use normal death paths so targets, jobs, queues, nav and view events stay consistent. */
export function resign(world: World, player: PlayerId): void {
  if (!world.players.has(player) || world.isDefeated(player) || world.gameOver) return;
  for (const u of [...world.units.values()]) if (u.owner === player) killUnit(world, u);
  for (const b of [...world.buildings.values()]) if (b.owner === player) destroyBuilding(world, b);
  // Unlanded shots belonging to the resigned army must not decide the result afterwards.
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    if (world.projectiles[i].owner === player) world.projectiles.splice(i, 1);
  }
  world.lastAlert.delete(player);
  world.refreshFog();
  defeat(world, player, 'resign');
  world.victoryClock = 0;
  victorySystem(world, 0, 'resign');
}
