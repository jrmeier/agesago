import { BUILDINGS, TERRITORY, type TerritoryInfluence } from '../core/buildings';
import { GAIA, type Age, type Building, type Heightfield, type PlayerId, type Vec2 } from '../core/types';

/** What the territory grid needs from the world: buildings and each player's age. */
export interface TerritorySources {
  readonly buildings: ReadonlyMap<number, Building>;
  readonly players: ReadonlyMap<PlayerId, { age: Age }>;
}

/** Influence of a complete `b` owned by a player at `age`, or null if it projects none. */
export function territoryInfluence(b: Building, age: Age): TerritoryInfluence | null {
  const spec = BUILDINGS[b.kind].territory;
  if (!spec || !b.complete || b.owner === GAIA) return null;
  if (b.kind !== 'townCenter' || !age) return spec;
  return { ...spec, radius: spec.radius * (1 + TERRITORY.ageRadiusBonus * age) };
}

/**
 * Territory grid (M18-1, after 0 A.D.'s TerritoryManager). Each cell belongs to the player
 * whose complete buildings pull hardest on it (linear falloff, summed per player); a tie or no
 * pull leaves it neutral (0). Owned cells 4-connected to a cell holding one of their owner's root
 * buildings are "connected"; the rest keep their owner but are cut off (decay, M18-3).
 *
 * The grid is derived state: it is not saved, and recomputes only when the set of influencing
 * buildings (complete, owner) or a player's age changes — `sync` checks a cheap fingerprint
 * once per tick. Reads in between see the grid as of the last sync, identically on every peer.
 */
export class Territory {
  readonly cell = TERRITORY.cell;
  readonly cols: number;
  readonly rows: number;
  /** Owning player per cell (0 = neutral). Row-major, `z * cols + x`. */
  readonly owner: Uint8Array;
  /** 1 where the owner's territory links back to one of its roots. */
  readonly connected: Uint8Array;
  /** Increments on every recompute (render and AI caches rebuild on change). */
  version = 0;
  /** 1 where territory may exist: land, or water within TERRITORY.waterReach cells of the shore. */
  private readonly allowed: Uint8Array;
  private readonly weights = new Map<PlayerId, Float64Array>();
  private readonly queue: Int32Array;
  private fingerprint = -1;
  private stale = true;

  constructor(hf: Heightfield) {
    this.cols = Math.max(1, Math.ceil(hf.width / this.cell));
    this.rows = Math.max(1, Math.ceil(hf.depth / this.cell));
    const n = this.cols * this.rows;
    this.owner = new Uint8Array(n);
    this.connected = new Uint8Array(n);
    this.allowed = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.markShore(hf);
  }

  /** Cell index under `p`, or -1 off the map. */
  cellAt(p: Vec2): number {
    const x = Math.floor(p.x / this.cell);
    const z = Math.floor(p.z / this.cell);
    if (x < 0 || z < 0 || x >= this.cols || z >= this.rows) return -1;
    return z * this.cols + x;
  }

  /** Owner of the territory at `p` (0 = neutral or off the map). */
  ownerAt(world: TerritorySources, p: Vec2): PlayerId {
    this.ensure(world);
    const i = this.cellAt(p);
    return i < 0 ? GAIA : this.owner[i];
  }

  /** Is the territory at `p` owned and linked to one of its owner's roots? */
  connectedAt(world: TerritorySources, p: Vec2): boolean {
    this.ensure(world);
    const i = this.cellAt(p);
    return i >= 0 && this.connected[i] === 1;
  }

  /** Force a recompute on the next read or sync (after a load or a direct state edit). */
  invalidate(): void {
    this.stale = true;
  }

  /** Recompute if never computed or invalidated. */
  ensure(world: TerritorySources): void {
    if (this.stale) this.recompute(world);
  }

  /** Once per tick: recompute only if an influencing building or an age changed. */
  sync(world: TerritorySources): void {
    if (this.stale || fingerprint(world) !== this.fingerprint) this.recompute(world);
  }

