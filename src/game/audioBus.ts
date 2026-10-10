/** Master and channel gains. A short chime lets a volume slider be heard before music exists. */

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Effective loudness of a channel after the master gain. */
export function mixGain(master: number, channel: number): number {
  return clamp01(master) * clamp01(channel);
}

class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private volumes: Volumes = { master: 0.8, music: 0.7, sfx: 0.8 };

  setVolumes(volumes: Volumes): void {
    this.volumes = {
      master: clamp01(volumes.master),
      music: clamp01(volumes.music),
      sfx: clamp01(volumes.sfx),
    };
    this.applyGains();
  }

  /** Resume after the first gesture. iOS leaves the context suspended until then. */
  unlock(): void {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  /** Effects destination. Null when this browser has no AudioContext. */
  destination(): { ctx: AudioContext; sfx: GainNode } | null {
    const ctx = this.context();
    if (!ctx || !this.sfx) return null;
    return { ctx, sfx: this.sfx };
  }

  /** Procedural tick so the effects slider does something before the sound library lands. */
  chime(): void {
    const ctx = this.context();
    if (!ctx || !this.sfx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    try {
      this.playChime(ctx);
    } catch {
      // A locked audio device should not break the settings sheet.
    }
  }

  private playChime(ctx: AudioContext): void {
    if (!this.sfx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 523.25;
    const now = ctx.currentTime;
    const peak = Math.max(0.0001, mixGain(this.volumes.master, this.volumes.sfx) * 0.25);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyGains();
      return this.ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  private applyGains(): void {
    if (!this.master || !this.music || !this.sfx) return;
    this.master.gain.value = this.volumes.master;
    this.music.gain.value = this.volumes.music;
    this.sfx.gain.value = this.volumes.sfx;
  }
}

export const audioBus = new AudioBus();

/** First pointer unlocks audio. iOS will not start a context without a gesture. */
export function bindAudioUnlock(bus: { unlock(): void }, target: EventTarget): () => void {
  const unlock = () => bus.unlock();
  target.addEventListener('pointerdown', unlock);
  return () => target.removeEventListener('pointerdown', unlock);
}
