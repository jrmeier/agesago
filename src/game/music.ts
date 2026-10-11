/** How long a fight keeps the combat bed up, then how long the crossfade takes. */
export const COMBAT_HOLD = 6;
export const COMBAT_RELEASE = 2.5;
export const TRACK_OVERLAP = 2;

export const AUDIO_CREDIT =
  'Music: Sunrise, Peaks of Atlas and Honor Bound (0 A.D. Main Theme), by Omri Lahav / Wildfire Games. ' +
  'From the 0 A.D. soundtrack, CC BY-SA 3.0. Re-encoded to MP3; tracks overlap during playback. Sound effects are synthesised in this browser.';

export const MUSIC_TRACKS = {
  calm: ['sunrise.mp3', 'peaks-of-atlas.mp3'],
  combat: ['honor-bound.mp3'],
} as const;

export interface MixGains { calm: number; combat: number }

/** Equal-power crossfade. The sum of the squares stays at 1. */
export function crossfade(combat: number): MixGains {
  const t = Math.min(1, Math.max(0, combat));
  const angle = t * Math.PI * 0.5;
  return { calm: Math.cos(angle), combat: Math.sin(angle) };
}

/** Holds the combat bed up after the last fight, then lets it fall. */
export class CombatMix {
  private until = -Infinity;
  constructor(readonly hold = COMBAT_HOLD, readonly release = COMBAT_RELEASE) {}
  hit(time: number): void { this.until = Math.max(this.until, time + this.hold); }
  level(time: number): number {
    if (time <= this.until) return 1;
    return Math.max(0, 1 - (time - this.until) / this.release);
  }
}

export interface MusicSink {
  setMix(mix: MixGains): void;
  advance(audioNow: number): void;
  dispose(): void;
}

/** Applies the combat mix while the sink advances its streamed playlists. */
export class MusicEngine {
  constructor(private readonly sink: MusicSink, private readonly mix = new CombatMix()) {}
  hit(time: number): void { this.mix.hit(time); }
  advance(simTime: number, audioNow: number): void {
    this.sink.setMix(crossfade(this.mix.level(simTime)));
    this.sink.advance(audioNow);
  }
  dispose(): void { this.sink.dispose(); }
}
