import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildingTier, chainTier, CHAINS, unitLine, type TechId } from '../core/techs';
import { currentSettings } from '../game/settings';
import type { BuildingKind, ResourceType, UnitKind } from '../core/types';
import { UNITS } from '../core/units';

/**
 * Upgrade visuals (M8-15) without extra draw calls.
 *
 * Unit models bake a vertex colour per part into a few merged meshes. Parts that
 * change with research are tagged with a role before merging; `mergeTagged`
 * records each role's vertex range, and `applyRole` rewrites just those colours
 * (or collapses the range to a point, hiding an optional piece such as a crest).
 * Each unit keeps its own geometry and material, so nothing new is drawn and the
 * low quality tier pays no extra draw calls. Palettes are shared constant tables.
 */

export type TintRole = 'axe' | 'pick' | 'sickle' | 'armor' | 'jerkin' | 'trim' | 'crest' | 'rim';

/** Tool heads: tier 0 keeps the built flint grey, then bronze, iron, tempered iron. Index by chainTier. */
export const TOOL_TINT = [null, 0xc0974a, 0x8f969c, 0xb9c2c9] as const;
/** Body armour: tier 0 keeps the model's own colour, then linen, bronze, iron. */
export const ARMOR_TINT = [null, 0xeae0c4, 0xc49a45, 0x8d949b] as const;
/** Unit-line trim (belt, shield rim, crest): 0 as built, 1 polished bronze, 2 gold. */
export const TRIM_TINT = [null, 0xd2ab55, 0xf0c64a] as const;
/** Horsehair crest colour by line tier; tier 0 has no crest. */
export const CREST_TINT = [null, 0x8a2a1c, 0xf2ead2] as const;

export interface UnitTiers {
  /** chainTier of CHAINS.wood / mining / farming (villagers only, else 0). */
  wood: number;
  mining: number;
  farming: number;
  /** chainTier of the class's forge armour chain (0..3). */
  armor: number;
  /** unitLine(...).tier (0..2). */
  line: number;
}

export const BASE_TIERS: UnitTiers = { wood: 0, mining: 0, farming: 0, armor: 0, line: 0 };

const ARMOR_CHAIN = {
  infantry: CHAINS.infantryArmor,
  archer: CHAINS.archerArmor,
  cavalry: CHAINS.cavalryArmor,
} as const;

/** Every tier that changes how `kind` looks for a player with `researched`. */
export function unitTiers(researched: ReadonlySet<TechId> | undefined, kind: UnitKind): UnitTiers {
  if (!researched || researched.size === 0) return BASE_TIERS;
  const cls = UNITS[kind].unitClass;
  const villager = kind === 'villager';
  const chain = cls === 'infantry' || cls === 'archer' || cls === 'cavalry' ? ARMOR_CHAIN[cls] : null;
  return {
    wood: villager ? chainTier(researched, CHAINS.wood) : 0,
    mining: villager ? chainTier(researched, CHAINS.mining) : 0,
    farming: villager ? chainTier(researched, CHAINS.farming) : 0,
    armor: chain ? chainTier(researched, chain) : 0,
    line: unitLine(researched, kind).tier,
  };
}

/** Upgrade tier a building renders at (watch tower 0..2, town centre 0..1, else 0). */
export function buildingRenderTier(researched: ReadonlySet<TechId> | undefined, kind: BuildingKind): number {
  return researched ? buildingTier(researched, kind).tier : 0;
}

export function sameTiers(a: UnitTiers, b: UnitTiers): boolean {
  return a.wood === b.wood && a.mining === b.mining && a.farming === b.farming && a.armor === b.armor && a.line === b.line;
}

interface RoleRange {
  start: number;
  count: number;
  /** The colour the part was built with; tints scale vertex colours by target / ref. */
  ref: [number, number, number];
  colors: Float32Array;
  positions: Float32Array;
  /** Where a hidden range collapses: a vertex of an untagged part, so bounds don't grow. */
  anchor: [number, number, number];
}
type RoleTable = Partial<Record<TintRole, RoleRange[]>>;

/** Mark a coloured part (from `part()`) as tintable. `hex` is the colour it was built with. */
export function tag(geometry: THREE.BufferGeometry, role: TintRole, hex: number): THREE.BufferGeometry {
  geometry.userData.tintRole = role;
  geometry.userData.tintRef = hex;
  return geometry;
}

/** Merge parts like `merge()`, remembering where each tagged role's vertices landed. */
export function mergeTagged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ranges: { role: TintRole; start: number; count: number; ref: number }[] = [];
  let offset = 0;
  for (const piece of parts) {
    const count = piece.getAttribute('position').count;
    const role = piece.userData.tintRole as TintRole | undefined;
    if (role) ranges.push({ role, start: offset, count, ref: piece.userData.tintRef as number });
    offset += count;
  }
  const geometry = mergeGeometries(parts, false);
  for (const piece of parts) piece.dispose();
  if (!geometry) throw new Error('Model parts have incompatible geometry attributes');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (ranges.length === 0) return geometry;
  const colors = geometry.getAttribute('color').array as Float32Array;
  const positions = geometry.getAttribute('position').array as Float32Array;
  const table: RoleTable = {};
  let anchorIndex = 0;
  for (const range of ranges) if (range.start === anchorIndex) anchorIndex += range.count;
  if (anchorIndex * 3 >= positions.length) anchorIndex = 0;
  const anchor: [number, number, number] = [positions[anchorIndex * 3], positions[anchorIndex * 3 + 1], positions[anchorIndex * 3 + 2]];
  for (const { role, start, count, ref } of ranges) {
    const c = new THREE.Color(ref);
    (table[role] ??= []).push({
      start, count, ref: [c.r, c.g, c.b], anchor,
      colors: colors.slice(start * 3, (start + count) * 3),
      positions: positions.slice(start * 3, (start + count) * 3),
    });
  }
  geometry.userData.tintRoles = table;
  return geometry;
}

