import { BUILDINGS, type BuildingSpec } from '../core/buildings';
import type { BuildingKind, PlacementCheck, ResourceType, Stockpile } from '../core/types';

/** Resources in display order (top bar, cost lines). */
export const RESOURCE_ORDER: readonly ResourceType[] = ['food', 'wood', 'gold', 'stone'];

/**
 * Build-menu hotkeys (KeyboardEvent.code). Chosen not to clash with the RTS keys
 * (A all, T train, E explore, F first person, R rotate while placing, "." scout).
 */
export const BUILD_HOTKEYS: Partial<Record<BuildingKind, string>> = {
  house: 'KeyH',
  storehouse: 'KeyS',
  granary: 'KeyG',
  miningCamp: 'KeyM',
  farm: 'KeyP',
};

/** Kinds shown in the villager build menu, in BUILDINGS order. */
export function buildableKinds(table: Record<BuildingKind, Pick<BuildingSpec, 'buildable'>> = BUILDINGS): BuildingKind[] {
  return (Object.keys(table) as BuildingKind[]).filter((k) => table[k].buildable);
}

/** The building a key code builds, if any. */
export function kindForKey(code: string): BuildingKind | null {
  for (const [kind, key] of Object.entries(BUILD_HOTKEYS) as [BuildingKind, string][]) if (key === code) return kind;
  return null;
}

/** Label for a key code: 'KeyH' → 'H'. */
export function keyLabel(code: string | undefined): string {
  return code ? code.replace(/^Key|^Digit/, '') : '';
}

/** Non-zero cost entries in display order. */
export function costEntries(cost: Partial<Stockpile>): { type: ResourceType; amount: number }[] {
  return RESOURCE_ORDER.flatMap((type) => (cost[type] ? [{ type, amount: cost[type]! }] : []));
}

/** "60 wood", "275 wood · 100 stone", "Free". */
export function formatCost(cost: Partial<Stockpile>): string {
  const parts = costEntries(cost).map((e) => `${e.amount} ${e.type}`);
  return parts.length ? parts.join(' · ') : 'Free';
}

/** Resource types the stockpile is short of for `cost`, in display order. */
export function missingResources(cost: Partial<Stockpile>, stock: Stockpile): ResourceType[] {
  return costEntries(cost)
    .filter((e) => stock[e.type] < e.amount)
    .map((e) => e.type);
}

export function canAfford(cost: Partial<Stockpile>, stock: Stockpile): boolean {
  return missingResources(cost, stock).length === 0;
}

/** "Not enough wood", "Not enough wood and stone". */
export function shortfallText(missing: readonly ResourceType[]): string {
  if (!missing.length) return '';
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Not enough ${list}`;
}

const REASON_TEXT: Record<NonNullable<PlacementCheck['reason']>, string> = {
  water: 'Can’t build on water',
  slope: 'Too steep',
  unexplored: 'Unexplored',
  occupied: 'Blocked',
  'out-of-bounds': 'Off the map',
  'insufficient-resources': 'Not enough resources',
};

/**
 * Placement verdict for the ghost: the world's check, plus a local affordability check
 * (so the reason names the missing resource). Returns `{ ok, text }`; text is '' when ok.
 */
export function placementVerdict(
  check: PlacementCheck,
  cost: Partial<Stockpile>,
  stock: Stockpile
): { ok: boolean; text: string } {
  const missing = missingResources(cost, stock);
  if (check.ok && !missing.length) return { ok: true, text: '' };
  if (missing.length && (check.ok || check.reason === 'insufficient-resources')) {
    return { ok: false, text: shortfallText(missing) };
  }
  return { ok: false, text: check.reason ? REASON_TEXT[check.reason] : 'Can’t build here' };
}

/** "Under construction 42%" for foundations. */
export function constructionLabel(progress: number): string {
  const pct = Math.floor(Math.min(1, Math.max(0, progress)) * 100 + 1e-9);
  return `Under construction ${pct}%`;
}

/** What a complete building does, for the building panel. */
export function buildingRole(kind: BuildingKind, food?: number, farmFood?: number): string {
  const spec = BUILDINGS[kind];
  if (kind === 'farm') {
    if (food === undefined) return 'Farm';
    return food <= 0 ? 'Exhausted — reseed with villagers' : `Food ${Math.floor(food)}${farmFood ? `/${farmFood}` : ''}`;
  }
  const parts: string[] = [];
  if (spec.popBonus) parts.push(`+${spec.popBonus} population`);
  if (spec.drop.length && kind !== 'townCenter') parts.push(`Drop site: ${spec.drop.join(', ')}`);
  return parts.join(' · ') || spec.name;
}

/** "12/15" population readout. */
export function popLabel(pop: number, popCap: number): string {
  return `${pop}/${popCap}`;
}
