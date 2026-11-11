import { describe, expect, it } from 'vitest';
import { BUILDINGS, footprintRadius } from '../core/buildings';
import { TECHS, TECH_IDS, applyStat, unitLine, type TechId } from '../core/techs';
import { GRASS_ONLY, type Building, type BuildingKind, type Heightfield, type MapLayout, type SimEvent } from '../core/types';
import { World } from './World';
import { UNITS } from '../core/units';
import { CIVS, CIV_IDS } from '../core/civilizations';
import { EXPLORED } from './visibility';
import { deserializeWorld, serializeWorld } from './serialize';
import { ageBuildings, ageBuildingsNeeded, researchBlock, statOf } from './systems/research';

function flat(): Heightfield {
  return {
    width: 80,
    depth: 80,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= 80 && z <= 80,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function world(): World {
  const layout: MapLayout = { townCenter: { x: 20, z: 20 }, villagers: [{ x: 20, z: 25 }], scouts: [], nodes: [], props: [] };
  return new World(flat(), layout);
}

/** Drop a finished building straight into the world (test shortcut, no nav update). */
function addBuilding(w: World, kind: BuildingKind, x: number, z: number, owner = 1): Building {
  const b: Building = {
    id: w.allocId(), kind, owner, hp: BUILDINGS[kind].hp, maxHp: BUILDINGS[kind].hp, pos: { x, z }, rot: 0,
    radius: footprintRadius(kind), complete: true, buildProgress: 1, queue: 0, progress: 0,
  };
  w.buildings.set(b.id, b);
  return b;
}

function run(w: World, seconds: number) {
  for (let t = 0; t < seconds * 20; t++) w.tick(0.05);
}

describe('tech table', () => {
  it('only requires techs that exist, researched at buildings that exist', () => {
    for (const id of TECH_IDS) {
      for (const r of TECHS[id].requires ?? []) expect(TECH_IDS).toContain(r);
      expect(BUILDINGS[TECHS[id].at]).toBeDefined();
    }
  });

  it('applies adds before muls, and class targets', () => {
    const r = new Set<TechId>(['bronzeWeapons', 'veteranHoplite']);
    expect(applyStat(r, { unit: 'hoplite' }, 'attack.melee', 5)).toBe(8);
    expect(applyStat(r, { unit: 'hoplite' }, 'hp', 55)).toBeCloseTo(68.75);
    expect(applyStat(r, { unit: 'archer' }, 'attack.melee', 0)).toBe(0);
    expect(unitLine(r, 'hoplite').title).toBe('Veteran Hoplite');
  });
});

describe('research queue', () => {
  it('pays, takes time, then records the tech', () => {
    const w = world();
    const store = addBuilding(w, 'storehouse', 40, 40);
    w.stock.food = TECHS.bronzeAxe.cost.food!;
    w.stock.wood = TECHS.bronzeAxe.cost.wood!;
    const events: SimEvent[] = [];
    w.events.on('researched', (e) => events.push(e));
    w.dispatch({ type: 'research', buildingId: store.id, tech: 'bronzeAxe' });
    expect(w.stock.food).toBe(0);
    expect(store.research).toEqual(['bronzeAxe']);
    run(w, TECHS.bronzeAxe.time - 1);
    expect(w.players.get(1)!.researched.has('bronzeAxe')).toBe(false);
    run(w, 1.1);
    expect(w.players.get(1)!.researched.has('bronzeAxe')).toBe(true);
    expect(events.some((e) => e.type === 'researched' && e.tech === 'bronzeAxe')).toBe(true);
    expect(statOf(w, 1, { unit: 'villager' }, 'gather.wood', 1)).toBeCloseTo(TECHS.bronzeAxe.effects[0].value);
  });

  it('refunds on cancel and rejects duplicates, missing ages and prerequisites', () => {
    const w = world();
    const store = addBuilding(w, 'storehouse', 40, 40);
    Object.assign(w.stock, { food: 1000, wood: 1000, gold: 1000 });
    expect(researchBlock(w, 1, 'ironAxe')).toBe('age');
    w.players.get(1)!.age = 1;
    expect(researchBlock(w, 1, 'ironAxe')).toBe('requires');
    w.dispatch({ type: 'research', buildingId: store.id, tech: 'bronzeAxe' });
    expect(researchBlock(w, 1, 'bronzeAxe')).toBe('researched');
    w.dispatch({ type: 'cancelResearch', buildingId: store.id, index: 0 });
    expect(w.stock.food).toBe(1000);
    expect(store.research).toBeUndefined();
  });

  it('ages up only with two current-age buildings, and holds the TC queue', () => {
    const w = world();
    const tc = w.townCenter!;
    w.stock.food = 2000;
    expect(researchBlock(w, 1, 'townAge')).toBe('requires');
    addBuilding(w, 'storehouse', 40, 40);
    addBuilding(w, 'barracks', 50, 50);
    expect(researchBlock(w, 1, 'townAge')).toBeNull();
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'townAge' });
    w.dispatch({ type: 'train', buildingId: tc.id });
    expect(tc.queue).toBe(1);
    run(w, TECHS.townAge.time + 0.1);
    expect(w.players.get(1)!.age).toBe(1);
    expect(tc.queue).toBe(1); // villager waited for the age-up
    run(w, 9);
    expect(tc.queue).toBe(0);
  });

  it('finishes a partly trained villager before later research, then trains the next villager', () => {
    const w = world();
    const tc = w.townCenter!;
    Object.assign(w.stock, { food: 2000, wood: 2000, gold: 2000 });
    const start = w.units.size;
    w.dispatch({ type: 'train', buildingId: tc.id });
    run(w, 3);
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'wovenTunics' });
    w.dispatch({ type: 'train', buildingId: tc.id });
    expect(tc.productionQueue).toEqual(['train', 'research', 'train']);
    run(w, UNITS.villager.trainTime - 3);
    expect(w.units.size).toBe(start + 1);
    expect(tc.researchProgress).toBe(0);
    expect(tc.productionQueue).toEqual(['research', 'train']);
    run(w, TECHS.wovenTunics.time);
    expect(w.players.get(1)!.researched.has('wovenTunics')).toBe(true);
    expect(tc.progress).toBe(0); // no double-spending the completion tick
    run(w, UNITS.villager.trainTime);
    expect(w.units.size).toBe(start + 2);
  });

  it('cancels entries by their payload indices without changing the surviving FIFO order', () => {
    const w = world();
    const tc = w.townCenter!;
    Object.assign(w.stock, { food: 2000, wood: 2000, gold: 2000 });
    w.dispatch({ type: 'train', buildingId: tc.id });
    run(w, 3);
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'wovenTunics' });
    w.dispatch({ type: 'train', buildingId: tc.id });
    const food = w.stock.food;
    w.dispatch({ type: 'cancelTrain', buildingId: tc.id, index: 1 });
    expect(w.stock.food).toBe(food + UNITS.villager.cost.food!);
    expect(tc.progress).toBeCloseTo(3);
    expect(tc.productionQueue).toEqual(['train', 'research']);
    w.dispatch({ type: 'cancelTrain', buildingId: tc.id, index: 0 });
    expect(tc.progress).toBe(0);
    expect(tc.productionQueue).toEqual(['research']);
    run(w, 2);
    w.dispatch({ type: 'train', buildingId: tc.id });
    w.dispatch({ type: 'cancelResearch', buildingId: tc.id, index: 0 });
    expect(tc.research).toBeUndefined();
    expect(tc.productionQueue).toEqual(['train']);
    run(w, UNITS.villager.trainTime);
    expect(tc.productionQueue).toEqual([]);
  });

  it('round-trips mixed queues and preserves research-first order in legacy v2 saves', () => {
    const w = world();
    w.seed = 17;
    const tc = w.townCenter!;
    Object.assign(w.stock, { food: 2000, wood: 2000, gold: 2000 });
    w.dispatch({ type: 'train', buildingId: tc.id });
    run(w, 3);
    w.dispatch({ type: 'research', buildingId: tc.id, tech: 'wovenTunics' });
    const saved = JSON.parse(JSON.stringify(serializeWorld(w)));
    const loaded = deserializeWorld(saved, flat());
    expect(loaded.townCenter!.productionQueue).toEqual(['train', 'research']);
    run(loaded, UNITS.villager.trainTime - 3);
    expect(loaded.townCenter!.queue).toBe(0);
    expect(loaded.townCenter!.researchProgress).toBe(0);
    const corrupt = JSON.parse(JSON.stringify(saved));
    corrupt.buildings.find((b: Building) => b.kind === 'townCenter').productionQueue = ['research'];
    expect(() => deserializeWorld(corrupt, flat())).toThrow('Invalid save: production queue');
    for (const b of saved.buildings) delete b.productionQueue;
    const legacy = deserializeWorld(saved, flat());
    run(legacy, 1);
    expect(legacy.townCenter!.progress).toBeCloseTo(3);
    expect(legacy.townCenter!.researchProgress).toBeCloseTo(1);
    legacy.dispatch({ type: 'train', buildingId: legacy.townCenter!.id });
    expect(legacy.townCenter!.productionQueue).toEqual(['research', 'train', 'train']);
  }, 30_000);

  it('Empire Age needs only the Academy (the City Age has no second building)', () => {
    const w = world();
    w.players.get(1)!.age = 2;
    expect(researchBlock(w, 1, 'empireAge', true)).toBe('requires');
    addBuilding(w, 'academy', 40, 40);
    expect(researchBlock(w, 1, 'empireAge', true)).toBeNull();
  });
});

