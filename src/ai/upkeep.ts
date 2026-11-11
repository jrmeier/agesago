import { BUILDINGS, MAX_POP, nextUpgrade } from '../core/buildings';
import type { Building, BuildingKind, Stockpile, Unit, UnitState } from '../core/types';
import { isAnimal, UNITS } from '../core/units';
import { BALANCE } from '../sim/balance';
import { upgradeBlock } from '../sim/systems/buildingUpgrade';
import { canRepair } from '../sim/systems/repair';
import { ageOf } from '../sim/systems/research';
import { addStock, canAfford, dist, type Ctx, type Snapshot } from './context';
import { PRODUCTION } from './economy';

/** Enemies (soldiers or scouts) in sight this close to the base or a building mean an attack is on. */
const BASE_RADIUS = 30;
const NEAR_BUILDING = 12;
/** Quiet seconds (no enemy in sight near the base) before repairs start. */
export const REPAIR_CALM = 10;
/** Most villagers repairing at once. */
export const MAX_REPAIRERS = 3;
/** Longest a building is held idle (no training or research) waiting to start an upgrade. */
const HOLD_LIMIT = 30;
const REPAIRING: ReadonlySet<UnitState> = new Set(['toRepair', 'repairing']);
const BUSY: ReadonlySet<UnitState> = new Set(['toBuild', 'building', 'toRepair', 'repairing', 'moving', 'garrisoned']);

/**
 * Building upkeep (M14-6): in-place upgrades and repairs. Acts only through Ctx.issue.
 *
 * - Upgrades: Large Houses near the pop cap with wood to spare; watch towers along their chain
 *   when threatened or rich; the Town Center one tier per age once the villager boom is done
 *   (or when raided); military buildings to level 2 in the City Age once the army trained there
 *   is big enough for its lines (the tier-3 lines need it), or when rich. Every cost leaves
 *   `ctx.reserve` (the age-up) alone. A building that is busy is held idle (`ctx.upgradeHold`)
 *   for at most HOLD_LIMIT seconds so its queue drains and the upgrade can start.
 * - Repairs: once no enemy has been in sight near the base for REPAIR_CALM seconds, up to
 *   MAX_REPAIRERS villagers repair damaged buildings, Town Center first.
 */
export class Upkeep {
  /** Upgrades this AI started (tests and debugging). */
  readonly upgrades: { kind: BuildingKind; tier: number; at: number }[] = [];
  /** Repair orders issued. */
  repairs = 0;
  /** Sim time an enemy was last in sight near the base. */
  lastThreat = -Infinity;
  private lastHit = -Infinity;
  private holdSince = 0;

  constructor(private readonly c: Ctx) {}

  /** One of ours was hit: counts as a threat (for towers) and as an attack in progress. */
  onAttacked(): void {
    this.lastHit = this.c.world.time;
  }

  pass(s: Snapshot): void {
    if (this.threatened(s)) this.lastThreat = this.c.world.time;
    this.upgrade(s);
    this.repair(s);
  }

  /** An enemy soldier or scout we can see is near the base or one of our buildings. */
  private threatened(s: Snapshot): boolean {
    const { world, player, intel } = this.c;
    for (const u of world.units.values()) {
      if (u.kind === 'villager' || isAnimal(u.kind) || !world.areEnemies(player, u.owner) || !intel.sees(u.pos.x, u.pos.z)) continue;
      if (dist(u.pos, this.c.home) < BASE_RADIUS) return true;
      for (const b of s.buildings) if (dist(u.pos, b.pos) < NEAR_BUILDING + b.radius) return true;
    }
    return false;
  }

  // ---- Upgrades ----

  private upgrade(s: Snapshot): void {
    const { world, player } = this.c;
    // One upgrade at a time keeps spending modest.
    if (s.buildings.some((b) => b.upgrading)) return this.release();
    const pick = this.choose(s);
    if (!pick) return this.release();
    const block = upgradeBlock(world, pick, player);
    if (block === 'busy') {
      // Let its queue drain (training and research skip it), but not forever.
      if (this.c.upgradeHold !== pick.id) {
        this.c.upgradeHold = pick.id;
        this.holdSince = world.time;
      } else if (world.time - this.holdSince > HOLD_LIMIT) {
        this.c.upgradeHold = null;
        this.holdSince = world.time + 60; // wait a minute before holding anything again
      }
      return;
    }
    this.release();
    if (block !== null) return;
    this.c.issue({ type: 'upgradeBuilding', buildingId: pick.id });
    if (pick.upgrading) this.upgrades.push({ kind: pick.kind, tier: pick.upgrading.to, at: world.time });
  }

  private release(): void {
    this.c.upgradeHold = null;
  }

