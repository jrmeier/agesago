import { describe, expect, it } from 'vitest';
import { CHAINS, type TechId } from '../core/techs';
import { AIPlayer } from './AIPlayer';
import { makeGame, run } from './harness';
import { makeProfile } from './profile';
import { RULES } from './research';

/** Drop-site economy techs (what "economy techs" means for the acceptance check). */
const ECONOMY: ReadonlySet<TechId> = new Set<TechId>([...CHAINS.wood, ...CHAINS.mining, ...CHAINS.farming, 'stoneChisels', 'threshingFloor']);
const TOWN_BY = 14 * 60;
const CITY_BY = 25 * 60;
const ECO_AT = 20 * 60;

describe('research and ages AI (moderate, headless, idle human)', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: ages up on time and researches economy techs', (seed) => {
    const world = makeGame(seed, ['ai', 'human']);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', seed });
    const player = world.players.get(1)!;
    let aiMs = 0;
    let ticks = 0;
    let ecoBy20 = 0;
    for (let t = 0; t < CITY_BY; t += 30) {
      const st = run(world, [ai], 30);
      aiMs += st.aiMs.get(1)!;
      ticks += st.updates;
      if (world.time <= ECO_AT + 1) ecoBy20 = [...player.researched].filter((x) => ECONOMY.has(x)).length;
      if (player.age >= 2 && world.time >= ECO_AT) break;
    }
    const town = ai.research.agedAt[1];
    const city = ai.research.agedAt[2];
    const msPerTick = aiMs / ticks;
    const fmt = (s: number | undefined) => (s === undefined ? 'never' : `${(s / 60).toFixed(1)} min`);
    console.log(
      `seed ${seed}: Town ${fmt(town)}, City ${fmt(city)}, economy techs by 20 min ${ecoBy20}, ` +
        `techs ${ai.research.started.length} (${ai.research.started.map((s) => s.tech).join(' ')}), trades ${ai.research.trades}, ` +
        `AI ${msPerTick.toFixed(4)} ms/tick`
    );
    expect(town).toBeDefined();
    expect(town!).toBeLessThanOrEqual(TOWN_BY);
    expect(city).toBeDefined();
    expect(city!).toBeLessThanOrEqual(CITY_BY);
    expect(ecoBy20).toBeGreaterThanOrEqual(3);
    expect(msPerTick).toBeLessThan(1);
    ai.dispose();
  }, 180_000);
});

describe('research profiles', () => {
  it('easy ages later and researches less than moderate', () => {
    const easy = makeProfile('easy').research!;
    const mod = makeProfile('moderate').research!;
    expect(easy.townAgeTime).toBeGreaterThan(mod.townAgeTime);
    expect(easy.gap).toBeGreaterThan(mod.gap);
    for (const g of Object.keys(mod.weights) as (keyof typeof mod.weights)[]) expect(easy.weights[g]).toBeLessThanOrEqual(mod.weights[g]);
  });

  it('a smaller economy still reaches its age thresholds', () => {
    for (const d of ['easy', 'moderate', 'hard', 'hardest'] as const) {
      for (const pers of [undefined, 'rusher', 'boomer', 'turtle'] as const) {
        const p = makeProfile(d, pers);
        expect(p.research!.cityAgeAt).toBeLessThanOrEqual(p.targetVillagers);
        expect(p.research!.townAgeAt).toBeLessThan(p.research!.cityAgeAt);
      }
    }
  });

  it('research can be switched off for a control AI', () => {
    expect(makeProfile('moderate', undefined, { research: null }).research).toBeNull();
    const world = makeGame(1, ['ai', 'human']);
    const ai = new AIPlayer(world, 1, { difficulty: 'moderate', tune: { research: null } });
    run(world, [ai], 12 * 60);
    expect(world.players.get(1)!.researched.size).toBe(0);
    expect(world.players.get(1)!.age).toBe(0);
    ai.dispose();
  }, 60_000);

  it('every priority rule names a tech once', () => {
    const ids = RULES.map((r) => r.tech);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
