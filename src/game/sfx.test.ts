import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import type { Building, EntityId, SimEvent, Unit } from '../core/types';
import { bindAudioUnlock } from './audioBus';
import {
  BUNDLED_AUDIO_BYTES,
  SFX_MAX_DISTANCE,
  SFX_REF_DISTANCE,
  VOICE_LIMIT,
  VoicePool,
  ambienceOf,
  canHearSource,
  distanceGain,
  stereoPan,
} from './sfx';
import { MatchAudio, type HearWorld } from './sfxDirector';
import type { Ambience, SfxEar } from './sfx';
import type { SfxSink, SfxVoice } from './sfxPlayer';

const EAR: SfxEar = { at: { x: 0, z: 0 }, right: { x: 1, z: 0 } };

function unit(patch: Partial<Unit> & Pick<Unit, 'id' | 'owner' | 'pos'>): Unit {
  return {
    kind: 'villager',
    hp: 10,
    maxHp: 10,
    target: null,
    stance: 'aggressive',
    prevPos: patch.pos,
    facing: 0,
    state: 'idle',
    path: [],
    gatherNode: null,
    gatherType: null,
    carry: null,
    ...patch,
  };
}

class Sink implements SfxSink {
  played: SfxVoice[] = [];
  stopped: number[] = [];
  ambient: Ambience[] = [];
  private ended = new Map<number, () => void>();

  play(voice: SfxVoice, onEnded: () => void): void {
    this.played.push(voice);
    this.ended.set(voice.id, onEnded);
  }

  stop(id: number): void {
    this.stopped.push(id);
    this.ended.get(id)?.();
    this.ended.delete(id);
  }

  setAmbient(levels: Ambience): void {
    this.ambient.push(levels);
  }

  tick(): void {}

  dispose(): void {}
}

function world(units: Map<EntityId, Unit>, visibleBefore = 50): { world: HearWorld; sink: Sink; ear: MatchAudio } {
  const sink = new Sink();
  const hear: HearWorld = {
    time: 10,
    localPlayer: 1,
    units,
    buildings: new Map<EntityId, Building>(),
    events: new EventBus<SimEvent>(),
    areEnemies: (a, b) => a !== b && a !== 0 && b !== 0,
    visibilityOf: () => ({
      isVisible: (x) => x < visibleBefore,
      isExplored: (x) => x < visibleBefore + 20,
    }),
    hf: {
      isWater: (x) => x > 10,
      forestDensity: () => 0,
    },
  };
  const ear = new MatchAudio(hear, sink);
  ear.setEar(EAR);
  return { world: hear, sink, ear };
}

