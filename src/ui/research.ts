import type { CivId } from '../core/civilizations';
import { AGE_NAMES, TECHS, techsAt, type Age, type Stat, type TechId } from '../core/techs';
import type { BuildingSpec } from '../core/buildings';
import type { Building, BuildingKind, RejectReason, Stockpile, UnitKind } from '../core/types';
import { UNITS, type UnitSpec } from '../core/units';
import { productionOrder } from '../sim/productionQueue';
import { AGE_BUILDINGS_NEEDED } from '../sim/systems/research';
import { missingResources, shortfallText } from './build';
import { combatChips, queueView, type StatChip } from './military';

/**
 * Pure helpers for the research UI (M8-14) and the age HUD (M8-6): which techs a building
 * shows, why a tech or a kind is locked, the mixed research + training queue, and stat deltas.
 */

/** What the player knows that decides how tech tiles look. */
export interface TechView {
  civ?: CivId;
  age: Age;
  researched: ReadonlySet<TechId>;
  /** Techs queued at any of the player's buildings. */
  queued: ReadonlySet<TechId>;
  stock: Stockpile;
  /** Distinct completed buildings from the current age that count toward aging up. */
  ageBuildings: number;
  /** Buildings needed (defaults to AGE_BUILDINGS_NEEDED). */
  ageBuildingsNeeded?: number;
}

/** "Requires Town Age" when `minAge` is later than the player's age, else ''. */
export function ageLockText(minAge: Age | undefined, age: Age): string {
  return (minAge ?? 0) > age ? `Requires ${AGE_NAMES[minAge!]}` : '';
}

/** Plain words for why `tech` can't start (`block` comes from the sim's researchBlock). '' when it can. */
export function lockText(tech: TechId, block: RejectReason | null, v: TechView): string {
  if (!block) return '';
  const spec = TECHS[tech];
  switch (block) {
    case 'researched':
      return v.queued.has(tech) ? 'Queued' : 'Researched';
    case 'age': {
      const need = spec.ageUp !== undefined ? Math.max(spec.age, spec.ageUp - 1) : spec.age;
      return `Requires ${AGE_NAMES[need as Age]}`;
    }
    case 'requires': {
      const missing = spec.requires?.find((t) => !v.researched.has(t));
      if (missing) return `Requires ${TECHS[missing].name}`;
      if (spec.ageUp !== undefined) {
        const needed = v.ageBuildingsNeeded ?? AGE_BUILDINGS_NEEDED;
        return `Requires ${needed} ${AGE_NAMES[v.age]} building${needed === 1 ? '' : 's'} (${Math.min(v.ageBuildings, needed)}/${needed})`;
      }
      return 'Requires another tech';
    }
    case 'insufficient-resources':
    case 'insufficient-food':
      return shortfallText(missingResources(spec.cost, v.stock)) || 'Not enough resources';
    case 'busy':
      return 'Already advancing an age';
    default:
      return 'Unavailable';
  }
}

/**
 * Techs a building of `kind` lists, in table order: not researched, not queued (those are in the
 * queue strip), only the next age-up, and a chained tech only once its predecessor is researched
 * or queued (so "Requires Bronze Axe" shows while Bronze Axe runs).
 */
export function visibleTechs(kind: BuildingKind, v: Pick<TechView, 'age' | 'researched' | 'queued' | 'civ'>): TechId[] {
  return techsAt(kind).filter((t) => {
    const spec = TECHS[t];
    if (spec.civ && spec.civ !== v.civ) return false;
    if (v.researched.has(t) || v.queued.has(t)) return false;
    if (spec.ageUp !== undefined && spec.ageUp !== v.age + 1) return false;
    return !spec.requires || spec.requires.every((r) => v.researched.has(r) || v.queued.has(r));
  });
}

export interface TechEntry {
  tech: TechId;
  name: string;
  cost: Partial<Stockpile>;
  time: number;
  /** Hard lock (age, prerequisite, busy): clicking does nothing. */
  locked: boolean;
  /** Can't pay for it right now. */
  unaffordable: boolean;
  /** Why it is greyed ('' when it can start). */
  reason: string;
  ageUp: boolean;
}

/** One tile per visible tech at `kind`, with its lock state. */
export function techEntries(
  kind: BuildingKind,
  v: TechView,
  blockOf: (tech: TechId) => RejectReason | null
): TechEntry[] {
  return visibleTechs(kind, v).map((tech) => {
    const spec = TECHS[tech];
    const block = blockOf(tech);
    const unaffordable = block === 'insufficient-resources' || block === 'insufficient-food';
    return {
      tech,
      name: spec.name,
      cost: spec.cost,
      time: spec.time,
      locked: !!block && !unaffordable,
      unaffordable,
      reason: lockText(tech, block, v),
      ageUp: spec.ageUp !== undefined,
    };
  });
}

/** "25s", "1m 30s". */
export function timeLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/** Tooltip for a tech: name, description, cost and time, and the lock reason if any. */
export function techTip(tech: TechId, costText: string, reason = ''): string {
  const spec = TECHS[tech];
  return `${spec.name}: ${spec.description} ${costText} · ${timeLabel(spec.time)}.${reason ? ` ${reason}.` : ''}`;
}

export type QueueItem =
  | { type: 'tech'; tech: TechId; index: number }
  | { type: 'unit'; unit: UnitKind; index: number };

