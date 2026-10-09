import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { GRASS_ONLY, type Heightfield, type MapLayout, type PlayerId, type SimEvent, type Unit, type UnitKind, type Vec2 } from '../core/types';
import { UNITS, damage } from '../core/units';
import { BALANCE } from './balance';
import { completeBuilding, layFoundation } from './systems/build';
import { damageTo, unitSpeed } from './systems/stats';
import { defaultPlayers, World } from './World';

const DT = 1 / BALANCE.tickRate;

function flat(w = 120, d = 120): Heightfield {
  return {
    width: w,
    depth: d,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

/** Two players, Town Centers tucked in far corners, no starting units. */
function arena(opts: { w?: number; d?: number; nodes?: MapLayout['nodes']; sameTeam?: boolean } = {}): World {
  const w = opts.w ?? 120;
  const d = opts.d ?? 120;
  const layout: MapLayout = {
    townCenter: { x: 4, z: 4 },
    villagers: [],
    scouts: [],
    extraStarts: [{ townCenter: { x: w - 4, z: d - 4 }, villagers: [], scouts: [] }],
    nodes: opts.nodes ?? [],
    props: [],
  };
  const players = defaultPlayers(2);
  if (opts.sameTeam) players[1].team = players[0].team;
  return new World(flat(w, d), layout, players);
}

function spawn(world: World, kind: UnitKind, owner: PlayerId, p: Vec2): Unit {
  return world.spawnUnit(kind, p, owner);
}

function squad(world: World, kind: UnitKind, owner: PlayerId, x: number, z: number, n = 5): Unit[] {
  return Array.from({ length: n }, (_, i) => spawn(world, kind, owner, { x, z: z + (i - (n - 1) / 2) * 1.2 }));
}

function run(world: World, seconds: number, until?: () => boolean): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.tick(DT);
    if (until?.()) return (i + 1) * DT;
  }
  return seconds;
}

function record(world: World): SimEvent[] {
  const log: SimEvent[] = [];
  for (const t of ['damaged', 'died', 'removed', 'projectile', 'attacked', 'rejected', 'stockpile'] as const) {
    world.events.on(t, (e) => log.push(e));
  }
  return log;
}

const alive = (world: World, list: Unit[]) => list.filter((u) => world.units.has(u.id));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

describe('damage', () => {
  it('applies armour per type, a minimum of 1 and class bonuses', () => {
    expect(damage('hoplite', 'cavalry', UNITS.horseman.armor)).toBe(4 + 12);
    expect(damage('archer', 'infantry', UNITS.hoplite.armor)).toBe(3);
    expect(damage('slinger', 'infantry', UNITS.swordsman.armor)).toBe(3 + 3);
    expect(damage('horseman', 'archer', UNITS.archer.armor)).toBe(8 + 6);
    expect(damage('villager', 'infantry', { melee: 5, pierce: 5 })).toBe(1);
  });

  it('hits buildings with their own armour and no class bonus', () => {
    const world = arena();
    const tc = world.townCenterOf(2)!;
    expect(damageTo('swordsman', tc)).toBe(8 - BUILDINGS.townCenter.armor.melee);
    expect(damageTo('archer', tc)).toBe(1);
    expect(damageTo('hoplite', tc)).toBe(5 - 3);
  });

  it('exposes per-kind speeds for movement', () => {
    const world = arena();
    const h = spawn(world, 'horseman', 1, { x: 30, z: 30 });
    const v = spawn(world, 'villager', 1, { x: 31, z: 30 });
    expect(unitSpeed(h)).toBe(UNITS.horseman.speed);
    expect(unitSpeed(v)).toBe(UNITS.villager.speed);
    v.carry = { type: 'wood', amount: 3 };
    expect(unitSpeed(v)).toBeCloseTo(BALANCE.villagerSpeedLoaded);
  });
});

