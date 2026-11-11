import type { CivId } from '../core/civilizations';
import { BUILDINGS } from '../core/buildings';
import { AGE_NAMES, TECHS, type Age, type TechId } from '../core/techs';
import type { Building, BuildingKind, EntityId, PlayerId, RejectReason, ResourceType, UnitKind } from '../core/types';
import { UNITS } from '../core/units';
import { ageBuildings, ageBuildingsNeeded } from '../sim/systems/research';
import type { World } from '../sim/World';
import { costEntries } from './build';
import { visibleTechs, type TechView } from './research';
import { treeBuildings, treeUnits } from './techTree';

/**
 * Pure helpers for upgrade hints (M13-5): which own buildings could start a tech right now (the
 * world badge and the panel mark), the age-progress chip in the top bar, and what a new age
 * unlocks (the age-up toast).
 */

/** Most techs a building may queue at once (mirrors the sim's MAX_RESEARCH_QUEUE). */
const MAX_QUEUE = 5;

/** What the tech tiles, badges and age chip need to know about `owner`. */
export function techViewOf(world: World, owner: PlayerId): TechView {
  const p = world.players.get(owner);
  const queued = new Set<TechId>();
  for (const b of world.buildings.values()) if (b.owner === owner) for (const t of b.research ?? []) queued.add(t);
  const age = p?.age ?? 0;
  return {
    age,
    researched: p?.researched ?? new Set(),
    queued,
    stock: world.stockOf(owner),
    civ: p?.player.civ,
    ageBuildings: ageBuildings(world, owner, age).length,
    ageBuildingsNeeded: ageBuildingsNeeded(age),
  };
}

/** Techs listed at `kind` that `blockOf` (the sim's researchBlock) lets start now, cost included. */
export function readyTechs(kind: BuildingKind, view: TechView, blockOf: (tech: TechId) => RejectReason | null): TechId[] {
  return visibleTechs(kind, view).filter((t) => blockOf(t) === null);
}

/** Could this one building accept a research order now (complete, queue not full or held by an age-up)? */
export function canQueueResearch(b: Pick<Building, 'complete' | 'research'>): boolean {
  if (!b.complete) return false;
  const q = b.research ?? [];
  return q.length < MAX_QUEUE && !q.some((t) => TECHS[t].ageUp !== undefined);
}

/**
 * Ids of `owner`'s buildings that get the "upgrade available" badge: complete, able to queue, and
 * of a kind with at least one ready tech. Each kind's techs are checked once, however many stand.
 */
export function badgedBuildings(
  buildings: Iterable<Pick<Building, 'id' | 'owner' | 'kind' | 'complete' | 'research'>>,
  owner: PlayerId,
  view: TechView,
  blockOf: (tech: TechId) => RejectReason | null
): EntityId[] {
  const ready = new Map<BuildingKind, boolean>();
  const out: EntityId[] = [];
  for (const b of buildings) {
    if (b.owner !== owner || !canQueueResearch(b)) continue;
    let ok = ready.get(b.kind);
    if (ok === undefined) ready.set(b.kind, (ok = readyTechs(b.kind, view, blockOf).length > 0));
    if (ok) out.push(b.id);
  }
  return out;
}

/** The age-up tech that leads out of `age` for `civ`, or null in the last age. */
export function nextAgeUp(age: Age, civ?: CivId): TechId | null {
  const found = (Object.keys(TECHS) as TechId[]).find(
    (t) => TECHS[t].ageUp === age + 1 && (!TECHS[t].civ || TECHS[t].civ === civ)
  );
  return found ?? null;
}

export interface AgeProgress {
  tech: TechId;
  /** The age it leads to. */
  next: Age;
  /** Distinct current-age buildings standing, capped at `needed`. */
  built: number;
  needed: number;
  /** Resources still missing, in stockpile order. */
  short: { type: ResourceType; amount: number }[];
  /** Advancing right now (queued or researching). */
  advancing: boolean;
  /** Everything is in place: it can start now. */
  ready: boolean;
}

/** Where the player stands on the way to the next age (null in the last age). */
export function ageProgress(view: TechView): AgeProgress | null {
  const tech = nextAgeUp(view.age, view.civ);
  if (!tech) return null;
  const spec = TECHS[tech];
  const needed = view.ageBuildingsNeeded ?? 2;
  const built = Math.min(view.ageBuildings, needed);
  const short = costEntries(spec.cost)
    .filter((e) => view.stock[e.type] < e.amount)
    .map((e) => ({ type: e.type, amount: Math.ceil(e.amount - view.stock[e.type]) }));
  const advancing = view.queued.has(tech);
  const prereq = !spec.requires || spec.requires.every((t) => view.researched.has(t));
  return {
    tech,
    next: spec.ageUp as Age,
    built,
    needed,
    short,
    advancing,
    ready: !advancing && prereq && built >= needed && short.length === 0,
  };
}

export interface ChipText {
  /** Desktop label: "Town Age · 1/2 buildings · need 120 food". */
  text: string;
  /** Phone label, two lines: "Town 1/2\n−120 food". */
  short: string;
  /** Tooltip and accessible name. */
  title: string;
}

/** Labels for the age-progress chip. */
export function ageChipText(p: AgeProgress): ChipText {
  const name = AGE_NAMES[p.next];
  const word = name.replace(/ Age$/, '');
  const need = p.short.map((s) => `${s.amount} ${s.type}`).join(', ');
  const counted = `${p.built}/${p.needed}`;
  if (p.advancing) {
    return { text: `Advancing to the ${name}`, short: `→ ${word}`, title: `Advancing to the ${name}. Click to see your Town Center.` };
  }
  if (p.ready) {
    return { text: `${name} ready`, short: `${word} ready`, title: `${name} ready: research it at your Town Center. Click to go there.` };
  }
  const parts = [`${counted} buildings`];
  if (need) parts.push(`need ${need}`);
  const shortParts = [counted];
  if (p.short.length) shortParts.push(p.short.map((s) => `−${s.amount} ${s.type}`).join(' '));
  const bldg = p.built < p.needed ? `Build ${p.needed} different ${AGE_NAMES[(p.next - 1) as Age]} buildings (${counted}). ` : '';
  return {
    text: `${name} · ${parts.join(' · ')}`,
    short: `${word} ${shortParts.join('\n')}`,
    title: `Next: ${name}. ${bldg}${need ? `Still need ${need}. ` : ''}Click to see your Town Center.`,
  };
}

export interface Unlocks {
  buildings: BuildingKind[];
  units: UnitKind[];
}

/** Buildings that can first be placed, and units first trained, in `age` (civ-only units for `civ`). Shares the tech tree's lists. */
export function ageUnlocks(age: Age, civ?: CivId): Unlocks {
  return {
    buildings: treeBuildings().filter((k) => (BUILDINGS[k].age ?? 0) === age && k !== 'townCenter'),
    units: treeUnits(civ).filter((k) => (UNITS[k].age ?? 0) === age),
  };
}

/** Ready techs for the panel mark: "Upgrade available: Bronze Axe, Horse Collar". */
export function readyTitle(techs: readonly TechId[]): string {
  return techs.length ? `Upgrade available: ${techs.map((t) => TECHS[t].name).join(', ')}` : '';
}

