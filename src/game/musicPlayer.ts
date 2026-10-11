import { audioBus } from './audioBus';
import { MUSIC_TRACKS, TRACK_OVERLAP, crossfade, type MusicSink, type MixGains } from './music';

interface Slot { media: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode }
export type MediaFactory = (url: string) => HTMLAudioElement;
const makeMedia: MediaFactory = url => {
  const media = document.createElement('audio');
  media.preload = 'auto';
  media.src = url;
  return media;
};
const JOIN_OUT = Float32Array.from({ length: 65 }, (_, i) => crossfade(i / 64).calm);
const JOIN_IN = Float32Array.from({ length: 65 }, (_, i) => crossfade(i / 64).combat);

/** Two streamed slots overlap at each track/loop join. No full-track PCM buffers are retained. */
export class StreamPlaylist {
  private readonly slots: [Slot, Slot];
  private current = 0;
  private track = 0;
  private joining = false;
  private disposed = false;
  private readonly tick = () => this.advance();

  constructor(
    private readonly ctx: AudioContext,
    dest: GainNode,
    private readonly urls: readonly string[],
    factory: MediaFactory = makeMedia,
  ) {
    if (!urls.length) throw new Error('Music playlist is empty');
    const create = (url: string): Slot => {
      const media = factory(url), source = ctx.createMediaElementSource(media), gain = ctx.createGain();
      source.connect(gain); gain.connect(dest);
      media.addEventListener('timeupdate', this.tick); media.addEventListener('ended', this.tick);
      return { media, source, gain };
    };
    this.slots = [create(urls[0]), create(urls[1 % urls.length])];
    this.slots[0].gain.gain.value = 1; this.slots[1].gain.gain.value = 0;
  }

  /** Invoke within a gesture too: Safari needs each reused element to be unlocked. */
  start(prime = false): void {
    if (this.disposed) return;
    if (!this.slots[this.current].media.ended) this.play(this.slots[this.current].media);
    if (prime && !this.joining) {
      const next = this.slots[1 - this.current].media;
      // Start the silent slot once, then pause it ready for the join. Reused elements
      // retain gesture permission when their source changes later in the playlist.
      void next.play().then(() => {
        if (!this.disposed && !this.joining) { next.pause(); next.currentTime = 0; }
      }).catch(() => {});
    }
  }

  advance(): void {
    if (this.disposed || this.ctx.state !== 'running') return;
    const active = this.slots[this.current], next = this.slots[1 - this.current];
    if (!Number.isFinite(active.media.duration)) return;
    const remaining = active.media.duration - active.media.currentTime;
    if (!this.joining && remaining <= TRACK_OVERLAP && next.media.readyState >= 3) {
      this.joining = true; next.media.currentTime = 0;
      const when = this.ctx.currentTime;
      active.gain.gain.cancelScheduledValues(when); next.gain.gain.cancelScheduledValues(when);
      active.gain.gain.setValueCurveAtTime(JOIN_OUT, when, TRACK_OVERLAP);
      next.gain.gain.setValueCurveAtTime(JOIN_IN, when, TRACK_OVERLAP);
      // Audio-clock ramps continue even if a render frame or timer is delayed.
      void next.media.play().catch(() => {
        if (this.disposed || !this.joining) return;
        active.gain.gain.cancelScheduledValues(this.ctx.currentTime); next.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        active.gain.gain.value = 1; next.gain.gain.value = 0; this.joining = false;
      });
    }
    if (!this.joining) return;
    const progress = Math.min(1, next.media.currentTime / TRACK_OVERLAP);
    if (progress < 1) return;
    active.media.pause(); active.gain.gain.cancelScheduledValues(this.ctx.currentTime); active.gain.gain.value = 0;
    next.gain.gain.cancelScheduledValues(this.ctx.currentTime); next.gain.gain.value = 1;
    this.current = 1 - this.current; this.track = (this.track + 1) % this.urls.length;
    active.media.src = this.urls[(this.track + 1) % this.urls.length]; active.media.load();
    this.joining = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.media.pause(); slot.media.removeEventListener('timeupdate', this.tick); slot.media.removeEventListener('ended', this.tick);
      slot.media.removeAttribute('src'); slot.media.load(); slot.source.disconnect(); slot.gain.disconnect();
    }
  }

  private play(media: HTMLAudioElement): void {
    if (media.paused) void media.play().catch(() => {}); // A later gesture retries a locked device.
  }
}

/** Recorded 0 A.D. calm/combat music, routed through the user's existing music bus. */
export class RecordedMusic implements MusicSink {
  private calm: StreamPlaylist | null = null;
  private combat: StreamPlaylist | null = null;
  private calmGain: GainNode | null = null;
  private combatGain: GainNode | null = null;
  private mix: MixGains = { calm: 1, combat: 0 };
  private disposed = false;
  private unlocked = navigator.userActivation?.hasBeenActive ?? false;
  private readonly gesture = () => { this.unlocked = true; audioBus.unlock(); this.ensure(true); };
  private readonly timer: ReturnType<typeof setInterval>;

  constructor() {
    window.addEventListener('pointerdown', this.gesture); window.addEventListener('keydown', this.gesture);
    // Keep joins moving while the game is paused or a rendering frame is skipped.
    this.timer = setInterval(() => this.advance(audioNow()), 200);
  }

  setMix(mix: MixGains): void {
    this.mix = mix;
    const now = audioNow();
    this.calmGain?.gain.setTargetAtTime(mix.calm * 0.45, now, 0.15);
    this.combatGain?.gain.setTargetAtTime(mix.combat * 0.45, now, 0.15);
  }

  advance(_audioNow: number): void {
    if (this.disposed || !this.unlocked) return;
    const dest = audioBus.musicOut();
    if (dest?.ctx.state !== 'running') return;
    this.ensure(); this.calm?.advance(); this.combat?.advance();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; clearInterval(this.timer);
    window.removeEventListener('pointerdown', this.gesture); window.removeEventListener('keydown', this.gesture);
    this.calm?.dispose(); this.combat?.dispose(); this.calmGain?.disconnect(); this.combatGain?.disconnect();
    this.calm = null; this.combat = null; this.calmGain = null; this.combatGain = null;
  }

  private ensure(prime = false): void {
    if (this.disposed) return;
    const dest = audioBus.musicOut(); if (!dest) return;
    if (!this.calm || !this.combat) {
      this.calmGain = dest.ctx.createGain(); this.combatGain = dest.ctx.createGain();
      this.calmGain.gain.value = this.mix.calm * 0.45; this.combatGain.gain.value = this.mix.combat * 0.45;
      this.calmGain.connect(dest.music); this.combatGain.connect(dest.music);
      const urls = (files: readonly string[]) => files.map(file => `${import.meta.env.BASE_URL}audio/0ad/${file}`);
      this.calm = new StreamPlaylist(dest.ctx, this.calmGain, urls(MUSIC_TRACKS.calm));
      this.combat = new StreamPlaylist(dest.ctx, this.combatGain, urls(MUSIC_TRACKS.combat));
      this.calm.start(prime); this.combat.start(prime);
    } else if (prime) { this.calm.start(true); this.combat.start(true); }
  }
}

/** Audio clock, or 0 before the context exists. */
export function audioNow(): number { return audioBus.musicOut()?.ctx.currentTime ?? 0; }
