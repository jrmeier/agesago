import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { CIV_IDS, type CivId } from '../core/civilizations';
import {
  GRASS_ONLY,
  type BuildingKind,
  type Heightfield,
  type MapLayout,
  type PlayerId,
  type RejectReason,
  type Unit,
  type UnitKind,
  type Vec2,
} from '../core/types';
import { canWork, isChampion, trainable, UNITS } from '../core/units';
import { limitLabel, limitLockText } from '../ui/build';
import { BALANCE } from './balance';
import { completeBuilding, layFoundation, ownedCount } from './systems/build';
import { applyDamage } from './systems/combat';
import { EXPLORED } from './visibility';
import { defaultPlayers, World } from './World';

/** M16-5: fortress limit, champion training, the champions' no-work rule and combat margins. */

const DT = 1 / BALANCE.tickRate;
const CHAMPIONS = (Object.keys(UNITS) as UnitKind[]).filter(isChampion);

function flat(w: number, d: number): Heightfield {
  return {
    width: w, depth: d, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d, forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

function arena(opts: { w?: number; civs?: CivId[]; nodes?: MapLayout['nodes'] } = {}): World {
  const w = opts.w ?? 120;
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 }, villagers: [], scouts: [], props: [], nodes: opts.nodes ?? [],
    extraStarts: [{ townCenter: { x: w - 4, z: w - 4 }, villagers: [], scouts: [] }],
  };
  const world = new World(flat(w, w), layout, defaultPlayers(2, opts.civs));
  for (const p of [1, 2]) world.visibilityOf(p).state.fill(EXPLORED);
  for (const p of [1, 2]) Object.assign(world.stockOf(p), { wood: 9000, food: 9000, gold: 9000, stone: 9000 });
  return world;
}

function building(world: World, kind: BuildingKind, pos: Vec2, owner: PlayerId = 1) {
  const b = layFoundation(world, kind, pos, 0, owner);
  completeBuilding(world, b);
  return b;
}

function rejections(world: World): RejectReason[] {
  const out: RejectReason[] = [];
  world.events.on('rejected', (e) => out.push(e.reason));
  return out;
}

function run(world: World, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.tick(DT);
    if (until?.()) return;
  }
}

describe('fortress', () => {
  it('is a City Age stronghold: big, tough, armoured, many arrows, garrison 20, heavy stone', () => {
    const f = BUILDINGS.fortress;
    expect(f.age).toBe(2);
    expect(f.size).toEqual({ w: 5, d: 5 });
    expect(f.hp).toBeGreaterThan(BUILDINGS.townCenter.hp * 2);
    expect(f.armor.pierce).toBeGreaterThan(BUILDINGS.townCenter.armor.pierce);
    expect(f.attack?.arrows).toBe(4);
    expect(f.garrison).toBe(20);
    expect(f.cost.stone).toBeGreaterThan(f.cost.wood ?? 0);
    expect(f.limit).toBe(2);
    expect(trainable('fortress', 'romans')).toEqual(['praetorian', 'equites']);
  });

  it('needs the City Age', () => {
    const world = arena();
    const v = world.spawnUnit('villager', { x: 30, z: 30 }, 1);
    const reasons = rejections(world);
    world.players.get(1)!.age = 1;
    world.dispatch({ type: 'build', unitIds: [v.id], kind: 'fortress', pos: { x: 40, z: 40 }, rot: 0 });
    expect(reasons).toEqual(['age']);
    world.players.get(1)!.age = 2;
    world.dispatch({ type: 'build', unitIds: [v.id], kind: 'fortress', pos: { x: 40, z: 40 }, rot: 0 });
    expect(ownedCount(world, 'fortress', 1)).toBe(1);
  });

  it('caps each player at two, foundations included, and frees a slot when one falls', () => {
    const world = arena();
    for (const p of [1, 2]) world.players.get(p)!.age = 2;
    const v = world.spawnUnit('villager', { x: 30, z: 30 }, 1);
    const reasons = rejections(world);
    const build = (x: number) => world.dispatch({ type: 'build', unitIds: [v.id], kind: 'fortress', pos: { x, z: 40 }, rot: 0 });
    build(20);
    build(35);
    expect(reasons).toEqual([]);
    expect(ownedCount(world, 'fortress', 1)).toBe(2);
    const stone = world.stock.stone;
    build(50);
    expect(reasons).toEqual(['limit']);
    expect(world.stock.stone).toBe(stone); // nothing paid
    expect(ownedCount(world, 'fortress', 1)).toBe(2);
    // Another player's fortresses don't count against yours.
    const rival = world.spawnUnit('villager', { x: 80, z: 80 }, 2);
    world.dispatch({ type: 'build', unitIds: [rival.id], kind: 'fortress', pos: { x: 80, z: 90 }, rot: 0 }, 2);
    expect(ownedCount(world, 'fortress', 2)).toBe(1);
    // Cancelling a foundation frees a slot.
    const first = [...world.buildings.values()].find((b) => b.kind === 'fortress' && b.owner === 1)!;
    world.dispatch({ type: 'cancelBuild', buildingId: first.id });
    build(50);
    expect(reasons).toEqual(['limit']);
    expect(ownedCount(world, 'fortress', 1)).toBe(2);
    // So does losing a finished one.
    const second = [...world.buildings.values()].find((b) => b.kind === 'fortress' && b.owner === 1)!;
    completeBuilding(world, second);
    applyDamage(world, second, second.hp + 1, null, 2, second.pos);
    run(world, 0.1);
    expect(ownedCount(world, 'fortress', 1)).toBe(1);
    build(65);
    expect(reasons).toEqual(['limit']);
    expect(ownedCount(world, 'fortress', 1)).toBe(2);
  });

  it('shows the limit in the build menu', () => {
    expect(limitLabel('fortress', 0)).toBe('0/2');
    expect(limitLabel('fortress', 2)).toBe('2/2');
    expect(limitLockText('fortress', 1)).toBe('');
    expect(limitLockText('fortress', 2)).toBe('Limit reached (2/2)');
    expect(limitLabel('barracks', 7)).toBe('');
    expect(limitLockText('barracks', 7)).toBe('');
  });

  it('shoots with its base arrows and garrisons twenty villagers', () => {
    const world = arena();
    world.players.get(1)!.age = 2;
    const fort = building(world, 'fortress', { x: 40, z: 40 });
    const villagers = Array.from({ length: 22 }, (_, i) => world.spawnUnit('villager', { x: 34 + (i % 11), z: 34 + Math.floor(i / 11) }, 1));
    world.dispatch({ type: 'garrison', unitIds: villagers.map((v) => v.id), buildingId: fort.id });
    run(world, 30);
    expect(fort.occupants?.length).toBe(20);
    const enemy = world.spawnUnit('hoplite', { x: 40, z: 46 }, 2);
    enemy.stance = 'passive';
    world.updateFog();
    const hp = enemy.hp;
    run(world, 3);
    expect(enemy.hp).toBeLessThan(hp);
  });
});

