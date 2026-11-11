import type { BuildingKind, UnitKind } from './types';
import type { Modifier, ModTarget, Stat } from './techs';

/**
 * Aura data table (M16-4), modelled on 0 A.D.'s Auras component: a source entity grants
 * modifiers (and optionally healing) to matching entities near it, everywhere, or only while
 * garrisoned inside it. Resolved by the sim's aura system (src/sim/systems/auras.ts).
 *
 * Stacking: one aura id counts once per affected entity, however many sources grant it.
 */

/** Where an aura reaches: a radius in world units (from the source's edge), the whole map, or its garrison. */
export type AuraRange = number | 'global' | 'garrison';

export interface AuraSpec {
  name: string;
  /** One line for tooltips, in plain words. */
  description: string;
  /** Unit or building kind that emits it (informational; sources list ids in their spec's `auras`). */
  source: { unit: UnitKind } | { building: BuildingKind };
  radius: AuraRange;
  /** Who it reaches, as tech targets: a kind, `class:X`, 'allUnits' or 'allBuildings'. */
  affects: ModTarget[];
  /** 'own': the source owner's entities only; 'allies': the owner and teammates. */
  players: 'own' | 'allies';
  /** Stat changes while inside; each modifier's own target must also match. */
  modifiers: Modifier[];
  /** Hit points restored per second to damaged affected units. */
  heal?: number;
}

const GATHER_STATS: Stat[] = ['gather.food', 'gather.wood', 'gather.gold', 'gather.stone', 'gather.farm'];

const table = {
  templeHealing: {
    name: 'Healing Grounds',
    description: 'Heals your units within 6 of the temple by 1 HP per second.',
    source: { building: 'temple' },
    radius: 6,
    affects: ['allUnits'],
    players: 'own',
    modifiers: [],
    heal: 1,
  },
  townCenterWork: {
    name: 'Town Center Bustle',
    description: 'Your villagers within 10 of a Town Center gather 5% faster.',
    source: { building: 'townCenter' },
    radius: 10,
    affects: ['villager'],
    players: 'own',
    modifiers: GATHER_STATS.map((stat): Modifier => ({ target: 'villager', stat, op: 'mul', value: 1.05 })),
  },
} satisfies Record<string, AuraSpec>;

export type AuraId = keyof typeof table;
export const AURAS = table as Record<AuraId, AuraSpec>;
export const AURA_IDS = Object.keys(AURAS) as AuraId[];
