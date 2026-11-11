import * as THREE from 'three';
import type { Quality } from '../core/quality';
import { SEA_LEVEL, type Heightfield, type PlayerId } from '../core/types';
import { applyFog, type FogOfWar } from './fog';
import { extractBorders, TerritoryMemory, type BorderEdge, type SightGrid, type TerritoryGrid } from './territoryBorders';

/** Ribbon width inside the border, world units: glowing on desktop, a plain thin line on phones. */
export const BORDER_WIDTH = { glow: 0.85, plain: 0.32 } as const;
/** Height above the ground (or water surface, which ripples about ±0.08) the ribbon floats at. */
const LIFT_LAND = 0.08;
const LIFT_WATER = 0.16;
/** Seconds between fog-only rescans (exploration and line of sight); territory changes apply at once. */
const SIGHT_INTERVAL = { glow: 0.25, plain: 0.5 } as const;

/** Flat arrays for an indexed ribbon mesh: four vertices and two triangles per edge. */
export interface BorderMeshData {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * Ribbon geometry for border edges, draped over the heightfield. Each edge becomes a quad from
 * the cell edge (v = 0, the bright line) inward by `width` (v = 1, faded), coloured by owner.
 */
export function buildBorderMesh(
  edges: readonly BorderEdge[],
  cell: number,
  width: number,
  hf: Pick<Heightfield, 'heightAt'>,
  colorOf: (owner: PlayerId) => THREE.Color,
): BorderMeshData {
  const n = edges.length;
  const positions = new Float32Array(n * 12);
  const colors = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const indices = new Uint32Array(n * 6);
  const put = (v: number, x: number, z: number, u: number, t: number, c: THREE.Color) => {
    const h = hf.heightAt(x, z);
    positions[v * 3] = x;
    positions[v * 3 + 1] = h < SEA_LEVEL ? SEA_LEVEL + LIFT_WATER : h + LIFT_LAND;
    positions[v * 3 + 2] = z;
    colors[v * 3] = c.r;
    colors[v * 3 + 1] = c.g;
    colors[v * 3 + 2] = c.b;
    uvs[v * 2] = u;
    uvs[v * 2 + 1] = t;
  };
  for (let k = 0; k < n; k++) {
    const e = edges[k];
    const c = colorOf(e.owner);
    const x0 = e.x * cell;
    const z0 = e.z * cell;
    const x1 = x0 + (e.axis === 0 ? cell : 0);
    const z1 = z0 + (e.axis === 1 ? cell : 0);
    const ix = e.nx * width;
    const iz = e.nz * width;
    const v = k * 4;
    put(v, x0, z0, 0, 0, c);
    put(v + 1, x1, z1, 1, 0, c);
    put(v + 2, x1 + ix, z1 + iz, 1, 1, c);
    put(v + 3, x0 + ix, z0 + iz, 0, 1, c);
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], k * 6);
  }
  return { positions, colors, uvs, indices };
}

/** Alpha across the ribbon (v = 0 at the border): a bright core, then a soft glow or a hard stop. */
export function borderProfile(glow: boolean, size = 32): Uint8Array {
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const t = (i + 0.5) / size;
    let a: number;
    if (glow) a = t < 0.22 ? 0.95 : 0.55 * Math.pow(1 - (t - 0.22) / 0.78, 2);
    else a = t < 0.8 ? 0.9 : 0.9 * (1 - (t - 0.8) / 0.2);
    data.set([255, 255, 255, Math.round(a * 255)], i * 4);
  }
  return data;
}

/**
 * Player-coloured territory borders on the ground (M18-2). Reads world.territory through a
 * {@link TerritoryMemory}, so only explored territory shows and enemy borders change only where
 * the local player can see. Geometry rebuilds only when the remembered picture or the player
 * colours change. Phones (low tier) draw a thin plain line and rescan the fog less often.
 */
export class TerritoryView {
  readonly object: THREE.Mesh;
  readonly memory: TerritoryMemory;
  /** Milliseconds the last geometry rebuild took (perf overlay / tests). */
  lastBuildMs = 0;
  /** Number of rebuilds so far. */
  builds = 0;
  private readonly glow: boolean;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;
  private builtVersion = -1;
  private builtColors = -1;
  private lastSight = -Infinity;
  private shown = true;

  constructor(
    readonly hf: Heightfield,
    grid: TerritoryGrid,
    sight: SightGrid,
    local: PlayerId,
    quality: Pick<Quality, 'territoryGlow'>,
    private readonly colorOf: (owner: PlayerId) => number,
  ) {
    this.glow = quality.territoryGlow;
    this.memory = new TerritoryMemory(grid, sight, local);
    const profile = new THREE.DataTexture(borderProfile(this.glow), 1, 32, THREE.RGBAFormat);
    profile.magFilter = THREE.LinearFilter;
    profile.minFilter = THREE.LinearFilter;
    profile.wrapS = THREE.ClampToEdgeWrapping;
    profile.wrapT = THREE.ClampToEdgeWrapping;
    profile.needsUpdate = true;
    this.material = new THREE.MeshBasicMaterial({
      map: profile,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = 'territory-borders';
    this.object.frustumCulled = false;
    this.object.renderOrder = 3;
    this.object.matrixAutoUpdate = false;
    this.object.raycast = () => {};
  }

  setFog(fog: FogOfWar): void {
    applyFog(this.material, fog, { keepAlpha: true });
  }

  /** Settings toggle. Hidden borders skip all work until shown again. */
  setShown(on: boolean): void {
    this.shown = on;
    this.object.visible = on;
  }

  /** Per frame, `time` in seconds. Cheap unless territory or fog changed. */
  update(time: number): void {
    if (!this.shown) return;
    const m = this.memory;
    const due = m.territoryChanged || (m.pending && time - this.lastSight >= SIGHT_INTERVAL[this.glow ? 'glow' : 'plain']);
    if (due) {
      this.lastSight = time;
      m.update();
    }
    const colors = this.colorKey();
    if (m.version !== this.builtVersion || colors !== this.builtColors) this.rebuild(colors);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }

  private rebuild(colors: number): void {
    const t0 = performance.now();
    this.builtVersion = this.memory.version;
    this.builtColors = colors;
    const { grid, known } = this.memory;
    const edges = extractBorders(known, grid.cols, grid.rows);
    const cache = new Map<PlayerId, THREE.Color>();
    const colorOf = (o: PlayerId) => {
      let c = cache.get(o);
      if (!c) cache.set(o, (c = new THREE.Color(this.colorOf(o))));
      return c;
    };
    const data = buildBorderMesh(edges, grid.cell, BORDER_WIDTH[this.glow ? 'glow' : 'plain'], this.hf, colorOf);
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.object.visible = this.shown && edges.length > 0;
    this.builds++;
    this.lastBuildMs = performance.now() - t0;
  }

  /** Owner colours currently in use, so a colour-blind switch repaints. */
  private colorKey(): number {
    let key = 17;
    for (let o = 1; o <= 8; o++) key = (Math.imul(key, 31) + this.colorOf(o)) | 0;
    return key;
  }
}