describe('military age gates', () => {
  it.each([
    ['barracks', 'hoplite'], ['archeryRange', 'slinger'], ['stable', 'scout'],
  ] as const)('builds %s and trains %s in Village Age', (kind, unit) => {
    const w = world();
    w.visibility.state.fill(EXPLORED);
    Object.assign(w.stock, { food: 1000, wood: 1000, stone: 1000 });
    const pos = { x: 32, z: 32 }; // inside the Town Center's territory
    expect(w.canPlace(kind, pos, 0, 1)).toEqual({ ok: true });
    w.dispatch({ type: 'build', unitIds: [...w.units.keys()], kind, pos, rot: 0 });
    const b = [...w.buildings.values()].find(b => b.kind === kind)!;
    expect(b).toBeDefined();
    run(w, BUILDINGS[kind].buildTime + 30);
    expect(b.complete).toBe(true);
    w.dispatch({ type: 'train', buildingId: b.id, unit });
    expect(b.queueKinds).toEqual([unit]);
    run(w, UNITS[unit].trainTime + 0.1);
    expect([...w.units.values()].some(u => u.kind === unit)).toBe(true);
    expect(w.players.get(1)!.age).toBe(0);
  });

  it.each(['archer', 'horseman', 'swordsman', ...CIV_IDS.map(civ => CIVS[civ].unit)] as const)(
    '%s requires Town Age before it can train', unit => {
      const w = world();
      const spec = UNITS[unit];
      w.players.get(1)!.player.civ = spec.civ;
      Object.assign(w.stock, { food: 1000, wood: 1000, gold: 1000, stone: 1000 });
      const b = addBuilding(w, spec.trainedAt!, 40, 40);
      const rejected: SimEvent[] = [];
      w.events.on('rejected', e => rejected.push(e));
      const stock = { ...w.stock };
      w.dispatch({ type: 'train', buildingId: b.id, unit });
      expect(rejected).toEqual([{ type: 'rejected', reason: 'age' }]);
      expect(b.queue).toBe(0);
      expect(w.stock).toEqual(stock);
      w.players.get(1)!.age = 1;
      w.dispatch({ type: 'train', buildingId: b.id, unit });
      expect(b.queueKinds).toEqual([unit]);
    }
  );

  it.each(['forge', 'market', 'watchTower', 'temple', 'stoneWall'] as const)(
    '%s still requires Town Age for placement', kind => {
      const w = world();
      w.visibility.state.fill(EXPLORED);
      Object.assign(w.stock, { wood: 1000, stone: 1000 });
      const pos = { x: 32, z: 32 }; // inside the Town Center's territory
      const rejected: SimEvent[] = [];
      w.events.on('rejected', e => rejected.push(e));
      w.dispatch({ type: 'build', unitIds: [], kind, pos, rot: 0 });
      expect(rejected).toEqual([{ type: 'rejected', reason: 'age' }]);
      expect([...w.buildings.values()].some(b => b.kind === kind)).toBe(false);
      w.players.get(1)!.age = 1;
      w.dispatch({ type: 'build', unitIds: [], kind, pos, rot: 0 });
      expect([...w.buildings.values()].some(b => b.kind === kind)).toBe(true);
    }
  );

  it('counts completed distinct ranges and stables for Town Age, but not City Age', () => {
    const w = world();
    Object.assign(w.stock, { food: 10000, gold: 10000 });
    expect(ageBuildingsNeeded(0)).toBe(2);
    expect(ageBuildingsNeeded(1)).toBe(2);
    addBuilding(w, 'archeryRange', 40, 40);
    addBuilding(w, 'archeryRange', 50, 40);
    addBuilding(w, 'stable', 60, 40, 2); // another player's building cannot qualify
    const stable = addBuilding(w, 'stable', 40, 50);
    stable.complete = false;
    expect(ageBuildings(w, 1, 0)).toEqual(['archeryRange']);
    expect(researchBlock(w, 1, 'townAge')).toBe('requires');
    stable.complete = true;
    expect(ageBuildings(w, 1, 0)).toEqual(['archeryRange', 'stable']);
    w.dispatch({ type: 'research', buildingId: w.townCenter!.id, tech: 'townAge' });
    run(w, TECHS.townAge.time + 0.1);
    expect(w.players.get(1)!.age).toBe(1);
    expect(ageBuildings(w, 1, 1)).toEqual([]);
    expect(researchBlock(w, 1, 'cityAge')).toBe('requires');
    addBuilding(w, 'forge', 50, 50);
    expect(researchBlock(w, 1, 'cityAge')).toBe('requires');
    addBuilding(w, 'market', 60, 50);
    expect(researchBlock(w, 1, 'cityAge')).toBeNull();
  });
});
