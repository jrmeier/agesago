import { describe, expect, it } from 'vitest';
import { BUILDINGS, MAX_POP, TERRITORY } from '../core/buildings';
import { MAP_TYPES, type MapSize } from '../core/maps';
import { GRASS_ONLY, type Building, type BuildingKind, type Command, type Heightfield, type MapLayout, type PlayerId, type Vec2 } from '../core/types';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { destroyBuilding } from '../sim/systems/combat';
import { EXPLORED } from '../sim/visibility';
import { defaultPlayers, World } from '../sim/World';
import { AIPlayer } from './AIPlayer';
import { dist } from './context';
import { makeGame, run } from './harness';
import { makeProfile } from './profile';

/** Longest pop-cap stall tolerated (sim seconds) while the AI has wood and an idle villager. */
const MAX_STALL = 15;

/** A pop-cap stall: capped below MAX_POP with house wood in stock and a villager standing idle. */
function stalled(world: World, p: PlayerId): boolean {
  const cap = world.popCapOf(p);
  if (world.popOf(p) < cap || cap >= MAX_POP || world.stockOf(p).wood < BUILDINGS.house.cost.wood!) return false;
  for (const u of world.units.values()) if (u.owner === p && u.kind === 'villager' && u.state === 'idle') return true;
  return false;
}

function townCenters(world: World, p: PlayerId): Building[] {
  return [...world.buildings.values()].filter((b) => b.owner === p && b.kind === 'townCenter');
}

describe('AI and territory (M18-5)', () => {
  it.each(MAP_TYPES.flatMap((type) => [1, 2, 3, 4, 5].map((seed) => [type, seed] as const)))(
    '%s seed %i: places only on legal land and never stalls on territory',
    (type, seed) => {
      const world = makeGame(seed, ['human', 'ai'], { size: 'small', type });
      const ai = new AIPlayer(world, 2, { difficulty: 'moderate', seed });
      let stall = 0;
      let maxStall = 0;
      let aiMs = 0;
      let ticks = 0;
      // Every foundation the AI lays stands on its own land (or neutral land for the kinds allowed there).
      const illegal: string[] = [];
      const off = world.events.on('spawned', (e) => {
        const b = world.buildings.get(e.id);
        if (!b || b.owner !== 2) return;
        const owner = world.territoryOwner(b.pos);
        if (owner !== 2 && (owner !== 0 || BUILDINGS[b.kind].placeIn !== 'ownOrNeutral')) illegal.push(`${b.kind}@${b.pos.x},${b.pos.z}`);
      });
      for (let t = 0; t < 10 * 60; t++) {
        const st = run(world, [ai], 1);
        aiMs += st.aiMs.get(2)!;
        ticks += st.updates;
        stall = stalled(world, 2) ? stall + 1 : 0;
        maxStall = Math.max(maxStall, stall);
      }
      off();
      expect(illegal).toEqual([]);
      expect(ai.stats.territoryRejected).toBe(0);
      expect(maxStall).toBeLessThanOrEqual(MAX_STALL);
      expect(world.popCapOf(2)).toBeGreaterThan(BUILDINGS.townCenter.popBonus! + 20);
      expect(aiMs / ticks).toBeLessThan(1);
    },
    60_000
  );

  it('moves on to a new spot when a build order is rejected for territory', () => {
    const world = makeGame(1, ['human', 'ai']);
    const ai = new AIPlayer(world, 2, { difficulty: 'moderate', seed: 1 });
    // The first three build orders bounce as if the land had changed hands (a stale view).
    const tried: { kind: BuildingKind; pos: Vec2 }[] = [];
    const dispatch = world.dispatch.bind(world);
    world.dispatch = (cmd: Command, by?: PlayerId) => {
      if (cmd.type === 'build' && by === 2) {
        tried.push({ kind: cmd.kind, pos: { ...cmd.pos } });
        if (tried.length <= 3) {
          world.events.emit({ type: 'rejected', reason: 'territory' });
          return;
        }
      }
      dispatch(cmd, by);
    };
    run(world, [ai], 120);
    expect(ai.stats.territoryRejected).toBe(3);
    // It never asks for a bounced spot again (within the memory window).
    tried.slice(0, 3).forEach((b, i) => {
      const again = tried.slice(i + 1).filter((t) => Math.abs(t.pos.x - b.pos.x) < 2 && Math.abs(t.pos.z - b.pos.z) < 2);
      expect(again).toEqual([]);
    });
    // A bounced house is retried elsewhere at once, and building carries on.
    expect(tried.length).toBeGreaterThan(3);
    expect([...world.buildings.values()].some((b) => b.owner === 2 && b.kind === 'house')).toBe(true);
  });

  const expansionMaps: [MapSize, number][] = [
    ['medium', 1],
    ['medium', 2],
    ['medium', 3],
    ['large', 1],
    ['large', 2],
    ['giant', 1],
  ];
  it.each(expansionMaps)('founds a second Town Center toward resources on a %s map (seed %i)', (size, seed) => {
    const world = makeGame(seed, ['human', 'ai'], { size });
    const ai = new AIPlayer(world, 2, { difficulty: 'moderate', seed });
    const first = world.townCenterOf(2)!;
    // Founded, not captured: a foundation the AI lays.
    let second: Building | undefined;
    const off = world.events.on('spawned', (e) => {
      const b = world.buildings.get(e.id);
      if (b && b.owner === 2 && b.kind === 'townCenter' && !b.complete) second ??= b;
    });
    run(world, [ai], 15 * 60, 0.05, () => !!second);
    off();
    expect(second, 'second Town Center laid').toBeDefined();
    const tc2: Building = second!;
    expect(dist(tc2.pos, first.pos)).toBeGreaterThanOrEqual(TERRITORY.townCenterSpacing);
    // Toward a resource cluster: known mines or trees close by.
    const near = [...world.nodes.values()].filter((n) => n.type !== 'food' && dist(n.pos, tc2.pos) < 16);
    expect(near.length).toBeGreaterThan(0);
    // Never more than the profile's towns.
    expect(townCenters(world, 2).length).toBeLessThanOrEqual(makeProfile('moderate').towns);
  }, 60_000);

  it('stays with one Town Center on a small map and at easy', () => {
    const small = makeGame(1, ['human', 'ai'], { size: 'small' });
    const a = new AIPlayer(small, 2, { difficulty: 'moderate', seed: 1 });
    const founded: number[] = [];
    small.events.on('spawned', (e) => {
      const b = small.buildings.get(e.id);
      if (b && b.owner === 2 && b.kind === 'townCenter') founded.push(b.id);
    });
    run(small, [a], 13 * 60);
    expect(founded).toEqual([]);
    expect(makeProfile('easy').expandAt).toBeNull();
  }, 60_000);
});

