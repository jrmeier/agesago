import type { CivId } from '../core/civilizations';
import { unitLine, type TechId } from '../core/techs';
import type { Building, BuildingKind, Stance, Stockpile, Unit, UnitKind } from '../core/types';
import { isAnimal, UNITS, trainable, type UnitSpec } from '../core/units';
import { TRAIN_SLOT_KEYS } from '../input/hotkeys';
import { canAfford } from './build';

/** Stance buttons, in command-card order. */
export const STANCES: readonly { stance: Stance; label: string; hint: string }[] = [
  { stance: 'aggressive', label: 'Aggressive', hint: 'Chase and attack any enemy in sight' },
  { stance: 'defensive', label: 'Defensive', hint: 'Attack enemies nearby, then return' },
  { stance: 'standGround', label: 'Stand ground', hint: 'Hold position; attack only what is in range' },
  { stance: 'passive', label: 'Passive', hint: 'Never attack' },
];

/** Soldiers, excluding civilian units and wildlife. */
export function isMilitary(kind: UnitKind): boolean {
  return kind !== 'villager' && kind !== 'scout' && kind !== 'tradeCart' && kind !== 'priest' && !isAnimal(kind);
}

/** Shift-click / Shift+hotkey queues five. */
export function trainBatch(shift: boolean): number {
  return shift ? 5 : 1;
}

export interface TrainEntry {
  kind: UnitKind;
  name: string;
  cost: Partial<Stockpile>;
  /** KeyboardEvent.code of its slot, if it has one. */
  key: string | undefined;
  affordable: boolean;
}

/** One training-panel entry per unit the building can train, with its slot key and affordability. */
export function trainEntries(building: BuildingKind, stock: Stockpile, researched?: ReadonlySet<TechId>, civ?: CivId): TrainEntry[] {
  return trainable(building, civ).map((kind, i) => ({
    kind,
    // Unit-line upgrades rename what the building trains (Hoplite → Veteran Hoplite).
    name: researched ? unitLine(researched, kind).title : UNITS[kind].name,
    cost: UNITS[kind].cost,
    key: TRAIN_SLOT_KEYS[i],
    affordable: canAfford(UNITS[kind].cost, stock),
  }));
}

/** The unit a training slot key trains at `building`, if any. */
export function kindForSlotKey(building: BuildingKind, code: string, civ?: CivId): UnitKind | null {
  const i = (TRAIN_SLOT_KEYS as readonly string[]).indexOf(code);
  return i >= 0 ? (trainable(building, civ)[i] ?? null) : null;
}

/** Can this building show a training panel right now? */
export function canTrainAt(b: Pick<Building, 'kind' | 'complete'>): boolean {
  return b.complete && trainable(b.kind).length > 0;
}

export interface QueueView {
  kinds: UnitKind[];
  /** Head-of-queue progress 0..1. */
  head: number;
}

/** What the queue strip shows: queued kinds head first and the head's progress. */
export function queueView(b: Pick<Building, 'kind' | 'queue' | 'queueKinds' | 'progress'>): QueueView {
  const kinds = b.queueKinds?.length ? [...b.queueKinds] : Array.from({ length: b.queue }, () => trainable(b.kind)[0] ?? 'villager');
  const head = kinds.length ? Math.min(1, Math.max(0, b.progress / UNITS[kinds[0]].trainTime)) : 0;
  return { kinds, head };
}

/** Kinds by count, most common first (ties keep UNITS order). */
export function kindCounts(kinds: readonly UnitKind[]): [UnitKind, number][] {
  const order = Object.keys(UNITS) as UnitKind[];
  return order
    .map((k) => [k, kinds.filter((x) => x === k).length] as [UnitKind, number])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** "HP 42/55". */
export function hpLabel(hp: number, maxHp: number): string {
  return `HP ${Math.max(0, Math.ceil(hp))}/${Math.ceil(maxHp)}`;
}

/** Summed hit points of a selection (for the panel's health bar). */
export function totalHp(units: readonly Pick<Unit, 'hp' | 'maxHp'>[]): { hp: number; maxHp: number } {
  let hp = 0;
  let maxHp = 0;
  for (const u of units) {
    hp += Math.max(0, u.hp);
    maxHp += u.maxHp;
  }
  return { hp, maxHp };
}

export interface StatChip {
  /** Sprite id of the icon. */
  icon: string;
  text: string;
  title: string;
}

/** Attack / armour / range chips for a soldier kind (ranged units get a range chip). */
export function combatChips(spec: Pick<UnitSpec, 'attack' | 'armor' | 'range' | 'projectile' | 'bonus'>): StatChip[] {
  const ranged = !!spec.projectile;
  const atk = ranged ? spec.attack.pierce : spec.attack.melee;
  const bonus = Object.entries(spec.bonus)
    .map(([cls, n]) => `+${n} vs ${cls}`)
    .join(', ');
  const chips: StatChip[] = [
    {
      icon: ranged ? '#i-st-pierce' : '#i-st-melee',
      text: String(atk),
      title: `${ranged ? 'Pierce' : 'Melee'} attack ${atk}${bonus ? ` (${bonus})` : ''}`,
    },
    {
      icon: '#i-st-armor',
      text: `${spec.armor.melee}/${spec.armor.pierce}`,
      title: `Armour: ${spec.armor.melee} melee / ${spec.armor.pierce} pierce`,
    },
  ];
  if (ranged) chips.push({ icon: '#i-st-range', text: String(spec.range), title: `Range ${spec.range}` });
  return chips;
}

/** The stance shared by every unit, or null when they differ. */
export function sharedStance(units: readonly Pick<Unit, 'stance'>[]): Stance | null {
  if (!units.length) return null;
  const s = units[0].stance;
  return units.every((u) => u.stance === s) ? s : null;
}
