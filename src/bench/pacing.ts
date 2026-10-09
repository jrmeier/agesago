import { BUILDINGS } from '../core/buildings';
import { TECHS, type Age, type TechId } from '../core/techs';
import type { Building, BuildingKind, ResourceNode, ResourceType, Stockpile, Unit, Vec2 } from '../core/types';
import { BALANCE } from '../sim/balance';
import { generateMap } from '../sim/mapgen';
import { completeBuilding, farmFood, layFoundation } from '../sim/systems/build';
import { farmFree } from '../sim/systems/gather';
import { completeResearch, researchBlock } from '../sim/systems/research';
import { EXPLORED } from '../sim/visibility';
import { World, defaultPlayers } from '../sim/World';

/**
 * Headless pacing benchmark (M8-17). Plays a scripted, human-style build order for player 1 on
 * a real generated map — no AI — and records when each age arrives and how fast each resource
 * comes in. A second, controlled experiment measures what each economy tech is worth.
 * See docs/BALANCE.md. Run with `npm run bench:pacing`.
 */

const ME = 1;
const DT = 1 / BALANCE.tickRate;
const RESOURCES: ResourceType[] = ['food', 'wood', 'gold', 'stone'];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const total = (c: Partial<Stockpile>) => (c.food ?? 0) + (c.wood ?? 0) + (c.gold ?? 0) + (c.stone ?? 0);

/** Pacing targets, seconds of sim time (ticket M8-17). */
export const AGE_TARGETS: Record<1 | 2 | 3, { target: number; lo: number; hi: number }> = {
  1: { target: 600, lo: 480, hi: 720 },
  2: { target: 1200, lo: 1080, hi: 1320 },
  3: { target: 1950, lo: 1680, hi: 2220 },
};
/** Every economy tech must pay for itself (research time included) within this many seconds. */
export const PAYBACK_LIMIT = 300;

/** A one-player-economy world on generated map `seed` (player 2 exists but idles). */
export function benchWorld(seed: number): World {
  const { hf, layout } = generateMap(seed, 2);
  const players = defaultPlayers(2).map((p) => ({ ...p, control: p.id === ME ? ('human' as const) : ('ai' as const) }));
  const world = new World(hf, layout, players);
  world.seed = seed;
  // The scripted player knows the map: placement never waits on scouting.
  world.visibilityOf(ME).state.fill(EXPLORED);
  return world;
}

// ------------------------------------------------------------------------------------------
// Placement
// ------------------------------------------------------------------------------------------

/**
 * First spot on rings around `anchor` (radius lo..hi) where `kind` fits, keeping `clear` from
 * resource nodes and `gap` from other buildings so the town never walls itself in.
 */