describe('champions', () => {
  it('each civ has one infantry and one cavalry champion, gold-heavy, City Age, fortress only', () => {
    for (const civ of CIV_IDS) {
      const roster = CHAMPIONS.filter((k) => UNITS[k].civ === civ);
      expect(roster.map((k) => UNITS[k].unitClass).sort()).toEqual(['cavalry', 'infantry']);
      for (const k of roster) {
        const u = UNITS[k];
        expect(u.trainedAt).toBe('fortress');
        expect(u.age).toBe(2);
        expect(u.cost.gold).toBeGreaterThan(u.cost.food ?? 0);
        expect(trainable('fortress', civ)).toContain(k);
        for (const other of CIV_IDS.filter((c) => c !== civ)) expect(trainable('fortress', other)).not.toContain(k);
      }
    }
    // Champion names are their own: no clash with unique units or line titles.
    const names = (Object.keys(UNITS) as UnitKind[]).map((k) => UNITS[k].name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('train at their own fortress only', () => {
    const world = arena({ civs: ['persians', 'celts'] });
    world.players.get(1)!.age = 2;
    const fort = building(world, 'fortress', { x: 40, z: 40 });
    const barracks = building(world, 'barracks', { x: 60, z: 40 });
    const reasons = rejections(world);
    world.dispatch({ type: 'train', buildingId: barracks.id, unit: 'appleBearer' });
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'gaesatae' });
    expect(reasons).toEqual(['invalid-target', 'invalid-target']);
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'appleBearer' });
    world.dispatch({ type: 'train', buildingId: fort.id, unit: 'savaran' });
    expect(reasons).toHaveLength(2);
    run(world, UNITS.appleBearer.trainTime + UNITS.savaran.trainTime + 1);
    const kinds = [...world.units.values()].filter((u) => u.owner === 1).map((u) => u.kind);
    expect(kinds).toEqual(expect.arrayContaining(['appleBearer', 'savaran']));
  });

  it('a player without a civilization still fields champions', () => {
    expect(trainable('fortress')).toEqual(['spartanHoplite', 'agema']);
  });

  it.each(CHAMPIONS)('%s never gathers, builds or tends', (kind) => {
    expect(canWork(kind)).toBe(false);
    const world = arena({ nodes: [{ kind: 'tree', pos: { x: 30, z: 34 }, amount: 100 }] });
    world.players.get(1)!.age = 2;
    const u = world.spawnUnit(kind, { x: 30, z: 30 }, 1);
    const tree = [...world.nodes.values()][0];
    const farm = layFoundation(world, 'farm', { x: 40, z: 30 }, 0, 1);
    const reasons = rejections(world);
    world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: tree.id });
    world.dispatch({ type: 'build', unitIds: [u.id], kind: 'house', pos: { x: 20, z: 20 }, rot: 0 });
    world.dispatch({ type: 'construct', unitIds: [u.id], buildingId: farm.id });
    run(world, 5);
    expect(u.gatherNode).toBeNull();
    expect(u.carry).toBeNull();
    expect(u.state).not.toBe('building');
    expect(farm.buildProgress).toBe(0);
    expect([...world.buildings.values()].some((b) => b.kind === 'house')).toBe(false);
    expect(reasons).toContain('invalid-target');
  });

  it('do not take line upgrades (no veterancy or rank-up path)', async () => {
    const { TECHS } = await import('../core/techs');
    for (const t of Object.values(TECHS)) if (t.line) expect(isChampion(t.line.unit)).toBe(false);
  });
});

