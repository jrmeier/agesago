import { EventBus } from '../core/events';
import type { Building, EntityId, EntityKind, PlayerId, SimEvent, Unit, Vec2 } from '../core/types';
import { UNITS } from '../core/units';
import { ProceduralSfx, type SfxSink, type SfxVoice } from './sfxPlayer';
import {
  ambienceOf,
  canHearSource,
  heardGain,
  SoundClock,
  stereoPan,
  VoicePool,
  workKind,
  type HeardSample,
  type SfxEar,
  type SfxKind,
} from './sfx';

/** The slice of the world the ear reads. The live World satisfies it. */
export interface HearWorld {
  time: number;
  localPlayer: PlayerId;
  units: { values(): Iterable<Unit> };
  buildings: { get(id: EntityId): Building | undefined; values(): Iterable<Building> };
  events: EventBus<SimEvent>;
  areEnemies(a: PlayerId, b: PlayerId): boolean;
  visibilityOf(player: PlayerId): {
    isVisible(x: number, z: number): boolean;
    isExplored(x: number, z: number): boolean;
  };
  hf: {
    isWater(x: number, z: number): boolean;
    forestDensity(x: number, z: number): number;
  };
}

interface Cue {
  kind: SfxKind;
  pos: Vec2;
  owner: PlayerId;
  key?: string;
  gap?: number;
}

const MOVE: ReadonlySet<Unit['state']> = new Set(['moving', 'toNode', 'toDrop', 'exploring', 'toBuild', 'toShelter']);
const ACK: ReadonlySet<Unit['state']> = new Set(['moving', 'toNode', 'attacking', 'toBuild', 'exploring']);

/**
 * Turns simulation events and the camera into voices.
 * Enemies outside visible fog are dropped before they take a voice.
 */
export class MatchAudio {
  private readonly pool = new VoicePool();
  private readonly clock = new SoundClock();
  private readonly off: Array<() => void> = [];
  private ear: SfxEar = { at: { x: 0, z: 0 }, right: { x: 1, z: 0 } };
  private readonly onPointer: (event: Event) => void;

  constructor(
    private readonly world: HearWorld,
    private readonly sink: SfxSink = new ProceduralSfx(),
  ) {
    const bus = world.events;
    this.off.push(bus.on('damaged', (event) => this.onDamaged(event.id)));
    this.off.push(bus.on('died', (event) => this.offer({ kind: 'death', pos: event.pos, owner: event.owner, key: `die:${event.id}`, gap: 0.05 })));
    this.off.push(bus.on('projectile', (event) => this.onProjectile(event.kind, event.from)));
    this.off.push(bus.on('constructed', (event) => this.onConstructed(event.id)));
    this.off.push(bus.on('spawned', (event) => this.onSpawned(event.id, event.kind)));
    this.off.push(bus.on('researched', (event) => this.onOwned(event.owner, 'research')));
    this.off.push(bus.on('agedUp', (event) => this.onOwned(event.owner, 'age')));
    this.off.push(bus.on('unitState', (event) => this.onUnitState(event.id, event.state)));
    this.onPointer = (event) => this.onClick(event);
    if (typeof document !== 'undefined') document.addEventListener('pointerdown', this.onPointer, true);
  }

  setEar(ear: SfxEar): void {
    this.ear = ear;
  }

  /** Repeating work, footsteps, and the beds for the land in view. */
  pulse(samples: readonly Vec2[], live: boolean, dt: number): void {
    if (live) this.work();
    this.sink.setAmbient(ambienceOf(samples.map((pos) => this.sample(pos))));
    this.sink.tick(dt);
  }

  dispose(): void {
    for (const unlisten of this.off) unlisten();
    this.off.length = 0;
    if (typeof document !== 'undefined') document.removeEventListener('pointerdown', this.onPointer, true);
    this.sink.dispose();
  }

  private onDamaged(id: EntityId): void {
    const unit = this.unit(id);
    if (unit) {
      this.offer({ kind: 'clash', pos: unit.pos, owner: unit.owner, key: `hit:${id}`, gap: 0.12 });
      return;
    }
    const building = this.world.buildings.get(id);
    if (building) this.offer({ kind: 'clash', pos: building.pos, owner: building.owner, key: `hit:${id}`, gap: 0.12 });
  }

