import { describe, expect, it } from 'vitest';
import { BUILDINGS, footprintRadius } from '../core/buildings';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type Player, type SimEvent, type Vec2 } from '../core/types';
import { BALANCE } from './balance';
import { deserializeWorld, serializeWorld, SAVE_VERSION } from './serialize';
import { completeBuilding, layFoundation } from './systems/build';
import { applyDamage } from './systems/combat';
import { repairRate } from './systems/repair';
import { buildingRect } from './systems/sites';
import { EXPLORED } from './visibility';
import { World } from './World';

const DT = 1 / BALANCE.tickRate;
/** Land west of x = 50, sea to the east (for the dock tests). */
const sea = (x: number) => x > 50;
const hf: Heightfield = {
  width: 64,
  depth: 48,
  heightAt: (x) => (sea(x) ? -2 : 0.5),
  isWater: (x) => sea(x),
  isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 64 && z <= 48 && !sea(x),
  forestDensity: () => 0,
  ground: () => GRASS_ONLY,
};

/** Player 1 (TC at 12,24) with villagers; player 2 (TC at 12,8) on `team2`. */
function world(villagers: Vec2[], team2 = 2): World {
  const layout: MapLayout = {
    townCenter: { x: 12, z: 24 }, villagers, scouts: [], nodes: [], props: [],
    extraStarts: [{ townCenter: { x: 12, z: 8 }, villagers: [], scouts: [] }],
  };
  const players: Player[] = [
    { id: 1, name: 'You', color: 0, team: 1, control: 'human' },
    { id: 2, name: 'Two', color: 1, team: team2, control: 'ai' },
  ];
  const w = new World(hf, layout, players);
  w.seed = 1;
  for (const p of w.players.values()) p.visibility.state.fill(EXPLORED);
  Object.assign(w.stock, { wood: 1000, food: 1000, gold: 1000, stone: 1000 });
  return w;
}

function finished(w: World, kind: BuildingKind, pos: Vec2, owner = 1): Building {
  const b = layFoundation(w, kind, pos, 0, owner);
  b.hp = b.maxHp;
  completeBuilding(w, b);
  return b;
}

function run(w: World, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) w.tick(DT);
}

function runUntil(w: World, cond: () => boolean, max = 60): void {
  for (let t = 0; t < max && !cond(); t += DT) w.tick(DT);
  expect(cond()).toBe(true);
}

function rejections(w: World): string[] {
  const out: string[] = [];
  w.events.on('rejected', (e: Extract<SimEvent, { type: 'rejected' }>) => out.push(e.reason));
  return out;
}

const house = (b: Building) => BUILDINGS[b.kind];

