import type { Stat } from '../core/techs';
import type { Player, PlayerId } from '../core/types';
import { isAnimal, UNITS } from '../core/units';
import { unitStat } from '../sim/systems/research';
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

/**
 * Fighting strength of a player's army with its research applied (statOf): Σ effective hp ×
 * damage per second over its soldiers. Effective hp grows 15% per point of armour; damage is
 * attack less one point of a typical foe's armour per type, at least 1. A proxy for "who would
 * win the fight", used where a full AI-vs-AI game is too slow.
 */
export function armyPower(world: World, player: PlayerId): number {
  let power = 0;
  for (const u of world.units.values()) {
    if (u.owner !== player || u.kind === 'villager' || u.kind === 'scout' || u.kind === 'tradeCart' || isAnimal(u.kind)) continue;
    const spec = UNITS[u.kind];
    const st = (stat: Stat, base: number) => unitStat(world, player, u.kind, stat, base);
    const hp = st('hp', spec.hp) * (1 + 0.15 * (st('armor.melee', spec.armor.melee) + st('armor.pierce', spec.armor.pierce)));
    const hit = Math.max(1, Math.max(0, st('attack.melee', spec.attack.melee) - 1) + Math.max(0, st('attack.pierce', spec.attack.pierce) - 1));
    power += (hp * hit) / spec.reload;
  }
  return power;
}