describe('melee', () => {
  it('closes in, strikes every reload, and kills: damaged… died → removed, attacker freed', () => {
    const world = arena();
    const log = record(world);
    const a = spawn(world, 'swordsman', 1, { x: 30, z: 30 });
    const b = spawn(world, 'hoplite', 2, { x: 34, z: 30 });
    world.dispatch({ type: 'stance', unitIds: [b.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: b.id });
    expect(a.state).toBe('attacking');
    expect(a.target).toBe(b.id);
    run(world, 30, () => !world.units.has(b.id));
    expect(world.units.has(b.id)).toBe(false);

    const hits = log.filter((e) => e.type === 'damaged' && e.id === b.id);
    const per = damage('swordsman', 'infantry', UNITS.hoplite.armor);
    expect(hits.length).toBe(Math.ceil(UNITS.hoplite.hp / per));
    expect(hits.map((e) => (e as { hp: number }).hp)).toEqual(hits.map((_, i) => Math.max(0, UNITS.hoplite.hp - per * (i + 1))));
    const died = log.findIndex((e) => e.type === 'died' && e.id === b.id);
    const removed = log.findIndex((e) => e.type === 'removed' && e.id === b.id);
    expect(died).toBeGreaterThan(-1);
    expect(removed).toBe(died + 1);
    expect(log[died]).toMatchObject({ kind: 'hoplite', owner: 2 });
    world.tick(DT);
    expect(a.target).toBeNull();
    expect(a.state).toBe('idle');
  });

  it('chases a target that walks away and gives up past the leash or out of sight', () => {
    const world = arena();
    const a = spawn(world, 'hoplite', 1, { x: 30, z: 60 });
    const s = spawn(world, 'scout', 2, { x: 32, z: 60 });
    world.dispatch({ type: 'stance', unitIds: [s.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: s.id });
    run(world, 0.5);
    world.dispatch({ type: 'move', unitIds: [s.id], target: { x: 100, z: 60 } }, 2);
    run(world, 3);
    expect(a.pos.x).toBeGreaterThan(33); // followed
    run(world, 20);
    expect(a.state).toBe('idle');
    expect(a.target).toBeNull();
    expect(a.pos.x).toBeLessThan(30 + BALANCE.leash + 4);
  });
});

describe('ranged', () => {
  it('launches a projectile and damage lands after its flight', () => {
    const world = arena();
    const log = record(world);
    const a = spawn(world, 'archer', 1, { x: 30, z: 30 });
    const t = spawn(world, 'hoplite', 2, { x: 36, z: 30 });
    world.dispatch({ type: 'stance', unitIds: [t.id], stance: 'passive' }, 2);
    world.updateFog();
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: t.id });
    world.tick(DT);
    const shot = log.find((e) => e.type === 'projectile');
    expect(shot).toMatchObject({ kind: 'arrow', targetId: t.id });
    const s = shot as Extract<SimEvent, { type: 'projectile' }>;
    expect(s.flight).toBeCloseTo(dist(s.from, s.to) / BALANCE.projectileSpeed, 5);
    expect(a.pos).toEqual({ x: 30, z: 30 }); // in range already: never moved
    expect(t.hp).toBe(UNITS.hoplite.hp);
    run(world, s.flight + DT);
    expect(t.hp).toBe(UNITS.hoplite.hp - damage('archer', 'infantry', UNITS.hoplite.armor));
  });

  it('misses a target that left the impact radius before the projectile landed', () => {
    const world = arena();
    const log = record(world);
    const a = spawn(world, 'archer', 1, { x: 30, z: 30 });
    const t = spawn(world, 'hoplite', 2, { x: 36, z: 30 });
    world.dispatch({ type: 'stance', unitIds: [t.id], stance: 'passive' }, 2);
    world.updateFog();
    world.events.on('projectile', () => {
      t.pos = { x: t.pos.x, z: t.pos.z + 1.5 }; // sidestep
      t.prevPos = { ...t.pos };
    });
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: t.id });
    run(world, 1);
    expect(log.some((e) => e.type === 'projectile')).toBe(true);
    expect(log.some((e) => e.type === 'damaged')).toBe(false);
    expect(t.hp).toBe(UNITS.hoplite.hp);
  });

  it('leads a target walking in a straight line', () => {
    const world = arena();
    const a = spawn(world, 'archer', 1, { x: 30, z: 30 });
    const t = spawn(world, 'hoplite', 2, { x: 35, z: 26 });
    world.dispatch({ type: 'stance', unitIds: [t.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'move', unitIds: [t.id], target: { x: 35, z: 40 } }, 2);
    world.tick(DT);
    world.updateFog();
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: t.id });
    run(world, 1);
    expect(t.hp).toBeLessThan(UNITS.hoplite.hp);
  });
});