function findSpot(
  world: World, kind: BuildingKind, anchor: Vec2, lo: number, hi: number, clear = 2.5, gap = 1, avoid: Vec2[] = []
): Vec2 | null {
  const near = [...world.nodes.values()].filter((n) => dist(n.pos, anchor) < hi + 6);
  const blds = [...world.buildings.values()];
  const half = Math.hypot(BUILDINGS[kind].size.w, BUILDINGS[kind].size.d) / 2;
  for (let r = lo; r <= hi; r += 1) {
    const steps = Math.max(8, Math.round((Math.PI * 2 * r) / 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = { x: Math.round((anchor.x + Math.cos(a) * r) * 2) / 2, z: Math.round((anchor.z + Math.sin(a) * r) * 2) / 2 };
      if (near.some((n) => dist(n.pos, p) < half + clear) || avoid.some((q) => dist(q, p) < 1)) continue;
      // Farms tile edge to edge (canPlace checks the exact footprints); everything else keeps a gap.
      if (kind !== 'farm' && blds.some((b) => dist(b.pos, p) < b.radius + half + gap)) continue;
      if (world.canPlace(kind, p, 0, ME).ok) return p;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------
// The scripted player
// ------------------------------------------------------------------------------------------

/** Share of gatherers per resource, by the age being worked toward. */
const SPLITS: Record<Age, Record<ResourceType, number>> = {
  0: { food: 0.55, wood: 0.45, gold: 0, stone: 0 },
  1: { food: 0.45, wood: 0.32, gold: 0.18, stone: 0.05 },
  2: { food: 0.4, wood: 0.26, gold: 0.27, stone: 0.07 },
  3: { food: 0.4, wood: 0.26, gold: 0.27, stone: 0.07 },
};
const VILLAGER_CAP = 70;
/**
 * A standing army: from the Town Age the player keeps barracks training hoplites (one per age
 * reached past Village), up to ARMY_CAP soldiers. They stand at home; they're a spending sink
 * like a real player's army, so age-ups compete with it for food and wood.
 */
const ARMY_CAP = 125;

/**
 * Economy techs the build order researches, in priority order, with a "worth it now" test.
 * `first` techs come before the next age-up; the rest wait until the age-up is paid for.
 */
const ECO_ORDER: { tech: TechId; first?: boolean; when: (c: Counts) => boolean }[] = [
  { tech: 'bronzeAxe', first: true, when: (c) => c.wood >= 5 },
  { tech: 'oxPlough', first: true, when: (c) => c.farms >= 3 },
  { tech: 'donkeyPacks', first: true, when: (c) => c.villagers >= 18 },
  { tech: 'bronzePicks', first: true, when: (c) => c.gold >= 3 },
  { tech: 'ironAxe', first: true, when: (c) => c.wood >= 8 },
  { tech: 'ironPloughshare', first: true, when: (c) => c.farms >= 6 },
  { tech: 'deepShafts', when: (c) => c.gold >= 5 },
  { tech: 'census', when: (c) => c.villagers < VILLAGER_CAP - 15 },
  { tech: 'stoneChisels', when: (c) => c.stone >= 3 },
  { tech: 'threshingFloor', when: (c) => c.berries >= 6 },
  { tech: 'twoManSaw', when: (c) => c.wood >= 10 },
  { tech: 'cropRotation', when: (c) => c.farms >= 10 },
  { tech: 'oreSledges', when: (c) => c.gold >= 8 },
  { tech: 'oxCarts', when: (c) => c.villagers >= 40 },
];
/** Buildings that unlock the next age, by current age. */
const AGE_BUILDINGS: Record<Age, BuildingKind[]> = { 0: ['storehouse', 'granary'], 1: ['forge', 'market'], 2: ['academy'], 3: [] };
const AGE_UP: Record<Age, TechId | null> = { 0: 'townAge', 1: 'cityAge', 2: 'empireAge', 3: null };

interface Counts {
  villagers: number;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  berries: number;
  farms: number;
  idle: number;
  building: number;
}

export interface PacingSample {
  /** Sim minute this sample closes. */
  minute: number;
  villagers: number;
  age: Age;
  /** Villagers on each resource at the sample. */
  workers: Record<ResourceType, number>;
  /** Resources deposited during that minute. */
  gathered: Record<ResourceType, number>;
  /** Stockpile, housing and idle / building villagers at the sample (diagnostics). */
  stock: Stockpile;
  popCap: number;
  idle: number;
  building: number;
  soldiers: number;
}

export interface PacingResult {
  seed: number;
  /** Sim seconds each age arrived (index 1–3), null if it never did. */
  ages: (number | null)[];
  /** Sim seconds each tech finished. */
  techs: Partial<Record<TechId, number>>;
  samples: PacingSample[];
  /** Total gathered over the run. */
  gathered: Record<ResourceType, number>;
  seconds: number;
}

export interface PacingOptions {
  /** Stop after this many sim seconds (default 40 minutes). */
  maxSeconds?: number;
  /** Stop once this age arrives. */
  stopAtAge?: Age;
  /** Techs the build order skips (for counterfactual runs). */
  skip?: TechId[];
}

class BuildOrder {
  private readonly tc: Building;
  constructor(private readonly world: World, private readonly skip: ReadonlySet<TechId>) {
    this.tc = world.townCenterOf(ME)!;
  }

  private get me() {
    return this.world.players.get(ME)!;
  }
  private get stock() {
    return this.world.stockOf(ME);
  }

  private villagers(): Unit[] {
    return [...this.world.units.values()].filter((u) => u.owner === ME && u.kind === 'villager');
  }

  private mine(kind?: BuildingKind, complete?: boolean): Building[] {
    return [...this.world.buildings.values()].filter(
      (b) => b.owner === ME && (!kind || b.kind === kind) && (complete === undefined || b.complete === complete)
    );
  }

  /** What `u` is doing for the economy: a resource, 'build', or null (idle). */
  private role(u: Unit): ResourceType | 'build' | null {
    if (u.state === 'toBuild' || u.state === 'building') return 'build';
    if ((u.state === 'toNode' || u.state === 'gathering' || u.state === 'toDrop') && u.gatherType) return u.gatherType;
    if (u.state === 'moving' && u.gatherType) return u.gatherType;
    return null;
  }

  /** The age the economy is preparing for (an age-up in progress counts as reached). */
  private planAge(): Age {
    const busy = this.tc.research?.some((t) => TECHS[t].ageUp !== undefined);
    return Math.min(3, this.me.age + (busy ? 1 : 0)) as Age;
  }

  counts(): Counts {
    const c: Counts = { villagers: 0, food: 0, wood: 0, gold: 0, stone: 0, berries: 0, farms: 0, idle: 0, building: 0 };
    for (const u of this.villagers()) {
      c.villagers++;
      const r = this.role(u);
      if (r && r !== 'build') c[r]++;
      else if (r === 'build') c.building++;
      else c.idle++;
      if (r === 'food' && u.gatherNode !== null && this.world.nodes.get(u.gatherNode)?.kind === 'berry') c.berries++;
    }
    c.farms = this.mine('farm', true).length;
    return c;
  }

  step(): void {
    this.train();
    this.house();
    this.research();
    this.army();
    this.ageBuildings();
    this.dropSites();
    this.unstick();
    this.assign();
  }

  // ---- villagers & houses ----
  private train(): void {
    if (this.tc.research?.length || this.tc.queue >= 2) return;
    const n = this.villagers().length + this.tc.queue;
    if (n >= VILLAGER_CAP || this.stock.food < 50) return;
    if (this.world.popOf(ME) + this.queued() >= this.world.popCapOf(ME)) return;
    this.world.dispatch({ type: 'train', buildingId: this.tc.id, unit: 'villager' }, ME);
  }

  private house(): void {
    const cap = this.world.popCapOf(ME);
    if (cap >= Math.min(200, VILLAGER_CAP + ARMY_CAP + 5)) return;
    const pending = this.mine('house', false).length;
    const room = cap + pending * 5 - this.world.popOf(ME) - this.queued();
    if (room > 3 || pending >= 2 || this.stock.wood < BUILDINGS.house.cost.wood!) return;
    // Ring the Town Center, then spill out around the other buildings.
    if (this.build('house', this.tc.pos, 7, 34, 1)) return;
    for (const b of this.mine(undefined, true)) if (b.kind !== 'farm' && b.kind !== 'house' && this.build('house', b.pos, 4, 12, 1)) return;
  }

  /** One barracks per age past Village, each training hoplites while the army is under its cap. */
  private army(): void {
    const age = this.me.age;
    if (age === 0) return;
    const barracks = this.mine('barracks');
    if (barracks.length < age && !barracks.some((b) => !b.complete)) {
      if (this.affords(BUILDINGS.barracks.cost)) this.build('barracks', this.tc.pos, 12, 30, 3);
      return;
    }
    let soldiers = 0;
    for (const u of this.world.units.values()) if (u.owner === ME && u.kind !== 'villager' && u.kind !== 'scout') soldiers++;
    for (const b of barracks) {
      soldiers += b.queue;
      if (!b.complete || b.queue >= 1 || soldiers >= ARMY_CAP) continue;
      if (this.world.popOf(ME) + this.queued() >= this.world.popCapOf(ME)) return;
      if (!this.affords({ food: 50, wood: 30 })) return;
      this.world.dispatch({ type: 'train', buildingId: b.id, unit: 'hoplite' }, ME);
      soldiers++;
    }
  }

  private queued(): number {
    return this.mine(undefined, true).reduce((n, b) => n + b.queue, 0);
  }

  /** Lay a `kind` foundation near `anchor` and send `builders` villagers (taken from wood first). */
  private build(kind: BuildingKind, anchor: Vec2, lo: number, hi: number, builders: number, clear = 2.5): Building | null {
    const pos = findSpot(this.world, kind, anchor, lo, hi, clear, 1, this.bad);
    if (!pos) return null;
    const pool = this.villagers()
      .filter((u) => this.role(u) !== 'build')
      .sort((a, b) => this.donorRank(a) - this.donorRank(b) || dist(a.pos, pos) - dist(b.pos, pos));
    const ids = pool.slice(0, builders).map((u) => u.id);
    if (!ids.length) return null;
    const before = new Set(this.world.buildings.keys());
    this.world.dispatch({ type: 'build', unitIds: ids, kind, pos, rot: 0 }, ME);
    return [...this.world.buildings.values()].find((b) => !before.has(b.id)) ?? null;
  }

  /** Lower = taken first as a builder: idle, then wood, food, stone, gold. */
  private donorRank(u: Unit): number {
    const r = this.role(u);
    return r === null ? 0 : r === 'wood' ? 1 : r === 'food' ? 2 : r === 'stone' ? 3 : 4;
  }

  // ---- research ----
  private research(): void {
    const ageUp = AGE_UP[this.me.age];
    const saving = ageUp !== null && !this.isQueued(ageUp);
    let waiting = false;
    for (const { tech, first, when } of ECO_ORDER) {
      if (this.skip.has(tech) || TECHS[tech].age > this.me.age || this.isQueued(tech) || !when(this.counts())) continue;
      // Earlier-age techs are always worth buying before the next age-up.
      const now = first || TECHS[tech].age < this.me.age;
      if (saving && !now) continue;
      this.tryResearch(tech);
      if (now && !this.isQueued(tech)) waiting = true;
    }
    if (saving && !waiting) {
      this.tryResearch(ageUp);
      this.sellForGold(ageUp);
    }
  }

  /** At a market, sell spare wood (then food) when gold is all that holds up the next age. */
  private sellForGold(ageUp: TechId): void {
    if (this.isQueued(ageUp) || researchBlock(this.world, ME, ageUp, true) !== null) return;
    if (!this.mine('market', true).length) return;
    const cost = TECHS[ageUp].cost;
    const short = RESOURCES.filter((r) => this.stock[r] < (cost[r] ?? 0));
    if (short.length !== 1 || short[0] !== 'gold') return;
    const sell = this.stock.wood >= 400 ? 'wood' : this.stock.food >= (cost.food ?? 0) + 400 ? 'food' : null;
    if (sell) this.world.dispatch({ type: 'marketTrade', resource: sell, side: 'sell' }, ME);
  }

  private isQueued(tech: TechId): boolean {
    return this.me.researched.has(tech) || this.mine().some((b) => b.research?.includes(tech));
  }

  private tryResearch(tech: TechId): void {
    if (researchBlock(this.world, ME, tech) !== null) return;
    const at = this.mine(TECHS[tech].at, true).sort((a, b) => (a.research?.length ?? 0) - (b.research?.length ?? 0))[0];
    if (!at) return;
    this.world.dispatch({ type: 'research', buildingId: at.id, tech }, ME);
  }

  // ---- buildings ----
  private ageBuildings(): void {
    for (const kind of AGE_BUILDINGS[this.me.age]) {
      if (kind === 'storehouse' || kind === 'granary') continue; // laid as drop sites
      if (this.mine(kind).length) continue;
      if (!this.affords(BUILDINGS[kind].cost)) return;
      this.build(kind, this.tc.pos, 10, 26, 3);
      return;
    }
  }

  private affords(cost: Partial<Stockpile>): boolean {
    return RESOURCES.every((r) => this.stock[r] >= (cost[r] ?? 0));
  }

  /** Drop sites: a granary by the berries, a storehouse by the nearest wood, camps by gold and stone. */
  private dropSites(): void {
    const c = this.counts();
    const want: [BuildingKind, ResourceType, NodeFilter, boolean][] = [
      ['storehouse', 'wood', (n) => n.kind === 'tree', c.wood >= 2 || this.villagers().length >= 6],
      ['granary', 'food', (n) => n.kind === 'berry', c.berries >= 2],
      ['miningCamp', 'gold', (n) => n.kind === 'gold', c.gold >= 2],
      ['miningCamp', 'stone', (n) => n.kind === 'stone', c.stone >= 2],
    ];
    // A granary also anchors the farms once the berries are gone.
    if (!this.mine('granary').length && c.farms >= 2) want.push(['granary', 'food', () => false, true]);
    for (const [kind, type, filter, needed] of want) {
      if (!needed || this.mine(kind, false).length || this.stock.wood < BUILDINGS[kind].cost.wood!) continue;
      const node = this.frontier(type, filter);
      const anchor = node?.pos ?? this.tc.pos;
      const drop = this.nearestDrop(type, anchor);
      if (drop && dist(drop.pos, anchor) <= drop.radius + (type === 'wood' ? 6 : 15)) continue;
      if (!node && this.mine(kind).length) continue;
      // Stand between the node and home so the walk back is short.
      const toward = node ? this.toward(node.pos, 3.5) : { x: this.tc.pos.x, z: this.tc.pos.z };
      if (this.build(kind, toward, 0, 7, 2, 1.2) || (node && this.build(kind, node.pos, 2, 14, 2, 0.6))) return;
    }
  }

  private toward(p: Vec2, d: number): Vec2 {
    const dx = this.tc.pos.x - p.x;
    const dz = this.tc.pos.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / len) * d, z: p.z + (dz / len) * d };
  }

  private nearestDrop(type: ResourceType, p: Vec2): Building | undefined {
    let best: Building | undefined;
    for (const b of this.mine(undefined, true)) {
      if (!BUILDINGS[b.kind].drop.includes(type)) continue;
      if (!best || dist(b.pos, p) - b.radius < dist(best.pos, p) - best.radius) best = b;
    }
    return best;
  }

  /** The node of `type` the economy should work next: the one nearest any drop site or the TC. */
  private frontier(type: ResourceType, filter: NodeFilter): ResourceNode | undefined {
    const drops = this.mine(undefined, true).filter((b) => BUILDINGS[b.kind].drop.includes(type));
    let best: ResourceNode | undefined;
    let bestD = Infinity;
    for (const n of this.world.nodes.values()) {
      if (n.type !== type || n.amount <= 0 || !filter(n)) continue;
      const home = dist(n.pos, this.tc.pos);
      if (home > 90) continue;
      const d = Math.min(home, ...drops.map((b) => dist(n.pos, b.pos)));
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // ---- villager assignment ----
  private assign(): void {
    const vills = this.villagers();
    const c = this.counts();
    const working = c.food + c.wood + c.gold + c.stone + c.idle;
    // A resource with nothing left in reach gives its share to the others.
    const open = RESOURCES.filter((r) => r === 'food' || this.frontier(r, (n) => n.kind !== 'fish'));
    const split = SPLITS[this.planAge()];
    const share = open.reduce((n, r) => n + split[r], 0);
    const deficit = (r: ResourceType) => (open.includes(r) ? (split[r] / share) * working : 0) - c[r];
    const byNeed = () => [...RESOURCES].sort((a, b) => deficit(b) - deficit(a));
    for (const u of vills.filter((v) => this.role(v) === null)) {
      const r = byNeed().find((r) => this.send(u, r));
      if (r) c[r]++;
    }
    // Rebalance at most two villagers a step toward the split.
    for (let k = 0; k < 2; k++) {
      const over = byNeed().at(-1)!;
      if (deficit(over) > -1.5) break;
      const u = vills.find((v) => this.role(v) === over && v.state !== 'toDrop');
      const under = u && byNeed().find((r) => deficit(r) >= 1.5 && this.send(u, r));
      if (!under) break;
      c[over]--;
      c[under]++;
    }
  }

  /** Cancel foundations nobody has managed to work on for a minute (unreachable spots). */
  private unstick(): void {
    for (const b of this.mine(undefined, false)) {
      const seen = this.progress.get(b.id);
      if (!seen || b.buildProgress > seen.p) this.progress.set(b.id, { p: b.buildProgress, t: this.world.time });
      else if (this.world.time - seen.t > 60) {
        this.bad.push({ ...b.pos });
        this.world.dispatch({ type: 'cancelBuild', buildingId: b.id }, ME);
        this.progress.delete(b.id);
      }
    }
  }
  private readonly progress = new Map<number, { p: number; t: number }>();
  /** Spots where a foundation never got built (unreachable); never tried again. */
  private readonly bad: Vec2[] = [];

  private send(u: Unit, r: ResourceType): boolean {
    if (r === 'food') return this.sendFood(u);
    const node = this.pickNode(r, (n) => n.kind !== 'fish');
    if (!node) return false;
    this.world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: node.id }, ME);
    return u.gatherNode === node.id;
  }

  /** A node of `type` near a drop site, spreading villagers so no node is crowded. */
  private pickNode(type: ResourceType, filter: NodeFilter): ResourceNode | undefined {
    const front = this.frontier(type, filter);
    if (!front) return undefined;
    const drop = this.nearestDrop(type, front.pos);
    const center = drop && dist(drop.pos, front.pos) < 9 ? drop.pos : front.pos;
    const load = new Map<number, number>();
    for (const v of this.villagers()) if (v.gatherNode !== null) load.set(v.gatherNode, (load.get(v.gatherNode) ?? 0) + 1);
    const perNode = type === 'wood' ? 2 : type === 'food' ? 3 : 5;
    let best: ResourceNode | undefined;
    let bestScore = Infinity;
    for (const n of this.world.nodes.values()) {
      if (n.type !== type || n.amount <= 0 || !filter(n)) continue;
      const d = dist(n.pos, center);
      if (d > 12) continue;
      const l = load.get(n.id) ?? 0;
      const score = d + (l >= perNode ? 100 : l * 2);
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best ?? front;
  }

  private sendFood(u: Unit): boolean {
    const berry = this.pickNode('food', (n) => n.kind === 'berry' && dist(n.pos, this.tc.pos) < 30);
    if (berry) {
      const load = this.villagers().filter((v) => v.gatherNode === berry.id).length;
      if (load < 3) {
        this.world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: berry.id }, ME);
        if (u.gatherNode === berry.id) return true;
      }
    }
    const farms = this.mine('farm').sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos));
    const free = farms.find((f) => f.complete && (f.food ?? 0) > 0 && farmFree(this.world, f, u));
    if (free) {
      this.world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: free.id }, ME);
      return u.gatherNode === free.id;
    }
    const fallow = farms.find((f) => f.complete && !(f.food! > 0) && farmFree(this.world, f, u));
    if (fallow && this.stock.wood >= BUILDINGS.farm.cost.wood!) {
      this.world.dispatch({ type: 'gather', unitIds: [u.id], nodeId: fallow.id }, ME);
      return u.gatherNode === fallow.id;
    }
    const foundation = farms.find((f) => !f.complete && ![...this.world.buildState.values()].includes(f.id));
    if (foundation) {
      this.world.dispatch({ type: 'construct', unitIds: [u.id], buildingId: foundation.id }, ME);
      return u.state === 'toBuild';
    }
    if (this.stock.wood < BUILDINGS.farm.cost.wood!) return false;
    const granary = this.mine('granary', true)[0];
    const anchor = granary && dist(granary.pos, this.tc.pos) < 25 ? granary.pos : this.tc.pos;
    const pos =
      findSpot(this.world, 'farm', anchor, 4, 22, 1.5, 0.2, this.bad) ?? findSpot(this.world, 'farm', this.tc.pos, 4, 36, 1.5, 0.2, this.bad);
    if (!pos) return false;
    this.world.dispatch({ type: 'build', unitIds: [u.id], kind: 'farm', pos, rot: 0 }, ME);
    return u.state === 'toBuild';
  }
}

