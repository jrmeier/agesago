import { BUILDINGS } from '../core/buildings';
import type { Building, BuildingKind, Command, EntityId, PlayerId, RejectReason, ResourceType, Stockpile, Unit, Vec2 } from '../core/types';
import { isAnimal, popCost } from '../core/units';
import { buildingQueuedPop } from '../sim/systems/train';
import type { World } from '../sim/World';
import type { Intel } from './intel';
import type { Profile } from './profile';

/** Everything the AI's subsystems share. */
export interface Ctx {
  readonly world: World;
  readonly player: PlayerId;
  readonly profile: Profile;
  readonly intel: Intel;
  readonly rng: () => number;
  /** Issue a command as this player (the only way the AI changes the game). */
  issue(cmd: Command): void;
  /** Why the last issued command was rejected, or null if it went through (set by issue). */
  lastReject: RejectReason | null;
  /** Villagers held at the Town Center during a raid (the economy leaves them alone). */
  readonly sheltered: Set<EntityId>;
  /** Scouts that explore (the starting ones); scouts trained later are soldiers. */
  readonly explorers: Set<EntityId>;
  /** Where the base is: the Town Center, else the first building, else where it was. */
  home: Vec2;
  /** Nav region of the base (for reachability checks). */
  region: number;
  /**
   * Resources being saved for something important (an age-up). Villager and army training,
   * construction and research leave this much in the stockpile.
   */
  reserve: Partial<Stockpile>;
  /**
   * Saving for a new Town Center (M18-5): army training, research and other construction leave
   * this much (houses, farms and drop sites don't).
   */
  townReserve: Partial<Stockpile>;
  /** Resources held for the next tech: army training leaves this much (villagers don't). */
  techReserve: Partial<Stockpile>;
  /** Food villager training leaves for an economy tech (a short, bounded pause). */
  villagerHold: number;
  /** Outgunned or raided: army training ignores `reserve` and `techReserve`. */
  armyFirst: boolean;
  /** Saving for or researching an age-up: hold new attack waves (defend at home). */
  aging: boolean;
  /** Villager training also leaves `reserve` (a short pause to click up to the Town Age). */
  pauseVillagers: boolean;
  /** A building held idle (no new training or research) so its in-place upgrade can start. */
  upgradeHold: EntityId | null;
}

/** One sweep over the world: this player's units and buildings, sorted by role. */
export interface Snapshot {
  villagers: Unit[];
  /** Exploring scouts (see Ctx.explorers); trained scouts are in `army`. */
  scouts: Unit[];
  army: Unit[];
  buildings: Building[];
  tc: Building | undefined;
  /** Every Town Center, foundations included (the first is `tc`). */
  tcs: Building[];
  /** Population plus units queued (what the pop cap is checked against). */
  popUsed: number;
  popCap: number;
  count: Partial<Record<BuildingKind, number>>;
  /** Count of each kind still under construction. */
  building: Partial<Record<BuildingKind, number>>;
}

export function snapshot(world: World, player: PlayerId, explorers?: ReadonlySet<EntityId>): Snapshot {
  const s: Snapshot = { villagers: [], scouts: [], army: [], buildings: [], tc: undefined, tcs: [], popUsed: 0, popCap: world.popCapOf(player), count: {}, building: {} };
  for (const u of world.units.values()) {
    if (u.owner !== player || isAnimal(u.kind)) continue;
    s.popUsed += popCost(u.kind);
    if (u.kind === 'villager') s.villagers.push(u);
    else if (u.kind === 'scout' && (!explorers || explorers.has(u.id))) s.scouts.push(u);
    else s.army.push(u);
  }
  for (const b of world.buildings.values()) {
    if (b.owner !== player) continue;
    s.buildings.push(b);
    s.popUsed += buildingQueuedPop(b);
    s.count[b.kind] = (s.count[b.kind] ?? 0) + 1;
    if (!b.complete) s.building[b.kind] = (s.building[b.kind] ?? 0) + 1;
    if (b.kind === 'townCenter') {
      s.tcs.push(b);
      // The first finished one (the founding Town Center while it stands).
      if (b.complete && !s.tc) s.tc = b;
    }
  }
  return s;
}

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** `a` plus `b`, resource by resource. */
export function addStock(a: Partial<Stockpile>, b: Partial<Stockpile>): Partial<Stockpile> {
  const out: Partial<Stockpile> = { ...a };
  for (const [r, n] of Object.entries(b) as [ResourceType, number][]) out[r] = (out[r] ?? 0) + n;
  return out;
}

export function canAfford(stock: Stockpile, cost: Partial<Stockpile>, reserve: Partial<Stockpile> = {}): boolean {
  for (const [r, n] of Object.entries(cost) as [ResourceType, number][]) if (stock[r] - (reserve[r] ?? 0) < n) return false;
  return true;
}

/** Drop sites accepting `type` (complete, or foundations — villagers head toward a planned camp). */
export function dropsFor(s: Snapshot, type: ResourceType): Building[] {
  return s.buildings.filter((b) => BUILDINGS[b.kind].drop.includes(type));
}

/** Distance from `p` to the nearest of `sites` (centre to centre, less the site's radius). */
export function nearestSiteDist(p: Vec2, sites: Building[]): number {
  let best = Infinity;
  for (const b of sites) best = Math.min(best, dist(p, b.pos) - b.radius);
  return best;
}

/** Small seeded PRNG (mulberry32). */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
