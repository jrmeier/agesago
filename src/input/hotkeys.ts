import { BUILD_HOTKEYS } from '../ui/build';

/**
 * Every RTS-mode hotkey (KeyboardEvent.code) in one table, so a test can prove none clash.
 * First-person mode reuses W/A/S/D and the arrows for movement; it ignores everything here
 * except F.
 *
 * Attack-move is Q: A is already select-all (and strafe in first person), and Q sits right
 * next to it under the left hand, free of every build key. Ctrl+right-click attack-moves
 * directly. Stop is X (the ✕ on its button). Train slots are Z / C / V, left to right in the
 * training panel, so they never collide with the build keys a villager selection uses.
 */
export const HOTKEYS = {
  selectAll: 'KeyA',
  trainVillager: 'KeyT',
  explore: 'KeyE',
  firstPerson: 'KeyF',
  rotate: 'KeyR',
  attackMove: 'KeyQ',
  stop: 'KeyX',
  idleVillager: 'Comma',
  scout: 'Period',
  scoutAlt: 'Home',
  cancel: 'Escape',
  townBell: 'KeyU',
} as const;

/** Training-panel slot keys, left to right. */
export const TRAIN_SLOT_KEYS = ['KeyZ', 'KeyC', 'KeyV'] as const;

/** Control-group keys: Digit1..Digit9 select, with Ctrl / Cmd / Alt they assign. */
export const GROUP_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;

/** Every RTS key code with what it does, for the clash test and help text. */
export function allHotkeys(): { code: string; action: string }[] {
  return [
    ...Object.entries(HOTKEYS).map(([action, code]) => ({ code, action })),
    ...TRAIN_SLOT_KEYS.map((code, i) => ({ code, action: `trainSlot${i + 1}` })),
    ...GROUP_KEYS.map((code, i) => ({ code, action: `group${i + 1}` })),
    ...Object.entries(BUILD_HOTKEYS).map(([kind, code]) => ({ code: code!, action: `build:${kind}` })),
  ];
}

/** Codes bound to more than one action (empty when the table is clean). */
export function hotkeyClashes(list: readonly { code: string; action: string }[] = allHotkeys()): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const { code, action } of list) {
    const prev = seen.get(code);
    if (prev) clashes.push(`${code}: ${prev} / ${action}`);
    else seen.set(code, action);
  }
  return clashes;
}

/** Group number 1..9 for a key code, or 0. Numpad digits count too. */
export function groupForKey(code: string): number {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : 0;
}
