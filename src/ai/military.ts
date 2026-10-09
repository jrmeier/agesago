import type { BuildingKind, EntityId, Stockpile, Unit, UnitKind, Vec2 } from '../core/types';
import { UNITS, damage, trainable, type UnitClass } from '../core/units';
import { canAfford, dist, type Ctx, type Snapshot } from './context';
import { PRODUCTION, norm, type Economy } from './economy';
import type { SeenBuilding } from './intel';

/** A typical member of each class, for judging matchups. */
const TYPICAL: Record<UnitClass, UnitKind> = { villager: 'villager', infantry: 'swordsman', archer: 'archer', cavalry: 'horseman' };
const CLASSES: UnitClass[] = ['infantry', 'archer', 'cavalry'];
/** Enemies this close to the base (or to where we were just hit) are a threat. */
const BASE_RADIUS = 26;
/** Max units re-ordered per pass (each order runs a path search). */
const ORDERS_PER_PASS = 14;

/**
 * How well `k` fares against class `c` per unit of resources: Lanchester-style damage dealt
 * per second × own hp ÷ damage taken per second, divided by cost (gold counts extra).
 */
function matchup(k: UnitKind, c: UnitClass): number {
  const me = UNITS[k];
  const foe = UNITS[TYPICAL[c]];
  const out = damage(k, c, foe.armor) / me.reload;
  const into = damage(TYPICAL[c], me.unitClass, me.armor) / foe.reload;
  const cost = (me.cost.food ?? 0) + (me.cost.wood ?? 0) + 1.3 * (me.cost.gold ?? 0) + 1.1 * (me.cost.stone ?? 0);
  return (out * me.hp) / into / cost;
}
const MATCHUP = new Map<string, number>();
for (const k of Object.keys(UNITS) as UnitKind[]) for (const c of CLASSES) MATCHUP.set(`${k}/${c}`, matchup(k, c));

type Mode = 'gather' | 'attack';

/** Army production (countering what it has seen), rally, defence, attack waves and retreat. */
export class Military {
  mode: Mode = 'gather';
  /** Waves launched so far. */
  wave = 0;
  readonly attackers = new Set<EntityId>();
  private startHp = 0;
  private target: SeenBuilding | null = null;
  private lastWave = -Infinity;
  private threatSince: number | null = null;
  private calm = 0;
  private shelterUntil = -Infinity;
  private lastHit: { pos: Vec2; at: number } | null = null;
  private readonly rallied = new Map<EntityId, Vec2>();

  constructor(
    private readonly c: Ctx,
    private readonly econ: Economy
  ) {}

  /** One of our units or buildings was hit at `pos`. */
  onAttacked(pos: Vec2): void {
    this.lastHit = { pos: { ...pos }, at: this.c.world.time };
  }

  waveSize(): number {
    const p = this.c.profile;
    return Math.min(p.maxWave, p.firstWave + this.wave * p.waveGrowth);
  }

  /** Where the army waits: in front of the base, toward the enemy (or the map centre). */
  rallyPoint(): Vec2 {
    const { world, intel } = this.c;
    const home = this.c.home;
    const to = intel.enemyStart ?? { x: world.hf.width / 2, z: world.hf.depth / 2 };
    const d = norm({ x: to.x - home.x, z: to.z - home.z });
    const p = { x: home.x + d.x * 9, z: home.z + d.z * 9 };
    return world.nav.nearestFree(p) ?? p;
  }

  pass(s: Snapshot): void {
    const rally = this.rallyPoint();
    this.train(s, rally);
    for (const id of this.attackers) if (!this.c.world.units.has(id)) this.attackers.delete(id);
    const home = s.army.filter((u) => !this.attackers.has(u.id));
    if (this.defend(s, home)) return;
    if (this.mode === 'attack') this.pressAttack(home, rally);
    else this.muster(s, home, rally);
  }

  // ---- Production ----

  private train(s: Snapshot, rally: Vec2): void {
    const { world, player, profile } = this.c;
    const stock = world.stockOf(player);
    // Villagers come first while the economy is still growing.
    const reserve: Partial<Stockpile> = s.villagers.length < profile.targetVillagers && s.tc ? { food: 50 } : {};
    for (const b of s.buildings) {
      if (!b.complete || !PRODUCTION.includes(b.kind)) continue;
      const r = this.rallied.get(b.id);
      if (!r || dist(r, rally) > 3) {
        this.c.issue({ type: 'rally', buildingId: b.id, pos: rally });
        this.rallied.set(b.id, rally);
      }
      if (b.queue >= profile.militaryQueue || s.popUsed >= s.popCap) continue;
      const kind = this.chooseUnit(b.kind, s, stock, reserve);
      if (!kind) continue;
      const before = b.queue;
      this.c.issue({ type: 'train', buildingId: b.id, unit: kind });
      if (b.queue > before) s.popUsed++;
    }
  }

