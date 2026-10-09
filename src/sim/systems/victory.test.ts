import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield, type MapLayout, type SimEvent } from '../../core/types';
import { World, defaultPlayers } from '../World';
import { destroyBuilding, killUnit } from './combat';

function arena(teams = [1, 2]): World {
  const hf: Heightfield = {
    width: 80, depth: 80, heightAt: () => 1, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
  const starts = teams.map((_, i) => ({
    townCenter: { x: 10 + 25 * i, z: 10 }, villagers: [{ x: 10 + 25 * i, z: 15 }], scouts: [],
  }));
  const layout: MapLayout = { ...starts[0], extraStarts: starts.slice(1), nodes: [], props: [] };
  return new World(hf, layout, defaultPlayers(teams.length).map((p, i) => ({ ...p, team: teams[i] })));
}

function record(world: World): SimEvent[] {
  const events: SimEvent[] = [];
  for (const type of ['died', 'removed', 'defeated', 'gameOver'] as const) world.events.on(type, (e) => events.push(e));
  return events;
}

function run(world: World): void {
  for (let i = 0; i < 25; i++) world.tick(0.05);
}

describe('conquest victory', () => {
  it('requires elimination of both units and buildings, then emits defeat and gameOver once', () => {
    const w = arena();
    const events = record(w);
    const u = [...w.units.values()].find((u) => u.owner === 2)!;
    killUnit(w, u);
    run(w);
    expect(w.isDefeated(2)).toBe(false);
    expect(w.gameOver).toBeNull();
    destroyBuilding(w, w.townCenterOf(2)!);
    run(w);
    expect(w.isDefeated(2)).toBe(true);
    expect(w.gameOver).toEqual({ winners: [1], reason: 'conquest' });
    run(w);
    expect(events.filter((e) => e.type === 'defeated')).toEqual([{ type: 'defeated', player: 2, reason: 'conquest' }]);
    expect(events.filter((e) => e.type === 'gameOver')).toEqual([{ type: 'gameOver', winners: [1], reason: 'conquest' }]);
  });

  it('a remaining unit or unfinished foundation keeps its player alive', () => {
    const w = arena();
    destroyBuilding(w, w.townCenterOf(2)!);
    run(w);
    expect(w.isDefeated(2)).toBe(false);
    const other = arena();
    for (const u of other.units.values()) if (u.owner === 2) killUnit(other, u);
    other.townCenterOf(2)!.complete = false;
    run(other);
    expect(other.isDefeated(2)).toBe(false);
  });

  it('resigns only the issuer, with death/removal events, queue/nav/job cleanup and immediate result', () => {
    const w = arena();
    const events = record(w);
    const tc = w.townCenterOf(2)!;
    const u = [...w.units.values()].find((u) => u.owner === 2)!;
    w.stockOf(2).food = 50;
    w.dispatch({ type: 'train', buildingId: tc.id }, 2);
    w.buildState.set(u.id, tc.id);
    w.exploreQueue.add(u.id);
    w.projectiles.push({ at: 10, by: u.id, kind: 'archer', owner: 2, from: u.pos, aim: w.townCenter!.pos, targetId: 1 });
    w.dispatch({ type: 'resign' }, 2);
    expect(w.popOf(2)).toBe(0);
    expect(w.townCenterOf(2)).toBeUndefined();
    expect(w.nav.isFree(tc.pos)).toBe(true);
    expect(w.buildState.has(u.id)).toBe(false);
    expect(w.exploreQueue.has(u.id)).toBe(false);
    expect(w.projectiles).toEqual([]);
    expect(tc.queue).toBe(0);
    expect(w.popOf(1)).toBe(1);
    expect(w.gameOver).toEqual({ winners: [1], reason: 'resign' });
    expect(events).toEqual([
      { type: 'died', id: u.id, kind: u.kind, owner: 2, pos: u.pos }, { type: 'removed', id: u.id },
      { type: 'died', id: tc.id, kind: tc.kind, owner: 2, pos: tc.pos }, { type: 'removed', id: tc.id },
      { type: 'defeated', player: 2, reason: 'resign' }, { type: 'gameOver', winners: [1], reason: 'resign' },
    ]);
    w.dispatch({ type: 'resign' }, 2);
    w.dispatch({ type: 'resign' }, 999);
    run(w);
    expect(events).toHaveLength(6);
  });

  it('continues a three-player free-for-all until only one side survives', () => {
    const w = arena([1, 2, 3]);
    w.dispatch({ type: 'resign' }, 2);
    expect(w.isDefeated(2)).toBe(true);
    expect(w.gameOver).toBeNull();
    w.dispatch({ type: 'resign' }, 3);
    expect(w.gameOver).toEqual({ winners: [1], reason: 'resign' });
  });

  it('awards every surviving ally on a three-player team', () => {
    const w = arena([7, 9, 7]);
    w.dispatch({ type: 'resign' }, 2);
    expect(w.gameOver).toEqual({ winners: [1, 3], reason: 'resign' });
  });

  it('finishes two allied players without requiring an elimination', () => {
    const w = arena([4, 4]);
    const events = record(w);
    run(w);
    expect(w.gameOver).toEqual({ winners: [1, 2], reason: 'conquest' });
    expect(events).toEqual([{ type: 'gameOver', winners: [1, 2], reason: 'conquest' }]);
  });

  it('handles simultaneous elimination as an empty-winner draw and checks at roughly 1 Hz', () => {
    const w = arena();
    const events = record(w);
    w.tick(0.05);
    for (const u of [...w.units.values()]) killUnit(w, u);
    for (const b of [...w.buildings.values()]) destroyBuilding(w, b);
    w.tick(0.05);
    expect(w.gameOver).toBeNull();
    run(w);
    expect(w.gameOver).toEqual({ winners: [], reason: 'conquest' });
    expect(events.filter((e) => e.type === 'defeated')).toHaveLength(2);
  });
});
