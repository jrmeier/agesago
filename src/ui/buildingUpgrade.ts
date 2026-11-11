import { BUILDINGS, nextUpgrade, tierStats, type BuildingUpgradeSpec, type TierStats } from '../core/buildings';
import { TECHS, type Age, type TechId } from '../core/techs';
import type { Building, BuildingKind, EntityId, RejectReason, Stockpile } from '../core/types';
import { activeUpgrade, upgradeBlock } from '../sim/systems/buildingUpgrade';
import type { World } from '../sim/World';
import { canAfford, missingResources, shortfallText } from './build';
import { ageLockText, fmtStat } from './research';

/**
 * Pure helpers for the building upgrade tile (M14-3): what the next tier costs and changes, why
 * it can't start, the progress label while it runs, and which selected buildings one press
 * upgrades. The sim's `upgradeBlock` (systems/buildingUpgrade.ts) decides; these only word it.
 */

/** Lock text on train / research tiles while their building upgrades. */
export const UPGRADING_TEXT = 'Upgrading';

/** One before → after line on the upgrade tile. */
export interface UpgradeStatRow {
  label: string;
  before: string;
  after: string;
}

/** Each stat the tile can compare: label and how to read it from a tier. Rows only show when it changes. */
const STAT_ROWS: readonly { label: string; value: (kind: BuildingKind, t: TierStats) => string }[] = [
  { label: 'HP', value: (k, t) => fmtStat(Math.round(BUILDINGS[k].hp * t.hpMul)) },
  {
    label: 'Armour',
    value: (k, t) => `${fmtStat(BUILDINGS[k].armor.melee + t.armorMelee)}/${fmtStat(BUILDINGS[k].armor.pierce + t.armorPierce)}`,
  },
  { label: 'Attack', value: (k, t) => fmtStat((BUILDINGS[k].attack?.pierce ?? 0) + t.attack) },
  { label: 'Arrows', value: (k, t) => fmtStat((BUILDINGS[k].attack?.arrows ?? 0) + t.arrows) },
  { label: 'Range', value: (k, t) => fmtStat((BUILDINGS[k].attack?.range ?? 0) + t.range) },
  { label: 'Pop', value: (k, t) => `+${fmtStat(BUILDINGS[k].popBonus + t.popBonus)}` },
  { label: 'Garrison', value: (k, t) => fmtStat((BUILDINGS[k].garrison ?? 0) + t.garrison) },
  // M14-2 military level 2: units train `trainSpeed` times faster, shown as a speed percentage.
  { label: 'Train speed', value: (_k, t) => `${Math.round(t.trainSpeed * 100)}%` },
];

/** Base-table stats (before research) of a `kind` building at `tier` vs the next tier; only rows that change. */
export function upgradeStatRows(kind: BuildingKind, tier = 0): UpgradeStatRow[] {
  const spec = nextUpgrade(kind, tier);
  if (!spec) return [];
  const now = tierStats(kind, tier);
  const next = tierStats(kind, spec.tier);
  return STAT_ROWS.map((r) => ({ label: r.label, before: r.value(kind, now), after: r.value(kind, next) })).filter(
    (r) => r.before !== r.after
  );
}

/** "HP 550 → 825 · Pop +5 → +10". */
export function statRowsText(rows: readonly UpgradeStatRow[]): string {
  return rows.map((r) => `${r.label} ${r.before} → ${r.after}`).join(' · ');
}

/** What the lock text needs about the local player. */
export interface UpgradeView {
  age: Age;
  researched: ReadonlySet<TechId>;
  stock: Stockpile;
}

/** Plain words for why `spec` can't start (`block` from the sim's upgradeBlock), '' when it can. */
export function upgradeLockText(spec: BuildingUpgradeSpec, block: RejectReason | null, v: UpgradeView, upgrading = false): string {
  switch (block) {
    case null:
      return '';
    case 'age':
      return ageLockText(spec.age, v.age) || 'Requires a later age';
    case 'requires': {
      const missing = spec.requires?.find((t) => !v.researched.has(t));
      return missing ? `Requires ${TECHS[missing].name}` : 'Requires another tech';
    }
    case 'insufficient-resources':
      return shortfallText(missingResources(spec.cost, v.stock)) || 'Not enough resources';
    case 'busy':
      return upgrading ? UPGRADING_TEXT : 'Busy: empty the queue first';
    case 'max-tier':
      return 'Fully upgraded';
    default:
      return 'Unavailable';
  }
}