describe('counters (5 v 5, open ground)', () => {
  function battle(k1: UnitKind, k2: UnitKind, gap: number, w = 120): { won1: boolean; left1: number; left2: number } {
    const world = arena({ w });
    const z = 60;
    const x = w / 2;
    const s1 = squad(world, k1, 1, x - gap / 2, z);
    const s2 = squad(world, k2, 2, x + gap / 2, z);
    world.updateFog();
    run(world, 180, () => !alive(world, s1).length || !alive(world, s2).length);
    return { won1: alive(world, s1).length > 0 && !alive(world, s2).length, left1: alive(world, s1).length, left2: alive(world, s2).length };
  }

  it('hoplites beat horsemen', () => {
    expect(battle('hoplite', 'horseman', 5).won1).toBe(true);
  });

  it('horsemen beat archers', () => {
    expect(battle('horseman', 'archer', 7).won1).toBe(true);
  });

  it('archers beat hoplites at range (they kite)', () => {
    const r = battle('archer', 'hoplite', 7.5, 240);
    expect(r.won1).toBe(true);
    expect(r.left1).toBeGreaterThanOrEqual(4);
  });
});

describe('target acquisition', () => {
  it('only auto-acquires enemies its owner can see', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 50, z: 50 });
    // Within sight edge-to-edge, but its cell centre is just outside the hoplite's sight circle.
    const e = spawn(world, 'horseman', 2, { x: 56.7, z: 50 });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    run(world, 1);
    expect(world.visibilityOf(1).isVisible(e.pos.x, e.pos.z)).toBe(false);
    expect(h.state).toBe('idle');
    spawn(world, 'scout', 1, { x: 48, z: 50 }); // far-sighted friend reveals it
    run(world, 1);
    expect(h.target === e.id || (world.units.get(h.id)?.state === 'attacking')).toBe(true);
  });

  it('ignores allies and gaia', () => {
    const world = arena({ sameTeam: true });
    const h = spawn(world, 'hoplite', 1, { x: 50, z: 50 });
    spawn(world, 'hoplite', 2, { x: 52, z: 50 });
    run(world, 2);
    expect(h.state).toBe('idle');
    world.dispatch({ type: 'attack', unitIds: [h.id], targetId: [...world.units.values()].find((u) => u.owner === 2)!.id });
    expect(h.state).toBe('idle');
  });
});

describe('stances', () => {
  it('passive units never attack', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 50, z: 50 });
    const e = spawn(world, 'hoplite', 2, { x: 51.5, z: 50 });
    world.dispatch({ type: 'stance', unitIds: [h.id], stance: 'passive' });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    run(world, 3);
    expect(h.state).toBe('idle');
    expect(e.hp).toBe(e.maxHp);
  });

  it('stand ground shoots what is in range and never moves', () => {
    const world = arena();
    const a = spawn(world, 'archer', 1, { x: 50, z: 50 });
    const far = spawn(world, 'hoplite', 2, { x: 50, z: 58 }); // in sight, out of range
    world.dispatch({ type: 'stance', unitIds: [a.id, far.id].slice(0, 1), stance: 'standGround' });
    world.dispatch({ type: 'stance', unitIds: [far.id], stance: 'passive' }, 2);
    run(world, 2);
    expect(a.state).toBe('idle');
    expect(a.pos).toEqual({ x: 50, z: 50 });
    const near = spawn(world, 'hoplite', 2, { x: 50, z: 44 });
    world.dispatch({ type: 'stance', unitIds: [near.id], stance: 'passive' }, 2);
    run(world, 2);
    expect(a.target).toBe(near.id);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(a.pos).toEqual({ x: 50, z: 50 });
    // Target walks out of range: stand-ground gives up instead of chasing.
    world.dispatch({ type: 'move', unitIds: [near.id], target: { x: 50, z: 30 } }, 2);
    run(world, 6);
    expect(a.pos).toEqual({ x: 50, z: 50 });
    expect(a.target).toBeNull();
  });

  it('defensive units engage only close enemies and return to their post', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 50, z: 50 });
    world.dispatch({ type: 'stance', unitIds: [h.id], stance: 'defensive' });
    const far = spawn(world, 'hoplite', 2, { x: 55, z: 50 }); // edge ≈ 4.4 > sight/2
    world.dispatch({ type: 'stance', unitIds: [far.id], stance: 'passive' }, 2);
    run(world, 2);
    expect(h.state).toBe('idle');
    world.dispatch({ type: 'move', unitIds: [far.id], target: { x: 52, z: 50 } }, 2);
    run(world, 2);
    expect(h.target).toBe(far.id);
    // The enemy runs off; the defender chases a bit, then goes home.
    world.dispatch({ type: 'move', unitIds: [far.id], target: { x: 75, z: 50 } }, 2);
    run(world, 25);
    expect(h.target).toBeNull();
    expect(dist(h.pos, { x: 50, z: 50 })).toBeLessThan(1.5);
  });

  it('aggressive idle units hit back when attacked by something they cannot see', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 50, z: 50 });
    const a = spawn(world, 'archer', 2, { x: 50, z: 56.9 }); // archer sees it; hoplite (sight 6) doesn't
    world.dispatch({ type: 'attack', unitIds: [a.id], targetId: h.id }, 2);
    run(world, 1.5);
    expect(h.hp).toBeLessThan(h.maxHp);
  });
});

