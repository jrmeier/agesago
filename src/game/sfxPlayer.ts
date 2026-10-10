import { audioBus } from './audioBus';
import type { Ambience, SfxKind } from './sfx';
import type { Vec2 } from '../core/types';

export interface SfxVoice {
  id: number;
  kind: SfxKind;
  gain: number;
  pan: number;
  pos: Vec2;
}

export interface SfxSink {
  play(voice: SfxVoice, onEnded: () => void): void;
  stop(id: number): void;
  setAmbient(levels: Ambience): void;
  tick(dt: number): void;
  dispose(): void;
}

const DUR: Record<SfxKind, number> = {
  chop: 0.07,
  mine: 0.09,
  forage: 0.08,
  foot: 0.05,
  hoof: 0.12,
  build: 0.08,
  ack: 0.28,
  clash: 0.11,
  arrow: 0.12,
  stone: 0.1,
  javelin: 0.11,
  death: 0.36,
  ui: 0.045,
  age: 0.9,
  ready: 0.24,
  research: 0.26,
};

interface LiveVoice {
  stop: () => void;
  done: () => void;
}

/**
 * Procedural voices on the shared effects bus. No samples are fetched.
 * Distance is already in `voice.gain`; the stereo pan places the voice left or right.
 */
export class ProceduralSfx implements SfxSink {
  private readonly live = new Map<number, LiveVoice>();
  private noise: AudioBuffer | null = null;
  private wind: GainNode | null = null;
  private water: GainNode | null = null;
  private beds = false;
  private bird = 0;
  private birdLevel = 0;

  play(voice: SfxVoice, onEnded: () => void): void {
    audioBus.unlock();
    const dest = audioBus.destination();
    if (!dest) {
      onEnded();
      return;
    }
    try {
      this.start(dest.ctx, dest.sfx, voice, onEnded);
    } catch {
      onEnded();
    }
  }

  stop(id: number): void {
    const voice = this.live.get(id);
    if (!voice) return;
    this.live.delete(id);
    voice.stop();
    voice.done();
  }

  setAmbient(levels: Ambience): void {
    this.birdLevel = levels.birds;
    const dest = audioBus.destination();
    if (!dest) return;
    try {
      this.ensureBeds(dest.ctx, dest.sfx);
      if (this.wind) this.wind.gain.value = levels.wind * 0.045;
      if (this.water) this.water.gain.value = levels.water * 0.06;
    } catch {
      // A missing filter node leaves the match silent rather than stuck.
    }
  }

  tick(dt: number): void {
    if (this.birdLevel < 0.08) return;
    this.bird += dt * (0.35 + this.birdLevel);
    if (this.bird < 1.4) return;
    this.bird = 0;
    const dest = audioBus.destination();
    if (!dest || dest.ctx.state === 'suspended') return;
    try {
      this.chirp(dest.ctx, dest.sfx, this.birdLevel);
    } catch {
      // Birds are decoration.
    }
  }

  dispose(): void {
    for (const id of [...this.live.keys()]) this.stop(id);
    this.wind?.disconnect();
    this.water?.disconnect();
    this.wind = null;
    this.water = null;
    this.beds = false;
  }

