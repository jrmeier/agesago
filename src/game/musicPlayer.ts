import { audioBus } from './audioBus';
import { PHRASE_SECONDS, calmScore, combatScore, renderPhrase, type MusicSink, type MixGains } from './music';

/** Plays the two beds on the music bus. Phrases are queued back to back. */
export class ProceduralMusic implements MusicSink {
  private calmGain: GainNode | null = null;
  private combatGain: GainNode | null = null;
  private calm: AudioBuffer | null = null;
  private combat: AudioBuffer | null = null;

  setMix(mix: MixGains): void {
    if (this.calmGain) this.calmGain.gain.value = mix.calm * 0.22;
    if (this.combatGain) this.combatGain.gain.value = mix.combat * 0.28;
  }

  queue(start: number): void {
    audioBus.unlock();
    const dest = audioBus.musicOut();
    if (!dest) return;
    try {
      this.ensure(dest.ctx, dest.music);
      this.play(dest.ctx, this.calm, this.calmGain, start);
      this.play(dest.ctx, this.combat, this.combatGain, start);
    } catch {
      // A locked device leaves the match silent.
    }
  }

  dispose(): void {
    this.calmGain?.disconnect();
    this.combatGain?.disconnect();
    this.calmGain = null;
    this.combatGain = null;
  }

  private ensure(ctx: AudioContext, dest: GainNode): void {
    if (this.calm && this.combat && this.calmGain && this.combatGain) return;
    this.calm = this.buffer(ctx, calmScore());
    this.combat = this.buffer(ctx, combatScore());
    this.calmGain = ctx.createGain();
    this.combatGain = ctx.createGain();
    this.calmGain.gain.value = 0.22;
    this.combatGain.gain.value = 0;
    this.calmGain.connect(dest);
    this.combatGain.connect(dest);
  }

  private buffer(ctx: AudioContext, tones: ReturnType<typeof calmScore>): AudioBuffer {
    const data = renderPhrase(ctx.sampleRate, tones);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    return buffer;
  }

  private play(ctx: AudioContext, buffer: AudioBuffer | null, gain: GainNode | null, when: number): void {
    if (!buffer || !gain) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    const start = Math.max(when, ctx.currentTime);
    src.start(start);
    src.stop(start + PHRASE_SECONDS);
  }
}

/** Audio clock, or 0 before the context exists. */
export function audioNow(): number {
  return audioBus.musicOut()?.ctx.currentTime ?? 0;
}
