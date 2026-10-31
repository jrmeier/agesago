import { describe, expect, it } from 'vitest';
import { GRASS_ONLY, type BuildingKind, type Heightfield, type UnitKind } from '../core/types';
import { canWork, UNITS } from '../core/units';
import { World } from './World';
import { completeBuilding, layFoundation } from './systems/build';
import { applyRally } from './systems/combat';
import { corralWorker } from './systems/livestock';

const hf: Heightfield = {
  width: 80, depth: 80, heightAt: () => 1, isWater: () => false,
  isWalkable: (x, z) => x >= 0 && z >= 0 && x < 80 && z < 80,
  forestDensity: () => 0, ground: () => GRASS_ONLY,
};
function setup(kind: UnitKind = 'hoplite') {
  const w = new World(hf, { townCenter: { x: 10, z: 10 }, villagers: [], scouts: [], props: [],
    extraStarts: [{ townCenter: { x: 70, z: 70 }, villagers: [], scouts: [] }],
    nodes: [{ kind: 'tree', pos: { x: 20, z: 20 }, amount: 100 },
      { kind: 'tree', pos: { x: 23, z: 20 }, amount: 100 },
      { kind: 'gold', pos: { x: 20, z: 25 }, amount: 100 }] });
  const u = w.spawnUnit(kind, { x: 18, z: 20 }, 1);
  w.visibility.state.fill(1);
  const [tree, nearby, gold] = [...w.nodes.values()];
  return { w, u, tree, nearby, gold };
}
function run(w: World, seconds: number) { for (let i = 0; i < seconds * 20; i++) w.tick(0.05); }
function until(w: World, predicate: () => boolean, seconds = 90) {
  for (let i = 0; i < seconds * 20 && !predicate(); i++) w.tick(0.05);
  expect(predicate()).toBe(true);
}
function building(w: World, kind: BuildingKind, x = 28, z = 28, owner = 1) {
  const b = layFoundation(w, kind, { x, z }, 0, owner); completeBuilding(w, b); return b;
}
const land: UnitKind[] = ['villager', 'scout', 'hoplite', 'swordsman', 'slinger', 'archer', 'horseman', 'priest', 'tradeCart', 'phalangiteGuard', 'legionary', 'immortal', 'raider'];