/*
 * Combat margins (documented in docs/BALANCE.md). Equal-cost armies at City Age with no techs,
 * five jittered line-ups each. `value` is the fraction of the starting army's resource value still
 * standing, weighting each survivor by its remaining HP.
 */
const costOf = (k: UnitKind) => Object.values(UNITS[k].cost).reduce((a, b) => a + (b ?? 0), 0);

function fight(k1: UnitKind, n1: number, k2: UnitKind, n2: number, seed: number) {
  const w = 160;
  const world = arena({ w });
  for (const p of [1, 2]) world.players.get(p)!.age = 2;
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const squad = (k: UnitKind, n: number, owner: PlayerId, cx: number) => Array.from({ length: n }, (_, i) =>
    world.spawnUnit(k, {
      x: cx + (i % 2) * 1.2 * (owner === 1 ? -1 : 1) + (r() - 0.5) * 0.6,
      z: 80 + (Math.floor(i / 2) - (n / 2 - 1) / 2) * 1.3 + (r() - 0.5) * 0.4,
    }, owner));
  const a = squad(k1, n1, 1, w / 2 - 3);
  const b = squad(k2, n2, 2, w / 2 + 3);
  world.updateFog();
  const alive = (l: Unit[]) => l.filter((u) => world.units.has(u.id));
  run(world, 300, () => !alive(a).length || !alive(b).length);
  const value = (l: Unit[], n: number) => alive(l).reduce((t, u) => t + u.hp / u.maxHp, 0) / n;
  return { won: alive(a).length > 0 && !alive(b).length, lost: !alive(a).length && alive(b).length > 0, mine: value(a, n1), theirs: value(b, n2) };
}

describe('champion combat margins', () => {
  it('every infantry and every cavalry champion share one stat block, so one fight covers each civ', () => {
    for (const cls of ['infantry', 'cavalry'] as const) {
      const [first, ...rest] = CHAMPIONS.filter((k) => UNITS[k].unitClass === cls);
      const strip = (k: UnitKind) => { const { name: _n, civ: _c, ...stats } = UNITS[k]; return stats; };
      for (const k of rest) expect(strip(k)).toEqual(strip(first));
    }
  });

  it.each([
    // champion, line unit of its type, champions, line units (equal cost), champion's minimum value left
    ['praetorian', 'swordsman', 5, 15, 0.4],
    ['equites', 'horseman', 4, 8, 0.4],
  ] as const)('%s beats an equal-cost group of %s', (champ, line, n1, n2, margin) => {
    expect(n1 * costOf(champ)).toBe(n2 * costOf(line));
    for (let seed = 1; seed <= 5; seed++) {
      const r = fight(champ, n1, line, n2, seed);
      expect(r.won).toBe(true);
      expect(r.mine).toBeGreaterThanOrEqual(margin);
    }
  });

  it.each([
    // champion, hard counter, champions, counters (equal cost), counter's minimum value left
    ['praetorian', 'slinger', 5, 20, 0.25],
    ['equites', 'hoplite', 4, 15, 0.6],
  ] as const)('%s loses cost for cost to %s', (champ, counter, n1, n2, margin) => {
    expect(n1 * costOf(champ)).toBe(n2 * costOf(counter));
    for (let seed = 1; seed <= 5; seed++) {
      const r = fight(champ, n1, counter, n2, seed);
      expect(r.lost).toBe(true);
      expect(r.theirs).toBeGreaterThanOrEqual(margin);
    }
  });
});