type NodeFilter = (n: ResourceNode) => boolean;

/** Count resources deposited by `player` during each world tick (stock rises inside a tick are deposits). */
export function tickGathered(world: World, player: number, onGather: (r: ResourceType, n: number) => void): (dt: number) => void {
  return (dt: number) => {
    const s = world.stockOf(player);
    const before = { ...s };
    world.tick(dt);
    for (const r of RESOURCES) if (s[r] > before[r]) onGather(r, s[r] - before[r]);
  };
}

/** Play the scripted build order on map `seed`. */
export function runPacing(seed: number, opts: PacingOptions = {}, inspect?: (w: World) => void): PacingResult {
  const world = benchWorld(seed);
  const order = new BuildOrder(world, new Set(opts.skip));
  const maxSeconds = opts.maxSeconds ?? 40 * 60;
  const ages: (number | null)[] = [0, null, null, null];
  const techs: Partial<Record<TechId, number>> = {};
  world.events.on('agedUp', (e) => {
    if (e.owner === ME) ages[e.age] = world.time;
  });
  world.events.on('researched', (e) => {
    if (e.owner === ME) techs[e.tech] = world.time;
  });
  const gathered: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
  let minute: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
  const tick = tickGathered(world, ME, (r, n) => {
    gathered[r] += n;
    minute[r] += n;
  });
  const samples: PacingSample[] = [];
  const perSecond = Math.round(1 / DT);
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps; i++) {
    if (i % perSecond === 0) order.step();
    tick(DT);
    if ((i + 1) % (60 * perSecond) === 0) {
      const c = order.counts();
      samples.push({
        minute: (i + 1) / (60 * perSecond),
        villagers: c.villagers,
        age: world.players.get(ME)!.age,
        workers: { food: c.food, wood: c.wood, gold: c.gold, stone: c.stone },
        gathered: minute,
        stock: { ...world.stockOf(ME) },
        popCap: world.popCapOf(ME),
        idle: c.idle,
        building: c.building,
        soldiers: world.popOf(ME) - c.villagers - 1,
      });
      minute = { food: 0, wood: 0, gold: 0, stone: 0 };
    }
    if (opts.stopAtAge !== undefined && ages[opts.stopAtAge] !== null) break;
  }
  inspect?.(world);
  return { seed, ages, techs, samples, gathered, seconds: world.time };
}

