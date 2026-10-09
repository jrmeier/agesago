import { BUILDINGS } from '../../core/buildings';
import type { Building, EntityId, PlayerId, ResourceType, Stance, Unit, UnitKind, UnitState, Vec2 } from '../../core/types';
import { isAnimal, UNITS } from '../../core/units';
import { GAIA } from '../../core/types';
import { BALANCE } from '../balance';
import type { World } from '../World';
import { removeBuilding, sendBuilders } from './build';
import { route } from './passage';
import { cancelExplore, settleCancelled } from './explore';
import { nearestSources, sendToDrop, sendToFarm, sendToNode, sendToSource } from './gather';
import { formationOffset } from './movement';
import { siteApproach } from './sites';
import { playerHasFlag } from './research';
import { carryCap } from './gather';
import { armorOf, buildingAttack, damageTo, edgeDistance, isRanged, nearestPoint, unitRadius, unitRange, unitSight, unitSpeed } from './stats';

/** Per-unit combat bookkeeping kept off the frozen Unit shape (created on first engagement). */
export interface CombatState {
  /** The player's order: 'attack' a chosen target, 'attackMove' to `dest`; null = acting on its own. */
  order: 'attack' | 'attackMove' | null;
  /** Attack-move destination (resumed after each fight). */
  dest: Vec2 | null;
  /** Where a defensive unit returns after a fight. */
  post: Vec2 | null;
  /** Seconds until the next strike. */
  cooldown: number;
  /** Seconds until the chase may re-path. */
  repath: number;
  /** End of the current chase path. */
  goal: Vec2 | null;
  /** Leash anchor: where the target was last in range (or first acquired). */
  anchor: Vec2 | null;
  /** Sim time the target was last visible to the owner (or the fight started). */
  seen: number;
}

/** A villager running from an attacker, and the work it goes back to. */
export interface FleeState {
  node: EntityId | null;
  type: ResourceType | null;
  build: EntityId | null;
}

/** A projectile in flight; damage lands at `at` if the target is still near `aim`. */
export interface PendingHit {
  at: number;
  targetId: EntityId;
  aim: Vec2;
  by: EntityId;
  kind: UnitKind;
  owner: PlayerId;
  from: Vec2;
  /** Building shot: pierce damage, instead of `kind`'s attack. */
  pierce?: number;
}

type Target = Unit | Building;

const isUnit = (e: Target): e is Unit => 'stance' in e;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Explicit hunting and a boar's retaliation do not make Gaia a hostile player. */
function canAttack(world: World, owner: PlayerId, t: Target, attacker?: Unit): boolean {
  return world.areEnemies(owner, t.owner)
    || (owner !== GAIA && isUnit(t) && isAnimal(t.kind))
    || (attacker?.kind === 'boar' && isUnit(t) && t.owner !== GAIA);
}

/** Work states a passive villager drops to run away when hit. */
const FLEEING_FROM: ReadonlySet<UnitState> = new Set(['idle', 'toNode', 'gathering', 'toDrop', 'toBuild', 'building']);

function stateOf(world: World, u: Unit): CombatState {
  let cs = world.combatState.get(u.id);
  if (!cs) {
    cs = { order: null, dest: null, post: null, cooldown: 0, repath: 0, goal: null, anchor: null, seen: 0 };
    world.combatState.set(u.id, cs);
  }
  return cs;
}

function targetOf(world: World, id: EntityId | null): Target | undefined {
  if (id === null) return undefined;
  return world.units.get(id) ?? world.buildings.get(id);
}

// ---- Spatial buckets for target search ----

/** Units bucketed into BUCKET-sized cells, rebuilt once per tick (linked lists in typed arrays). */
const BUCKET = 8;

class UnitBuckets {
  readonly cols: number;
  readonly rows: number;
  readonly head: Int32Array;
  next = new Int32Array(256);
  items: Unit[] = [];

  constructor(width: number, depth: number) {
    this.cols = Math.max(1, Math.ceil(width / BUCKET));
    this.rows = Math.max(1, Math.ceil(depth / BUCKET));
    this.head = new Int32Array(this.cols * this.rows);
  }

