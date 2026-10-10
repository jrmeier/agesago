/** Founding of the Polis. Steps advance from what the sim has already done. */

export const TUTORIAL_STEPS = ['gather', 'train', 'house', 'scout', 'barracks', 'raid', 'done'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

export const HINTS_KEY = 'agesago-tutorial-hints';

export interface TutorialFacts {
  wood: number;
  food: number;
  villagers: number;
  /** A local villager is walking to a node, gathering, or carrying a load. */
  gathering: boolean;
  houses: number;
  /** The local scout is moving or exploring. */
  scoutMoving: boolean;
  barracks: number;
  raidSpawned: boolean;
  raidersAlive: number;
}

export interface TutorialBaseline {
  villagers: number;
  food: number;
}

const OBJECTIVES: Record<TutorialStep, string> = {
  gather: 'Select a villager and send them to gather.',
  train: 'Train a villager at the Town Center.',
  house: 'Build a house.',
  scout: 'Send the scout into the fog.',
  barracks: 'Build a barracks.',
  raid: 'Raiders are on the fields. Defeat them.',
  done: 'The polis stands.',
};

const HINTS: Record<Exclude<TutorialStep, 'done'>, { id: string; desktop: string; touch: string }> = {
  gather: {
    id: 'gather',
    desktop: 'Click a villager, then right-click a tree or a berry bush.',
    touch: 'Tap a villager, then tap a tree or a berry bush.',
  },
  train: {
    id: 'train',
    desktop: 'Click the Town Center, then press T or Train Villager. Food for the first one is already in store.',
    touch: 'Tap the Town Center, then tap Train Villager. Food for the first one is already in store.',
  },
  house: {
    id: 'house',
    desktop: 'A house costs 30 wood. Select villagers, press H, then click open ground.',
    touch: 'A house costs 30 wood. Select villagers, open Build, tap House, then tap open ground.',
  },
  scout: {
    id: 'scout',
    desktop: 'Click the scout and right-click the dark part of the map.',
    touch: 'Tap the scout, then tap the dark part of the map.',
  },
  barracks: {
    id: 'barracks',
    desktop: 'The town has set aside timber. Select villagers, choose Barracks, then click open ground.',
    touch: 'The town has set aside timber. Select villagers, open Build, tap Barracks, then tap open ground.',
  },
  raid: {
    id: 'raid',
    desktop: 'A hoplite stands with you. Click them and right-click a raider.',
    touch: 'A hoplite stands with you. Tap them, then tap a raider.',
  },
};

export function objective(step: TutorialStep): string {
  return OBJECTIVES[step];
}

export function hintText(step: TutorialStep, touch: boolean, dismissed: ReadonlySet<string>): string {
  if (step === 'done') return '';
  const hint = HINTS[step];
  if (dismissed.has(hint.id)) return '';
  return touch ? hint.touch : hint.desktop;
}

export function hintId(step: TutorialStep): string | null {
  if (step === 'done') return null;
  return HINTS[step].id;
}

export function loadDismissed(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return new Set();
    return new Set(data.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function rememberDismissed(dismissed: ReadonlySet<string>, id: string): string {
  return JSON.stringify([...dismissed, id]);
}

function met(step: TutorialStep, facts: TutorialFacts, baseline: TutorialBaseline): boolean {
  switch (step) {
    case 'gather':
      return facts.gathering || facts.wood > 0 || facts.food > baseline.food;
    case 'train':
      return facts.villagers > baseline.villagers;
    case 'house':
      return facts.houses > 0;
    case 'scout':
      return facts.scoutMoving;
    case 'barracks':
      return facts.barracks > 0;
    case 'raid':
      return facts.raidSpawned && facts.raidersAlive === 0;
    case 'done':
      return false;
  }
}

/** Move forward through every step whose work is already in the sim. */
export function advance(step: TutorialStep, facts: TutorialFacts, baseline: TutorialBaseline): TutorialStep {
  let current = step;
  while (current !== 'done' && met(current, facts, baseline)) {
    const next = TUTORIAL_STEPS[TUTORIAL_STEPS.indexOf(current) + 1];
    current = next ?? 'done';
  }
  return current;
}
