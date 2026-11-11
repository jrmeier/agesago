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

/** Reach of every hero aura, from the hero's edge. */
export const HERO_AURA_RADIUS = 8;
/** Military unit classes ("soldiers"). */
const SOLDIERS: ModTarget[] = ['class:infantry', 'class:archer', 'class:cavalry'];

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
  // ---- Hero auras (M16-6): one per civilization's hero, radius HERO_AURA_RADIUS, own units only. ----
  leonidasHoldTheLine: {
    name: 'Hold the Line',
    description: `Your soldiers within ${HERO_AURA_RADIUS} of Leonidas get +2 melee and pierce armour.`,
    source: { unit: 'leonidas' },
    radius: HERO_AURA_RADIUS,
    affects: SOLDIERS,
    players: 'own',
    modifiers: [
      { target: 'allUnits', stat: 'armor.melee', op: 'add', value: 2 },
      { target: 'allUnits', stat: 'armor.pierce', op: 'add', value: 2 },
    ],
  },
  scipioDrill: {
    name: 'Drilled Legions',
    description: `Your infantry within ${HERO_AURA_RADIUS} of Scipio attack 20% faster.`,
    source: { unit: 'scipio' },
    radius: HERO_AURA_RADIUS,
    affects: ['class:infantry'],
    players: 'own',
    modifiers: [{ target: 'class:infantry', stat: 'reload', op: 'mul', value: 1 / 1.2 }],
  },
  cyrusRoyalEscort: {
    name: 'Royal Escort',
    description: `Your cavalry within ${HERO_AURA_RADIUS} of Cyrus move 15% faster.`,
    source: { unit: 'cyrus' },
    radius: HERO_AURA_RADIUS,
    affects: ['class:cavalry'],
    players: 'own',
    modifiers: [{ target: 'class:cavalry', stat: 'speed', op: 'mul', value: 1.15 }],
  },
  vercingetorixWarCry: {
    name: 'War Cry',
    description: `Your infantry and cavalry within ${HERO_AURA_RADIUS} of Vercingetorix get +3 melee attack.`,
    source: { unit: 'vercingetorix' },
    radius: HERO_AURA_RADIUS,
    affects: ['class:infantry', 'class:cavalry'],
    players: 'own',
    modifiers: [{ target: 'allUnits', stat: 'attack.melee', op: 'add', value: 3 }],
  },
} satisfies Record<string, AuraSpec>;

export type AuraId = keyof typeof table;
export const AURAS = table as Record<AuraId, AuraSpec>;
export const AURA_IDS = Object.keys(AURAS) as AuraId[];
