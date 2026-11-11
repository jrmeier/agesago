import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { CIV_IDS, CIVS } from '../core/civilizations';
import { TECHS, type TechId } from '../core/techs';
import type { BuildingKind } from '../core/types';
import { UNITS } from '../core/units';
import { techAge, techTreeModel, treeTechs, treeUnits, type TreeAge, type TreeEntry, type TreeInput } from './techTree';

const start = (over: Partial<TreeInput> = {}): TreeInput => ({
  civ: 'hellenes',
  age: 0,
  researched: new Set<TechId>(),
  built: new Set<BuildingKind>(['townCenter', 'house']),
  ...over,
});

function find(tree: TreeAge[], id: string): TreeEntry {
  for (const a of tree) for (const e of [...a.buildings, ...a.units, ...a.techs]) if (e.id === id) return e;
  throw new Error(`no entry ${id}`);
}

const all = (tree: TreeAge[]) => tree.flatMap((a) => [...a.buildings, ...a.units, ...a.techs]);

describe('tech tree model', () => {
  it('groups four ages in order and marks the current one', () => {
    const tree = techTreeModel(start({ age: 1 }));
    expect(tree.map((a) => a.name)).toEqual(['Village Age', 'Town Age', 'City Age', 'Empire Age']);
    expect(tree.map((a) => a.current)).toEqual([false, true, false, false]);
  });

  it('lists every civ tech, trainable unit and buildable building exactly once', () => {
    for (const civ of CIV_IDS) {
      const tree = techTreeModel(start({ civ }));
      const ids = all(tree).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of treeTechs(civ)) expect(ids).toContain(t);
      for (const u of treeUnits(civ)) expect(ids).toContain(u);
      expect(ids).toContain(CIVS[civ].unit);
      expect(ids).toContain(CIVS[civ].tech);
      for (const other of CIV_IDS.filter((c) => c !== civ)) {
        expect(ids).not.toContain(CIVS[other].unit);
        expect(ids).not.toContain(CIVS[other].tech);
      }
      for (const k of Object.keys(BUILDINGS) as BuildingKind[]) {
        if (BUILDINGS[k].buildable) expect(ids).toContain(k);
      }
      expect(ids).not.toContain('deer');
      expect(ids).not.toContain('sheep');
    }
  });

  it('files entries under their age', () => {
    const tree = techTreeModel(start());
    for (const a of tree) {
      for (const e of a.buildings) expect(BUILDINGS[e.id as BuildingKind].age ?? 0).toBe(a.age);
      for (const e of a.units) expect(UNITS[e.id as keyof typeof UNITS].age ?? 0).toBe(a.age);
      for (const e of a.techs) expect(techAge(e.id as TechId)).toBe(a.age);
    }
    expect(find(tree, 'cityAge').age).toBe(1);
    expect(find(tree, 'temperedSteel').age).toBe(3);
  });

  it('marks researched, queued, available and locked techs', () => {
    const tree = techTreeModel(start({
      researched: new Set<TechId>(['bronzeAxe']),
      queued: new Set<TechId>(['wovenTunics']),
      built: new Set<BuildingKind>(['townCenter', 'storehouse']),
    }));
    expect(find(tree, 'bronzeAxe')).toMatchObject({ state: 'done', badge: 'Researched', reason: '' });
    expect(find(tree, 'wovenTunics')).toMatchObject({ state: 'queued', badge: 'Queued' });
    expect(find(tree, 'donkeyPacks')).toMatchObject({ state: 'available', reason: '' });
    expect(find(tree, 'bronzePicks')).toMatchObject({ state: 'locked', reason: 'Requires Mining Camp' });
    expect(find(tree, 'ironAxe')).toMatchObject({ state: 'locked', reason: 'Requires Town Age' });
  });

  it('names the missing prerequisite tech once the age is reached', () => {
    const tree = techTreeModel(start({ age: 1, built: new Set<BuildingKind>(['townCenter', 'storehouse']) }));
    expect(find(tree, 'ironAxe')).toMatchObject({ state: 'locked', reason: 'Requires Bronze Axe' });
  });

  it('explains the age-up building rule and marks passed ages researched', () => {
    const short = techTreeModel(start({ ageBuildings: 1 }));
    expect(find(short, 'townAge')).toMatchObject({ state: 'locked', reason: 'Requires 2 Village Age buildings (1/2)' });
    expect(find(short, 'cityAge').reason).toBe('Requires Town Age');
    const ready = techTreeModel(start({ ageBuildings: 2 }));
    expect(find(ready, 'townAge').state).toBe('available');
    const town = techTreeModel(start({ age: 1 }));
    expect(find(town, 'townAge').state).toBe('done');
  });

  it('locks units by age and by their training building', () => {
    const tree = techTreeModel(start());
    expect(find(tree, 'villager')).toMatchObject({ state: 'done', source: 'Trained at Town Center' });
    expect(find(tree, 'hoplite')).toMatchObject({ state: 'locked', reason: 'Requires Barracks' });
    expect(find(tree, 'archer')).toMatchObject({ state: 'locked', reason: 'Requires Town Age' });
    const built = techTreeModel(start({ built: new Set<BuildingKind>(['townCenter', 'barracks']) }));
    expect(find(built, 'hoplite').state).toBe('done');
  });

  it('shows what unlocks what: buildings, prerequisites and line upgrades', () => {
    const tree = techTreeModel(start());
    expect(find(tree, 'barracks').unlocks).toEqual(expect.arrayContaining(['Hoplite', 'Veteran Hoplites']));
    expect(find(tree, 'barracks').unlocks).toContain(UNITS.phalangiteGuard.name);
    expect(find(tree, 'bronzeAxe').unlocks).toContain('Iron Axe');
    expect(find(tree, 'townAge').unlocks[0]).toBe('the Town Age');
    expect(find(tree, 'hoplite').unlocks).toEqual(['Upgrades to Veteran Hoplite', 'Upgrades to Phalangite', 'Upgrades to Silver Shield']);
    expect(find(tree, 'veteranHoplite').unlocks).toEqual(['Phalangites', 'Hoplite line → Veteran Hoplite']);
    expect(find(tree, 'guardTower').unlocks).toContain('Watch Tower → Guard Tower');
    expect(find(tree, 'ironAxe').source).toBe(`Researched at ${BUILDINGS[TECHS.ironAxe.at].name}`);
  });

  it('locks buildings from a later age and marks owned ones built', () => {
    const tree = techTreeModel(start());
    expect(find(tree, 'townCenter')).toMatchObject({ state: 'done', badge: 'Built' });
    expect(find(tree, 'storehouse')).toMatchObject({ state: 'available' });
    expect(find(tree, 'academy')).toMatchObject({ state: 'locked', reason: 'Requires City Age' });
  });
});
