import { describe, expect, it } from 'vitest';
import { allHotkeys } from '../input/hotkeys';
import { hotkeyGlyph, hotkeyHelpRows } from './hotkeyHelp';

describe('hotkey reference', () => {
  it('prints the keys a player sees', () => {
    expect(hotkeyGlyph('KeyH')).toBe('H');
    expect(hotkeyGlyph('Digit3')).toBe('3');
    expect(hotkeyGlyph('Comma')).toBe(',');
    expect(hotkeyGlyph('Period')).toBe('.');
    expect(hotkeyGlyph('Escape')).toBe('Esc');
    expect(hotkeyGlyph('Slash')).toBe('?');
  });

  it('lists every bound key once, with a readable label', () => {
    const rows = hotkeyHelpRows();
    const bound = rows.filter((row) => row.action);
    const actions = allHotkeys().map((entry) => entry.action);
    expect(bound.map((row) => row.action).sort()).toEqual([...actions].sort());
    expect(new Set(bound.map((row) => row.action)).size).toBe(actions.length);
    for (const row of rows) {
      expect(row.keys.length).toBeGreaterThan(0);
      expect(row.label.length).toBeGreaterThan(0);
    }
    expect(rows.some((row) => row.label.startsWith('Build a House'))).toBe(true);
    expect(rows.some((row) => row.keys === 'U' && row.label.includes('Town bell'))).toBe(true);
  });
});