// ------------------------------------------------------------------------------------------
// Economy-tech payback: a controlled experiment on the same map
// ------------------------------------------------------------------------------------------

/** Where a scenario puts its workers. 'farm' = one villager per farm, reseeding as they run out. */
export type WorkSite = 'wood' | 'gold' | 'stone' | 'berry' | 'farm';

export interface EcoTechCase {
  tech: TechId;
  /** Techs researched in both arms (the chain before it). */
  base: TechId[];
  /** Workers per site. */
  crew: Partial<Record<WorkSite, number>>;
}

/** The economy techs and the crews they're judged with (typical 6–10 workers on that resource). */
export const ECO_TECHS: EcoTechCase[] = [
  // Village Age crews are 8 strong; later ages run bigger camps (still within 6–10 per resource).
  { tech: 'bronzeAxe', base: [], crew: { wood: 8 } },
  { tech: 'ironAxe', base: ['bronzeAxe'], crew: { wood: 10 } },
  { tech: 'twoManSaw', base: ['bronzeAxe', 'ironAxe'], crew: { wood: 10 } },
  { tech: 'bronzePicks', base: [], crew: { gold: 8 } },
  { tech: 'stoneChisels', base: [], crew: { stone: 6 } },
  { tech: 'deepShafts', base: ['bronzePicks', 'stoneChisels'], crew: { gold: 8, stone: 4 } },
  { tech: 'oreSledges', base: ['bronzePicks', 'stoneChisels', 'deepShafts'], crew: { gold: 10, stone: 4 } },
  { tech: 'oxPlough', base: [], crew: { farm: 8 } },
  { tech: 'ironPloughshare', base: ['oxPlough'], crew: { farm: 10 } },
  { tech: 'cropRotation', base: ['oxPlough', 'ironPloughshare'], crew: { farm: 10 } },
  { tech: 'threshingFloor', base: [], crew: { berry: 6 } },
  { tech: 'donkeyPacks', base: [], crew: { wood: 8, farm: 8, gold: 4 } },
  { tech: 'oxCarts', base: ['donkeyPacks'], crew: { wood: 10, farm: 10, gold: 8 } },
];

