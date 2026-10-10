import { BALANCE } from '../sim/balance';
import { serializeWorld } from '../sim/serialize';
import type { World } from '../sim/World';
import { TICKS_PER_TURN, type Turn } from './protocol';

/** Cosmetic preferences and path-search telemetry must not affect the state checksum. */
export function stateHash(world: World): string {
  const snapshot = serializeWorld(world);
  for (const p of snapshot.players) { p.player.color = 0; p.player.name = ''; }
  snapshot.systems.navExpanded = 0;
  const text = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function applyTurn(world: World, turn: Turn): void {
  for (const { player, command } of turn.commands) world.dispatch(command, player);
  for (let i = 0; i < TICKS_PER_TURN && !world.gameOver; i++) world.tick(1 / BALANCE.tickRate);
}

/** Replay from the original map, including empty turns, preserving private sim caches. */
export async function replay(world: World, history: Turn[], through: number): Promise<void> {
  const commands = new Map(history.map(turn => [turn.turn, turn.commands]));
  for (let turn = 0; turn < through; turn++) {
    applyTurn(world, { turn, commands: commands.get(turn) ?? [] });
    if (turn % 100 === 99) await new Promise(resolve => setTimeout(resolve, 0));
  }
}