  rebuild(units: Iterable<Unit>): void {
    this.head.fill(-1);
    this.items.length = 0;
    for (const u of units) {
      const i = this.items.length;
      if (i >= this.next.length) {
        const grown = new Int32Array(this.next.length * 2);
        grown.set(this.next);
        this.next = grown;
      }
      this.items.push(u);
      const c = this.cell(u.pos);
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  cell(p: Vec2): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / BUCKET)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(p.z / BUCKET)));
    return r * this.cols + c;
  }
}

const buckets = new WeakMap<World, UnitBuckets>();

function bucketsOf(world: World): UnitBuckets {
  let b = buckets.get(world);
  if (!b) buckets.set(world, (b = new UnitBuckets(world.hf.width, world.hf.depth)));
  return b;
}

/** How far `u` looks for enemies on its own (−1: never). */
function acquireRadius(world: World, u: Unit, cs: CombatState | undefined): number {
  if (cs?.order === 'attackMove') return unitSight(world, u.owner, u.kind);
  return stanceRadius(world, u, u.stance);
}

function stanceRadius(world: World, u: Unit, stance: Stance): number {
  switch (stance) {
    case 'aggressive':
      return unitSight(world, u.owner, u.kind);
    case 'defensive':
      return unitSight(world, u.owner, u.kind) / 2;
    case 'standGround':
      return unitRange(world, u.owner, u.kind);
    case 'passive':
      return -1;
  }
}

/**
 * Nearest enemy of `u` within `radius` (edge to edge) that `u`'s owner can see. Units come
 * first; enemy buildings only if no unit qualifies.
 */
export function findEnemy(world: World, u: Unit, radius: number): Target | null {
  if (radius < 0 || u.owner === GAIA || isAnimal(u.kind)) return null;
  const vis = world.visibilityOf(u.owner);
  const grid = bucketsOf(world);
  const reach = radius + unitRadius(u) + 1;
  const c0 = Math.max(0, Math.floor((u.pos.x - reach) / BUCKET));
  const c1 = Math.min(grid.cols - 1, Math.floor((u.pos.x + reach) / BUCKET));
  const r0 = Math.max(0, Math.floor((u.pos.z - reach) / BUCKET));
  const r1 = Math.min(grid.rows - 1, Math.floor((u.pos.z + reach) / BUCKET));
  let best: Target | null = null;
  let bestD = Infinity;
  let lastOwner = -1;
  let lastEnemy = false;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (let i = grid.head[r * grid.cols + c]; i >= 0; i = grid.next[i]) {
        const v = grid.items[i];
        if (v.owner !== lastOwner) {
          lastOwner = v.owner;
          lastEnemy = world.areEnemies(u.owner, v.owner);
        }
        if (!lastEnemy || v.hp <= 0 || v.state === 'garrisoned') continue;
        const d = edgeDistance(u, v);
        if (d > radius || d >= bestD || !world.units.has(v.id) || !vis.isVisible(v.pos.x, v.pos.z)) continue;
        best = v;
        bestD = d;
      }
    }
  }
  if (best) return best;
  for (const b of world.buildings.values()) {
    if (!world.areEnemies(u.owner, b.owner)) continue;
    const d = edgeDistance(u, b);
    if (d > radius || d >= bestD) continue;
    const p = nearestPoint(u.pos, b);
    if (!vis.isVisible(p.x, p.z)) continue;
    best = b;
    bestD = d;
  }
  return best;
}

// ---- Orders ----

/** Drop whatever `units` were doing (gather, build, explore, flee, fight) before a combat order. */
function clearWork(world: World, units: Unit[]): Unit[] {
  const cancelled = cancelExplore(world, units);
  for (const u of units) {
    u.gatherNode = null;
    u.gatherType = null;
    world.gatherState.delete(u.id);
    world.buildState.delete(u.id);
    world.fleeState.delete(u.id);
    u.target = null;
    const cs = world.combatState.get(u.id);
    if (cs) {
      cs.order = null;
      cs.dest = null;
      cs.post = null;
    }
  }
  return cancelled;
}