/** The queue strip follows the same FIFO order as production in the simulation. */
export function queueItems(b: Pick<Building, 'kind' | 'queue' | 'queueKinds' | 'progress' | 'research' | 'researchProgress' | 'productionQueue'>, trainingTime?: number): {
  items: QueueItem[];
  /** Progress 0..1 of the first item. */
  head: number;
} {
  const research = b.research ?? [];
  const units = b.queue > 0 ? queueView(b) : { kinds: [], head: 0 };
  let techIndex = 0;
  let unitIndex = 0;
  const items: QueueItem[] = productionOrder(b).map((kind) => kind === 'research'
    ? { type: 'tech', tech: research[techIndex], index: techIndex++ }
    : { type: 'unit', unit: units.kinds[unitIndex], index: unitIndex++ });
  const head = items[0]?.type === 'tech'
    ? Math.min(1, Math.max(0, (b.researchProgress ?? 0) / TECHS[research[0]].time))
    : trainingTime && trainingTime > 0 ? Math.min(1, Math.max(0, b.progress / trainingTime)) : units.head;
  return { items, head };
}

/** "Researching Bronze Axe 40%" / "Advancing to the Town Age 40%". */
export function researchLabel(tech: TechId, progress: number, queued: number): string {
  const spec = TECHS[tech];
  const pct = Math.floor(Math.min(1, Math.max(0, progress / spec.time)) * 100 + 1e-9);
  const what = spec.ageUp !== undefined ? `Advancing to the ${spec.name}` : `Researching ${spec.name}`;
  return `${what} ${pct}%${queued > 1 ? ` (+${queued - 1})` : ''}`;
}

/** "Iron Axe researched". */
export function researchedText(tech: TechId): string {
  return `${TECHS[tech].name} researched`;
}

/** "Entered the Town Age". */
export function agedUpText(age: Age): string {
  return `Entered the ${AGE_NAMES[age]}`;
}

/** Display a stat: whole numbers bare, others to one decimal. */
export function fmtStat(n: number): string {
  const r = Math.round(n * 10 + 1e-6) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "+2", "−1" or '' when unchanged. */
export function deltaText(value: number, base: number): string {
  const d = Math.round((value - base) * 10 + 1e-6) / 10;
  if (d === 0) return '';
  return d > 0 ? `+${fmtStat(d)}` : `−${fmtStat(-d)}`;
}

/** "5 (+2)" or "5". */
export function withDelta(value: number, base: number): string {
  const d = deltaText(value, base);
  return d ? `${fmtStat(value)} (${d})` : fmtStat(value);
}

/** "2/3 (+1/+1)" for melee/pierce pairs. */
function pairWithDelta(m: number, p: number, bm: number, bp: number): string {
  const text = `${fmtStat(m)}/${fmtStat(p)}`;
  const dm = deltaText(m, bm);
  const dp = deltaText(p, bp);
  return dm || dp ? `${text} (${dm || '+0'}/${dp || '+0'})` : text;
}

type StatFn = (stat: Stat, base: number) => number;

/** Attack / armour / range chips for a unit kind with its owner's upgrades applied ("5 (+2)"). */
export function upgradedUnitChips(spec: UnitSpec, stat: StatFn): StatChip[] {
  const up: UnitSpec = {
    ...spec,
    attack: { melee: stat('attack.melee', spec.attack.melee), pierce: stat('attack.pierce', spec.attack.pierce) },
    armor: { melee: stat('armor.melee', spec.armor.melee), pierce: stat('armor.pierce', spec.armor.pierce) },
    range: stat('range', spec.range),
  };
  const ranged = !!spec.projectile;
  const [atk, armor, range] = combatChips(up);
  const atkText = ranged ? withDelta(up.attack.pierce, spec.attack.pierce) : withDelta(up.attack.melee, spec.attack.melee);
  const out: StatChip[] = [
    { ...atk, text: atkText, title: atk.title.replace(/ \d+(\.\d+)?/, ` ${atkText}`) },
    {
      ...armor,
      text: pairWithDelta(up.armor.melee, up.armor.pierce, spec.armor.melee, spec.armor.pierce),
      title: `Armour: ${fmtStat(up.armor.melee)} melee / ${fmtStat(up.armor.pierce)} pierce`,
    },
  ];
  if (range) {
    const text = withDelta(up.range, spec.range);
    out.push({ ...range, text, title: `Range ${text}` });
  }
  return out;
}

/** Chips for a building that shoots (towers, Town Center): attack, range, armour. Empty otherwise. */
export function upgradedBuildingChips(spec: Pick<BuildingSpec, 'attack' | 'armor'>, stat: StatFn): StatChip[] {
  if (!spec.attack) return [];
  const atk = withDelta(stat('attack.pierce', spec.attack.pierce), spec.attack.pierce);
  const range = withDelta(stat('range', spec.attack.range), spec.attack.range);
  const arrows = stat('arrows', spec.attack.arrows);
  const am = stat('armor.melee', spec.armor.melee);
  const ap = stat('armor.pierce', spec.armor.pierce);
  return [
    { icon: '#i-st-pierce', text: atk, title: `Pierce attack ${atk}, ${fmtStat(arrows)} arrow${arrows === 1 ? '' : 's'}` },
    { icon: '#i-st-armor', text: pairWithDelta(am, ap, spec.armor.melee, spec.armor.pierce), title: `Armour: ${fmtStat(am)} melee / ${fmtStat(ap)} pierce` },
    { icon: '#i-st-range', text: range, title: `Range ${range}` },
  ];
}

/** Techs that open up when the player reaches `age` (not age-ups), for the "new" pip. */
export function techsNewAt(age: Age): TechId[] {
  return (Object.keys(TECHS) as TechId[]).filter((t) => TECHS[t].age === age && TECHS[t].ageUp === undefined);
}

/** Minimum age for a unit kind (default Village). */
export function unitAge(kind: UnitKind): Age {
  return UNITS[kind].age ?? 0;
}
