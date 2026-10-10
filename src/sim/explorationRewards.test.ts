import { describe, expect, it } from 'vitest';
import { footprintRadius } from '../core/buildings';
import { GRASS_ONLY, type Building, type Heightfield, type MapLayout } from '../core/types';
import { World } from './World';
import { serializeWorld, deserializeWorld } from './serialize';
import { CONVERSION_SECONDS, RELIC_GOLD_PER_SECOND } from './systems/explorationRewards';

const hf: Heightfield = { width: 80, depth: 80, heightAt: () => 1, isWater: () => false,
  isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80, forestDensity: () => 0, ground: () => GRASS_ONLY };
function world(): World {
  const l: MapLayout = { townCenter: { x: 10, z: 10 }, villagers: [], scouts: [], nodes: [],
    extraStarts: [{ townCenter: { x: 70, z: 70 }, villagers: [], scouts: [] }],
    props: [
      ...[30, 32].map(x => ({ kind: 'ruinColumn' as const, pos: { x, z: 30 }, rot: 0, scale: 1, blockRadius: 0.3 })),
      ...[50, 52].map(x => ({ kind: 'ruinColumn' as const, pos: { x, z: 30 }, rot: 0, scale: 1, blockRadius: 0.3 })),
      ...[40, 42].map(x => ({ kind: 'standingStone' as const, pos: { x, z: 50 }, rot: 0, scale: 1, blockRadius: 0.3 })),
    ] };
  const w = new World(hf, l); w.seed = 1; return w;
}
function temple(w: World): Building {
  const b: Building = { id: w.allocId(), kind: 'temple', owner: 1, pos: { x: 20, z: 50 }, hp: 1400, maxHp: 1400,
    rot: 0, radius: footprintRadius('temple'), complete: true, buildProgress: 1, queue: 0, progress: 0 };
  w.buildings.set(b.id, b); return b;
}
function run(w: World, seconds: number) { for (let i = 0; i < seconds * 20; i++) w.tick(0.05); }

describe('exploration rewards', () => {
  it('claims each ruin once for the first arriving player, with resources or free research', () => {
    const w = world(); const [first, second] = [...w.exploration.values()].filter(s => s.kind === 'treasure');
    const a = w.spawnUnit('scout', first.pos, 2); w.spawnUnit('scout', first.pos, 1);
    const gold1 = w.stockOf(1).gold, gold2 = w.stockOf(2).gold;
    w.tick(0.05); expect(first.claimedBy).toBe(2); expect(w.stockOf(1).gold).toBe(gold1); expect(w.stockOf(2).gold).toBe(gold2 + 120);
    a.pos = { ...second.pos }; w.tick(0.05);
    expect(second.claimedBy).toBe(2); expect(w.players.get(2)!.researched.has('bronzeAxe')).toBe(true);
    run(w, 2); expect(w.stockOf(2).gold).toBe(gold2 + 120);
  });
  it('carries a relic to a temple, generates gold, survives saving, and drops after destruction', () => {
    const w = world(); const b = temple(w); const site = [...w.exploration.values()].find(s => s.kind === 'relic')!;
    const priest = w.spawnUnit('priest', site.pos); w.tick(0.05); expect(priest.relic).toBe(site.id);
    w.dispatch({ type: 'move', unitIds: [priest.id], target: { x: b.pos.x + b.radius + 0.5, z: b.pos.z } });
    run(w, 20); expect(site.temple).toBe(b.id); expect(priest.relic).toBeUndefined();
    const saved = deserializeWorld(serializeWorld(w), hf); expect(serializeWorld(saved)).toEqual(serializeWorld(w));
    const gold = saved.stock.gold; run(saved, 10); expect(saved.stock.gold - gold).toBeCloseTo(10 * RELIC_GOLD_PER_SECOND, 4);
    saved.buildings.delete(b.id); saved.tick(0.05); expect(saved.exploration.get(site.id)!.temple).toBeUndefined();
  });
  it('drops a carried relic at the last carrier position when killed', () => {
    const w = world(); const site = [...w.exploration.values()].find(s => s.kind === 'relic')!;
    const p = w.spawnUnit('priest', site.pos); w.tick(0.05); p.pos = { x: 40, z: 40 }; w.tick(0.05);
    w.units.delete(p.id); w.tick(0.05); expect(site.carrier).toBeUndefined(); expect(site.pos).toEqual({ x: 40, z: 40 });
    const q = w.spawnUnit('priest', site.pos, 2); w.tick(0.05); expect(q.relic).toBe(site.id);
  });
});
describe('priest commands', () => {
  it('heals allied units to maximum HP and rejects healing enemies', () => {
    const w = world(); const p = w.spawnUnit('priest', { x: 22, z: 22 }); const ally = w.spawnUnit('villager', { x: 23, z: 22 });
    ally.hp = 5; w.updateFog(); w.dispatch({ type: 'heal', unitIds: [p.id], targetId: ally.id }); run(w, 8); expect(ally.hp).toBe(ally.maxHp);
    const enemy = w.spawnUnit('villager', { x: 23, z: 23 }, 2); enemy.hp = 1; w.updateFog();
    w.dispatch({ type: 'heal', unitIds: [p.id], targetId: enemy.id }); expect(w.priestOrders.has(p.id)).toBe(false);
  });
  it('channels conversion, clears old jobs and refuses commands using another player priest', () => {
    const w = world(); const p = w.spawnUnit('priest', { x: 22, z: 22 }); const enemy = w.spawnUnit('villager', { x: 23, z: 22 }, 2);
    w.updateFog(); w.dispatch({ type: 'convert', unitIds: [p.id], targetId: enemy.id }, 2); expect(w.priestOrders.size).toBe(0);
    w.dispatch({ type: 'convert', unitIds: [p.id], targetId: enemy.id }); run(w, CONVERSION_SECONDS - 1); expect(enemy.owner).toBe(2);
    const loaded = deserializeWorld(serializeWorld(w), hf); run(loaded, 2); expect(loaded.units.get(enemy.id)!.owner).toBe(1);
    expect(loaded.units.get(enemy.id)!.gatherNode).toBeNull(); expect(loaded.units.get(enemy.id)!.state).toBe('idle');
  });
  it('move and stop cancel conversion and hidden targets cannot be converted', () => {
    const w = world(); const p = w.spawnUnit('priest', { x: 22, z: 22 }); const enemy = w.spawnUnit('villager', { x: 23, z: 22 }, 2);
    w.updateFog(); w.dispatch({ type: 'convert', unitIds: [p.id], targetId: enemy.id }); w.dispatch({ type: 'stop', unitIds: [p.id] });
    run(w, 14); expect(enemy.owner).toBe(2);
    enemy.pos = { x: 60, z: 60 }; w.updateFog(); w.dispatch({ type: 'convert', unitIds: [p.id], targetId: enemy.id }); expect(w.priestOrders.size).toBe(0);
  });
});