/**
 * Any non-combat order (move, gather, build, explore) supersedes fighting and fleeing. Called
 * by World.dispatch before the order runs; a unit the order can't take stops ('attacking' with
 * no target goes idle next tick).
 */
export function releaseCombat(world: World, unitIds: EntityId[]): void {
  for (const id of unitIds) {
    const u = world.units.get(id);
    if (!u) continue;
    u.target = null;
    world.fleeState.delete(id);
    const cs = world.combatState.get(id);
    if (cs) {
      cs.order = null;
      cs.dest = null;
      cs.post = null;
      cs.anchor = null;
      cs.goal = null;
    }
  }
}

function units(world: World, ids: EntityId[]): Unit[] {
  return ids.map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
}

/** 'attack': chase and strike an enemy unit or building (explicit orders override stance). */
export function orderAttack(world: World, unitIds: EntityId[], targetId: EntityId, by: PlayerId): void {
  const t = targetOf(world, targetId);
  if (!t || !canAttack(world, by, t, world.units.get(unitIds[0]))) {
    world.events.emit({ type: 'rejected', reason: 'invalid-target' });
    return;
  }
  const list = units(world, unitIds);
  const cancelled = clearWork(world, list);
  for (const u of list) {
    if (isAnimal(u.kind) && u.kind !== 'boar') continue;
    stateOf(world, u).order = 'attack';
    engage(world, u, t, true);
  }
  settleCancelled(world, cancelled);
}

