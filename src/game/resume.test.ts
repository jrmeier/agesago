import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../sim/serialize';
import {
  RESUME_BROKEN_KEY,
  RESUME_KEY,
  RESUME_VERSION,
  memoryResumeStore,
  parseEnvelope,
  readResume,
  readResumeFile,
  type ResumeEnvelope,
} from './resume';

function envelope(patch: Partial<ResumeEnvelope> = {}): ResumeEnvelope {
  return {
    version: RESUME_VERSION,
    sim: { version: SAVE_VERSION } as ResumeEnvelope['sim'],
    view: { x: 12, z: 40, distance: 26 },
    groups: [[1, [3, 4]]],
    selection: [3],
    charts: [{ time: 10, food: 1, wood: 2, gold: 3, stone: 4, population: 5, explored: 0.5 }],
    savedAt: 1_000,
    ...patch,
  };
}

describe('resume envelope', () => {
  it('round-trips a valid envelope through the memory store and a file', async () => {
    const store = memoryResumeStore();
    const saved = envelope();
    await store.put(RESUME_KEY, saved);
    const loaded = await readResume(store);
    expect(loaded.failed).toBe(false);
    expect(loaded.envelope).toEqual(saved);
    const file = await readResumeFile(new Blob([JSON.stringify(saved)]));
    expect(file).toEqual(saved);
    expect(file.sim).not.toBe(saved.sim);
  });

  it('rejects a newer sim version and does not describe it as a resume-version error', () => {
    const raw = envelope();
    raw.sim = { version: SAVE_VERSION + 1 } as ResumeEnvelope['sim'];
    expect(() => parseEnvelope(raw)).toThrow(`Unsupported save version ${SAVE_VERSION + 1}; expected ${SAVE_VERSION}`);
  });

  it('moves a corrupt slot aside and reports the failure', async () => {
    const store = memoryResumeStore();
    await store.put(RESUME_KEY, { version: RESUME_VERSION, sim: { version: 99 } });
    const loaded = await readResume(store);
    expect(loaded).toEqual({ envelope: null, failed: true });
    expect(await store.get(RESUME_KEY)).toBeNull();
    expect(await store.get(RESUME_BROKEN_KEY)).toEqual({ version: RESUME_VERSION, sim: { version: 99 } });
  });

  it('treats a missing slot as a new match', async () => {
    expect(await readResume(memoryResumeStore())).toEqual({ envelope: null, failed: false });
  });

  it('rejects a group outside 1..9 and a chart with a missing field', () => {
    const badGroup = envelope();
    badGroup.groups = [[0, [1]]];
    expect(() => parseEnvelope(badGroup)).toThrow('Invalid resume: groups');
    const badChart = envelope();
    badChart.charts = [{ time: 1, food: 1, wood: 1, gold: 1, stone: 1, population: 1 } as ResumeEnvelope['charts'][number]];
    expect(() => parseEnvelope(badChart)).toThrow('Invalid resume: charts');
  });
});