describe('villagers under attack', () => {
  it('flee from the attacker, then go back to work', () => {
    const world = arena({ nodes: [{ kind: 'tree', pos: { x: 50, z: 50 }, amount: 200 }] });
    const tree = [...world.nodes.keys()][0];
    const v = spawn(world, 'villager', 1, { x: 50, z: 51 });
    world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: tree });
    run(world, 2);
    expect(v.state).toBe('gathering');
    const s = spawn(world, 'swordsman', 2, { x: 50, z: 53 });
    world.dispatch({ type: 'attack', unitIds: [s.id], targetId: v.id }, 2);
    run(world, 3, () => v.hp < v.maxHp);
    expect(v.hp).toBeLessThan(v.maxHp);
    world.dispatch({ type: 'stop', unitIds: [s.id] }, 2);
    world.dispatch({ type: 'stance', unitIds: [s.id], stance: 'passive' }, 2);
    const hitAt = { ...v.pos };
    world.tick(DT);
    expect(v.state).toBe('moving');
    run(world, 1);
    expect(dist(v.pos, s.pos)).toBeGreaterThan(dist(hitAt, s.pos));
    run(world, 5);
    expect(v.gatherNode).toBe(tree);
    expect(['toNode', 'gathering']).toContain(v.state);
  });
});

