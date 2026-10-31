import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type Heightfield } from '../core/types';
import { World } from './World';
import { completeBuilding, layFoundation } from './systems/build';
import { corralSheep, livestockSystem, HERD_CAP } from './systems/livestock';
import { closedGates, routeForUnit } from './systems/passage';
import { applyDamage } from './systems/combat';
import { movementSystem } from './systems/movement';
import { wildlifeSystem } from './systems/wildlife';
import { serializeWorld, deserializeWorld } from './serialize';
import { MAP_TYPES } from '../core/maps';
import { generateMap } from './mapgen';
import { devHook } from '../game/devHook';
import { validCommand } from '../network/protocol';
import { resolveBuildingOrder } from '../input/orders';

const hf: Heightfield = {
  width: 64, depth: 64, heightAt: () => 1, isWater: () => false,
  isWalkable: (x, z) => x >= 0 && z >= 0 && x < 64 && z < 64,
  forestDensity: () => 0, ground: () => GRASS_ONLY,
};
function setup() {
  const w = new World(hf, { townCenter: { x: 8, z: 8 }, villagers: [], scouts: [], props: [], nodes: [] });
  w.seed = 1;
  const b = layFoundation(w, 'corral', { x: 24, z: 24 }, 0, 1); completeBuilding(w, b);
  const worker = w.spawnVillager(b.pos);
  const sheep = [w.spawnUnit('sheep', { x: 23, z: 24 }), w.spawnUnit('sheep', { x: 25, z: 24 })];
  sheep.forEach(s => s.owner = 1);
  return { w, b, worker, sheep };
}
function run(w: World, seconds: number) { for (let i = 0; i < seconds * 10; i++) w.tick(0.1); }

