import { describe, expect, it } from 'vitest';
import {
  explorerIds,
  exploredLabel,
  formatCount,
  groupStatus,
  portraitKind,
  selectionName,
  showExplore,
  statusLabel,
  trainLabel,
  trainProgress,
  unitName,
} from './format';

describe('HUD labels', () => {
  it('names the selection', () => {
    expect(unitName(1)).toBe('Villager');
    expect(unitName(4)).toBe('4 Villagers');
  });

  it('names mixed selections of villagers and scouts', () => {
    expect(selectionName(['villager'])).toBe('Villager');
    expect(selectionName(['scout'])).toBe('Scout');
    expect(selectionName(['scout', 'scout'])).toBe('2 Scouts');
    expect(selectionName(['villager', 'scout', 'villager', 'villager'])).toBe('3 Villagers, 1 Scout');
    expect(selectionName(['scout', 'villager', 'scout'])).toBe('1 Villager, 2 Scouts');
    expect(selectionName(['villager', 'villager'])).toBe('2 Villagers');
  });

  it('picks the portrait of the larger group', () => {
    expect(portraitKind(['scout'])).toBe('scout');
    expect(portraitKind(['villager', 'scout'])).toBe('villager');
    expect(portraitKind(['scout', 'scout', 'villager'])).toBe('scout');
    expect(portraitKind([])).toBe('villager');
  });

  it('shows Explore only for selections that can explore', () => {
    expect(showExplore([])).toBe(false);
    expect(showExplore([{ kind: 'scout' }])).toBe(true);
    expect(showExplore([{ kind: 'villager' }, { kind: 'scout' }])).toBe(true);
    expect(explorerIds([{ id: 4, kind: 'scout' }, { id: 2, kind: 'villager' }])).toEqual([4, 2]);
  });

  it('labels exploring units and the explored share', () => {
    expect(statusLabel({ state: 'exploring', carry: null, gatherType: null }, 10)).toBe('Exploring');
    const explore = { state: 'exploring' as const, carry: null, gatherType: null };
    const idle = { state: 'idle' as const, carry: null, gatherType: null };
    expect(groupStatus([explore, explore, idle], 10)).toBe('2 exploring, 1 idle');
    expect(exploredLabel(0)).toBe('Explored 0%');
    expect(exploredLabel(0.0749)).toBe('Explored 7%');
    expect(exploredLabel(0.29)).toBe('Explored 29%');
    expect(exploredLabel(0.999)).toBe('Explored 99%');
    expect(exploredLabel(1)).toBe('Explored 100%');
    expect(exploredLabel(1.4)).toBe('Explored 100%');
  });

  it('describes state and carry', () => {
    expect(statusLabel({ state: 'idle', carry: null, gatherType: null }, 10)).toBe('Idle');
    expect(statusLabel({ state: 'gathering', carry: { type: 'wood', amount: 6 }, gatherType: 'wood' }, 10)).toBe(
      'Chopping wood (6/10)'
    );
    expect(statusLabel({ state: 'gathering', carry: null, gatherType: 'gold' }, 10)).toBe('Mining gold (0/10)');
    expect(statusLabel({ state: 'toDrop', carry: { type: 'gold', amount: 10 }, gatherType: 'gold' }, 10)).toBe(
      'Carrying gold (10)'
    );
    expect(statusLabel({ state: 'toNode', carry: null, gatherType: 'food' }, 10)).toBe('Going for food');
    expect(statusLabel({ state: 'moving', carry: null, gatherType: null }, 10)).toBe('Moving');
  });

  it('summarises groups', () => {
    const idle = { state: 'idle' as const, carry: null, gatherType: null };
    const chop = { state: 'gathering' as const, carry: { type: 'wood' as const, amount: 3 }, gatherType: 'wood' as const };
    expect(groupStatus([idle, idle], 10)).toBe('Idle');
    expect(groupStatus([chop, idle, chop], 10)).toBe('2 chopping wood, 1 idle');
    expect(groupStatus([chop], 10)).toBe('Chopping wood (3/10)');
  });

  it('shows training progress', () => {
    expect(trainLabel(0, 0, 8, 50)).toBe('50 food · T');
    expect(trainLabel(1, 4, 8, 50)).toBe('Training 50%');
    expect(trainLabel(3, 2, 8, 50)).toBe('Training 25% · +2 queued');
    expect(trainLabel(1, 8, 8, 50)).toBe('Training 99%');
  });

  it('drops the keyboard hint on touch', () => {
    expect(trainLabel(0, 0, 8, 50, true)).toBe('50 food');
    expect(trainLabel(0, 0, 8, 50, true)).not.toContain('T');
    expect(trainLabel(2, 2, 8, 50, true)).toBe('Training 25% · +1 queued');
  });

  it('drives the progress ring', () => {
    expect(trainProgress(0, 5, 8)).toBe(0);
    expect(trainProgress(1, 2, 8)).toBe(0.25);
    expect(trainProgress(1, 9, 8)).toBe(0.99);
    expect(trainProgress(1, 2, 0)).toBe(0);
  });

  it('formats stockpile numbers', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(49.9)).toBe('49');
    expect(formatCount(-3)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1250)).toBe('1,250');
    expect(formatCount(9999)).toBe('9,999');
    expect(formatCount(12_345)).toBe('12.3k');
    expect(formatCount(99_999)).toBe('99.9k');
    expect(formatCount(123_456)).toBe('123k');
    expect(formatCount(999_999)).toBe('999k');
    expect(formatCount(1_250_000)).toBe('1.2M');
  });
});
