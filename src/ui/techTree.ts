import type { CivId } from '../core/civilizations';
import { BUILDINGS } from '../core/buildings';
import { AGE_NAMES, TECHS, TECH_IDS, type Age, type TechId } from '../core/techs';
import type { BuildingKind, UnitKind } from '../core/types';
import { UNITS } from '../core/units';
import { ageBuildingsNeeded } from '../sim/systems/research';
import { ageLockText, lockText, type TechView } from './research';

/**
 * Pure model for the tech-tree screen (M13-4): every building, unit and tech the player's
 * civilization has, grouped by age, with its state and what it unlocks. Built only from the core
 * tables plus what the player has, so it follows data changes.
 */

/** done = built / researched / trainable already; queued = tech in a queue. */
export type TreeState = 'done' | 'queued' | 'available' | 'locked';

export interface TreeInput {
  civ?: CivId;
  age: Age;
  researched: ReadonlySet<TechId>;
  queued?: ReadonlySet<TechId>;
  /** Completed building kinds the player owns. */
  built: ReadonlySet<BuildingKind>;
  /** Distinct completed buildings from the current age that count toward aging up. */
  ageBuildings?: number;
}

export interface TreeEntry {
  type: 'building' | 'unit' | 'tech';
  id: string;
  name: string;
  age: Age;
  state: TreeState;
  /** Word for the state badge: Built, Researched, Queued, Available, Locked. */
  badge: string;
  /** Why it is locked ('' otherwise). */
  reason: string;
  /** Where it comes from: "Trained at Barracks", "Researched at Forge". */
  source: string;
  /** What it leads to, in plain names. */
  unlocks: string[];
}

export interface TreeAge {
  age: Age;
  name: string;
  current: boolean;
  buildings: TreeEntry[];
  units: TreeEntry[];
  techs: TreeEntry[];
}

const AGES: Age[] = [0, 1, 2, 3];

/** Buildings the player can have: every kind the villager build menu offers, plus the Town Center. */
export function treeBuildings(): BuildingKind[] {
  return (Object.keys(BUILDINGS) as BuildingKind[]).filter((k) => BUILDINGS[k].buildable || k === 'townCenter');
}

/** Trainable units for `civ`: shared units plus its own unique unit. */
export function treeUnits(civ?: CivId): UnitKind[] {
  return (Object.keys(UNITS) as UnitKind[]).filter((k) => {
    const spec = UNITS[k];
    return spec.trainedAt !== null && (!spec.civ || spec.civ === civ);
  });
}

/** Techs for `civ`: shared techs plus its own. */
export function treeTechs(civ?: CivId): TechId[] {
  return TECH_IDS.filter((t) => !TECHS[t].civ || TECHS[t].civ === civ);
}

/** The age a tech is listed under: its minimum age (age-ups sit in the age they leave). */
export function techAge(tech: TechId): Age {
  const spec = TECHS[tech];
  return spec.ageUp !== undefined ? (Math.max(spec.age, spec.ageUp - 1) as Age) : spec.age;
}

function techState(tech: TechId, input: TreeInput, view: TechView): { state: TreeState; reason: string } {
  const spec = TECHS[tech];
  if (input.researched.has(tech)) return { state: 'done', reason: '' };
  if (input.queued?.has(tech)) return { state: 'queued', reason: '' };
  if (spec.ageUp !== undefined && spec.ageUp <= input.age) return { state: 'done', reason: '' };
  if (techAge(tech) > input.age) return { state: 'locked', reason: lockText(tech, 'age', view) };
  const missing = spec.requires?.some((t) => !input.researched.has(t));
  const ageShort = spec.ageUp !== undefined && view.ageBuildings < (view.ageBuildingsNeeded ?? 0);
  if (missing || ageShort) return { state: 'locked', reason: lockText(tech, 'requires', view) };
  if (!input.built.has(spec.at)) return { state: 'locked', reason: `Requires ${BUILDINGS[spec.at].name}` };
  return { state: 'available', reason: '' };
}

const BADGE: Record<TreeEntry['type'], Record<TreeState, string>> = {
  building: { done: 'Built', queued: 'Queued', available: 'Available', locked: 'Locked' },
  unit: { done: 'Trainable', queued: 'Queued', available: 'Trainable', locked: 'Locked' },
  tech: { done: 'Researched', queued: 'Queued', available: 'Available', locked: 'Locked' },
};

function entry(type: TreeEntry['type'], id: string, name: string, age: Age, state: TreeState, reason: string, source: string, unlocks: string[]): TreeEntry {
  return { type, id, name, age, state, badge: BADGE[type][state], reason, source, unlocks };
}

/** Every building, unit and tech for the player's civilization, by age. */
export function techTreeModel(input: TreeInput): TreeAge[] {
  const techs = treeTechs(input.civ);
  const units = treeUnits(input.civ);
  const view: TechView = {
    civ: input.civ,
    age: input.age,
    researched: input.researched,
    queued: input.queued ?? new Set(),
    stock: { wood: 0, food: 0, gold: 0, stone: 0 },
    ageBuildings: input.ageBuildings ?? 0,
    ageBuildingsNeeded: ageBuildingsNeeded(input.age),
  };

  const buildingEntries = treeBuildings().map((kind) => {
    const spec = BUILDINGS[kind];
    const age = spec.age ?? 0;
    const reason = ageLockText(age, input.age);
    const state: TreeState = input.built.has(kind) ? 'done' : reason ? 'locked' : 'available';
    const unlocks = [
      ...units.filter((u) => UNITS[u].trainedAt === kind).map((u) => UNITS[u].name),
      ...techs.filter((t) => TECHS[t].at === kind && TECHS[t].ageUp === undefined).map((t) => TECHS[t].name),
    ];
    return entry('building', kind, spec.name, age, state, reason, kind === 'townCenter' ? 'Starting building' : 'Built by villagers', unlocks);
  });

  const unitEntries = units.map((kind) => {
    const spec = UNITS[kind];
    const at = spec.trainedAt!;
    const age = spec.age ?? 0;
    const reason = ageLockText(age, input.age) || (input.built.has(at) ? '' : `Requires ${BUILDINGS[at].name}`);
    const lines = techs.filter((t) => TECHS[t].line?.unit === kind).map((t) => TECHS[t].line!);
    lines.sort((a, b) => a.tier - b.tier);
    return entry('unit', kind, spec.name, age, reason ? 'locked' : 'done', reason, `Trained at ${BUILDINGS[at].name}`,
      lines.map((l) => `Upgrades to ${l.title}`));
  });

  const techEntries = techs.map((tech) => {
    const spec = TECHS[tech];
    const { state, reason } = techState(tech, input, view);
    const unlocks = techs.filter((t) => TECHS[t].requires?.includes(tech)).map((t) => TECHS[t].name);
    if (spec.ageUp !== undefined) unlocks.unshift(`the ${AGE_NAMES[spec.ageUp]}`);
    if (spec.line) unlocks.push(`${UNITS[spec.line.unit].name} line → ${spec.line.title}`);
    if (spec.upgrade) unlocks.push(`${BUILDINGS[spec.upgrade.kind].name} → ${spec.upgrade.title}`);
    return entry('tech', tech, spec.name, techAge(tech), state, reason, `Researched at ${BUILDINGS[spec.at].name}`, unlocks);
  });

  return AGES.map((age) => ({
    age,
    name: AGE_NAMES[age],
    current: age === input.age,
    buildings: buildingEntries.filter((e) => e.age === age),
    units: unitEntries.filter((e) => e.age === age),
    techs: techEntries.filter((e) => e.age === age),
  }));
}
