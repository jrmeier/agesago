import { describe, expect, it } from 'vitest';
import type { Building, PlayerId, Stockpile, Unit } from '../core/types';
import { isChampion, isHero, UNITS } from '../core/units';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { wallSegments } from '../sim/systems/walls';
import type { World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { makeGame, run } from './harness';
import { makeProfile } from './profile';

/**
 * M16-8: the AI's late game. Siege against a walled base, escorts, fortress units (champions and
 * the hero), and the answer to a wonder.
 */

const HUMAN: PlayerId = 1;
const AI: PlayerId = 2;
const RICH: Stockpile = { food: 3000, wood: 3000, gold: 2000, stone: 1000 };
const isSiege = (u: Unit) => UNITS[u.kind].unitClass === 'siege';
const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A finished building at full hp (test setup, no construction). */
function place(world: World, kind: Building['kind'], pos: { x: number; z: number }, owner: PlayerId, rot = 0): Building {
  const b = layFoundation(world, kind, pos, rot, owner);
  completeBuilding(world, b);
  b.hp = b.maxHp;
  return b;
}

/** A stone wall ring (half-width 12) around the owner's Town Center, with a watch tower in each corner. */
function wallIn(world: World, owner: PlayerId): void {
  const { x, z } = world.townCenterOf(owner)!.pos;
  const r = 12;
  const corners = [{ x: x - r, z: z - r }, { x: x + r, z: z - r }, { x: x + r, z: z + r }, { x: x - r, z: z + r }];
  for (let i = 0; i < 4; i++) for (const s of wallSegments('stoneWall', corners[i], corners[(i + 1) % 4])) place(world, 'stoneWall', s.pos, owner, s.rot);
  for (const [dx, dz] of [[8, 8], [-8, -8], [8, -8], [-8, 8]]) place(world, 'watchTower', { x: x + dx, z: z + dz }, owner);
}

/** Start `player` in `age` with a stockpile (a mid-game AI without playing the first 15 minutes). */
function advance(world: World, player: PlayerId, age: 2 | 3, stock: Stockpile = RICH): void {
  const p = world.players.get(player)!;
  p.age = age;
  for (const t of ['townAge', 'cityAge', 'empireAge'].slice(0, age)) p.researched.add(t as never);
  Object.assign(world.stockOf(player), stock);
}

describe('late-game AI (M16-8)', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: a moderate City Age AI brings siege, escorted, to an attack on a walled base', (seed) => {
    const world = makeGame(seed, ['human', 'ai']);
    wallIn(world, HUMAN);
    advance(world, AI, 2);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed });
    const humanBuildings = () => [...world.buildings.values()].filter((b) => b.owner === HUMAN);
    let arrived: { at: number; engine: Unit; escorts: number } | null = null;
    let launchedWithSiege = false;
    let lastWave = 0;
    let aiMs = 0;
    let ticks = 0;
    for (let t = 0; t < 25 * 60 && !arrived; t += 10) {
      const st = run(world, [ai], 10);
      aiMs += st.aiMs.get(AI)!;
      ticks += st.updates;
      if (ai.military.wave > lastWave) {
        lastWave = ai.military.wave;
        launchedWithSiege ||= [...ai.military.attackers].some((id) => { const u = world.units.get(id); return !!u && isSiege(u); });
      }
      for (const id of ai.military.attackers) {
        const u = world.units.get(id);
        if (!u || !isSiege(u) || !humanBuildings().some((b) => d(b.pos, u.pos) < b.radius + 4)) continue;
        arrived = { at: world.time, engine: u, escorts: [...ai.military.escorts.values()].filter((e) => world.units.has(e)).length };
        break;
      }
    }
    const msPerTick = aiMs / ticks;
    console.log(
      `seed ${seed}: siege ${arrived ? `(${arrived.engine.kind}) at the walls at ${(arrived.at / 60).toFixed(1)} min, ${arrived.escorts} escort(s)` : 'never arrived'}, ` +
        `waves ${ai.military.wave}, launched with siege ${launchedWithSiege}, AI ${msPerTick.toFixed(4)} ms/tick, rejected ${ai.stats.rejected}/${ai.stats.commands}`
    );
    expect(arrived, 'an AI siege engine reached the walled base with the attack').not.toBeNull();
    expect(launchedWithSiege || arrived!.escorts > 0, 'siege set out with a wave or under escort').toBe(true);
    expect(msPerTick).toBeLessThan(1);
  }, 120_000);

  it('escorts guard each siege engine and the engines go for walls, towers and the Town Center', () => {
    const world = makeGame(1, ['human', 'ai']);
    wallIn(world, HUMAN);
    advance(world, AI, 2);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed: 1, tune: { firstAttack: 0, firstWave: 6 } });
    const home = world.townCenterOf(AI)!.pos;
    const ram = world.spawnUnit('ram', { x: home.x + 6, z: home.z }, AI);
    for (let i = 0; i < 8; i++) world.spawnUnit('swordsman', { x: home.x + 7, z: home.z + i - 4 }, AI);
    // The AI knows the base (as if scouted).
    for (const b of world.buildings.values()) if (b.owner === HUMAN) ai.intel.buildings.set(b.id, { id: b.id, kind: b.kind, owner: b.owner, pos: { ...b.pos }, radius: b.radius });
    let guarded = 0;
    let target: string | null = null;
    for (let t = 0; t < 240 && !target; t += 5) {
      run(world, [ai], 5);
      guarded = Math.max(guarded, [...world.units.values()].filter((u) => u.owner === AI && world.combatState.get(u.id)?.guard === ram.id).length);
      const tid = world.units.get(ram.id)?.target;
      const tb = tid !== null && tid !== undefined ? world.buildings.get(tid) : undefined;
      if (tb && tb.owner === HUMAN) target = tb.kind;
    }
    expect(ai.military.wave).toBeGreaterThanOrEqual(1);
    expect(guarded).toBeGreaterThanOrEqual(1);
    expect(guarded).toBeLessThanOrEqual(2);
    expect(['stoneWall', 'watchTower', 'townCenter', 'gate']).toContain(target);
    expect(ai.stats.territoryRejected).toBe(0);
  });

  it('builds a siege workshop and a fortress in the City Age', () => {
    const world = makeGame(2, ['human', 'ai']);
    advance(world, AI, 2, { food: 4000, wood: 4000, gold: 2000, stone: 2000 });
    const home = world.townCenterOf(AI)!.pos;
    for (let i = 0; i < 26; i++) world.spawnUnit('villager', { x: home.x + (i % 6) - 3, z: home.z + 5 + Math.floor(i / 6) }, AI);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed: 2 });
    run(world, [ai], 240);
    const built = (k: Building['kind']) => [...world.buildings.values()].filter((b) => b.owner === AI && b.kind === k).length;
    console.log(`workshop ${built('siegeWorkshop')}, fortress ${built('fortress')}`);
    expect(built('siegeWorkshop')).toBe(1);
    expect(built('fortress')).toBe(1);
    expect(built('fortress')).toBeLessThanOrEqual(makeProfile('moderate').late.fortresses);
  });

  it('trains its hero and champions at a fortress in the Empire Age', () => {
    const world = makeGame(3, ['human', 'ai']);
    advance(world, AI, 3, { food: 5000, wood: 3000, gold: 5000, stone: 1000 });
    const home = world.townCenterOf(AI)!.pos;
    const fort = layFoundation(world, 'fortress', world.nav.nearestFree({ x: home.x + 12, z: home.z }) ?? { x: home.x + 12, z: home.z }, 0, AI);
    completeBuilding(world, fort);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed: 3 });
    run(world, [ai], 180);
    const mine = [...world.units.values()].filter((u) => u.owner === AI);
    const heroes = mine.filter((u) => isHero(u.kind));
    const champions = mine.filter((u) => isChampion(u.kind));
    console.log(`heroes ${heroes.map((u) => u.kind)}, champions ${champions.length}`);
    expect(heroes.length).toBe(1);
    expect(champions.length).toBeGreaterThanOrEqual(2);
    // Easy never trains champions or heroes.
    expect(makeProfile('easy').late).toMatchObject({ champions: false, hero: false, fortresses: 0 });
  });

  it.each([1, 2, 3])('seed %i: attacks an enemy wonder before its countdown ends', (seed) => {
    const world = makeGame(seed, ['human', 'ai']);
    world.wonderRules = { enabled: true, seconds: 300 };
    advance(world, AI, 2);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed });
    run(world, [ai], 60);
    const home = world.townCenterOf(AI)!.pos;
    for (let i = 0; i < 14; i++) world.spawnUnit(i % 2 ? 'swordsman' : 'archer', { x: home.x + 6 + (i % 3), z: home.z - 4 + Math.floor(i / 3) }, AI);
    const tc = world.townCenterOf(HUMAN)!.pos;
    const spot = world.nav.nearestFree({ x: tc.x + 14, z: tc.z }) ?? { x: tc.x + 14, z: tc.z };
    const wonder = layFoundation(world, 'wonder', spot, 0, HUMAN);
    completeBuilding(world, wonder);
    wonder.hp = wonder.maxHp;
    expect(world.wonder?.building).toBe(wonder.id);
    let hitAt: number | null = null;
    let atWonder = 0;
    while (world.wonder && !world.gameOver && hitAt === null) {
      run(world, [ai], 2);
      const w = world.buildings.get(wonder.id);
      atWonder = [...world.units.values()].filter((u) => u.owner === AI && u.target === wonder.id).length;
      if (!w || w.owner !== HUMAN || w.hp < w.maxHp || (w.capture?.[AI] ?? 0) > 0) hitAt = world.time;
    }
    console.log(`seed ${seed}: wonder ${hitAt !== null ? `attacked with ${300 - (world.wonder?.remaining ?? 0) | 0} s of the countdown gone` : 'never attacked'}, ${atWonder} on it, rush ${ai.military.wonderRush}`);
    expect(hitAt).not.toBeNull();
    expect(world.gameOver).toBeNull();
    expect(ai.military.wonderRush || !world.wonder).toBe(true);
  }, 60_000);

  it('holding a completed wonder, it keeps its army at home', () => {
    const world = makeGame(4, ['human', 'ai']);
    world.wonderRules = { enabled: true, seconds: 1800 };
    advance(world, AI, 3);
    const home = world.townCenterOf(AI)!.pos;
    const spot = world.nav.nearestFree({ x: home.x + 12, z: home.z + 4 }) ?? { x: home.x + 12, z: home.z + 4 };
    const wonder = layFoundation(world, 'wonder', spot, 0, AI);
    completeBuilding(world, wonder);
    wonder.hp = wonder.maxHp;
    for (let i = 0; i < 24; i++) world.spawnUnit('swordsman', { x: home.x - 6 + (i % 4), z: home.z - 4 + Math.floor(i / 4) }, AI);
    const ai = new AIPlayer(world, AI, { difficulty: 'moderate', seed: 4, tune: { firstAttack: 0, firstWave: 6 } });
    run(world, [ai], 180);
    const army = [...world.units.values()].filter((u) => u.owner === AI && u.kind === 'swordsman');
    const near = army.filter((u) => d(u.pos, wonder.pos) < 30).length;
    console.log(`waves ${ai.military.wave}, ${near}/${army.length} soldiers within 30 of the wonder`);
    expect(ai.military.wave).toBe(0);
    expect(near).toBeGreaterThanOrEqual(army.length * 0.8);
  });
});