  /** The unit to train at `building`: best counter to the enemy's seen mix, kept varied. */
  chooseUnit(building: BuildingKind, s: Snapshot, stock: Stockpile, reserve: Partial<Stockpile>): UnitKind | null {
    const opts = trainable(building).filter((k) => k !== 'scout' && k !== 'villager' && canAfford(stock, UNITS[k].cost, reserve));
    if (!opts.length) return null;
    if (!this.c.profile.counters) return opts[Math.floor(this.c.rng() * opts.length)];
    const seen = this.c.intel.enemyMix();
    // Prior until we've seen something: mostly infantry.
    const mix: Record<UnitClass, number> = { villager: 0, infantry: seen.infantry + 2, archer: seen.archer + 1, cavalry: seen.cavalry + 1 };
    const total = mix.infantry + mix.archer + mix.cavalry;
    const mine: Record<UnitClass, number> = { villager: 0, infantry: 0, archer: 0, cavalry: 0 };
    for (const u of s.army) mine[UNITS[u.kind].unitClass]++;
    const army = Math.max(1, s.army.length);
    let best: UnitKind | null = null;
    let bestScore = -Infinity;
    for (const k of opts) {
      let score = 0;
      for (const c of CLASSES) score += (mix[c] / total) * MATCHUP.get(`${k}/${c}`)!;
      // Keep the army mixed: a class over half the army loses appeal.
      const share = mine[UNITS[k].unitClass] / army;
      score *= 1 - Math.max(0, share - 0.5) + 0.15 * this.c.rng();
      if (score > bestScore) [best, bestScore] = [k, score];
    }
    return best;
  }

  // ---- Defence ----

  /** Enemy units at home (near the base, or near where we were just hit). */
  private threats(s: Snapshot): Unit[] {
    const { world, player, intel } = this.c;
    const hit = this.lastHit && world.time - this.lastHit.at < 12 ? this.lastHit.pos : null;
    const out: Unit[] = [];
    for (const u of world.units.values()) {
      if (u.kind === 'villager' || !world.areEnemies(player, u.owner) || !intel.sees(u.pos.x, u.pos.z)) continue;
      if (dist(u.pos, this.c.home) < BASE_RADIUS || (hit && dist(u.pos, hit) < 14) || s.buildings.some((b) => dist(u.pos, b.pos) < 10)) out.push(u);
    }
    return out;
  }

  /** Respond to raids after the reaction delay. True while defending (no attack orders this pass). */
  private defend(s: Snapshot, home: Unit[]): boolean {
    const { world, profile } = this.c;
    const threats = this.threats(s);
    // Sheltering villagers go back to work after two quiet passes, or after a while anyway
    // (the Town Center doesn't shoot back, so hiding forever only starves the economy).
    this.calm = threats.length ? 0 : this.calm + 1;
    if (this.c.sheltered.size && (this.calm >= 2 || world.time > this.shelterUntil)) {
      const ids = [...this.c.sheltered].filter((id) => world.units.has(id));
      this.c.sheltered.clear();
      if (ids.length) this.c.issue({ type: 'stop', unitIds: ids });
    }
    if (!threats.length) {
      this.threatSince = null;
      return false;
    }
    this.threatSince ??= world.time;
    if (world.time - this.threatSince < profile.reaction) return false;

    const c = { x: 0, z: 0 };
    for (const t of threats) {
      c.x += t.pos.x / threats.length;
      c.z += t.pos.z / threats.length;
    }
    const soldiers = threats.filter((t) => t.kind !== 'scout').length;
    let defenders = home;
    // Outnumbered at home: call the attack back.
    if (this.mode === 'attack' && soldiers > home.length) {
      const away = [...this.attackers].map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
      defenders = [...home, ...away];
      this.attackers.clear();
      this.mode = 'gather';
    }
    const idle = defenders.filter((u) => u.state !== 'attacking' && dist(u.pos, c) > 4).slice(0, ORDERS_PER_PASS);
    if (idle.length) this.c.issue({ type: 'attackMove', unitIds: idle.map((u) => u.id), target: c });

    // Garrison-lite: villagers near raiding soldiers run to the Town Center.
    if (profile.shelter && soldiers > 0 && s.tc) {
      const run = s.villagers.filter((v) => !this.c.sheltered.has(v.id) && threats.some((t) => t.kind !== 'scout' && dist(t.pos, v.pos) < 12));
      if (run.length && world.time > this.shelterUntil + 15) {
        this.shelterUntil = world.time + 20;
        for (const v of run) this.c.sheltered.add(v.id);
        this.c.issue({ type: 'move', unitIds: run.map((v) => v.id), target: s.tc.pos });
      }
    }
    return true;
  }

