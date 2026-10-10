import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import type { Building, EntityId, SimEvent, Unit } from '../core/types';
import {
  AUDIO_CREDIT,
  COMBAT_HOLD,
  COMBAT_RELEASE,
  MusicEngine,
  PHRASE_SECONDS,
  calmScore,
  combatScore,
  crossfade,
  duePhrase,
  renderPhrase,
  CombatMix,
  type MusicSink,
  type MixGains,
} from './music';
import { MatchMusic, type MusicWorld } from './musicDirector';

class Sink implements MusicSink {
  mixes: MixGains[] = [];
  queued: number[] = [];

  setMix(mix: MixGains): void {
    this.mixes.push(mix);
  }

  queue(start: number): void {
    this.queued.push(start);
  }

  dispose(): void {}
}

function unit(id: EntityId, owner: number): Unit {
  return {
    id,
    kind: 'hoplite',
    owner,
    hp: 10,
    maxHp: 10,
    target: null,
    stance: 'aggressive',
    pos: { x: 1, z: 1 },
    prevPos: { x: 1, z: 1 },
    facing: 0,
    state: 'idle',
    path: [],
    gatherNode: null,
    gatherType: null,
    carry: null,
  };
}

describe('music beds', () => {
  it('crossfades with equal power', () => {
    const calm = crossfade(0);
    const mid = crossfade(0.5);
    const fight = crossfade(1);
    expect(calm).toEqual({ calm: 1, combat: 0 });
    expect(fight.calm).toBeCloseTo(0);
    expect(fight.combat).toBeCloseTo(1);
    expect(mid.calm ** 2 + mid.combat ** 2).toBeCloseTo(1);
    expect(mid.calm).toBeCloseTo(mid.combat);
  });

  it('queues the next phrase exactly where the current one ends', () => {
    const first = duePhrase(10, PHRASE_SECONDS, 0);
    expect(first).toEqual({ start: 10, until: 18 });
    expect(duePhrase(10.1, PHRASE_SECONDS, 18)).toBeNull();
    const next = duePhrase(18 - 0.2, PHRASE_SECONDS, 18);
    expect(next).toEqual({ start: 18, until: 26 });
  });

  it('holds combat after a hit, then lets it fall', () => {
    const mix = new CombatMix();
    mix.hit(5);
    expect(mix.level(5)).toBe(1);
    expect(mix.level(5 + COMBAT_HOLD)).toBe(1);
    expect(mix.level(5 + COMBAT_HOLD + COMBAT_RELEASE / 2)).toBeCloseTo(0.5);
    expect(mix.level(5 + COMBAT_HOLD + COMBAT_RELEASE)).toBe(0);
  });

  it('renders a phrase that stays inside a unit peak and contains the lyre and the drum', () => {
    const calm = renderPhrase(8000, calmScore());
    const combat = renderPhrase(8000, combatScore());
    expect(calm.length).toBe(8000 * PHRASE_SECONDS);
    expect(combat.length).toBe(calm.length);
    let calmPeak = 0;
    let combatEnergy = 0;
    for (let i = 0; i < calm.length; i++) {
      calmPeak = Math.max(calmPeak, Math.abs(calm[i]));
      combatEnergy += combat[i] * combat[i];
    }
    expect(calmPeak).toBeGreaterThan(0.05);
    expect(calmPeak).toBeLessThanOrEqual(0.9);
    expect(combatEnergy).toBeGreaterThan(1);
    expect(calm[0]).toBe(0);
    expect(combat[combat.length - 1]).toBe(0);
  });

  it('raises the combat bed only for a fight that involves you', () => {
    const units = new Map<EntityId, Unit>([
      [1, unit(1, 1)],
      [2, unit(2, 2)],
    ]);
    const world: MusicWorld = {
      time: 3,
      localPlayer: 1,
      units,
      buildings: new Map<EntityId, Building>(),
      events: new EventBus<SimEvent>(),
    };
    const sink = new Sink();
    const music = new MatchMusic(world, sink);
    music.advance(world.time, 1);
    expect(sink.mixes[0].combat).toBeCloseTo(0);
    expect(sink.queued).toEqual([1]);

    world.events.emit({ type: 'attacked', owner: 2, id: 2, pos: { x: 1, z: 1 } });
    music.advance(world.time, 1.1);
    expect(sink.mixes.at(-1)?.combat).toBeCloseTo(0);

    world.events.emit({ type: 'attacked', owner: 1, id: 1, pos: { x: 1, z: 1 } });
    music.advance(world.time, 1.2);
    expect(sink.mixes.at(-1)?.combat).toBeCloseTo(1);
    expect(sink.queued).toEqual([1]);

    world.time = 3 + COMBAT_HOLD + COMBAT_RELEASE;
    music.advance(world.time, 2);
    expect(sink.mixes.at(-1)?.calm).toBeCloseTo(1);
    music.dispose();
  });

  it('schedules a second phrase against the end of the first', () => {
    const sink = new Sink();
    const engine = new MusicEngine(sink);
    engine.advance(0, 4);
    engine.advance(0, 4 + PHRASE_SECONDS - 0.1);
    expect(sink.queued).toEqual([4, 4 + PHRASE_SECONDS]);
    engine.dispose();
  });

  it('credits the synthesis and no recording', () => {
    expect(AUDIO_CREDIT).toMatch(/synthesised/i);
    expect(AUDIO_CREDIT).toMatch(/no recorded soundtrack/i);
  });
});
