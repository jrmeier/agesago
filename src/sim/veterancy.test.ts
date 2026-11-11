import { describe, expect, it } from 'vitest';
import type { TechId } from '../core/techs';
import { GRASS_ONLY, type Heightfield, type MapLayout, type PlayerId, type SimEvent, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { canRank, RANKS, UNITS, XP_PER_COST, xpValue } from '../core/units';
import { BALANCE } from './balance';
import { layFoundation } from './systems/build';
import { applyDamage } from './systems/combat';
import { gatherInterval } from './systems/gather';
import { completeResearch, statOf } from './systems/research';
import { armorOf, damageTo, unitMaxHp } from './systems/stats';
import { awardKill, gainXp } from './systems/veterancy';
import { generateMap } from './mapgen';
import { deserializeWorld, serializeWorld } from './serialize';
import { defaultPlayers, World } from './World';

const DT = 1 / BALANCE.tickRate;

function flat(w = 120, d = 120): Heightfield {
  return {
    width: w, depth: d, heightAt: () => 0.5, isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d, forestDensity: () => 0, ground: () => GRASS_ONLY,
  };
}

function arena(): World {
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 }, villagers: [], scouts: [],
    extraStarts: [{ townCenter: { x: 116, z: 116 }, villagers: [], scouts: [] }], nodes: [], props: [],
  };
  const world = new World(flat(), layout, defaultPlayers(2));
  Object.assign(world.stock, { wood: 5000, food: 5000, gold: 5000, stone: 5000 });
  return world;
}

const spawn = (w: World, kind: UnitKind, owner: PlayerId, p: Vec2): Unit => w.spawnUnit(kind, p, owner);

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) world.tick(DT);
}

function research(world: World, owner: PlayerId, ...techs: TechId[]): void {
  for (const t of techs) completeResearch(world, owner, t);
}

/** Kill `victim` with the given blows: [attacker, damage] in order, the last one lethal. */
function kill(world: World, victim: Unit, blows: [Unit, number][]): void {
  for (const [by, amount] of blows) applyDamage(world, victim, amount, by.id, by.owner, by.pos);
}

describe('experience values', () => {
  it('defaults to cost × XP_PER_COST; wildlife is worth nothing', () => {
    expect(xpValue('hoplite')).toBe(Math.round((50 + 30) * XP_PER_COST));
    expect(xpValue('villager')).toBe(25);
    expect(xpValue('deer')).toBe(0);
  });

  it('only soldiers rank (scouts and cavalry count; villagers, priests, carts, ships do not)', () => {
    for (const k of ['hoplite', 'archer', 'slinger', 'horseman', 'scout', 'legionary', 'immortal'] as UnitKind[]) expect(canRank(k)).toBe(true);
    for (const k of ['villager', 'priest', 'tradeCart', 'trireme', 'transport', 'boar'] as UnitKind[]) expect(canRank(k)).toBe(false);
  });
});

describe('XP award', () => {
  it('pays the whole value to a lone killer', () => {
    const w = arena();
    const a = spawn(w, 'swordsman', 1, { x: 50, z: 50 });
    const v = spawn(w, 'villager', 2, { x: 51, z: 50 });
    kill(w, v, [[a, 10], [a, 100]]);
    expect(w.units.has(v.id)).toBe(false);
    expect(a.xp).toBeCloseTo(xpValue('villager'));
    expect(w.damageLog.size).toBe(0);
  });

  it('splits experience by damage dealt among recent attackers', () => {
    const w = arena();
    const a = spawn(w, 'swordsman', 1, { x: 50, z: 50 });
    const b = spawn(w, 'archer', 1, { x: 52, z: 50 });
    const v = spawn(w, 'hoplite', 2, { x: 51, z: 50 });
    const hp = v.hp;
    kill(w, v, [[a, hp / 4], [b, hp]]); // b's lethal blow only counts what was left (3/4)
    const xp = xpValue('hoplite');
    expect(a.xp).toBeCloseTo(xp / 4);
    expect(b.xp).toBeCloseTo((xp * 3) / 4);
  });

  it('forgets damage older than the window', () => {
    const w = arena();
    const a = spawn(w, 'swordsman', 1, { x: 50, z: 50 });
    const b = spawn(w, 'swordsman', 1, { x: 52, z: 50 });
    const v = spawn(w, 'villager', 2, { x: 30, z: 30 });
    v.stance = 'passive';
    applyDamage(w, v, 5, a.id, 1, a.pos);
    w.time += BALANCE.xpWindow + 1;
    kill(w, v, [[b, 100]]);
    expect(a.xp ?? 0).toBe(0);
    expect(b.xp).toBeCloseTo(xpValue('villager'));
  });

  it('gives nothing to non-soldiers and nothing for wildlife', () => {
    const w = arena();
    const vil = spawn(w, 'villager', 1, { x: 50, z: 50 });
    const enemy = spawn(w, 'villager', 2, { x: 51, z: 50 });
    kill(w, enemy, [[vil, 100]]);
    expect(vil.xp).toBeUndefined();
    const s = spawn(w, 'swordsman', 1, { x: 60, z: 60 });
    const deer = spawn(w, 'deer', 0, { x: 61, z: 60 });
    kill(w, deer, [[s, 100]]);
    expect(s.xp ?? 0).toBe(0);
  });

  it('awards real combat kills through the combat system', () => {
    const w = arena();
    const a = spawn(w, 'swordsman', 1, { x: 50, z: 50 });
    const v = spawn(w, 'villager', 2, { x: 51.5, z: 50 });
    v.stance = 'passive';
    w.dispatch({ type: 'attack', unitIds: [a.id], targetId: v.id });
    run(w, 20);
    expect(w.units.has(v.id)).toBe(false);
    expect(a.xp).toBeCloseTo(xpValue('villager'));
  });

  it('awards ranged kills when the projectile lands, with the shooter\'s rank', () => {
    const w = arena();
    const a = spawn(w, 'archer', 1, { x: 50, z: 50 });
    gainXp(w, a, RANKS[1].xp);
    const v = spawn(w, 'hoplite', 2, { x: 55, z: 50 });
    v.stance = 'passive';
    const hits: number[] = [];
    w.events.on('damaged', (e) => { if (e.id === v.id) hits.push(e.hp); });
    w.dispatch({ type: 'attack', unitIds: [a.id], targetId: v.id });
    run(w, 30);
    expect(w.units.has(v.id)).toBe(false);
    expect(hits[0]).toBe(v.maxHp - damageTo('archer', v, w, 1, 1));
    expect(a.xp).toBeCloseTo(RANKS[1].xp + xpValue('hoplite'));
  });
});

