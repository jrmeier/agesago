import { maxCapturePoints } from '../core/buildings';
import type { Building, BuildingKind, EntityId, Stockpile, Unit, UnitKind, Vec2 } from '../core/types';
import { captureRate, isAnimal, isHero, popCost, UNITS, damage, trainable, type UnitClass } from '../core/units';
import { canAfford, dist, heldBack, type Ctx, type Snapshot } from './context';
import { PRODUCTION, norm } from './economy';
import type { SeenBuilding } from './intel';
import { ageOf } from '../sim/systems/research';
import { tooDamaged } from '../sim/systems/defence';
import { garrisonCap } from '../sim/systems/stats';
import { heroBlock } from '../sim/systems/heroes';

/** A typical member of each class, for judging matchups. */
const TYPICAL: Record<UnitClass, UnitKind> = { villager: 'villager', infantry: 'swordsman', archer: 'archer', cavalry: 'horseman', wildlife: 'deer', ship: 'trireme', siege: 'ram' };
const CLASSES: UnitClass[] = ['infantry', 'archer', 'cavalry'];
/** Enemies this close to the base (or to where we were just hit) are a threat. */
const BASE_RADIUS = 26;
/** Max units re-ordered per pass (each order runs a path search). */
const ORDERS_PER_PASS = 14;
/** Enemy buildings razed rather than captured: cheap, or not worth holding (M18-5). */
const RAZE: ReadonlySet<BuildingKind> = new Set(['house', 'palisade', 'stoneWall', 'gate', 'farm']);
/** Seconds a capture may go without gaining points (a garrison holds it) before the army razes instead. */
const CAPTURE_STALL = 20;
/** Villagers run this far to a shelter; soldiers this far to hold a building under capture. */
const SHELTER_REACH = 30;
/** Buildings it trains at besides the barracks, range and stable (M16-8). */
const LATE_PRODUCTION: BuildingKind[] = ['siegeWorkshop', 'fortress'];
/** Enemy buildings that make a base "defended": siege comes along to the attack (M16-8). */
const DEFENCES: ReadonlySet<BuildingKind> = new Set(['stoneWall', 'palisade', 'gate', 'watchTower', 'fortress']);
/** What rams and catapults go for first: walls, towers and the Town Center. */
const SIEGE_TARGETS: ReadonlySet<BuildingKind> = new Set([...DEFENCES, 'townCenter']);
/** Soldiers per hunting squad, and the grid (world units) it searches, when no enemy building is known. */
const HUNT_SQUAD = 6;
const HUNT_STEP = 12;
/** Fewest enemy soldiers at home that call a running attack back (M16-10). */
const RECALL_MIN = 5;
/** An attack down to this share of the soldiers committed to it is called off (M16-10). */
const SPENT = 0.35;
/** Reinforcements join a running attack only while it holds this share of what it committed. */
const REINFORCE = 0.6;
/** A wave soldier on a building turns on an enemy soldier this close (M16-10). */
const FIGHT_RANGE = 9;
/** Radius around the wave's centre searched for such soldiers. */
const FIGHT_SCAN = 30;
/** Food villager training leaves for soldiers while raiders outnumber the army at home (T120): a villager's price. */
const DEFENCE_HOLD = 50;
/** Seconds a ready wave waits at the rally point for its siege against a defended base. */
const SIEGE_WAIT = 90;
/** Soldiers that guard each siege engine on the way (M17-3 guard order). */
const ESCORTS = 2;
/** City Age gold that counts as rich enough for champions before the Empire Age. */
const CHAMPION_GOLD = 1200;
const isSiege = (k: UnitKind) => UNITS[k].unitClass === 'siege';

/**
 * How well `k` fares against class `c` per unit of resources: Lanchester-style damage dealt
 * per second × own hp ÷ damage taken per second, divided by cost (gold counts extra).
 */
function matchup(k: UnitKind, c: UnitClass): number {
  const me = UNITS[k];
  const foe = UNITS[TYPICAL[c]];
  const out = damage(k, c, foe.armor) / me.reload;
  const into = damage(TYPICAL[c], me.unitClass, me.armor) / foe.reload;
  return (out * me.hp) / into / unitCost(k);
}

/** Resource weights when pricing a unit: gold and stone are scarcer. */
const PRICE: Stockpile = { food: 1, wood: 1, gold: 1.3, stone: 1.1 };

