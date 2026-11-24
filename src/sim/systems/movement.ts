import type { EntityId, FormationKind, Unit, UnitFormation, Vec2 } from '../../core/types';
import { defaultFormation, isAnimal, isShip, UNITS } from '../../core/units';
import { BALANCE } from '../balance';
import { NAV_CELL } from '../nav';
import type { NavGrid, Rect } from '../nav';
import type { World } from '../World';
import { closedGates, navFor, routeForUnit } from './passage';
import { clearEconomyJob } from './gather';
import { unitSpeed } from './stats';
import { cancelExplore, settleCancelled } from './explore';
import { anchored } from './siege';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HASH_CELL = 2;
const ARRIVAL_SLOWDOWN = 0.65;
const JAM_SECONDS = 1.5;
const REPATHS_PER_TICK = 3;
const REPATH_WORK = 4000;

/** Legacy ring helper retained for callers; group orders now use formationSlots(). */
export function formationOffset(i: number): Vec2 {
  if (i === 0) return { x: 0, z: 0 };
  const r = BALANCE.formationBase + BALANCE.formationStep * Math.sqrt(i);
  const a = i * GOLDEN_ANGLE;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

/** Walking speed of `u` right now (researched UNITS speed; loaded villagers are slower). */
export function speedOf(u: Unit, world?: World): number {
  return unitSpeed(u, world);
}

function radiusOf(u: Unit): number {
  return UNITS[u.kind]?.radius ?? BALANCE.villagerRadius;
}

function direction(units: readonly Unit[], target: Vec2): Vec2 {
  let x = 0;
  let z = 0;
  for (const u of units) { x += u.pos.x; z += u.pos.z; }
  x = target.x - x / units.length;
  z = target.z - z / units.length;
  const d = Math.hypot(x, z);
  return d > 1e-6 ? { x: x / d, z: z / d } : { x: Math.sin(units[0].facing), z: Math.cos(units[0].facing) };
}

type Role = 'melee' | 'ranged' | 'cavalry';
/** A formation slot in spacing units: `lateral` to the right, `ahead` towards the front (0 = front rank). */
interface LayoutSlot { lateral: number; ahead: number; role: Role }

function roleOf(u: Unit): Role {
  const cls = UNITS[u.kind]?.unitClass;
  return cls === 'archer' ? 'ranged' : cls === 'cavalry' ? 'cavalry' : 'melee';
}


/** One centred rank of `count` slots, `ahead` ranks behind the front. */
function rank(out: LayoutSlot[], count: number, ahead: number, role: Role): void {
  for (let k = 0; k < count; k++) out.push({ lateral: k - (count - 1) / 2, ahead: -ahead, role });
}

/**
 * Line: melee front ranks, ranged behind, cavalry split onto both flanks; at most three ranks per block.
 * `across` (a right-drag's width, in slots) overrides how many stand side by side, wings included.
 */
function lineLayout(melee: number, ranged: number, cavalry: number, across?: number): LayoutSlot[] {
  const out: LayoutSlot[] = [];
  const centre = melee + ranged;
  const wings = Math.min(cavalry, 2);
  const cols = across !== undefined && centre
    ? Math.max(1, Math.min(centre, across - wings))
    : centre <= 4 ? centre : Math.max(4, Math.ceil(centre / 3));
  const meleeRows = cols ? Math.ceil(melee / cols) : 0;
  for (let r = 0; r < meleeRows; r++) rank(out, Math.min(cols, melee - r * cols), r, 'melee');
  for (let r = 0; r * cols < ranged; r++) rank(out, Math.min(cols, ranged - r * cols), meleeRows + r, 'ranged');
  // Wings stand beside the melee ranks (or the ranged ranks when there is no melee), never further back.
  const wingRows = across !== undefined && !centre
    ? Math.max(1, Math.ceil(cavalry / Math.max(1, across)))
    : Math.max(1, Math.min(3, meleeRows || Math.ceil(ranged / Math.max(1, cols))));
  const left = Math.ceil(cavalry / 2);
  for (const [count, side] of [[left, -1], [cavalry - left, 1]]) {
    const width = Math.ceil(count / wingRows);
    for (let k = 0; k < count; k++) {
      out.push({ lateral: side * ((cols - 1) / 2 + 1 + k % width), ahead: -Math.floor(k / width), role: 'cavalry' });
    }
  }
  return out;
}

/** Column: two or three abreast (`across` overrides, up to four); melee lead, ranged in the middle, cavalry as rear guard. */
function columnLayout(melee: number, ranged: number, cavalry: number, across?: number): LayoutSlot[] {
  const n = melee + ranged + cavalry;
  const width = across !== undefined ? Math.max(1, Math.min(4, n, across)) : n <= 2 ? 1 : n <= 12 ? 2 : 3;
  const roles: Role[] = [...Array<Role>(melee).fill('melee'), ...Array<Role>(ranged).fill('ranged'), ...Array<Role>(cavalry).fill('cavalry')];
  const out: LayoutSlot[] = [];
  for (let r = 0; r * width < n; r++) {
    const count = Math.min(width, n - r * width);
    for (let k = 0; k < count; k++) out.push({ lateral: k - (count - 1) / 2, ahead: -r, role: roles[r * width + k] });
  }
  return out;
}

/** Box: a hollow square filled front edge first, then both sides, then the rear; ranged take the rear. */
function boxLayout(melee: number, ranged: number, cavalry: number): LayoutSlot[] {
  const n = melee + ranged + cavalry;
  if (n <= 3) return lineLayout(melee, ranged, cavalry);
  const side = Math.ceil(n / 4) + 1;
  const half = (side - 1) / 2;
  const centreOut = (a: number, b: number) => Math.abs(a) - Math.abs(b) || a - b;
  const edge = Array.from({ length: side }, (_, k) => k - half).sort(centreOut);
  const cells: { lateral: number; ahead: number }[] = edge.map((lateral) => ({ lateral, ahead: 0 }));
  for (let r = 1; r < side - 1; r++) cells.push({ lateral: -half, ahead: -r }, { lateral: half, ahead: -r });
  cells.push(...edge.map((lateral) => ({ lateral, ahead: 1 - side })));
  const roles: Role[] = [...Array<Role>(melee).fill('melee'), ...Array<Role>(cavalry).fill('cavalry'), ...Array<Role>(ranged).fill('ranged')];
  return roles.map((role, i) => ({ ...cells[i], role }));
}

/** Ring layout ('none'): golden-angle spiral, no ranks or roles. Offsets are in metres, not spacing. */
function ringLayout(n: number): LayoutSlot[] {
  return Array.from({ length: n }, (_, i) => {
    const o = formationOffset(i);
    return { lateral: o.x, ahead: o.z, role: 'melee' as Role };
  });
}

/**
 * Slot layout for `units` in spacing units, independent of the map (exported for tests). `across`
 * (slots side by side, from a right-drag's width) shapes line and column; box and none ignore it.
 */
export function formationLayout(units: readonly Unit[], formation: FormationKind, across?: number): LayoutSlot[] {
  if (formation === 'none') return ringLayout(units.length);
  let melee = 0, ranged = 0, cavalry = 0;
  for (const u of units) {
    const role = roleOf(u);
    if (role === 'ranged') ranged++;
    else if (role === 'cavalry') cavalry++;
    else melee++;
  }
  if (!melee && !ranged) { melee = cavalry; cavalry = 0; } // an all-cavalry group forms its own centre
  const layout = formation === 'column' ? columnLayout(melee, ranged, cavalry, across)
    : formation === 'box' ? boxLayout(melee, ranged, cavalry) : lineLayout(melee, ranged, cavalry, across);
  if (!units.some((u) => roleOf(u) !== 'cavalry')) for (const s of layout) s.role = 'cavalry';
  return layout;
}

function headingOf(units: readonly Unit[], target: Vec2, facing: number | undefined): Vec2 {
  return facing !== undefined && Number.isFinite(facing) ? { x: Math.sin(facing), z: Math.cos(facing) } : direction(units, target);
}

/** Slots side by side for a front `width` metres wide at `spacing` (undefined: the formation's own shape). */
export function slotsAcross(width: number | undefined, spacing: number): number | undefined {
  return width !== undefined && Number.isFinite(width) && width > 0 ? Math.max(1, Math.round(width / spacing) + 1) : undefined;
}

/**
 * Formation slots around `target`, oriented along the travel direction (or `facing`). Results match
 * input order. Each role fills its own slots greedily: slots front-first pick the unassigned unit whose
 * position relative to the group centre is nearest, ties by id, so the plan is deterministic and O(n²).
 * `width` (metres) sets the front of a line or column, as a right-drag does.
 */
export function formationSlots(nav: NavGrid, units: readonly Unit[], target: Vec2,
  formation: FormationKind = 'line', facing?: number, width?: number): (Vec2 | null)[] {
  if (!units.length) return [];
  if (units.length === 1) return [nav.nearestFree(target)];
  const forward = headingOf(units, target, facing);
  const right = { x: forward.z, z: -forward.x };
  const ring = formation === 'none';
  const spacing = ring ? 1 : Math.ceil((Math.max(...units.map(radiusOf)) * 2 + 0.2) / NAV_CELL) * NAV_CELL;
  const minGap = (ring ? Math.ceil((Math.max(...units.map(radiusOf)) * 2 + 0.2) / NAV_CELL) * NAV_CELL : spacing) * 0.8;
  const layout = formationLayout(units, formation, ring ? undefined : slotsAcross(width, spacing));
  // Centre the block on the target so the formation, not its front rank, stands there.
  let mid = 0;
  if (!ring) {
    let lo = Infinity, hi = -Infinity;
    for (const s of layout) { lo = Math.min(lo, s.ahead); hi = Math.max(hi, s.ahead); }
    mid = (lo + hi) / 2;
  }
  let cx = 0, cz = 0;
  for (const u of units) { cx += u.pos.x; cz += u.pos.z; }
  cx /= units.length; cz /= units.length;
  const local = units.map((u) => ({
    lateral: ((u.pos.x - cx) * right.x + (u.pos.z - cz) * right.z) / spacing,
    ahead: ((u.pos.x - cx) * forward.x + (u.pos.z - cz) * forward.z) / spacing,
  }));
  const order = units.map((_, i) => i).sort((a, b) => units[a].id - units[b].id);
  const allCavalry = layout.every((s) => s.role === 'cavalry');
  const roles = units.map((u) => ring ? 'melee' : allCavalry ? 'cavalry' : roleOf(u));
  const anchor = nav.nearestFree(target);
  if (!anchor) return units.map(() => null);
  const reg = nav.regionOfCell(anchor);
  const taken = new Uint8Array(units.length);
  const reserved: Vec2[] = [];
  const slots: (Vec2 | null)[] = units.map(() => null);
  for (const s of layout) {
    const ahead = s.ahead - mid;
    let best = -1, bestD = Infinity;
    for (const i of order) {
      if (taken[i] || roles[i] !== s.role) continue;
      const d = (local[i].lateral - s.lateral) ** 2 + (local[i].ahead - ahead) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) continue;
    taken[best] = 1;
    const desired = { x: anchor.x + (right.x * s.lateral + forward.x * ahead) * spacing,
      z: anchor.z + (right.z * s.lateral + forward.z * ahead) * spacing };
    const slot = nav.nearestFreeCell(desired, reg, (p) => reserved.every((r) =>
      (r.x - p.x) ** 2 + (r.z - p.z) ** 2 >= minGap * minGap));
    if (slot) reserved.push(slot);
    slots[best] = slot;
  }
  return slots;
}

const MIN_PACE = 0.4;

function routeLength(from: Vec2, path: readonly Vec2[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) { total += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
  return total;
}

export interface GroupOrder {
  formation?: FormationKind;
  /** Facing override in radians (default: the group's travel direction). */
  facing?: number;
  /** Front width in metres for line / column (default: the formation's own shape). */
  width?: number;
}
export interface PlannedMove { unit: Unit; path: Vec2[]; formation?: UnitFormation }

/**
 * Per-unit paths to formation slots, with a shared speed cap for real formations. Each unit paths to
 * its own slot (robust around trees and buildings, and the jam repath keeps working); a unit whose
 * slot is unreachable falls back to a path to the target itself. Land and ships plan separately.
 */
export function planGroupMove(world: World, units: Unit[], target: Vec2, order: GroupOrder = {}): PlannedMove[] {
  const land = units.filter((u) => !isShip(u.kind)), ships = units.filter((u) => isShip(u.kind));
  if (land.length && ships.length) return [...planGroupMove(world, land, target, order), ...planGroupMove(world, ships, target, order)];
  if (!units.length) return [];
  const formation = order.formation ?? defaultFormation(units.map((u) => u.kind));
  const nav = navFor(world, units[0]);
  const slots = formationSlots(nav, units, target, formation, order.facing, order.width);
  const forward = headingOf(units, target, order.facing);
  const grouped = units.length > 1;
  const speed = grouped && formation !== 'none' ? Math.min(...units.map((u) => speedOf(u, world))) : undefined;
  const id = Math.min(...units.map((u) => u.id));
  const routes = units.map((unit, i) => {
    const slot = slots[i];
    return (slot && routeForUnit(world, unit, slot)) || (grouped ? routeForUnit(world, unit, target) : null);
  });
  // Pace each member so the block arrives together: the longest route walks at the shared (slowest)
  // speed, shorter ones proportionally slower (never below MIN_PACE of it, to avoid crawling).
  const lengths = routes.map((path, i) => path ? routeLength(units[i].pos, path) : 0);
  const longest = Math.max(1e-6, ...lengths);
  const facing = formation !== 'none' || order.facing !== undefined ? Math.atan2(forward.x, forward.z) : undefined;
  const planned: PlannedMove[] = [];
  units.forEach((unit, i) => {
    const path = routes[i];
    if (!path) return;
    const end = path.at(-1) ?? unit.pos;
    const pace = speed !== undefined ? speed * Math.max(MIN_PACE, lengths[i] / longest) : undefined;
    planned.push({ unit, path, formation: grouped ? {
      id, ...(pace !== undefined ? { speed: pace } : {}), ...(facing !== undefined ? { facing } : {}),
      slot: { x: end.x, z: end.z },
    } : undefined });
  });
  return planned;
}

interface Progress {
  path: Vec2[];
  waypoint: Vec2;
  best: number;
  stalled: number;
}
interface Body {
  u: Unit;
  x: number;
  z: number;
  radius: number;
  moving: boolean;
  pushX: number;
  pushZ: number;
}
interface Steering {
  resting: WeakMap<Unit, { path: Vec2[]; slot: Vec2 }>;
  progress: WeakMap<Unit, Progress>;
  bodies: Body[];
  hash: Map<number, number[]>;
  stride: number;
  repathCursor: number;
}
const steering = new WeakMap<World, Steering>();
function steeringOf(world: World): Steering {
  let st = steering.get(world);
  if (!st) {
    st = { resting: new WeakMap(), progress: new WeakMap(), bodies: [], hash: new Map(),
      stride: Math.ceil(world.hf.width / HASH_CELL) + 3, repathCursor: 0 };
    steering.set(world, st);
  }
  return st;
}

/** 'move' command: formation slots and a shared speed, dropping gather and explore work. */
export function orderMove(world: World, unitIds: EntityId[], target: Vec2, order: GroupOrder = {}): void {
  const units = [...new Set(unitIds)].map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
  if (!units.length) return;
  const st = steeringOf(world);
  const cancelled = cancelExplore(world, units);
  const planned = planGroupMove(world, units, target, order);
  for (const { unit: u, path, formation } of planned) {
    clearEconomyJob(world, u);
    u.path = path;
    if (u.kind === 'sheep' && u.owner !== 0) u.leashAnchor = { ...(path.at(-1) ?? u.pos) };
    st.progress.delete(u);
    st.resting.delete(u);
    if (formation) u.formation = formation;
    else delete u.formation;
    world.setState(u, 'moving');
  }
  settleCancelled(world, cancelled);
  if (!planned.length) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/** The unit's formation record, if its current path still leads to its slot (other orders replace paths). */
function liveFormation(u: Unit): UnitFormation | undefined {
  const f = u.formation;
  if (!f) return undefined;
  const end = u.path[u.path.length - 1];
  if (end && Math.abs(end.x - f.slot.x) < 1e-6 && Math.abs(end.z - f.slot.z) < 1e-6) return f;
  delete u.formation;
  return undefined;
}

/** Idle bodies step aside for movers; a deployed siege engine does not. */
const yields = (u: Unit): boolean => u.state === 'idle' && !anchored(u);

/** Rebuild a small local spatial hash from tick-start positions; resolve each neighbouring pair once. */
function separation(world: World, st: Steering): void {
  const { bodies, hash, stride } = st;
  bodies.length = 0;
  hash.clear();
  for (const u of world.units.values()) {
    if (u.state === 'garrisoned') continue;
    const i = bodies.length;
    // Deployed or (un)packing siege engines hold their ground until packed.
    bodies.push({ u, x: u.pos.x, z: u.pos.z, radius: radiusOf(u), moving: u.path.length > 0 && !anchored(u), pushX: 0, pushZ: 0 });
    const key = Math.floor(u.pos.z / HASH_CELL) * stride + Math.floor(u.pos.x / HASH_CELL);
    const bucket = hash.get(key);
    if (bucket) bucket.push(i);
    else hash.set(key, [i]);
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const cx = Math.floor(a.x / HASH_CELL);
    const cz = Math.floor(a.z / HASH_CELL);
    for (let z = cz - 1; z <= cz + 1; z++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const bucket = hash.get(z * stride + x);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = bodies[j];
          if (isShip(a.u.kind) !== isShip(b.u.kind)) continue;
          if (!a.moving && !b.moving) continue;
          let dx = a.x - b.x;
          let dz = a.z - b.z;
          const reach = a.radius + b.radius + 0.12;
          const d2 = dx * dx + dz * dz;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-6) {
            // Stable tie-breaker for identical spawn positions; independent of map iteration order.
            let angle = (a.u.id + b.u.id) * GOLDEN_ANGLE;
            let sign = a.u.id < b.u.id ? 1 : -1;
            if (world.hf.halfTurnSymmetric) {
              // Corresponding units can have different entity IDs. Use the contact point
              // in the same map frame so an overlap in the opposite town turns with it.
              const { width, depth } = world.hf;
              const x = (a.x + b.x) / 2;
              const z = (a.z + b.z) / 2;
              const turned = x > width / 2 || (x === width / 2 && z > depth / 2);
              const localX = turned ? width - x : x;
              const localZ = turned ? depth - z : z;
              angle = (Math.round(localX / HASH_CELL) + stride * Math.round(localZ / HASH_CELL)) * GOLDEN_ANGLE;
              if (turned) sign = -sign;
            }
            dx = Math.sin(angle) * sign;
            dz = Math.cos(angle) * sign;
          } else { dx /= d; dz /= d; }
          const force = (reach - d) * 6;
          // Idle bodies take most of the displacement; working/attacking bodies hold their ground.
          const shareA = a.moving ? (b.moving ? 0.5 : yields(b.u) ? 0.15 : 1)
            : yields(a.u) ? 0.85 : 0;
          const shareB = 1 - shareA;
          a.pushX += dx * force * shareA;
          a.pushZ += dz * force * shareA;
          b.pushX -= dx * force * shareB;
          b.pushZ -= dz * force * shareB;
        }
      }
    }
  }
}

