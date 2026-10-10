import type { PlayerId, ResourceType, Vec2 } from '../core/types';
import { GAIA } from '../core/types';

/** One-shot voices. Ambient beds sit outside this cap. */
export const VOICE_LIMIT = 8;

/** Full volume inside this distance (world units). */
export const SFX_REF_DISTANCE = 12;
/** Silence past this distance. */
export const SFX_MAX_DISTANCE = 55;

/** No recorded SFX samples. Effects synthesis runs in the browser. */
export const BUNDLED_AUDIO_BYTES = 0;

export const SFX_KINDS = [
  'chop',
  'mine',
  'forage',
  'foot',
  'hoof',
  'build',
  'ack',
  'clash',
  'arrow',
  'stone',
  'javelin',
  'death',
  'ui',
  'age',
  'ready',
  'research',
] as const;

export type SfxKind = (typeof SFX_KINDS)[number];

/** Local ceremonies stay audible when the camera is across the map. */
const CEREMONY: ReadonlySet<SfxKind> = new Set(['ack', 'age', 'ready', 'research', 'ui']);

export interface SfxEar {
  at: Vec2;
  /** Unit vector pointing to the listener's right, on the ground. */
  right: Vec2;
}

export interface Ambience {
  wind: number;
  birds: number;
  water: number;
}

export interface HeardSample {
  water: boolean;
  /** 0..1 cover. Birds use the dry part of this. */
  forest: number;
  explored: boolean;
}

/**
 * Own units are always audible. Enemies and gaia are silent while their cell is not visible,
 * so a fight in the fog makes no sound.
 */
export function canHearSource(owner: PlayerId, local: PlayerId, enemy: boolean, visible: boolean): boolean {
  if (owner === local) return true;
  if (!visible && (enemy || owner === GAIA)) return false;
  return true;
}

/** 1 beside the camera, falling to 0 at {@link SFX_MAX_DISTANCE}. */
export function distanceGain(
  listener: Vec2,
  source: Vec2,
  ref = SFX_REF_DISTANCE,
  max = SFX_MAX_DISTANCE,
): number {
  const d = Math.hypot(listener.x - source.x, listener.z - source.z);
  if (d >= max) return 0;
  if (d <= ref) return 1;
  return (max - d) / (max - ref);
}

/** -1 left, +1 right, 0 ahead or behind. */
export function stereoPan(ear: SfxEar, source: Vec2): number {
  const dx = source.x - ear.at.x;
  const dz = source.z - ear.at.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return 0;
  const side = (dx * ear.right.x + dz * ear.right.z) / dist;
  return Math.max(-1, Math.min(1, side));
}

/** Loudness after distance. Local orders and ceremonies keep a floor. */
export function heardGain(kind: SfxKind, owner: PlayerId, local: PlayerId, ear: SfxEar, source: Vec2): number {
  const gain = distanceGain(ear.at, source);
  if (owner === local && CEREMONY.has(kind)) return Math.max(gain, 0.65);
  return gain;
}

export function workKind(resource: ResourceType | null): SfxKind {
  if (resource === 'wood') return 'chop';
  if (resource === 'gold' || resource === 'stone') return 'mine';
  return 'forage';
}

/**
 * What the camera can hear of the land it is looking at.
 * Unexplored ground contributes nothing but a thin wind.
 */
export function ambienceOf(samples: readonly HeardSample[]): Ambience {
  if (samples.length === 0) return { wind: 0, birds: 0, water: 0 };
  let seen = 0;
  let water = 0;
  let forest = 0;
  for (const sample of samples) {
    if (!sample.explored) continue;
    seen += 1;
    if (sample.water) water += 1;
    else forest += Math.max(0, Math.min(1, sample.forest));
  }
  const n = samples.length;
  return {
    wind: seen === 0 ? 0.05 : 0.12 + 0.28 * (seen / n),
    birds: Math.min(1, forest / n),
    water: water / n,
  };
}

/** Drops the oldest voice once `limit` are in flight. */
export class VoicePool {
  private order: number[] = [];
  private seq = 1;

  constructor(readonly limit = VOICE_LIMIT) {}

  get size(): number {
    return this.order.length;
  }

  acquire(): { id: number; evicted: number | null } {
    let evicted: number | null = null;
    if (this.order.length >= this.limit) evicted = this.order.shift() ?? null;
    const id = this.seq++;
    this.order.push(id);
    return { id, evicted };
  }

  release(id: number): void {
    const index = this.order.indexOf(id);
    if (index >= 0) this.order.splice(index, 1);
  }
}

/** Per-key gap so a gatherer or a group order does not restack the same voice. */
export class SoundClock {
  private next = new Map<string, number>();

  /** True when `key` may sound at `time`. Books the next slot `gap` seconds later. */
  due(key: string, time: number, gap: number): boolean {
    const at = this.next.get(key) ?? -Infinity;
    if (time < at) return false;
    this.next.set(key, time + gap);
    return true;
  }
}