describe('staffed livestock', () => {
  it('requires a present worker and two owned sheep, then produces food without carcass duplication or losing breeders', () => {
    const { w, b, worker, sheep } = setup(); const food = w.stock.food;
    run(w, 130); expect(w.stock.food).toBe(food); expect(corralSheep(w, b)).toHaveLength(2);
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id });
    run(w, 125); expect(w.stock.food).toBeGreaterThan(food);
    expect(corralSheep(w, b).length).toBeGreaterThanOrEqual(2);
    expect(corralSheep(w, b).length).toBeLessThanOrEqual(HERD_CAP);
    expect(sheep.every(s => w.units.has(s.id))).toBe(true);
    expect([...w.nodes.values()].filter(n => n.kind === 'carcass')).toHaveLength(0);
    w.dispatch({ type: 'stop', unitIds: [worker.id] });
    const stoppedFood = w.stock.food; run(w, 130); expect(w.stock.food).toBe(stoppedFood);
    expect(worker.tendingCorral).toBeUndefined();
  });
  it('does not produce with a missing pair, enemy sheep, remote worker or dead worker', () => {
    const { w, b, worker, sheep } = setup();
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id });
    run(w, 1); sheep[1].owner = 2;
    livestockSystem(w, 200); expect(corralSheep(w, b)).toHaveLength(1);
    sheep[1].owner = 1; worker.pos = { x: 50, z: 50 };
    const food = w.stock.food; livestockSystem(w, 200); expect(w.stock.food).toBe(food);
    worker.pos = { ...b.pos }; worker.hp = 0; livestockSystem(w, 200); expect(w.stock.food).toBe(food);
    expect(corralSheep(w, b)).toHaveLength(2);
  });
  it('reserves one worker, rejects foreign commands, and new orders release tending', () => {
    const { w, b, worker } = setup(); const second = w.spawnVillager(b.pos);
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id }, 2);
    expect(worker.tendingCorral).toBeUndefined();
    w.dispatch({ type: 'tend', unitIds: [worker.id, second.id], buildingId: b.id });
    w.dispatch({ type: 'tend', unitIds: [second.id], buildingId: b.id });
    expect(worker.tendingCorral).toBe(b.id); expect(second.tendingCorral).toBeUndefined();
    w.dispatch({ type: 'move', unitIds: [worker.id], target: { x: 40, z: 40 } });
    run(w, 5); expect(worker.tendingCorral).toBeUndefined();
    w.dispatch({ type: 'tend', unitIds: [second.id], buildingId: b.id });
    expect(second.tendingCorral).toBe(b.id);
    w.buildings.delete(b.id); livestockSystem(w, 1); expect(second.tendingCorral).toBeUndefined();
  });
  it('assigns a group across nearby corrals and stops surplus workers instead of leaving old work', () => {
    const { w, b, worker } = setup();
    const secondCorral = layFoundation(w, 'corral', { x: 36, z: 24 }, 0, 1); completeBuilding(w, secondCorral);
    const others = [w.spawnVillager({ x: 16, z: 24 }), w.spawnVillager({ x: 16, z: 25 })];
    const treeId = w.allocId();
    w.nodes.set(treeId, { id: treeId, kind: 'tree', type: 'wood', pos: { x: 16, z: 27 }, amount: 1000, radius: 0.5 });
    const ids = [worker.id, ...others.map(u => u.id)];
    w.dispatch({ type: 'gather', unitIds: ids, nodeId: treeId });
    w.dispatch({ type: 'tend', unitIds: ids, buildingId: b.id });
    expect(worker.tendingCorral).toBe(b.id); expect(others[0].tendingCorral).toBe(secondCorral.id);
    expect(others[1].state).toBe('idle'); expect(others[1].gatherNode).toBeNull();
    expect(w.gatherState.has(others[1].id)).toBe(false);
  });
  it('keeps valid tending when a new order is rejected', () => {
    const { w, b, worker } = setup();
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id }); run(w, 1);
    w.dispatch({ type: 'gather', unitIds: [worker.id], nodeId: 999999 });
    expect(worker.tendingCorral).toBe(b.id); expect(worker.state).toBe('tending');
    run(w, 1); expect(worker.tendingCorral).toBe(b.id);
  });
  it('flees an attack and resumes tending, while explicit orders override the return job', () => {
    const { w, b, worker } = setup();
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id }); run(w, 1);
    applyDamage(w, worker, 1, null, 2, { x: 23, z: 24 });
    expect(worker.state).toBe('moving'); expect(w.fleeState.get(worker.id)?.tend).toBe(b.id);
    const progress = b.breedProgress; run(w, 0.5); expect(b.breedProgress).toBe(progress);
    run(w, 20); expect(worker.state).toBe('tending'); expect(worker.tendingCorral).toBe(b.id);
    applyDamage(w, worker, 1, null, 2, { x: 23, z: 24 });
    w.dispatch({ type: 'move', unitIds: [worker.id], target: { x: 42, z: 42 } });
    run(w, 20); expect(worker.tendingCorral).toBeUndefined(); expect(w.fleeState.has(worker.id)).toBe(false);
  });
  it('bounds long-running herds', () => {
    const { w, b, worker } = setup();
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id }); run(w, 1);
    const food = w.stock.food;
    for (let i = 0; i < 1800; i++) { livestockSystem(w, 1); expect(corralSheep(w, b).length).toBeLessThanOrEqual(HERD_CAP); }
    expect(w.stock.food).toBeGreaterThan(food);
  });
  it('continues saved jobs, timers and gate policy deterministically on a generated map', () => {
    const { hf, layout } = generateMap(1, 1);
    const w = new World(hf, layout); w.seed = 1;
    const dev = devHook(w);
    const b = w.buildings.get(dev.placeComplete('corral')!)!;
    const gate = w.buildings.get(dev.placeComplete('gate')!)!;
    expect(b).toBeDefined(); expect(gate).toBeDefined();
    const worker = w.spawnVillager(b.pos);
    for (let i = 0; i < 2; i++) { const sheep = w.spawnUnit('sheep', { x: b.pos.x + i, z: b.pos.z }); sheep.owner = 1; }
    w.dispatch({ type: 'tend', unitIds: [worker.id], buildingId: b.id }); run(w, 50);
    w.dispatch({ type: 'gateLivestock', buildingId: gate.id, open: true });
    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(restored.units.get(worker.id)?.tendingCorral).toBe(b.id);
    expect(restored.units.get(worker.id)?.state).toBe('tending');
    expect(restored.buildings.get(b.id)?.breedProgress).toBe(b.breedProgress);
    expect(restored.buildings.get(b.id)?.harvestProgress).toBe(b.harvestProgress);
    expect(restored.buildings.get(gate.id)?.livestockOpen).toBe(true);
    run(w, 65); run(restored, 65);
    expect(serializeWorld(restored)).toEqual(serializeWorld(w));
  });
  it('routes UI and validates multiplayer commands', () => {
    const { b } = setup(); expect(resolveBuildingOrder([1], b)).toEqual({ type: 'tend', unitIds: [1], buildingId: b.id });
    expect(validCommand({ type: 'tend', unitIds: [1], buildingId: b.id })).toBe(true);
    expect(validCommand({ type: 'gateLivestock', buildingId: b.id, open: true })).toBe(true);
    expect(validCommand({ type: 'gateLivestock', buildingId: b.id, open: 'true' })).toBe(false);
  });
});

