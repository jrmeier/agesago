import type { BuildingKind, UnitKind } from './types';

/**
 * The counter table (M16-9): which class beats which, cost for cost. It is printed in the in-game
 * help (src/ui/hotkeyHelp.ts) and in docs/BALANCE.md, and src/bench/counters.test.ts plays every
 * `fights` pair (equal-cost groups, City Age, no research) and every `razes` comparison, so the
 * text cannot drift from the numbers.
 */
export interface CounterEntry {
  /** Who does the countering, as the help names it. */
  unit: string;
  /** What it beats. */
  beats: string;
  /** Why, in a few words. */
  why: string;
  /** [counter, victim] pairs the counter must win cost for cost. */
  fights: [UnitKind, UnitKind][];
  /** `kind` razes `target` at least twice as fast as the same spend of `than`. */
  razes?: { kind: UnitKind; target: BuildingKind; than: UnitKind }[];
}

export const COUNTERS: CounterEntry[] = [
  {
    unit: 'Spearmen (Hoplites)', beats: 'cavalry and cavalry champions', why: '+12 against cavalry',
    fights: [['hoplite', 'horseman'], ['hoplite', 'scout'], ['hoplite', 'equites']],
  },
  {
    unit: 'Swordsmen', beats: 'spearmen', why: 'more attack, as cheap',
    fights: [['swordsman', 'hoplite']],
  },
  {
    unit: 'Slingers', beats: 'infantry and infantry champions', why: '+3 against infantry, cheap',
    fights: [['slinger', 'swordsman'], ['slinger', 'hoplite'], ['slinger', 'praetorian']],
  },
  {
    unit: 'Archers', beats: 'spearmen and slingers', why: 'outrange them; +3 against ranged',
    fights: [['archer', 'hoplite'], ['archer', 'slinger']],
  },
  {
    unit: 'Cavalry (Horsemen, Scouts)', beats: 'archers, slingers and siege', why: '+6 against ranged, +10 against siege',
    fights: [['horseman', 'archer'], ['horseman', 'slinger'], ['scout', 'archer'], ['horseman', 'catapult'], ['horseman', 'boltShooter']],
  },
  {
    unit: 'Melee infantry', beats: 'unescorted siege', why: '+8 against siege',
    fights: [['swordsman', 'catapult'], ['swordsman', 'boltShooter'], ['hoplite', 'catapult']],
  },
  {
    unit: 'Catapults, Bolt Shooters', beats: 'massed archers and slingers', why: 'splash and bolts through a line',
    fights: [['catapult', 'archer'], ['catapult', 'slinger'], ['boltShooter', 'archer'], ['boltShooter', 'slinger']],
  },
  {
    unit: 'Rams, Catapults', beats: 'buildings', why: 'crush damage; buildings have no crush armour',
    fights: [],
    razes: [
      { kind: 'ram', target: 'townCenter', than: 'swordsman' },
      { kind: 'ram', target: 'watchTower', than: 'swordsman' },
      { kind: 'catapult', target: 'townCenter', than: 'archer' },
    ],
  },
  {
    unit: 'Champions', beats: 'their own line at equal cost', why: 'one costs 2–3 line units; slingers and spearmen still beat them',
    fights: [['praetorian', 'swordsman'], ['equites', 'horseman']],
  },
];
