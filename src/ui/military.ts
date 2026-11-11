import type { CivId } from '../core/civilizations';
import { unitLine, type TechId } from '../core/techs';
import type { Building, BuildingKind, Command, Stance, Stockpile, Unit, UnitKind } from '../core/types';
import { crushOf, isAnimal, UNIT_CRUSH_ARMOR, UNITS, trainable, type UnitSpec } from '../core/units';
import { TRAIN_SLOT_KEYS } from '../input/hotkeys';
import { batchTime } from '../sim/systems/train';
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
  return kind !== 'villager' && kind !== 'scout' && kind !== 'tradeCart' && kind !== 'priest' && kind !== 'fishingBoat' && kind !== 'merchantShip' && kind !== 'transport' && !isAnimal(kind);
}

/**
 * Shift-click / Shift+hotkey orders a batch of five (one 'train' command with count 5). The sim
 * adds it to the last queue entry when that is the same kind and not yet started (up to the batch
 * limit), else it starts a new batch.
 */
export function trainBatch(shift: boolean): number {
  return shift ? 5 : 1;
}

/** The 'train' command for `n` units: count is left out for a single unit. */
export function trainCommand(buildingId: number, unit: UnitKind, n: number): Command {
  return n > 1 ? { type: 'train', buildingId, unit, count: n } : { type: 'train', buildingId, unit };
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
  /** Units in each entry (batch), parallel to kinds. */
  counts: number[];
  /** Head-of-queue progress 0..1. */
  head: number;
}

/** What the queue strip shows: queued kinds and batch sizes head first, and the head's progress. */
export function queueView(b: Pick<Building, 'kind' | 'queue' | 'queueKinds' | 'queueCounts' | 'progress'>): QueueView {
  const kinds = b.queueKinds?.length ? [...b.queueKinds] : Array.from({ length: b.queue }, () => trainable(b.kind)[0] ?? 'villager');
  const counts = kinds.map((_, i) => b.queueCounts?.[i] ?? 1);
  const head = kinds.length ? Math.min(1, Math.max(0, b.progress / batchTime(UNITS[kinds[0]].trainTime, counts[0]))) : 0;
  return { kinds, counts, head };
}

/** "x5" badge for a batch; empty for a single unit. */
export function batchBadge(count: number): string {
  return count > 1 ? `x${count}` : '';
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

/** Melee / pierce / crush armour as one chip ("1/1/2"). */
export function armorChip(m: number, p: number, c: number): StatChip {
  return { icon: '#i-st-armor', text: `${m}/${p}/${c}`, title: `Armour: ${m} melee / ${p} pierce / ${c} crush` };
}

/** Crush attack chip (what pulls buildings down). */
export function crushChip(c: number | string, note = ''): StatChip {
  return { icon: '#i-st-crush', text: String(c), title: `Crush attack ${c} (against buildings)${note}` };
}

type ChipSpec = Pick<UnitSpec, 'attack' | 'armor' | 'range' | 'projectile' | 'bonus'>
  & Partial<Pick<UnitSpec, 'pop' | 'minRange' | 'splash' | 'pierceTargets' | 'siegeTargetsOnly' | 'packTime'>>;

/** What a siege engine's shot does beyond plain damage, for chip titles ("" for others). */
export function siegeNote(spec: ChipSpec): string {
  const notes: string[] = [];
  if (spec.siegeTargetsOnly) notes.push('only buildings and siege');
  if (spec.splash) notes.push(`splash ${spec.splash}, hurts own units too`);
  if (spec.pierceTargets) notes.push(`passes through up to ${spec.pierceTargets} units`);
  if (spec.packTime) notes.push('unpacks to shoot');
  return notes.length ? `; ${notes.join('; ')}` : '';
}

/**
 * Attack / crush / armour / range chips for a soldier kind: crush only when it has some, range
 * only for ranged units. Armour reads melee/pierce/crush.
 */
export function combatChips(spec: ChipSpec): StatChip[] {
  const ranged = !!spec.projectile;
  const atk = ranged ? spec.attack.pierce : spec.attack.melee;
  const crush = crushOf(spec.attack);
  const bonus = Object.entries(spec.bonus)
    .map(([cls, n]) => `+${n} vs ${cls}`)
    .join(', ');
  const note = siegeNote(spec);
  const chips: StatChip[] = [];
  // Pure crush engines (ram, catapult) show only their crush attack.
  if (atk > 0 || crush <= 0) {
    chips.push({
      icon: ranged ? '#i-st-pierce' : '#i-st-melee',
      text: String(atk),
      title: `${ranged ? 'Pierce' : 'Melee'} attack ${atk}${bonus ? ` (${bonus})` : ''}${crush > 0 ? '' : note}`,
    });
  }
  if (crush > 0) chips.push(crushChip(crush, note));
  chips.push(armorChip(spec.armor.melee, spec.armor.pierce, crushOf(spec.armor, UNIT_CRUSH_ARMOR)));
  if (ranged) {
    const range = spec.minRange ? `${spec.minRange}–${spec.range}` : String(spec.range);
    chips.push({ icon: '#i-st-range', text: range, title: `Range ${range}` });
  }
  if ((spec.pop ?? 1) > 1) chips.push({ icon: '#i-pop', text: String(spec.pop), title: `Takes ${spec.pop} population` });
  return chips;
}

/** The stance shared by every unit, or null when they differ. */
export function sharedStance(units: readonly Pick<Unit, 'stance'>[]): Stance | null {
  if (!units.length) return null;
  const s = units[0].stance;
  return units.every((u) => u.stance === s) ? s : null;
}
