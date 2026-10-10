import type { BuildingKind, EntityId, PlayerId, ResourceNode, ResourceType, UnitKind, Vec2 } from '../core/types';
import { isAnimal, UNITS, type UnitClass } from '../core/units';
import type { World } from '../sim/World';

/** An enemy building as last seen. */
export interface SeenBuilding {
  id: EntityId;
  kind: BuildingKind;
  owner: PlayerId;
  pos: Vec2;
  radius: number;
}

/** How long a sighting of an enemy unit counts toward its army composition. */
const UNIT_MEMORY = 150;
/** Distance-to-nearest-resource mask (in cells, capped) used to keep buildings off resources. */
export const NODE_MASK_CAP = 5;

/**
 * What one AI player legitimately knows: enemy units it can see now, enemy buildings it has
 * seen (forgotten once it sees the spot empty), and resources on its explored ground. With
 * `fullMap` (the 'hardest' cheat) fog is ignored.
 */
export class Intel {
  readonly buildings = new Map<EntityId, SeenBuilding>();
  /** Enemy unit id → kind and when it was last seen. */
  private readonly seen = new Map<EntityId, { kind: UnitKind; at: number }>();
  /** Explored resource nodes by type (refreshed by refreshNodes). */
  readonly nodes: Record<ResourceType, ResourceNode[]> = { wood: [], food: [], gold: [], stone: [] };
  /** Per 1×1 cell: distance in cells to the nearest resource node, capped at NODE_MASK_CAP. */
  readonly nodeDist: Uint8Array;
  readonly cols: number;
  /** The first enemy Town Center seen (the direction to face the base toward). */
  enemyStart: Vec2 | null = null;

  constructor(
    private readonly world: World,
    private readonly player: PlayerId,
    private readonly fullMap: boolean
  ) {
    this.cols = Math.ceil(world.hf.width);
    this.nodeDist = new Uint8Array(this.cols * Math.ceil(world.hf.depth));
  }

  knows(x: number, z: number): boolean {
    return this.fullMap || this.world.visibilityOf(this.player).isExplored(x, z);
  }

  sees(x: number, z: number): boolean {
    return this.fullMap || this.world.visibilityOf(this.player).isVisible(x, z);
  }

  /** Update sightings of enemy buildings and units. */
  scan(): void {
    const w = this.world;
    for (const b of w.buildings.values()) {
      if (!w.areEnemies(this.player, b.owner) || this.buildings.has(b.id)) continue;
      if (this.seesFootprint(b.pos, b.radius)) {
        this.buildings.set(b.id, { id: b.id, kind: b.kind, owner: b.owner, pos: { ...b.pos }, radius: b.radius });
        if (b.kind === 'townCenter' && !this.enemyStart) this.enemyStart = { ...b.pos };
      }
    }
    for (const [id, s] of this.buildings) {
      // Gone, and we can see that it's gone.
      if (!w.buildings.has(id) && this.seesFootprint(s.pos, s.radius)) this.buildings.delete(id);
    }
    for (const u of w.units.values()) {
      if (isAnimal(u.kind) || !w.areEnemies(this.player, u.owner)) continue;
      if (this.sees(u.pos.x, u.pos.z)) this.seen.set(u.id, { kind: u.kind, at: w.time });
    }
    for (const [id, s] of this.seen) if (w.time - s.at > UNIT_MEMORY || !w.units.has(id)) this.seen.delete(id);
  }

  private seesFootprint(p: Vec2, r: number): boolean {
    const h = r * 0.6;
    return this.sees(p.x, p.z) || this.sees(p.x - h, p.z) || this.sees(p.x + h, p.z) || this.sees(p.x, p.z - h) || this.sees(p.x, p.z + h);
  }

  /** Recently seen enemy units by class (scouts and villagers excluded). */
  enemyMix(): Record<UnitClass, number> {
    const mix: Record<UnitClass, number> = { villager: 0, infantry: 0, archer: 0, cavalry: 0, wildlife: 0, ship: 0 };
    for (const s of this.seen.values()) if (s.kind !== 'scout') mix[UNITS[s.kind].unitClass]++;
    return mix;
  }

  /** Enemy soldiers seen recently (an estimate of the army we'd meet). */
  enemyArmy(): number {
    let n = 0;
    for (const s of this.seen.values()) if (s.kind !== 'scout' && s.kind !== 'villager') n++;
    return n;
  }

  /** Re-list explored resource nodes and rebuild the near-resource mask. */
  refreshNodes(): void {
    for (const t of Object.keys(this.nodes) as ResourceType[]) this.nodes[t] = [];
    const mask = this.nodeDist;
    mask.fill(NODE_MASK_CAP);
    const cols = this.cols;
    const rows = mask.length / cols;
    const R = NODE_MASK_CAP;
    for (const n of this.world.nodes.values()) {
      if (n.amount <= 0 || !this.knows(n.pos.x, n.pos.z)) continue;
      this.nodes[n.type].push(n);
      const cx = Math.floor(n.pos.x);
      const cz = Math.floor(n.pos.z);
      for (let dz = -R; dz <= R; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= rows) continue;
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= cols) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          const i = z * cols + x;
          if (d < mask[i]) mask[i] = d;
        }
      }
    }
  }

  /** Cells from (x, z) to the nearest known resource node, capped. */
  nodeDistAt(x: number, z: number): number {
    const c = Math.floor(x);
    const r = Math.floor(z);
    if (c < 0 || r < 0 || c >= this.cols || r * this.cols >= this.nodeDist.length) return 0;
    return this.nodeDist[r * this.cols + c];
  }

  /** Known enemy building nearest to `from` (optionally only of these kinds). */
  nearestBuilding(from: Vec2, kinds?: BuildingKind[]): SeenBuilding | null {
    let best: SeenBuilding | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (kinds && !kinds.includes(b.kind)) continue;
      const d = Math.hypot(b.pos.x - from.x, b.pos.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
