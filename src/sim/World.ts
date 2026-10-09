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
  type UnitKind,
  type UnitState,
  type Vec2,
} from '../core/types';
import { BALANCE } from './balance';
import { NavGrid } from './nav';
import { SIGHT, Visibility, sightOf, type Viewer } from './visibility';
import { exploreSystem, orderExplore, type ExploreState } from './systems/explore';
import { gatherSystem, orderGather, type GatherState } from './systems/gather';
import { movementSystem, orderMove } from './systems/movement';
import { orderTrain, trainSystem } from './systems/train';

/**
 * The simulation. Plain data; mutate only through dispatch(); advance with tick(dt).
 * Owned by the Sim lane (T3). Pure TS — no three.js.
 *
 * Public surface below is FROZEN (Game, render, controls and HUD depend on it).
 * The constructor populates entities WITHOUT emitting 'spawned' — consumers read the
 * maps once at startup, then follow events.
 */
/** Seconds between fog-of-war recomputes. */
const FOG_INTERVAL = 0.2;

export class World {
  readonly events = new EventBus<SimEvent>();
  readonly units = new Map<EntityId, Unit>();
  readonly nodes = new Map<EntityId, ResourceNode>();
  readonly buildings = new Map<EntityId, Building>();
  readonly stock: Stockpile = { ...BALANCE.startingStock };
  /** Simulated seconds elapsed. */
  time = 0;
  /** Navigation grid over the terrain with building footprints blocked. */
  readonly nav: NavGrid;
  /** Fog of war for the (single) player. */
  readonly visibility: Visibility;
  private fogClock = 0;
  /** Per-unit gather timer and retarget anchor (system bookkeeping, not rendered). */
  readonly gatherState = new Map<EntityId, GatherState>();
  /** Per-unit auto-explore target (system bookkeeping, not rendered). */
  readonly exploreState = new Map<EntityId, ExploreState>();
  /** Explorers waiting for a frontier search, oldest first (searches are staggered across ticks). */
  readonly exploreQueue = new Set<EntityId>();
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
    const scenery = layout.props
      .filter((p) => p.blockRadius > 0)
      .map((p) => ({ pos: { ...p.pos }, radius: p.blockRadius }));
    this.nav = new NavGrid(hf, [tc, ...scenery]);
    this.visibility = new Visibility(hf.width, hf.depth);
    for (const p of layout.villagers) this.addUnit('villager', p);
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
    // After the nodes, so node ids stay what they were before scouts existed.
    for (const p of layout.scouts) this.addUnit('scout', p);
    this.updateFog();
  }

  /** Every unit (villagers and scouts) — the pop cap applies to all of them. */
  get pop(): number {
    return this.units.size;
  }

  /** Units of kind 'villager'. */
  get villagerCount(): number {
    let n = 0;
    for (const u of this.units.values()) if (u.kind === 'villager') n++;
    return n;
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

  dispatch(cmd: Command): void {
    switch (cmd.type) {
      case 'move':
        orderMove(this, cmd.unitIds, cmd.target);
        break;
      case 'gather':
        orderGather(this, cmd.unitIds, cmd.nodeId);
        break;
      case 'train':
        orderTrain(this, cmd.buildingId);
        break;
      case 'explore':
        orderExplore(this, cmd.unitIds);
        break;
    }
  }

  /** Advance the simulation by dt seconds (called at a fixed BALANCE.tickRate). */
  tick(dt: number): void {
    for (const u of this.units.values()) u.prevPos = { ...u.pos };
    const arrived = movementSystem(this, dt);
    gatherSystem(this, dt, arrived);
    exploreSystem(this);
    trainSystem(this, dt);
    this.time += dt;
    this.fogClock -= dt;
    if (this.fogClock <= 0) {
      this.fogClock = FOG_INTERVAL;
      this.updateFog();
    }
  }

  /** Recompute fog of war from every unit and building's sight radius. */
  updateFog(): void {
    const viewers: Viewer[] = [];
    for (const u of this.units.values()) viewers.push({ pos: u.pos, sight: sightOf(u.kind) });
    for (const b of this.buildings.values()) viewers.push({ pos: b.pos, sight: SIGHT.townCenter });
    this.visibility.update(viewers);
  }

  /** Change a unit's state, emitting 'unitState' if it actually changed. */
  setState(u: Unit, state: UnitState): void {
    if (u.state === state) return;
    u.state = state;
    this.events.emit({ type: 'unitState', id: u.id, state });
  }

  /** Emit the current stockpile and population. */
  emitStock(): void {
    this.events.emit({ type: 'stockpile', stock: { ...this.stock }, pop: this.pop });
  }

  /** Create a villager at `p` and emit 'spawned'. */
  spawnVillager(p: Vec2): Unit {
    return this.spawnUnit('villager', p);
  }

  /** Create a unit of `kind` at `p` and emit 'spawned'. */
  spawnUnit(kind: UnitKind, p: Vec2): Unit {
    const u = this.addUnit(kind, p);
    this.events.emit({ type: 'spawned', id: u.id, kind });
    return u;
  }

  /** Point just outside a footprint of `radius` around `center`, on the side facing `from`. */
  approachPoint(from: Vec2, center: Vec2, radius: number): Vec2 {
    const dx = from.x - center.x;
    const dz = from.z - center.z;
    const d = Math.hypot(dx, dz);
    const r = radius + BALANCE.villagerRadius + BALANCE.approachGap;
    if (d < 1e-6) return { x: center.x, z: center.z + r };
    return { x: center.x + (dx / d) * r, z: center.z + (dz / d) * r };
  }

  private addUnit(kind: UnitKind, p: Vec2): Unit {
    const u: Unit = {
      id: this.nextId++,
      kind,
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
    return u;
  }
}