/** 'attackMove': walk to `target` in formation, fighting visible enemies met on the way. */
export function orderAttackMove(world: World, unitIds: EntityId[], target: Vec2): void {
  const list = units(world, unitIds);
  if (!list.length) return;
  const cancelled = clearWork(world, list);
  let moved = 0;
  list.forEach((u, i) => {
    const o = formationOffset(i);
    let dest = { x: target.x + o.x, z: target.z + o.z };
    let path = route(world, u.owner, u.pos, dest);
    if (!path && i > 0) path = route(world, u.owner, u.pos, (dest = { ...target }));
    if (!path) return;
    moved++;
    const cs = stateOf(world, u);
    cs.order = 'attackMove';
    cs.dest = dest;
    u.path = path;
    world.setState(u, 'moving');
  });
  settleCancelled(world, cancelled);
  if (!moved) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/** 'stop': drop every order and stand still. */
export function orderStop(world: World, unitIds: EntityId[]): void {
  const list = units(world, unitIds);
  const cancelled = clearWork(world, list);
  for (const u of list) {
    u.path = [];
    world.setState(u, 'idle');
  }
  settleCancelled(world, cancelled);
}

/** 'stance': change how units react to enemies. Passive units break off fights they picked themselves. */
export function orderStance(world: World, unitIds: EntityId[], stance: Stance): void {
  for (const u of units(world, unitIds)) {
    u.stance = stance;
    const cs = world.combatState.get(u.id);
    if (cs) cs.post = null;
    if (stance === 'passive' && u.state === 'attacking' && cs?.order !== 'attack') disengage(world, u, stateOf(world, u));
  }
}

/** 'rally': where `b`'s trained units go. A point inside the building's own footprint clears it. */
export function orderRally(world: World, b: Building, pos: Vec2, targetId?: EntityId): void {
  const target = targetId !== undefined && targetId !== b.id && world.get(targetId) ? targetId : undefined;
  if (target === undefined && edgeDistanceTo(pos, b) <= 0) {
    delete b.rally;
    return;
  }
  b.rally = target === undefined ? { pos: { ...pos } } : { pos: { ...pos }, targetId: target };
}

function edgeDistanceTo(p: Vec2, b: Building): number {
  const q = nearestPoint(p, b);
  return dist(p, q);
}

/**
 * Send a freshly trained unit to its building's rally point: villagers gather a rallied
 * resource or farm (or build a rallied foundation), anyone attacks a rallied enemy, otherwise
 * the unit walks to the point.
 */
export function applyRally(world: World, b: Building, u: Unit): void {
  const r = b.rally;
  if (!r) return;
  if (r.targetId !== undefined) {
    const node = world.nodes.get(r.targetId);
    if (node && u.kind === 'villager' && sendToNode(world, u, node)) return;
    const t = targetOf(world, r.targetId);
    if (t && world.areEnemies(u.owner, t.owner)) {
      orderAttack(world, [u.id], t.id, u.owner);
      return;
    }
    if (t && !isUnit(t) && t.owner === u.owner && u.kind === 'villager') {
      if (!t.complete) {
        sendBuilders(world, [u.id], t);
        if (u.state === 'toBuild') return;
      } else if (t.kind === 'farm' && sendToFarm(world, u, t)) return;
    }
  }
  const path = route(world, u.owner, u.pos, r.pos);
  if (!path) return;
  u.path = path;
  world.setState(u, 'moving');
}

// ---- Engagement ----

/** Start fighting `t`. Explicit (player-ordered) attacks have no leash until first contact. */
function engage(world: World, u: Unit, t: Target, explicit: boolean): void {
  const cs = stateOf(world, u);
  if (!explicit && cs.order === null && !cs.post) cs.post = { ...u.pos };
  u.target = t.id;
  cs.goal = null;
  cs.repath = 0;
  cs.anchor = explicit ? null : { ...u.pos };
  cs.seen = world.time;
  u.path = [];
  world.setState(u, 'attacking');
}

/** The fight is over (target dead, lost or out of leash): find another, resume attack-move, return to post, or idle. */
function disengage(world: World, u: Unit, cs: CombatState): void {
  u.target = null;
  u.path = [];
  cs.goal = null;
  cs.anchor = null;
  if (cs.order === 'attack') cs.order = null;
  const next = findEnemy(world, u, acquireRadius(world, u, cs));
  if (next) {
    engage(world, u, next, false);
    return;
  }
  if (cs.order === 'attackMove' && cs.dest) {
    const path = route(world, u.owner, u.pos, cs.dest);
    if (path) {
      u.path = path;
      world.setState(u, 'moving');
      return;
    }
    cs.order = null;
    cs.dest = null;
  }
  if (u.stance === 'defensive' && cs.post && dist(u.pos, cs.post) > 1) {
    const path = route(world, u.owner, u.pos, cs.post);
    if (path) {
      u.path = path;
      world.setState(u, 'moving');
      return;
    }
  }
  world.setState(u, 'idle');
}

/** Where to walk to get at `t`. */
function approachOf(u: Unit, t: Target): Vec2 {
  return isUnit(t) ? t.pos : siteApproach(u.pos, t);
}

/** One tick of a unit in 'attacking': validate, close in (re-pathing as the target moves), strike. */
function attackTick(world: World, u: Unit, cs: CombatState, threat: Unit | undefined): void {
  const t = targetOf(world, u.target);
  const explicit = cs.order === 'attack';
  // Unit targets must stay in sight; a short grace lets units close on an unseen shooter or round a fog edge.
  if (t && (u.kind === 'boar' || !isUnit(t) || world.visibilityOf(u.owner).isVisible(t.pos.x, t.pos.z))) cs.seen = world.time;
  if (
    !t ||
    t.hp <= 0 ||
    (isUnit(t) && t.state === 'garrisoned') ||
    !canAttack(world, u.owner, t, u) ||
    (u.stance === 'passive' && !explicit) ||
    world.time - cs.seen > BALANCE.lostSightGrace
  ) {
    disengage(world, u, cs);
    return;
  }
  const spec = UNITS[u.kind];
  const d = edgeDistance(u, t);
  if (d <= unitRange(world, u.owner, u.kind) + 1e-6) {
    cs.anchor = { ...u.pos };
    if (!(threat && kite(world, u, cs, threat))) u.path = [];
    if (!u.path.length) {
      const p = nearestPoint(u.pos, t);
      u.facing = Math.atan2(p.x - u.pos.x, p.z - u.pos.z);
    }
    if (cs.cooldown <= 0) {
      strike(world, u, t);
      cs.cooldown = spec.reload;
    }
    return;
  }
  // Out of range.
  if (u.stance === 'standGround' && !explicit) {
    disengage(world, u, cs);
    return;
  }
  if (cs.anchor && dist(u.pos, cs.anchor) > BALANCE.leash) {
    disengage(world, u, cs);
    return;
  }
  if (!explicit && cs.order === null && u.stance === 'defensive' && cs.post && dist(u.pos, cs.post) > unitSight(world, u.owner, u.kind)) {
    disengage(world, u, cs);
    return;
  }
  if (cs.repath > 0) return;
  const goal = approachOf(u, t);
  if (u.path.length && cs.goal && dist(goal, cs.goal) < BALANCE.repathDistance) return;
  cs.repath = BALANCE.repathInterval;
  const path = route(world, u.owner, u.pos, goal);
  if (!path) {
    disengage(world, u, cs);
    return;
  }
  u.path = path;
  cs.goal = { ...goal };
}

/** Step a ranged unit back from a melee attacker (it keeps shooting on the move). False if there is nowhere to go. */
function kite(world: World, u: Unit, cs: CombatState, threat: Unit): boolean {
  if (u.path.length) return true;
  let dx = u.pos.x - threat.pos.x;
  let dz = u.pos.z - threat.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = Math.sin(u.facing + Math.PI);
    dz = Math.cos(u.facing + Math.PI);
  } else {
    dx /= len;
    dz /= len;
  }
  const want = { x: u.pos.x + dx * BALANCE.kiteStep, z: u.pos.z + dz * BALANCE.kiteStep };
  const spot = world.nav.isFree(want) ? want : world.nav.nearestFree(want);
  if (!spot || dist(spot, u.pos) < 0.5) return false;
  const path = route(world, u.owner, u.pos, spot);
  if (!path) return false;
  u.path = path;
  cs.goal = spot;
  // Don't let the chase logic re-path back toward the target until the step is done.
  cs.repath = BALANCE.kiteStep / unitSpeed(u, world);
  return true;
}

