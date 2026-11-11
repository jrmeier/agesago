import type { Stat, Subject } from '../core/techs';
import type { Age, BuildingKind, EntityId, PlayerId, Stockpile, Vec2 } from '../core/types';
import { BALANCE } from '../sim/balance';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { clearStatCache, statOf } from '../sim/systems/research';
import { gainXp } from '../sim/systems/veterancy';
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
  /**
   * Place a finished `kind` building for `owner` (e.g. an enemy) on the first free spot spiralling
   * out from `near` (on ground the local player has explored), ignoring territory and cost;
   * returns its id (or null). Capture e2e (M18-4).
   */
  placeFor(kind: BuildingKind, owner: PlayerId, near: Vec2): EntityId | null;
  /** Set a building's hit points (clamped to 1..maxHp) without killing it; returns the new hp. */
  setHp(id: EntityId, hp: number): number | null;
  /** Give unit `id` experience (promotes it like a kill would). Returns its rank, or null. */
  grantXp(id: EntityId, xp: number): number | null;
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
    placeFor(kind, owner, near) {
      // Only the site matters (checked on the local player's explored map): territory, spacing and cost don't.
      const siteOk = (reason?: string) => !reason || ['territory', 'enemy-territory', 'town-spacing', 'insufficient-resources'].includes(reason);
      for (let r = 0; r <= 20; r += 1) {
        for (let a = 0; a < (r ? 16 : 1); a++) {
          const ang = (a / 16) * Math.PI * 2;
          const pos = { x: near.x + Math.cos(ang) * r, z: near.z + Math.sin(ang) * r };
          if (!siteOk(world.canPlace(kind, pos, 0, local()).reason)) continue;
          const b = layFoundation(world, kind, pos, 0, owner);
          completeBuilding(world, b);
          b.hp = b.maxHp;
          return b.id;
        }
      }
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
    setHp(id, hp) {
      const b = world.buildings.get(id);
      if (!b) return null;
      b.hp = Math.min(b.maxHp, Math.max(1, hp));
      world.events.emit({ type: 'damaged', id, hp: b.hp, maxHp: b.maxHp, by: null });
      return b.hp;
    },
    grantXp(id, xp) {
      const unit = world.units.get(id);
      if (!unit) return null;
      gainXp(world, unit, xp);
      return unit.rank ?? 0;
    },
  };
}
