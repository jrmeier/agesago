import { BUILDINGS, MAX_POP, footprintRadius } from '../core/buildings';
import { EventBus } from '../core/events';
import { UNITS } from '../core/units';
import {
  NODE_RESOURCE,
  type Player,
  type PlayerId,
  type StartLayout,
  type Building,
  type BuildingKind,
  type PlacementCheck,
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
import { Visibility, sightOf, type Viewer } from './visibility';
import { buildSystem, canPlace, orderBuild, orderCancelBuild, orderConstruct } from './systems/build';
import {
  combatSystem,
  orderAttack,
  orderAttackMove,
  orderRally,
  orderStance,
  orderStop,
  releaseCombat,
  type CombatState,
  type FleeState,
  type PendingHit,
} from './systems/combat';
import { exploreSystem, orderExplore, type ExploreState } from './systems/explore';
import { gatherSystem, orderFarm, orderGather, type GatherState } from './systems/gather';
import { buildingRect } from './systems/sites';
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

/** Default player roster: player 1 is the local human, the rest AI opponents. */
export const PLAYER_COLORS = [0x2f6fb5, 0xb23a32, 0xd4a843, 0x3f8a4a];

export function defaultPlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? 'You' : `Rival ${i}`,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    team: i + 1,
    control: i === 0 ? 'human' : 'ai',
  }));
}

/** Per-player economy and knowledge. */
export interface PlayerState {
  readonly player: Player;
  readonly stock: Stockpile;
  readonly visibility: Visibility;
}

export class World {
  readonly events = new EventBus<SimEvent>();
  readonly units = new Map<EntityId, Unit>();
  readonly nodes = new Map<EntityId, ResourceNode>();
  readonly buildings = new Map<EntityId, Building>();
  /** Everyone in the game, by id (gaia is not listed). */
  readonly players = new Map<PlayerId, PlayerState>();
  /** The player this client controls and renders for. */
  readonly localPlayer: PlayerId = 1;
  /** Simulated seconds elapsed. */
  time = 0;
  /** Navigation grid over the terrain with building footprints blocked. */
  readonly nav: NavGrid;
  private fogClock = 0;
  /** Per-unit gather timer and retarget anchor (system bookkeeping, not rendered). */
  readonly gatherState = new Map<EntityId, GatherState>();
  /** Per-unit auto-explore target (system bookkeeping, not rendered). */
  readonly exploreState = new Map<EntityId, ExploreState>();
  /** Explorers waiting for a frontier search, oldest first (searches are staggered across ticks). */
  readonly exploreQueue = new Set<EntityId>();
  /** Builder unit → the foundation it is walking to / working on (system bookkeeping). */
  readonly buildState = new Map<EntityId, EntityId>();
  /** Farm → the one villager working it (system bookkeeping; stale claims are dropped lazily). */
  readonly farmers = new Map<EntityId, EntityId>();
  /** Per-unit combat bookkeeping: order, cooldown, chase and leash (system bookkeeping). */
  readonly combatState = new Map<EntityId, CombatState>();
  /** Villagers running from an attacker → the work they resume afterwards. */
  readonly fleeState = new Map<EntityId, FleeState>();
  /** Projectiles in flight (damage lands on impact). */
  readonly projectiles: PendingHit[] = [];
  /** Sim time of each player's last 'attacked' alert (rate limit). */
  readonly lastAlert = new Map<PlayerId, number>();
  /** Ticks run by the combat system (staggers target scans). */
  combatTicks = 0;
  private nextId = 1;

  constructor(
    readonly hf: Heightfield,
    layout: MapLayout,
    players: Player[] = defaultPlayers(1 + (layout.extraStarts?.length ?? 0))
  ) {
    for (const player of players) {
      this.players.set(player.id, {
        player,
        stock: { ...BALANCE.startingStock },
        visibility: new Visibility(hf.width, hf.depth),
      });
    }
    const starts: StartLayout[] = [layout, ...(layout.extraStarts ?? [])];
    const scenery = layout.props
      .filter((p) => p.blockRadius > 0)
      .map((p) => ({ pos: { ...p.pos }, radius: p.blockRadius }));
    // Circles are static scenery; buildings (Town Centers included) are rectangular footprints.
    this.nav = new NavGrid(hf, scenery);
    // Town Centers first (player 1's is id 1), then villagers, matching the historical id order.
    const tcs = starts.map((start, i) => this.addTownCenter(start.townCenter, i + 1));
    for (const tc of tcs) this.nav.addRect(tc.id, buildingRect(tc));
    starts.forEach((start, i) => {
      for (const p of start.villagers) this.addUnit('villager', p, i + 1);
    });
    for (const n of layout.nodes) {
      const node: ResourceNode = {
        id: this.nextId++,
        kind: n.kind,
        type: NODE_RESOURCE[n.kind],
        pos: { ...n.pos },
        amount: n.amount,
        radius: n.kind === 'gold' || n.kind === 'stone' ? 0.7 : 0.5,
      };
      this.nodes.set(node.id, node);
    }
    // After the nodes, so node ids stay what they were before scouts existed.
    starts.forEach((start, i) => {
      for (const p of start.scouts) this.addUnit('scout', p, i + 1);
    });
    this.updateFog();
  }