/** Free-ground clamp with axis sliding so a wall absorbs only the perpendicular push. */
function safeStep(nav: NavGrid, from: Vec2, to: Vec2, mask: Rect[]): Vec2 {
  return nav.withMask(mask, () => {
    const next = nav.clampMove(from, to);
    const wanted = Math.hypot(to.x - from.x, to.z - from.z);
    if (Math.hypot(next.x - from.x, next.z - from.z) >= wanted * 0.8) return next;
    const slideX = nav.clampMove(from, { x: to.x, z: from.z });
    const slideZ = nav.clampMove(from, { x: from.x, z: to.z });
    const distance = (p: Vec2) => (p.x - to.x) ** 2 + (p.z - to.z) ** 2;
    return [next, slideX, slideZ].reduce((best, p) => distance(p) < distance(best) ? p : best);
  });
}

/** Advance paths and local steering; returns units reaching their last waypoint this tick. */
export function movementSystem(world: World, dt: number): Unit[] {
  const arrived: Unit[] = [];
  if (!(dt > 0) || !Number.isFinite(dt)) return arrived;
  const st = steeringOf(world);
  separation(world, st);
  const masks = new Map<number, Rect[]>();
  const maskFor = (unit: Unit): Rect[] => {
    const animal = isAnimal(unit.kind);
    const key = unit.owner * 2 + Number(animal);
    let mask = masks.get(key);
    if (!mask) masks.set(key, (mask = closedGates(world, unit.owner, animal)));
    return mask;
  };
  for (const body of st.bodies) {
    const { u } = body;
    if (!body.moving) {
      if (u.formation) delete u.formation;
      st.progress.delete(u);
      let rest = st.resting.get(u);
      if (rest && (rest.path !== u.path || u.state !== 'idle')) { st.resting.delete(u); rest = undefined; }
      // Stationary workers retain their jobs; only idle units yield their positions.
      if (u.state === 'idle' && !anchored(u) && (body.pushX || body.pushZ || rest)) {
        const dx = rest ? rest.slot.x - u.pos.x : 0;
        const dz = rest ? rest.slot.z - u.pos.z : 0;
        const d = Math.hypot(dx, dz);
        // An arrived formation unit yields temporarily, then returns without a second arrival event.
        const rate = Math.min(speedOf(u, world), d * 4);
        const vx = body.pushX + (d > 1e-6 ? dx / d * rate : 0);
        const vz = body.pushZ + (d > 1e-6 ? dz / d * rate : 0);
        const scale = Math.min(1, speedOf(u, world) / (Math.hypot(vx, vz) || 1));
        const next = rest && d <= 0.001 && !body.pushX && !body.pushZ ? rest.slot
          : { x: u.pos.x + vx * scale * dt, z: u.pos.z + vz * scale * dt };
        u.pos = safeStep(navFor(world, u), u.pos, next, isShip(u.kind) ? [] : maskFor(u));
      }
      continue;
    }
    st.resting.delete(u);
    // Other systems replace paths when issuing orders, and combat clears it; stale caps expire here.
    const member = liveFormation(u);
    const speed = Math.min(speedOf(u, world), member?.speed ?? Infinity);
    const pushScale = Math.min(1, speed * 0.75 / (Math.hypot(body.pushX, body.pushZ) || 1));
    let remaining = dt;
    while (remaining > 1e-8 && u.path.length) {
      const wp = u.path[0];
      const dx = wp.x - u.pos.x;
      const dz = wp.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) { u.path.shift(); continue; }
      const last = u.path.length === 1;
      const rate = speed * (last ? Math.min(1, Math.max(0.2, d / ARRIVAL_SLOWDOWN)) : 1);
      const time = Math.min(remaining, NAV_CELL / 2 / speed, d / rate);
      const step = rate * time;
      const finish = d <= step + 1e-9;
      const fade = last ? Math.min(1, d / ARRIVAL_SLOWDOWN) : 1;
      let mx = dx / d * step + (finish ? 0 : body.pushX * pushScale * time * fade);
      let mz = dz / d * step + (finish ? 0 : body.pushZ * pushScale * time * fade);
      const cap = Math.min(1, speed * time / (Math.hypot(mx, mz) || 1));
      mx *= cap;
      mz *= cap;
      const next = safeStep(navFor(world, u), u.pos, finish ? wp : { x: u.pos.x + mx, z: u.pos.z + mz }, isShip(u.kind) ? [] : maskFor(u));
      const advance = Math.hypot(next.x - u.pos.x, next.z - u.pos.z);
      if (advance > 1e-6) u.facing = Math.atan2(next.x - u.pos.x, next.z - u.pos.z);
      u.pos = next;
      remaining -= time;
      if (Math.hypot(wp.x - next.x, wp.z - next.z) < 1e-6) u.path.shift();
      else if (advance < 1e-6) break;
    }
    if (!u.path.length) {
      arrived.push(u);
      if (member) {
        if (member.facing !== undefined) u.facing = member.facing;
        st.resting.set(u, { path: u.path, slot: member.slot });
      }
      delete u.formation;
      st.progress.delete(u);
      if (u.state === 'moving') world.setState(u, 'idle');
    } else {
      const wp = u.path[0];
      const distance = Math.hypot(wp.x - u.pos.x, wp.z - u.pos.z);
      let progress = st.progress.get(u);
      if (!progress || progress.path !== u.path || progress.waypoint !== wp) {
        progress = { path: u.path, waypoint: wp, best: distance, stalled: 0 };
        st.progress.set(u, progress);
      }
      if (distance < progress.best - 0.04) { progress.best = distance; progress.stalled = 0; }
      else progress.stalled += dt;
    }
  }
  // Fair, bounded re-pathing: a jam cannot make every unit run A* in the same tick.
  let searches = 0;
  const expanded = world.nav.expanded;
  const n = st.bodies.length;
  for (let i = 0; i < n; i++) {
    const index = (st.repathCursor + i) % n;
    const u = st.bodies[index].u;
    const progress = st.progress.get(u);
    if (!progress || progress.stalled < JAM_SECONDS || !u.path.length) continue;
    const end = u.path[u.path.length - 1];
    const path = routeForUnit(world, u, end, 1.2);
    progress.stalled = 0;
    if (path) {
      const member = liveFormation(u);
      u.path = path;
      st.progress.delete(u);
      const e = path[path.length - 1];
      if (member && e) member.slot = { x: e.x, z: e.z };
    }
    searches++;
    if (searches >= REPATHS_PER_TICK || world.nav.expanded - expanded >= REPATH_WORK) {
      st.repathCursor = (index + 1) % n;
      break;
    }
  }
  return arrived;
}
