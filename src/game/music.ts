/** Length of one generated phrase. The next phrase starts as this one ends. */
export const PHRASE_SECONDS = 8;
/** Queue the next phrase this long before the current one ends. */
export const MUSIC_LOOKAHEAD = 0.35;

/** How long a fight keeps the combat bed up, then how long the crossfade takes. */
export const COMBAT_HOLD = 6;
export const COMBAT_RELEASE = 2.5;

export const AUDIO_CREDIT =
  'Sound and music are synthesised in this browser. No recorded soundtrack is downloaded.';

export interface MixGains {
  calm: number;
  combat: number;
}

export interface PhraseSlot {
  start: number;
  until: number;
}

/** Equal-power crossfade. The sum of the squares stays at 1. */
export function crossfade(combat: number): MixGains {
  const t = Math.min(1, Math.max(0, combat));
  const angle = t * Math.PI * 0.5;
  return { calm: Math.cos(angle), combat: Math.sin(angle) };
}

/**
 * Next phrase to queue. The start equals the previous end, so the loop has no gap.
 * Returns null while a phrase is already queued past the lookahead.
 */
export function duePhrase(
  now: number,
  phrase = PHRASE_SECONDS,
  until = 0,
  lookahead = MUSIC_LOOKAHEAD,
): PhraseSlot | null {
  if (until <= now) return { start: now, until: now + phrase };
  if (now + lookahead >= until) return { start: until, until: until + phrase };
  return null;
}

/** Holds the combat bed up after the last fight, then lets it fall. */
export class CombatMix {
  private until = -Infinity;

  constructor(
    readonly hold = COMBAT_HOLD,
    readonly release = COMBAT_RELEASE,
  ) {}

  hit(time: number): void {
    this.until = Math.max(this.until, time + this.hold);
  }

  /** 1 during a fight, then a linear fall to 0. */
  level(time: number): number {
    if (time <= this.until) return 1;
    const t = (time - this.until) / this.release;
    if (t >= 1) return 0;
    return 1 - t;
  }
}

export interface Tone {
  /** Seconds from the start of the phrase. */
  at: number;
  freq: number;
  dur: number;
  gain: number;
  /** Low thud instead of a plucked string. */
  drum?: boolean;
}

/** D minor pentatonic, the calm lyre. */
const LYRE = [293.66, 349.23, 392, 440, 523.25];

/** Exploration: plucked lyre and a quiet drone. */
export function calmScore(): Tone[] {
  const notes: Tone[] = [{ at: 0, freq: 220, dur: PHRASE_SECONDS, gain: 0.05 }];
  for (let beat = 0; beat < 8; beat++) {
    notes.push({ at: beat, freq: LYRE[beat % LYRE.length], dur: 0.85, gain: 0.2 });
    if (beat % 2 === 0) notes.push({ at: beat + 0.5, freq: LYRE[(beat + 2) % LYRE.length], dur: 0.4, gain: 0.1 });
  }
  return notes;
}

/** Fighting: a drone, a frame-drum pulse, and a short aulos figure. */
export function combatScore(): Tone[] {
  const notes: Tone[] = [
    { at: 0, freq: 110, dur: PHRASE_SECONDS, gain: 0.07 },
    { at: 0, freq: 164.81, dur: PHRASE_SECONDS, gain: 0.04 },
  ];
  for (let step = 0; step < 16; step++) {
    notes.push({
      at: step * 0.5,
      freq: step % 4 === 0 ? 160 : 90,
      dur: 0.16,
      gain: step % 2 === 0 ? 0.32 : 0.16,
      drum: true,
    });
  }
  for (let beat = 0; beat < 8; beat++) {
    notes.push({ at: beat, freq: beat % 2 === 0 ? 311.13 : 369.99, dur: 0.35, gain: 0.12 });
  }
  return notes;
}

/** Render one phrase. Samples fade over 5 ms at each end so the join does not click. */
export function renderPhrase(sampleRate: number, tones: readonly Tone[], seconds = PHRASE_SECONDS): Float32Array {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const data = new Float32Array(length);
  for (const tone of tones) {
    const start = Math.floor(tone.at * sampleRate);
    const count = Math.max(1, Math.floor(tone.dur * sampleRate));
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= length) continue;
      const u = i / count;
      const env = tone.drum ? Math.exp(-24 * u) : Math.sin(Math.min(Math.PI, u * Math.PI * 6)) * Math.exp(-1.6 * u);
      const sample = Math.sin((2 * Math.PI * tone.freq * i) / sampleRate) * env * tone.gain;
      data[idx] += sample;
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0.9) {
    const scale = 0.9 / peak;
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  const fade = Math.min(length >> 1, Math.floor(sampleRate * 0.005));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    data[i] *= g;
    data[length - 1 - i] *= g;
  }
  return data;
}

export interface MusicSink {
  setMix(mix: MixGains): void;
  queue(start: number): void;
  dispose(): void;
}

/** Schedules gapless phrases and applies the combat crossfade. */
export class MusicEngine {
  private until = 0;

  constructor(
    private readonly sink: MusicSink,
    private readonly mix = new CombatMix(),
  ) {}

  hit(time: number): void {
    this.mix.hit(time);
  }

  /** `audioNow` is the audio clock in seconds, not the simulation clock. */
  advance(simTime: number, audioNow: number): void {
    this.sink.setMix(crossfade(this.mix.level(simTime)));
    for (let guard = 0; guard < 4; guard++) {
      const due = duePhrase(audioNow, PHRASE_SECONDS, this.until);
      if (!due) return;
      this.until = due.until;
      this.sink.queue(due.start);
    }
  }

  dispose(): void {
    this.sink.dispose();
  }
}
