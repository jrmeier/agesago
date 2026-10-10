import type { EntityId } from '../core/types';
import { SAVE_VERSION, type SaveData } from '../sim/serialize';
import type { EndgameSample } from '../ui/endgameLog';

/** Wrapper around SaveData. The sim format stays at SAVE_VERSION. */
export const RESUME_VERSION = 1;
export const RESUME_DB = 'agesago';
export const RESUME_STORE = 'resume';
export const RESUME_KEY = 'current';
export const RESUME_BROKEN_KEY = 'broken';
/** Wall-clock gap between autosaves. A hidden tab saves sooner. */
export const AUTOSAVE_MS = 30_000;
export const RESUME_FILENAME = 'agesago-save.json';

export interface ResumeView {
  x: number;
  z: number;
  distance: number;
}

/** One browser resume. Plain JSON, safe to download. */
export interface ResumeEnvelope {
  version: number;
  sim: SaveData;
  view: ResumeView;
  groups: [number, EntityId[]][];
  selection: EntityId[];
  charts: EndgameSample[];
  savedAt: number;
}

/** The one slot, plus the broken copy set aside when a resume will not load. */
export interface ResumeStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const CHART_KEYS = ['time', 'food', 'wood', 'gold', 'stone', 'population', 'explored'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ids(value: unknown): EntityId[] {
  if (!Array.isArray(value) || value.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('Invalid resume: ids');
  }
  return [...value];
}

/** Reject anything that is not the envelope. SaveData itself is checked again on load. */
export function parseEnvelope(raw: unknown): ResumeEnvelope {
  if (!isRecord(raw)) throw new Error('Invalid resume');
  if (raw.version !== RESUME_VERSION) throw new Error(`Unsupported resume version ${String(raw.version)}; expected ${RESUME_VERSION}`);
  if (!isRecord(raw.sim)) throw new Error('Invalid resume: sim');
  if (raw.sim.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${String(raw.sim.version)}; expected ${SAVE_VERSION}`);
  }
  if (!isRecord(raw.view) || !finite(raw.view.x) || !finite(raw.view.z) || !finite(raw.view.distance)) {
    throw new Error('Invalid resume: view');
  }
  if (!Array.isArray(raw.groups)) throw new Error('Invalid resume: groups');
  const groups: [number, EntityId[]][] = raw.groups.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 1 || entry[0] > 9) {
      throw new Error('Invalid resume: groups');
    }
    return [entry[0], ids(entry[1])];
  });
  if (!Array.isArray(raw.charts)) throw new Error('Invalid resume: charts');
  const charts: EndgameSample[] = raw.charts.map((sample) => {
    if (!isRecord(sample) || CHART_KEYS.some((key) => !finite(sample[key]))) throw new Error('Invalid resume: charts');
    return {
      time: sample.time as number,
      food: sample.food as number,
      wood: sample.wood as number,
      gold: sample.gold as number,
      stone: sample.stone as number,
      population: sample.population as number,
      explored: sample.explored as number,
    };
  });
  if (!finite(raw.savedAt)) throw new Error('Invalid resume: savedAt');
  return {
    version: RESUME_VERSION,
    sim: raw.sim as unknown as SaveData,
    view: { x: raw.view.x, z: raw.view.z, distance: raw.view.distance },
    groups,
    selection: ids(raw.selection),
    charts,
    savedAt: raw.savedAt,
  };
}

/** In-memory stand-in for tests. Values are copied through JSON. */
export function memoryResumeStore(): ResumeStore {
  const data = new Map<string, string>();
  return {
    async get(key) {
      const text = data.get(key);
      return text === undefined ? null : JSON.parse(text) as unknown;
    },
    async put(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

/**
 * Load the current slot. A slot that fails to parse is moved to `broken` and
 * reported as failed so boot can start a new match.
 */
export async function readResume(store: ResumeStore): Promise<{ envelope: ResumeEnvelope | null; failed: boolean }> {
  let raw: unknown;
  try {
    raw = await store.get(RESUME_KEY);
  } catch {
    return { envelope: null, failed: true };
  }
  if (raw == null) return { envelope: null, failed: false };
  try {
    return { envelope: parseEnvelope(raw), failed: false };
  } catch {
    try {
      await store.put(RESUME_BROKEN_KEY, raw);
      await store.delete(RESUME_KEY);
    } catch {
      // The bad slot could not be moved. Boot still starts a new match.
    }
    return { envelope: null, failed: true };
  }
}

export async function deleteResume(store: ResumeStore): Promise<void> {
  await store.delete(RESUME_KEY);
}

export function resumeBlob(envelope: ResumeEnvelope): Blob {
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

/** Download the envelope. No-op when the document cannot click a link. */
export function downloadResume(envelope: ResumeEnvelope): void {
  if (typeof document === 'undefined' || !document.body) return;
  const url = URL.createObjectURL(resumeBlob(envelope));
  const link = document.createElement('a');
  link.href = url;
  link.download = RESUME_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the browser has read the blob. Revoking in this turn cancels the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function readResumeFile(file: Blob): Promise<ResumeEnvelope> {
  return parseEnvelope(JSON.parse(await file.text()) as unknown);
}

/** IndexedDB slot. Methods reject when the database cannot be opened. */
export function idbResumeStore(): ResumeStore {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(RESUME_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESUME_STORE)) db.createObjectStore(RESUME_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
  });

  const run = async <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(RESUME_STORE, mode);
        const request = op(tx.objectStore(RESUME_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      });
    } finally {
      db.close();
    }
  };

  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    put: (key, value) => run('readwrite', (store) => store.put(value, key)).then(() => undefined),
    delete: (key) => run('readwrite', (store) => store.delete(key)).then(() => undefined),
  };
}