  /** The building most worth upgrading now that it can afford (keeping the reserve), if any. */
  choose(s: Snapshot): Building | null {
    const { world, player, profile } = this.c;
    const stock = world.stockOf(player);
    const age = ageOf(world, player);
    const raided = world.time - this.lastHit < 120;
    const threatened = raided || world.time - this.lastThreat < 60;
    const ok = (b: Building, extra: Partial<Stockpile> = {}): boolean => {
      const spec = nextUpgrade(b.kind, b.tier);
      if (!b.complete || !spec || spec.age > age) return false;
      // The age-up and a new Town Center being saved for (M18-5) come first.
      const keep: Partial<Stockpile> = addStock(this.c.reserve, this.c.townReserve);
      for (const [r, n] of Object.entries(extra) as [keyof Stockpile, number][]) keep[r] = (keep[r] ?? 0) + n;
      return canAfford(stock, spec.cost, keep);
    };
    const holding = world.time < this.holdSince; // a hold just timed out
    const idle = (b: Building) => !holding || upgradeBlock(world, b, player, true) !== 'busy';
    const first = (kind: BuildingKind, extra?: Partial<Stockpile>) =>
      s.buildings.find((b) => b.kind === kind && ok(b, extra) && idle(b)) ?? null;

    // Town Center: one tier per age, once the boom is done (it stops villagers) or when raided.
    const tc = s.tc;
    if (tc && (tc.tier ?? 0) < age && (s.villagers.length + tc.queue >= profile.targetVillagers || raided) && ok(tc) && idle(tc)) return tc;

    // Watch towers along the chain when threatened, or when stone and wood pile up.
    const tower = first('watchTower', threatened ? {} : { wood: 300, stone: 300 });
    if (tower) return tower;

    // Military buildings to level 2 (tier-3 lines need it) once the army made there is big
    // enough for its lines, or when rich.
    if (age >= 2) {
      const made: Partial<Record<BuildingKind, number>> = {};
      for (const u of s.army) {
        const at = UNITS[u.kind].trainedAt;
        if (at && PRODUCTION.includes(at)) made[at] = (made[at] ?? 0) + 1;
      }
      const lines = profile.research?.lineUnits ?? 5;
      const kinds = [...PRODUCTION].sort((a, b) => (made[b] ?? 0) - (made[a] ?? 0));
      for (const k of kinds) {
        const b = first(k, (made[k] ?? 0) >= lines ? {} : { wood: 400, gold: 400 });
        if (b) return b;
      }
    }

    // Large Houses: near the pop cap with wood to spare.
    if (s.popCap < MAX_POP && s.popCap - s.popUsed <= 6) {
      const house = first('house', { wood: 100 });
      if (house) return house;
    }
    return null;
  }

  // ---- Repairs ----

  private repair(s: Snapshot): void {
    const { world } = this.c;
    if (world.time - this.lastThreat < REPAIR_CALM || world.time - this.lastHit < REPAIR_CALM) return;
    let repairing = 0;
    for (const v of s.villagers) if (REPAIRING.has(v.state)) repairing++;
    if (repairing >= MAX_REPAIRERS) return;
    const target = this.damaged(s);
    if (!target) return;
    const want = MAX_REPAIRERS - repairing;
    const free = s.villagers.filter((v) => !this.c.sheltered.has(v.id) && !BUSY.has(v.state));
    const near = (v: Unit) => dist(v.pos, target.pos) + (v.gatherNode !== null && world.buildings.has(v.gatherNode) ? 20 : 0);
    const crew = free.sort((a, b) => near(a) - near(b)).slice(0, want);
    if (!crew.length) return;
    this.c.issue({ type: 'repair', unitIds: crew.map((v) => v.id), targetId: target.id });
    this.repairs++;
  }

  /** The damaged building to repair next: the Town Center first, then the most damaged it can pay for. */
  private damaged(s: Snapshot): Building | null {
    const { world, player } = this.c;
    const stock = world.stockOf(player);
    let best: Building | null = null;
    let bestScore = -Infinity;
    for (const b of s.buildings) {
      if (b.kind === 'farm' || !canRepair(world, b, player)) continue;
      const missing = 1 - b.hp / b.maxHp;
      if (missing < 0.05 && b.kind !== 'townCenter') continue;
      // Can pay for at least a quarter of what's missing without touching the reserve.
      const cost: Partial<Stockpile> = {};
      for (const [r, n] of Object.entries(BUILDINGS[b.kind].cost) as [keyof Stockpile, number][]) cost[r] = Math.ceil(n * BALANCE.repairCostFactor * missing * 0.25);
      if (!canAfford(stock, cost, this.c.reserve)) continue;
      const score = (b.kind === 'townCenter' ? 10 : 0) + missing;
      if (score > bestScore) [best, bestScore] = [b, score];
    }
    return best;
  }
}

