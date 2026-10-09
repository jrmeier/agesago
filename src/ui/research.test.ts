import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { TECHS, type TechId } from '../core/techs';
import type { Stockpile } from '../core/types';
import { UNITS } from '../core/units';
import {
  ageLockText,
  agedUpText,
  deltaText,
  lockText,
  queueItems,
  researchLabel,
  researchedText,
  techEntries,
  techTip,
  techsNewAt,
  timeLabel,
  upgradedBuildingChips,
  upgradedUnitChips,
  visibleTechs,
  withDelta,
  type TechView,
} from './research';

const stock = (s: Partial<Stockpile> = {}): Stockpile => ({ food: 0, wood: 0, gold: 0, stone: 0, ...s });
const view = (v: Partial<TechView> = {}): TechView => ({
  age: 0,
  researched: new Set<TechId>(),
  queued: new Set<TechId>(),
  stock: stock({ food: 9999, wood: 9999, gold: 9999, stone: 9999 }),
  ageBuildings: 0,
  ...v,
});

describe('lock reasons', () => {
  it('names the age, the missing tech, the age-up buildings and the short resource', () => {
    expect(lockText('ironAxe', 'age', view())).toBe('Requires Town Age');
    expect(lockText('veteranHoplite', 'age', view())).toBe('Requires City Age');
    expect(lockText('ironAxe', 'requires', view({ age: 1 }))).toBe('Requires Bronze Axe');
    expect(lockText('townAge', 'requires', view({ ageBuildings: 1 }))).toBe('Requires 2 Village Age buildings (1/2)');
    expect(lockText('cityAge', 'requires', view({ age: 1 }))).toBe('Requires 2 Town Age buildings (0/2)');
    expect(lockText('cityAge', 'insufficient-resources', view({ age: 1, stock: stock({ food: TECHS.cityAge.cost.food! }) }))).toBe('Not enough gold');
    expect(lockText('bronzeAxe', 'insufficient-resources', view({ stock: stock() }))).toBe('Not enough food and wood');
    expect(lockText('bronzeAxe', 'researched', view({ queued: new Set<TechId>(['bronzeAxe']) }))).toBe('Queued');
    expect(lockText('bronzeAxe', 'busy', view())).toBe('Already advancing an age');
    expect(lockText('bronzeAxe', null, view())).toBe('');
  });

  it('greys build and train kinds from a later age', () => {
    expect(ageLockText(BUILDINGS.forge.age, 0)).toBe('Requires Town Age');
    expect(ageLockText(BUILDINGS.academy.age, 1)).toBe('Requires City Age');
    expect(ageLockText(BUILDINGS.academy.age, 2)).toBe('');
    expect(ageLockText(BUILDINGS.house.age, 0)).toBe('');
    expect(ageLockText(UNITS.archer.age, 0)).toBe('Requires Town Age');
  });
});

describe('which techs a building lists', () => {
  it('shows the next age-up only and hides researched or queued techs', () => {
    expect(visibleTechs('townCenter', view())).toContain('townAge');
    expect(visibleTechs('townCenter', view())).not.toContain('cityAge');
    expect(visibleTechs('townCenter', view({ age: 1, researched: new Set<TechId>(['townAge']) }))).toContain('cityAge');
    expect(visibleTechs('townCenter', view({ queued: new Set<TechId>(['townAge']) }))).not.toContain('townAge');
  });

  it('shows a chained tech once its predecessor is researched or queued', () => {
    expect(visibleTechs('storehouse', view())).toEqual(['bronzeAxe']);
    expect(visibleTechs('storehouse', view({ queued: new Set<TechId>(['bronzeAxe']) }))).toEqual(['ironAxe']);
    expect(visibleTechs('storehouse', view({ researched: new Set<TechId>(['bronzeAxe']) }))).toEqual(['ironAxe']);
  });

  it('marks hard locks and unaffordable tiles with a reason', () => {
    const entries = techEntries('storehouse', view({ queued: new Set<TechId>(['bronzeAxe']) }), () => 'requires');
    expect(entries).toEqual([
      expect.objectContaining({ tech: 'ironAxe', locked: true, unaffordable: false, reason: 'Requires Bronze Axe' }),
    ]);
    const poor = techEntries('storehouse', view({ stock: stock({ food: 100 }) }), () => 'insufficient-resources');
    expect(poor[0]).toMatchObject({ tech: 'bronzeAxe', locked: false, unaffordable: true, reason: 'Not enough wood' });
    expect(techEntries('storehouse', view(), () => null)[0]).toMatchObject({ locked: false, unaffordable: false, reason: '' });
  });

  it('lists techs that open at an age (for the "new" pip), never age-ups', () => {
    expect(techsNewAt(1)).toContain('ironAxe');
    expect(techsNewAt(1)).not.toContain('bronzeAxe');
    expect(techsNewAt(1)).not.toContain('cityAge');
  });
});