  /** Rebuild the whole grid from the world's complete buildings and ages. */
  recompute(world: TerritorySources): void {
    this.fingerprint = fingerprint(world);
    this.stale = false;
    this.version++;
    const { cols, rows, cell, owner, connected, allowed, weights } = this;
    for (const w of weights.values()) w.fill(0);
    const roots: { owner: PlayerId; cell: number }[] = [];
    for (const b of world.buildings.values()) {
      const inf = territoryInfluence(b, world.players.get(b.owner)?.age ?? 0);
      if (!inf) continue;
      let w = weights.get(b.owner);
      if (!w) weights.set(b.owner, (w = new Float64Array(cols * rows)));
      const { radius, weight } = inf;
      const x0 = Math.max(0, Math.floor((b.pos.x - radius) / cell));
      const x1 = Math.min(cols - 1, Math.floor((b.pos.x + radius) / cell));
      const z0 = Math.max(0, Math.floor((b.pos.z - radius) / cell));
      const z1 = Math.min(rows - 1, Math.floor((b.pos.z + radius) / cell));
      for (let z = z0; z <= z1; z++) {
        const dz = (z + 0.5) * cell - b.pos.z;
        for (let x = x0; x <= x1; x++) {
          const i = z * cols + x;
          if (!allowed[i]) continue;
          const dx = (x + 0.5) * cell - b.pos.x;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < radius) w[i] += weight * (1 - d / radius);
        }
      }
      if (inf.root) {
        const c = this.cellAt(b.pos);
        if (c >= 0) roots.push({ owner: b.owner, cell: c });
      }
    }
    // Strongest pull wins; a tie (within float noise) leaves the cell neutral. Ascending ids keep it order-free.
    const ids = [...weights.keys()].sort((a, b) => a - b);
    const lists = ids.map((id) => weights.get(id)!);
    owner.fill(0);
    connected.fill(0);
    for (let i = 0; i < owner.length; i++) {
      let best = 0;
      let bestW = 0;
      for (let k = 0; k < ids.length; k++) {
        const v = lists[k][i];
        if (v <= 0) continue;
        if (v > bestW + 1e-9) {
          best = ids[k];
          bestW = v;
        } else if (v >= bestW - 1e-9) {
          best = 0; // tied with the current leader
        }
      }
      owner[i] = best;
    }
    // Flood each owner's territory from its roots (4-neighbour).
    const q = this.queue;
    let head = 0;
    let tail = 0;
    for (const r of roots) {
      if (owner[r.cell] !== r.owner || connected[r.cell]) continue;
      connected[r.cell] = 1;
      q[tail++] = r.cell;
    }
    while (head < tail) {
      const i = q[head++];
      const o = owner[i];
      const x = i % cols;
      if (x > 0) visit(i - 1);
      if (x < cols - 1) visit(i + 1);
      if (i >= cols) visit(i - cols);
      if (i + cols < owner.length) visit(i + cols);
      function visit(j: number): void {
        if (owner[j] === o && !connected[j]) {
          connected[j] = 1;
          q[tail++] = j;
        }
      }
    }
  }

  /** Land cells, plus water cells within TERRITORY.waterReach steps (4-neighbour) of land. */
  private markShore(hf: Heightfield): void {
    const { cols, rows, cell, allowed } = this;
    const dist = new Int32Array(cols * rows).fill(-1);
    const q = new Int32Array(cols * rows);
    let tail = 0;
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        if (hf.isWater((x + 0.5) * cell, (z + 0.5) * cell)) continue;
        const i = z * cols + x;
        dist[i] = 0;
        q[tail++] = i;
      }
    }
    for (let head = 0; head < tail; head++) {
      const i = q[head];
      if (dist[i] >= TERRITORY.waterReach) continue;
      const x = i % cols;
      for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
        if (j < 0 || j >= dist.length || dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        q[tail++] = j;
      }
    }
    for (let i = 0; i < dist.length; i++) allowed[i] = dist[i] >= 0 ? 1 : 0;
  }
}

/** Hash of everything territory depends on: complete influencing buildings (id, owner) and ages. */
function fingerprint(world: TerritorySources): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0;
  };
  for (const b of world.buildings.values()) {
    if (!b.complete || b.owner === GAIA || !BUILDINGS[b.kind].territory) continue;
    mix(b.id);
    mix(b.owner);
  }
  for (const [id, p] of world.players) {
    mix(id);
    mix(p.age);
  }
  return h;
}
