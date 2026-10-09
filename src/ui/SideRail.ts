/** Holding a group button this long (ms) assigns the current selection to it. */
export const ASSIGN_HOLD_MS = 500;
/** Group buttons always shown on touch (the rest appear once assigned). */
const TOUCH_GROUPS = 5;

export interface SideRailHandlers {
  /** Idle-villager button: select and centre the next idle villager. */
  idle(): void;
  /** Group button tapped / clicked (`assign`: Ctrl / Cmd / Alt-click). */
  group(n: number, assign: boolean): void;
  /** Group button held down: assign the selection to it. */
  assign(n: number): void;
}

/**
 * The left rail: an idle-villager medallion with a count badge, then control-group buttons
 * 1–9 with their unit counts. Tap / click selects a group (double-tap centres, via the
 * handler), long-press (or Ctrl-click) assigns. Binds #side-rail, #idle-btn and #group-bar.
 */
export class SideRail {
  private readonly rail = document.getElementById('side-rail');
  private readonly idleBtn = document.getElementById('idle-btn');
  private readonly idleCount: HTMLElement | null;
  private readonly bar = document.getElementById('group-bar');
  private readonly buttons: HTMLButtonElement[] = [];
  private idleShown = -1;
  private sizesKey = '';
  private hold = 0;
  /** A long-press just assigned: swallow the click that follows the release. */
  private swallowClick = false;

  constructor(private readonly on: SideRailHandlers) {
    this.idleCount = this.idleBtn?.querySelector<HTMLElement>('.idle-count') ?? null;
    this.idleBtn?.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.on.idle();
    });
    this.rail?.addEventListener('contextmenu', (e) => e.preventDefault());
    for (let n = 1; n <= 9; n++) this.buttons.push(this.groupButton(n));
    this.bar?.append(...this.buttons);
  }

  /** Idle villager count for the badge (only touches the DOM when it changes). */
  setIdle(count: number): void {
    if (count === this.idleShown || !this.idleBtn) return;
    this.idleShown = count;
    if (this.idleCount) this.idleCount.textContent = String(count);
    this.idleBtn.classList.toggle('none-idle', count === 0);
    this.idleBtn.setAttribute('aria-label', `${count} idle villager${count === 1 ? '' : 's'} — select next`);
  }

  /** Group sizes, index 0 = group 1. */
  setGroups(sizes: readonly number[]): void {
    const key = sizes.join(',');
    if (key === this.sizesKey) return;
    this.sizesKey = key;
    this.buttons.forEach((btn, i) => {
      const n = sizes[i] ?? 0;
      btn.classList.toggle('empty', n === 0);
      btn.classList.toggle('touch-spare', n === 0 && i >= TOUCH_GROUPS);
      const count = btn.querySelector('.group-count');
      if (count) count.textContent = n ? String(n) : '';
      btn.title = n ? `Group ${i + 1}: ${n} — tap to select, twice to centre` : `Group ${i + 1} — hold (or Ctrl+${i + 1}) to assign`;
    });
  }

  private groupButton(n: number): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'group-btn empty';
    btn.dataset.group = String(n);
    btn.innerHTML = `<span class="group-num">${n}</span><span class="group-count"></span>`;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearTimeout(this.hold);
      this.swallowClick = false;
      this.hold = window.setTimeout(() => {
        this.swallowClick = true;
        this.on.assign(n);
        btn.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 220 });
        if ('vibrate' in navigator) navigator.vibrate(15);
      }, ASSIGN_HOLD_MS);
    });
    const cancel = () => clearTimeout(this.hold);
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('click', (e) => {
      btn.blur();
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      this.on.group(n, e.ctrlKey || e.metaKey || e.altKey);
    });
    return btn;
  }
}
