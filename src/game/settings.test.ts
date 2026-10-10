import { describe, expect, it } from 'vitest';
import { qualityTier } from '../core/quality';
import { mixGain } from './audioBus';
import {
  bindSettingsStore,
  bootQuality,
  defaultSettings,
  initSettings,
  parseStored,
  persistable,
  replaceSettings,
  resolveSettings,
  SETTINGS_KEY,
  tierToggles,
} from './settings';

const detected = qualityTier('high');

describe('settings', () => {
  it('starts from the device tier and the reduced-motion preference', () => {
    const resolved = resolveSettings({ stored: null, search: '', detected, reducedMotion: true });
    expect(resolved.fresh).toBe(true);
    expect(resolved.graphicsLocked).toBe(false);
    expect(resolved.settings).toMatchObject({
      quality: 'auto',
      shadows: true,
      grass: true,
      water: true,
      uiScale: 1,
      edgeScroll: true,
      edgeSpeed: 1,
      invertPan: false,
      master: 0.8,
      music: 0.7,
      sfx: 0.8,
      colorblind: false,
      reducedMotion: true,
    });
  });

  it('restores a save and snaps odd scales onto the steps', () => {
    const raw = JSON.stringify({ ...defaultSettings(detected, false), uiScale: 1.2, edgeSpeed: 1.7, master: 2, invertPan: true });
    const parsed = parseStored(raw, detected, false);
    expect(parsed?.uiScale).toBe(1.15);
    expect(parsed?.edgeSpeed).toBe(1.5);
    expect(parsed?.master).toBe(1);
    expect(parsed?.invertPan).toBe(true);
    expect(parseStored('not json', detected, false)).toBeNull();
  });

  it('lets ?quality= own graphics without writing that tier back', () => {
    const stored = { ...defaultSettings(detected, false), quality: 'high' as const, uiScale: 1.3 };
    const resolved = resolveSettings({
      stored: JSON.stringify(stored),
      search: '?quality=low',
      detected,
      reducedMotion: false,
    });
    expect(resolved.graphicsLocked).toBe(true);
    expect(resolved.settings.quality).toBe('low');
    expect(resolved.settings.shadows).toBe(false);
    expect(resolved.settings.grass).toBe(false);
    expect(resolved.settings.uiScale).toBe(1.3);
    const booted = bootQuality(resolved.settings, detected, '?quality=low');
    expect(booted.tier).toBe('low');
    expect(booted.grassDensity).toBe(0);
    expect(booted.pixelRatio).toBe(1);
    const written = persistable({ ...resolved.settings, uiScale: 1.15 }, stored, detected, false, true);
    expect(written.quality).toBe('high');
    expect(written.shadows).toBe(true);
    expect(written.grass).toBe(true);
    expect(written.uiScale).toBe(1.15);
  });

  it('a saved low tier with grass on still boots grass', () => {
    const settings = {
      ...defaultSettings(qualityTier('low'), false),
      quality: 'low' as const,
      grass: true,
      shadows: false,
      water: false,
    };
    const booted = bootQuality(settings, qualityTier('low'), '');
    expect(booted.tier).toBe('low');
    expect(booted.grassDensity).toBeGreaterThan(0);
    expect(booted.shadows).toBe(false);
    expect(booted.fancyWater).toBe(false);
  });

  it('changing the tier resets the three toggles to that tier', () => {
    expect(tierToggles('low', detected)).toEqual({ shadows: false, grass: false, water: false });
    expect(tierToggles('high', detected)).toEqual({ shadows: true, grass: true, water: true });
    expect(tierToggles('auto', detected).shadows).toBe(true);
  });

  it('writes only after a change', () => {
    const mem = new Map<string, string>();
    bindSettingsStore({
      getItem: (key) => mem.get(key) ?? null,
      setItem: (key, value) => {
        mem.set(key, value);
      },
    });
    initSettings({ stored: null, search: '', detected, reducedMotion: false });
    expect(mem.has(SETTINGS_KEY)).toBe(false);
    replaceSettings({ ...defaultSettings(detected, false), invertPan: true, edgeScroll: false });
    const saved = JSON.parse(mem.get(SETTINGS_KEY) ?? '{}') as { invertPan: boolean; edgeScroll: boolean };
    expect(saved.invertPan).toBe(true);
    expect(saved.edgeScroll).toBe(false);
    bindSettingsStore(null);
  });
});

describe('mixGain', () => {
  it('multiplies master and channel and clamps', () => {
    expect(mixGain(0.5, 0.5)).toBeCloseTo(0.25);
    expect(mixGain(2, -1)).toBe(0);
  });
});
