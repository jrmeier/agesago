import { deviceQuality, qualityTier, type Quality, type QualityTier } from '../core/quality';
import { PLAYER_COLORS } from '../sim/World';

/** localStorage key. Written only after the player changes a setting. */
export const SETTINGS_KEY = 'agesago-settings';

export type QualityChoice = 'auto' | QualityTier;

export interface Settings {
  quality: QualityChoice;
  shadows: boolean;
  grass: boolean;
  water: boolean;
  uiScale: number;
  edgeScroll: boolean;
  edgeSpeed: number;
  invertPan: boolean;
  master: number;
  music: number;
  sfx: number;
  colorblind: boolean;
  reducedMotion: boolean;
}

export interface SettingsEnv {
  stored: string | null;
  search: string;
  detected: Quality;
  reducedMotion: boolean;
}

export interface ResolvedSettings {
  settings: Settings;
  /** `?quality=` owns graphics for this visit. Those fields are not written back. */
  graphicsLocked: boolean;
  /** Nothing was saved yet. */
  fresh: boolean;
}

const UI_SCALES = [0.85, 1, 1.15, 1.3];
const EDGE_SPEEDS = [0.5, 1, 1.5, 2];

/** Okabe–Ito, four player slots. Distinct for the common colour-vision deficiencies. */
export const COLORBLIND_COLORS = [0x0072b2, 0xe69f00, 0x009e73, 0xcc79a7] as const;

export function paletteColor(index: number, colorblind: boolean): number {
  const palette = colorblind ? COLORBLIND_COLORS : PLAYER_COLORS;
  return palette[index % palette.length] ?? palette[0];
}

export function paintPlayerColors(players: Iterable<{ color: number }>, colorblind: boolean): void {
  let i = 0;
  for (const player of players) {
    player.color = paletteColor(i, colorblind);
    i += 1;
  }
}

export function defaultSettings(detected: Quality, reducedMotion: boolean): Settings {
  return {
    quality: 'auto',
    shadows: detected.shadows,
    grass: detected.grassDensity > 0,
    water: detected.fancyWater,
    uiScale: 1,
    edgeScroll: true,
    edgeSpeed: 1,
    invertPan: false,
    master: 0.8,
    music: 0.7,
    sfx: 0.8,
    colorblind: false,
    reducedMotion,
  };
}

function nearest(value: number, steps: readonly number[], fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  let best = steps[0] ?? fallback;
  let bestD = Infinity;
  for (const step of steps) {
    const d = Math.abs(step - value);
    if (d < bestD) {
      best = step;
      bestD = d;
    }
  }
  return best;
}

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function parseStored(raw: string | null, detected: Quality, reducedMotion: boolean): Settings | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Settings>;
    if (!data || typeof data !== 'object') return null;
    const quality =
      data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' || data.quality === 'auto'
        ? data.quality
        : 'auto';
    const base = defaultSettings(detected, reducedMotion);
    return {
      quality,
      shadows: typeof data.shadows === 'boolean' ? data.shadows : base.shadows,
      grass: typeof data.grass === 'boolean' ? data.grass : base.grass,
      water: typeof data.water === 'boolean' ? data.water : base.water,
      uiScale: nearest(Number(data.uiScale), UI_SCALES, 1),
      edgeScroll: typeof data.edgeScroll === 'boolean' ? data.edgeScroll : true,
      edgeSpeed: nearest(Number(data.edgeSpeed), EDGE_SPEEDS, 1),
      invertPan: data.invertPan === true,
      master: clamp01(Number(data.master), 0.8),
      music: clamp01(Number(data.music), 0.7),
      sfx: clamp01(Number(data.sfx), 0.8),
      colorblind: data.colorblind === true,
      reducedMotion: typeof data.reducedMotion === 'boolean' ? data.reducedMotion : reducedMotion,
    };
  } catch {
    return null;
  }
}

export function urlQuality(search: string): QualityTier | null {
  const forced = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  return null;
}

export function resolveSettings(env: SettingsEnv): ResolvedSettings {
  const stored = parseStored(env.stored, env.detected, env.reducedMotion);
  const fresh = stored == null;
  const base = stored ?? defaultSettings(env.detected, env.reducedMotion);
  const locked = urlQuality(env.search);
  if (!locked) return { settings: base, graphicsLocked: false, fresh };
  const tier = qualityTier(locked);
  return {
    settings: {
      ...base,
      quality: locked,
      shadows: tier.shadows,
      grass: tier.grassDensity > 0,
      water: tier.fancyWater,
    },
    graphicsLocked: true,
    fresh,
  };
}

