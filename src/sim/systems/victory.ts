import type { PlayerId } from '../../core/types';
import type { World } from '../World';
import { destroyBuilding, killUnit } from './combat';

export interface GameResult {
  winners: PlayerId[];
  reason: 'conquest' | 'resign';
}

function defeat(world: World, player: PlayerId, reason: GameResult['reason']): void {
  if (world.isDefeated(player)) return;
  world.defeatedPlayers.add(player);
  world.events.emit({ type: 'defeated', player, reason });
}

/** One scan per simulated second; maps may also be edited by scenario/test setup. */
export function victorySystem(world: World, dt: number, reason: GameResult['reason'] = 'conquest'): void {
  if (world.gameOver) return;
  world.victoryClock -= dt;
  if (world.victoryClock > 0) return;
  world.victoryClock = 1;
  const present = new Set<PlayerId>();
  for (const u of world.units.values()) present.add(u.owner);
  for (const b of world.buildings.values()) present.add(b.owner);
  for (const id of world.players.keys()) if (!present.has(id)) defeat(world, id, 'conquest');

  const winners = [...world.players.keys()].filter((id) => !world.isDefeated(id));
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
