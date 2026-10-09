import { describe, expect, it } from 'vitest';
import { trainable } from '../core/units';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind } from '../core/types';
import { GROUP_KEYS, HOTKEYS, TRAIN_SLOT_KEYS, allHotkeys, groupForKey, hotkeyClashes } from './hotkeys';

describe('hotkeys', () => {
  it('binds every RTS key to exactly one action', () => {
    expect(hotkeyClashes()).toEqual([]);
  });

  it('reports a clash when two actions share a key', () => {
    expect(hotkeyClashes([...allHotkeys(), { code: 'KeyQ', action: 'oops' }])).toEqual(['KeyQ: attackMove / oops']);
  });

  it('keeps attack-move off A (select-all) and stop off the build keys', () => {
    expect(HOTKEYS.attackMove).not.toBe(HOTKEYS.selectAll);
    expect(HOTKEYS.attackMove).toBe('KeyQ');
    expect(HOTKEYS.stop).toBe('KeyX');
  });

  it('has a slot key for every unit any building trains', () => {
    const most = Math.max(...(Object.keys(BUILDINGS) as BuildingKind[]).map((k) => trainable(k).length));
    expect(TRAIN_SLOT_KEYS.length).toBeGreaterThanOrEqual(most);
  });

  it('maps digit and numpad keys to groups 1–9', () => {
    expect(GROUP_KEYS).toHaveLength(9);
    expect(groupForKey('Digit1')).toBe(1);
    expect(groupForKey('Numpad9')).toBe(9);
    expect(groupForKey('Digit0')).toBe(0);
    expect(groupForKey('KeyA')).toBe(0);
  });
});