describe('livestock movement and gates', () => {
  it('keeps moved sheep near the new destination', () => {
    const { w, sheep } = setup(); const s = sheep[0];
    w.dispatch({ type: 'move', unitIds: [s.id], target: { x: 40, z: 35 } });
    run(w, 80); expect(Math.hypot(s.pos.x - 40, s.pos.z - 35)).toBeLessThan(2);
    expect(s.leashAnchor).toEqual({ x: 40, z: 35 });
  });
  it('blocks owner sheep through a closed gate, allows people, and admits only owner livestock when open', () => {
    const { w, sheep, worker } = setup(); const s = sheep[0];
    const gate = layFoundation(w, 'gate', { x: 32, z: 24 }, 0, 1); completeBuilding(w, gate);
    expect(closedGates(w, 1)).toHaveLength(0); expect(closedGates(w, 1, true)).toHaveLength(1);
    s.pos = { x: 29, z: 24 }; worker.pos = { ...s.pos };
    const end = { x: 35, z: 24 };
    expect(routeForUnit(w, worker, end)).toEqual([end]);
    expect(routeForUnit(w, s, end)).not.toEqual([end]);
    w.dispatch({ type: 'gateLivestock', buildingId: gate.id, open: true }, 2);
    expect(gate.livestockOpen).toBeUndefined();
    w.dispatch({ type: 'gateLivestock', buildingId: gate.id, open: true });
    expect(routeForUnit(w, s, end)).toEqual([end]); expect(closedGates(w, 2, true)).toHaveLength(1);
    // Closing after an order must also clamp the existing path and idle wildlife steps.
    s.path = [end]; s.state = 'moving'; w.dispatch({ type: 'gateLivestock', buildingId: gate.id, open: false });
    movementSystem(w, 2); expect(s.pos.x).toBeLessThan(31);
    s.path = []; s.pos = { x: 30.9, z: 24 }; s.leashAnchor = end;
    wildlifeSystem(w, 2); expect(s.pos.x).toBeLessThan(31);
    const restored = deserializeWorld(serializeWorld(w), hf); expect(closedGates(restored, 1, true)).toHaveLength(1);
  });
});


describe('starting livestock access', () => {
  it.each(MAP_TYPES)('%s offers each starting player a reachable breeding pair', type => {
    const { hf, layout } = generateMap(1, 2, { type });
    const w = new World(hf, layout);
    const sheep = [...w.units.values()].filter(u => u.kind === 'sheep');
    for (const owner of w.players.keys()) {
      const villager = [...w.units.values()].find(u => u.owner === owner && u.kind === 'villager')!;
      expect(sheep.filter(s => w.nav.findPath(villager.pos, s.pos) !== null).length).toBeGreaterThanOrEqual(2);
    }
  });
});
