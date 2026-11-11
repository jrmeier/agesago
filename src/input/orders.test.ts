import { describe, expect, it } from 'vitest';
import type { Unit, Vec2 } from '../core/types';
import { resolveAttackMove, resolveBuildingAttack, resolveBuildingOrder, resolveGuard, resolvePatrol, resolveOrder, resolveRepairOrder, resolveTargetOrder } from './orders';
import { focusNextScout, nextScout, onScoutFocus } from './scouts';

describe('order resolution under fog', () => {
  const ground = { x: 40, z: 12 };

  it('gathers from an explored node for the whole selection', () => {
    expect(resolveOrder([1, 2], { nodeId: 9, nodeExplored: true, ground: null })).toEqual({
      type: 'gather',
      unitIds: [1, 2],
      nodeId: 9,
    });
  });

  it('treats a node in the black as a plain move', () => {
    expect(resolveOrder([1], { nodeId: 9, nodeExplored: false, ground })).toEqual({ type: 'move', unitIds: [1], target: ground });
  });

  it('moves into unexplored ground, and does nothing off the map or with no selection', () => {
    expect(resolveOrder([3], { nodeId: null, nodeExplored: false, ground })).toEqual({ type: 'move', unitIds: [3], target: ground });
    expect(resolveOrder([3], { nodeId: null, nodeExplored: false, ground: null })).toBeNull();
    expect(resolveOrder([3], { nodeId: 9, nodeExplored: false, ground: null })).toBeNull();
    expect(resolveOrder([], { nodeId: 9, nodeExplored: true, ground })).toBeNull();
  });
});

describe('orders onto buildings', () => {
  it('sends villagers to construct a foundation', () => {
    expect(resolveBuildingOrder([1, 2], { id: 7, kind: 'house', complete: false })).toEqual({
      type: 'construct',
      unitIds: [1, 2],
      buildingId: 7,
    });
  });

  it('works every complete farm, including exhausted fields from older saves', () => {
    expect(resolveBuildingOrder([1], { id: 8, kind: 'farm', complete: true, food: 120 })).toEqual({
      type: 'gather',
      unitIds: [1],
      nodeId: 8,
    });
    expect(resolveBuildingOrder([1], { id: 8, kind: 'farm', complete: true })).toMatchObject({ type: 'gather' });
    expect(resolveBuildingOrder([1], { id: 8, kind: 'farm', complete: true, food: 0 })).toEqual({
      type: 'gather',
      unitIds: [1],
      nodeId: 8,
    });
  });

  it('garrisons a finished shelter, and ignores a finished house', () => {
    expect(resolveBuildingOrder([1], { id: 1, kind: 'townCenter', complete: true })).toEqual({
      type: 'garrison',
      unitIds: [1],
      buildingId: 1,
    });
    expect(resolveBuildingOrder([1, 4], { id: 9, kind: 'watchTower', complete: true })).toEqual({
      type: 'garrison',
      unitIds: [1, 4],
      buildingId: 9,
    });
    expect(resolveBuildingOrder([1], { id: 9, kind: 'watchTower', complete: false })).toEqual({
      type: 'construct',
      unitIds: [1],
      buildingId: 9,
    });
    expect(resolveBuildingOrder([1], { id: 3, kind: 'house', complete: true })).toBeNull();
    expect(resolveBuildingOrder([], { id: 3, kind: 'house', complete: false })).toBeNull();
  });
});

describe('find scout', () => {
  const at = (id: number, x: number): Pick<Unit, 'id' | 'pos'> => ({ id, pos: { x, z: 0 } });

  it('cycles through scouts in id order', () => {
    const scouts = [at(7, 70), at(3, 30), at(5, 50)];
    expect(nextScout(scouts, null)?.id).toBe(3);
    expect(nextScout(scouts, 3)?.id).toBe(5);
    expect(nextScout(scouts, 5)?.id).toBe(7);
    expect(nextScout(scouts, 7)?.id).toBe(3);
    expect(nextScout(scouts, 4)?.id).toBe(5);
    expect(nextScout([], null)).toBeNull();
  });

  it('centres the camera and remembers the last scout per world', () => {
    const unit = (id: number, kind: Unit['kind'], x: number) => ({ id, kind, pos: { x, z: 1 } }) as Unit;
    const world = { units: new Map([[1, unit(1, 'villager', 10)], [2, unit(2, 'scout', 20)], [4, unit(4, 'scout', 40)]]) };
    const seen: Vec2[] = [];
    const rig = { focusOn: (p: Vec2) => seen.push(p) };
    expect(focusNextScout(world, rig)).toBe(2);
    expect(focusNextScout(world, rig)).toBe(4);
    expect(focusNextScout(world, rig)).toBe(2);
    expect(seen.map((p) => p.x)).toEqual([20, 40, 20]);
    expect(focusNextScout({ units: new Map([[1, unit(1, 'villager', 10)]]) }, rig)).toBeNull();
  });

  it('tells scout-focus listeners (which select the scout) about each jump', () => {
    const unit = (id: number, kind: Unit['kind'], x: number) => ({ id, kind, pos: { x, z: 1 } }) as Unit;
    const world = { units: new Map([[2, unit(2, 'scout', 20)]]) };
    const picked: number[] = [];
    const off = onScoutFocus(world, (id) => picked.push(id));
    focusNextScout(world, { focusOn: () => {} });
    off();
    focusNextScout(world, { focusOn: () => {} });
    expect(picked).toEqual([2]);
  });
});