describe('repair', () => {
  it('one repairer restores maxHp / (buildTime × repairTimeFactor) hp per second, then goes idle at full', () => {
    const w = world([{ x: 30, z: 30 }]);
    const v = [...w.units.values()].find((u) => u.kind === 'villager')!;
    const b = finished(w, 'house', { x: 30, z: 36 });
    b.hp = 100;
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: b.id });
    expect(v.state).toBe('toRepair');
    runUntil(w, () => v.state === 'repairing');
    const before = b.hp;
    run(w, 4);
    const perSecond = b.maxHp / (house(b).buildTime * BALANCE.repairTimeFactor);
    expect((b.hp - before) / 4).toBeCloseTo(perSecond, 3);
    runUntil(w, () => b.hp >= b.maxHp);
    expect(b.hp).toBe(b.maxHp);
    run(w, DT);
    expect(v.state).toBe('idle');
    expect(w.buildState.has(v.id)).toBe(false);
  });

  it('several repairers combine with diminishing returns (n^buildExponent)', () => {
    const w = world([{ x: 28, z: 30 }, { x: 30, z: 30 }, { x: 32, z: 30 }]);
    const ids = [...w.units.values()].filter((u) => u.kind === 'villager').map((u) => u.id);
    const b = finished(w, 'storehouse', { x: 30, z: 36 });
    b.hp = 10;
    w.dispatch({ type: 'repair', unitIds: ids, targetId: b.id });
    runUntil(w, () => ids.every((id) => w.units.get(id)!.state === 'repairing'));
    const before = b.hp;
    run(w, 2);
    expect((b.hp - before) / 2).toBeCloseTo(repairRate(b, 3), 3);
    expect(repairRate(b, 3)).toBeCloseTo(repairRate(b, 1) * Math.pow(3, BALANCE.buildExponent), 6);
  });

  it('charges repairCostFactor × cost for 0 → full, a whole unit at a time', () => {
    const w = world([{ x: 30, z: 30 }]);
    const v = [...w.units.values()].find((u) => u.kind === 'villager')!;
    const b = finished(w, 'house', { x: 30, z: 36 });
    b.hp = 1;
    const wood = w.stock.wood;
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: b.id });
    runUntil(w, () => v.state === 'repairing');
    // Halfway the bill is about half; nothing is charged up front.
    runUntil(w, () => b.hp >= b.maxHp / 2);
    const total = house(b).cost.wood! * BALANCE.repairCostFactor;
    expect(wood - w.stock.wood).toBeGreaterThanOrEqual(Math.floor(total / 2) - 1);
    expect(wood - w.stock.wood).toBeLessThanOrEqual(Math.ceil(total / 2));
    expect(Number.isInteger(w.stock.wood)).toBe(true);
    runUntil(w, () => b.hp >= b.maxHp);
    const owed = w.repairDebt.get(1)!.wood!;
    expect(wood - w.stock.wood + owed).toBeCloseTo(total * (b.maxHp - 1) / b.maxHp, 6);
    expect(owed).toBeLessThan(1);
  });

  it('stops with insufficient-resources when the next unit can not be paid', () => {
    const w = world([{ x: 30, z: 30 }]);
    const log = rejections(w);
    const v = [...w.units.values()].find((u) => u.kind === 'villager')!;
    const b = finished(w, 'house', { x: 30, z: 36 });
    b.hp = 1;
    w.stock.wood = 2;
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: b.id });
    runUntil(w, () => v.state === 'idle', 30);
    expect(log).toEqual(['insufficient-resources']);
    expect(w.stock.wood).toBe(0);
    // 3 wood would buy 3 / (0.5 × 30) of the house; it stopped just short of that.
    const limit = 1 + (3 / (house(b).cost.wood! * BALANCE.repairCostFactor)) * b.maxHp;
    expect(b.hp).toBeLessThanOrEqual(limit + 1e-6);
    expect(b.hp).toBeGreaterThan(limit - repairRate(b, 1) * DT * 2);
    expect(w.buildState.has(v.id)).toBe(false);
  });

  it('repairs an ally’s building at the repairer’s cost; enemy, full and unfinished buildings are rejected', () => {
    const w = world([{ x: 30, z: 20 }], 1);
    const log = rejections(w);
    const v = [...w.units.values()].find((u) => u.kind === 'villager')!;
    const allied = finished(w, 'house', { x: 30, z: 14 }, 2);
    allied.hp = 200;
    const theirs = w.stockOf(2).wood;
    const mine = w.stock.wood;
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: allied.id });
    runUntil(w, () => allied.hp >= allied.maxHp);
    expect(w.stockOf(2).wood).toBe(theirs);
    expect(w.stock.wood).toBeLessThan(mine);

    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: allied.id });
    const foundation = layFoundation(w, 'house', { x: 40, z: 14 }, 0, 1);
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: foundation.id });
    expect(log).toEqual(['invalid-target', 'invalid-target']);

    const e = world([{ x: 30, z: 20 }]);
    const elog = rejections(e);
    const ev = [...e.units.values()].find((u) => u.kind === 'villager')!;
    const enemy = finished(e, 'house', { x: 30, z: 14 }, 2);
    enemy.hp = 200;
    e.dispatch({ type: 'repair', unitIds: [ev.id], targetId: enemy.id });
    expect(elog).toEqual(['invalid-target']);
    expect(ev.state).toBe('idle');
  });

  it('a repairing villager flees when hit and comes back to finish the job', () => {
    const w = world([{ x: 30, z: 30 }]);
    const v = [...w.units.values()].find((u) => u.kind === 'villager')!;
    const b = finished(w, 'house', { x: 30, z: 36 });
    b.hp = 50;
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: b.id });
    runUntil(w, () => v.state === 'repairing');
    applyDamage(w, v, 1, null, 2, { x: v.pos.x, z: v.pos.z + 1 });
    expect(v.state).toBe('moving');
    expect(w.fleeState.get(v.id)?.repair).toBe(b.id);
    runUntil(w, () => v.state === 'repairing');
    runUntil(w, () => b.hp >= b.maxHp);
  });

  it('round-trips repair state and debt through a save, and still loads v2-v5 saves', () => {
    const w = world([{ x: 30, z: 30 }]);
    const v = [...w.units.values()].find((u) => u.kind === 'villager')!;
    const b = finished(w, 'house', { x: 30, z: 36 });
    b.hp = 1;
    w.dispatch({ type: 'repair', unitIds: [v.id], targetId: b.id });
    runUntil(w, () => v.state === 'repairing');
    run(w, 1.3);
    const data = serializeWorld(w);
    expect(data.version).toBe(SAVE_VERSION);
    const r = deserializeWorld(JSON.parse(JSON.stringify(data)), hf);
    expect(r.units.get(v.id)!.state).toBe('repairing');
    expect(r.repairDebt.get(1)).toEqual(w.repairDebt.get(1));
    expect(serializeWorld(r)).toEqual(data);
    run(w, 3);
    run(r, 3);
    expect(r.buildings.get(b.id)!.hp).toBe(b.hp);
    expect(r.stock.wood).toBe(w.stock.wood);

    // Every pre-repair version (v2 research .. v5 upgrade chains) loads; any stray debt is dropped.
    for (const version of [2, 3, 4, 5]) {
      const old = JSON.parse(JSON.stringify(data));
      old.version = version;
      const legacy = deserializeWorld(old, hf);
      expect(legacy.repairDebt.size).toBe(0);
      expect(legacy.units.get(v.id)!.state).toBe('repairing');
    }
  });
});