describe('positional sound', () => {
  it('is full beside the camera and silent past the far edge', () => {
    expect(distanceGain(EAR.at, { x: 0, z: 0 })).toBe(1);
    expect(distanceGain(EAR.at, { x: SFX_REF_DISTANCE, z: 0 })).toBe(1);
    expect(distanceGain(EAR.at, { x: SFX_MAX_DISTANCE, z: 0 })).toBe(0);
    expect(distanceGain(EAR.at, { x: SFX_MAX_DISTANCE + 8, z: 0 })).toBe(0);
    const mid = distanceGain(EAR.at, { x: (SFX_REF_DISTANCE + SFX_MAX_DISTANCE) / 2, z: 0 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('pans a source on the listener’s right to the right', () => {
    expect(stereoPan(EAR, { x: 10, z: 0 })).toBeCloseTo(1);
    expect(stereoPan(EAR, { x: -10, z: 0 })).toBeCloseTo(-1);
    expect(stereoPan(EAR, { x: 0, z: -20 })).toBeCloseTo(0);
    expect(stereoPan(EAR, EAR.at)).toBe(0);
  });

  it('drops unseen enemies and unseen gaia, and keeps your own units', () => {
    expect(canHearSource(1, 1, false, false)).toBe(true);
    expect(canHearSource(2, 1, true, false)).toBe(false);
    expect(canHearSource(2, 1, true, true)).toBe(true);
    expect(canHearSource(0, 1, false, false)).toBe(false);
    expect(canHearSource(0, 1, false, true)).toBe(true);
    expect(canHearSource(3, 1, false, false)).toBe(true);
  });

  it('keeps explored water and forest, and only a thin wind over unknown land', () => {
    const seen = ambienceOf([
      { water: true, forest: 0, explored: true },
      { water: false, forest: 1, explored: true },
    ]);
    expect(seen.water).toBeCloseTo(0.5);
    expect(seen.birds).toBeCloseTo(0.5);
    expect(seen.wind).toBeGreaterThan(0.12);
    const hidden = ambienceOf([{ water: true, forest: 1, explored: false }]);
    expect(hidden).toEqual({ wind: 0.05, birds: 0, water: 0 });
  });

  it('evicts the oldest voice once the pool is full', () => {
    const pool = new VoicePool(VOICE_LIMIT);
    const ids = Array.from({ length: VOICE_LIMIT + 1 }, () => pool.acquire());
    expect(ids[VOICE_LIMIT].evicted).toBe(ids[0].id);
    expect(pool.size).toBe(VOICE_LIMIT);
    pool.release(ids[1].id);
    expect(pool.size).toBe(VOICE_LIMIT - 1);
  });

  it('plays a visible enemy hit and stays quiet when that enemy is in fog', () => {
    const seen = new Map<EntityId, Unit>([[2, unit({ id: 2, owner: 2, pos: { x: 4, z: 4 } })]]);
    const shown = world(seen);
    shown.world.events.emit({ type: 'damaged', id: 2, hp: 4, maxHp: 10, by: 1 });
    expect(shown.sink.played.map((voice) => voice.kind)).toEqual(['clash']);
    expect(shown.sink.played[0].pan).toBeGreaterThan(0);

    const hiddenUnits = new Map<EntityId, Unit>([[2, unit({ id: 2, owner: 2, pos: { x: 90, z: 4 } })]]);
    const hidden = world(hiddenUnits);
    hidden.world.events.emit({ type: 'damaged', id: 2, hp: 4, maxHp: 10, by: 1 });
    expect(hidden.sink.played).toHaveLength(0);
    shown.ear.dispose();
    hidden.ear.dispose();
  });

  it('makes a far clash quieter than one beside the camera', () => {
    const nearUnits = new Map<EntityId, Unit>([[2, unit({ id: 2, owner: 2, pos: { x: 2, z: 0 } })]]);
    const farUnits = new Map<EntityId, Unit>([[2, unit({ id: 2, owner: 2, pos: { x: 40, z: 0 } })]]);
    const near = world(nearUnits, 80);
    const far = world(farUnits, 80);
    near.world.events.emit({ type: 'damaged', id: 2, hp: 1, maxHp: 10, by: null });
    far.world.events.emit({ type: 'damaged', id: 2, hp: 1, maxHp: 10, by: null });
    expect(near.sink.played[0].gain).toBeGreaterThan(far.sink.played[0].gain);
    expect(far.sink.played[0].gain).toBeGreaterThan(0);
    near.ear.dispose();
    far.ear.dispose();
  });

  it('does not sound an arrow that leaves the fog', () => {
    const silent = world(new Map());
    silent.world.events.emit({
      type: 'projectile',
      kind: 'arrow',
      from: { x: 90, z: 2 },
      to: { x: 4, z: 2 },
      flight: 0.4,
      targetId: 1,
    });
    expect(silent.sink.played).toHaveLength(0);
    silent.world.events.emit({
      type: 'projectile',
      kind: 'arrow',
      from: { x: 8, z: 0 },
      to: { x: 4, z: 0 },
      flight: 0.2,
      targetId: 1,
    });
    expect(silent.sink.played.map((voice) => voice.kind)).toEqual(['arrow']);
    silent.ear.dispose();
  });

  it('stops the oldest clash when more hits arrive than the pool can hold', () => {
    const units = new Map<EntityId, Unit>();
    for (let id = 1; id <= VOICE_LIMIT + 1; id++) units.set(id, unit({ id, owner: 2, pos: { x: 3, z: 1 } }));
    const match = world(units);
    for (const id of units.keys()) match.world.events.emit({ type: 'damaged', id, hp: 1, maxHp: 10, by: null });
    expect(match.sink.played).toHaveLength(VOICE_LIMIT + 1);
    expect(match.sink.stopped).toEqual([1]);
    match.ear.dispose();
  });

  it('chops for a visible gatherer and hooves a scout who is walking', () => {
    const units = new Map<EntityId, Unit>([
      [1, unit({ id: 1, owner: 1, pos: { x: 2, z: 1 }, state: 'gathering', gatherType: 'wood' })],
      [2, unit({ id: 2, owner: 1, pos: { x: 3, z: 1 }, kind: 'scout', state: 'moving' })],
    ]);
    const match = world(units);
    match.ear.pulse([], true, 0.016);
    expect(match.sink.played.map((voice) => voice.kind).sort()).toEqual(['chop', 'hoof']);
    match.sink.played.length = 0;
    match.ear.pulse([], true, 0.016);
    expect(match.sink.played).toHaveLength(0);
    match.ear.dispose();
  });

  it('hears water only where the explored view covers it', () => {
    const dry = world(new Map());
    dry.ear.pulse([{ x: 4, z: 0 }], false, 0.016);
    expect(dry.sink.ambient[0].water).toBe(0);
    dry.ear.pulse([{ x: 20, z: 0 }, { x: 4, z: 0 }], false, 0.016);
    expect(dry.sink.ambient[1].water).toBeCloseTo(0.5);
    dry.ear.pulse([{ x: 140, z: 0 }], false, 0.016);
    expect(dry.sink.ambient[2]).toEqual({ wind: 0.05, birds: 0, water: 0 });
    dry.ear.dispose();
  });

  it('unlocks audio on the first pointer', () => {
    let n = 0;
    const target = new EventTarget();
    const off = bindAudioUnlock({ unlock: () => { n += 1; } }, target);
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('pointerdown'));
    off();
    target.dispatchEvent(new Event('pointerdown'));
    expect(n).toBe(2);
  });

  it('ships no recorded sound effects', () => {
    expect(BUNDLED_AUDIO_BYTES).toBe(0);
    const audio = import.meta.glob(['../../public/**/*.{mp3,ogg,wav,flac,m4a,aac,opus}', '!../../public/audio/0ad/**']);
    expect(Object.keys(audio)).toEqual([]);
  });
});