/** Melee blow now, or launch a projectile that lands later. */
function strike(world: World, u: Unit, t: Target): void {
  const spec = UNITS[u.kind];
  if (!spec.projectile) {
    applyDamage(world, t, damageTo(u.kind, t, world, u.owner), u.id, u.owner, u.pos);
    return;
  }
  const from = { x: u.pos.x, z: u.pos.z };
  const near = nearestPoint(from, t);
  const { aim, flight } = isUnit(t) ? aimAt(world, u.owner, from, t) : { aim: { x: near.x, z: near.z }, flight: dist(from, near) / BALANCE.projectileSpeed };
  world.events.emit({ type: 'projectile', kind: spec.projectile, from, to: aim, flight, targetId: t.id });
  world.projectiles.push({ at: world.time + flight, targetId: t.id, aim, by: u.id, kind: u.kind, owner: u.owner, from });
}

/** Land projectiles whose flight is over: hit if the target is still near the aim point. */
function resolveProjectiles(world: World): void {
  const list = world.projectiles;
  if (!list.length) return;
  let keep = 0;
  const due: PendingHit[] = [];
  for (const p of list) {
    if (p.at <= world.time + 1e-9) due.push(p);
    else list[keep++] = p;
  }
  list.length = keep;
  for (const p of due) {
    const t = targetOf(world, p.targetId);
    if (!t || t.hp <= 0) continue;
    if (isUnit(t) && t.state === 'garrisoned') continue;
    if (isUnit(t) && dist(t.pos, p.aim) > BALANCE.hitRadius) continue; // dodged
    const amount = p.pierce !== undefined ? Math.max(1, p.pierce - armorOf(world, t).pierce) : damageTo(p.kind, t, world, p.owner);
    applyDamage(world, t, amount, p.by, p.owner, p.from);
  }
}

/**
 * Take `amount` hp off `t`: 'damaged', a rate-limited 'attacked' alert for its owner, then death
 * or a reaction (villagers flee, idle soldiers fight back).
 */
