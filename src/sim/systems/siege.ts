import type { PlayerId, Unit, UnitKind } from '../../core/types';
import { packs, UNITS } from '../../core/units';
import type { World } from '../World';
import { unitStat } from './research';

/**
 * Siege engines that pack (catapult, bolt shooter; after 0 A.D.'s Pack component). Packed, they
 * walk but cannot shoot; deployed (`Unit.deployed`), they shoot but cannot walk. Switching takes
 * packTime seconds in the 'unpacking' or 'packing' state, counted down in `Unit.packTimer`.
 *
 * Orders never wait for this: a deployed engine given a path packs first, then walks (this
 * system turns the order's state into 'packing' and back); combat unpacks an engine in range
 * before its first shot. An order that keeps the engine still cancels a pack under way (it stays
 * deployed); any order during an unpack cancels the unpack (it was still packed). Both instantly.
 */

/** Seconds a `kind` engine of `owner` takes to pack or to unpack (research applied). */
export function packTime(world: World, owner: PlayerId, kind: UnitKind): number {
  return unitStat(world, owner, kind, 'packTime', UNITS[kind].packTime ?? 0);
}

/** Cannot walk: deployed, or packing / unpacking. */
export function anchored(u: Unit): boolean {
  return u.deployed === true || u.state === 'packing' || u.state === 'unpacking';
}

/** Can shoot now: anything that does not pack, or a deployed engine that is not packing. */
export function readyToFire(u: Unit): boolean {
  return !packs(u.kind) || (u.deployed === true && u.state !== 'packing');
}

/** Start setting up where it stands (combat calls this for a packed engine with a target in range). */
export function startUnpack(world: World, u: Unit): void {
  u.path = [];
  u.packTimer = packTime(world, u.owner, u.kind);
  world.setState(u, 'unpacking');
}

/** Per tick, before movement: run pack/unpack timers and make deployed engines pack before walking. */
export function siegeSystem(world: World, dt: number): void {
  for (const u of world.units.values()) {
    if (!packs(u.kind)) continue;
    if (u.state === 'packing' || u.state === 'unpacking') {
      if (u.state === 'packing' && !u.path.length) {
        // Nothing left to walk to: stay deployed.
        delete u.packTimer;
        world.setState(u, u.target !== null ? 'attacking' : 'idle');
        continue;
      }
      u.packTimer = (u.packTimer ?? 0) - dt;
      if (u.packTimer > 1e-9) continue;
      delete u.packTimer;
      if (u.state === 'unpacking') {
        u.deployed = true;
        world.setState(u, u.target !== null ? 'attacking' : 'idle');
      } else {
        delete u.deployed;
        world.setState(u, u.target !== null ? 'attacking' : u.path.length ? 'moving' : 'idle');
      }
      continue;
    }
    if (u.deployed && u.path.length) {
      // Keep the progress of a pack an order interrupted (a new move order mid-pack).
      u.packTimer ??= packTime(world, u.owner, u.kind);
      world.setState(u, 'packing');
    } else if (u.packTimer !== undefined) {
      // An order replaced the transition: a pack stays deployed, an unpack stays packed.
      delete u.packTimer;
    }
  }
}