export interface RateOptions {
  /** Seconds before measuring (walk out, first trips). */
  warmup?: number;
  /** Seconds measured. */
  window?: number;
}

/**
 * Net resources per second a crew brings in on map `seed` with `techs` researched: deposits
 * minus the wood farms cost to reseed (charged per food: farm wood ÷ food per field). Nodes and
 * fields are topped up so nothing runs dry mid-measurement: both arms work the same spots and the
 * difference is the tech alone.
 */
export function crewRate(seed: number, techs: TechId[], crew: EcoTechCase['crew'], opts: RateOptions = {}): number {
  const warmup = opts.warmup ?? 30;
  const window = opts.window ?? 300;
  const world = benchWorld(seed);
  for (const t of techs) completeResearch(world, ME, t);
  const tc = world.townCenterOf(ME)!;
  for (const u of [...world.units.values()]) if (u.owner === ME && u.kind === 'villager') world.units.delete(u.id);
  Object.assign(world.stockOf(ME), { food: 0, wood: 100000, gold: 0, stone: 0 });

  const place = (kind: BuildingKind, near: Vec2, lo: number, hi: number, clear: number): Building => {
    const pos = findSpot(world, kind, near, lo, hi, clear, 0.2);
    if (!pos) throw new Error(`no room for ${kind} on seed ${seed}`);
    const b = layFoundation(world, kind, pos, 0, ME);
    completeBuilding(world, b);
    return b;
  };
  const kit = (kind: ResourceNode['kind']) =>
    [...world.nodes.values()].filter((n) => n.kind === kind).sort((a, b) => dist(a.pos, tc.pos) - dist(b.pos, tc.pos));
  const towardTc = (q: Vec2, d: number) => {
    const len = dist(q, tc.pos) || 1;
    return { x: q.x + ((tc.pos.x - q.x) / len) * d, z: q.z + ((tc.pos.z - q.z) / len) * d };
  };
  // Next to a building, on its Town Center side, clear of its footprint.
  const spawn = (n: number, b: Building) => {
    const at = towardTc(b.pos, b.radius + 1.2);
    return Array.from({ length: n }, (_, i) => world.spawnUnit('villager', { x: at.x + (i % 4) * 0.6 - 0.9, z: at.z + Math.floor(i / 4) * 0.6 }, ME));
  };

  for (const [site, n] of Object.entries(crew) as [WorkSite, number][]) {
    if (!n) continue;
    if (site === 'farm') {
      const granary = place('granary', tc.pos, 6, 16, 2);
      const farms = Array.from({ length: n }, () => place('farm', granary.pos, 3, 16, 1.5));
      // Fields never run out; reseeding is charged per food below instead (smooth, no 60-wood steps).
      for (const f of farms) f.food = 100000;
      const vs = spawn(n, granary);
      vs.forEach((v, i) => world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: farms[i].id }, ME));
      continue;
    }
    const kind = site === 'berry' ? 'berry' : site === 'wood' ? 'tree' : site;
    const nodes = kit(kind);
    const first = nodes[0];
    const dropKind: BuildingKind = site === 'wood' ? 'storehouse' : site === 'berry' ? 'granary' : 'miningCamp';
    const drop = place(dropKind, towardTc(first.pos, 3.5), 0, 7, 1.2);
    for (const node of nodes) node.amount = 100000;
    const near = nodes.filter((node) => dist(node.pos, drop.pos) < 10);
    const vs = spawn(n, drop);
    vs.forEach((v, i) => world.dispatch({ type: 'gather', unitIds: [v.id], nodeId: near[i % near.length].id }, ME));
  }

  // A farm's food costs its reseed: farm wood / food per field (which the farm techs raise).
  const seedCost = crew.farm ? BUILDINGS.farm.cost.wood! / farmFood(world, ME) : 0;
  let got = 0;
  let measuring = false;
  const tick = tickGathered(world, ME, (r, k) => {
    if (measuring) got += r === 'food' ? k * (1 - seedCost) : k;
  });
  const perSecond = Math.round(1 / DT);
  const steps = Math.round((warmup + window) / DT);
  for (let i = 0; i < steps; i++) {
    measuring = i >= warmup * perSecond;
    tick(DT);
  }
  return got / window;
}

