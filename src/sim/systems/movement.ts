import type { EntityId, Unit, Vec2 } from '../../core/types';
import { BALANCE } from '../balance';
import type { World } from '../World';
import { cancelExplore, settleCancelled } from './explore';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Ring offset for the i-th unit of a group order (0 stands on the target). */
export function formationOffset(i: number): Vec2 {
  if (i === 0) return { x: 0, z: 0 };
  const r = BALANCE.formationBase + BALANCE.formationStep * Math.sqrt(i);
  const a = i * GOLDEN_ANGLE;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

/** Walking speed of `u` right now. */
export function speedOf(u: Unit): number {
  if (u.kind === 'scout') return BALANCE.scoutSpeed;
  return u.carry && u.carry.amount > 0 ? BALANCE.villagerSpeedLoaded : BALANCE.villagerSpeed;
}

/** 'move' command: path every unit to its formation slot, dropping gather and explore work. */
export function orderMove(world: World, unitIds: EntityId[], target: Vec2): void {
  const units = unitIds.map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
  if (!units.length) return;
  const cancelled = cancelExplore(world, units);
  let moved = 0;
  units.forEach((u, i) => {
    const o = formationOffset(i);
    const slot = { x: target.x + o.x, z: target.z + o.z };
    const path = world.nav.findPath(u.pos, slot) ?? (i > 0 ? world.nav.findPath(u.pos, target) : null);
    if (!path) return;
    moved++;
    u.path = path;
    u.gatherNode = null;
    u.gatherType = null;
    world.gatherState.delete(u.id);
    world.setState(u, 'moving');
  });
  settleCancelled(world, cancelled);
  if (!moved) world.events.emit({ type: 'rejected', reason: 'unreachable' });
}

/** Advance units along their paths; returns the units that reached their last waypoint this tick. */
export function movementSystem(world: World, dt: number): Unit[] {
  const arrived: Unit[] = [];
  for (const u of world.units.values()) {
    if (!u.path.length) continue;
    let budget = speedOf(u) * dt;
    while (budget > 0 && u.path.length) {
      const wp = u.path[0];
      const dx = wp.x - u.pos.x;
      const dz = wp.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) u.facing = Math.atan2(dx, dz);
      if (d <= budget) {
        u.pos = { x: wp.x, z: wp.z };
        u.path.shift();
        budget -= d;
      } else {
        u.pos = { x: u.pos.x + (dx / d) * budget, z: u.pos.z + (dz / d) * budget };
        budget = 0;
      }
    }
    if (!u.path.length) {
      arrived.push(u);
      if (u.state === 'moving') world.setState(u, 'idle');
    }
  }
  return arrived;
}