export function applyDamage(world: World, t: Target, amount: number, by: EntityId | null, byOwner: PlayerId, from: Vec2): void {
  t.hp = Math.max(0, t.hp - amount);
  world.events.emit({ type: 'damaged', id: t.id, hp: t.hp, maxHp: t.maxHp, by });
  const last = world.lastAlert.get(t.owner);
  if (last === undefined || world.time - last >= BALANCE.alertInterval - 1e-9) {
    world.lastAlert.set(t.owner, world.time);
    world.events.emit({ type: 'attacked', owner: t.owner, id: t.id, pos: { x: t.pos.x, z: t.pos.z } });
  }
  if (t.hp <= 0) {
    if (isUnit(t)) killUnit(world, t);
    else destroyBuilding(world, t);
    return;
  }
  if (isUnit(t)) react(world, t, by, byOwner, from);
}

/** A unit was hit: passive villagers at work run off; idle units with a fighting stance hit back. */
function react(world: World, v: Unit, by: EntityId | null, byOwner: PlayerId, from: Vec2): void {
  if (isAnimal(v.kind)) {
    const attacker = by !== null ? world.units.get(by) : undefined;
    if (v.kind === 'boar' && attacker && attacker.owner !== GAIA && !isAnimal(attacker.kind)) {
      orderAttack(world, [v.id], attacker.id, v.owner);
    }
    return;
  }
  if (v.kind === 'villager' && v.stance === 'passive') {
    if (FLEEING_FROM.has(v.state) && !world.fleeState.has(v.id)) flee(world, v, from);
    return;
  }
  if (v.state !== 'idle' || v.stance === 'passive' || !world.areEnemies(v.owner, byOwner)) return;
  const a = by !== null ? world.units.get(by) : undefined;
  if (!a) return;
  if (v.stance === 'standGround' && edgeDistance(v, a) > unitRange(world, v.owner, v.kind)) return;
  engage(world, v, a, false);
}

/** Run BALANCE.fleeDistance away from `from`, remembering the work to go back to. */
function flee(world: World, v: Unit, from: Vec2): void {
  let dx = v.pos.x - from.x;
  let dz = v.pos.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= len;
    dz /= len;
  }
  const want = { x: v.pos.x + dx * BALANCE.fleeDistance, z: v.pos.z + dz * BALANCE.fleeDistance };
  const spot = world.nav.isFree(want) ? want : world.nav.nearestFree(want);
  const path = spot && route(world, v.owner, v.pos, spot);
  if (!path) return;
  const working = v.state !== 'idle';
  world.fleeState.set(v.id, {
    node: working ? v.gatherNode : null,
    type: working ? v.gatherType : null,
    build: working ? (world.buildState.get(v.id) ?? null) : null,
  });
  cancelExplore(world, [v]);
  world.buildState.delete(v.id);
  world.gatherState.delete(v.id);
  v.gatherNode = null;
  v.gatherType = null;
  v.path = path;
  world.setState(v, 'moving');
}

/** A fled villager reached safety: go back to building, dropping off, or gathering (the same node, else nearby). */
function resume(world: World, u: Unit): void {
  const fs = world.fleeState.get(u.id)!;
  world.fleeState.delete(u.id);
  const site = fs.build !== null ? world.buildings.get(fs.build) : undefined;
  if (site && !site.complete) {
    sendBuilders(world, [u.id], site);
    if (u.state === 'toBuild') return;
  }
  if (u.carry && u.carry.amount >= carryCap(world, u, u.carry.type)) {
    sendToDrop(world, u);
    return;
  }
  if (fs.node !== null) {
    const node = world.nodes.get(fs.node);
    if (node && sendToNode(world, u, node)) return;
    const farm = world.buildings.get(fs.node);
    if (farm && sendToFarm(world, u, farm)) return;
  }
  if (fs.type) {
    for (const s of nearestSources(world, fs.type, u.pos, u)) if (sendToSource(world, u, s)) return;
  }
  if (u.carry && u.carry.amount > 0) sendToDrop(world, u);
}

