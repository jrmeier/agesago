import type { Player, PlayerId } from '../core/types';
import { generateMap } from '../sim/mapgen';
import { World, defaultPlayers } from '../sim/World';
import { AIPlayer, type AIOptions } from './AIPlayer';

/** Headless game setup for AI tests and tuning (no rendering). */
export function makeGame(seed: number, control: Player['control'][] = ['human', 'ai']): World {
  const { hf, layout } = generateMap(seed, control.length);
  const players = defaultPlayers(control.length).map((p, i) => ({ ...p, control: control[i] }));
  return new World(hf, layout, players);
}

export interface RunStats {
  /** Wall-clock milliseconds spent in AIPlayer.update, per player. */
  aiMs: Map<PlayerId, number>;
  updates: number;
}

/**
 * Tick `world` for `seconds` of sim time at `dt`, updating every AI each tick. Stops early when
 * `until` returns true (checked once per sim second).
 */
export function run(world: World, ais: AIPlayer[], seconds: number, dt = 0.05, until?: () => boolean): RunStats {
  const stats: RunStats = { aiMs: new Map(ais.map((a) => [a.player, 0])), updates: 0 };
  const steps = Math.round(seconds / dt);
  const perSecond = Math.round(1 / dt);
  for (let i = 0; i < steps; i++) {
    for (const ai of ais) {
      const t0 = performance.now();
      ai.update(dt);
      stats.aiMs.set(ai.player, stats.aiMs.get(ai.player)! + performance.now() - t0);
    }
    stats.updates++;
    world.tick(dt);
    if (until && i % perSecond === 0 && until()) break;
  }
  return stats;
}

export function ai(world: World, player: PlayerId, opts: AIOptions): AIPlayer {
  return new AIPlayer(world, player, opts);
}

/** Counts of a player's villagers, army and buildings by kind. */
export function census(world: World, player: PlayerId) {
  let villagers = 0;
  let army = 0;
  const buildings: Record<string, number> = {};
  for (const u of world.units.values()) {
    if (u.owner !== player) continue;
    if (u.kind === 'villager') villagers++;
    else if (u.kind !== 'scout') army++;
  }
  for (const b of world.buildings.values()) {
    if (b.owner !== player || !b.complete) continue;
    buildings[b.kind] = (buildings[b.kind] ?? 0) + 1;
  }
  return { villagers, army, buildings, pop: world.popOf(player), popCap: world.popCapOf(player), stock: { ...world.stockOf(player) } };
}