describe('buildings', () => {
  function house(world: World, owner: PlayerId, pos: Vec2) {
    const b = layFoundation(world, 'house', pos, 0, owner);
    completeBuilding(world, b);
    b.hp = b.maxHp;
    return b;
  }

  it('take damage, are destroyed, free their footprint and drop the pop cap', () => {
    const world = arena();
    const log = record(world);
    const b = house(world, 1, { x: 60, z: 60 });
    const cap = world.popCapOf(1);
    expect(world.nav.isFree(b.pos)).toBe(false);
    const sw = squad(world, 'swordsman', 2, 66, 60);
    world.dispatch({ type: 'attack', unitIds: sw.map((u) => u.id), targetId: b.id }, 2);
    run(world, 5);
    expect(b.hp).toBeLessThan(b.maxHp);
    const hit = log.find((e) => e.type === 'damaged' && e.id === b.id) as { hp: number };
    expect(hit.hp).toBe(b.maxHp - damageTo('swordsman', b));
    run(world, 120, () => !world.buildings.has(b.id));
    expect(world.buildings.has(b.id)).toBe(false);
    const died = log.findIndex((e) => e.type === 'died' && e.id === b.id);
    expect(log[died + 1]).toEqual({ type: 'removed', id: b.id });
    expect(world.nav.isFree(b.pos)).toBe(true);
    expect(world.popCapOf(1)).toBe(cap - BUILDINGS.house.popBonus);
    expect(sw.every((u) => u.target !== b.id)).toBe(true);
  });

  it('a destroyed Town Center drops its training queue', () => {
    const world = arena();
    const tc = world.townCenterOf(1)!;
    world.stockOf(1).food = 100;
    world.dispatch({ type: 'train', buildingId: tc.id });
    tc.hp = 3;
    const sw = spawn(world, 'swordsman', 2, { x: 4, z: 8 });
    world.dispatch({ type: 'attack', unitIds: [sw.id], targetId: tc.id }, 2);
    run(world, 12, () => !world.buildings.has(tc.id));
    expect(world.townCenterOf(1)).toBeUndefined();
    expect(world.popCapOf(1)).toBe(0);
    run(world, 10);
    expect(world.popOf(1)).toBe(0); // the queued villager never appears
  });

  it('foundations gain hp as they are built and can be attacked', () => {
    const world = arena();
    const b = layFoundation(world, 'house', { x: 60, z: 60 }, 0, 1);
    expect(b.hp).toBeCloseTo(b.maxHp * BALANCE.foundationHp, 0);
    const v = spawn(world, 'villager', 1, { x: 60, z: 62.3 });
    world.dispatch({ type: 'construct', unitIds: [v.id], buildingId: b.id });
    run(world, BUILDINGS.house.buildTime / 2);
    expect(b.hp).toBeGreaterThan(b.maxHp * 0.4);
    run(world, BUILDINGS.house.buildTime);
    expect(b.complete).toBe(true);
    expect(b.hp).toBeCloseTo(b.maxHp, 5);

    const f = layFoundation(world, 'house', { x: 80, z: 60 }, 0, 1);
    const sw = spawn(world, 'swordsman', 2, { x: 80, z: 63 });
    world.dispatch({ type: 'attack', unitIds: [sw.id], targetId: f.id }, 2);
    run(world, 30, () => !world.buildings.has(f.id));
    expect(world.buildings.has(f.id)).toBe(false);
  });
});

describe('death bookkeeping and alerts', () => {
  it('clears every system’s state about a dead unit', () => {
    const world = arena({ nodes: [{ kind: 'berry', pos: { x: 50, z: 50 }, amount: 200 }] });
    const bush = [...world.nodes.keys()][0];
    const v = spawn(world, 'villager', 1, { x: 50, z: 51 });
    world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: bush });
    run(world, 1);
    expect(world.gatherState.has(v.id)).toBe(true);
    v.hp = 1;
    const sw = squad(world, 'swordsman', 2, 50, 53, 2);
    world.dispatch({ type: 'attack', unitIds: sw.map((u) => u.id), targetId: v.id }, 2);
    run(world, 3, () => !world.units.has(v.id));
    expect(world.units.has(v.id)).toBe(false);
    for (const m of [world.gatherState, world.exploreState, world.buildState, world.combatState, world.fleeState]) {
      expect(m.has(v.id)).toBe(false);
    }
    expect(sw.every((u) => u.target !== v.id)).toBe(true);
    expect(world.popOf(1)).toBe(0);
  });

  it("rate-limits the victim owner's 'attacked' alerts", () => {
    const world = arena();
    const log = record(world);
    const h = spawn(world, 'hoplite', 1, { x: 50, z: 50 });
    world.dispatch({ type: 'stance', unitIds: [h.id], stance: 'passive' });
    const sw = squad(world, 'swordsman', 2, 51.5, 50, 3);
    world.dispatch({ type: 'attack', unitIds: sw.map((u) => u.id), targetId: h.id }, 2);
    run(world, 5);
    const alerts = log.filter((e) => e.type === 'attacked');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.length).toBeLessThanOrEqual(2);
    expect(alerts[0]).toMatchObject({ owner: 1, id: h.id });
  });
});

