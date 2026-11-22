import { describe, expect, it } from 'vitest';
import { CIVS, CIV_IDS, type CivId } from '../core/civilizations';
import { TECHS } from '../core/techs';
import type { Building, Difficulty, PlayerId, Stockpile } from '../core/types';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { generateMap } from '../sim/mapgen';
import { World, defaultPlayers } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { run } from './harness';
import { makeProfile } from './profile';
import { RULES } from './research';

/**
 * T121: the AI researches its civilization's forge tech (CIVS[civ].tech). Before, the rule sat at
 * the bottom of the forge group behind an army gate and the age-up reserve, and moderate and hard
 * researched it in 2 of 80 benchmark player-games.
 */

const AI: PlayerId = 2;

function game(seed: number, civ: CivId): World {
  const { hf, layout } = generateMap(seed, 2);
  const world = new World(hf, layout, defaultPlayers(2, [civ, civ]));
  world.seed = seed;
  return world;
}

/** A finished building at full hp (test setup, no construction). */
function place(world: World, kind: Building['kind'], dx: number, dz: number): Building {
  const tc = world.townCenterOf(AI)!.pos;
  const b = layFoundation(world, kind, { x: tc.x + dx, z: tc.z + dz }, 0, AI);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  return b;
}

/** The AI in the Town Age with a forge and `stock`, without playing the first minutes. */
function townAge(world: World, stock: Stockpile): void {
  const p = world.players.get(AI)!;
  p.age = 1;
  p.researched.add('townAge');
  Object.assign(world.stockOf(AI), stock);
  place(world, 'forge', 9, 0);
}

const started = (ai: AIPlayer, civ: CivId) => ai.research.started.some((s) => s.tech === CIVS[civ].tech);

describe('AI civilization techs (T121)', () => {
  it('each civilization has one top-priority rule for its forge tech, with no army gate', () => {
    for (const civ of CIV_IDS) {
      const rules = RULES.filter((r) => r.tech === CIVS[civ].tech);
      expect(rules).toHaveLength(1);
      expect(rules[0].group).toBe('civ');
      expect(rules[0].fromReserve).toBe(true);
      // Above every other rule: bonuses add at most 20 and hardest weighs unit lines 1.3 (60 × 1.3 = 78).
      for (const r of RULES) if (r.group !== 'civ') expect((r.base + (r.bonus ? 20 : 0)) * 1.3).toBeLessThan(rules[0].base);
    }
  });

  it('moderate, hard and hardest weigh the civ group; easy never researches it', () => {
    expect(makeProfile('easy').research!.weights.civ).toBe(0);
    for (const d of ['moderate', 'hard', 'hardest'] as Difficulty[]) expect(makeProfile(d).research!.weights.civ).toBeGreaterThanOrEqual(1);
  });

  it.each(CIV_IDS)('%s: a Town Age AI with a forge and no army starts its civilization tech at once', (civ) => {
    const world = game(1, civ);
    townAge(world, { food: 600, wood: 300, gold: 300, stone: 0 });
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed: 1 });
    run(world, [ai], 20);
    expect(ai.research.started[0]?.tech, 'the first tech it starts').toBe(CIVS[civ].tech);
    ai.dispose();
  });

  it('pays for it out of the stock it is saving for the City Age', () => {
    const world = game(1, 'persians');
    // Short of the City Age (1,200 food, 500 gold), so everything is held back for it.
    townAge(world, { food: 700, wood: 300, gold: 300, stone: 0 });
    place(world, 'market', -9, 0);
    const tc = world.townCenterOf(AI)!.pos;
    for (let i = 0; i < 26; i++) world.spawnUnit('villager', { x: tc.x - 5 + (i % 6), z: tc.z + 6 + Math.floor(i / 6) }, AI);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed: 1 });
    run(world, [ai], 20);
    expect(started(ai, 'persians')).toBe(true);
    // Nothing else jumped the age-up reserve.
    expect(ai.research.started.filter((s) => TECHS[s.tech].civ === undefined)).toEqual([]);
    ai.dispose();
  });

  it('easy leaves it alone', () => {
    const world = game(1, 'celts');
    townAge(world, { food: 2000, wood: 2000, gold: 2000, stone: 0 });
    const ai = new AIPlayer(world, AI, { difficulty: 'easy', seed: 1 });
    run(world, [ai], 240);
    expect(started(ai, 'celts')).toBe(false);
    ai.dispose();
  });

  it.each([[1, 'romans'], [2, 'celts']] as [number, CivId][])('seed %i, %s: a full moderate game has it by minute 16', (seed, civ) => {
    const world = game(seed, civ);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed });
    for (let t = 0; t < 16 * 60 && !started(ai, civ); t += 30) run(world, [ai], 30);
    const at = ai.research.started.find((s) => s.tech === CIVS[civ].tech)?.at;
    console.log(`seed ${seed} ${civ}: Town ${Math.round(ai.research.agedAt[1] ?? -1)} s, ${CIVS[civ].tech} at ${at === undefined ? 'never' : `${Math.round(at)} s`}`);
    expect(at).toBeDefined();
    ai.dispose();
  }, 180_000);
});
