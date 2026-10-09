import type { ResourceType, Unit } from '../core/types';

type StatusUnit = Pick<Unit, 'state' | 'carry' | 'gatherType'>;

const GATHER_VERB: Record<ResourceType, string> = {
  wood: 'Chopping wood',
  food: 'Foraging food',
  gold: 'Mining gold',
};

/** Panel title for a selection of `count` villagers. */
export function unitName(count: number): string {
  return count === 1 ? 'Villager' : `${count} Villagers`;
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

/** Train-button subtitle: cost hint when idle, else queue size and head progress. */
export function trainLabel(queue: number, progress: number, total: number, cost: number): string {
  if (queue <= 0) return `${cost} 🍖 · T`;
  const pct = Math.min(99, Math.floor((progress / total) * 100));
  return `Training ${pct}%${queue > 1 ? ` · +${queue - 1} queued` : ''}`;
}
