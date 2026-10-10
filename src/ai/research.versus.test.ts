import { describe, expect, it } from 'vitest';
import type { PlayerId } from '../core/types';
import type { World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { armyPower, census, makeGame, run } from './harness';

/**
 * M8-16 acceptance: a moderate AI that researches and ages up beats an otherwise identical AI
 * with research switched off (`tune: { research: null }`) in at least 75% of games. Seeds 1–5,
 * each played twice with the sides swapped (player 1 has a sizeable edge on these maps: two
 * control AIs split 4–1 for player 1). Each game is a real fight, capped at 30 sim minutes; a
 * game still running then goes to the higher score (villagers + soldiers + finished buildings).
 * Heavy: about 30 s of wall time per game on a quiet machine.
 */
const SEEDS = [1, 2, 3, 4, 5];
const MINUTES = 30;
const results: boolean[] = [];

function score(world: World, p: PlayerId): number {
  const c = census(world, p);
  return c.villagers + c.army + Object.values(c.buildings).reduce((a, b) => a + b, 0);
}

describe('research AI vs no-research AI (moderate, headless)', () => {
  it.each(SEEDS.flatMap((s) => [[s, 1], [s, 2]] as [number, PlayerId][]))('seed %i, researcher is player %i', async (seed, res) => {
    const world = makeGame(seed, ['ai', 'ai']);
    const ais = ([1, 2] as PlayerId[]).map(
      (p) => new AIPlayer(world, p, { difficulty: 'moderate', seed: seed * 10 + p, tune: p === res ? {} : { research: null } })
    );
    let m = 0;
    for (; m < MINUTES; m++) {
      run(world, ais, 60);
      // Let the worker answer vitest between sim minutes (a long synchronous game times out its RPC).
      await new Promise((r) => setTimeout(r, 0));
      if (world.gameOver || world.defeatedPlayers.size) break;
    }
    const s1 = score(world, 1);
    const s2 = score(world, 2);
    const winner = world.gameOver?.winners[0] ?? (world.defeatedPlayers.size ? (world.defeatedPlayers.has(1) ? 2 : 1) : s1 > s2 ? 1 : 2);
    const r = ais[res - 1].research;
    results.push(winner === res);
    console.log(
      `seed ${seed} researcher p${res}: ${winner === res ? 'researcher' : 'control'} wins (${world.gameOver ? 'conquest' : `score ${s1}-${s2}`} ` +
        `at ${m + 1 > MINUTES ? MINUTES : m + 1} min, army power ${Math.round(armyPower(world, 1))}-${Math.round(armyPower(world, 2))}); ` +
        `researcher aged at ${r.agedAt.slice(1).map((t) => (t / 60).toFixed(1)).join('/') || 'never'} min, ${r.started.length} techs`
    );
    for (const ai of ais) ai.dispose();
  }, 600_000);

  it('the researcher wins at least 75% of games', () => {
    const wins = results.filter(Boolean).length;
    console.log(`researcher won ${wins}/${results.length}`);
    expect(results.length).toBe(SEEDS.length * 2);
    expect(wins / results.length).toBeGreaterThanOrEqual(0.75);
  });
});