  private start(ctx: AudioContext, dest: GainNode, voice: SfxVoice, onEnded: () => void): void {
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0.0001, voice.gain);
    const out = this.pan(ctx, voice.pan);
    out.connect(gain);
    gain.connect(dest);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      window.clearTimeout(timer);
      gain.disconnect();
      this.live.delete(voice.id);
      onEnded();
    };
    const halt = this.shape(ctx, out, voice.kind, now, voice.gain);
    const timer = window.setTimeout(finish, DUR[voice.kind] * 1000 + 40);
    this.live.set(voice.id, {
      stop: () => {
        halt();
        window.clearTimeout(timer);
      },
      done: finish,
    });
  }

  private pan(ctx: AudioContext, amount: number): AudioNode {
    if (typeof ctx.createStereoPanner !== 'function') return ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, amount));
    return panner;
  }

  /** Returns a function that silences the voice immediately. */
  private shape(ctx: AudioContext, dest: AudioNode, kind: SfxKind, now: number, loud: number): () => void {
    const nodes: AudioNode[] = [];
    const tone = (freq: number, type: OscillatorType, at: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + at);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.02);
      nodes.push(osc, gain);
    };
    const knock = (at: number, dur: number, freq: number, peak: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peak, now + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(now + at);
      src.stop(now + at + dur + 0.02);
      nodes.push(src, filter, gain);
    };

    const g = 0.2 * Math.max(0.15, loud);
    switch (kind) {
      case 'chop':
        knock(0, 0.06, 900, g);
        tone(180, 'triangle', 0, 0.05, g * 0.4);
        break;
      case 'mine':
        knock(0, 0.05, 400, g);
        knock(0.05, 0.04, 280, g * 0.7);
        break;
      case 'forage':
        tone(660, 'sine', 0, 0.07, g * 0.45);
        break;
      case 'foot':
        knock(0, 0.04, 220, g * 0.55);
        break;
      case 'hoof':
        knock(0, 0.035, 180, g * 0.7);
        knock(0.07, 0.035, 160, g * 0.55);
        break;
      case 'build':
        knock(0, 0.07, 520, g * 0.8);
        break;
      case 'ack':
        tone(392, 'triangle', 0, 0.12, g * 0.55);
        tone(523.25, 'triangle', 0.1, 0.16, g * 0.4);
        break;
      case 'clash':
        knock(0, 0.08, 240, g);
        tone(140, 'sawtooth', 0, 0.07, g * 0.25);
        break;
      case 'arrow':
        tone(1600, 'sine', 0, 0.1, g * 0.3);
        knock(0, 0.1, 1800, g * 0.35);
        break;
      case 'stone':
        knock(0, 0.08, 700, g * 0.6);
        break;
      case 'javelin':
        tone(420, 'triangle', 0, 0.09, g * 0.35);
        knock(0, 0.07, 600, g * 0.3);
        break;
      case 'death':
        tone(440, 'sine', 0, 0.32, g * 0.45);
        break;
      case 'ui':
        tone(880, 'sine', 0, 0.04, g * 0.35);
        break;
      case 'age':
        tone(392, 'triangle', 0, 0.22, g * 0.5);
        tone(494, 'triangle', 0.18, 0.22, g * 0.45);
        tone(587, 'triangle', 0.36, 0.24, g * 0.45);
        tone(784, 'sine', 0.54, 0.32, g * 0.4);
        break;
      case 'ready':
        tone(523.25, 'triangle', 0, 0.12, g * 0.45);
        tone(659.25, 'triangle', 0.08, 0.14, g * 0.35);
        break;
      case 'research':
        tone(587, 'sine', 0, 0.22, g * 0.4);
        break;
      default:
        break;
    }
    return () => {
      for (const node of nodes) {
        const stopper = node as AudioNode & { stop?: () => void };
        try {
          stopper.stop?.();
        } catch {
          // Already stopped.
        }
        node.disconnect();
      }
    };
  }

  private chirp(ctx: AudioContext, dest: GainNode, level: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = 'sine';
    const freq = 1400 + Math.random() * 1200;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + 0.08);
    const peak = 0.03 * level;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  private ensureBeds(ctx: AudioContext, dest: GainNode): void {
    if (this.beds) return;
    this.beds = true;
    this.wind = this.bed(ctx, dest, 'lowpass', 420);
    this.water = this.bed(ctx, dest, 'bandpass', 900);
  }

  private bed(ctx: AudioContext, dest: GainNode, type: BiquadFilterType, freq: number): GainNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start();
    return gain;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise && this.noise.sampleRate === ctx.sampleRate) return this.noise;
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }
}