  // ---- Attack waves ----

  private muster(s: Snapshot, home: Unit[], rally: Vec2): void {
    const { world, profile, intel } = this.c;
    // Big enough for this wave, and (unless maxed out on population) bigger than the army we've seen.
    const maxed = s.popUsed >= Math.min(s.popCap, 200) - 3;
    const enough = home.length >= this.waveSize() && (maxed || !profile.counters || home.length >= intel.enemyArmy() * 1.25);
    const ready = enough && world.time >= profile.firstAttack && world.time - this.lastWave >= profile.waveGap;
    if (ready) {
      const from = centroid(home);
      this.target = intel.nearestBuilding(from);
      this.mode = 'attack';
      this.wave++;
      this.lastWave = world.time;
      for (const u of home) this.attackers.add(u.id);
      this.startHp = home.reduce((n, u) => n + u.hp, 0);
      this.advance(home, true);
      return;
    }
    const stray = home.filter((u) => u.state === 'idle' && dist(u.pos, rally) > 10).slice(0, ORDERS_PER_PASS);
    if (stray.length) this.c.issue({ type: 'move', unitIds: stray.map((u) => u.id), target: rally });
  }

  private pressAttack(home: Unit[], rally: Vec2): void {
    const { world, profile, intel, player } = this.c;
    const group = [...this.attackers].map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
    if (!group.length) {
      this.mode = 'gather';
      return;
    }
    const at = centroid(group);
    // Badly hurt and losing the fight: fall back.
    if (profile.retreatAt > 0) {
      const hp = group.reduce((n, u) => n + u.hp, 0);
      let foes = 0;
      for (const u of world.units.values()) {
        if (u.kind !== 'villager' && world.areEnemies(player, u.owner) && dist(u.pos, at) < 16 && intel.sees(u.pos.x, u.pos.z)) foes++;
      }
      if (hp < this.startHp * profile.retreatAt && foes >= group.length * 0.7) {
        this.c.issue({ type: 'move', unitIds: group.map((u) => u.id), target: rally });
        this.attackers.clear();
        this.mode = 'gather';
        this.lastWave = world.time;
        return;
      }
    }
    if (!this.target || !intel.buildings.has(this.target.id)) this.target = intel.nearestBuilding(at);
    // Fresh troops at the rally point join the push in groups.
    const fresh = home.filter((u) => u.state === 'idle' && dist(u.pos, rally) < 14);
    if (fresh.length >= 4) {
      for (const u of fresh) this.attackers.add(u.id);
      this.startHp += fresh.reduce((n, u) => n + u.hp, 0);
      this.advance(fresh, true);
    }
    this.advance(group, false);
  }

  /** Order `units` (all of them, or only idle ones) toward the current target, or to search for one. */
  private advance(units: Unit[], all: boolean): void {
    const { world } = this.c;
    const movers = (all ? units : units.filter((u) => u.state === 'idle')).slice(0, ORDERS_PER_PASS);
    if (!movers.length) return;
    const t = this.target;
    if (!t) {
      // Nothing known: sweep unexplored ground (or look around) as a group.
      const p = this.econ.frontier(movers[0]) ?? this.c.intel.enemyStart;
      if (p) this.c.issue({ type: 'attackMove', unitIds: movers.map((u) => u.id), target: p });
      return;
    }
    const at = centroid(movers);
    const near = movers.filter((u) => dist(u.pos, t.pos) < t.radius + 9);
    const far = movers.filter((u) => dist(u.pos, t.pos) >= t.radius + 9);
    if (near.length && world.buildings.has(t.id)) this.c.issue({ type: 'attack', unitIds: near.map((u) => u.id), targetId: t.id });
    if (far.length) {
      const d = norm({ x: at.x - t.pos.x, z: at.z - t.pos.z });
      const p = { x: t.pos.x + d.x * (t.radius + 2.5), z: t.pos.z + d.z * (t.radius + 2.5) };
      this.c.issue({ type: 'attackMove', unitIds: far.map((u) => u.id), target: world.nav.nearestFree(p) ?? p });
    }
  }
}

function centroid(units: Unit[]): Vec2 {
  const c = { x: 0, z: 0 };
  for (const u of units) {
    c.x += u.pos.x / units.length;
    c.z += u.pos.z / units.length;
  }
  return c;
}
