import { BUILDINGS } from '../core/buildings';
import { allHotkeys } from '../input/hotkeys';

/** One line in the hotkey reference. `action` is set for every entry of `allHotkeys()`. */
export interface HotkeyRow {
  action?: string;
  keys: string;
  label: string;
}

const ACTION_LABEL: Record<string, string> = {
  selectAll: 'Select all your units',
  trainVillager: 'Train a villager at the Town Center',
  explore: 'Send selected villagers and scouts to explore',
  firstPerson: 'Toggle first person',
  rotate: 'Rotate the building you are placing',
  attackMove: 'Attack-move',
  stop: 'Stop',
  idleVillager: 'Select the next idle villager',
  scout: 'Centre on the next scout',
  scoutAlt: 'Centre on the next scout',
  cancel: 'Cancel',
  townBell: 'Town bell: villagers run to the nearest shelter',
  trainSlot1: 'Train the first unit in the training panel',
  trainSlot2: 'Train the second unit in the training panel',
  trainSlot3: 'Train the third unit in the training panel',
};

/** Printable name for a KeyboardEvent.code. */
export function hotkeyGlyph(code: string): string {
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Escape') return 'Esc';
  if (code === 'Home') return 'Home';
  if (code === 'Slash') return '?';
  return code.replace(/^Key|^Digit|^Numpad/, '');
}

function labelFor(action: string): string {
  const named = ACTION_LABEL[action];
  if (named) return named;
  const group = /^group(\d)$/.exec(action);
  if (group) return `Select group ${group[1]}. Ctrl+${group[1]} assigns it`;
  const build = /^build:(.+)$/.exec(action);
  if (build && build[1] in BUILDINGS) return `Build a ${BUILDINGS[build[1] as keyof typeof BUILDINGS].name}`;
  return action;
}

/** Every bound key, plus the mouse orders that have no key code. */
export function hotkeyHelpRows(): HotkeyRow[] {
  const mouse: HotkeyRow[] = [
    { keys: 'LMB', label: 'Select. Drag a box to select several.' },
    { keys: 'Shift+LMB', label: 'Add to the selection, or keep placing buildings.' },
    { keys: 'RMB', label: 'Move, gather, or attack.' },
    { keys: 'Ctrl+RMB', label: 'Attack-move along the way.' },
  ];
  return [
    ...mouse,
    ...allHotkeys().map(({ code, action }) => ({
      action,
      keys: hotkeyGlyph(code),
      label: labelFor(action),
    })),
  ];
}

/** Fill `list` with one row per hotkey. Safe to call again. */
export function fillHotkeyList(list: HTMLElement): void {
  list.replaceChildren();
  for (const row of hotkeyHelpRows()) {
    const item = document.createElement('li');
    const keys = document.createElement('kbd');
    keys.textContent = row.keys;
    const text = document.createElement('span');
    text.textContent = row.label;
    item.append(keys, text);
    list.append(item);
  }
}

/** The ? button and the parchment list. Controls toggles it on Shift+/ and closes it on Esc. */
export class HotkeyHelp {
  private readonly root: HTMLElement | null;
  private readonly btn: HTMLButtonElement | null;

  constructor() {
    this.root = document.getElementById('hotkey-help');
    this.btn = document.getElementById('help-btn') as HTMLButtonElement | null;
    const list = document.getElementById('hotkey-list');
    if (list) fillHotkeyList(list);
    this.btn?.addEventListener('click', () => this.toggle());
    document.getElementById('hotkey-close')?.addEventListener('click', () => this.close());
    this.root?.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get open(): boolean {
    return !!this.root && !this.root.hidden;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (!this.root) return;
    this.root.hidden = false;
    this.btn?.setAttribute('aria-expanded', 'true');
    document.getElementById('hotkey-close')?.focus();
  }

  close(): void {
    if (!this.root) return;
    this.root.hidden = true;
    this.btn?.setAttribute('aria-expanded', 'false');
  }
}