// ---- Capture: scripted scenarios on a flat, explored arena ----

const P1_TC = { x: 20, z: 40 };
const P2_TC = { x: 130, z: 40 };

function flat(): Heightfield {
  return {
    width: 150, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 150 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

/** Player 1 (idle human) and player 2 (the AI), Town Centers 110 apart, all explored. */
function arena(): World {
  const layout: MapLayout = {
    townCenter: P1_TC, villagers: [], scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: P2_TC, villagers: [], scouts: [] }],
  };
  const players = defaultPlayers(2).map((p, i) => ({ ...p, control: i ? 'ai' : 'human' }) as typeof p);
  const w = new World(flat(), layout, players);
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
function raider(w: World): AIPlayer {
  return new AIPlayer(w, 2, { difficulty: 'moderate', tune: { firstAttack: 0, firstWave: 4, waveGap: 0, counters: false, research: null, retreatAt: 0 } });
}

describe('AI and capture (M18-5)', () => {
  it('captures an undefended enemy barracks instead of razing it', () => {
    const w = arena();
    const barracks = finished(w, 'barracks', { x: 85, z: 40 }, 1);
    for (let i = 0; i < 6; i++) w.spawnUnit('swordsman', { x: 92, z: 36 + i * 1.5 }, 2);
    const ai = raider(w);
    const commands: string[] = [];
    const dispatch = w.dispatch.bind(w);
    w.dispatch = (cmd: Command, by?: PlayerId) => {
      if (by === 2 && (cmd.type === 'capture' || cmd.type === 'attack')) commands.push(cmd.type);
      dispatch(cmd, by);
    };
    run(w, [ai], 150, 0.05, () => barracks.owner === 2);
    expect(barracks.owner).toBe(2);
    run(w, [ai], 3);
    expect(commands).toContain('capture');
    expect(commands).not.toContain('attack');
    // Captured, not wrecked (it only lost a little to decay, off its owner's land).
    expect(barracks.hp).toBeGreaterThan(barracks.maxHp * 0.8);
    // It is no longer an enemy target.
    expect(ai.intel.buildings.has(barracks.id)).toBe(false);
  });

  it('razes houses rather than capturing them', () => {
    const w = arena();
    const house = finished(w, 'house', { x: 85, z: 40 }, 1);
    for (let i = 0; i < 6; i++) w.spawnUnit('swordsman', { x: 92, z: 36 + i * 1.5 }, 2);
    const ai = raider(w);
    const commands: string[] = [];
    const dispatch = w.dispatch.bind(w);
    w.dispatch = (cmd: Command, by?: PlayerId) => {
      if (by === 2 && (cmd.type === 'capture' || cmd.type === 'attack')) commands.push(cmd.type);
      dispatch(cmd, by);
    };
    const hp = house.hp;
    run(w, [ai], 60);
    expect(commands).not.toContain('capture');
    expect(house.hp).toBeLessThan(hp * 0.8);
    expect(house.owner).toBe(1);
  });

  it('turns on defenders before going on razing (M16-10)', () => {
    const w = arena();
    const house = finished(w, 'house', { x: 85, z: 40 }, 1);
    const wave = Array.from({ length: 6 }, (_, i) => w.spawnUnit('swordsman', { x: 92, z: 36 + i * 1.5 }, 2));
    const ai = raider(w);
    run(w, [ai], 60, 0.05, () => wave.filter((u) => u.target === house.id).length >= 4);
    expect(wave.filter((u) => u.target === house.id).length).toBeGreaterThanOrEqual(4);
    // Defenders turn up and hit the razers: before M16-10 these stood at the house and died.
    const defenders = Array.from({ length: 4 }, (_, i) => w.spawnUnit('hoplite', { x: 81, z: 37 + i * 2 }, 1));
    run(w, [ai], 6);
    const onDefenders = wave.filter((u) => w.units.has(u.id) && u.target !== null && defenders.some((d) => d.id === u.target));
    expect(onDefenders.length).toBeGreaterThanOrEqual(4);
    run(w, [ai], 60, 0.05, () => defenders.every((d) => !w.units.has(d.id)));
    expect(defenders.filter((d) => w.units.has(d.id))).toEqual([]);
    expect(wave.filter((u) => w.units.has(u.id)).length).toBeGreaterThan(0);
  });

  it('hunts down the last enemy units once no enemy building is known (M16-10)', () => {
    const w = arena();
    destroyBuilding(w, w.townCenterOf(1)!);
    // A beaten player's last villager, out of sight in a far corner of explored ground.
    const last = w.spawnUnit('villager', { x: 12, z: 72 }, 1);
    const wave = Array.from({ length: 12 }, (_, i) => w.spawnUnit('swordsman', { x: 118, z: 34 + i }, 2));
    const ai = raider(w);
    run(w, [ai], 300, 0.05, () => !w.units.has(last.id));
    expect(w.units.has(last.id)).toBe(false);
    expect(w.defeatedPlayers.has(1)).toBe(true);
    expect(wave.filter((u) => w.units.has(u.id)).length).toBe(12);
  });

  it('razes a building whose garrison holds off the capture', () => {
    const w = arena();
    const temple = finished(w, 'temple', { x: 85, z: 40 }, 1);
    // A temple doesn't shoot. Five hoplites inside win back 15 points a second: four swordsmen (10/s) never gain.
    for (let i = 0; i < 5; i++) {
      const u = w.spawnUnit('hoplite', { x: 85, z: 44 }, 1);
      w.dispatch({ type: 'garrison', unitIds: [u.id], buildingId: temple.id }, 1);
    }
    run(w, [], 8);
    expect(temple.occupants?.length).toBe(5);
    for (let i = 0; i < 4; i++) w.spawnUnit('swordsman', { x: 92, z: 36 + i * 1.5 }, 2);
    const ai = raider(w);
    const commands: string[] = [];
    const dispatch = w.dispatch.bind(w);
    w.dispatch = (cmd: Command, by?: PlayerId) => {
      if (by === 2 && (cmd.type === 'capture' || cmd.type === 'attack')) commands.push(cmd.type);
      dispatch(cmd, by);
    };
    run(w, [ai], 200, 0.05, () => !w.buildings.has(temple.id) || temple.owner === 2);
    expect(commands).toContain('capture');
    expect(commands).toContain('attack');
    expect(commands.indexOf('attack')).toBeGreaterThan(commands.indexOf('capture'));
  });

  it('garrisons villagers and soldiers in a Town Center under capture', () => {
    const w = arena();
    // The AI is player 2; player 1's soldiers capture its Town Center.
    const tc = w.townCenterOf(2)!;
    const villagers = Array.from({ length: 4 }, (_, i) => w.spawnUnit('villager', { x: tc.pos.x + 6, z: tc.pos.z - 3 + i * 1.5 }, 2).id);
    const guard = w.spawnUnit('hoplite', { x: tc.pos.x + 8, z: tc.pos.z }, 2).id;
    const capturers = Array.from({ length: 6 }, (_, i) => w.spawnUnit('swordsman', { x: tc.pos.x - tc.radius - 1.2, z: tc.pos.z - 3 + i }, 1).id);
    w.dispatch({ type: 'capture', unitIds: capturers, targetId: tc.id }, 1);
    const ai = new AIPlayer(w, 2, { difficulty: 'moderate', tune: { research: null } });
    run(w, [ai], 25);
    const inside = new Set(tc.occupants ?? []);
    expect(villagers.filter((id) => inside.has(id)).length).toBeGreaterThanOrEqual(3);
    // Outnumbered six to one: the hoplite goes inside too.
    expect(inside.has(guard)).toBe(true);
    // With the garrison it holds.
    run(w, [ai], 60);
    expect(tc.owner).toBe(2);
  });
});
