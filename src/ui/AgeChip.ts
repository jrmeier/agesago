import type { Vec2 } from '../core/types';
import type { Selection } from '../game/Selection';
import type { World } from '../sim/World';
import { setTouchMenu } from './touchMenus';
import { ageChipText, ageProgress, techViewOf } from './upgradeHints';

/** Seconds between refreshes: the chip reads every building, so it doesn't run per frame. */
const REFRESH = 0.25;

/**
 * The age-progress chip in the top bar (#age-chip): the next age, the building count toward it
 * and what the stockpile still lacks ("Town Age · 1/2 buildings · need 120 food"). Clicking it
 * selects the Town Center and jumps there; on a phone it also opens the Research sheet. Hidden in
 * the last age. `update(time)` is cheap to call every frame.
 */
export class AgeChip {
  private readonly el = document.getElementById('age-chip') as HTMLButtonElement | null;
  private readonly label = this.el?.querySelector<HTMLElement>('.age-chip-text') ?? null;
  private next = -Infinity;
  private key = '';

  constructor(
    private readonly world: World,
    private readonly selection: Selection,
    private readonly focusOn: (p: Vec2) => void
  ) {
    // onclick (not addEventListener) so a later match's chip replaces this one's handler.
    if (this.el) {
      this.el.onclick = (e) => {
        (e.currentTarget as HTMLElement).blur();
        this.open();
      };
    }
    this.refresh();
  }

  update(time: number): void {
    if (time < this.next && time >= this.next - REFRESH * 2) return;
    this.next = time + REFRESH;
    this.refresh();
  }

  /** Select the Town Center and show it (its Research tiles hold the age-up). */
  open(): void {
    const tc = this.world.townCenterOf(this.world.localPlayer);
    if (!tc) return;
    this.selection.set([tc.id]);
    this.focusOn(tc.pos);
    if (document.body.classList.contains('touch')) setTouchMenu('train');
  }

  private refresh(): void {
    const el = this.el;
    if (!el) return;
    const p = ageProgress(techViewOf(this.world, this.world.localPlayer));
    const t = p ? ageChipText(p) : null;
    const key = t ? `${t.text}|${t.short}|${p!.ready}|${p!.advancing}` : '';
    if (key === this.key) return;
    this.key = key;
    el.hidden = !t;
    if (!t || !p) return;
    if (this.label) this.label.textContent = t.text;
    el.dataset.short = t.short;
    el.title = t.title;
    el.setAttribute('aria-label', t.title);
    el.classList.toggle('ready', p.ready);
    el.classList.toggle('advancing', p.advancing);
  }
}
