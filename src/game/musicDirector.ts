import { EventBus } from '../core/events';
import type { Building, EntityId, PlayerId, SimEvent, Unit } from '../core/types';
import { MusicEngine, type MusicSink } from './music';
import { RecordedMusic, audioNow } from './musicPlayer';

/** The slice of the world the score reads. */
export interface MusicWorld {
  time: number;
  localPlayer: PlayerId;
  units: { get(id: EntityId): Unit | undefined };
  buildings: { get(id: EntityId): Building | undefined };
  events: EventBus<SimEvent>;
}

/**
 * Calm and combat beds. A fight involving the local player raises the combat bed,
 * and it falls again after the fighting stops.
 */
export class MatchMusic {
  private readonly engine: MusicEngine;
  private readonly off: Array<() => void> = [];

  constructor(world: MusicWorld, sink?: MusicSink) {
    this.engine = new MusicEngine(sink ?? new RecordedMusic());
    const bus = world.events;
    this.off.push(bus.on('attacked', (event) => {
      if (event.owner === world.localPlayer) this.engine.hit(world.time);
    }));
    this.off.push(bus.on('died', (event) => {
      if (event.owner === world.localPlayer) this.engine.hit(world.time);
    }));
    this.off.push(bus.on('damaged', (event) => {
      const victim = world.units.get(event.id) ?? world.buildings.get(event.id);
      const attacker = event.by == null ? undefined : world.units.get(event.by);
      if (victim?.owner === world.localPlayer || attacker?.owner === world.localPlayer) this.engine.hit(world.time);
    }));
    this.off.push(bus.on('unitState', (event) => {
      if (event.state !== 'attacking') return;
      const unit = world.units.get(event.id);
      if (unit?.owner === world.localPlayer) this.engine.hit(world.time);
    }));
  }

  /** Keep the playlist advancing and the crossfade current. */
  advance(simTime: number, now = audioNow()): void {
    this.engine.advance(simTime, now);
  }

  dispose(): void {
    for (const unlisten of this.off) unlisten();
    this.off.length = 0;
    this.engine.dispose();
  }
}
