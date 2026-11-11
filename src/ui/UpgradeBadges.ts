import type { Building, EntityId } from '../core/types';
import { researchBlock } from '../sim/systems/research';
import type { World } from '../sim/World';
import { upgradeBlock } from '../sim/systems/buildingUpgrade';
import { badgedBuildings, techViewOf } from './upgradeHints';

/** Seconds between working out which buildings get a badge (researchBlock per tech is not per-frame work). */
const REFRESH = 0.3;
/** Most badges on screen at once. */
const CAP = 24;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * "Upgrade available" badges: a small #i-upgrade icon over each own building that could start a
 * tech or its own next building upgrade right now (see badgedBuildings). Which buildings is recomputed a few times a second; the
 * badges themselves are moved each frame like the rally flag (`project` returns client px for a
 * building's roof, or null when off-screen). Pooled DOM, pointer-events: none.
 */
export class UpgradeBadges {
  private readonly pool: SVGSVGElement[] = [];
  private ids: EntityId[] = [];
  private next = -Infinity;
  private shown = 0;
  private readonly at: string[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    private readonly project: (b: Building) => { x: number; y: number } | null
  ) {}

  /** Building ids badged at the last refresh (for tests). */
  get badged(): readonly EntityId[] {
    return this.ids;
  }

  /** `visible` false hides every badge (first-person camera modes). */
  update(time: number, visible: boolean): void {
    if (time >= this.next || time < this.next - REFRESH * 2) {
      this.next = time + REFRESH;
      const local = this.world.localPlayer;
      const view = techViewOf(this.world, local);
      this.ids = badgedBuildings(
        this.world.buildings.values(), local, view, (t) => researchBlock(this.world, local, t),
        (b) => upgradeBlock(this.world, b, local) === null
      );
    }
    let used = 0;
    if (visible) {
      for (const id of this.ids) {
        if (used >= CAP) break;
        const b = this.world.buildings.get(id);
        const p = b ? this.project(b) : null;
        if (!p) continue;
        const el = this.badge(used);
        const key = `${Math.round(p.x)},${Math.round(p.y)}`;
        if (this.at[used] !== key) {
          this.at[used] = key;
          el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        }
        if (el.dataset.building !== String(id)) el.dataset.building = String(id);
        if (used >= this.shown) el.style.display = 'block';
        used++;
      }
    }
    for (let i = used; i < this.shown; i++) this.pool[i].style.display = 'none';
    this.shown = used;
  }

  private badge(i: number): SVGSVGElement {
    let el = this.pool[i];
    if (el) return el;
    el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('class', 'upgrade-badge');
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-upgrade');
    el.append(use);
    this.root.append(el);
    this.pool[i] = el;
    this.at[i] = '';
    return el;
  }
}