/** Graphics for this boot. A `?quality=` tier wins whole, so tests stay on that tier. */
export function bootQuality(settings: Settings, detected: Quality, search: string): Quality {
  const locked = urlQuality(search);
  if (locked) return { ...qualityTier(locked) };
  const tierName = settings.quality === 'auto' ? detected.tier : settings.quality;
  return withToggles({ ...qualityTier(tierName) }, settings);
}

export function withToggles(base: Quality, settings: Pick<Settings, 'shadows' | 'grass' | 'water'>): Quality {
  return {
    ...base,
    shadows: settings.shadows,
    shadowMapSize: settings.shadows ? base.shadowMapSize || 1024 : 0,
    grassDensity: settings.grass ? base.grassDensity || 3 : 0,
    grassRadius: settings.grass ? base.grassRadius || 28 : 0,
    fancyWater: settings.water,
  };
}

export function tierToggles(choice: QualityChoice, detected: Quality): Pick<Settings, 'shadows' | 'grass' | 'water'> {
  const q = choice === 'auto' ? detected : qualityTier(choice);
  return { shadows: q.shadows, grass: q.grassDensity > 0, water: q.fancyWater };
}

/** What to write. A locked visit keeps the previously stored graphics fields. */
export function persistable(
  current: Settings,
  stored: Settings | null,
  detected: Quality,
  reducedMotion: boolean,
  graphicsLocked: boolean,
): Settings {
  if (!graphicsLocked) return current;
  const keep = stored ?? defaultSettings(detected, reducedMotion);
  return {
    ...current,
    quality: keep.quality,
    shadows: keep.shadows,
    grass: keep.grass,
    water: keep.water,
  };
}

export function sanitizeSettings(settings: Settings, detected: Quality, reducedMotion: boolean): Settings {
  const base = defaultSettings(detected, reducedMotion);
  return {
    quality:
      settings.quality === 'low' || settings.quality === 'medium' || settings.quality === 'high' || settings.quality === 'auto'
        ? settings.quality
        : 'auto',
    shadows: settings.shadows === true,
    grass: settings.grass === true,
    water: settings.water === true,
    uiScale: nearest(settings.uiScale, UI_SCALES, 1),
    edgeScroll: settings.edgeScroll !== false,
    edgeSpeed: nearest(settings.edgeSpeed, EDGE_SPEEDS, 1),
    invertPan: settings.invertPan === true,
    master: clamp01(settings.master, base.master),
    music: clamp01(settings.music, base.music),
    sfx: clamp01(settings.sfx, base.sfx),
    colorblind: settings.colorblind === true,
    reducedMotion: settings.reducedMotion === true,
  };
}

/** UI scale and reduced motion, without touching the WebGL canvas. */
export function applyChrome(settings: Settings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

let memoryStore: Store | null = null;
let active: Settings | null = null;
let locked = false;
let fresh = true;
let storedSnapshot: Settings | null = null;
let detected: Quality = qualityTier('medium');
let reduced = false;
const listeners = new Set<(settings: Settings) => void>();

/** Tests inject a store. Pass null to use localStorage again. */
export function bindSettingsStore(store: Store | null): void {
  memoryStore = store;
}

function jar(): Store | null {
  if (memoryStore) return memoryStore;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readBrowserEnv(): SettingsEnv {
  const stored = jar()?.getItem(SETTINGS_KEY) ?? null;
  const search = typeof location === 'undefined' ? '' : location.search;
  let reducedMotion = false;
  try {
    reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reducedMotion = false;
  }
  return { stored, search, detected: deviceQuality(), reducedMotion };
}

export function graphicsLocked(): boolean {
  return locked;
}

export function currentSettings(): Settings {
  return active ?? defaultSettings(detected, reduced);
}

export function initSettings(env: SettingsEnv = readBrowserEnv()): Settings {
  detected = env.detected;
  reduced = env.reducedMotion;
  storedSnapshot = parseStored(env.stored, env.detected, env.reducedMotion);
  const resolved = resolveSettings(env);
  active = resolved.settings;
  locked = resolved.graphicsLocked;
  fresh = resolved.fresh;
  applyChrome(active);
  return active;
}

export function ensureSettings(): Settings {
  return active ?? initSettings();
}

export function subscribeSettings(fn: (settings: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function replaceSettings(next: Settings): void {
  if (!active) initSettings();
  active = sanitizeSettings(next, detected, reduced);
  const toWrite = persistable(active, fresh ? null : storedSnapshot, detected, reduced, locked);
  try {
    jar()?.setItem(SETTINGS_KEY, JSON.stringify(toWrite));
  } catch {
    // Private mode: the session still applies the change.
  }
  storedSnapshot = toWrite;
  fresh = false;
  applyChrome(active);
  for (const fn of listeners) fn(active);
}
