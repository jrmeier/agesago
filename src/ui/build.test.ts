import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../core/buildings';
import type { Stockpile } from '../core/types';
import {
  BUILD_HOTKEYS,
  buildableKinds,
  buildingRole,
  canAfford,
  constructionLabel,
  costEntries,
  formatCost,
  keyLabel,
  kindForKey,
  missingResources,
  placementVerdict,
  popLabel,
  shortfallText,
} from './build';

const stock = (s: Partial<Stockpile>): Stockpile => ({ food: 0, wood: 0, gold: 0, stone: 0, ...s });

describe('build costs', () => {
  it('formats costs in display order and skips zeroes', () => {
    expect(formatCost({ wood: 60 })).toBe('60 wood');
    expect(formatCost({ stone: 100, wood: 275 })).toBe('275 wood · 100 stone');
    expect(formatCost({ wood: 0 })).toBe('Free');
    expect(costEntries({ gold: 5, food: 10 })).toEqual([
      { type: 'food', amount: 10 },
      { type: 'gold', amount: 5 },
    ]);
  });

  it('checks affordability and names what is missing', () => {
    expect(canAfford({ wood: 30 }, stock({ wood: 30 }))).toBe(true);
    expect(canAfford({ wood: 30 }, stock({ wood: 29 }))).toBe(false);
    expect(missingResources({ wood: 275, stone: 100 }, stock({ wood: 300 }))).toEqual(['stone']);
    expect(shortfallText(['wood'])).toBe('Not enough wood');
    expect(shortfallText(['wood', 'stone'])).toBe('Not enough wood and stone');
    expect(shortfallText(['food', 'wood', 'stone'])).toBe('Not enough food, wood and stone');
    expect(shortfallText([])).toBe('');
  });
});

describe('build hotkeys', () => {
  const reserved = ['KeyA', 'KeyT', 'KeyE', 'KeyF', 'KeyR', 'KeyW', 'KeyD', 'Period', 'Home', 'Escape'];

  it('gives every buildable kind a unique key that clashes with nothing else', () => {
    const kinds = buildableKinds();
    expect(kinds).toEqual(['house', 'storehouse', 'miningCamp', 'granary', 'farm']);
    const keys = kinds.map((k) => BUILD_HOTKEYS[k]);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(reserved).not.toContain(k);
  });

  it('maps keys back to kinds and labels them', () => {
    expect(kindForKey('KeyH')).toBe('house');
    expect(kindForKey('KeyP')).toBe('farm');
    expect(kindForKey('KeyT')).toBeNull();
    expect(keyLabel('KeyH')).toBe('H');
    expect(keyLabel(undefined)).toBe('');
  });

  it('only lists kinds flagged buildable', () => {
    expect(buildableKinds(BUILDINGS)).not.toContain('townCenter');
  });
});

describe('placement verdict', () => {
  const cost = { wood: 30 };

  it('is ok when the world allows it and it is affordable', () => {
    expect(placementVerdict({ ok: true }, cost, stock({ wood: 30 }))).toEqual({ ok: true, text: '' });
  });

  it('names the missing resource even if the world check is a stub', () => {
    expect(placementVerdict({ ok: true }, cost, stock({ wood: 5 }))).toEqual({ ok: false, text: 'Not enough wood' });
    expect(placementVerdict({ ok: false, reason: 'insufficient-resources' }, cost, stock({}))).toEqual({
      ok: false,
      text: 'Not enough wood',
    });
  });

  it('explains terrain problems', () => {
    expect(placementVerdict({ ok: false, reason: 'occupied' }, cost, stock({ wood: 99 })).text).toBe('Blocked');
    expect(placementVerdict({ ok: false, reason: 'unexplored' }, cost, stock({ wood: 99 })).text).toBe('Unexplored');
    expect(placementVerdict({ ok: false, reason: 'water' }, cost, stock({ wood: 99 })).text).toMatch(/water/);
    expect(placementVerdict({ ok: false }, cost, stock({ wood: 99 })).ok).toBe(false);
  });

  it('prefers the terrain reason over the cost when both apply', () => {
    expect(placementVerdict({ ok: false, reason: 'slope' }, cost, stock({})).text).toBe('Too steep');
  });
});

describe('building panel labels', () => {
  it('shows construction progress, roles and population', () => {
    expect(constructionLabel(0.426)).toBe('Under construction 42%');
    expect(constructionLabel(1.2)).toBe('Under construction 100%');
    expect(buildingRole('house')).toBe('+5 population');
    expect(buildingRole('miningCamp')).toBe('Drop site: gold, stone');
    expect(buildingRole('farm', 180.6, 250)).toBe('Food 180/250');
    expect(buildingRole('farm', 0, 250)).toMatch(/reseed/);
    expect(popLabel(7, 10)).toBe('7/10');
  });
});