describe('orders that depend on ownership', () => {
  const enemyOf1 = (owner: number) => owner === 2;
  const ground = { x: 10, z: 20 };
  const enemy = { id: 50, owner: 2, pos: { x: 3, z: 4 }, visible: true };

  it('hunts visible wildlife, including own sheep, while respecting fog', () => {
    const selection = { unitIds: [1], rallyBuildingId: null };
    for (const kind of ['deer', 'boar', 'sheep'] as const) {
      const animal = { ...enemy, owner: kind === 'sheep' ? 1 : 0, kind };
      expect(resolveTargetOrder(selection, animal, ground, enemyOf1)).toEqual({ type: 'attack', unitIds: [1], targetId: 50 });
      expect(resolveTargetOrder(selection, { ...animal, visible: false }, ground, enemyOf1)).toBeNull();
    }
    expect(resolveTargetOrder(selection, { ...enemy, owner: 0 }, ground, enemyOf1)).toBeNull();
  });

  it('attacks a visible enemy unit or building with own units selected', () => {
    expect(resolveTargetOrder({ unitIds: [1, 2], rallyBuildingId: null }, enemy, ground, enemyOf1)).toEqual({
      type: 'attack',
      unitIds: [1, 2],
      targetId: 50,
    });
  });

  it('does not attack fogged enemies, own things or gaia (falls back to the plain order)', () => {
    const sel = { unitIds: [1], rallyBuildingId: null };
    expect(resolveTargetOrder(sel, { ...enemy, visible: false }, ground, enemyOf1)).toBeNull();
    expect(resolveTargetOrder(sel, { ...enemy, owner: 1 }, ground, enemyOf1)).toBeNull();
    expect(resolveTargetOrder(sel, { ...enemy, owner: 0 }, ground, enemyOf1)).toBeNull();
    expect(resolveTargetOrder(sel, null, ground, enemyOf1)).toBeNull();
  });

  it('sets a selected own building’s rally point on the ground or onto an entity', () => {
    const sel = { unitIds: [], rallyBuildingId: 7 };
    expect(resolveTargetOrder(sel, null, ground, enemyOf1)).toEqual({ type: 'rally', buildingId: 7, pos: ground });
    const tree = { id: 90, owner: 0, pos: { x: 5, z: 5 }, visible: true };
    expect(resolveTargetOrder(sel, tree, ground, enemyOf1)).toEqual({ type: 'rally', buildingId: 7, pos: { x: 5, z: 5 }, targetId: 90 });
    // Clicking the building itself rallies to the ground under the pointer.
    expect(resolveTargetOrder(sel, { ...tree, id: 7, owner: 1 }, ground, enemyOf1)).toEqual({ type: 'rally', buildingId: 7, pos: ground });
    expect(resolveTargetOrder(sel, null, null, enemyOf1)).toBeNull();
  });

  it('gives no order with nothing of ours selected', () => {
    expect(resolveTargetOrder({ unitIds: [], rallyBuildingId: null }, enemy, ground, enemyOf1)).toBeNull();
  });

  it('attack-moves the selection to a ground point', () => {
    expect(resolveAttackMove([4, 5], ground)).toEqual({ type: 'attackMove', unitIds: [4, 5], target: ground });
    expect(resolveAttackMove([], ground)).toBeNull();
    expect(resolveAttackMove([4], null)).toBeNull();
  });

  it('patrols the selection through copied waypoints', () => {
    const pts = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
    const cmd = resolvePatrol([4, 5], pts);
    expect(cmd).toEqual({ type: 'patrol', unitIds: [4, 5], waypoints: pts });
    expect(cmd!.waypoints[0]).not.toBe(pts[0]);
    expect(resolvePatrol([], pts)).toBeNull();
    expect(resolvePatrol([4], [])).toBeNull();
  });
});