  private onProjectile(kind: 'arrow' | 'stone' | 'javelin', from: Vec2): void {
    const vis = this.world.visibilityOf(this.world.localPlayer);
    if (!vis.isVisible(from.x, from.z)) return;
    this.offer({ kind, pos: from, owner: this.world.localPlayer });
  }

  private onConstructed(id: EntityId): void {
    const building = this.world.buildings.get(id);
    if (!building) return;
    this.offer({ kind: 'ready', pos: building.pos, owner: building.owner });
  }

  private onSpawned(id: EntityId, kind: EntityKind): void {
    if (!(kind in UNITS)) return;
    const unit = this.unit(id);
    if (!unit || UNITS[unit.kind].unitClass === 'wildlife') return;
    this.offer({ kind: 'ready', pos: unit.pos, owner: unit.owner });
  }

  private onOwned(owner: PlayerId, kind: SfxKind): void {
    let pos: Vec2 = { x: this.ear.at.x, z: this.ear.at.z };
    for (const building of this.world.buildings.values()) {
      if (building.owner === owner) {
        pos = building.pos;
        break;
      }
    }
    this.offer({ kind, pos, owner });
  }

  private onUnitState(id: EntityId, state: Unit['state']): void {
    const unit = this.unit(id);
    if (!unit || unit.owner !== this.world.localPlayer || !ACK.has(state)) return;
    this.offer({ kind: 'ack', pos: unit.pos, owner: unit.owner, key: 'ack', gap: 0.4 });
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('button')) return;
    this.offer({ kind: 'ui', pos: this.ear.at, owner: this.world.localPlayer });
  }

  private work(): void {
    for (const unit of this.world.units.values()) {
      if (unit.state === 'gathering') {
        this.offer({ kind: workKind(unit.gatherType), pos: unit.pos, owner: unit.owner, key: `work:${unit.id}`, gap: 0.75 });
      } else if (unit.state === 'building') {
        this.offer({ kind: 'build', pos: unit.pos, owner: unit.owner, key: `work:${unit.id}`, gap: 0.7 });
      } else if (MOVE.has(unit.state)) {
        const mounted = UNITS[unit.kind].unitClass === 'cavalry';
        this.offer({
          kind: mounted ? 'hoof' : 'foot',
          pos: unit.pos,
          owner: unit.owner,
          key: `step:${unit.id}`,
          gap: mounted ? 0.38 : 0.48,
        });
      }
    }
  }

  private sample(pos: Vec2): HeardSample {
    const vis = this.world.visibilityOf(this.world.localPlayer);
    const explored = vis.isExplored(pos.x, pos.z) || vis.isVisible(pos.x, pos.z);
    return {
      water: this.world.hf.isWater(pos.x, pos.z),
      forest: this.world.hf.forestDensity(pos.x, pos.z),
      explored,
    };
  }

  private offer(cue: Cue): void {
    const vis = this.world.visibilityOf(this.world.localPlayer);
    const visible = vis.isVisible(cue.pos.x, cue.pos.z);
    const enemy = this.world.areEnemies(cue.owner, this.world.localPlayer);
    if (!canHearSource(cue.owner, this.world.localPlayer, enemy, visible)) return;
    if (cue.key !== undefined && cue.gap !== undefined && !this.clock.due(cue.key, this.world.time, cue.gap)) return;
    const gain = heardGain(cue.kind, cue.owner, this.world.localPlayer, this.ear, cue.pos);
    if (gain <= 0.02) return;
    const slot = this.pool.acquire();
    if (slot.evicted !== null) this.sink.stop(slot.evicted);
    this.voice({
      id: slot.id,
      kind: cue.kind,
      gain,
      pan: stereoPan(this.ear, cue.pos),
      pos: cue.pos,
    });
  }

  private voice(voice: SfxVoice): void {
    this.sink.play(voice, () => this.pool.release(voice.id));
  }

  private unit(id: EntityId): Unit | undefined {
    for (const unit of this.world.units.values()) if (unit.id === id) return unit;
    return undefined;
  }
}