export interface UpgradeEntry {
  spec: BuildingUpgradeSpec;
  /** Hard lock (age, prerequisite, busy): pressing does nothing. */
  locked: boolean;
  unaffordable: boolean;
  /** Why it is greyed ('' when it can start). */
  reason: string;
  rows: UpgradeStatRow[];
}

/** The upgrade tile for `b` (null when it has no next tier, e.g. fully upgraded). */
export function upgradeEntry(
  b: Pick<Building, 'kind' | 'tier' | 'upgrading'>,
  block: RejectReason | null,
  v: UpgradeView
): UpgradeEntry | null {
  const spec = nextUpgrade(b.kind, b.tier);
  if (!spec) return null;
  const unaffordable = block === 'insufficient-resources';
  return {
    spec,
    locked: !!block && !unaffordable,
    unaffordable,
    reason: upgradeLockText(spec, block, v, !!b.upgrading),
    rows: upgradeStatRows(b.kind, b.tier),
  };
}

/** "Upgrading to Large House 40%". */
export function upgradeLabel(b: Pick<Building, 'kind' | 'upgrading'>): string {
  const spec = activeUpgrade(b as Building);
  if (!spec || !b.upgrading) return '';
  return `Upgrading to ${spec.title} ${Math.floor(upgradeFraction(b) * 100 + 1e-9)}%`;
}

/** Progress 0..1 of the upgrade `b` is running (0 when none). */
export function upgradeFraction(b: Pick<Building, 'kind' | 'upgrading'>): number {
  const spec = activeUpgrade(b as Building);
  if (!spec || !b.upgrading || spec.time <= 0) return 0;
  return Math.min(1, Math.max(0, b.upgrading.progress / spec.time));
}

/**
 * Which buildings one press of the tile upgrades: every selected building of the same kind and
 * tier as `lead` that can start now (cost aside), while the stockpile still covers one more.
 * One command each, in selection order.
 */
export function upgradeTargets(
  lead: Pick<Building, 'id' | 'kind' | 'tier'>,
  selected: Iterable<Pick<Building, 'id' | 'kind' | 'tier'>>,
  blockIgnoringCost: (id: EntityId) => RejectReason | null,
  stock: Stockpile
): EntityId[] {
  const spec = nextUpgrade(lead.kind, lead.tier);
  if (!spec) return [];
  const left: Stockpile = { ...stock };
  const out: EntityId[] = [];
  for (const b of selected) {
    if (b.kind !== lead.kind || (b.tier ?? 0) !== (lead.tier ?? 0) || out.includes(b.id)) continue;
    if (blockIgnoringCost(b.id) || !canAfford(spec.cost, left)) continue;
    for (const [type, amount] of Object.entries(spec.cost) as [keyof Stockpile, number][]) left[type] -= amount;
    out.push(b.id);
  }
  return out;
}

/** Tooltip: "Large House: HP 550 → 825 · Pop +5 → +10. 60 wood, 20 stone · 20s. Requires Town Age." */
export function upgradeTip(e: UpgradeEntry, costText: string, time: string, key: string): string {
  const stats = statRowsText(e.rows);
  return `Upgrade to ${e.spec.title}${key ? ` (${key})` : ''}: ${stats ? `${stats}. ` : ''}${costText} · ${time}.${e.reason ? ` ${e.reason}.` : ''}`;
}

/**
 * Start the upgrade on every selected own building of the lead's kind that can (one command
 * each). The lead is the first selected building `world` shows a panel for. Returns how many.
 */
export function upgradeSelected(world: World, ids: Iterable<EntityId>): number {
  const local = world.localPlayer;
  const own = [...ids].flatMap((id) => world.buildings.get(id) ?? []).filter((b) => b.owner === local && b.complete);
  const lead = own[0];
  if (!lead || !nextUpgrade(lead.kind, lead.tier)) return 0;
  const targets = upgradeTargets(lead, own, (id) => upgradeBlock(world, world.buildings.get(id), local, true), world.stock);
  // Nothing can start: send the lead anyway so the sim's rejection shakes the tile / plays the cue.
  for (const id of targets.length ? targets : [lead.id]) world.dispatch({ type: 'upgradeBuilding', buildingId: id });
  return targets.length;
}

/** Cancel the upgrade running on every selected own building. */
export function cancelSelectedUpgrades(world: World, ids: Iterable<EntityId>): void {
  for (const id of ids) {
    const b = world.buildings.get(id);
    if (b?.owner === world.localPlayer && b.upgrading) world.dispatch({ type: 'cancelUpgrade', buildingId: id });
  }
}
