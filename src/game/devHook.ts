import type { Stat, Subject } from '../core/techs';
import type { Age, BuildingKind, EntityId, Stockpile } from '../core/types';
import { BALANCE } from '../sim/balance';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { clearStatCache, statOf } from '../sim/systems/research';
import type { World } from '../sim/World';

/**
 * DEV / E2E ONLY. Small cheats for browser tests, exposed as `window.dev` next to
 * `window.game` (dev builds, or production opened with ?e2e). Never used by the game itself.
 */
export interface DevHook {
  /** Add resources to the local player. */
  give(stock: Partial<Stockpile>): void;
  /** Place a finished building of `kind` near the local Town Center; returns its id (or null). */
  placeComplete(kind: BuildingKind): EntityId | null;
  /** Run the sim `seconds` ahead at the fixed tick rate. */
  fastForward(seconds: number): void;
  /** The local player's upgraded stat (sim statOf). */
  statOf(subject: Subject, stat: Stat, base: number): number;
  /** Jump the local player to `age`. */
  setAge(age: Age): void;
}

export function devHook(world: World): DevHook {
  const local = () => world.localPlayer;
  return {
    give(stock) {
      const s = world.stockOf(local());
      for (const [k, v] of Object.entries(stock) as [keyof Stockpile, number][]) s[k] = (s[k] ?? 0) + v;
      world.emitStock();
    },
    placeComplete(kind) {
      const tc = world.townCenterOf(local());
      if (!tc) return null;
      // Spiral out from the Town Center to the first legal spot (resources are topped up so cost never blocks).
      world.stockOf(local()).wood += 1000;
      world.stockOf(local()).stone += 1000;
      for (let r = 6; r <= 30; r += 1) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const pos = { x: tc.pos.x + Math.cos(ang) * r, z: tc.pos.z + Math.sin(ang) * r };
          if (!world.canPlace(kind, pos, 0, local()).ok) continue;
          world.stockOf(local()).wood -= 1000;
          world.stockOf(local()).stone -= 1000;
          const b = layFoundation(world, kind, pos, 0, local());
          b.hp = b.maxHp;
          completeBuilding(world, b);
          return b.id;
        }
      }
      world.stockOf(local()).wood -= 1000;
      world.stockOf(local()).stone -= 1000;
      return null;
    },
    fastForward(seconds) {
      const step = 1 / BALANCE.tickRate;
      for (let t = 0; t < seconds; t += step) world.tick(step);
    },
    statOf(subject, stat, base) {
      return statOf(world, local(), subject, stat, base);
    },
    setAge(age) {
      const p = world.players.get(local());
      if (p) p.age = age;
      clearStatCache(world);
    },
  };
}
