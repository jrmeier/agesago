import { describe, expect, it } from 'vitest';
import type { MapLayout } from '../core/types';
import { GRASS_ONLY } from '../core/types';
import { HERO_COOLDOWN } from '../core/units';
import { killUnit } from '../sim/systems/combat';
import { defaultPlayers, World } from '../sim/World';
import { clockText, heroDeathText, heroLockText, heroSlot, heroTileNote } from './heroes';
import { allHotkeys, hotkeyClashes } from '../input/hotkeys';
import { hotkeyGlyph } from './hotkeyHelp';

function world(): World {
  const layout: MapLayout = { townCenter: { x: 4, z: 4 }, villagers: [], scouts: [], props: [], nodes: [] };
  return new World({
    width: 60, depth: 60, heightAt: () => 0.5, isWater: () => false, isWalkable: () => true,
    forestDensity: () => 0, ground: () => GRASS_ONLY,
  }, layout, defaultPlayers(1, ['romans']));
}

describe('hero HUD helpers (M16-6)', () => {
  it('formats the cooldown clock, rounding up', () => {
    expect(clockText(HERO_COOLDOWN)).toBe('2:00');
    expect(clockText(65)).toBe('1:05');
    expect(clockText(0.2)).toBe('0:01');
    expect(clockText(0)).toBe('0:00');
  });

  it('describes the aura on the train tile and the death toast', () => {
    expect(heroTileNote('scipio')).toContain('Drilled Legions');
    expect(heroTileNote('scipio')).toContain('20% faster');
    expect(heroDeathText('cyrus')).toBe('Cyrus has fallen! A new hero can be trained in 2:00.');
  });

  it('tracks the slot and lock text through life, death and cooldown', () => {
    const w = world();
    expect(heroSlot(w, 1)).toEqual({ state: 'none' });
    expect(heroLockText(w, 1, 'scipio')).toBe('');
    const hero = w.spawnUnit('scipio', { x: 30, z: 30 }, 1);
    hero.hp = hero.maxHp / 2;
    expect(heroSlot(w, 1)).toEqual({ state: 'alive', id: hero.id, kind: 'scipio', hp: 0.5 });
    expect(heroLockText(w, 1, 'scipio')).toBe('Your hero is already in the field');
    expect(heroLockText(w, 1, 'praetorian')).toBe('');
    killUnit(w, hero);
    w.time += 30;
    expect(heroSlot(w, 1)).toEqual({ state: 'cooldown', left: HERO_COOLDOWN - 30 });
    expect(heroLockText(w, 1, 'scipio')).toBe('Ready in 1:30');
    w.time += HERO_COOLDOWN;
    expect(heroSlot(w, 1)).toEqual({ state: 'none' });
  });

  it('binds ; to the hero without clashing', () => {
    expect(allHotkeys()).toContainEqual({ code: 'Semicolon', action: 'hero' });
    expect(hotkeyClashes()).toEqual([]);
    expect(hotkeyGlyph('Semicolon')).toBe(';');
  });
});