  /** The local player's stockpile (what the HUD shows). */
  get stock(): Stockpile {
    return this.stockOf(this.localPlayer);
  }

  /** The local player's fog of war (what the renderer shows). */
  get visibility(): Visibility {
    return this.visibilityOf(this.localPlayer);
  }

  stockOf(player: PlayerId): Stockpile {
    const st = this.players.get(player);
    if (!st) throw new Error(`no player ${player}`);
    return st.stock;
  }

  visibilityOf(player: PlayerId): Visibility {
    const st = this.players.get(player);
    if (!st) throw new Error(`no player ${player}`);
    return st.visibility;
  }

  /** Are these two players enemies? Gaia is nobody's enemy (wildlife aggression is per-animal). */
  areEnemies(a: PlayerId, b: PlayerId): boolean {
    if (a === b || a === 0 || b === 0) return false;
    const pa = this.players.get(a)?.player;
    const pb = this.players.get(b)?.player;
    return !!pa && !!pb && pa.team !== pb.team;
  }

  /** The local player's housing capacity. */
  get popCap(): number {
    return this.popCapOf(this.localPlayer);
  }

  /** Housing capacity from a player's completed buildings, capped at MAX_POP. */
  popCapOf(player: PlayerId): number {
    let cap = 0;
    for (const b of this.buildings.values()) if (b.complete && b.owner === player) cap += BUILDINGS[b.kind].popBonus;
    return Math.min(MAX_POP, cap);
  }

  /** Every unit a player owns counts toward the pop cap. */
  popOf(player: PlayerId): number {
    let n = 0;
    for (const u of this.units.values()) if (u.owner === player) n++;
    return n;
  }

  /**
   * Can a `kind` building go at `pos` with yaw `rot`? Checks bounds, water, slope, explored
   * ground, overlaps and cost. FROZEN signature (UI placement mode calls it every frame).
   * Units never block placement (they are nudged aside); see systems/build.ts canPlace.
   */
  canPlace(kind: BuildingKind, pos: Vec2, rot: number, by: PlayerId = this.localPlayer): PlacementCheck {
    return canPlace(this, kind, pos, rot, by);
  }

  /** The local player's population. */
  get pop(): number {
    return this.popOf(this.localPlayer);
  }

  /** The local player's villagers. */
  get villagerCount(): number {
    let n = 0;
    for (const u of this.units.values()) if (u.kind === 'villager' && u.owner === this.localPlayer) n++;
    return n;
  }

  /** The local player's (first) Town Center. */
  get townCenter(): Building {
    return this.townCenterOf(this.localPlayer) as Building;
  }

