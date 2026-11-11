import { describe, expect, it } from 'vitest';
import { auraChips } from './auras';

describe('aura chips', () => {
  it('name each active aura with its source icon and description', () => {
    expect(auraChips(['templeHealing', 'townCenterWork'])).toEqual([
      { id: 'templeHealing', icon: '#i-b-temple', name: 'Healing Grounds', title: expect.stringContaining('1 HP per second') },
      { id: 'townCenterWork', icon: '#i-b-townCenter', name: 'Town Center Bustle', title: expect.stringContaining('5% faster') },
    ]);
    expect(auraChips([])).toEqual([]);
  });
});
