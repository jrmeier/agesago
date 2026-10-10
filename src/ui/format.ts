import type { EntityId, ResourceType, Unit, UnitKind } from '../core/types';

type StatusUnit = Pick<Unit, 'state' | 'carry' | 'gatherType'>;

const GATHER_VERB: Record<ResourceType, string> = {
  wood: 'Chopping wood',
  food: 'Foraging food',
  gold: 'Mining gold',
  stone: 'Quarrying stone',
};

/** Singular / plural display names, in panel order. */
const UNIT_NAMES: Record<UnitKind, [string, string]> = {
  phalangiteGuard:['Phalangite Guard','Phalangite Guards'], legionary:['Legionary','Legionaries'], immortal:['Immortal','Immortals'], raider:['Raider','Raiders'],
  villager: ['Villager', 'Villagers'],
  scout: ['Scout', 'Scouts'],
  hoplite: ['Hoplite', 'Hoplites'],
  swordsman: ['Swordsman', 'Swordsmen'],
  slinger: ['Slinger', 'Slingers'],
  archer: ['Archer', 'Archers'],
  horseman: ['Horseman', 'Horsemen'],
  tradeCart: ['Trade Cart', 'Trade Carts'],
  priest: ['Priest', 'Priests'],
  deer: ['Deer', 'Deer'],
  boar: ['Boar', 'Boars'],
  sheep: ['Sheep', 'Sheep'],
};

/** Unit kinds the Explore command (button, E) applies to. */
const EXPLORERS: ReadonlySet<UnitKind> = new Set<UnitKind>(['scout', 'villager']);

/** Panel title for a selection of `count` villagers. */
export function unitName(count: number): string {
  return count === 1 ? 'Villager' : `${count} Villagers`;
}

/** Panel title for a selection: "Scout", "2 Scouts", "3 Villagers, 1 Scout". */
export function selectionName(kinds: readonly UnitKind[]): string {
  const groups = (Object.keys(UNIT_NAMES) as UnitKind[])
    .map((k) => [k, kinds.filter((x) => x === k).length] as const)
    .filter(([, n]) => n > 0);
  if (groups.length === 1 && groups[0][1] === 1) return UNIT_NAMES[groups[0][0]][0];
  return groups.map(([k, n]) => `${n} ${UNIT_NAMES[k][n === 1 ? 0 : 1]}`).join(', ');
}

/** Which portrait to show: the most common kind, earlier kinds (villagers first) winning ties. */
export function portraitKind(kinds: readonly UnitKind[]): UnitKind {
  let best: UnitKind = 'villager';
  let bestN = 0;
  for (const k of Object.keys(UNIT_NAMES) as UnitKind[]) {
    const n = kinds.filter((x) => x === k).length;
    if (n > bestN) [best, bestN] = [k, n];
  }
  return best;
}

/** Ids of the units the Explore command should send. */
export function explorerIds(units: readonly Pick<Unit, 'id' | 'kind'>[]): EntityId[] {
  return units.filter((u) => EXPLORERS.has(u.kind)).map((u) => u.id);
}

/** Show the Explore button when the selection holds at least one unit that can explore. */
export function showExplore(units: readonly Pick<Unit, 'kind'>[]): boolean {
  return units.some((u) => EXPLORERS.has(u.kind));
}

/** HUD readout for the explored share of the map, rounded down ("Explored 7%"). */
export function exploredLabel(fraction: number): string {
  const pct = Math.floor(Math.min(1, Math.max(0, fraction)) * 100 + 1e-9);
  return `Explored ${pct}%`;
}

/** Human label for a villager's state and load, e.g. "Chopping wood (6/10)", "Carrying gold", "Idle". */
export function statusLabel(u: StatusUnit, carryCap: number): string {
  const carry = u.carry && u.carry.amount > 0 ? u.carry : null;
  switch (u.state) {
    case 'gathering': {
      const type = carry?.type ?? u.gatherType;
      if (!type) return 'Gathering';
      return `${GATHER_VERB[type]} (${carry?.amount ?? 0}/${carryCap})`;
    }
    case 'toDrop':
      return carry ? `Carrying ${carry.type} (${carry.amount})` : 'Returning';
    case 'toNode':
      return u.gatherType ? `Going for ${u.gatherType}` : 'Moving';
    case 'moving':
      return carry ? `Moving · ${carry.amount} ${carry.type}` : 'Moving';
    case 'exploring':
      return 'Exploring';
    case 'toBuild':
      return 'Going to build';
    case 'building':
      return 'Building';
    case 'toShelter':
      return 'Running for shelter';
    case 'garrisoned':
      return 'Garrisoned';
    case 'attacking':
      return 'Attacking';
    case 'idle':
      return carry ? `Idle · ${carry.amount} ${carry.type}` : 'Idle';
  }
}

/** Status line for several villagers: the shared label, or counts per label (most common first). */
export function groupStatus(units: readonly StatusUnit[], carryCap: number): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    const label = statusLabel(u, carryCap).replace(/ \(.*\)$| · .*$/, '');
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (units.length === 1) return statusLabel(units[0], carryCap);
  if (counts.size === 1) return [...counts.keys()][0];
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} ${label.toLowerCase()}`)
    .join(', ');
}

/**
 * Train-button subtitle: cost (plus the T hotkey hint, except on touch) when idle, else
 * queue size and head progress.
 */
export function trainLabel(queue: number, progress: number, total: number, cost: number, touch = false): string {
  if (queue <= 0) return touch ? `${cost} food` : `${cost} food · T`;
  const pct = Math.floor(trainProgress(queue, progress, total) * 100);
  return `Training ${pct}%${queue > 1 ? ` · +${queue - 1} queued` : ''}`;
}

/** Head-of-queue progress 0..0.99 for the train ring; 0 when nothing is queued. */
export function trainProgress(queue: number, progress: number, total: number): number {
  if (queue <= 0 || total <= 0) return 0;
  return Math.min(0.99, Math.max(0, progress / total));
}

/** Stockpile number: whole units ("1,250"), then "12.3k", "123k", "1.2M" — always rounded down. */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);
  if (v < 10_000) return `${Math.floor(v / 1000)},${String(v % 1000).padStart(3, '0')}`;
  if (v < 100_000) return `${(Math.floor(v / 100) / 10).toFixed(1)}k`;
  if (v < 1_000_000) return `${Math.floor(v / 1000)}k`;
  return `${(Math.floor(v / 100_000) / 10).toFixed(1)}M`;
}