export interface Payback {
  tech: TechId;
  cost: number;
  time: number;
  crew: string;
  /** Net resources per second without / with the tech. */
  without: number;
  with: number;
  /** Seconds from clicking research until the extra income covers the cost (research time included). */
  payback: number;
}

/** Measure every economy tech's payback on map `seed`. Arms are shared along each chain. */
export function measurePaybacks(seed: number, cases = ECO_TECHS, opts: RateOptions = {}): Payback[] {
  const memo = new Map<string, number>();
  const rate = (techs: TechId[], crew: EcoTechCase['crew']) => {
    const key = JSON.stringify([[...techs].sort(), crew]);
    if (!memo.has(key)) memo.set(key, crewRate(seed, techs, crew, opts));
    return memo.get(key)!;
  };
  return cases.map(({ tech, base, crew }) => {
    const without = rate(base, crew);
    const withIt = rate([...base, tech], crew);
    const spec = TECHS[tech];
    const gain = withIt - without;
    return {
      tech,
      cost: total(spec.cost),
      time: spec.time,
      crew: Object.entries(crew).map(([k, v]) => `${v} ${k}`).join(' + '),
      without,
      with: withIt,
      payback: gain > 0 ? spec.time + total(spec.cost) / gain : Infinity,
    };
  });
}

/** mm:ss */
export function clock(s: number | null): string {
  if (s === null || !isFinite(s)) return '—';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