/** A unit's price; with `stock`, a resource piling up (over 400) counts for much less. */
function unitCost(k: UnitKind, stock?: Stockpile): number {
  let n = 0;
  for (const [r, v] of Object.entries(UNITS[k].cost) as [keyof Stockpile, number][]) {
    const glut = stock && stock[r] > 400 ? Math.max(0.25, 400 / stock[r]) : 1;
    n += v * PRICE[r] * glut;
  }
  return Math.max(1, n);
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
  /** Soldiers committed to the running attack (launch plus reinforcements). */
  private committed = 0;
  private target: SeenBuilding | null = null;
  private lastWave = -Infinity;
  private threatSince: number | null = null;
  private calm = 0;
  private shelterUntil = -Infinity;
  private lastHit: { pos: Vec2; at: number } | null = null;
  private readonly rallied = new Map<EntityId, Vec2>();
  /** Own buildings we put units into (emptied once things are calm). */
  private readonly shelters = new Set<EntityId>();
  /** Capture in progress: our points on the target and when they last grew. */
  private captureWatch: { id: EntityId; cp: number; at: number } | null = null;
  /** Enemy buildings that held out against capture: raze them. */
  private readonly raze = new Set<EntityId>();
  /** Escort id → the siege engine it guards. */
  readonly escorts = new Map<EntityId, EntityId>();
  /** Since when a ready wave has waited for siege (null: not waiting). */
  private siegeWait: number | null = null;
  /** Answering an enemy wonder: the whole army goes for it (M16-8). */
  wonderRush = false;
  /** Units already sent at the enemy wonder (re-sent once they go idle). */
  private readonly diverted = new Set<EntityId>();

  constructor(private readonly c: Ctx) {}

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
    // Holding a wonder: the army waits beside it.
    const home = this.ownWonder()?.pos ?? this.c.home;
    const to = intel.enemyStart ?? { x: world.hf.width / 2, z: world.hf.depth / 2 };
    const d = norm({ x: to.x - home.x, z: to.z - home.z });
    const p = { x: home.x + d.x * 9, z: home.z + d.z * 9 };
    return world.nav.nearestFree(p) ?? p;
  }

  pass(s: Snapshot): void {
    const rally = this.rallyPoint();
    this.train(s, rally);
    const { world } = this.c;
    for (const id of this.attackers) if (!world.units.has(id)) this.attackers.delete(id);
    for (const [id, engine] of this.escorts) if (!world.units.has(id) || !world.units.has(engine) || !this.attackers.has(id)) this.escorts.delete(id);
    if (this.answerWonder(s)) {
      this.c.defenceHold = 0;
      return;
    }
    const home = s.army.filter((u) => !this.attackers.has(u.id) && u.state !== 'garrisoned');
    if (this.defend(s, home)) {
      // A running attack goes on meanwhile (M16-10), without reinforcements from home.
      if (this.mode === 'attack' && !this.ownWonder()) this.pressAttack([], rally);
      return;
    }
    // Holding a completed wonder: the army stays home to defend it.
    if (this.mode === 'attack' && this.ownWonder()) this.recall(rally);
    if (this.mode === 'attack') this.pressAttack(home, rally);
    else this.muster(s, home, rally);
  }

  // ---- Production ----

  private train(s: Snapshot, rally: Vec2): void {
    const { world, player, profile } = this.c;
    const stock = world.stockOf(player);
    // Villagers come first while the economy is still growing.
    // Saving for an age or a tech holds the army back, unless outgunned, raided or still
    // short of a first wave's worth of defenders.
    const free = this.c.armyFirst || (ageOf(world, player) > 0 && s.army.length < profile.firstWave);
    const reserve: Partial<Stockpile> = free ? {} : heldBack(this.c);
    if (!free) for (const [r, n] of Object.entries(this.c.techReserve) as [keyof Stockpile, number][]) reserve[r] = (reserve[r] ?? 0) + n;
    if (s.villagers.length < profile.targetVillagers && s.tc && !this.c.defenceHold) reserve.food = (reserve.food ?? 0) + 50;
    if (this.c.openingCivFood > 0 && !this.c.armyFirst && !this.c.defenceHold && s.army.length >= 3) {
      // A short research reserve needs to survive both villager and soldier spending.
      reserve.food = Math.max(reserve.food ?? 0, this.c.openingCivFood);
    }
    // Pop room kept for a siege engine the workshop wants but can't train yet.
    let keepPop = 0;
    // The workshop goes first: a wanted engine holds back its pop room and cost from the rest.
    const order = s.buildings.filter((b) => b.kind === 'siegeWorkshop').concat(s.buildings.filter((b) => b.kind !== 'siegeWorkshop'));
    for (const b of order) {
      if (!b.complete || (!PRODUCTION.includes(b.kind) && !LATE_PRODUCTION.includes(b.kind))) continue;
      const r = this.rallied.get(b.id);
      if (!r || dist(r, rally) > 3) {
        this.c.issue({ type: 'rally', buildingId: b.id, pos: rally });
        this.rallied.set(b.id, rally);
      }
      if (b.queue >= profile.militaryQueue || s.popUsed + keepPop >= s.popCap || b.upgrading || b.id === this.c.upgradeHold) continue;
      let kind: UnitKind | null;
      if (b.kind === 'siegeWorkshop') {
        kind = this.chooseSiege(b, s);
        if (kind && (!canAfford(stock, UNITS[kind].cost, reserve) || s.popUsed + popCost(kind) > s.popCap)) {
          keepPop = popCost(kind);
          for (const [r, n] of Object.entries(UNITS[kind].cost) as [keyof Stockpile, number][]) reserve[r] = (reserve[r] ?? 0) + n;
          continue;
        }
      } else kind = b.kind === 'fortress' ? this.chooseFortress(s, stock, reserve) : this.chooseUnit(b.kind, s, stock, reserve);
      if (!kind || s.popUsed + keepPop + popCost(kind) > s.popCap) continue;
      const before = b.queue;
      this.c.issue({ type: 'train', buildingId: b.id, unit: kind });
      if (b.queue > before) s.popUsed += popCost(kind);
    }
  }

  /** A known enemy wall, tower or fortress: attacks bring siege (M16-8). */
  defended(): boolean {
    for (const b of this.c.intel.buildings.values()) if (DEFENCES.has(b.kind)) return true;
    return false;
  }

  /**
   * The siege engine wanted for a defended base, up to the profile's count, one in training at a
   * time (the caller checks cost and pop): rams for walls, towers and the Town Center; a
   * catapult once there are rams and the enemy fields an army worth splashing.
   */
  private chooseSiege(b: Building, s: Snapshot): UnitKind | null {
    const want = this.c.profile.late.siege;
    if (want <= 0 || b.queue > 0 || !this.defended()) return null;
    const rams = s.army.filter((u) => u.kind === 'ram').length;
    const engines = s.army.filter((u) => isSiege(u.kind)).length;
    if (engines >= want) return null;
    const kind: UnitKind = rams >= Math.ceil(want / 2) && this.c.intel.enemyArmy() >= 8 ? 'catapult' : 'ram';
    const civ = this.c.world.players.get(this.c.player)?.player.civ;
    if (!trainable('siegeWorkshop', civ).includes(kind) || (UNITS[kind].age ?? 0) > ageOf(this.c.world, this.c.player)) return null;
    return kind;
  }

  /**
   * The fortress trains its hero (Empire Age, one alive, after the sim's cooldown), and
   * champions late: in the Empire Age, or in the City Age once gold piles up.
   */
  private chooseFortress(s: Snapshot, stock: Stockpile, reserve: Partial<Stockpile>): UnitKind | null {
    const { world, player, profile } = this.c;
    const late = profile.late;
    const age = ageOf(world, player);
    const civ = world.players.get(player)?.player.civ;
    if (late.hero && age >= 3 && heroBlock(world, player) === null) {
      const hero = trainable('fortress', civ).find((k) => isHero(k));
      if (hero && canAfford(stock, UNITS[hero].cost, reserve)) return hero;
    }
    if (!late.champions || (age < 3 && stock.gold - (reserve.gold ?? 0) < CHAMPION_GOLD)) return null;
    return this.chooseUnit('fortress', s, stock, reserve);
  }

  /** The unit to train at `building`: best counter to the enemy's seen mix, kept varied. */
  chooseUnit(building: BuildingKind, s: Snapshot, stock: Stockpile, reserve: Partial<Stockpile>): UnitKind | null {
    const age = ageOf(this.c.world, this.c.player);
    const opts = trainable(building, this.c.world.players.get(this.c.player)?.player.civ).filter(
      (k) => k !== 'villager' && !isHero(k) && (UNITS[k].age ?? 0) <= age && canAfford(stock, UNITS[k].cost, reserve)
    );
    if (!opts.length) return null;
    if (!this.c.profile.counters) return opts[Math.floor(this.c.rng() * opts.length)];
    const seen = this.c.intel.enemyMix();
    // Prior until we've seen something: mostly infantry.
    const mix: Record<UnitClass, number> = { villager: 0, infantry: seen.infantry + 2, archer: seen.archer + 1, cavalry: seen.cavalry + 1, wildlife: 0, ship: 0, siege: 0 };
    const total = mix.infantry + mix.archer + mix.cavalry;
    const mine: Record<UnitClass, number> = { villager: 0, infantry: 0, archer: 0, cavalry: 0, wildlife: 0, ship: 0, siege: 0 };
    for (const u of s.army) mine[UNITS[u.kind].unitClass]++;
    const army = Math.max(1, s.army.length);
    let best: UnitKind | null = null;
    let bestScore = -Infinity;
    for (const k of opts) {
      let score = 0;
      for (const c of CLASSES) score += (mix[c] / total) * MATCHUP.get(`${k}/${c}`)!;
      // Spend what piles up: a unit paid in a glut resource is cheaper than its list price.
      score *= unitCost(k) / unitCost(k, stock);
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
      if (u.kind === 'villager' || isAnimal(u.kind) || !world.areEnemies(player, u.owner) || !intel.sees(u.pos.x, u.pos.z)) continue;
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
    if ((this.c.sheltered.size || this.shelters.size) && (this.calm >= 2 || world.time > this.shelterUntil)) this.release();
    if (!threats.length) {
      this.threatSince = null;
      this.c.defenceHold = 0;
      return false;
    }
    this.threatSince ??= world.time;
    if (world.time - this.threatSince < profile.reaction) return false;

    // Scouts are soldiers when there's more than one (a lone scout is just looking).
    const scouts = threats.filter((t) => t.kind === 'scout').length;
    const raider = (t: Unit) => t.kind !== 'scout' || scouts > 1;
    const soldiers = threats.filter(raider).length;
    const raiders = threats.filter(raider);
    const c = centroid(threats);
    // When attacks leave the home force without a soldier, let production buy the
    // first reinforcement before the Town Center spends another 50 food.
    const homeUnderFire = this.lastHit !== null && world.time - this.lastHit.at < 12;
    const needsReinforcement = homeUnderFire && soldiers >= 2 && home.every((u) => u.kind === 'scout');
    const canTrain = s.popUsed < s.popCap && profile.militaryQueue > 0
      && s.buildings.some((b) => b.complete && b.queue === 0 && !b.upgrading
        && b.id !== this.c.upgradeHold && PRODUCTION.includes(b.kind));
    this.c.defenceHold = needsReinforcement && canTrain ? DEFENCE_HOLD : 0;
    let defenders = home;
    // Outnumbered at home by a real force: call the attack back, while it is still nearer home
    // than its target. Not for a couple of raiders, nor once it is past halfway (M16-10): with
    // the army out, home is nearly empty, so any soldier near the base used to recall every wave
    // within seconds of leaving, and two waves that crossed both turned back.
    const away = [...this.attackers].map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
    const out = away.length ? centroid(away) : null;
    const nearHome = !!out && (!this.target || dist(out, this.c.home) < dist(out, this.target.pos));
    if (this.mode === 'attack' && nearHome && soldiers > home.length && soldiers >= Math.max(RECALL_MIN, this.attackers.size * 0.5)) {
      defenders = [...home, ...away];
      this.attackers.clear();
      this.escorts.clear();
      this.mode = 'gather';
    }
    // The centre of a split raid can be out of sight of both groups. If defenders
    // arrive there and stop, give them a target they can pursue on subsequent passes.
    const stalled = raiders.length < 2 ? [] : defenders.filter((u) => u.state === 'idle'
      && dist(u.pos, c) <= 4 && raiders.every((t) => dist(u.pos, t.pos) > UNITS[u.kind].sight))
      .slice(0, ORDERS_PER_PASS);
    if (stalled.length) {
      const target = raiders.reduce((nearest, t) => dist(t.pos, c) < dist(nearest.pos, c) ? t : nearest);
      this.c.issue({ type: 'attack', unitIds: stalled.map((u) => u.id), targetId: target.id });
    }
    const idle = defenders.filter((u) => u.state !== 'attacking' && dist(u.pos, c) > 4)
      .slice(0, ORDERS_PER_PASS - stalled.length);
    if (idle.length) this.c.issue({ type: 'attackMove', unitIds: idle.map((u) => u.id), target: c });

    // Villagers near raiding soldiers garrison in the nearest Town Center or tower with room
    // (which then shoots back), else run to the Town Center.
    if (profile.shelter && soldiers > 0) {
      const run = s.villagers.filter((v) => !this.c.sheltered.has(v.id) && v.state !== 'garrisoned' && threats.some((t) => raider(t) && dist(t.pos, v.pos) < 12));
      if (run.length && world.time > this.shelterUntil + 15) {
        this.shelterUntil = world.time + 20;
        this.shelter(s, run);
      }
    }
    this.holdCaptures(s, home, raiders);
    return true;
  }

  /** Garrison `units` in the nearest own shelters with room; villagers left over run to the Town Center. */
  private shelter(s: Snapshot, units: Unit[], only?: Building): Unit[] {
    const { world } = this.c;
    const room = new Map<Building, number>();
    for (const b of only ? [only] : s.buildings) {
      if (!b.complete || tooDamaged(b)) continue;
      const free = garrisonCap(world, b.owner, b.kind, b.tier) - (b.occupants?.length ?? 0);
      if (free > 0) room.set(b, free);
    }
    const into = new Map<Building, Unit[]>();
    const left: Unit[] = [];
    for (const u of units) {
      let best: Building | null = null;
      for (const [b, n] of room) if (n > 0 && dist(b.pos, u.pos) < SHELTER_REACH && (!best || dist(b.pos, u.pos) < dist(best.pos, u.pos))) best = b;
      if (!best) {
        left.push(u);
        continue;
      }
      room.set(best, room.get(best)! - 1);
      into.set(best, [...(into.get(best) ?? []), u]);
    }
    const sent: Unit[] = [];
    for (const [b, us] of into) {
      this.c.issue({ type: 'garrison', unitIds: us.map((u) => u.id), buildingId: b.id });
      if (this.c.lastReject) continue;
      this.shelters.add(b.id);
      sent.push(...us);
    }
    for (const u of sent) if (u.kind === 'villager') this.c.sheltered.add(u.id);
    const runners = left.filter((u) => u.kind === 'villager');
    if (!only && runners.length && s.tc) {
      for (const v of runners) this.c.sheltered.add(v.id);
      this.c.issue({ type: 'move', unitIds: runners.map((v) => v.id), target: s.tc.pos });
    }
    return sent;
  }

  /**
   * Own buildings losing capture points to enemy soldiers next to them: nearby villagers go
   * inside (each occupant wins points back), and soldiers too when the enemy outnumbers the
   * army at home (they can't win the fight outside).
   */
  private holdCaptures(s: Snapshot, home: Unit[], raiders: Unit[]): void {
    const { world } = this.c;
    for (const b of s.buildings) {
      if (!b.complete || !b.capture || (b.capture[b.owner] ?? 0) >= maxCapturePoints(b.kind) * 0.95) continue;
      const capturers = raiders.filter((t) => dist(t.pos, b.pos) < b.radius + 6).length;
      if (!capturers) continue;
      // Keep whoever is inside there while the capture goes on.
      this.shelterUntil = Math.max(this.shelterUntil, world.time + 20);
      if (garrisonCap(world, b.owner, b.kind, b.tier) <= (b.occupants?.length ?? 0)) continue;
      const nearest = (us: Unit[]) =>
        us.filter((u) => u.state !== 'garrisoned' && u.state !== 'toShelter' && dist(u.pos, b.pos) < SHELTER_REACH).sort((x, y) => dist(x.pos, b.pos) - dist(y.pos, b.pos));
      const helpers = capturers > home.length ? [...nearest(home), ...nearest(s.villagers)] : nearest(s.villagers);
      if (helpers.length) this.shelter(s, helpers, b);
    }
  }

  /** Things are calm: everyone we put inside comes out, and runners go back to work. */
  private release(): void {
    const { world, player } = this.c;
    for (const id of this.shelters) {
      const b = world.buildings.get(id);
      if (b && b.owner === player && b.occupants?.length) this.c.issue({ type: 'ungarrison', buildingId: id });
    }
    this.shelters.clear();
    const ids = [...this.c.sheltered].filter((id) => {
      const u = world.units.get(id);
      return u && u.state !== 'garrisoned';
    });
    this.c.sheltered.clear();
    if (ids.length) this.c.issue({ type: 'stop', unitIds: ids });
  }

  // ---- Attack waves ----

  private muster(s: Snapshot, home: Unit[], rally: Vec2): void {
    const { world, profile, intel } = this.c;
    // Big enough for this wave, and (unless maxed out on population) bigger than the army we've seen.
    const maxed = s.popUsed >= Math.min(s.popCap, 200) - 3;
    const enough = home.length >= this.waveSize() && (maxed || !profile.counters || home.length >= intel.enemyArmy() * 1.25);
    let ready = enough && !this.c.aging && !this.ownWonder() && world.time >= profile.firstAttack && world.time - this.lastWave >= profile.waveGap;
    // Against walls or towers, a ready wave waits a while for siege that is on its way (M16-8).
    if (ready && !home.some((u) => isSiege(u.kind)) && this.siegeComing(s)) {
      this.siegeWait ??= world.time;
      if (world.time - this.siegeWait < SIEGE_WAIT) ready = false;
    }
    if (ready) {
      this.siegeWait = null;
      const from = centroid(home);
      this.target = intel.nearestBuilding(from);
      this.mode = 'attack';
      this.wave++;
      this.lastWave = world.time;
      for (const u of home) this.attackers.add(u.id);
      this.startHp = home.reduce((n, u) => n + u.hp, 0);
      this.committed = home.length;
      this.advance(home, true);
      this.escort(home);
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
        this.escorts.clear();
        this.mode = 'gather';
        this.lastWave = world.time;
        return;
      }
    }
    // A spent attack is over (M16-10): before, fresh troops trickled into it four at a time for
    // the rest of the game, each group dying at the enemy's gates, and the enemy, never calm at
    // home, never mustered a wave of its own. Survivors come home and the next, bigger wave
    // musters.
    if (group.length < this.committed * SPENT) {
      this.c.issue({ type: 'move', unitIds: group.map((u) => u.id), target: rally });
      this.attackers.clear();
      this.escorts.clear();
      this.mode = 'gather';
      this.lastWave = world.time;
      return;
    }
    if (!this.target || !intel.buildings.has(this.target.id)) this.target = intel.nearestBuilding(at);
    this.watchCapture(group);
    this.fightFirst(group, at);
    // Fresh troops at the rally point join the push in groups, while it still holds REINFORCE of
    // what it committed; a failing attack is not fed.
    const fresh = home.filter((u) => u.state === 'idle' && dist(u.pos, rally) < 14);
    // A siege engine joins at once (with whoever waits beside it as escort).
    if ((fresh.length >= 4 || fresh.some((u) => isSiege(u.kind))) && group.length >= this.committed * REINFORCE) {
      for (const u of fresh) this.attackers.add(u.id);
      this.committed += fresh.length;
      this.startHp += fresh.reduce((n, u) => n + u.hp, 0);
      this.advance(fresh, true);
    }
    this.advance(group, false);
    this.escort(group);
  }

  /**
   * No enemy building known: hunt (M16-10). Conquest needs every last unit dead, and a lone
   * scout or a few villagers hiding in a corner used to keep a beaten AI alive to the cap while
   * the whole army stood at its old Town Center. Squads of HUNT_SQUAD each make for the nearest
   * spot where an enemy was last seen, else unexplored ground, else ground out of sight, a
   * different one per squad; a squad that arrives (goes idle) picks the next.
   */
  private hunt(movers: Unit[]): void {
    const { world, player, intel } = this.c;
    const vis = world.visibilityOf(player);
    const region = world.nav.regionAt(movers[0].pos);
    const spots: Vec2[] = intel.sightings().filter((p) => world.nav.regionOfCell(p) === region);
    if (!spots.length) {
      for (let z = HUNT_STEP / 2; z < world.hf.depth; z += HUNT_STEP) {
        for (let x = HUNT_STEP / 2; x < world.hf.width; x += HUNT_STEP) {
          const p = { x, z };
          if (!vis.isVisible(x, z) && world.hf.isWalkable(x, z) && world.nav.regionOfCell(p) === region) spots.push(p);
        }
      }
      const unexplored = spots.filter((p) => !vis.isExplored(p.x, p.z));
      if (unexplored.length) spots.splice(0, spots.length, ...unexplored);
    }
    if (!spots.length) return;
    const taken: Vec2[] = [];
    for (let i = 0; i < movers.length; i += HUNT_SQUAD) {
      const squad = movers.slice(i, i + HUNT_SQUAD);
      const at = centroid(squad);
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (const p of spots) {
        const d = dist(p, at);
        if (d < bestD && !taken.some((q) => dist(q, p) < HUNT_STEP * 1.5)) [best, bestD] = [p, d];
      }
      best ??= spots[(i / HUNT_SQUAD) % spots.length];
      taken.push(best);
      this.c.issue({ type: 'attackMove', unitIds: squad.map((u) => u.id), target: world.nav.nearestFree(best) ?? best });
    }
  }

  /**
   * Defenders before buildings (M16-10). A soldier razing or capturing a building never turns on
   * the soldiers hitting it, so a wave used to stand at a house while the defence cut it down and
   * equal AIs wore each other out at the gates. Soldiers on a building with an enemy soldier in
   * sight within FIGHT_RANGE attack-move onto the nearest one instead (attack-move picks units
   * before buildings). Siege and escorts keep their orders.
   */
  private fightFirst(group: Unit[], at: Vec2): void {
    const { world, player, intel } = this.c;
    const foes: Unit[] = [];
    for (const u of world.units.values()) {
      if (u.kind === 'villager' || isAnimal(u.kind) || u.state === 'garrisoned' || !world.areEnemies(player, u.owner)) continue;
      if (dist(u.pos, at) < FIGHT_SCAN && intel.sees(u.pos.x, u.pos.z)) foes.push(u);
    }
    if (!foes.length) return;
    const orders = new Map<Unit, Unit[]>();
    for (const u of group) {
      if (isSiege(u.kind) || this.escorts.has(u.id) || u.target === null || !world.buildings.has(u.target)) continue;
      let near: Unit | null = null;
      let best = FIGHT_RANGE;
      for (const f of foes) {
        const d = dist(f.pos, u.pos);
        if (d < best) [near, best] = [f, d];
      }
      if (near) orders.set(near, [...(orders.get(near) ?? []), u]);
    }
    let left = ORDERS_PER_PASS;
    for (const [foe, units] of orders) {
      if (left <= 0) break;
      const ids = units.slice(0, left).map((u) => u.id);
      left -= ids.length;
      this.c.issue({ type: 'attackMove', unitIds: ids, target: { ...foe.pos } });
    }
  }

  /** Siege is coming for a defended base: a workshop stands (or engines are queued) and the profile wants siege. */
  private siegeComing(s: Snapshot): boolean {
    if (this.c.profile.late.siege <= 0 || !this.defended()) return false;
    return s.buildings.some((b) => b.kind === 'siegeWorkshop' && b.complete && !b.upgrading);
  }

  /** Bring the attack home (holding a wonder). */
  private recall(rally: Vec2): void {
    const group = [...this.attackers].map((id) => this.c.world.units.get(id)).filter((u): u is Unit => !!u);
    if (group.length) this.c.issue({ type: 'move', unitIds: group.slice(0, 2 * ORDERS_PER_PASS).map((u) => u.id), target: rally });
    this.attackers.clear();
    this.escorts.clear();
    this.mode = 'gather';
  }

  /**
   * Each siege engine in `group` keeps ESCORTS soldiers guarding it (M17-3 guard): they walk
   * with it and fight whoever attacks it. Escorts are left out of the wave's other orders.
   */
  private escort(group: Unit[]): void {
    const engines = group.filter((u) => isSiege(u.kind));
    if (!engines.length) return;
    const guards = new Map<EntityId, number>();
    for (const e of this.escorts.values()) guards.set(e, (guards.get(e) ?? 0) + 1);
    const free = group.filter((u) => !isSiege(u.kind) && !isHero(u.kind) && !this.escorts.has(u.id) && u.state !== 'attacking');
    for (const e of engines) {
      const need = ESCORTS - (guards.get(e.id) ?? 0);
      if (need <= 0 || !free.length) continue;
      free.sort((a, b) => dist(a.pos, e.pos) - dist(b.pos, e.pos));
      const picked = free.splice(0, need).filter((u) => dist(u.pos, e.pos) < 25);
      if (!picked.length) continue;
      this.c.issue({ type: 'guard', unitIds: picked.map((u) => u.id), targetId: e.id });
      if (this.c.lastReject) continue;
      for (const u of picked) this.escorts.set(u.id, e.id);
    }
  }

  /** Our completed wonder, if any. */
  private ownWonder(): Building | null {
    const w = this.c.world.wonder;
    if (w && w.owner === this.c.player) return this.c.world.buildings.get(w.building) ?? null;
    for (const b of this.c.world.buildings.values()) if (b.kind === 'wonder' && b.owner === this.c.player && b.complete) return b;
    return null;
  }

  /**
   * An enemy wonder's countdown is running (public knowledge: everyone sees the timer and the
   * ping): every soldier goes for it, siege included, and nothing else matters until it falls,
   * changes hands or the game ends. True while rushing.
   */
  private answerWonder(s: Snapshot): boolean {
    const { world, player } = this.c;
    const w = world.wonder;
    const b = w && world.areEnemies(player, w.owner) ? world.buildings.get(w.building) : undefined;
    if (!b) {
      if (this.wonderRush) {
        this.wonderRush = false;
        this.diverted.clear();
        this.target = null;
      }
      return false;
    }
    if (!this.wonderRush) {
      this.wonderRush = true;
      this.diverted.clear();
      this.escorts.clear();
    }
    this.mode = 'attack';
    this.target = { id: b.id, kind: b.kind, owner: b.owner, pos: { ...b.pos }, radius: b.radius };
    for (const u of s.army) if (u.state !== 'garrisoned') this.attackers.add(u.id);
    const group = [...this.attackers].map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
    if (!group.length) return true;
    for (const id of this.diverted) if (!this.attackers.has(id)) this.diverted.delete(id);
    this.watchCapture(group);
    // Not yet sent (or gone idle since): send them now, a batch per pass.
    const send = group.filter((u) => !this.diverted.has(u.id) || u.state === 'idle');
    for (const u of this.advance(send, true)) this.diverted.add(u.id);
    this.advance(group.filter((u) => !send.includes(u)), false);
    return true;
  }

  /** A visible enemy soldier stands within FIGHT_RANGE of the target building. */
  private contested(t: { pos: Vec2; radius: number }): boolean {
    const { world, player, intel } = this.c;
    for (const u of world.units.values()) {
      if (u.kind === 'villager' || isAnimal(u.kind) || u.state === 'garrisoned' || !world.areEnemies(player, u.owner)) continue;
      if (dist(u.pos, t.pos) < t.radius + FIGHT_RANGE && intel.sees(u.pos.x, u.pos.z)) return true;
    }
    return false;
  }

  /**
   * Capture rather than raze (M18-5): military and economic buildings, while no enemy soldier
   * stands guard and the capture hasn't stalled. Houses and walls are razed.
   */
  private captures(id: EntityId): boolean {
    const { world, player, intel, profile } = this.c;
    const b = world.buildings.get(id);
    if (!profile.capture || !b || RAZE.has(b.kind) || this.raze.has(id) || maxCapturePoints(b.kind) <= 0) return false;
    for (const u of world.units.values()) {
      if (u.kind === 'villager' || isAnimal(u.kind) || !world.areEnemies(player, u.owner) || u.state === 'garrisoned') continue;
      if (dist(u.pos, b.pos) < b.radius + 10 && intel.sees(u.pos.x, u.pos.z)) return false;
    }
    return true;
  }

  /**
   * A capture whose points stopped growing for CAPTURE_STALL seconds (a garrison wins them back
   * as fast) turns into razing.
   */
  private watchCapture(group: Unit[]): void {
    const { world, player } = this.c;
    const t = this.target;
    const b = t && world.buildings.get(t.id);
    if (!t || !b || this.raze.has(t.id)) return;
    const capturing = group.filter((u) => u.target === t.id && world.combatState.get(u.id)?.capture);
    if (!capturing.length) {
      this.captureWatch = null;
      return;
    }
    const cp = b.capture?.[player] ?? 0;
    const w = this.captureWatch;
    if (!w || w.id !== t.id || cp > w.cp + 1) this.captureWatch = { id: t.id, cp: Math.max(cp, w?.id === t.id ? w.cp : 0), at: world.time };
    else if (world.time - w.at > CAPTURE_STALL) {
      this.raze.add(t.id);
      this.captureWatch = null;
      this.c.issue({ type: 'attack', unitIds: capturing.slice(0, ORDERS_PER_PASS).map((u) => u.id), targetId: t.id });
    }
  }

  /**
   * Order `units` (all of them, or only idle ones) toward the current target, or to search for
   * one. Siege engines go for walls, towers and the Town Center; escorts keep guarding. Returns
   * the units ordered.
   */
  private advance(units: Unit[], all: boolean): Unit[] {
    const { world } = this.c;
    const t = this.target;
    // Soldiers that walked up and started hitting a building we mean to capture switch to capturing.
    const capture = !!t && this.captures(t.id);
    const redo = (u: Unit) => u.state === 'idle' || (capture && u.target === t!.id && captureRate(u.kind) > 0 && !world.combatState.get(u.id)?.capture);
    const pick = units.filter((u) => !this.escorts.has(u.id) && (all || redo(u)));
    const engines = pick.filter((u) => isSiege(u.kind) && (all || u.state === 'idle'));
    if (t) for (const e of engines.slice(0, 4)) this.siegeOrder(e, t, capture);
    const movers = pick.filter((u) => !isSiege(u.kind) || !t).slice(0, ORDERS_PER_PASS);
    if (!movers.length) return engines;
    if (!t) {
      this.hunt(movers);
      return movers;
    }
    const at = centroid(movers);
    const near = movers.filter((u) => dist(u.pos, t.pos) < t.radius + 9);
    const far = movers.filter((u) => dist(u.pos, t.pos) >= t.radius + 9);
    const live = world.buildings.get(t.id);
    // Just captured (intel catches up on its next scan): nothing to hit there.
    const hostile = !!live && world.areEnemies(this.c.player, live.owner);
    // While defenders stand by the target, close in fighting (see fightFirst).
    if (near.length && hostile && this.contested(t)) this.c.issue({ type: 'attackMove', unitIds: near.map((u) => u.id), target: { ...t.pos } });
    else if (near.length && hostile) this.c.issue({ type: capture ? 'capture' : 'attack', unitIds: near.map((u) => u.id), targetId: t.id });
    if (far.length) {
      const d = norm({ x: at.x - t.pos.x, z: at.z - t.pos.z });
      const p = { x: t.pos.x + d.x * (t.radius + 2.5), z: t.pos.z + d.z * (t.radius + 2.5) };
      this.c.issue({ type: 'attackMove', unitIds: far.map((u) => u.id), target: world.nav.nearestFree(p) ?? p });
    }
    return [...movers, ...engines];
  }

  /**
   * A siege engine's target: the wave's target, unless the army is capturing it (an engine would
   * raze it) or it isn't a wall, tower or Town Center while one stands near it; then the nearest
   * such building to the engine within 30 of the wave's target.
   */
  private siegeOrder(e: Unit, t: SeenBuilding, capture: boolean): void {
    const { world, intel, player } = this.c;
    let best: SeenBuilding | null = this.wonderRush || (!capture && SIEGE_TARGETS.has(t.kind)) ? t : null;
    if (!best) {
      let bestD = Infinity;
      for (const b of intel.buildings.values()) {
        if (b.id === t.id || !SIEGE_TARGETS.has(b.kind) || dist(b.pos, t.pos) > 30) continue;
        const d = dist(b.pos, e.pos);
        if (d < bestD) [best, bestD] = [b, d];
      }
      if (!best && !capture) best = t;
    }
    const live = best && world.buildings.get(best.id);
    if (live && world.areEnemies(player, live.owner)) this.c.issue({ type: 'attack', unitIds: [e.id], targetId: live.id });
    else this.c.issue({ type: 'attackMove', unitIds: [e.id], target: t.pos });
  }
}

/** Mean position of `units` (non-empty). */
function centroid(units: Unit[]): Vec2 {
  const c = { x: 0, z: 0 };
  for (const u of units) {
    c.x += u.pos.x / units.length;
    c.z += u.pos.z / units.length;
  }
  return c;
}