  /** A player's first standing Town Center, if any. */
  townCenterOf(player: PlayerId): Building | undefined {
    for (const b of this.buildings.values()) if (b.kind === 'townCenter' && b.owner === player) return b;
    return undefined;
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

  /**
   * Apply a command on behalf of `by` (default: the local player). Units and buildings `by`
   * doesn't own are ignored, so a client can only ever command its own side.
   */
  dispatch(cmd: Command, by: PlayerId = this.localPlayer): void {
    cmd = this.ownedOnly(cmd, by);
    // Any other unit order supersedes fighting and fleeing.
    if (cmd.type === 'move' || cmd.type === 'gather' || cmd.type === 'build' || cmd.type === 'construct' || cmd.type === 'explore') {
      releaseCombat(this, cmd.unitIds);
    }
    switch (cmd.type) {
      case 'move':
        orderMove(this, cmd.unitIds, cmd.target);
        break;
      case 'gather': {
        // A building id means: farm it (or reseed it if fallow), or help build a foundation.
        const b = this.nodes.has(cmd.nodeId) ? undefined : this.buildings.get(cmd.nodeId);
        if (b && (!b.complete || (b.kind === 'farm' && !(b.food! > 0)))) orderConstruct(this, cmd.unitIds, b.id);
        else if (b && b.kind === 'farm') orderFarm(this, cmd.unitIds, b);
        else orderGather(this, cmd.unitIds, cmd.nodeId);
        break;
      }
      case 'train':
        if (this.buildings.get(cmd.buildingId)?.owner === by) orderTrain(this, cmd.buildingId, cmd.unit);
        break;
      case 'build':
        orderBuild(this, cmd.unitIds, cmd.kind, cmd.pos, cmd.rot, by);
        break;
      case 'construct':
        orderConstruct(this, cmd.unitIds, cmd.buildingId);
        break;
      case 'cancelBuild':
        if (this.buildings.get(cmd.buildingId)?.owner === by) orderCancelBuild(this, cmd.buildingId);
        break;
      case 'explore':
        orderExplore(this, cmd.unitIds);
        break;
      case 'attack':
        if (cmd.unitIds.length) orderAttack(this, cmd.unitIds, cmd.targetId, by);
        break;
      case 'attackMove':
        orderAttackMove(this, cmd.unitIds, cmd.target);
        break;
      case 'stop':
        orderStop(this, cmd.unitIds);
        break;
      case 'stance':
        orderStance(this, cmd.unitIds, cmd.stance);
        break;
      case 'resign':
        // Victory/defeat lands in the game-flow lane (systems/victory.ts).
        break;
      case 'rally': {
        const b = this.buildings.get(cmd.buildingId);
        if (b?.owner === by) orderRally(this, b, cmd.pos, cmd.targetId);
        else this.events.emit({ type: 'rejected', reason: 'invalid-target' });
        break;
      }
    }
  }

  /** Strip unit ids the issuer doesn't own. */
  private ownedOnly(cmd: Command, by: PlayerId): Command {
    if (!('unitIds' in cmd)) return cmd;
    const unitIds = cmd.unitIds.filter((id) => this.units.get(id)?.owner === by);
    return unitIds.length === cmd.unitIds.length ? cmd : { ...cmd, unitIds };
  }

  /** Advance the simulation by dt seconds (called at a fixed BALANCE.tickRate). */
  tick(dt: number): void {
    for (const u of this.units.values()) u.prevPos = { ...u.pos };
    const arrived = movementSystem(this, dt);
    gatherSystem(this, dt, arrived);
    buildSystem(this, dt, arrived);
    // After gather/build so units it sends back to work aren't treated as arrivals this tick.
    combatSystem(this, dt, arrived);
    exploreSystem(this);
    trainSystem(this, dt);
    this.time += dt;
    this.fogClock -= dt;
    if (this.fogClock <= 0) {
      this.fogClock = FOG_INTERVAL;
      this.updateFog();
    }
  }

  /** Recompute every player's fog from their units' and complete buildings' sight (foundations see nothing). */
  updateFog(): void {
    const viewers = new Map<PlayerId, Viewer[]>();
    for (const id of this.players.keys()) viewers.set(id, []);
    for (const u of this.units.values()) viewers.get(u.owner)?.push({ pos: u.pos, sight: sightOf(u.kind) });
    for (const b of this.buildings.values()) {
      if (b.complete) viewers.get(b.owner)?.push({ pos: b.pos, sight: BUILDINGS[b.kind].sight });
    }
    for (const [id, list] of viewers) this.visibilityOf(id).update(list);
  }

  /** Recompute fog on the next tick (e.g. a building just finished). */
  refreshFog(): void {
    this.fogClock = 0;
  }

  /** A fresh entity id. */
  allocId(): EntityId {
    return this.nextId++;
  }

  /** Change a unit's state, emitting 'unitState' if it actually changed. */
  setState(u: Unit, state: UnitState): void {
    if (u.state === state) return;
    u.state = state;
    this.events.emit({ type: 'unitState', id: u.id, state });
  }

  /** Emit the local player's stockpile and population (the HUD listens). */
  emitStock(): void {
    this.events.emit({ type: 'stockpile', stock: { ...this.stock }, pop: this.pop, popCap: this.popCap });
  }

  /** Create a villager at `p` and emit 'spawned'. */
  spawnVillager(p: Vec2, owner: PlayerId = this.localPlayer): Unit {
    return this.spawnUnit('villager', p, owner);
  }

  /** Create a unit of `kind` at `p` and emit 'spawned'. */
  spawnUnit(kind: UnitKind, p: Vec2, owner: PlayerId = this.localPlayer): Unit {
    const u = this.addUnit(kind, p, owner);
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

  private addTownCenter(pos: Vec2, owner: PlayerId): Building {
    const spec = BUILDINGS.townCenter;
    const tc: Building = {
      id: this.nextId++,
      kind: 'townCenter',
      owner,
      hp: spec.hp,
      maxHp: spec.hp,
      pos: { ...pos },
      rot: 0,
      radius: footprintRadius('townCenter'),
      complete: true,
      buildProgress: 1,
      queue: 0,
      progress: 0,
    };
    this.buildings.set(tc.id, tc);
    return tc;
  }

  private addUnit(kind: UnitKind, p: Vec2, owner: PlayerId): Unit {
    const hp = UNITS[kind].hp;
    const u: Unit = {
      id: this.nextId++,
      kind,
      owner,
      hp,
      maxHp: hp,
      target: null,
      stance: kind === 'villager' ? 'passive' : 'aggressive',
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