// ---- Death ----

/** Remove a dead unit: 'died' then 'removed', and every system's bookkeeping about it. */
export function killUnit(world: World, u: Unit): void {
  if (u.shelter != null) {
    const b = world.buildings.get(u.shelter);
    const occupants = b?.occupants;
    if (occupants) {
      const i = occupants.indexOf(u.id);
      if (i >= 0) occupants.splice(i, 1);
    }
  }
  world.events.emit({ type: 'died', id: u.id, kind: u.kind, owner: u.owner, pos: { x: u.pos.x, z: u.pos.z } });
  world.units.delete(u.id);
  world.gatherState.delete(u.id);
  world.exploreState.delete(u.id);
  world.exploreQueue.delete(u.id);
  world.buildState.delete(u.id);
  world.combatState.delete(u.id);
  world.fleeState.delete(u.id);
  for (const [farm, id] of world.farmers) if (id === u.id) world.farmers.delete(farm);
  clearTargets(world, u.id);
  world.events.emit({ type: 'removed', id: u.id });
  if (isAnimal(u.kind)) {
    const id = world.allocId();
    world.nodes.set(id, {
      id, kind: 'carcass', type: 'food', pos: { ...u.pos }, radius: 0.5,
      amount: u.kind === 'boar' ? 300 : u.kind === 'deer' ? 140 : 100,
    });
    world.events.emit({ type: 'spawned', id, kind: 'carcass' });
  }
  if (u.owner === world.localPlayer) world.emitStock();
}

/** Destroy a building: 'died', queue dropped (no refund), nav freed, 'removed', pop cap and fog update. */
export function destroyBuilding(world: World, b: Building): void {
  const inside = b.occupants ?? [];
  b.occupants = [];
  for (const id of inside) {
    const u = world.units.get(id);
    if (!u) continue;
    u.shelter = null;
    u.pos = { x: b.pos.x, z: b.pos.z };
    killUnit(world, u);
  }
  world.events.emit({ type: 'died', id: b.id, kind: b.kind, owner: b.owner, pos: { x: b.pos.x, z: b.pos.z } });
  b.queue = 0;
  b.queueKinds = [];
  b.progress = 0;
  removeBuilding(world, b);
  clearTargets(world, b.id);
  world.refreshFog();
  if (b.owner === world.localPlayer) world.emitStock();
}

function clearTargets(world: World, id: EntityId): void {
  for (const u of world.units.values()) if (u.target === id) u.target = null;
}

// ---- System ----

/**
 * Per tick: land projectiles, bring fled villagers back to work, run every fight, and let idle
 * (and attack-moving) units look for enemies — each unit scans once every BALANCE.scanTicks
 * ticks, staggered by id, against a spatial bucket grid.
 */
export function combatSystem(world: World, dt: number, arrived: Unit[]): void {
  resolveProjectiles(world);
  for (const u of arrived) {
    if (world.fleeState.has(u.id) && world.units.has(u.id) && u.state === 'idle') resume(world, u);
  }
  bucketsOf(world).rebuild(world.units.values());
  const tick = world.combatTicks++;

  // Melee attackers closing on a ranged unit that can kite.
  let threats: Map<EntityId, Unit> | null = null;
  for (const a of world.units.values()) {
    if (a.state !== 'attacking' || a.target === null || isRanged(a.kind)) continue;
    const t = world.units.get(a.target);
    if (!t || t.state !== 'attacking' || !isRanged(t.kind) || (t.stance !== 'aggressive' && t.stance !== 'defensive')) continue;
    if (unitSpeed(t, world) <= unitSpeed(a, world)) continue; // can't outrun it: stand and shoot

    const d = edgeDistance(a, t);
    if (d > BALANCE.kiteDistance) continue;
    threats ??= new Map();
    const cur = threats.get(t.id);
    if (!cur || edgeDistance(cur, t) > d) threats.set(t.id, a);
  }

  for (const u of world.units.values()) {
    if (u.state === 'garrisoned') continue;
    const cs = world.combatState.get(u.id);
    if (cs) {
      cs.cooldown -= dt;
      cs.repath -= dt;
    }
    if (u.state === 'attacking') {
      attackTick(world, u, cs ?? stateOf(world, u), threats?.get(u.id));
      continue;
    }
    if (cs?.order === 'attackMove' && u.state === 'idle') {
      cs.order = null; // arrived
      cs.dest = null;
    }
    const scanning = (u.state === 'idle' && u.stance !== 'passive') || (u.state === 'moving' && cs?.order === 'attackMove');
    if (!scanning || (tick + u.id) % BALANCE.scanTicks !== 0) continue;
    const t = findEnemy(world, u, acquireRadius(world, u, cs));
    if (t) engage(world, u, t, false);
  }
  defenceFire(world, dt);
}

