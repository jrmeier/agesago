import type { EntityId, Unit, Vec2 } from '../../core/types';
import { UNITS } from '../../core/units';
import { BALANCE } from '../balance';
import { NAV_CELL } from '../nav';
import type { NavGrid, Rect } from '../nav';
import type { World } from '../World';
import { closedGates, route } from './passage';
import { unitSpeed } from './stats';
import { cancelExplore, settleCancelled } from './explore';

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

/** Compact, direction-facing rows. Results match input order; ranged units occupy the rear rows. */
export function formationSlots(nav: NavGrid, units: readonly Unit[], target: Vec2): (Vec2 | null)[] {
  if (!units.length) return [];
  if (units.length === 1) return [nav.nearestFree(target)];
  const forward = direction(units, target);
  const right = { x: forward.z, z: -forward.x };
  const columns = units.length <= 4 ? units.length : Math.ceil(Math.sqrt(units.length));
  const spacing = Math.ceil((Math.max(...units.map(radiusOf)) * 2 + 0.2) / NAV_CELL) * NAV_CELL;
  const ranked = units.map((u, i) => ({ u, i, ranged: UNITS[u.kind]?.unitClass === 'archer' }));
  ranked.sort((a, b) => Number(a.ranged) - Number(b.ranged)
    || (a.u.pos.x * right.x + a.u.pos.z * right.z) - (b.u.pos.x * right.x + b.u.pos.z * right.z)
    || a.u.id - b.u.id);
  const frontCount = ranked.filter((r) => !r.ranged).length;
  const frontRows = Math.ceil(frontCount / columns);
  const rows = frontRows + Math.ceil((units.length - frontCount) / columns);
  const anchor = nav.nearestFree(target);
  if (!anchor) return units.map(() => null);
  const reg = nav.regionOfCell(anchor);
  const reserved: Vec2[] = [];
  const slots: (Vec2 | null)[] = units.map(() => null);
  ranked.forEach(({ i, ranged }, rank) => {
    const index = ranged ? rank - frontCount : rank;
    const row = Math.floor(index / columns) + (ranged ? frontRows : 0);
    const count = Math.min(columns, (ranged ? units.length - frontCount : frontCount) - Math.floor(index / columns) * columns);
    const lateral = (index % columns - (count - 1) / 2) * spacing;
    const ahead = ((rows - 1) / 2 - row) * spacing;
    const desired = { x: anchor.x + right.x * lateral + forward.x * ahead, z: anchor.z + right.z * lateral + forward.z * ahead };
    const slot = nav.nearestFreeCell(desired, reg, (p) => reserved.every((r) =>
      (r.x - p.x) ** 2 + (r.z - p.z) ** 2 >= spacing * spacing * 0.64));
    if (slot) reserved.push(slot);
    slots[i] = slot;
  });
  return slots;
}

interface GroupMember {
  path: Vec2[];
  speed: number;
  facing: number;
  slot: Vec2;
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
  members: WeakMap<Unit, GroupMember>;
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
    st = { members: new WeakMap(), resting: new WeakMap(), progress: new WeakMap(), bodies: [], hash: new Map(),
      stride: Math.ceil(world.hf.width / HASH_CELL) + 3, repathCursor: 0 };
    steering.set(world, st);
  }
  return st;
}

/** 'move' command: assign distinct slots and a shared speed, dropping gather and explore work. */
export function orderMove(world: World, unitIds: EntityId[], target: Vec2): void {
  const units = [...new Set(unitIds)].map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
  if (!units.length) return;
  const st = steeringOf(world);
  const cancelled = cancelExplore(world, units);
  const slots = formationSlots(world.nav, units, target);
  const speed = Math.min(...units.map((u) => speedOf(u, world)));
  const forward = direction(units, target);
  let moved = 0;
  units.forEach((u, i) => {
    const slot = slots[i];
    const path = slot && route(world, u.owner, u.pos, slot);
    if (!path) return;
    moved++;
    u.path = path;
    u.target = null;
    u.gatherNode = null;
    u.gatherType = null;
    world.gatherState.delete(u.id);
    st.progress.delete(u);
    st.resting.delete(u);
    if (units.length > 1) st.members.set(u, { path, speed, facing: Math.atan2(forward.x, forward.z), slot: path.at(-1) ?? u.pos });
    else st.members.delete(u);
    world.setState(u, 'moving');
  });
  settleCancelled(world, cancelled);
  if (!moved) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/** Rebuild a small local spatial hash from tick-start positions; resolve each neighbouring pair once. */
function separation(world: World, st: Steering): void {
  const { bodies, hash, stride } = st;
  bodies.length = 0;
  hash.clear();
  for (const u of world.units.values()) {
    if (u.state === 'garrisoned') continue;
    const i = bodies.length;
    bodies.push({ u, x: u.pos.x, z: u.pos.z, radius: radiusOf(u), moving: u.path.length > 0, pushX: 0, pushZ: 0 });
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
          if (!a.moving && !b.moving) continue;
          let dx = a.x - b.x;
          let dz = a.z - b.z;
          const reach = a.radius + b.radius + 0.12;
          const d2 = dx * dx + dz * dz;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-6) {
            // Stable tie-breaker for identical spawn positions; independent of map iteration order.
            const angle = (Math.min(a.u.id, b.u.id) + Math.max(a.u.id, b.u.id)) * GOLDEN_ANGLE;
            const sign = a.u.id < b.u.id ? 1 : -1;
            dx = Math.sin(angle) * sign;
            dz = Math.cos(angle) * sign;
          } else { dx /= d; dz /= d; }
          const force = (reach - d) * 6;
          // Idle bodies take most of the displacement; working/attacking bodies hold their ground.
          const shareA = a.moving ? (b.moving ? 0.5 : b.u.state === 'idle' ? 0.15 : 1)
            : a.u.state === 'idle' ? 0.85 : 0;
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
  const maskFor = (owner: number): Rect[] => {
    let mask = masks.get(owner);
    if (!mask) masks.set(owner, (mask = closedGates(world, owner)));
    return mask;
  };
  for (const body of st.bodies) {
    const { u } = body;
    if (!body.moving) {
      st.members.delete(u);
      st.progress.delete(u);
      let rest = st.resting.get(u);
      if (rest && (rest.path !== u.path || u.state !== 'idle')) { st.resting.delete(u); rest = undefined; }
      // Stationary workers retain their jobs; only idle units yield their positions.
      if (u.state === 'idle' && (body.pushX || body.pushZ || rest)) {
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
        u.pos = safeStep(world.nav, u.pos, next, maskFor(u.owner));
      }
      continue;
    }
    st.resting.delete(u);
    let member = st.members.get(u);
    // Other systems replace path arrays when issuing orders; stale formation caps expire automatically.
    if (member && member.path !== u.path) { st.members.delete(u); member = undefined; }
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
      const next = safeStep(world.nav, u.pos, finish ? wp : { x: u.pos.x + mx, z: u.pos.z + mz }, maskFor(u.owner));
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
        u.facing = member.facing;
        st.resting.set(u, { path: u.path, slot: member.slot });
      }
      st.members.delete(u);
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
    const path = route(world, u.owner, u.pos, end, 1.2);
    progress.stalled = 0;
    if (path) {
      u.path = path;
      st.progress.delete(u);
      const member = st.members.get(u);
      if (member) member.path = path;
    }
    searches++;
    if (searches >= REPATHS_PER_TICK || world.nav.expanded - expanded >= REPATH_WORK) {
      st.repathCursor = (index + 1) % n;
      break;
    }
  }
  return arrived;
}
