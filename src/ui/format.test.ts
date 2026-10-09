import { describe, expect, it } from 'vitest';
import { groupStatus, statusLabel, trainLabel, unitName } from './format';

describe('HUD labels', () => {
  it('names the selection', () => {
    expect(unitName(1)).toBe('Villager');
    expect(unitName(4)).toBe('4 Villagers');
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
    expect(trainLabel(0, 0, 8, 50)).toBe('50 🍖 · T');
    expect(trainLabel(1, 4, 8, 50)).toBe('Training 50%');
    expect(trainLabel(3, 2, 8, 50)).toBe('Training 25% · +2 queued');
  });
});
