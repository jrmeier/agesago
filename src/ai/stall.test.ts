import { describe, expect, it } from 'vitest';
import type { Age, Building, BuildingKind, MapLayout, Vec2 } from '../core/types';
import { GRASS_ONLY, type Heightfield } from '../core/types';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { destroyBuilding, killUnit } from '../sim/systems/combat';
import { EXPLORED } from '../sim/visibility';
import { defaultPlayers, World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { dist, snapshot } from './context';
import { run } from './harness';

/**
 * M16-10: the AI-vs-AI stall. Each fix has a focused scenario on a flat, explored arena:
 * expansion toward untouched gold, a market that keeps the age's gold, discrete attack waves,
 * no recall for a couple of raiders, a bounded hold while saving for an age, no army-first with
 * a big army, and resigning a lost game. (Fight-first and the hunt are in territory.test.ts.)
 */

const P1_TC = { x: 20, z: 40 };
const P2_TC = { x: 130, z: 40 };

function arena(nodes: MapLayout['nodes'] = [], control: ('human' | 'ai')[] = ['human', 'ai']): World {
  const hf: Heightfield = {
    width: 150, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 150 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const layout: MapLayout = {
    townCenter: P1_TC, villagers: [], scouts: [], nodes, props: [],
    extraStarts: [{ townCenter: P2_TC, villagers: [], scouts: [] }],
  };
  const players = defaultPlayers(2).map((p, i) => ({ ...p, control: control[i] }) as typeof p);
  const w = new World(hf, layout, players);
  for (const p of w.players.values()) p.visibility.state.fill(EXPLORED);
  w.seed = 1;
  return w;
}

function finished(w: World, kind: BuildingKind, pos: Vec2, owner: number): Building {
  const b = layFoundation(w, kind, pos, 0, owner);
  completeBuilding(w, b);
  b.hp = b.maxHp;
  return b;
}

/** An AI that attacks with whatever it has at once (no economy, no research). */
function raider(w: World, tune: object = {}): AIPlayer {
  return new AIPlayer(w, 2, { difficulty: 'moderate', tune: { firstAttack: 0, firstWave: 4, waveGap: 0, counters: false, research: null, retreatAt: 0, ...tune } });
}

/** Private planners, for scenarios that drive one decision directly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inside = (ai: AIPlayer): any => ai as any;

describe('M16-10: expansion toward untouched gold', () => {
  it('picks a gold cluster over a nearer forest', () => {
    const forest: MapLayout['nodes'] = [];
    for (let i = 0; i < 64; i++) forest.push({ kind: 'tree', pos: { x: 92 + (i % 8) * 1.3, z: 34 + Math.floor(i / 8) * 1.3 }, amount: 100 });
    const gold: MapLayout['nodes'] = [
      { kind: 'gold', pos: { x: 128, z: 76 }, amount: 800 },
      { kind: 'gold', pos: { x: 131, z: 76 }, amount: 800 },
    ];
    const w = arena([...forest, ...gold]);
    const ai = raider(w);
    inside(ai).intel.refreshNodes();
    const site: Vec2 = inside(ai).economy.expansionSite(snapshot(w, 2));
    // The forest (6,400 wood, 36 away) outscored this pair (1,600 gold, 36 away) before.
    expect(site).not.toBeNull();
    expect(Math.min(...gold.map((g) => dist(g.pos, site)))).toBeLessThan(3);
  });
});

describe('M16-10: the market keeps the gold an age-up is saving', () => {
  function market(nodes: MapLayout['nodes'] = []) {
    const w = arena(nodes);
    const ai = new AIPlayer(w, 2, { difficulty: 'moderate' });
    finished(w, 'market', { x: 120, z: 55 }, 2);
    inside(ai).intel.refreshNodes();
    const stock = w.stockOf(2);
    const trade = (food: number, gold: number, reserve: object) => {
      Object.assign(stock, { food, wood: 0, gold, stone: 0 });
      inside(ai).ctx.reserve = reserve;
      inside(ai).research.market(snapshot(w, 2), inside(ai).profile.research);
      return { ...stock };
    };
    return trade;
  }

  it('never buys with the reserved gold, and buys with gold beyond it', () => {
    const trade = market();
    // 1,200 gold, 500 of it for the City Age: food is short, so it buys, but only from the spare 700.
    const after = trade(0, 1200, { food: 1200, gold: 500 });
    expect(after.food).toBeGreaterThan(0);
    expect(after.gold).toBeGreaterThanOrEqual(500);
    // All of the gold reserved: no purchase at all (before, it bought the age's food with it).
    expect(trade(0, 520, { food: 1200, gold: 500 })).toMatchObject({ food: 0, gold: 520 });
  });

  it('sells surplus food for the age gold once the mines are dry, and not while gold is mined', () => {
    // No gold mine known: food beyond what is held back and a cushion is sold.
    const dry = market()(900, 0, { gold: 500 });
    expect(dry.food).toBeLessThan(900);
    expect(dry.gold).toBeGreaterThan(0);
    // A mine still holds gold: 900 food is below the glut mark, so nothing is sold.
    const mined = market([{ kind: 'gold', pos: { x: 110, z: 60 }, amount: 400 }])(900, 0, { gold: 500 });
    expect(mined).toMatchObject({ food: 900, gold: 0 });
  });
});

describe('M16-10: attack waves', () => {
  it('calls a spent attack off instead of feeding it, and leaves fresh troops home', () => {
    const w = arena();
    finished(w, 'house', { x: 60, z: 40 }, 1);
    const wave = Array.from({ length: 10 }, (_, i) => w.spawnUnit('swordsman', { x: 118, z: 34 + i }, 2));
    const ai = raider(w, { waveGap: 120 });
    const m = inside(ai).military;
    run(w, [ai], 30, 0.05, () => m.mode === 'attack');
    expect(m.mode).toBe('attack');
    run(w, [ai], 5);
    // Down to 4 of 10: under the 60% that still takes reinforcements, over the 35% that ends it.
    for (const u of wave.slice(0, 6)) killUnit(w, u);
    const fresh = Array.from({ length: 5 }, (_, i) => w.spawnUnit('swordsman', { x: m.rallyPoint().x, z: m.rallyPoint().z + i * 0.8 - 2 }, 2));
    run(w, [ai], 6);
    expect(m.mode).toBe('attack');
    expect(fresh.every((u) => !m.attackers.has(u.id))).toBe(true);
    // Down to 3 of 10: spent. The survivors head home and the next wave musters.
    killUnit(w, wave[6]);
    run(w, [ai], 4);
    expect(m.mode).toBe('gather');
    expect(wave.slice(7).every((u) => !m.attackers.has(u.id))).toBe(true);
  });

  it('keeps a wave going when two raiders reach a base it left behind', () => {
    const w = arena();
    finished(w, 'house', { x: 70, z: 40 }, 1);
    Array.from({ length: 12 }, (_, i) => w.spawnUnit('swordsman', { x: 118, z: 34 + i }, 2));
    const ai = raider(w);
    const m = inside(ai).military;
    run(w, [ai], 30, 0.05, () => m.mode === 'attack');
    run(w, [ai], 20);
    expect(m.mode).toBe('attack');
    for (let i = 0; i < 2; i++) w.spawnUnit('swordsman', { x: P2_TC.x - 8, z: P2_TC.z + 6 + i }, 1);
    run(w, [ai], 15);
    // Before M16-10, any soldier by the empty base recalled every wave.
    expect(m.mode).toBe('attack');
    expect(m.attackers.size).toBeGreaterThanOrEqual(10);
  });
});

describe('M16-10: saving for an age and army-first', () => {
  function cityAgeSaver() {
    const w = arena();
    const state = w.players.get(2)!;
    state.age = 1 as Age;
    for (const kind of ['forge', 'market'] as BuildingKind[]) finished(w, kind, { x: kind === 'forge' ? 118 : 120, z: kind === 'forge' ? 28 : 55 }, 2);
    for (let i = 0; i < 30; i++) w.spawnUnit('villager', { x: 124 + (i % 6), z: 48 + Math.floor(i / 6) }, 2);
    Object.assign(w.stockOf(2), { food: 0, wood: 0, gold: 0, stone: 0 });
    const ai = new AIPlayer(w, 2, { difficulty: 'moderate' });
    return { w, ai };
  }

  it('holds attack waves for three minutes of saving at most', () => {
    const { w, ai } = cityAgeSaver();
    inside(ai).research.pass(snapshot(w, 2));
    expect(inside(ai).ctx.reserve).toMatchObject({ gold: 500 });
    expect(inside(ai).ctx.aging).toBe(true);
    w.time += 181;
    inside(ai).research.pass(snapshot(w, 2));
    // Still saving (the reserve stands), but waves go again.
    expect(inside(ai).ctx.reserve).toMatchObject({ gold: 500 });
    expect(inside(ai).ctx.aging).toBe(false);
  });

  it('keeps the age reserve when raided with an army that already outnumbers the enemy', () => {
    const { w, ai } = cityAgeSaver();
    for (let i = 0; i < 40; i++) w.spawnUnit('swordsman', { x: 110 + (i % 8), z: 20 + Math.floor(i / 8) }, 2);
    inside(ai).research.lastHit = w.time;
    inside(ai).research.pass(snapshot(w, 2));
    expect(inside(ai).ctx.armyFirst).toBe(false);
    // A small army that is raided still spends the reserve on defenders.
    const small = cityAgeSaver();
    for (let i = 0; i < 4; i++) small.w.spawnUnit('swordsman', { x: 110 + i, z: 20 }, 2);
    inside(small.ai).research.lastHit = small.w.time;
    inside(small.ai).research.pass(snapshot(small.w, 2));
    expect(inside(small.ai).ctx.armyFirst).toBe(true);
  });
});

describe('M16-10: a beaten computer player resigns', () => {
  it('resigns once it has lost every Town Center and villager with fewer than five soldiers', () => {
    const w = arena();
    const scout = w.spawnUnit('scout', { x: 140, z: 70 }, 2);
    Object.assign(w.stockOf(2), { food: 0, wood: 0, gold: 0, stone: 0 });
    const ai = raider(w);
    run(w, [ai], 10);
    expect(w.defeatedPlayers.size).toBe(0);
    destroyBuilding(w, w.townCenterOf(2)!);
    run(w, [ai], 10);
    expect(w.units.has(scout.id)).toBe(false);
    expect(w.defeatedPlayers.has(2)).toBe(true);
    expect(w.gameOver).toEqual({ winners: [1], reason: 'resign' });
  });

  it('fights on with five soldiers, and never resigns for a human player or a scenario army', () => {
    const fighting = arena();
    Object.assign(fighting.stockOf(2), { food: 0, wood: 0, gold: 0, stone: 0 });
    for (let i = 0; i < 5; i++) fighting.spawnUnit('swordsman', { x: 140, z: 60 + i }, 2);
    const a = raider(fighting, { firstAttack: 9999 });
    run(fighting, [a], 6);
    destroyBuilding(fighting, fighting.townCenterOf(2)!);
    run(fighting, [a], 10);
    expect(fighting.defeatedPlayers.size).toBe(0);

    // An AIPlayer attached to a human player never resigns for them.
    const human = arena([], ['human', 'human']);
    Object.assign(human.stockOf(2), { food: 0, wood: 0, gold: 0, stone: 0 });
    human.spawnUnit('scout', { x: 140, z: 70 }, 2);
    const h = raider(human);
    run(human, [h], 6);
    destroyBuilding(human, human.townCenterOf(2)!);
    run(human, [h], 10);
    expect(human.defeatedPlayers.size).toBe(0);

    // A scenario army that never had a Town Center.
    const scenario = arena();
    destroyBuilding(scenario, scenario.townCenterOf(2)!);
    scenario.spawnUnit('scout', { x: 140, z: 70 }, 2);
    const s = raider(scenario);
    run(scenario, [s], 10);
    expect(scenario.defeatedPlayers.size).toBe(0);
  });
});
