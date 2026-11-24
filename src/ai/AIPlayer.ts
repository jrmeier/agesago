import type { Command, EntityId, PlayerId, ResourceType, Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { rngFrom, snapshot, type Ctx } from './context';
import { Economy } from './economy';
import { Intel } from './intel';
import { Military } from './military';
import { Research } from './research';
import { Upkeep } from './upkeep';
import { makeProfile, type AIOptions, type Profile } from './profile';
import { isAnimal } from '../core/units';

/** A beaten AI (no Town Center, no villager) with fewer soldiers than this resigns (M16-10). */
const RESIGN_ARMY = 5;

export type { AIOptions, Difficulty, Personality } from './profile';

interface Task {
  name: string;
  every: number;
  next: number;
  run: () => void;
}

/**
 * A computer opponent. It plays only through world.dispatch(cmd, player) — the same commands a
 * human issues — and reads only what its player may know: its own units, buildings and stock,
 * enemy units it can currently see, enemy buildings it has seen, and resources on its explored
 * ground. The 'hardest' difficulty cheats lightly: a resource trickle into its own stock and full
 * map knowledge (no fog for intel or resource finding).
 *
 * Call update() every frame or every sim tick: each call runs at most one planning task (intel,
 * economy, construction, scouting, military, research, upkeep), each on its own staggered schedule in sim time,
 * so per-call cost stays tiny.
 */
export class AIPlayer {
  readonly profile: Profile;
  readonly intel: Intel;
  readonly economy: Economy;
  readonly military: Military;
  readonly research: Research;
  readonly upkeep: Upkeep;
  /** Counters for tests and debugging. */
  readonly stats = { commands: 0, rejected: 0, territoryRejected: 0, tasks: 0 };
  private readonly ctx: Ctx;
  private readonly tasks: Task[];
  private readonly offs: (() => void)[] = [];
  private lastTime: number;
  private defeated = false;
  /** It has owned a Town Center (resignIfBeaten). */
  private hadTown = false;
  private issuing = false;

  constructor(
    readonly world: World,
    readonly player: PlayerId,
    readonly opts: AIOptions
  ) {
    const state = world.players.get(player);
    if (!state) throw new Error(`no player ${player}`);
    this.profile = makeProfile(opts.difficulty, opts.personality, opts.tune, state.player.civ);
    this.intel = new Intel(world, player, !!this.profile.cheat?.fullMap);
    const tc = world.townCenterOf(player);
    const home: Vec2 = tc ? { ...tc.pos } : firstOwned(world, player) ?? { x: world.hf.width / 2, z: world.hf.depth / 2 };
    const self = this;
    this.ctx = {
      world,
      player,
      profile: this.profile,
      intel: this.intel,
      rng: rngFrom((opts.seed ?? 1) * 7919 + player),
      issue: (cmd: Command) => self.issue(cmd),
      lastReject: null,
      sheltered: new Set<EntityId>(),
      explorers: new Set([...world.units.values()].filter((u) => u.owner === player && u.kind === 'scout').map((u) => u.id)),
      home,
      turns: Math.round(Math.atan2(world.hf.depth / 2 - home.z, world.hf.width / 2 - home.x) / (Math.PI / 2)) & 3,
      region: world.nav.regionAt(tc ? { x: tc.pos.x, z: tc.pos.z + tc.radius + 1 } : home),
      reserve: {},
      techReserve: {},
      townReserve: {},
      saving: null,
      villagerHold: 0,
      defenceHold: 0,
      openingCivFood: 0,
      outgunned: false,
      armyFirst: false,
      aging: false,
      pauseVillagers: false,
      upgradeHold: null,
    };
    this.economy = new Economy(this.ctx);
    this.military = new Military(this.ctx);
    this.research = new Research(this.ctx, this.economy);
    this.upkeep = new Upkeep(this.ctx);
    this.lastTime = world.time;

    const p = this.profile;
    const t = world.time;
    // Staggered starts so tasks rarely fall due on the same call.
    this.tasks = [
      { name: 'intel', every: Math.min(2, p.militaryInterval), next: t, run: () => this.intel.scan() },
      { name: 'nodes', every: 12, next: t, run: () => this.intel.refreshNodes() },
      { name: 'econ', every: p.econInterval, next: t + 0.05, run: () => this.economy.econPass(this.snap()) },
      { name: 'build', every: p.buildInterval, next: t + 0.3, run: () => this.economy.buildPass(this.snap()) },
      { name: 'scout', every: 3, next: t + 0.15, run: () => this.economy.scoutPass(this.snap()) },
      { name: 'military', every: p.militaryInterval, next: t + 0.45, run: () => this.military.pass(this.snap()) },
    ];
    this.hadTown = [...world.buildings.values()].some((b) => b.owner === player && b.kind === 'townCenter');
    this.tasks.push({ name: 'resign', every: 5, next: t + 0.9, run: () => this.resignIfBeaten() });
    this.tasks.push({ name: 'upkeep', every: p.buildInterval, next: t + 0.75, run: () => this.upkeep.pass(this.snap()) });
    if (p.research) this.tasks.push({ name: 'research', every: p.buildInterval, next: t + 0.6, run: () => this.research.pass(this.snap()) });

    this.offs.push(
      world.events.on('attacked', (e) => {
        if (e.owner === player) {
          this.military.onAttacked(e.pos);
          if (this.research.onAttacked(e.pos)) this.economy.onAttacked();
          this.upkeep.onAttacked();
        }
      }),
      world.events.on('agedUp', (e) => {
        if (e.owner === player) this.research.onAgedUp(e.age);
      }),
      world.events.on('defeated', (e) => {
        if (e.player === player) this.defeated = true;
      }),
      world.events.on('rejected', (e) => {
        if (!this.issuing) return;
        this.stats.rejected++;
        this.ctx.lastReject ??= e.reason;
        if (e.reason === 'territory') this.stats.territoryRejected++;
      })
    );
  }

  /** Advance the AI. `dt` is accepted for symmetry with the game loop; schedules run on sim time. */
  update(dt: number): void {
    void dt;
    if (this.defeated) return;
    const w = this.world;
    const elapsed = w.time - this.lastTime;
    this.lastTime = w.time;
    const cheat = this.profile.cheat;
    if (cheat && elapsed > 0) {
      const stock = w.stockOf(this.player);
      for (const [r, n] of Object.entries(cheat.trickle) as [ResourceType, number][]) stock[r] += n * elapsed;
    }
    // Run the most overdue task, at most one per call.
    let due: Task | null = null;
    for (const task of this.tasks) if (task.next <= w.time && (!due || task.next < due.next)) due = task;
    if (!due) return;
    due.next = w.time + due.every;
    const tc = w.townCenterOf(this.player);
    if (tc) this.ctx.home = { ...tc.pos };
    this.stats.tasks++;
    due.run();
  }

  /**
   * Resign a lost game (M16-10), as 0 A.D.'s and AoE's AIs do: once it has lost every Town Center
   * and every villager and has fewer than RESIGN_ARMY soldiers, it can never rebuild. Conquest
   * needs every last unit dead, and a fast scout running the map kept such games going to the cap.
   * An AI that never had a Town Center (a scenario army) never resigns.
   */
  private resignIfBeaten(): void {
    const w = this.world;
    // Computer players only: never on behalf of a human or remote player, even if an AIPlayer
    // is attached to one (it goes out as a dispatched command, so lockstep peers agree).
    if (w.players.get(this.player)?.player.control !== 'ai') return;
    let towns = 0, villagers = 0, soldiers = 0;
    for (const b of w.buildings.values()) if (b.owner === this.player && b.kind === 'townCenter') towns++;
    if (towns) {
      this.hadTown = true;
      return;
    }
    if (!this.hadTown) return;
    for (const u of w.units.values()) {
      if (u.owner !== this.player || isAnimal(u.kind)) continue;
      if (u.kind === 'villager') villagers++;
      else soldiers++;
    }
    if (villagers === 0 && soldiers < RESIGN_ARMY) this.issue({ type: 'resign' });
  }

  /** Stop listening to world events. */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private snap() {
    return snapshot(this.world, this.player, this.ctx.explorers);
  }

  private issue(cmd: Command): void {
    this.stats.commands++;
    this.ctx.lastReject = null;
    this.issuing = true;
    try {
      this.world.dispatch(cmd, this.player);
    } finally {
      this.issuing = false;
    }
  }
}

function firstOwned(world: World, player: PlayerId): Vec2 | null {
  for (const b of world.buildings.values()) if (b.owner === player) return { ...b.pos };
  for (const u of world.units.values()) if (u.owner === player) return { ...u.pos };
  return null;
}