describe('explicit land-unit economy work', () => {
  it('covers every trained land kind and excludes all ships and animals', () => {
    expect((Object.keys(UNITS) as UnitKind[]).filter(canWork).sort()).toEqual([...land].sort());
  });
  it.each(land)('%s gathers and deposits only after an explicit order', kind => {
    const { w, u, tree } = setup(kind); const stock = w.stock.wood;
    run(w, 2); expect(u.gatherNode).toBeNull(); expect(w.stock.wood).toBe(stock);
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id });
    until(w, () => w.stock.wood > stock);
    expect(u.gatherNode).toBe(tree.id); expect(tree.amount).toBeLessThan(100);
  });
  it('keeps hoplite work through enemy scans and switches jobs without losing cargo', () => {
    const { w, u, tree, gold } = setup();
    const enemy = w.spawnUnit('hoplite', { x: 23, z: 23 }, 2); enemy.stance = 'passive';
    w.dispatch({ type: 'attackMove', unitIds: [u.id], target: { x: 30, z: 20 } });
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id });
    until(w, () => (u.carry?.amount ?? 0) >= 3);
    expect(u.state).toBe('gathering'); expect(u.target).toBeNull();
    const cargo = u.carry!.amount, stock = w.stock.wood;
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: gold.id });
    expect(u.state).toBe('toDrop'); expect(u.gatherNode).toBe(gold.id);
    until(w, () => w.stock.wood === stock + cargo);
    until(w, () => u.carry?.type === 'gold');
    w.updateFog(); w.dispatch({ type: 'attack', unitIds: [u.id], targetId: enemy.id });
    expect(u.state).toBe('attacking'); expect(u.gatherNode).toBeNull(); expect(w.gatherState.has(u.id)).toBe(false);
    expect(u.carry?.type).toBe('gold');
  });
  it('retargets exhausted sources locally to the same resource', () => {
    const { w, u, tree, nearby } = setup(); tree.amount = 1;
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id });
    until(w, () => u.gatherNode === nearby.id);
    expect(u.gatherType).toBe('wood'); expect(w.gatherState.get(u.id)?.anchor).toEqual(tree.pos);
  });
  it('builds a permanent farm, works it, then replaces farming with construction and tending', () => {
    const { w, u } = setup(); w.stock.wood = 1000;
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'farm', pos: { x: 25, z: 30 }, rot: 0 });
    const farm = [...w.buildings.values()].find(b => b.kind === 'farm')!; expect(farm).toBeDefined();
    until(w, () => farm.complete && u.carry?.type === 'food');
    expect(w.farmers.get(farm.id)).toBe(u.id); const cargo = { ...u.carry! };
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'house', pos: { x: 35, z: 30 }, rot: 0 });
    const house = [...w.buildings.values()].find(b => b.kind === 'house')!;
    expect(w.farmers.has(farm.id)).toBe(false); expect(u.carry).toEqual(cargo);
    until(w, () => house.complete);
    const corral = building(w, 'corral', 40, 40);
    w.dispatch({ type: 'tend', unitIds: [u.id], buildingId: corral.id });
    until(w, () => u.state === 'tending'); expect(corralWorker(w, corral)).toBe(u);
    const food = w.stock.food;
    w.spawnUnit('sheep', { x: 39, z: 40 }, 1); w.spawnUnit('sheep', { x: 41, z: 40 }, 1);
    until(w, () => w.stock.food > food, 130);
    w.dispatch({ type: 'construct', unitIds: [u.id], buildingId: farm.id });
    expect(u.tendingCorral).toBeUndefined(); expect(u.gatherNode).toBe(farm.id);
  });
  it('allows cavalry to finish wall segments consecutively', () => {
    const { w, u } = setup('horseman'); w.stock.wood = 1000;
    w.dispatch({ type: 'buildWall', unitIds: [u.id], kind: 'palisade', from: { x: 30, z: 30 }, to: { x: 36, z: 30 } });
    const walls = [...w.buildings.values()].filter(b => b.kind === 'palisade'); expect(walls.length).toBeGreaterThan(1);
    until(w, () => walls.every(b => b.complete), 160);
  });
  it.each(['resource', 'farm', 'foundation', 'corral'])('rallies trained archers to %s work', target => {
    const { w, u, tree } = setup('archer');
    const b = target === 'resource' ? tree : target === 'foundation'
      ? layFoundation(w, 'house', { x: 28, z: 28 }, 0, 1)
      : building(w, target as 'farm' | 'corral');
    const trainer = w.townCenter!; trainer.rally = { pos: b.pos, targetId: b.id };
    applyRally(w, trainer, u);
    if (target === 'foundation') { expect(w.buildState.get(u.id)).toBe(b.id); until(w, () => w.buildings.get(b.id)!.complete); }
    else if (target === 'corral') { until(w, () => u.state === 'tending'); expect(u.tendingCorral).toBe(b.id); }
    else { until(w, () => !!u.carry); expect(u.gatherNode).toBe(b.id); }
  });
  it('releases priest farm claims for healing/conversion and cart jobs for trade', () => {
    const { w, u: priest, tree } = setup('priest');
    const farm = building(w, 'farm', 20, 30);
    w.dispatch({ type: 'gather', unitIds: [priest.id], nodeId: tree.id });
    until(w, () => (priest.carry?.amount ?? 0) >= 3);
    const priestCargo = { ...priest.carry! };
    w.dispatch({ type: 'gather', unitIds: [priest.id], nodeId: farm.id });
    const ally = w.spawnUnit('hoplite', { x: 19, z: 20 }, 1); ally.hp -= 10; w.updateFog();
    w.dispatch({ type: 'heal', unitIds: [priest.id], targetId: ally.id });
    expect(w.farmers.has(farm.id)).toBe(false); expect(priest.gatherNode).toBeNull();
    until(w, () => ally.hp === ally.maxHp);
    expect(priest.carry).toEqual(priestCargo);
    w.dispatch({ type: 'gather', unitIds: [priest.id], nodeId: tree.id }); expect(w.priestOrders.has(priest.id)).toBe(false);
    const enemy = w.spawnUnit('hoplite', { x: 20, z: 22 }, 2); enemy.stance = 'passive'; w.updateFog();
    w.dispatch({ type: 'convert', unitIds: [priest.id], targetId: enemy.id });
    expect(priest.gatherNode).toBeNull(); until(w, () => enemy.owner === 1);
    expect(priest.carry).toEqual(priestCargo);
    const cart = w.spawnUnit('tradeCart', { x: 18, z: 20 }, 1);
    building(w, 'market', 35, 15); const far = building(w, 'market', 55, 15);
    w.dispatch({ type: 'gather', unitIds: [cart.id], nodeId: tree.id });
    until(w, () => (cart.carry?.amount ?? 0) >= 3);
    const cartCargo = { ...cart.carry! };
    w.dispatch({ type: 'gather', unitIds: [cart.id], nodeId: farm.id });
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: far.id });
    expect(cart.tradeWith).toBe(far.id); expect(cart.gatherNode).toBeNull(); expect(w.farmers.has(farm.id)).toBe(false);
    const gold = w.stock.gold; until(w, () => w.stock.gold > gold, 160);
    expect(cart.carry).toEqual(cartCargo);
    w.dispatch({ type: 'gather', unitIds: [cart.id], nodeId: tree.id }); expect(cart.tradeWith).toBeUndefined();
    until(w, () => !!cart.carry);
  });
  it('releases corral reservations immediately for combat and special orders', () => {
    const { w, u, tree } = setup();
    const corral = building(w, 'corral', 24, 28);
    const priest = w.spawnUnit('priest', { x: 19, z: 20 }, 1);
    const cart = w.spawnUnit('tradeCart', { x: 20, z: 20 }, 1);
    const enemy = w.spawnUnit('hoplite', { x: 22, z: 22 }, 2); enemy.stance = 'passive';
    building(w, 'market', 35, 15); const market = building(w, 'market', 55, 15);
    w.updateFog();
    w.dispatch({ type: 'tend', unitIds: [u.id], buildingId: corral.id });
    expect(corralWorker(w, corral)).toBe(u);
    w.dispatch({ type: 'attack', unitIds: [u.id], targetId: enemy.id });
    expect(corralWorker(w, corral)).toBeUndefined(); expect(u.tendingCorral).toBeUndefined();
    w.dispatch({ type: 'tend', unitIds: [priest.id], buildingId: corral.id });
    expect(corralWorker(w, corral)).toBe(priest);
    w.dispatch({ type: 'convert', unitIds: [priest.id], targetId: enemy.id });
    expect(corralWorker(w, corral)).toBeUndefined(); expect(priest.tendingCorral).toBeUndefined();
    w.dispatch({ type: 'tend', unitIds: [cart.id], buildingId: corral.id });
    expect(corralWorker(w, corral)).toBe(cart);
    w.dispatch({ type: 'trade', unitIds: [cart.id], marketId: market.id });
    expect(corralWorker(w, corral)).toBeUndefined(); expect(cart.tendingCorral).toBeUndefined();
    w.dispatch({ type: 'tend', unitIds: [u.id], buildingId: corral.id });
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id });
    expect(corralWorker(w, corral)).toBeUndefined(); expect(u.gatherNode).toBe(tree.id);
  });
  it('rejects foreign workers, enemy farms/foundations/corrals, and garrisoned workers', () => {
    const { w, u, tree } = setup();
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id }, 2); expect(u.gatherNode).toBeNull();
    const farm = building(w, 'farm', 30, 30, 2), corral = building(w, 'corral', 40, 40, 2);
    const foundation = layFoundation(w, 'house', { x: 50, z: 30 }, 0, 2);
    for (const b of [farm, foundation]) w.dispatch({ type: 'construct', unitIds: [u.id], buildingId: b.id });
    w.dispatch({ type: 'tend', unitIds: [u.id], buildingId: corral.id });
    expect(u.state).toBe('idle'); expect(w.buildState.size).toBe(0); expect(w.farmers.size).toBe(0);
    u.state = 'garrisoned'; w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id }); expect(u.state).toBe('garrisoned');
  });
  it.each(['sheep', 'deer', 'boar', 'fishingBoat', 'merchantShip', 'trireme', 'transport'] as UnitKind[])('does not turn %s into a land worker', kind => {
    const { w, u, tree } = setup(kind); const stock = w.stock.wood;
    const farm = building(w, 'farm'), corral = building(w, 'corral', 40, 40);
    w.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id });
    w.dispatch({ type: 'construct', unitIds: [u.id], buildingId: farm.id });
    w.dispatch({ type: 'tend', unitIds: [u.id], buildingId: corral.id });
    w.dispatch({ type: 'build', unitIds: [u.id], kind: 'house', pos: { x: 55, z: 30 }, rot: 0 });
    expect(u.gatherNode).toBeNull(); expect(u.tendingCorral).toBeUndefined(); expect(w.buildState.has(u.id)).toBe(false);
    expect([...w.buildings.values()].some(b => b.kind === 'house')).toBe(false); expect(w.stock.wood).toBe(stock);
  });
});
