import { describe, expect, it } from 'vitest';
import type { Stockpile } from '../core/types';
import { UNITS } from '../core/units';
import { portraitKind, selectionName } from './format';
import {
  canTrainAt,
  combatChips,
  hpLabel,
  isMilitary,
  kindCounts,
  kindForSlotKey,
  queueView,
  sharedStance,
  totalHp,
  trainBatch,
  trainEntries,
} from './military';

const stock = (s: Partial<Stockpile>): Stockpile => ({ food: 0, wood: 0, gold: 0, stone: 0, ...s });

describe('selection summaries', () => {
  it('lists counts per kind for mixed selections', () => {
    expect(selectionName(['hoplite', 'archer', 'hoplite', 'hoplite', 'archer', 'hoplite'])).toBe('4 Hoplites, 2 Archers');
    expect(selectionName(['swordsman', 'swordsman'])).toBe('2 Swordsmen');
    expect(selectionName(['horseman'])).toBe('Horseman');
    expect(kindCounts(['archer', 'hoplite', 'hoplite'])).toEqual([
      ['hoplite', 2],
      ['archer', 1],
    ]);
  });

  it('shows the most common kind’s portrait', () => {
    expect(portraitKind(['archer', 'hoplite', 'archer'])).toBe('archer');
    expect(portraitKind(['villager', 'horseman'])).toBe('villager');
  });

  it('sums hit points and labels them', () => {
    expect(totalHp([{ hp: 20, maxHp: 55 }, { hp: -3, maxHp: 30 }])).toEqual({ hp: 20, maxHp: 85 });
    expect(hpLabel(41.2, 55)).toBe('HP 42/55');
  });

  it('gives melee soldiers attack + armour chips and ranged ones a range chip', () => {
    const hop = combatChips(UNITS.hoplite);
    expect(hop.map((c) => c.icon)).toEqual(['#i-st-melee', '#i-st-armor']);
    expect(hop[0].text).toBe('5');
    expect(hop[0].title).toContain('+12 vs cavalry');
    expect(hop[1].text).toBe('1/1');
    const arch = combatChips(UNITS.archer);
    expect(arch.map((c) => c.icon)).toEqual(['#i-st-pierce', '#i-st-armor', '#i-st-range']);
    expect(arch[2].text).toBe('7');
  });

  it('knows soldiers from civilians and the shared stance', () => {
    expect(isMilitary('villager')).toBe(false);
    expect(isMilitary('scout')).toBe(false);
    expect(isMilitary('slinger')).toBe(true);
    expect(sharedStance([{ stance: 'defensive' }, { stance: 'defensive' }])).toBe('defensive');
    expect(sharedStance([{ stance: 'defensive' }, { stance: 'passive' }])).toBeNull();
    expect(sharedStance([])).toBeNull();
  });
});

describe('training panel', () => {
  it('lists what a building trains with slot keys and affordability', () => {
    const e = trainEntries('barracks', stock({ food: 60, wood: 30 }));
    expect(e.map((x) => x.kind)).toEqual(['hoplite', 'swordsman']);
    expect(e.map((x) => x.key)).toEqual(['KeyZ', 'KeyC']);
    expect(e.map((x) => x.affordable)).toEqual([true, false]);
    expect(trainEntries('house', stock({}))).toEqual([]);
  });

  it('maps slot keys to units per building', () => {
    expect(kindForSlotKey('archeryRange', 'KeyC')).toBe('archer');
    expect(kindForSlotKey('townCenter', 'KeyC')).toBeNull();
    expect(kindForSlotKey('stable', 'KeyQ')).toBeNull();
  });

  it('only complete trainers get a panel; shift queues five', () => {
    expect(canTrainAt({ kind: 'stable', complete: true })).toBe(true);
    expect(canTrainAt({ kind: 'stable', complete: false })).toBe(false);
    expect(canTrainAt({ kind: 'granary', complete: true })).toBe(false);
    expect(trainBatch(true)).toBe(5);
    expect(trainBatch(false)).toBe(1);
  });

  it('shows the queue head first with its progress', () => {
    const v = queueView({ kind: 'barracks', queue: 2, queueKinds: ['swordsman', 'hoplite'], progress: 7 });
    expect(v.kinds).toEqual(['swordsman', 'hoplite']);
    expect(v.head).toBeCloseTo(7 / UNITS.swordsman.trainTime);
    // Older sims without queueKinds: assume the default unit.
    expect(queueView({ kind: 'townCenter', queue: 2, progress: 0 }).kinds).toEqual(['villager', 'villager']);
    expect(queueView({ kind: 'townCenter', queue: 0, progress: 0 })).toEqual({ kinds: [], head: 0 });
  });
});