describe('repair orders', () => {
  const enemy = (owner: number) => owner === 3;
  const house = { id: 9, kind: 'house' as const, complete: true, owner: 1, hp: 200, maxHp: 550 };

  it('repairs a damaged own or allied building', () => {
    expect(resolveRepairOrder([1, 2], house, enemy)).toEqual({ type: 'repair', unitIds: [1, 2], targetId: 9 });
    expect(resolveRepairOrder([1], { ...house, owner: 2 }, enemy)).toEqual({ type: 'repair', unitIds: [1], targetId: 9 });
  });

  it('leaves enemy, full, unfinished, farm and empty selections to the other orders', () => {
    expect(resolveRepairOrder([1], { ...house, owner: 3 }, enemy)).toBeNull();
    expect(resolveRepairOrder([1], { ...house, hp: 550 }, enemy)).toBeNull();
    expect(resolveRepairOrder([1], { ...house, complete: false }, enemy)).toBeNull();
    expect(resolveRepairOrder([1], { ...house, kind: 'farm' }, enemy)).toBeNull();
    expect(resolveRepairOrder([1], { ...house, owner: 0 }, enemy)).toBeNull();
    expect(resolveRepairOrder([], house, enemy)).toBeNull();
    expect(resolveRepairOrder([1], undefined, enemy)).toBeNull();
  });
});

describe('guard targeting', () => {
  const enemy = (o: number) => o === 2;
  const soldiers = [{ id: 1, kind: 'hoplite' as const }, { id: 2, kind: 'villager' as const }, { id: 3, kind: 'archer' as const }];

  it('guards an own or allied unit or building with the units that can guard', () => {
    expect(resolveGuard(soldiers, { id: 9, owner: 1, pos: { x: 0, z: 0 }, visible: true, kind: 'villager' }, enemy))
      .toEqual({ type: 'guard', unitIds: [1, 3], targetId: 9 });
    expect(resolveGuard(soldiers, { id: 10, owner: 3, pos: { x: 0, z: 0 }, visible: true }, enemy))
      .toEqual({ type: 'guard', unitIds: [1, 3], targetId: 10 });
  });

  it('never guards an enemy, Gaia, nothing, itself alone, or with only villagers', () => {
    expect(resolveGuard(soldiers, { id: 9, owner: 2, pos: { x: 0, z: 0 }, visible: true }, enemy)).toBeNull();
    expect(resolveGuard(soldiers, { id: 9, owner: 0, pos: { x: 0, z: 0 }, visible: true }, enemy)).toBeNull();
    expect(resolveGuard(soldiers, null, enemy)).toBeNull();
    expect(resolveGuard([soldiers[0]], { id: 1, owner: 1, pos: { x: 0, z: 0 }, visible: true, kind: 'hoplite' }, enemy)).toBeNull();
    expect(resolveGuard([soldiers[1]], { id: 9, owner: 1, pos: { x: 0, z: 0 }, visible: true }, enemy)).toBeNull();
  });
});

describe('capture and raze orders (M18-4)', () => {
  const enemy = (owner: number) => owner === 2;
  const house = { id: 50, owner: 2, visible: true, capturable: true };
  const soldiers = [{ id: 1, kind: 'swordsman' as const }, { id: 2, kind: 'ram' as const }];
  const villagers = [{ id: 3, kind: 'villager' as const }];

  it('soldiers capture an enemy building by default and attack it when razing', () => {
    expect(resolveBuildingAttack(soldiers, house, false, enemy)).toEqual({ type: 'capture', unitIds: [1, 2], targetId: 50 });
    expect(resolveBuildingAttack(soldiers, house, true, enemy)).toEqual({ type: 'attack', unitIds: [1, 2], targetId: 50 });
  });

  it('walls and selections without a capture attack attack instead', () => {
    expect(resolveBuildingAttack(soldiers, { ...house, capturable: false }, false, enemy)).toEqual({ type: 'attack', unitIds: [1, 2], targetId: 50 });
    expect(resolveBuildingAttack(villagers, house, false, enemy)).toEqual({ type: 'attack', unitIds: [3], targetId: 50 });
  });

  it('neutral buildings are captured by soldiers and only attacked when razing', () => {
    const ruin = { ...house, owner: 0 };
    expect(resolveBuildingAttack(soldiers, ruin, false, enemy)?.type).toBe('capture');
    expect(resolveBuildingAttack(villagers, ruin, false, enemy)).toBeNull();
    expect(resolveBuildingAttack(villagers, ruin, true, enemy)?.type).toBe('attack');
  });

  it('own, allied and unseen buildings are no target', () => {
    expect(resolveBuildingAttack(soldiers, { ...house, owner: 1 }, false, enemy)).toBeNull();
    expect(resolveBuildingAttack(soldiers, { ...house, owner: 3 }, true, enemy)).toBeNull();
    expect(resolveBuildingAttack(soldiers, { ...house, visible: false }, false, enemy)).toBeNull();
    expect(resolveBuildingAttack([], house, false, enemy)).toBeNull();
    expect(resolveBuildingAttack(soldiers, null, false, enemy)).toBeNull();
  });
});