describe('promotion', () => {
  it('ranks Basic → Advanced → Elite at the thresholds, healing and emitting promoted', () => {
    const w = arena();
    const u = spawn(w, 'hoplite', 1, { x: 50, z: 50 });
    const events: SimEvent[] = [];
    w.events.on('promoted', (e) => events.push(e));
    u.hp = 10;
    gainXp(w, u, RANKS[1].xp - 1);
    expect(u.rank ?? 0).toBe(0);
    gainXp(w, u, 1);
    expect(u.rank).toBe(1);
    expect(u.maxHp).toBe(Math.round(UNITS.hoplite.hp * RANKS[1].hp));
    expect(u.hp).toBe(u.maxHp);
    u.hp = 5;
    gainXp(w, u, RANKS[2].xp - RANKS[1].xp);
    expect(u.rank).toBe(2);
    expect(u.maxHp).toBe(Math.round(UNITS.hoplite.hp * RANKS[2].hp));
    expect(u.hp).toBe(u.maxHp);
    gainXp(w, u, 1000);
    expect(u.rank).toBe(2);
    expect(events).toEqual([
      { type: 'promoted', id: u.id, owner: 1, rank: 1 },
      { type: 'promoted', id: u.id, owner: 1, rank: 2 },
    ]);
  });

  it('can jump straight to Elite from one big award', () => {
    const w = arena();
    const u = spawn(w, 'horseman', 1, { x: 50, z: 50 });
    gainXp(w, u, RANKS[2].xp);
    expect(u.rank).toBe(2);
  });

  it('a kill that crosses the threshold promotes the killer', () => {
    const w = arena();
    const a = spawn(w, 'scout', 1, { x: 50, z: 50 });
    a.xp = RANKS[1].xp - 1;
    const v = spawn(w, 'hoplite', 2, { x: 51, z: 50 });
    awardKill(w, v); // no log: nothing
    expect(a.rank ?? 0).toBe(0);
    kill(w, v, [[a, 1000]]);
    expect(a.rank).toBe(1);
  });
});

describe('rank stats through statOf', () => {
  it('stacks rank bonuses with a unit-line upgrade', () => {
    const w = arena();
    w.players.get(1)!.age = 3;
    research(w, 1, 'veteranHoplite');
    const base = UNITS.hoplite;
    const line = { hp: base.hp * 1.25, melee: base.attack.melee + 2, armor: base.armor.melee + 1 };
    expect(statOf(w, 1, { unit: 'hoplite' }, 'hp', base.hp)).toBeCloseTo(line.hp);
    expect(statOf(w, 1, { unit: 'hoplite', rank: 1 }, 'hp', base.hp)).toBeCloseTo(line.hp * RANKS[1].hp);
    expect(statOf(w, 1, { unit: 'hoplite', rank: 2 }, 'hp', base.hp)).toBeCloseTo(line.hp * RANKS[2].hp);
    expect(statOf(w, 1, { unit: 'hoplite', rank: 1 }, 'attack.melee', base.attack.melee)).toBe(line.melee + 1);
    expect(statOf(w, 1, { unit: 'hoplite', rank: 2 }, 'attack.melee', base.attack.melee)).toBe(line.melee + 2);
    // No pierce attack to begin with: rank adds none.
    expect(statOf(w, 1, { unit: 'hoplite', rank: 2 }, 'attack.pierce', base.attack.pierce)).toBe(0);
    expect(statOf(w, 1, { unit: 'hoplite', rank: 1 }, 'armor.melee', base.armor.melee)).toBe(line.armor + 1);
    // Unrelated stats are untouched.
    expect(statOf(w, 1, { unit: 'hoplite', rank: 2 }, 'speed', base.speed)).toBe(base.speed);
  });

  it('applies without any research too, and to live units (armour, damage, max HP)', () => {
    const w = arena();
    const u = spawn(w, 'archer', 1, { x: 50, z: 50 });
    const target = spawn(w, 'hoplite', 2, { x: 55, z: 50 });
    const before = damageTo('archer', target, w, 1, 0);
    expect(damageTo('archer', target, w, 1, 2)).toBe(before + 2);
    gainXp(w, u, RANKS[1].xp);
    expect(armorOf(w, u)).toEqual({ melee: UNITS.archer.armor.melee + 1, pierce: UNITS.archer.armor.pierce + 1 });
    expect(u.maxHp).toBe(unitMaxHp(w, 1, 'archer', 1));
  });

  it('a later hp tech keeps the rank bonus on existing veterans', () => {
    const w = arena();
    w.players.get(1)!.age = 3;
    const u = spawn(w, 'hoplite', 1, { x: 50, z: 50 });
    gainXp(w, u, RANKS[2].xp);
    research(w, 1, 'veteranHoplite');
    expect(u.maxHp).toBe(Math.round(UNITS.hoplite.hp * 1.25 * RANKS[2].hp));
    expect(u.hp).toBe(u.maxHp);
  });
});

