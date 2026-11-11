import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import { auraRingRadius } from './auraRings';

describe('aura range rings', () => {
  it('surround aura sources at their reach from the footprint edge', () => {
    expect(auraRingRadius({ building: 'temple' })).toBe(6 + Math.max(BUILDINGS.temple.size.w, BUILDINGS.temple.size.d) / 2);
    expect(auraRingRadius({ building: 'townCenter' })).toBe(10 + BUILDINGS.townCenter.size.w / 2);
  });

  it('draw nothing for entities without auras', () => {
    expect(auraRingRadius({ building: 'house' })).toBe(0);
    expect(auraRingRadius({ unit: 'villager' })).toBe(0);
  });
});
