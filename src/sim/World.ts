import { EventBus } from '../core/events';
import {
  NODE_RESOURCE,
  type Building,
  type Command,
  type Entity,
  type EntityId,
  type Heightfield,
  type MapLayout,
  type ResourceNode,
  type SimEvent,
  type Stockpile,
  type Unit,
  type Vec2,
} from '../core/types';
import { BALANCE } from './balance';

/**
 * The simulation. Plain data; mutate only through dispatch(); advance with tick(dt).
 * Owned by the Sim lane (T3). Pure TS — no three.js.
 *
 * Public surface below is FROZEN (Game, render, controls and HUD depend on it).
 * The constructor populates entities WITHOUT emitting 'spawned' — consumers read the
 * maps once at startup, then follow events.
 *
 * STUB: holds entities and teleports nothing; commands are ignored.
 */
export class World {
  readonly events = new EventBus<SimEvent>();
  readonly units = new Map<EntityId, Unit>();
  readonly nodes = new Map<EntityId, ResourceNode>();
  readonly buildings = new Map<EntityId, Building>();
  readonly stock: Stockpile = { ...BALANCE.startingStock };
  /** Simulated seconds elapsed. */
  time = 0;
  private nextId = 1;

  constructor(
    readonly hf: Heightfield,
    layout: MapLayout
  ) {
    const tc: Building = {
      id: this.nextId++,
      kind: 'townCenter',
      pos: { ...layout.townCenter },
      radius: BALANCE.townCenterRadius,
      queue: 0,
      progress: 0,
    };
    this.buildings.set(tc.id, tc);
    for (const p of layout.villagers) {
      const u: Unit = {
        id: this.nextId++,
        kind: 'villager',
        pos: { ...p },
        prevPos: { ...p },
        facing: 0,
        state: 'idle',
        path: [],
        gatherNode: null,
        gatherType: null,
        carry: null,
      };
      this.units.set(u.id, u);
    }
    for (const n of layout.nodes) {
      const node: ResourceNode = {
        id: this.nextId++,
        kind: n.kind,
        type: NODE_RESOURCE[n.kind],
        pos: { ...n.pos },
        amount: n.amount,
        radius: n.kind === 'gold' ? 0.7 : 0.5,
      };
      this.nodes.set(node.id, node);
    }
  }

  get pop(): number {
    return this.units.size;
  }

  /** The player's Town Center (drop site and trainer). */
  get townCenter(): Building {
    return this.buildings.values().next().value as Building;
  }

  get(id: EntityId): Entity | undefined {
    return this.units.get(id) ?? this.nodes.get(id) ?? this.buildings.get(id);
  }

  /** Nearest entity whose footprint is within `r` of `p`, or null. */
  entityAt(p: Vec2, r: number): EntityId | null {
    let best: EntityId | null = null;
    let bestD = Infinity;
    for (const e of [...this.units.values(), ...this.nodes.values(), ...this.buildings.values()]) {
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - ('radius' in e ? e.radius : BALANCE.villagerRadius);
      if (d <= r && d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  }

  dispatch(_cmd: Command): void {}

  /** Advance the simulation by dt seconds (called at a fixed BALANCE.tickRate). */
  tick(dt: number): void {
    for (const u of this.units.values()) u.prevPos = { ...u.pos };
    this.time += dt;
  }
}