describe('queue strip', () => {
  it('puts research first, then units, with the head progress of whatever runs', () => {
    const b = {
      kind: 'townCenter' as const,
      queue: 2,
      queueKinds: ['villager' as const, 'villager' as const],
      progress: 3,
      research: ['wovenTunics' as TechId, 'census' as TechId],
      researchProgress: 5,
    };
    const q = queueItems(b);
    expect(q.items).toEqual([
      { type: 'tech', tech: 'wovenTunics', index: 0 },
      { type: 'tech', tech: 'census', index: 1 },
      { type: 'unit', unit: 'villager', index: 0 },
      { type: 'unit', unit: 'villager', index: 1 },
    ]);
    expect(q.head).toBeCloseTo(5 / 25);
    const units = queueItems({ ...b, research: undefined, researchProgress: undefined });
    expect(units.items.map((i) => i.type)).toEqual(['unit', 'unit']);
    expect(units.head).toBeCloseTo(3 / UNITS.villager.trainTime);
    expect(queueItems({ ...b, queue: 0, queueKinds: [], research: undefined }).items).toEqual([]);
  });
});

describe('labels', () => {
  it('formats times, progress, toasts and the banner', () => {
    expect(timeLabel(25)).toBe('25s');
    expect(timeLabel(90)).toBe('1m 30s');
    expect(timeLabel(120)).toBe('2m');
    expect(researchLabel('bronzeAxe', 10, 1)).toBe('Researching Bronze Axe 40%');
    expect(researchLabel('townAge', 30, 2)).toBe('Advancing to the Town Age 50% (+1)');
    expect(researchedText('ironAxe')).toBe('Iron Axe researched');
    expect(agedUpText(1)).toBe('Entered the Town Age');
    expect(techTip('bronzeAxe', '100 food · 50 wood')).toBe(`Bronze Axe: ${TECHS.bronzeAxe.description} 100 food · 50 wood · ${TECHS.bronzeAxe.time}s.`);
    expect(techTip('ironAxe', '200 food', 'Requires Town Age')).toMatch(/Requires Town Age\.$/);
  });
});

describe('stat deltas', () => {
  it('formats the upgrade on top of the base', () => {
    expect(withDelta(7, 5)).toBe('7 (+2)');
    expect(withDelta(5, 5)).toBe('5');
    expect(withDelta(1.15, 1)).toBe('1.2 (+0.2)');
    expect(deltaText(4, 5)).toBe('−1');
    expect(deltaText(5, 5)).toBe('');
  });

  it('shows unit chips with deltas from the stat function', () => {
    const plusTwo = (stat: string, base: number) => (stat === 'attack.melee' ? base + 2 : stat === 'armor.pierce' ? base + 1 : base);
    const chips = upgradedUnitChips(UNITS.hoplite, plusTwo);
    expect(chips[0].text).toBe(`${UNITS.hoplite.attack.melee + 2} (+2)`);
    expect(chips[0].title).toContain('(+2)');
    expect(chips[1].text).toBe(`${UNITS.hoplite.armor.melee}/${UNITS.hoplite.armor.pierce + 1} (+0/+1)`);
    const plain = upgradedUnitChips(UNITS.archer, (_s, base) => base);
    expect(plain.map((c) => c.text)).toEqual([
      String(UNITS.archer.attack.pierce),
      `${UNITS.archer.armor.melee}/${UNITS.archer.armor.pierce}`,
      String(UNITS.archer.range),
    ]);
  });

  it('shows tower chips with deltas, and nothing for buildings that do not shoot', () => {
    const t = BUILDINGS.watchTower;
    const chips = upgradedBuildingChips(t, (stat, base) => (stat === 'attack.pierce' || stat === 'range' ? base + 1 : base));
    expect(chips.map((c) => c.text)).toEqual([
      `${t.attack!.pierce + 1} (+1)`,
      `${t.armor.melee}/${t.armor.pierce}`,
      `${t.attack!.range + 1} (+1)`,
    ]);
    expect(upgradedBuildingChips(BUILDINGS.house, (_s, b) => b)).toEqual([]);
  });
});