const target = new THREE.Color();

/**
 * Recolour every `role` range under `root`. `hex === null` restores the built colour.
 * `visible === false` collapses the range to one point (zero-area triangles draw nothing).
 * Geometry shared by several meshes (e.g. both legs) is only rewritten once.
 */
export function applyRole(root: THREE.Object3D, role: TintRole, hex: number | null, visible = true): void {
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || seen.has(mesh.geometry)) return;
    seen.add(mesh.geometry);
    const table = mesh.geometry.userData.tintRoles as RoleTable | undefined;
    const list = table?.[role];
    if (!list) return;
    const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = colorAttr.array as Float32Array;
    const positions = posAttr.array as Float32Array;
    let moved = false;
    for (const range of list) {
      const base = range.start * 3;
      if (hex === null) colors.set(range.colors, base);
      else {
        target.setHex(hex);
        const k = [target.r / Math.max(0.02, range.ref[0]), target.g / Math.max(0.02, range.ref[1]), target.b / Math.max(0.02, range.ref[2])];
        for (let i = 0; i < range.count * 3; i++) colors[base + i] = Math.min(1, range.colors[i] * k[i % 3]);
      }
      const collapsed = positions[base] === positions[base + 3] && positions[base + 1] === positions[base + 4]
        && positions[base + 2] === positions[base + 5];
      if (visible && collapsed) {
        positions.set(range.positions, base);
        moved = true;
      } else if (!visible && !collapsed) {
        for (let i = 0; i < range.count; i++) positions.set(range.anchor, base + i * 3);
        moved = true;
      }
    }
    colorAttr.needsUpdate = true;
    if (moved) {
      posAttr.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  });
}

/** Apply all unit tiers to a unit model built with tagged parts. Unknown roles are ignored. */
export function applyUnitTiers(root: THREE.Object3D, tiers: UnitTiers): void {
  applyRole(root, 'axe', TOOL_TINT[clampTier(tiers.wood, 3)]);
  applyRole(root, 'pick', TOOL_TINT[clampTier(tiers.mining, 3)]);
  applyRole(root, 'sickle', TOOL_TINT[clampTier(tiers.farming, 3)]);
  const armor = ARMOR_TINT[clampTier(tiers.armor, 3)];
  applyRole(root, 'armor', armor);
  applyRole(root, 'jerkin', armor, armor !== null);
  const line = clampTier(tiers.line, 2);
  applyRole(root, 'trim', TRIM_TINT[line]);
  applyRole(root, 'rim', TRIM_TINT[line]);
  applyRole(root, 'crest', CREST_TINT[line], line > 0);
}

function clampTier(tier: number, max: number): number {
  return Number.isFinite(tier) ? Math.max(0, Math.min(max, Math.trunc(tier))) : 0;
}

/** Scale the existing load mesh volume to match its researched capacity, with no extra draws. */
export function applyCarryCapacity(root: THREE.Object3D, capacities: Record<ResourceType, number>, base: number): void {
  for (const resource of ['wood', 'food', 'gold', 'stone'] as const) {
    const mesh = root.getObjectByName(`carry-${resource}`);
    mesh?.scale.setScalar(Math.cbrt(capacities[resource] / base));
  }
}

/** Respect the live in-game preference and the OS preference. */
export function prefersReducedMotion(): boolean {
  if (currentSettings().reducedMotion) return true;
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Seconds a research-complete shimmer lasts. */
export const SHIMMER_SECONDS = 0.9;
const GOLD = new THREE.Color(0xf2c14e);

/**
 * Golden emissive pulse over a unit's own materials, driven by the unit's pose clock.
 * `start()` arms it; `update(time)` must be called each frame with the same clock the pose uses.
 * Reduced motion: start() does nothing.
 */
export class Shimmer {
  private startAt: number | null = null;
  private armed = false;
  private active = false;
  constructor(private readonly materials: THREE.MeshLambertMaterial[]) {}

  start(): void {
    if (prefersReducedMotion()) return;
    this.armed = true;
  }

  update(time: number): void {
    if (prefersReducedMotion()) {
      this.armed = false;
      this.startAt = null;
      if (this.active) for (const m of this.materials) m.emissive.setRGB(0, 0, 0);
      this.active = false;
      return;
    }
    if (this.armed) {
      this.startAt = time;
      this.armed = false;
    }
    if (this.startAt === null) return;
    const k = (time - this.startAt) / SHIMMER_SECONDS;
    if (!(k >= 0 && k < 1)) {
      this.startAt = null;
      if (this.active) for (const m of this.materials) m.emissive.setRGB(0, 0, 0);
      this.active = false;
      return;
    }
    // Two soft pulses, fading out; peak about 35% gold so the unit's colours stay readable.
    const strength = 0.35 * Math.sin(k * Math.PI) * (0.6 + 0.4 * Math.sin(k * Math.PI * 4));
    for (const m of this.materials) m.emissive.copy(GOLD).multiplyScalar(Math.max(0, strength));
    this.active = true;
  }
}

/** Distinct Lambert materials under `root` that the avatar owns (safe to give an emissive). */
export function ownedLambert(root: THREE.Object3D): THREE.MeshLambertMaterial[] {
  const out = new Set<THREE.MeshLambertMaterial>();
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) if ((m as THREE.MeshLambertMaterial).isMeshLambertMaterial && m.userData.owned) out.add(m as THREE.MeshLambertMaterial);
  });
  return [...out];
}