describe('veterans work more slowly', () => {
  it('gather intervals grow by the rank work factor (stacking with tools)', () => {
    const w = arena();
    research(w, 1, 'bronzeAxe');
    const u = spawn(w, 'swordsman', 1, { x: 50, z: 50 });
    const basic = gatherInterval(w, u, 'wood', false);
    expect(basic).toBeCloseTo(BALANCE.gatherIntervals.wood);
    u.rank = 1;
    expect(gatherInterval(w, u, 'wood', false)).toBeCloseTo(basic / RANKS[1].work);
    u.rank = 2;
    expect(gatherInterval(w, u, 'gold', false)).toBeCloseTo(BALANCE.gatherIntervals.gold / RANKS[2].work);
    expect(gatherInterval(w, u, 'food', true)).toBeCloseTo(BALANCE.farmInterval / RANKS[2].work);
    expect(RANKS[1].work).toBe(0.85);
    expect(RANKS[2].work).toBe(0.7);
  });

  it('construction progresses at the rank work factor', () => {
    const progress = (rank: 0 | 1 | 2): number => {
      const w = arena();
      const u = spawn(w, 'swordsman', 1, { x: 50, z: 53 });
      if (rank) u.rank = rank;
      const site = layFoundation(w, 'house', { x: 50, z: 50 }, 0, 1);
      w.dispatch({ type: 'construct', unitIds: [u.id], buildingId: site.id });
      run(w, 3);
      const start = site.buildProgress;
      expect(u.state).toBe('building');
      run(w, 2);
      return site.buildProgress - start;
    };
    const basic = progress(0);
    expect(basic).toBeGreaterThan(0);
    expect(progress(1) / basic).toBeCloseTo(Math.pow(RANKS[1].work, BALANCE.buildExponent), 2);
    expect(progress(2) / basic).toBeCloseTo(Math.pow(RANKS[2].work, BALANCE.buildExponent), 2);
  });
});

describe('rank persistence', () => {
  it('saves and loads xp, rank and the damage log; version 2 saves load at rank 0', () => {
    const { hf, layout } = generateMap(17, 2);
    const w = new World(hf, layout);
    w.seed = 17;
    const tc = w.townCenter!;
    const vet = spawn(w, 'hoplite', 1, { x: tc.pos.x + 6, z: tc.pos.z + 6 });
    gainXp(w, vet, RANKS[1].xp + 20);
    const victim = spawn(w, 'villager', 2, { x: tc.pos.x + 8, z: tc.pos.z + 6 });
    applyDamage(w, victim, 3, vet.id, 1, vet.pos);
    const data = serializeWorld(w);
    expect(data.version).toBe(3);
    const b = deserializeWorld(data, hf);
    const loaded = b.units.get(vet.id)!;
    expect(loaded.rank).toBe(1);
    expect(loaded.xp).toBeCloseTo(RANKS[1].xp + 20);
    expect(loaded.maxHp).toBe(vet.maxHp);
    expect(b.damageLog.get(victim.id)).toEqual(w.damageLog.get(victim.id));

    const old = JSON.parse(JSON.stringify(data));
    old.version = 2;
    delete old.systems.damageLog;
    for (const u of old.units) { delete u.xp; delete u.rank; }
    const c = deserializeWorld(old, hf);
    expect(c.units.get(vet.id)!.rank ?? 0).toBe(0);
    expect(c.units.get(vet.id)!.xp ?? 0).toBe(0);
    expect(c.damageLog.size).toBe(0);

    const bad = JSON.parse(JSON.stringify(data));
    bad.units.find((u: Unit) => u.id === vet.id).rank = 3;
    expect(() => deserializeWorld(bad, hf)).toThrow('unit rank');
  });
});
