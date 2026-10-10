import { BUILDINGS, type BuildingSpec } from '../core/buildings';
import type { BuildingKind, PlacementCheck, ResourceType, Stockpile } from '../core/types';

/** Resources in display order (top bar, cost lines). */
export const RESOURCE_ORDER: readonly ResourceType[] = ['food', 'wood', 'gold', 'stone'];

/**
 * Build-menu hotkeys (KeyboardEvent.code). Chosen not to clash with the RTS keys
 * (A all, T train, E explore, F first person, R rotate while placing, "." scout).
 * The alphabet is full, so the M8 buildings use J and Shift chords: "Shift+KeyM" means
 * Shift+M (Market next to the Mining Camp's M; the Academy pairs with the Forge's J).
 */
export const BUILD_HOTKEYS: Partial<Record<BuildingKind, string>> = {
  house: 'KeyH',
  storehouse: 'KeyS',
  granary: 'KeyG',
  miningCamp: 'KeyM',
  farm: 'KeyP',
  barracks: 'KeyB',
  archeryRange: 'KeyY',
  stable: 'KeyK',
  watchTower: 'KeyO',
  palisade: 'KeyL',
  stoneWall: 'KeyN',
  gate: 'KeyI',
  forge: 'KeyJ',
  market: 'Shift+KeyM',
  academy: 'Shift+KeyJ',
  temple: 'Shift+KeyO',
  dock: 'Shift+KeyK',
};

const SHIFT = 'Shift+';

/** Split a hotkey into its KeyboardEvent.code and whether it needs Shift. */
export function parseHotkey(key: string): { code: string; shift: boolean } {
  return key.startsWith(SHIFT) ? { code: key.slice(SHIFT.length), shift: true } : { code: key, shift: false };
}

/** Distinct KeyboardEvent.codes the build menu listens to. */
export function buildHotkeyCodes(): string[] {
  return [...new Set(Object.values(BUILD_HOTKEYS).map((k) => parseHotkey(k!).code))];
}

/** Kinds shown in the villager build menu, in BUILDINGS order. */
export function buildableKinds(table: Record<BuildingKind, Pick<BuildingSpec, 'buildable'>> = BUILDINGS): BuildingKind[] {
  return (Object.keys(table) as BuildingKind[]).filter((k) => table[k].buildable);
}

/**
 * The building a key builds, if any. With Shift held a Shift chord wins; otherwise Shift+key
 * still builds the plain key's kind (as it always has).
 */
export function kindForKey(code: string, shift = false): BuildingKind | null {
  const entries = Object.entries(BUILD_HOTKEYS) as [BuildingKind, string][];
  if (shift) for (const [kind, key] of entries) if (key === SHIFT + code) return kind;
  for (const [kind, key] of entries) if (key === code) return kind;
  return null;
}

/** Label for a key code: 'KeyH' → 'H', 'Shift+KeyM' → '⇧M'. */
export function keyLabel(code: string | undefined): string {
  if (!code) return '';
  const { code: c, shift } = parseHotkey(code);
  return `${shift ? '⇧' : ''}${c.replace(/^Key|^Digit/, '')}`;
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

/** What a complete building does, for the building panel. `occupants` is how many villagers are inside. */
export function buildingRole(kind: BuildingKind, food?: number, farmFood?: number, occupants?: number): string {
  const spec = BUILDINGS[kind];
  if (kind === 'farm') {
    if (food === undefined) return 'Farm';
    return food <= 0 ? 'Exhausted — reseed with villagers' : `Food ${Math.floor(food)}${farmFood ? `/${farmFood}` : ''}`;
  }
  const parts: string[] = [];
  if (kind === 'dock') parts.push('Shoreline shipyard · Fishing, sea trade and transports');
  if (kind === 'temple') parts.push('Priests heal allies and recover relics for 30 gold/min');
  if (spec.popBonus) parts.push(`+${spec.popBonus} population`);
  if (spec.drop.length && kind !== 'townCenter') parts.push(`Drop site: ${spec.drop.join(', ')}`);
  if (spec.garrison) parts.push(`Shelter ${occupants ?? 0}/${spec.garrison}`);
  if (spec.attack) parts.push(spec.attack.arrows > 0 ? 'Ranged defence' : 'Fires when garrisoned');
  if (spec.line) parts.push('Blocks movement');
  if (spec.gate) parts.push('Opens for your units');
  return parts.join(' · ') || spec.name;
}

/** "12/15" population readout. */
export function popLabel(pop: number, popCap: number): string {
  return `${pop}/${popCap}`;
}