/** Watch towers, and shelters with villagers inside, fire a volley at the nearest enemies in range. */
function defenceFire(world: World, dt: number): void {
  for (const b of world.buildings.values()) {
    if (!BUILDINGS[b.kind].attack || !b.complete || b.hp <= 0) continue;
    const attack = buildingAttack(world, b)!;
    const arrows = attack.arrows + (b.occupants?.length ?? 0);
    if (arrows <= 0) continue;
    b.cooldown = (b.cooldown ?? 0) - dt;
    if (b.cooldown > 0) continue;
    const targets = enemiesInRange(world, b, attack.range);
    if (!targets.length) continue;
    b.cooldown = attack.reload;
    for (let i = 0; i < arrows; i++) shootBuilding(world, b, targets[Math.min(i, targets.length - 1)], attack.pierce);
  }
}

function enemiesInRange(world: World, b: Building, range: number): Unit[] {
  const vis = world.visibilityOf(b.owner);
  const found: { u: Unit; d: number }[] = [];
  for (const u of world.units.values()) {
    if (u.state === 'garrisoned' || u.hp <= 0 || !world.areEnemies(b.owner, u.owner)) continue;
    const d = dist(b.pos, u.pos);
    if (d > range || !vis.isVisible(u.pos.x, u.pos.z)) continue;
    found.push({ u, d });
  }
  found.sort((a, c) => a.d - c.d || a.u.id - c.u.id);
  return found.map((e) => e.u);
}

function shootBuilding(world: World, b: Building, t: Unit, pierce: number): void {
  const from = { x: b.pos.x, z: b.pos.z };
  const { aim, flight } = aimAt(world, b.owner, from, t);
  world.events.emit({ type: 'projectile', kind: 'arrow', from, to: aim, flight, targetId: t.id });
  world.projectiles.push({ at: world.time + flight, targetId: t.id, aim, by: b.id, kind: 'archer', owner: b.owner, from, pierce });
}

/**
 * Where a shot from `from` at moving unit `t` is aimed, and its flight time. Without Ballistics
 * a shooter leads by only BALANCE.untrainedLead of the target's velocity × flight time, so fast
 * units walking across the line of fire dodge; with Ballistics it solves for the intercept
 * (lead by the full velocity, refined over a few iterations). Deterministic.
 */
export function aimAt(world: World, owner: PlayerId, from: Vec2, t: Unit): { aim: Vec2; flight: number } {
  const dt = 1 / BALANCE.tickRate;
  const vx = (t.pos.x - t.prevPos.x) / dt;
  const vz = (t.pos.z - t.prevPos.z) / dt;
  const ballistics = playerHasFlag(world, owner, 'ballistics');
  const lead = ballistics ? 1 : BALANCE.untrainedLead;
  let flight = dist(from, t.pos) / BALANCE.projectileSpeed;
  let aim = { x: t.pos.x + vx * flight * lead, z: t.pos.z + vz * flight * lead };
  for (let i = 0; i < (ballistics ? 3 : 1); i++) {
    flight = dist(from, aim) / BALANCE.projectileSpeed;
    aim = { x: t.pos.x + vx * flight * lead, z: t.pos.z + vz * flight * lead };
  }
  return { aim, flight: dist(from, aim) / BALANCE.projectileSpeed };
}
