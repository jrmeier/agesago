import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import type { Building, EntityId, SimEvent, Unit } from '../core/types';
import { AUDIO_CREDIT, COMBAT_HOLD, COMBAT_RELEASE, crossfade, CombatMix, type MusicSink, type MixGains } from './music';
import { MatchMusic, type MusicWorld } from './musicDirector';
import { StreamPlaylist } from './musicPlayer';

class Sink implements MusicSink {
  mixes: MixGains[] = [];
  advanced: number[] = [];
  setMix(mix: MixGains): void { this.mixes.push(mix); }
  advance(now: number): void { this.advanced.push(now); }
  dispose(): void {}
}
function unit(id: EntityId, owner: number): Unit {
  return { id, kind: 'hoplite', owner, hp: 10, maxHp: 10, target: null, stance: 'aggressive',
    pos: { x: 1, z: 1 }, prevPos: { x: 1, z: 1 }, facing: 0, state: 'idle', path: [], gatherNode: null, gatherType: null, carry: null };
}

describe('music mix', () => {
  it('crossfades with equal power', () => {
    const mid = crossfade(0.5);
    expect(crossfade(0)).toEqual({ calm: 1, combat: 0 });
    expect(crossfade(1).combat).toBeCloseTo(1);
    expect(mid.calm ** 2 + mid.combat ** 2).toBeCloseTo(1);
    expect(mid.calm).toBeCloseTo(mid.combat);
  });
  it('holds combat after a hit, then lets it fall', () => {
    const mix = new CombatMix(); mix.hit(5);
    expect(mix.level(5 + COMBAT_HOLD)).toBe(1);
    expect(mix.level(5 + COMBAT_HOLD + COMBAT_RELEASE / 2)).toBeCloseTo(0.5);
    expect(mix.level(5 + COMBAT_HOLD + COMBAT_RELEASE)).toBe(0);
  });
  it('raises the combat bed only for a fight that involves you', () => {
    const world: MusicWorld = { time: 3, localPlayer: 1, units: new Map([[1, unit(1, 1)], [2, unit(2, 2)]]),
      buildings: new Map<EntityId, Building>(), events: new EventBus<SimEvent>() };
    const sink = new Sink(), music = new MatchMusic(world, sink);
    music.advance(world.time, 1); expect(sink.mixes[0].combat).toBeCloseTo(0);
    world.events.emit({ type: 'attacked', owner: 2, id: 2, pos: { x: 1, z: 1 } });
    music.advance(world.time, 1.1); expect(sink.mixes.at(-1)?.combat).toBeCloseTo(0);
    world.events.emit({ type: 'attacked', owner: 1, id: 1, pos: { x: 1, z: 1 } });
    music.advance(world.time, 1.2); expect(sink.mixes.at(-1)?.combat).toBeCloseTo(1);
    expect(sink.advanced).toEqual([1, 1.1, 1.2]);
    world.time = 3 + COMBAT_HOLD + COMBAT_RELEASE; music.advance(world.time, 2);
    expect(sink.mixes.at(-1)?.calm).toBeCloseTo(1); music.dispose();
  });
  it('credits recorded tracks and distinguishes procedural effects', () => {
    expect(AUDIO_CREDIT).toMatch(/Omri Lahav \/ Wildfire Games/);
    expect(AUDIO_CREDIT).toMatch(/CC BY-SA 3.0/);
    expect(AUDIO_CREDIT).toMatch(/Sunrise.*Peaks of Atlas.*Honor Bound/);
    expect(AUDIO_CREDIT).toMatch(/effects are synthesised/);
  });
});

class Media extends EventTarget {
  paused = true; currentTime = 0; duration = 10; readyState = 4; src = ''; plays = 0; loads = 0; blocked = false;
  play(): Promise<void> { if (this.blocked) return Promise.reject(new Error('locked')); this.paused = false; this.plays++; return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void { this.loads++; }
  removeAttribute(): void { this.src = ''; }
}
function fixture(tracks = ['a', 'b']) {
  const media: Media[] = [], gains: { gain: { value: number; curves: Float32Array[]; cancelScheduledValues(): void; setValueCurveAtTime(curve: Float32Array): void }; connect(): void; disconnect(): void }[] = [];
  const ctx = { state: 'running', currentTime: 0, createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    createGain: () => { const gain = { gain: { value: 0, curves: [] as Float32Array[], cancelScheduledValues() {}, setValueCurveAtTime(curve: Float32Array) { this.curves.push(curve); } }, connect() {}, disconnect() {} }; gains.push(gain); return gain; } };
  const list = new StreamPlaylist(ctx as unknown as AudioContext, {} as GainNode, tracks, url => {
    const m = new Media(); m.src = url; media.push(m); return m as unknown as HTMLAudioElement;
  });
  return { list, media, gains, ctx };
}
describe('streamed playlist lifecycle', () => {
  it('starts a silent successor before the end, overlaps at equal power, then recycles just two slots', () => {
    const { list, media: [a, b], gains } = fixture(['a', 'b', 'c']);
    list.start(); expect(a.paused).toBe(false); expect(b.paused).toBe(true);
    a.currentTime = 8; list.advance(); expect(b.paused).toBe(false); expect(gains[1].gain.value).toBe(0);
    b.currentTime = 1; list.advance(); expect(gains[0].gain.curves[0][32] ** 2 + gains[1].gain.curves[0][32] ** 2).toBeCloseTo(1);
    b.currentTime = 2; list.advance(); expect(a.paused).toBe(true); expect(a.src).toBe('c'); expect(a.loads).toBe(1);
    b.currentTime = 8; list.advance(); expect(a.paused).toBe(false);
    a.currentTime = 2; list.advance(); expect(b.src).toBe('a'); list.dispose();
  });
  it('waits for future media data before scheduling a fade', () => {
    const { list, media: [a, b], gains } = fixture(); list.start(); a.currentTime = 9; b.readyState = 2;
    list.advance(); expect(b.paused).toBe(true); expect(gains[0].gain.value).toBe(1);
    b.readyState = 4; list.advance(); expect(b.paused).toBe(false); expect(gains[0].gain.value).toBe(1);
    list.dispose();
  });
  it('overlaps the same track on repeat and stops/releases both streams on disposal', async () => {
    const { list, media: [a, b] } = fixture(['a']); list.start(true); await Promise.resolve();
    expect(a.paused).toBe(false); expect(b.paused).toBe(true);
    a.currentTime = 8; a.dispatchEvent(new Event('timeupdate')); b.currentTime = 2; b.dispatchEvent(new Event('timeupdate'));
    expect(a.src).toBe('a'); list.dispose(); list.dispose();
    expect(a.paused && b.paused).toBe(true); expect(a.src + b.src).toBe('');
    const plays = a.plays + b.plays; list.start(); list.advance(); expect(a.plays + b.plays).toBe(plays);
  });
  it('does not advance a stream while the audio context is suspended', () => {
    const { list, media: [a, b], ctx } = fixture(); a.currentTime = 9; ctx.state = 'suspended';
    list.advance(); expect(b.plays).toBe(0); list.dispose();
  });
  it('restores the active bed if a successor play is rejected and permits a later retry', async () => {
    const { list, media: [a, b], gains } = fixture(); list.start(); a.currentTime = 8; b.blocked = true;
    list.advance(); await Promise.resolve(); expect(gains[0].gain.value).toBe(1); expect(gains[1].gain.value).toBe(0);
    b.blocked = false; list.advance(); expect(b.paused).toBe(false); list.dispose();
  });
});
