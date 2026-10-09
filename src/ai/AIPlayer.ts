import type { Command, EntityId, PlayerId, ResourceType, Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { rngFrom, snapshot, type Ctx } from './context';
import { Economy } from './economy';
import { Intel } from './intel';
import { Military } from './military';
import { makeProfile, type AIOptions, type Profile } from './profile';

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
 * economy, construction, scouting, military), each on its own staggered schedule in sim time,
 * so per-call cost stays tiny.
 */
export class AIPlayer {
  readonly profile: Profile;
  readonly intel: Intel;
  readonly economy: Economy;
  readonly military: Military;
  /** Counters for tests and debugging. */
  readonly stats = { commands: 0, rejected: 0, tasks: 0 };
  private readonly ctx: Ctx;
  private readonly tasks: Task[];
  private readonly offs: (() => void)[] = [];
  private lastTime: number;
  private defeated = false;
  private issuing = false;

  constructor(
    readonly world: World,
    readonly player: PlayerId,
    readonly opts: AIOptions
  ) {
    if (!world.players.has(player)) throw new Error(`no player ${player}`);
    this.profile = makeProfile(opts.difficulty, opts.personality);
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
      sheltered: new Set<EntityId>(),
      home,
      region: world.nav.regionAt(tc ? { x: tc.pos.x, z: tc.pos.z + tc.radius + 1 } : home),
    };
    this.economy = new Economy(this.ctx);
    this.military = new Military(this.ctx, this.economy);
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

    this.offs.push(
      world.events.on('attacked', (e) => {
        if (e.owner === player) this.military.onAttacked(e.pos);
      }),
      world.events.on('defeated', (e) => {
        if (e.player === player) this.defeated = true;
      }),
      world.events.on('rejected', () => {
        if (this.issuing) this.stats.rejected++;
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

  /** Stop listening to world events. */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private snap() {
    return snapshot(this.world, this.player);
  }

  private issue(cmd: Command): void {
    this.stats.commands++;
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
