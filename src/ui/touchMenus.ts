/** Sheets on the touch selection panel. Desktop ignores these classes. */
export type TouchMenu = 'build' | 'train' | 'orders';

const MENUS: readonly TouchMenu[] = ['build', 'train', 'orders'];

/** The open touch sheet, or null when the selection panel is just the summary. */
export function touchMenuOpen(): TouchMenu | null {
  if (typeof document === 'undefined') return null;
  for (const menu of MENUS) {
    if (document.body.classList.contains(`menu-${menu}`)) return menu;
  }
  return null;
}

/** Open one sheet, or pass null to close them. Existing menu classes also drive map gestures. */
export function setTouchMenu(menu: TouchMenu | null): void {
  if (typeof document === 'undefined') return;
  for (const item of MENUS) {
    const on = item === menu;
    document.body.classList.toggle(`menu-${item}`, on);
    const tab = document.querySelector<HTMLElement>(`#menu-tabs [data-menu="${item}"]`);
    tab?.setAttribute('aria-pressed', String(on));
    tab?.setAttribute('aria-selected', String(on));
    tab?.setAttribute('aria-expanded', String(on));
  }
  const header = document.getElementById('touch-sheet-header');
  if (header) header.hidden = menu === null;
  const title = document.getElementById('touch-sheet-title');
  if (title && menu) {
    title.textContent = document.querySelector(`#menu-tabs [data-menu="${menu}"]`)?.textContent ?? menu;
  }
  const content = document.getElementById('touch-sheet-content');
  if (content) content.scrollTop = 0;
}

/** Open `menu`, or close it if it is already open. */
export function toggleTouchMenu(menu: TouchMenu): void {
  setTouchMenu(touchMenuOpen() === menu ? null : menu);
}

export function closeTouchMenus(): void {
  setTouchMenu(null);
}
