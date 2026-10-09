import { BUILDINGS } from '../core/buildings';
import type { Building, BuildingKind, Command, EntityId, PlayerId, ResourceType, Stockpile, Unit, Vec2 } from '../core/types';
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
  /** Villagers held at the Town Center during a raid (the economy leaves them alone). */
  readonly sheltered: Set<EntityId>;
  /** Where the base is: the Town Center, else the first building, else where it was. */
  home: Vec2;
  /** Nav region of the base (for reachability checks). */
  region: number;
}

/** One sweep over the world: this player's units and buildings, sorted by role. */
export interface Snapshot {
  villagers: Unit[];
  scouts: Unit[];
  army: Unit[];
  buildings: Building[];
  tc: Building | undefined;
  /** Population plus units queued (what the pop cap is checked against). */
  popUsed: number;
  popCap: number;
  count: Partial<Record<BuildingKind, number>>;
  /** Count of each kind still under construction. */
  building: Partial<Record<BuildingKind, number>>;
}

export function snapshot(world: World, player: PlayerId): Snapshot {
  const s: Snapshot = { villagers: [], scouts: [], army: [], buildings: [], tc: undefined, popUsed: 0, popCap: world.popCapOf(player), count: {}, building: {} };
  for (const u of world.units.values()) {
    if (u.owner !== player) continue;
    s.popUsed++;
    if (u.kind === 'villager') s.villagers.push(u);
    else if (u.kind === 'scout') s.scouts.push(u);
    else s.army.push(u);
  }
  for (const b of world.buildings.values()) {
    if (b.owner !== player) continue;
    s.buildings.push(b);
    s.popUsed += b.queue;
    s.count[b.kind] = (s.count[b.kind] ?? 0) + 1;
    if (!b.complete) s.building[b.kind] = (s.building[b.kind] ?? 0) + 1;
    if (b.kind === 'townCenter' && !s.tc) s.tc = b;
  }
  return s;
}

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

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