describe('ships at docks', () => {
  function dock(w: World, pos: Vec2, owner = 1): Building {
    const b: Building = { id: w.allocId(), kind: 'dock', pos, owner, hp: 1200, maxHp: 1200, rot: 0,
      radius: footprintRadius('dock'), complete: true, buildProgress: 1, queue: 0, progress: 0 };
    w.buildings.set(b.id, b);
    w.nav.addRect(b.id, buildingRect(b));
    w.waterNav.addRect(b.id, buildingRect(b));
    return b;
  }

  it('a damaged ship next to an own dock heals slowly; far away or at a foreign dock it does not', () => {
    const w = world([]);
    dock(w, { x: 50, z: 30 });
    dock(w, { x: 50, z: 8 }, 2);
    const near = w.spawnUnit('trireme', { x: 54, z: 30 });
    const far = w.spawnUnit('trireme', { x: 62, z: 44 });
    const foreign = w.spawnUnit('trireme', { x: 54, z: 8 });
    for (const s of [near, far, foreign]) s.hp = s.maxHp - 20;
    run(w, 4);
    expect(near.hp).toBeCloseTo(near.maxHp - 20 + 4 * BALANCE.dockHealRate, 6);
    expect(far.hp).toBe(far.maxHp - 20);
    expect(foreign.hp).toBe(foreign.maxHp - 20);
    run(w, 20);
    expect(near.hp).toBe(near.maxHp);
  });
});