describe('attack-move', () => {
  it('fights enemies met on the way, then carries on to the destination', () => {
    const world = arena();
    const sq = squad(world, 'swordsman', 1, 20, 60, 3);
    const e = spawn(world, 'villager', 2, { x: 45, z: 61 });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'attackMove', unitIds: sq.map((u) => u.id), target: { x: 80, z: 60 } });
    expect(sq[0].state).toBe('moving');
    run(world, 25, () => !world.units.has(e.id));
    expect(world.units.has(e.id)).toBe(false);
    run(world, 30);
    for (const u of sq) expect(dist(u.pos, { x: 80, z: 60 })).toBeLessThan(3);
    expect(sq.every((u) => u.state === 'idle')).toBe(true);
  });

  it('a plain move ignores enemies; stop clears the order', () => {
    const world = arena();
    const h = spawn(world, 'hoplite', 1, { x: 20, z: 60 });
    const e = spawn(world, 'hoplite', 2, { x: 30, z: 61 });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'move', unitIds: [h.id], target: { x: 40, z: 60 } });
    run(world, 4);
    expect(e.hp).toBe(e.maxHp);
    world.dispatch({ type: 'attack', unitIds: [h.id], targetId: e.id });
    world.dispatch({ type: 'stop', unitIds: [h.id] });
    expect(h.state).toBe('idle');
    expect(h.target).toBeNull();
    expect(h.path.length).toBe(0);
  });
});

describe('rally points', () => {
  function trainAt(world: World, kind?: UnitKind): Unit {
    const tc = world.townCenterOf(1)!;
    world.stockOf(1).food = 1000;
    const before = new Set(world.units.keys());
    world.dispatch({ type: 'train', buildingId: tc.id, unit: kind });
    run(world, UNITS.villager.trainTime + 0.1);
    return [...world.units.values()].find((u) => !before.has(u.id))!;
  }

  it('trained units walk to the rally point', () => {
    const world = arena();
    const tc = world.townCenterOf(1)!;
    world.dispatch({ type: 'rally', buildingId: tc.id, pos: { x: 20, z: 12 } });
    expect(tc.rally).toEqual({ pos: { x: 20, z: 12 } });
    const u = trainAt(world);
    expect(u.state).toBe('moving');
    run(world, 10);
    expect(dist(u.pos, { x: 20, z: 12 })).toBeLessThan(0.5);
  });

  it('villagers gather a rallied resource', () => {
    const world = arena({ nodes: [{ kind: 'tree', pos: { x: 14, z: 10 }, amount: 100 }] });
    const tc = world.townCenterOf(1)!;
    const tree = [...world.nodes.keys()][0];
    world.dispatch({ type: 'rally', buildingId: tc.id, pos: { x: 14, z: 10 }, targetId: tree });
    const u = trainAt(world);
    expect(u.gatherNode).toBe(tree);
    expect(u.state).toBe('toNode');
  });

  it('units attack a rallied enemy; rallying on the building itself clears it; others cannot set it', () => {
    const world = arena();
    const tc = world.townCenterOf(1)!;
    const e = spawn(world, 'hoplite', 2, { x: 10, z: 10 });
    world.dispatch({ type: 'stance', unitIds: [e.id], stance: 'passive' }, 2);
    world.dispatch({ type: 'rally', buildingId: tc.id, pos: e.pos, targetId: e.id });
    const u = trainAt(world);
    expect(u.state).toBe('attacking');
    expect(u.target).toBe(e.id);
    world.dispatch({ type: 'rally', buildingId: tc.id, pos: { ...tc.pos } });
    expect(tc.rally).toBeUndefined();
    world.dispatch({ type: 'rally', buildingId: world.townCenterOf(2)!.id, pos: { x: 50, z: 50 } });
    expect(world.townCenterOf(2)!.rally).toBeUndefined();
  });
});

describe('performance', () => {
  it('ticks a 200-unit battle in under ~6 ms', () => {
    const world = arena({ w: 176, d: 176 });
    const kinds: UnitKind[] = ['hoplite', 'swordsman', 'archer', 'slinger', 'horseman'];
    for (let i = 0; i < 100; i++) {
      const k = kinds[i % kinds.length];
      const row = Math.floor(i / 10);
      const col = i % 10;
      spawn(world, k, 1, { x: 70 + row * 1.2, z: 76 + col * 1.2 });
      spawn(world, k, 2, { x: 96 - row * 1.2, z: 76 + col * 1.2 });
    }
    world.updateFog();
    run(world, 4); // close in and engage
    const n = 100;
    const t0 = performance.now();
    run(world, n * DT);
    const per = (performance.now() - t0) / n;
    expect(world.units.size).toBeGreaterThan(40);
    expect(per).toBeLessThan(6);
  });
});
